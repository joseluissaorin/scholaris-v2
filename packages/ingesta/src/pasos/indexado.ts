/**
 * Paso de indexado: escribe el documento en una base con el esquema SPDF 4.0
 * (el .spdf o la estantería) y prepara las entradas del índice vectorial.
 */

import { vectorABytes, type Documento, type EntradaIndice, type EspacioVectorial, type SQL, type Vector } from '@scholaris/nucleo';
import type { FragmentoPlano, Procedencia, Seccion, UnidadLeida } from '../tipos.js';
import type { FiguraConAncla } from './figuras.js';
import { nombreCompleto } from './autores.js';

export interface DocumentoIndexable {
  documento: Documento;
  unidades: Array<UnidadLeida & { id: string; imagen?: string; miniatura?: string }>;
  secciones: Seccion[];
  fragmentos: FragmentoPlano[];
  figuras: FiguraConAncla[];
  procedencia: Procedencia[];
}

export async function escribirEspacio(sql: SQL, e: EspacioVectorial): Promise<void> {
  await sql.ejecutar(
    'INSERT OR IGNORE INTO espacios (id, proveedor, modelo, version, dims, normalizado, modalidades, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    e.id, e.proveedor, e.modelo, e.version ?? null, e.dims, e.normalizado ? 1 : 0, JSON.stringify(e.modalidades), new Date().toISOString(),
  );
}

export async function escribirVectores(sql: SQL, documento: string, vectores: Vector[]): Promise<void> {
  await sql.transaccion(async (tx) => {
    for (const v of vectores) {
      await tx.ejecutar('INSERT OR REPLACE INTO vectores (objetivo, id, espacio, documento, valores) VALUES (?, ?, ?, ?, ?)', v.objetivo, v.id, v.espacio, documento, vectorABytes(v.valores));
    }
  });
}

/** Metadatos filtrables de una entrada del índice (solo escalares). */
export function metadatosIndice(doc: Documento, objetivo: Vector['objetivo'], t0?: number): Record<string, string | number | boolean> {
  const m: Record<string, string | number | boolean> = { objetivo, documento: doc.id, tipo: doc.tipo };
  if (doc.metadatos.anio) m.anio = doc.metadatos.anio;
  if (doc.metadatos.idioma) m.idioma = doc.metadatos.idioma;
  if (t0 !== undefined) m.t0 = t0;
  return m;
}

export function entradasIndice(doc: Documento, vectores: Vector[], tiempos?: Map<string, number>): EntradaIndice[] {
  return vectores.map((v) => ({ id: v.id, valores: v.valores, metadatos: metadatosIndice(doc, v.objetivo, tiempos?.get(v.id)) }));
}

export async function escribirDocumento(sql: SQL, d: DocumentoIndexable, opciones: { generador?: string } = {}): Promise<void> {
  const { documento: doc } = d;
  const porOrden = new Map(d.unidades.map((u) => [u.orden, u.id]));
  const idUnidad = (orden: number) => porOrden.get(orden) ?? (d.unidades[0]?.id as string);
  const ahora = new Date().toISOString();
  await sql.transaccion(async (tx) => {
    for (const [clave, valor] of Object.entries({ spdf_version: '4.0', generador: opciones.generador ?? 'scholaris-ingesta', creado: ahora, huella_original: doc.huella })) {
      await tx.ejecutar('INSERT OR REPLACE INTO spdf (clave, valor) VALUES (?, ?)', clave, valor);
    }
    const m = doc.metadatos;
    await tx.ejecutar(
      `INSERT OR REPLACE INTO documentos (id, tipo, metadatos, estado, huella, original, mime, bytes, unidades, duracion, creado, actualizado, bibliotecas, titulo, autores, anio, idioma)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      doc.id, doc.tipo, JSON.stringify(m), doc.estado, doc.huella, doc.original, doc.mime, doc.bytes, doc.unidades, doc.duracion ?? null,
      doc.creado, doc.actualizado, JSON.stringify(doc.bibliotecas), m.titulo, m.autores.map(nombreCompleto).join('; '), m.anio ?? null, m.idioma ?? null,
    );
    for (const u of d.unidades) {
      const a = u.ancla;
      await tx.ejecutar(
        `INSERT OR REPLACE INTO unidades (id, documento, orden, ancla, texto, notas, cabecera, pie, imagen, miniatura, lector, confianza, impresa, t0, t1)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        u.id, doc.id, u.orden, JSON.stringify(a), u.texto, u.notas.length ? JSON.stringify(u.notas) : null, u.cabecera || null, u.pie || null,
        u.imagen ?? null, u.miniatura ?? null, u.lector, u.confianza,
        a?.tipo === 'pagina' ? a.impresa : a?.tipo === 'seccion' ? (a.impresa ?? null) : null,
        u.t0 ?? null, u.t1 ?? null,
      );
    }
    for (const s of d.secciones) {
      await tx.ejecutar(
        'INSERT OR REPLACE INTO secciones (id, documento, padre, nivel, titulo, unidad_desde, unidad_hasta, resumen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        s.id, doc.id, s.padre, s.nivel, s.titulo, idUnidad(s.desde.unidad), idUnidad(s.hasta), null,
      );
    }
    for (const f of d.fragmentos) {
      await tx.ejecutar(
        'INSERT OR REPLACE INTO fragmentos (id, documento, unidad, orden, texto, contexto, seccion, ancla, ancla_fin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        f.id, doc.id, idUnidad(f.unidad), f.orden, f.texto, f.contexto, JSON.stringify(f.seccion), JSON.stringify(f.ancla), f.anclaFin ? JSON.stringify(f.anclaFin) : null,
      );
    }
    for (const g of d.figuras) {
      await tx.ejecutar(
        'INSERT OR REPLACE INTO figuras (id, documento, unidad, imagen, pie, descripcion, ancla) VALUES (?, ?, ?, ?, ?, ?, ?)',
        g.id, doc.id, idUnidad(g.unidad), g.imagen ?? g.parte ?? '', g.pie ?? null, g.descripcion ?? null,
        JSON.stringify(g.region && g.ancla.tipo === 'pagina' ? { ...g.ancla, region: g.region } : g.ancla),
      );
    }
    for (const p of d.procedencia) {
      await tx.ejecutar('INSERT INTO procedencia (documento, fase, proveedor, detalle, ms, cuando) VALUES (?, ?, ?, ?, ?, ?)', doc.id, p.fase, p.proveedor ?? null, p.detalle ? JSON.stringify(p.detalle) : null, Math.round(p.ms), ahora);
    }
  });
}
