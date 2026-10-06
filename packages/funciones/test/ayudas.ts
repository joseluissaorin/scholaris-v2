/** Ayudas de prueba: estantería en memoria (better-sqlite3, con FTS5) y puertos falsos. */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  normalizarVector,
  vectorABytes,
  type Ancla,
  type Embebedor,
  type EspacioVectorial,
  type Juez,
  type MetadatosDocumento,
  type Redactor,
  type Reordenador,
  type SQL,
  type ValorSQL,
} from '@scholaris/nucleo';
import { aplicarEsquemaFunciones } from '../src/esquema.js';
import type { PuertosFunciones } from '../src/puertos.js';

const RUTA_ESQUEMA = fileURLToPath(new URL('../../spdf/esquema/v4.0.sql', import.meta.url));

function aParametro(v: ValorSQL): unknown {
  if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  return v;
}

/** Adaptador del puerto SQL sobre better-sqlite3 (como el de apps/local). */
export function sqlMemoria(db = new Database(':memory:')): SQL & { db: Database.Database } {
  let profundidad = 0;
  const sql: SQL & { db: Database.Database } = {
    db,
    async ejecutar<T>(consulta: string, ...p: ValorSQL[]): Promise<T[]> {
      const st = db.prepare(consulta);
      const params = p.map(aParametro);
      if (st.reader) return st.all(...params) as T[];
      st.run(...params);
      return [];
    },
    async transaccion<T>(fn: (s: SQL) => Promise<T>): Promise<T> {
      if (profundidad > 0) return fn(sql);
      profundidad++;
      db.exec('BEGIN');
      try {
        const r = await fn(sql);
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        profundidad--;
      }
    },
  };
  return sql;
}

/** Estantería vacía con el esquema SPDF 4.0 y el de las funciones. */
export async function estanteria() {
  const sql = sqlMemoria();
  sql.db.exec(readFileSync(RUTA_ESQUEMA, 'utf8'));
  await aplicarEsquemaFunciones(sql);
  return sql;
}

export const ESPACIO: EspacioVectorial = {
  id: 'prueba@16',
  proveedor: 'prueba',
  modelo: 'bolsa-de-palabras',
  dims: 16,
  normalizado: true,
  modalidades: ['texto'],
};

/** Vector determinista de bolsa de palabras: textos con palabras comunes quedan cerca. */
export function vectorDeTexto(texto: string, dims = ESPACIO.dims): Float32Array {
  const v = new Float32Array(dims);
  for (const p of texto.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/\p{L}{3,}/gu) ?? []) {
    let h = 2166136261;
    for (const c of p) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    v[(h >>> 0) % dims]! += 1;
  }
  return normalizarVector(v);
}

export function embebedorFalso(): Embebedor {
  return {
    espacio: ESPACIO,
    admite: (m) => m === 'texto',
    async vectorizar(piezas) {
      return piezas.map((p) => vectorDeTexto(p.modalidad === 'texto' ? p.texto : ''));
    },
  };
}

export function redactorFalso(responder: (texto: string, esquema?: Record<string, unknown>) => unknown): Redactor & { llamadas: number } {
  const r = {
    nombre: 'redactor-falso',
    llamadas: 0,
    async generar<T>(p: Parameters<Redactor['generar']>[0]) {
      r.llamadas++;
      const texto = p.mensajes.flatMap((m) => m.partes.map((x) => ('texto' in x ? x.texto : ''))).join('\n');
      const json = responder(texto, p.esquema) as T;
      return { texto: typeof json === 'string' ? json : JSON.stringify(json), json };
    },
  };
  return r;
}

export function juezFalso(decidir: (estado: unknown, clave: string) => number = () => 0.9): Juez {
  return {
    nombre: 'juez-falso',
    async juzgar(estado, preguntas) {
      const out: Record<string, any> = {};
      for (const [k, q] of Object.entries(preguntas)) {
        const p = decidir(estado, k);
        if (q.tipo === 'si_no') out[k] = { tipo: 'si_no', probabilidad: p };
        else if (q.tipo === 'eleccion') {
          const claves = Object.keys(q.opciones);
          const probabilidades = Object.fromEntries(claves.map((c, i) => [c, i === 0 ? p : (1 - p) / Math.max(1, claves.length - 1)]));
          out[k] = { tipo: 'eleccion', probabilidades, eleccion: claves[0] };
        } else out[k] = { tipo: 'escala', valor: p, probabilidades: [] };
      }
      return out;
    },
  };
}

