/**
 * Montaje del banco de calidad: inteligencia real con cachés en disco (para que
 * repetir un experimento no cueste dinero ni cambie el resultado) y los
 * «sistemas» que se comparan: cada vía sola, la fusión, con y sin
 * comprensión, con distintos reordenadores.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Agent, setGlobalDispatcher } from 'undici';
import { Buscador, IndiceVectorialSQL, reordenadorConRedactor, type AjustesBusqueda, type OpcionesBusqueda, type Via } from '@scholaris/busqueda';
import { crearInteligencia, crearJev, crearWorkersAI, ContadorUso, type InteligenciaConUso } from '@scholaris/proveedores';
import type { Embebedor, Redactor, Reordenador } from '@scholaris/nucleo';
import { cargarEntorno } from '../entorno.js';
import { abrirEstanteria, DIR_DATOS_CALIDAD } from './estanteria.js';

setGlobalDispatcher(new Agent({ connections: 64, keepAliveTimeout: 4_000, keepAliveMaxTimeout: 10_000 }));

const DIR_CACHE = join(DIR_DATOS_CALIDAD, 'cache');

export const hash = (x: unknown) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 24);

/** Caché en disco: un fichero por clave dentro de un cajón. */
export function cacheDisco<T>(cajon: string) {
  const dir = join(DIR_CACHE, cajon);
  mkdirSync(dir, { recursive: true });
  return {
    leer(clave: string): T | undefined {
      const r = join(dir, `${clave}.json`);
      if (!existsSync(r)) return undefined;
      try { return JSON.parse(readFileSync(r, 'utf8')) as T; } catch { return undefined; }
    },
    poner(clave: string, v: T): void { writeFileSync(join(dir, `${clave}.json`), JSON.stringify(v)); },
  };
}

export function embebedorConCache(e: Embebedor): Embebedor {
  const c = cacheDisco<number[]>(`vec-${e.espacio.id}`);
  return {
    espacio: e.espacio,
    admite: (m) => e.admite(m),
    async vectorizar(piezas, tarea) {
      const claves = piezas.map((p) => hash({ tarea, t: p.modalidad === 'texto' ? p.texto : hash(Array.from((p as { bytes: Uint8Array }).bytes.subarray(0, 4096))) }));
      const salida: Array<Float32Array | undefined> = claves.map((k) => { const v = c.leer(k); return v ? Float32Array.from(v) : undefined; });
      const faltan = salida.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
      if (faltan.length) {
        const vs = await e.vectorizar(faltan.map((i) => piezas[i]!), tarea);
        faltan.forEach((i, k) => { const v = vs[k]!; salida[i] = v; c.poner(claves[i]!, Array.from(v)); });
      }
      return salida as Float32Array[];
    },
  };
}

export function redactorConCache(r: Redactor, cajon = 'redactor'): Redactor {
  const c = cacheDisco<{ texto: string; json?: unknown }>(cajon);
  return {
    nombre: r.nombre,
    async generar<T>(pet: Parameters<Redactor['generar']>[0]) {
      const clave = hash({ ...pet, mensajes: pet.mensajes.map((m) => ({ rol: m.rol, partes: m.partes.map((p) => ('texto' in p ? p.texto : hash(Array.from(p.bytes.subarray(0, 4096))))) })) });
      const v = c.leer(clave);
      if (v) return v as { texto: string; json?: T };
      const x = await r.generar<T>(pet);
      c.poner(clave, x);
      return x;
    },
  };
}

export function reordenadorConCache(r: Reordenador): Reordenador {
  const c = cacheDisco<number[]>(`reord-${r.nombre.replace(/[^\w.-]+/g, '_')}`);
  return {
    nombre: r.nombre,
    async reordenar(consulta, textos) {
      const clave = hash({ consulta, textos });
      const v = c.leer(clave);
      if (v) return v;
      const x = await r.reordenar(consulta, textos);
      c.poner(clave, x);
      return x;
    },
  };
}

export interface Montaje {
  sql: ReturnType<typeof abrirEstanteria>;
  ia: InteligenciaConUso;
  contador: ContadorUso;
  embebedor: Embebedor;
  indice: IndiceVectorialSQL;
  redactor: Redactor;
  reordenadores: Record<string, Reordenador>;
  env: Record<string, string>;
}

