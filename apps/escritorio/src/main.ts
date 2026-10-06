/**
 * Scholaris de escritorio: el mismo servidor que la versión local, en un solo
 * fichero que se abre con doble clic. Bun pone el motor y SQLite (bun:sqlite);
 * la web va embebida; los datos viven en ~/Scholaris. Al arrancar abre el
 * navegador. Como en Andarama.
 *
 * Variables útiles: SCHOLARIS_DATOS, PORT, GEMINI_API_KEY (o guárdala en
 * Ajustes → Claves desde la web), INFERBOX_URL, SCHOLARIS_NO_NAVEGADOR=1.
 */
import { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import * as sqliteVec from 'sqlite-vec';
import { crearServidorLocal, type BaseSqlite, type DriverSqlite } from '@scholaris/local';
import type { EventoTiempoReal, MensajeCliente } from '@scholaris/contrato';
import { configurarMotor } from '@scholaris/spdf';
import rutaWasm from '@sqlite.org/sqlite-wasm/sqlite3.wasm' with { type: 'file' };
import { WEB } from './web-embebida.js';

// El motor SQLite de los .spdf (sqlite-wasm) va embebido: se le dan los bytes.
configurarMotor({ bytesWasm: new Uint8Array(await Bun.file(rutaWasm).arrayBuffer()) });

declare const SCHOLARIS_VERSION: string | undefined;
const VERSION = typeof SCHOLARIS_VERSION === 'string' ? SCHOLARIS_VERSION : 'dev';

const driverBun: DriverSqlite = {
  abrir: (ruta) => new Database(ruta, { create: true }) as unknown as BaseSqlite,
  cargarVec: (db) => sqliteVec.load(db as never),
};

const TIPOS: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2', wasm: 'application/wasm',
  webmanifest: 'application/manifest+json', txt: 'text/plain; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
};

/** La web: embebida en el ejecutable o, en desarrollo, la carpeta apps/web/dist. */
function servirWeb(ruta: string): Response | null {
  const dev = resolve(import.meta.dir, '../../web/dist');
  let limpia = decodeURIComponent(ruta);
  if (limpia.includes('..')) return null;
  if (limpia === '/' || limpia === '') limpia = '/index.html';
  const embebida = WEB[limpia];
  const fichero = embebida ?? (existsSync(join(dev, limpia)) && !limpia.endsWith('/') ? join(dev, limpia) : null);
  if (!fichero) return null;
  const ext = limpia.split('.').pop() ?? '';
  const inmutable = limpia.startsWith('/assets/');
  return new Response(Bun.file(fichero), { headers: { 'content-type': TIPOS[ext] ?? 'application/octet-stream', 'cache-control': inmutable ? 'public, max-age=31536000, immutable' : 'no-cache' } });
}

function abrirNavegador(url: string): void {
  const cmd = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
  try { Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' }); } catch { /* sin navegador */ }
}

async function main(): Promise<void> {
  const datos = resolve(process.env.SCHOLARIS_DATOS ?? join(homedir(), 'Scholaris'));
  const puerto = Number(process.env.PORT ?? 8791);
  // Claves en ~/Scholaris/claves.env (opcional): GEMINI_API_KEY=…
  const entorno: Record<string, string | undefined> = { ...process.env };
  const fichero = join(datos, 'claves.env');
  if (existsSync(fichero)) {
    for (const l of readFileSync(fichero, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*["']?([^"'\n]*)["']?\s*$/.exec(l);
      if (m && !entorno[m[1]!]) entorno[m[1]!] = m[2];
    }
  }
  const s = await crearServidorLocal({ datos, puerto, origen: `http://localhost:${puerto}`, driver: driverBun, entorno });

  interface DatosSocket { canal: string; quitar?: () => void }
  const servidor = Bun.serve<DatosSocket>({
    port: puerto,
    hostname: '127.0.0.1',
    idleTimeout: 255,
    async fetch(peticion, srv) {
      const url = new URL(peticion.url);
      if (url.pathname === '/api/v2/tiempo-real') {
        const canal = await s.canalDeBillete(url.searchParams.get('billete') ?? '');
        if (!canal) return Response.json({ error: { codigo: 'no_autenticado', mensaje: 'El billete no es válido o ha caducado.' } }, { status: 401 });
        if (srv.upgrade(peticion, { data: { canal } })) return undefined as unknown as Response;
        return new Response('Esta ruta solo admite WebSocket.', { status: 426 });
      }
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/mcp') {
        const w = servirWeb(url.pathname);
        if (w) return w;
        if (peticion.method === 'GET' && !/\.[a-z0-9]+$/i.test(url.pathname)) {
          const i = servirWeb('/index.html');
          if (i) return i;
        }
      }
      return s.fetch(peticion);
    },
    websocket: {
      open(ws) {
        const [, usuario, tarea] = ws.data.canal.split(':');
        ws.send(JSON.stringify({ tipo: 'hola', usuario: usuario ?? '', ...(tarea ? { tarea } : {}) } satisfies EventoTiempoReal));
        ws.data.quitar = s.tiempoReal.suscribir(ws.data.canal, (e) => ws.send(JSON.stringify(e)));
      },
      message(ws, m) {
        try {
          const msg = JSON.parse(String(m)) as MensajeCliente;
          if (msg.tipo === 'ping') ws.send(JSON.stringify({ tipo: 'pong', t: msg.t }));
        } catch { /* ignorado */ }
      },
      close(ws) { ws.data.quitar?.(); },
    },
  });

  const url = `http://localhost:${servidor.port}/`;
  console.log(`Scholaris ${VERSION} en ${url}`);
  console.log(`Datos en ${datos}`);
  if (!entorno.GEMINI_API_KEY) console.log('Sin GEMINI_API_KEY: guárdala en Ajustes → Claves desde la web, o en claves.env dentro de la carpeta de datos.');
  if (process.env.SCHOLARIS_NO_NAVEGADOR !== '1') abrirNavegador(url);
}

main().catch((e) => { console.error(e); process.exit(1); });