export function reordenadorFalso(): Reordenador {
  return {
    nombre: 'reordenador-falso',
    async reordenar(consulta, textos) {
      const q = vectorDeTexto(consulta);
      return textos.map((t) => {
        const v = vectorDeTexto(t);
        let s = 0;
        for (let i = 0; i < v.length; i++) s += v[i]! * q[i]!;
        return s;
      });
    },
  };
}

export interface DocPrueba {
  id: string;
  titulo: string;
  autores?: Array<[string, string]>;
  anio?: number;
  doi?: string;
  idioma?: string;
  tipo?: string;
  bibliotecas?: string[];
  /** Un texto por página; cada página da un fragmento. */
  paginas: string[];
  seccionPagina?: (i: number) => string[];
  conVectores?: boolean;
}

/** Siembra un documento con sus unidades, fragmentos y (opcionalmente) vectores. */
export async function sembrar(sql: SQL, d: DocPrueba): Promise<void> {
  const m: MetadatosDocumento = {
    titulo: d.titulo,
    autores: (d.autores ?? []).map(([nombre, apellidos]) => ({ nombre, apellidos })),
    ...(d.anio ? { anio: d.anio } : {}),
    ...(d.doi ? { doi: d.doi } : {}),
    ...(d.idioma ? { idioma: d.idioma } : {}),
  };
  const ahora = new Date().toISOString();
  await sql.ejecutar(
    `INSERT INTO documentos (id, tipo, metadatos, estado, huella, original, mime, bytes, unidades, creado, actualizado, bibliotecas, titulo, autores, anio, idioma)
     VALUES (?, ?, ?, 'listo', ?, '', 'application/pdf', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.id, d.tipo ?? 'pdf', JSON.stringify(m), 'h-' + d.id, 1000 * d.paginas.length, d.paginas.length, ahora, ahora,
    JSON.stringify(d.bibliotecas ?? []), d.titulo, m.autores.map((a) => a.apellidos).join('; '), d.anio ?? null, d.idioma ?? null,
  );
  await sql.ejecutar(
    `INSERT OR IGNORE INTO espacios (id, proveedor, modelo, dims, normalizado, modalidades) VALUES (?, ?, ?, ?, 1, '["texto"]')`,
    ESPACIO.id, ESPACIO.proveedor, ESPACIO.modelo, ESPACIO.dims,
  );
  for (let i = 0; i < d.paginas.length; i++) {
    const ancla: Ancla = { tipo: 'pagina', fisica: i + 1, impresa: String(i + 11), romana: false, origen: 'leido', confianza: 1 };
    const u = `${d.id}-u${i + 1}`;
    await sql.ejecutar(
      `INSERT INTO unidades (id, documento, orden, ancla, texto, lector, confianza, impresa) VALUES (?, ?, ?, ?, ?, 'prueba', 1, ?)`,
      u, d.id, i, JSON.stringify(ancla), d.paginas[i]!, String(i + 11),
    );
    const f = `${d.id}-f${i + 1}`;
    await sql.ejecutar(
      `INSERT INTO fragmentos (id, documento, unidad, orden, texto, contexto, seccion, ancla) VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
      f, d.id, u, i, d.paginas[i]!, JSON.stringify(d.seccionPagina?.(i) ?? []), JSON.stringify(ancla),
    );
    if (d.conVectores !== false) {
      await sql.ejecutar(
        'INSERT INTO vectores (objetivo, id, espacio, documento, valores) VALUES (?, ?, ?, ?, ?)',
        'fragmento', f, ESPACIO.id, d.id, vectorABytes(vectorDeTexto(d.paginas[i]!)),
      );
    }
  }
}

export function puertos(sql: SQL, extra: Partial<PuertosFunciones> = {}): PuertosFunciones {
  return { sql, usuario: { id: 'u1', pro: false }, ...extra };
}