/** Monta todo. `cache: false` para medir latencias reales. */
export function montar(o: { cache?: boolean } = {}): Montaje {
  const cache = o.cache !== false;
  const env = cargarEntorno(['gemini', 'openrouter', 'typesafe']);
  const cf = join(DIR_DATOS_CALIDAD, '.cf-ai.env');
  if (existsSync(cf)) for (const l of readFileSync(cf, 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]!] = m[2]!; }
  const contador = new ContadorUso();
  const ia = crearInteligencia({ GEMINI_API_KEY: env.GEMINI_API_KEY, OPENROUTER_API_KEY: env.OPENROUTER_API_KEY, TYPESAFE_API_KEY: env.TYPESAFE_API_KEY }, { contador, concurrencia: 32 });
  const sql = abrirEstanteria();
  const embebedor = cache ? embebedorConCache(ia.embebedor) : ia.embebedor;
  const indice = new IndiceVectorialSQL(sql, ia.embebedor.espacio);
  const redactor = cache ? redactorConCache(ia.redactor) : ia.redactor;
  const reordenadores: Record<string, Reordenador> = { jev: ia.reordenador, 'flash-lite': reordenadorConRedactor(ia.redactor) };
  // Jev en peticiones de 10 pasajes en paralelo (unos 70 ms menos que 24 por petición).
  if (env.TYPESAFE_API_KEY) reordenadores.jev10 = crearJev({ clave: env.TYPESAFE_API_KEY, contador, concurrencia: 16 }).reordenador({ pasajesPorPeticion: 10 });
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) {
    const w = crearWorkersAI({ cuenta: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN, contador });
    reordenadores['bge-m3'] = w.reordenador({ modelo: '@cf/baai/bge-m3' });
    reordenadores['bge-base'] = w.reordenador({ modelo: '@cf/baai/bge-reranker-base' });
  }
  if (cache) for (const k of Object.keys(reordenadores)) reordenadores[k] = reordenadorConCache(reordenadores[k]!);
  return { sql, ia, contador, embebedor, indice, redactor, reordenadores, env };
}

/** Un sistema que se evalúa: cómo se monta el buscador y con qué opciones se llama. */
export interface Sistema {
  nombre: string;
  vias: Via[];
  comprender: boolean;
  reordenador?: string;
  opciones?: OpcionesBusqueda;
  ajustes?: AjustesBusqueda;
}

export const SISTEMAS: Sistema[] = [
  { nombre: 'lexica', vias: ['lexica'], comprender: false },
  { nombre: 'densa', vias: ['densa'], comprender: false },
  { nombre: 'visual', vias: ['visual'], comprender: false },
  { nombre: 'hibrida', vias: ['lexica', 'densa', 'visual'], comprender: false },
  { nombre: 'hibrida+comp', vias: ['lexica', 'densa', 'visual'], comprender: true },
  { nombre: 'hibrida+jev', vias: ['lexica', 'densa', 'visual'], comprender: false, reordenador: 'jev' },
  { nombre: 'completa', vias: ['lexica', 'densa', 'visual'], comprender: true, reordenador: 'jev' },
];

export function buscadorPara(m: Montaje, s: Sistema, extra: { plazoComprensionMs?: number } = {}): Buscador {
  const reordenador = s.reordenador ? m.reordenadores[s.reordenador] : undefined;
  if (s.reordenador && !reordenador) throw new Error(`No hay reordenador «${s.reordenador}»`);
  return new Buscador({
    sql: m.sql, embebedor: m.embebedor, indice: m.indice, espacioNombres: 'banco',
    ...(s.comprender ? { redactor: m.redactor } : {}),
    ...(reordenador ? { reordenador } : {}),
  }, { plazoComprensionMs: extra.plazoComprensionMs ?? Number.POSITIVE_INFINITY, ...(s.ajustes ? { ajustes: s.ajustes } : {}) });
}

export function opcionesPara(s: Sistema, limite: number): OpcionesBusqueda {
  return { limite, vias: s.vias, comprender: s.comprender, reordenar: !!s.reordenador, ...s.opciones };
}
