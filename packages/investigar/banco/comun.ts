/**
 * Lo común del banco de Investigar: claves, la API de producción (solo lectura),
 * la copia local de la biblioteca (node:sqlite con el esquema SPDF 4.2 y el de las
 * funciones) y el montaje de los puertos del agente sobre ella.
 */
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { Buscador, IndiceVectorialSQL } from '@scholaris/busqueda';
import { sqlConLimite, type SQL, type ValorSQL } from '@scholaris/nucleo';
import { crearGemini, crearJev } from '@scholaris/proveedores';
import { crearModeloGemini, esperarArchivoActivo, estadoArchivoGemini, subirArchivoGemini, type ConfigGeminiAgente } from '../src/gemini.js';
import type { MediosInvestigar, ModelosInvestigar, PuertosInvestigar } from '../src/puertos.js';

export const DIR = fileURLToPath(new URL('.', import.meta.url));
export const DATOS = join(DIR, 'datos');
export const RESULTADOS = join(DIR, 'resultados');
export const BD = join(DATOS, 'biblioteca.sqlite');

export const PELICULA = 'dmw21xnomjseg07mi';
export const CUENTO = 'dmw21xdj01a6v8dkc';

/** Lee `CLAVE=valor` de un fichero .env de ~/.claude/.secrets. */
export function secreto(fichero: string, clave: string): string {
  const ruta = join(homedir(), '.claude', '.secrets', fichero);
  const linea = readFileSync(ruta, 'utf8').split('\n').find((l) => l.startsWith(`${clave}=`));
  if (!linea) throw new Error(`Falta ${clave} en ${ruta}`);
  return linea.slice(clave.length + 1).trim().replace(/^["']|["']$/g, '');
}

export function api() {
  const base = `${secreto('scholaris.env', 'SCHOLARIS_URL').replace(/\/+$/, '')}/api/v2`;
  const clave = secreto('scholaris.env', 'SCHOLARIS_CLAVE');
  return async function pedir<T>(ruta: string): Promise<T> {
    const r = await fetch(`${base}${ruta}`, { headers: { authorization: `Bearer ${clave}`, 'x-scholaris-cliente': 'banco-investigar' } });
    if (!r.ok) throw new Error(`${ruta}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return (await r.json()) as T;
  };
}

export function abrirBD(ruta = BD): SQL & { bd: DatabaseSync } {
  const bd = new DatabaseSync(ruta);
  const sql = {
    bd,
    async ejecutar<T>(consulta: string, ...parametros: ValorSQL[]): Promise<T[]> {
      const ps = parametros.map((p) => (p instanceof ArrayBuffer ? new Uint8Array(p) : p));
      const st = bd.prepare(consulta);
      return st.all(...(ps as Array<string | number | null | Uint8Array>)) as T[];
    },
    async transaccion<T>(fn: (s: SQL) => Promise<T>): Promise<T> {
      bd.exec('BEGIN');
      try { const r = await fn(sql); bd.exec('COMMIT'); return r; } catch (e) { bd.exec('ROLLBACK'); throw e; }
    },
  };
  return Object.assign(sqlConLimite(sql), { bd });
}

export function configGemini(): ConfigGeminiAgente {
  return { clave: secreto('gemini.env', 'GEMINI_API_KEY') };
}

/** El proxy ligero de la película: el de la percepción si ya está hecho; si no, uno propio (360p, mono). */
export function rutaProxy(): string {
  const percepcion = join(homedir(), 'tmp', 'scholaris-fresa', 'percepcion', 'fuentes', 'proxy.mp4');
  const propio = join(DATOS, 'proxy.mp4');
  if (existsSync(propio)) return propio;
  if (existsSync(percepcion)) return percepcion;
  throw new Error(`No hay proxy de la película (ni ${percepcion} ni ${propio}). Hazlo con ffmpeg desde el original.`);
}

/** Sube el proxy a Gemini Files una vez y guarda {uri, nombre, expira} (como `proxy.gemini.json` en R2). */
export async function fuenteGemini(cfg: ConfigGeminiAgente): Promise<{ uri: string; mime: string }> {
  const cache = join(DATOS, 'proxy.gemini.json');
  if (existsSync(cache)) {
    const c = JSON.parse(readFileSync(cache, 'utf8')) as { uri: string; nombre: string; mime: string; expira?: string };
    const quedan = c.expira ? Date.parse(c.expira) - Date.now() : 0;
    if (quedan > 6 * 3600_000) {
      const e = await estadoArchivoGemini(cfg, c.nombre).catch(() => null);
      if (e?.estado === 'ACTIVE') return { uri: c.uri, mime: c.mime };
    }
  }
  const ruta = rutaProxy();
  const bytes = statSync(ruta).size;
  console.error(`Subiendo el proxy (${(bytes / 1e6).toFixed(0)} MB) a Gemini Files…`);
  const flujo = Readable.toWeb(createReadStream(ruta)) as ReadableStream<Uint8Array>;
  const a = await subirArchivoGemini(cfg, flujo, bytes, 'video/mp4', 'scholaris-banco-fresa-proxy');
  const activo = await esperarArchivoActivo(cfg, a.nombre, 900_000);
  writeFileSync(cache, JSON.stringify({ uri: activo.uri, nombre: activo.nombre, mime: 'video/mp4', bytes, subido: new Date().toISOString(), expira: activo.expira }, null, 2));
  return { uri: activo.uri, mime: 'video/mp4' };
}

export interface OpcionesMontaje {
  agente: string;
  redactor?: string;
  vision?: string;
  verificador?: string;
}

/** Los puertos del agente sobre la copia local: Gemini Embedding 2 para las consultas (los vectores de producción vienen en el SPDF). */
export function montar(sql: SQL & { bd: DatabaseSync }, o: OpcionesMontaje): PuertosInvestigar {
  const cfg = configGemini();
  const g = crearGemini({ clave: cfg.clave, intentos: 3 });
  const embebedor = g.embebedor();
  const indice = new IndiceVectorialSQL(sql, embebedor.espacio);
  // El reordenador de producción (Jev), si hay clave.
  let reordenador;
  try { reordenador = crearJev({ clave: secreto('typesafe.env', 'TYPESAFE_API_KEY') }).reordenador(); } catch { reordenador = undefined; }
  const buscador = new Buscador({ sql, embebedor, indice, espacioNombres: 'banco', ...(reordenador ? { reordenador } : {}) });
  const modelos: ModelosInvestigar = {
    agente: crearModeloGemini(cfg, o.agente),
    ...(o.redactor ? { redactor: crearModeloGemini(cfg, o.redactor) } : {}),
    ...(o.vision ? { vision: crearModeloGemini(cfg, o.vision) } : {}),
    ...(o.verificador ? { verificador: crearModeloGemini(cfg, o.verificador) } : {}),
  };
  let fuente: Promise<{ uri: string; mime: string }> | null = null;
  const medios: MediosInvestigar = {
    async fuente(documento) {
      if (documento !== PELICULA) return null;
      fuente ??= fuenteGemini(cfg);
      return fuente;
    },
    async imagen(documento, clave) {
      const [f] = sql.bd.prepare('SELECT mime, datos FROM banco_blobs WHERE documento = ? AND clave = ?').all(documento, clave) as Array<{ mime: string; datos: Uint8Array }>;
      return f ? { bytes: new Uint8Array(f.datos), mime: f.mime } : null;
    },
    async url(documento, clave) {
      return `banco://${documento}/${clave}`;
    },
  };
  return { sql, buscador, modelos, medios, usuario: { id: 'banco', pro: true } };
}
