/**
 * Arranque en Node: `pnpm --filter @scholaris/local start` o la imagen Docker.
 *
 *   DATA_DIR          carpeta de datos (./datos)
 *   PORT              puerto (8790)
 *   PUBLIC_URL        URL pública si va detrás de un proxy
 *   WEB_DIR           web construida (apps/web/dist)
 *   GEMINI_API_KEY, OPENROUTER_API_KEY, TYPESAFE_API_KEY   inteligencia por API
 *   INFERBOX_URL, INFERBOX_API_KEY                         opcional, sin conexión
 *   SCHOLARIS_SIN_CONEXION=1, INFERENCIA_URL, INFERENCIA_…  todo en el servidor propio y guardia de red
 *   SCHOLARIS_CATALOGOS=1                                  sin conexión, pero con los catálogos abiertos de metadatos
 *   SCHOLARIS_TOKEN   token fijo para un solo usuario (opcional)
 *   SCHOLARIS_USUARIOS varias personas sin Clerk: "token:id:correo:Nombre;…"
 *   CLERK_PUBLISHABLE_KEY                                  multiusuario con Clerk
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { Agent, setGlobalDispatcher } from 'undici';
import { WebSocketServer } from 'ws';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { crearServidorLocal, type DriverSqlite } from './servidor.js';
import type { BaseSqlite } from './sql.js';
import type { MensajeCliente } from '@scholaris/contrato';
import type { ArchivoConvertir } from '@scholaris/api/compartido/motor-ingesta';
import { conversorRemoto, recortadorRemoto } from '@scholaris/api/compartido/conversor-remoto';
import { ANFITRIONES_CATALOGOS, configuracionSinConexion, modoSinConexion } from '@scholaris/proveedores';
import { instalarGuardiaDeRed } from './guardia-red.js';

export const driverNode: DriverSqlite = {
  abrir: (ruta) => new Database(ruta) as unknown as BaseSqlite,
  cargarVec: (db) => sqliteVec.load(db as unknown as Database.Database),
};

/** Recortes de figuras con la imprenta de Node (canvas): el vector propio de cada figura. */
export async function recortadorNode() {
  const m = await import('@scholaris/imprenta/node');
  return async (imagen: { bytes: Uint8Array; mime: string }, region: { x: number; y: number; w: number; h: number }) => {
    try { return await m.recortarImagen(imagen.bytes, region); } catch { return null; }
  };
}

export async function imprentaNode() {
  const m = await import('@scholaris/imprenta/node');
  return async (a: ArchivoConvertir, guardar: (id: string, datos: Uint8Array, mime: string) => Promise<void>) => {
    const r = await m.recolectar(m.convertir({ nombre: a.nombre, mime: a.mime, bytes: await a.leer() }, a.tipo ? { tipo: a.tipo as never } : {}));
    for (const [id, d] of r.datos) await guardar(id, d, r.paquete.partes.find((x) => x.id === id)?.mime ?? 'application/octet-stream');
    return r.paquete;
  };
}

/**
 * El fetch de Node encola en serie las peticiones simultáneas al mismo origen
 * (Gemini): con un agente de muchas conexiones vuelve el paralelismo real.
 */
export function fetchEnParalelo(): void {
  setGlobalDispatcher(new Agent({ connections: 256, pipelining: 1, keepAliveTimeout: 30_000 }));
}

/**
 * Modo sin conexión: comprueba la configuración (URLs locales) y cierra la red
 * a todo lo que no sea local. Devuelve la guardia o null si no hace falta.
 */
export function prepararSinConexion(env: Record<string, string | undefined> = process.env) {
  if (!modoSinConexion(env)) return null;
  const cfg = configuracionSinConexion(env);
  const permitidos = [...cfg.permitidos, ...(env.SCHOLARIS_CATALOGOS === '1' ? ANFITRIONES_CATALOGOS : [])];
  const guardia = instalarGuardiaDeRed({ permitidos });
  console.log(`[sin conexión] inteligencia en ${cfg.url} (${cfg.sabor}); toda petición a internet se bloquea y se anota${permitidos.length ? ` (permitidos: ${permitidos.join(', ')})` : ''}`);
  return guardia;
}

export async function arrancarNode(opciones: { puerto?: number; datos?: string; web?: string } = {}) {
  fetchEnParalelo();
  // Después de fetchEnParalelo: la guardia pone su propio despachador (con las mismas conexiones).
  prepararSinConexion();
  const aqui = dirname(fileURLToPath(import.meta.url));
  const puerto = opciones.puerto ?? Number(process.env.PORT ?? 8790);
  const s = await crearServidorLocal({
    datos: opciones.datos ?? process.env.DATA_DIR ?? './datos',
    puerto,
    web: opciones.web ?? process.env.WEB_DIR ?? resolve(aqui, '../../web/dist'),
    driver: driverNode,
    // Conversor: uno remoto (SCHOLARIS_CONVERSOR_URL, p. ej. el contenedor), la imprenta de Node, o ninguno.
    ...(process.env.SCHOLARIS_CONVERSOR_URL
      ? {
        convertir: conversorRemoto((r) => fetch(new URL(new URL(r.url).pathname + new URL(r.url).search, process.env.SCHOLARIS_CONVERSOR_URL), r)),
        recortar: recortadorRemoto((r) => fetch(new URL(new URL(r.url).pathname + new URL(r.url).search, process.env.SCHOLARIS_CONVERSOR_URL), r)),
      }
      : process.env.SCHOLARIS_IMPRENTA === '0' ? {} : { convertir: await imprentaNode(), recortar: await recortadorNode() }),
  });

  const http = createServer(getRequestListener((req) => s.fetch(req)));
  const wss = new WebSocketServer({ noServer: true });
  http.on('upgrade', (req, socket, cabeza) => {
    const url = new URL(req.url ?? '/', s.origen);
    if (url.pathname !== '/api/v2/tiempo-real') return socket.destroy();
    void s.canalDeBillete(url.searchParams.get('billete') ?? '').then((canal) => {
      if (!canal) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nEl billete no es válido o ha caducado.');
        return socket.destroy();
      }
      wss.handleUpgrade(req, socket, cabeza, (ws) => {
        const usuario = canal.split(':')[1] ?? '';
        const tarea = canal.startsWith('tarea:') ? canal.split(':')[2] : undefined;
        ws.send(JSON.stringify({ tipo: 'hola', usuario, ...(tarea ? { tarea } : {}) }));
        const quitar = s.tiempoReal.suscribir(canal, (e) => ws.send(JSON.stringify(e)));
        ws.on('message', (m) => {
          if (String(m) === 'ping') { ws.send('pong'); return; }
          try {
            const msg = JSON.parse(String(m)) as MensajeCliente;
            if (msg.tipo === 'ping') ws.send(JSON.stringify({ tipo: 'pong', t: msg.t }));
          } catch { /* ignorado */ }
        });
        ws.on('close', quitar);
      });
    });
  });
  await new Promise<void>((r) => http.listen(puerto, r));
  console.log(`Scholaris local escuchando en ${s.origen} (datos en ${resolve(opciones.datos ?? process.env.DATA_DIR ?? './datos')})`);
  const cerrar = () => { s.cerrar(); http.close(); };
  return { servidor: s, http, cerrar };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  arrancarNode().catch((e) => { console.error(e); process.exit(1); });
  process.on('SIGTERM', () => process.exit(0));
}

export { join };
