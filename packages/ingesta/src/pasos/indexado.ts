/**
 * Paso de indexado: escribe el documento en una base con el esquema SPDF 4.0
 * (el .spdf o la estantería) y prepara las entradas del índice vectorial.
 */

import * as spdf from '@scholaris/spdf';
import { type Documento, type EntradaIndice, type EspacioVectorial, type SQL, type Vector } from '@scholaris/nucleo';
import type { FragmentoPlano, Procedencia, Seccion, UnidadLeida } from '../tipos.js';
import type { FiguraConAncla } from './figuras.js';

export interface DocumentoIndexable {
  documento: Documento;
  unidades: Array<UnidadLeida & { id: string; imagen?: string; miniatura?: string }>;
  secciones: Seccion[];
  fragmentos: FragmentoPlano[];
  figuras: FiguraConAncla[];
  procedencia: Procedencia[];
}

export async function escribirEspacio(sql: SQL, e: EspacioVectorial): Promise<void> {
  await spdf.escribirEspacio(sql, e);
}

export async function escribirVectores(sql: SQL, documento: string, vectores: Vector[]): Promise<void> {
  await sql.transaccion((tx) => spdf.escribirVectores(tx, vectores.map((v) => ({ ...v, documento }))));
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
    for (const [clave, valor] of Object.entries({ generador: opciones.generador ?? 'scholaris-nube/ingesta 0.2', ingesta: ahora, huella_original: doc.huella })) {
      await spdf.ponerClave(tx, clave, valor);
    }
    await spdf.escribirDocumento(tx, doc);
    await spdf.escribirUnidades(tx, d.unidades.map((u) => ({
      id: u.id, documento: doc.id, orden: u.orden,
      ancla: u.ancla ?? { tipo: 'pagina', fisica: u.fisica, impresa: null, romana: false, origen: 'ninguno', confianza: 0 },
      texto: u.texto, notas: u.notas, lector: u.lector, confianza: u.confianza,
      ...(u.cabecera ? { cabecera: u.cabecera } : {}), ...(u.pie ? { pie: u.pie } : {}),
      ...(u.imagen ? { imagen: u.imagen } : {}), ...(u.miniatura ? { miniatura: u.miniatura } : {}),
    })));
    await spdf.escribirSecciones(tx, d.secciones.map((s) => ({ id: s.id, documento: doc.id, padre: s.padre, nivel: s.nivel, titulo: s.titulo, unidadDesde: idUnidad(s.desde.unidad), unidadHasta: idUnidad(s.hasta) })));
    await spdf.escribirFragmentos(tx, d.fragmentos.map((f) => ({
      id: f.id, documento: doc.id, unidad: idUnidad(f.unidad), orden: f.orden, texto: f.texto, contexto: f.contexto, seccion: f.seccion, ancla: f.ancla,
      ...(f.anclaFin ? { anclaFin: f.anclaFin } : {}),
    })));
    await spdf.escribirFiguras(tx, d.figuras.map((g) => ({
      id: g.id, documento: doc.id, unidad: idUnidad(g.unidad), imagen: g.imagen ?? g.parte ?? '',
      ...(g.pie ? { pie: g.pie } : {}), ...(g.descripcion ? { descripcion: g.descripcion } : {}),
      ancla: g.ancla,
    })));
    for (const p of d.procedencia) await spdf.registrarProcedencia(tx, { documento: doc.id, fase: p.fase, proveedor: p.proveedor ?? null, detalle: p.detalle, ms: Math.round(p.ms), cuando: ahora });
  });
}
