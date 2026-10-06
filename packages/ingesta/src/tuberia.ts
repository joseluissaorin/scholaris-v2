/**
 * La tubería por tandas: buscable mientras se lee.
 *
 * En vez de fases en serie (leer todo → folios → fragmentos → contexto →
 * vectores), cada tanda (un pliego de visión, un lote de páginas con capa de
 * texto, un tramo de audio) pasa en cuanto está leída por:
 *
 *   leerTanda ─► indexarTanda: unidades con folio provisional (legibles)
 *                             → fragmentos de la tanda en la estantería (FTS: buscables)
 *                             → línea de contexto (cuando ya hay metadatos)
 *                             → vectores (búsqueda densa)
 *
 * y al final una sola pasada de consolidación:
 *
 *   consolidar: folios definitivos con el deductor global, titulillos, secciones
 *               del documento entero, fragmentos que cruzan tandas (solo se rehacen
 *               las costuras: el troceado corta en el mismo sitio en las dos pasadas),
 *               hablantes en los medios, figuras, documento «listo».
 *
 * Todo el estado entre pasos vive en el puerto SQL (la estantería o el .spdf):
 * las unidades y fragmentos ya escritos, y lo que no cabe en el esquema
 * (folio visto, figuras, palabras de la transcripción) en `blobs`, bajo
 * `trabajo/<documento>/`. Así cada función es un paso de Workflow con entradas y
 * salidas pequeñas, y la cola local llama exactamente a las mismas.
 *
 * Identificadores deterministas: reintentar un paso escribe las mismas filas.
 */

import { enLista, enParalelo, type AnclaPagina, type Documento, type MetadatosDocumento, type PalabraTranscrita, type Vector } from '@scholaris/nucleo';
import type { PaqueteConversion } from '@scholaris/imprenta';
import * as spdf from '@scholaris/spdf';
import type { FragmentoPlano, FuentePaquete, Plan, Procedencia, PuertosIngesta, Seccion, Tanda, UnidadLeida } from './tipos.js';
import { cuerpoDominante, leerCapaPagina, limpiarUnidad, prefijoBasura } from './pasos/capa.js';
import { leerPliego, entradaDePaginas, Cobertura } from './pasos/lectura.js';
import { casarHablantes, segmentarTranscripcion, transcribirTramo } from './pasos/medios.js';
import { unidadesDeBloques } from './pasos/bloques.js';
import { etiquetasInformativas, interpretarFolio, pasoFolios } from './pasos/folios.js';
import { anclarIndice, construirSecciones, pasoEstructura, quitarTitulillos, type EntradaIndice } from './pasos/estructura.js';
import { trocear, fragmentosDeMedio, type OpcionesTroceado } from './pasos/fragmentos.js';
import { pasoMetadatos, refinarConLibroEntero } from './pasos/metadatos.js';
import { contextoExtractivo, pasoContexto } from './pasos/contexto.js';
import { pasoFiguras, type FiguraConAncla } from './pasos/figuras.js';
import { textoVectorizable, vectorizar, type PiezaVector } from './pasos/vectores.js';
import { atribuirHablantes } from './pasos/hablantes.js';
import { revisarTranscripcion, type CambioTranscripcion } from './pasos/revision.js';
import { entradasIndice } from './pasos/indexado.js';

// ---------------------------------------------------------------------------
// Contexto, identificadores y estado de trabajo
// ---------------------------------------------------------------------------

export interface OpcionesTuberia {
  pista?: string;
  troceado?: OpcionesTroceado;
  tramosMedio?: { minimo?: number; objetivo?: number; maximo?: number };
  /** Describir con el Redactor las figuras sin descripción. */
  describirFiguras?: boolean;
  atribuirHablantes?: boolean;
  sinVerificacion?: boolean;
  sinContexto?: boolean;
  metadatosUsuario?: Partial<MetadatosDocumento>;
  bibliotecas?: string[];
  /** Solo la deducción de folios propia (sin `@scholaris/folios` ni juez). */
  foliosPropios?: boolean;
  /** Audio y vídeo: segunda escucha de las frases que suenan a error de reconocimiento (por defecto, sí). */
  revisarTranscripcion?: boolean;
  reloj?: () => number;
}

export interface ContextoTuberia {
  paquete: PaqueteConversion;
  plan: Plan;
  puertos: PuertosIngesta & { sql: NonNullable<PuertosIngesta['sql']> };
  documento: string;
  opciones: OpcionesTuberia;
}

export const idUnidadDe = (doc: string, orden: number) => `${doc}:u${orden}`;

/** Huella corta y estable (FNV-1a de 32 bits) para identificadores deterministas. */
export function huellaCorta(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const prefijoTrabajo = (doc: string) => `trabajo/${doc}/`;
const claveTanda = (doc: string, id: number) => `${prefijoTrabajo(doc)}tanda/${String(id).padStart(5, '0')}.json`;
const claveMetadatos = (doc: string) => `${prefijoTrabajo(doc)}metadatos.json`;

/**
 * Escrituras en serie por base: las tandas corren en paralelo pero comparten
 * conexión (sqlite-wasm, better-sqlite3, el SQL de un Durable Object), y dos
 * transacciones intercaladas en la misma conexión se pisan los «savepoints».
 */
const cerrojos = new WeakMap<object, Promise<unknown>>();
export function escribir<T>(sql: NonNullable<PuertosIngesta['sql']>, fn: (tx: NonNullable<PuertosIngesta['sql']>) => Promise<T>): Promise<T> {
  const previo = cerrojos.get(sql) ?? Promise.resolve();
  const p = previo.catch(() => undefined).then(() => sql.transaccion(fn));
  cerrojos.set(sql, p.catch(() => undefined));
  return p;
}

async function guardarJson(ctx: ContextoTuberia, clave: string, valor: unknown): Promise<void> {
  await escribir(ctx.puertos.sql, (tx) => spdf.ponerBlob(tx, clave, 'application/json', new TextEncoder().encode(JSON.stringify(valor))));
}
async function leerJson<T>(ctx: ContextoTuberia, clave: string): Promise<T | null> {
  const b = await spdf.leerBlob(ctx.puertos.sql, clave);
  return b ? (JSON.parse(new TextDecoder().decode(b.datos)) as T) : null;
}

/** Lo que una tanda deja para la consolidación. */
export interface EstadoTanda {
  tanda: number;
  unidades: UnidadLeida[];
  /** Fragmentos provisionales escritos: id, texto, sección y si ya llevan contexto y vector. */
  fragmentos: Array<{ id: string; texto: string; seccion: string[]; contexto: string; vector: boolean; /** El Redactor ya falló o se atascó con este fragmento: no se reintenta. */ fallo?: boolean }>;
  /** Medios: las palabras del tramo (los hablantes se resuelven al consolidar). */
  palabras?: PalabraTranscrita[];
  idioma?: string;
  procedencia: Procedencia[];
  avisos: string[];
  /** Ya tiene contexto y vectores (o no los tendrá: medios). */
  enriquecida?: boolean;
}

export interface ResumenTanda {
  tanda: number;
  /** Unidades ya legibles (orden base 0, ambos incluidos). */
  legibles: [number, number] | null;
  /** Unidades cuyo texto ya está en el índice léxico. */
  buscables: number;
  fragmentos: number;
  vectores: number;
  ms: number;
}

// ---------------------------------------------------------------------------
// Preparar
// ---------------------------------------------------------------------------

/** Ficha provisional del documento (la de la imprenta), hasta que lleguen los metadatos de verdad. */
export function documentoProvisional(ctx: ContextoTuberia): Documento {
  const { paquete } = ctx;
  const ahora = new Date().toISOString();
  const ficha = paquete.metadatos;
  return {
    id: ctx.documento,
    tipo: paquete.tipo,
    metadatos: { titulo: ficha.titulo?.trim() || paquete.origen.nombre.replace(/\.[^.]+$/, ''), autores: ficha.autores ?? [], ...(ficha.anio ? { anio: ficha.anio } : {}), ...(ficha.idioma ? { idioma: ficha.idioma } : {}) },
    estado: 'procesando',
    huella: paquete.origen.huella,
    original: '',
    mime: paquete.origen.mime,
    bytes: paquete.origen.bytes,
    unidades: ctx.plan.unidades,
    ...(paquete.duracion ? { duracion: paquete.duracion } : {}),
    creado: ahora,
    actualizado: ahora,
    bibliotecas: ctx.opciones.bibliotecas ?? [],
  };
}

/** Paso «preparar»: la fila del documento y los espacios vectoriales. */
export async function prepararDocumento(ctx: ContextoTuberia): Promise<void> {
  const { sql, inteligencia } = ctx.puertos;
  const existente = await spdf.leerDocumento(sql, ctx.documento).catch(() => null);
  await escribir(sql, async (tx) => {
    if (!existente) await spdf.escribirDocumento(tx, documentoProvisional(ctx));
    for (const e of [inteligencia.embebedor, ...(inteligencia.embebedoresExtra ?? [])]) await spdf.escribirEspacio(tx, e.espacio);
  });
}

// ---------------------------------------------------------------------------
// Leer una tanda
// ---------------------------------------------------------------------------

export interface OpcionesLecturaTanda {
  cobertura?: Cobertura;
  /** Resultados ya recogidos de la API por lotes: clave «desde-hasta» → páginas. */
  resultadosLote?: Record<string, import('@scholaris/nucleo').PaginaLeida[]>;
}

export const claveLote = (desde: number, hasta: number) => `${desde}-${hasta}`;

/** Paso «leer tanda»: unidades leídas (y palabras, en medios). No escribe nada. */
export async function leerTanda(t: Tanda, ctx: ContextoTuberia, o: OpcionesLecturaTanda = {}): Promise<{ unidades: UnidadLeida[]; palabras?: PalabraTranscrita[]; idioma?: string; procedencia: Procedencia[]; avisos: string[] }> {
  const { paquete, plan, puertos } = ctx;
  const ia = puertos.inteligencia;
  const reloj = ctx.opciones.reloj ?? Date.now;
  const t0 = reloj();
  const c = paquete.contenido;
  if (t.clase === 'capa' && c.clase === 'pdf') {
    const base = cuerpoDominante(c.paginas);
    const basura = prefijoBasura(c.paginas);
    const unidades = c.paginas.filter((p) => p.fisica >= t.desde && p.fisica <= t.hasta).map((p) => limpiarUnidad(leerCapaPagina(p, p.fisica - 1, base), basura));
    return { unidades, procedencia: [{ fase: 'lectura', proveedor: 'capa-pdf', ms: reloj() - t0, detalle: { tanda: t.id, paginas: unidades.length } }], avisos: [] };
  }
  if (t.clase === 'pliego') {
    const pliego = plan.pliegos.find((p) => p.id === t.pliego);
    if (!pliego) throw new Error(`No existe el pliego ${t.pliego}`);
    const lectores = [ia.lector, ...(ia.lectoresReserva ?? [])];
    // Modo económico: lo fácil, al lector barato; lo difícil ya viene de la API por lotes.
    const delLote = o.resultadosLote?.[claveLote(pliego.desde, pliego.hasta)];
    const primero = delLote
      ? { nombre: `${puertos.lotes?.nombre ?? 'lotes'}`, leerPliego: async () => delLote }
      : pliego.dificultad === 'facil' && puertos.lectorEconomico ? puertos.lectorEconomico : null;
    const r = await leerPliego(pliego, paquete, puertos.fuente, primero ? [primero, ...lectores] : lectores, {
      ...(ctx.opciones.pista ? { pista: ctx.opciones.pista } : {}),
      ...(o.cobertura ? { cobertura: o.cobertura } : {}),
      reloj,
    });
    return { unidades: r.paginas, procedencia: [r.procedencia], avisos: r.avisos };
  }
  if (t.clase === 'tramo') {
    const tramo = plan.tramos.find((x) => x.n === t.tramo);
    if (!tramo) throw new Error(`No existe el tramo ${t.tramo}`);
    const r = await transcribirTramo(tramo, puertos.fuente, ia.transcriptor, { reloj, ...(ctx.opciones.pista ? { pista: ctx.opciones.pista } : {}), ...(o.cobertura ? { cobertura: o.cobertura } : {}) });
    // Unidades provisionales del tramo (se rehacen al consolidar, con los hablantes con nombre).
    // Orden provisional = segundo de inicio: crece de un tramo a otro y no choca (cada unidad dura 30-60 s).
    const unidades = segmentarTranscripcion(r.palabras, ctx.opciones.tramosMedio).map((u) => ({ ...u, orden: Math.floor(u.t0 ?? 0), fisica: Math.floor(u.t0 ?? 0) + 1 }));
    return { unidades, palabras: [...(r.solape ?? []).map((w) => ({ ...w, solape: true })), ...r.palabras] as PalabraTranscrita[], ...(r.idioma ? { idioma: r.idioma } : {}), procedencia: [r.procedencia], avisos: [] };
  }
  // Bloques: el texto ya está en el paquete.
  const unidades = unidadesDeBloques(paquete);
  return { unidades, procedencia: [{ fase: 'lectura', proveedor: 'imprenta', ms: reloj() - t0, detalle: { unidades: unidades.length } }], avisos: [] };
}

// ---------------------------------------------------------------------------
// Indexar una tanda
// ---------------------------------------------------------------------------

/** Folio provisional: la etiqueta del PDF si es informativa; si no, el que se ve. */
export function anclaProvisional(u: UnidadLeida, etiquetasUtiles: boolean): AnclaPagina {
  const et = etiquetasUtiles && u.etiqueta ? interpretarFolio(u.etiqueta) : null;
  if (et && u.etiqueta) return { tipo: 'pagina', fisica: u.fisica, impresa: et.romano ? u.etiqueta.toLowerCase() : u.etiqueta, romana: et.romano, origen: 'deducido', confianza: 0.8 };
  const v = interpretarFolio(u.folioVisto);
  if (v && u.folioVisto) return { tipo: 'pagina', fisica: u.fisica, impresa: v.romano ? u.folioVisto.toLowerCase().trim() : String(v.valor), romana: v.romano, origen: 'leido', confianza: 0.5 };
  return { tipo: 'pagina', fisica: u.fisica, impresa: null, romana: false, origen: 'ninguno', confianza: 0 };
}

/** El índice del PDF como entradas para anclar. */
function indiceDe(paquete: PaqueteConversion): EntradaIndice[] {
  return paquete.contenido.clase === 'pdf' ? paquete.contenido.esquema.map((e) => ({ titulo: e.titulo, nivel: e.nivel, fisica: e.fisica })) : [];
}

/**
 * Secciones de una tanda: si el PDF trae índice, la cadena de secciones abiertas
 * al empezar la tanda (sus títulos, en la unidad inicial) más las entradas que
 * caen dentro; si no, los títulos del texto de la tanda.
 */
export function seccionesDeTanda(unidades: UnidadLeida[], paquete: PaqueteConversion): Seccion[] {
  if (!unidades.length) return [];
  const indice = indiceDe(paquete).filter((e) => e.fisica !== null && e.titulo.trim());
  const u0 = unidades[0] as UnidadLeida;
  const fin = (unidades.at(-1) as UnidadLeida).fisica;
  if (indice.length >= 2) {
    // Secciones abiertas: la última entrada de cada nivel antes de la tanda.
    const abiertas: EntradaIndice[] = [];
    for (const e of indice) {
      if ((e.fisica as number) >= u0.fisica) break;
      while (abiertas.length && (abiertas.at(-1) as EntradaIndice).nivel >= e.nivel) abiertas.pop();
      abiertas.push(e);
    }
    const dentro = indice.filter((e) => (e.fisica as number) >= u0.fisica && (e.fisica as number) <= fin);
    const titulos = [
      ...abiertas.map((e) => ({ unidad: u0.orden, parrafo: 0, nivel: e.nivel, texto: e.titulo })),
      ...anclarIndice(dentro, unidades),
    ];
    return construirSecciones(titulos, (unidades.at(-1) as UnidadLeida).orden + 1);
  }
  return pasoEstructura(unidades, undefined).secciones;
}

/** Escribe los vectores en la estantería y en el índice; devuelve cuántos. */
async function vectorizarYGuardar(ctx: ContextoTuberia, piezas: PiezaVector[], documento: Documento | null, tiempos?: Map<string, number>): Promise<{ n: number; procedencia: Procedencia[] }> {
  if (!piezas.length) return { n: 0, procedencia: [] };
  const ia = ctx.puertos.inteligencia;
  let n = 0;
  const procedencia = await Promise.all([ia.embebedor, ...(ia.embebedoresExtra ?? [])].map((e) => vectorizar(piezas, e, ctx.puertos.fuente, async (vs: Vector[]) => {
    await escribir(ctx.puertos.sql, (tx) => spdf.escribirVectores(tx, vs.map((v) => ({ ...v, documento: ctx.documento }))));
    if (ctx.puertos.indice && documento) await ctx.puertos.indice.insertar(e.espacio, entradasIndice(documento, vs, tiempos));
    n += vs.length;
  }, { concurrencia: 16, loteTexto: 50, loteImagen: 8, ...(ctx.opciones.reloj ? { reloj: ctx.opciones.reloj } : {}) })));
  return { n, procedencia };
}

function aFilaFragmento(doc: string, f: FragmentoPlano, idUnidad: (orden: number) => string) {
  return { id: f.id, documento: doc, unidad: idUnidad(f.unidad), orden: f.orden, texto: f.texto, contexto: f.contexto, seccion: f.seccion, ancla: f.ancla, ...(f.anclaFin ? { anclaFin: f.anclaFin } : {}) };
}

function aFilaUnidad(doc: string, u: UnidadLeida, paquete: PaqueteConversion, id: string) {
  const c = paquete.contenido;
  const pag = c.clase === 'pdf' ? c.paginas[u.fisica - 1] : c.clase === 'imagenes' ? c.paginas[u.fisica - 1] : undefined;
  const diapo = c.clase === 'presentacion' ? c.diapositivas[u.orden] : undefined;
  const imagen = pag?.imagen ?? diapo?.imagen;
  const miniatura = pag?.miniatura;
  return {
    id, documento: doc, orden: u.orden,
    ancla: u.ancla ?? { tipo: 'pagina' as const, fisica: u.fisica, impresa: null, romana: false, origen: 'ninguno' as const, confianza: 0 },
    texto: u.texto, notas: u.notas, lector: u.lector, confianza: u.confianza,
    ...(u.cabecera ? { cabecera: u.cabecera } : {}), ...(u.pie ? { pie: u.pie } : {}),
    ...(imagen ? { imagen } : {}), ...(miniatura ? { miniatura } : {}),
    ...(u.palabras ? { palabras: u.palabras } : {}),
  };
}

/**
 * Paso «indexar tanda»: escribe las unidades (legibles), los fragmentos de la
 * tanda (buscables por texto en cuanto se escriben), y si ya hay metadatos, su
 * contexto y sus vectores. Deja el estado para la consolidación.
 */
export async function indexarTanda(
  t: Tanda,
  lectura: Awaited<ReturnType<typeof leerTanda>>,
  ctx: ContextoTuberia,
  extras: { metadatos?: MetadatosDocumento | null | Promise<MetadatosDocumento | null>; alBuscables?: (r: ResumenTanda) => void } = {},
): Promise<ResumenTanda> {
  const { paquete, plan, puertos, documento } = ctx;
  const reloj = ctx.opciones.reloj ?? Date.now;
  const t0 = reloj();
  const sql = puertos.sql;
  const procedencia = [...lectura.procedencia];
  const unidades = lectura.unidades;
  const medio = t.clase === 'tramo';
  const idU = (orden: number) => (medio ? `${documento}:m${orden}` : idUnidadDe(documento, orden));

  // 1. Unidades con folio provisional: ya se pueden leer.
  if (plan.modo === 'paginas') {
    const etiquetas = paquete.contenido.clase === 'pdf' && etiquetasInformativas(paquete.contenido.paginas.map((p) => ({ fisica: p.fisica, visto: null, etiqueta: p.etiqueta, vacia: false })));
    for (const u of unidades) u.ancla = anclaProvisional(u, etiquetas);
  }
  await escribir(sql, (tx) => spdf.escribirUnidades(tx, unidades.map((u) => aFilaUnidad(documento, u, paquete, idU(u.orden)))));
  const legibles: [number, number] | null = unidades.length ? [Math.min(...unidades.map((u) => u.orden)), Math.max(...unidades.map((u) => u.orden))] : null;

  // 2. Fragmentos de la tanda: buscables por texto en cuanto entran (FTS por disparador).
  let fragmentos: FragmentoPlano[];
  if (medio) fragmentos = fragmentosDeMedio(unidades);
  else fragmentos = trocear(unidades, seccionesDeTanda(unidades, paquete), { ...ctx.opciones.troceado, cortes: unidades.length ? [(unidades[0] as UnidadLeida).orden] : [] });
  fragmentos.forEach((f, i) => { f.id = `${documento}:t${t.id}.${i}`; f.orden = (unidades[0]?.orden ?? 0) * 1000 + i; });
  await escribir(sql, (tx) => spdf.escribirFragmentos(tx, fragmentos.map((f) => aFilaFragmento(documento, f, idU))));
  const buscable: ResumenTanda = { tanda: t.id, legibles, buscables: unidades.length, fragmentos: fragmentos.length, vectores: 0, ms: reloj() - t0 };
  // Estado mínimo ya: la consolidación puede empezar con las unidades mientras se enriquece el resto.
  await guardarJson(ctx, claveTanda(documento, t.id), {
    tanda: t.id, unidades, fragmentos: fragmentos.map((f) => ({ id: f.id, texto: f.texto, seccion: f.seccion, contexto: '', vector: false })),
    ...(lectura.palabras ? { palabras: lectura.palabras } : {}), ...(lectura.idioma ? { idioma: lectura.idioma } : {}),
    procedencia: [...lectura.procedencia], avisos: lectura.avisos, enriquecida: false,
  } satisfies EstadoTanda);
  extras.alBuscables?.(buscable);

  // 3. Contexto y vectores (no en medios: ahí se rehace todo al consolidar, con los hablantes).
  let nVectores = 0;
  const conContexto = new Set<string>();
  const fallidos = new Set<string>();
  // Los metadatos pueden llegar después que la tanda: se esperan aquí, ya con el texto buscable.
  const meta = medio ? null : await Promise.resolve(extras.metadatos ?? null).catch(() => null);
  if (!medio) {
    if (meta && !ctx.opciones.sinContexto && fragmentos.length) {
      const r = await pasoContexto(fragmentos, meta, puertos.inteligencia.redactor, { reloj, limiteMs: 10_000 });
      for (const f of fragmentos) if (!r.contextos[f.id]) fallidos.add(f.id);
      for (const f of fragmentos) if (r.contextos[f.id]) { f.contexto = r.contextos[f.id] as string; conContexto.add(f.id); }
      procedencia.push(r.procedencia);
      await escribir(sql, (tx) => spdf.escribirFragmentos(tx, fragmentos.map((f) => aFilaFragmento(documento, f, idU))));
    }
    const doc = (await spdf.leerDocumento(sql, documento).catch(() => null)) as Documento | null;
    // Sin contexto todavía, los vectores esperan a la consolidación (para no pagarlos dos veces).
    const piezas: PiezaVector[] = (meta || ctx.opciones.sinContexto ? fragmentos : []).map((f) => ({ objetivo: 'fragmento', id: f.id, texto: textoVectorizable(f) }));
    const vista = new Set(plan.paginasImagen.filter((p) => p.fisica >= t.desde && p.fisica <= t.hasta).map((p) => p.fisica));
    for (const u of unidades) {
      const parte = plan.paginasImagen.find((p) => p.fisica === u.fisica)?.parte;
      if (parte && vista.has(u.fisica) && !u.vacia) piezas.push({ objetivo: 'unidad', id: idU(u.orden), parte });
    }
    const v = await vectorizarYGuardar(ctx, piezas, doc);
    nVectores = v.n;
    procedencia.push(...v.procedencia.map((p) => ({ ...p, detalle: { ...p.detalle, tanda: t.id } })));
  }

  // 4. Estado para la consolidación.
  const vectorizados = new Set(!medio && (meta || ctx.opciones.sinContexto) ? fragmentos.map((f) => f.id) : []);
  const estado: EstadoTanda = {
    tanda: t.id,
    unidades,
    fragmentos: fragmentos.map((f) => ({ id: f.id, texto: f.texto, seccion: f.seccion, contexto: f.contexto, vector: vectorizados.has(f.id), ...(fallidos.has(f.id) ? { fallo: true } : {}) })),
    ...(lectura.palabras ? { palabras: lectura.palabras } : {}),
    ...(lectura.idioma ? { idioma: lectura.idioma } : {}),
    procedencia,
    avisos: lectura.avisos,
    enriquecida: true,
  };
  await guardarJson(ctx, claveTanda(documento, t.id), estado);
  return { ...buscable, vectores: nVectores, ms: reloj() - t0 };
}

// ---------------------------------------------------------------------------
// Metadatos tempranos
// ---------------------------------------------------------------------------

/**
 * Paso «metadatos»: con las primeras páginas (o con todo el medio). Escribe la
 * ficha en la fila del documento y la guarda para la consolidación.
 */
export async function metadatosTempranos(ctx: ContextoTuberia, unidades: UnidadLeida[]): Promise<{ metadatos: MetadatosDocumento; hablantes?: Record<string, string>; procedencia: Procedencia[] }> {
  const { paquete, puertos } = ctx;
  const r = await pasoMetadatos(
    {
      ficha: paquete.metadatos,
      nombreArchivo: paquete.origen.nombre,
      tipo: paquete.tipo,
      epub: paquete.contenido.clase === 'documento' && paquete.contenido.formato === 'epub',
      ...(paquete.duracion ? { duracion: paquete.duracion } : {}),
      unidades,
      ...(ctx.opciones.metadatosUsuario ? { usuario: ctx.opciones.metadatosUsuario } : {}),
    },
    { redactor: puertos.inteligencia.redactor, ...(puertos.http ? { http: puertos.http } : {}), ...(puertos.correoContacto ? { correo: puertos.correoContacto } : {}), ...(ctx.opciones.reloj ? { reloj: ctx.opciones.reloj } : {}) },
    { ...(ctx.opciones.sinVerificacion ? { sinVerificacion: true } : {}) },
  );
  await guardarJson(ctx, claveMetadatos(ctx.documento), r);
  const doc = (await spdf.leerDocumento(puertos.sql, ctx.documento).catch(() => null)) as Documento | null;
  await escribir(puertos.sql, (tx) => spdf.escribirDocumento(tx, { ...(doc ?? documentoProvisional(ctx)), metadatos: r.metadatos, actualizado: new Date().toISOString() }));
  return r;
}

// ---------------------------------------------------------------------------
// Consolidar
// ---------------------------------------------------------------------------

export interface ResultadoConsolidacion {
  documento: Documento;
  unidades: Array<UnidadLeida & { id: string }>;
  secciones: Seccion[];
  fragmentos: FragmentoPlano[];
  figuras: FiguraConAncla[];
  procedencia: Procedencia[];
  avisos: string[];
  vectores: Record<string, number>;
  /** Cuántos fragmentos provisionales se reaprovecharon tal cual (contexto y vector incluidos). */
  reaprovechados: number;
  /** Medios: frases corregidas por la segunda escucha (antes y después). */
  cambiosTranscripcion: CambioTranscripcion[];
  tiempos: Record<string, number>;
}

/**
 * Paso «consolidar»: el documento entero, una vez. Folios definitivos, secciones,
 * costuras entre tandas, hablantes, figuras; reaprovecha todo fragmento
 * provisional que salga igual y rehace solo los demás.
 */
export async function consolidar(
  ctx: ContextoTuberia,
  extras: {
    metadatos?: MetadatosDocumento | null | Promise<MetadatosDocumento | null>;
    /**
     * Orquestador local: la consolidación empieza en cuanto todo está LEÍDO (folios,
     * secciones, troceado, figuras) y espera aquí a que las tandas terminen de
     * enriquecerse antes de reaprovechar sus contextos y vectores.
     */
    esperarTandas?: Promise<unknown>;
  } = {},
): Promise<ResultadoConsolidacion> {
  const { paquete, plan, puertos, documento } = ctx;
  const sql = puertos.sql;
  const ia = puertos.inteligencia;
  const reloj = ctx.opciones.reloj ?? Date.now;
  const tiempos: Record<string, number> = {};
  const marca = (k: string, t: number) => { tiempos[k] = reloj() - t; };
  const procedencia: Procedencia[] = [];
  const avisos: string[] = [...paquete.avisos, ...plan.notas];

  // Estado de las tandas.
  const estados: EstadoTanda[] = [];
  for (const t of [...plan.tandas].sort((a, b) => a.id - b.id)) {
    const e = await leerJson<EstadoTanda>(ctx, claveTanda(documento, t.id));
    if (!e) throw new Error(`Falta la tanda ${t.id}: hay que leerla antes de consolidar`);
    estados.push(e);
    procedencia.push(...e.procedencia);
    avisos.push(...e.avisos);
  }
  const provisionales = estados.flatMap((e) => e.fragmentos);
  const medio = plan.modo === 'medio';

  let cambiosTranscripcion: CambioTranscripcion[] = [];
  let refinada: Promise<{ metadatos: MetadatosDocumento; procedencia: Procedencia[] } | null> | null = null;
  // Metadatos (si no llegaron antes).
  let tm = reloj();
  let meta = (await Promise.resolve(extras.metadatos ?? null).catch(() => null)) ?? (await leerJson<{ metadatos: MetadatosDocumento; hablantes?: Record<string, string> }>(ctx, claveMetadatos(documento)))?.metadatos ?? null;
  let unidades: UnidadLeida[];
  let palabras: PalabraTranscrita[] = [];
  if (medio) {
    // Se casan las etiquetas entre tramos por el solape y se rehace la transcripción entera.
    const tramos = estados.map((e, i) => {
      const ws = (e.palabras ?? []) as Array<PalabraTranscrita & { solape?: boolean }>;
      return { n: plan.tramos[i]?.n ?? i, palabras: ws.filter((w) => !w.solape), solape: ws.filter((w) => w.solape).map(({ solape: _s, ...w }) => w) };
    });
    casarHablantes(tramos);
    palabras = tramos.flatMap((x) => x.palabras).sort((a, b) => a.t0 - b.t0);
    unidades = segmentarTranscripcion(palabras, ctx.opciones.tramosMedio);
  } else unidades = estados.flatMap((e) => e.unidades).sort((a, b) => a.fisica - b.fisica);
  unidades.forEach((u, i) => { u.orden = i; });
  if (!meta) {
    const idioma = estados.map((e) => e.idioma).find(Boolean);
    const r = await metadatosTempranos(ctx, medio ? unidades : unidades.slice(0, 5));
    meta = r.metadatos;
    if (idioma && !meta.idioma) meta.idioma = idioma;
    procedencia.push(...r.procedencia);
  } else if (!medio && unidades.length > 5) {
    // Con el libro entero: créditos y colofón del final (edición, pie de imprenta, «s. f.»).
    const { paquete, puertos: p } = ctx;
    // En paralelo con el resto de la consolidación: la ficha refinada solo hace falta al escribir el documento.
    refinada = refinarConLibroEntero(meta, {
      ficha: paquete.metadatos, nombreArchivo: paquete.origen.nombre, tipo: paquete.tipo, epub: paquete.contenido.clase === 'documento' && paquete.contenido.formato === 'epub',
      unidades: unidades.slice(0, 5), todas: [...unidades], ...(ctx.opciones.metadatosUsuario ? { usuario: ctx.opciones.metadatosUsuario } : {}),
    }, { redactor: ia.redactor, ...(p.http ? { http: p.http } : {}), ...(p.correoContacto ? { correo: p.correoContacto } : {}), reloj }, { ...(ctx.opciones.sinVerificacion ? { sinVerificacion: true } : {}) }).catch(() => null);
  }
  marca('metadatos', tm);

  // Segunda escucha de lo que suena a error de reconocimiento (medios).
  if (medio && ctx.opciones.revisarTranscripcion !== false && palabras.length) {
    tm = reloj();
    const r = await revisarTranscripcion(palabras, plan.tramos, puertos.fuente, meta, ia.redactor, { reloj, concurrencia: 8 }).catch(() => null);
    if (r) {
      procedencia.push(r.procedencia);
      if (r.cambios.length) {
        palabras = r.palabras;
        unidades = segmentarTranscripcion(palabras, ctx.opciones.tramosMedio).map((u, i) => ({ ...u, orden: i }));
        cambiosTranscripcion = r.cambios;
      }
    }
    marca('revision', tm);
  }

  // Hablantes con nombre (medios).
  if (medio && ctx.opciones.atribuirHablantes !== false && palabras.length) {
    tm = reloj();
    const r = await atribuirHablantes(palabras, meta, ia.redactor, { reloj, concurrencia: plan.concurrencia });
    procedencia.push(r.procedencia);
    if (r.reparto.length) unidades = segmentarTranscripcion(r.palabras, ctx.opciones.tramosMedio).map((u, i) => ({ ...u, orden: i }));
    marca('hablantes', tm);
  }

  // Folios definitivos, titulillos y secciones del documento entero.
  tm = reloj();
  if (plan.modo === 'paginas') {
    const quitados = quitarTitulillos(unidades);
    if (quitados) procedencia.push({ fase: 'lectura', proveedor: 'titulillos', ms: 0, detalle: { quitados } });
    const r = await pasoFolios(unidades, { ...(ctx.opciones.foliosPropios ? { propio: true } : { juez: ia.juez }), reloj });
    unidades.forEach((u, i) => { u.ancla = r.anclas[i]; });
    procedencia.push(r.procedencia);
  }
  marca('folios', tm);
  tm = reloj();
  const est = medio ? { secciones: [] as Seccion[], procedencia: { fase: 'estructura' as const, proveedor: 'medio', ms: 0 } } : pasoEstructura(unidades, plan.modo === 'paginas' ? indiceDe(paquete) : undefined, { reloj });
  procedencia.push(est.procedencia);
  // Los cortes de las tandas: las costuras se rehacen, lo de dentro sale igual que en la tanda.
  const cortes = plan.modo === 'paginas' ? plan.tandas.map((t) => t.desde - 1) : [];
  let finales = medio ? fragmentosDeMedio(unidades) : trocear(unidades, est.secciones, { ...ctx.opciones.troceado, cortes });
  marca('estructura', tm);

  // Las figuras no dependen de nada más: se empiezan ya.
  const figurasP = pasoFiguras(paquete, unidades, puertos.fuente, ia.redactor, { reloj, describir: ctx.opciones.describirFiguras !== false, ...(meta.idioma ? { idioma: meta.idioma } : {}), contexto: `«${meta.titulo}»` });
  figurasP.catch(() => undefined);

  // Lo que no existía en ninguna tanda (las costuras; en los medios, todo) se empieza ya:
  // su contexto y sus vectores no dependen de que las tandas terminen de enriquecerse.
  const textosProvisionales = new Set(provisionales.map((p) => p.texto));
  const nuevos = new Set(finales.filter((f) => medio || !textosProvisionales.has(f.texto)));
  finales.forEach((f, i) => { f.orden = i; if (nuevos.has(f)) f.id = `${documento}:c${huellaCorta(`${i}|${f.seccion.join('›')}|${f.texto}`)}`; });
  const tiemposVector = new Map<string, number>();
  for (const f of finales) if (f.ancla.tipo === 'tiempo') tiemposVector.set(f.id, f.ancla.t0);
  const metaFija = meta;
  const adelanto = (async () => {
    const lista = [...nuevos];
    if (!lista.length) return;
    const t = reloj();
    if (!ctx.opciones.sinContexto) {
      const r = await pasoContexto(lista, metaFija, ia.redactor, { concurrencia: plan.concurrencia, reloj, limiteMs: 20_000 });
      let extractivos = 0;
      for (const f of lista) {
        f.contexto = r.contextos[f.id] ?? '';
        if (!f.contexto) { f.contexto = contextoExtractivo(f, metaFija); extractivos++; }
      }
      procedencia.push({ ...r.procedencia, detalle: { ...r.procedencia.detalle, extractivos, que: 'nuevos' } });
    }
    const doc = { ...documentoProvisional(ctx), metadatos: metaFija };
    const v = await vectorizarYGuardar(ctx, lista.map((f) => ({ objetivo: 'fragmento' as const, id: f.id, texto: textoVectorizable(f) })), doc, tiemposVector);
    procedencia.push(...v.procedencia.map((p) => ({ ...p, detalle: { ...p.detalle, que: 'fragmentos-nuevos' } })));
    marca('nuevos', t);
  })();
  adelanto.catch(() => undefined);

  // Reconciliar con los provisionales, ya enriquecidos: mismo texto y sección → mismo id, contexto y vectores.
  if (extras.esperarTandas) {
    tm = reloj();
    await extras.esperarTandas.catch(() => undefined);
    provisionales.length = 0;
    for (const t of [...plan.tandas].sort((a, b) => a.id - b.id)) {
      const e = await leerJson<EstadoTanda>(ctx, claveTanda(documento, t.id));
      if (e) { provisionales.push(...e.fragmentos); if (e.enriquecida) procedencia.push(...e.procedencia.slice(estados.find((x) => x.tanda === e.tanda)?.procedencia.length ?? 0)); }
    }
    marca('esperaTandas', tm);
  }
  // Clave: el texto. Si solo cambia la sección (un libro sin índice, cuya tanda no veía el título
  // de capítulo de páginas anteriores), se conserva el contexto y solo se vuelve a vectorizar.
  const porClave = new Map(provisionales.map((p) => [p.texto, p]));
  const usados = new Set<string>();
  const pendientesContexto: FragmentoPlano[] = [];
  const pendientesVector = new Set<string>();
  let reaprovechados = 0;
  finales.forEach((f, i) => {
    if (nuevos.has(f)) return;
    const p = medio ? undefined : porClave.get(f.texto);
    if (p && !usados.has(p.id)) {
      usados.add(p.id);
      f.id = p.id;
      f.contexto = p.contexto;
      const mismaSeccion = p.seccion.join('›') === f.seccion.join('›');
      // Si el Redactor ya falló con él en la tanda, no se vuelve a intentar: línea extractiva.
      if (!p.contexto && p.fallo) f.contexto = contextoExtractivo(f, meta as MetadatosDocumento);
      else if (!p.contexto) pendientesContexto.push(f);
      if (!p.vector || !p.contexto || !mismaSeccion) pendientesVector.add(f.id);
      else reaprovechados++;
    } else {
      f.id = `${documento}:c${huellaCorta(`${i}|${f.seccion.join('›')}|${f.texto}`)}`;
      pendientesContexto.push(f);
      pendientesVector.add(f.id);
    }
  });

  // Contexto solo de lo nuevo.
  tm = reloj();
  if (!ctx.opciones.sinContexto && pendientesContexto.length) {
    const r = await pasoContexto(pendientesContexto, meta, ia.redactor, { concurrencia: plan.concurrencia, reloj, limiteMs: 20_000 });
    let extractivos = 0;
    for (const f of pendientesContexto) {
      f.contexto = r.contextos[f.id] ?? '';
      // Lo que el modelo no sitúa (filtro de seguridad, reserva lenta) se sitúa con la ficha.
      if (!f.contexto) { f.contexto = contextoExtractivo(f, meta); extractivos++; }
    }
    procedencia.push({ ...r.procedencia, detalle: { ...r.procedencia.detalle, extractivos } });
  }
  marca('contexto', tm);

  await adelanto;
  // Escribir: unidades definitivas, secciones, fragmentos (orden final), fuera los provisionales sobrantes.
  tm = reloj();
  const idUnidad = (orden: number) => idUnidadDe(documento, orden);
  const sobrantes = provisionales.map((p) => p.id).filter((id) => !usados.has(id));
  const ahora = new Date().toISOString();
  if (refinada) {
    const r = await refinada;
    if (r) { meta = r.metadatos; procedencia.push(...r.procedencia); }
  }
  const documentoFinal: Documento = { ...documentoProvisional(ctx), metadatos: meta, estado: 'listo', unidades: unidades.length, actualizado: ahora };
  await escribir(sql, async (tx) => {
    // Un solo parámetro JSON por lista: D1 y los Durable Objects admiten 100 parámetros por sentencia.
    for (let i = 0; i < sobrantes.length; i += 500) {
      const l = enLista(sobrantes.slice(i, i + 500));
      await tx.ejecutar(`DELETE FROM fragmentos WHERE id IN ${l.sql}`, l.param);
      await tx.ejecutar(`DELETE FROM vectores WHERE objetivo = 'fragmento' AND id IN ${l.sql}`, l.param);
    }
    if (medio) {
      // Las unidades provisionales de los tramos se sustituyen por las definitivas.
      await tx.ejecutar("DELETE FROM unidades WHERE documento = ? AND id LIKE ?", documento, `${documento}:m%`);
    }
    await tx.ejecutar('DELETE FROM secciones WHERE documento = ?', documento);
    await spdf.escribirDocumento(tx, documentoFinal);
    await spdf.escribirUnidades(tx, unidades.map((u) => aFilaUnidad(documento, u, paquete, idUnidad(u.orden))));
    await spdf.escribirSecciones(tx, est.secciones.map((s) => ({ id: s.id, documento, padre: s.padre, nivel: s.nivel, titulo: s.titulo, unidadDesde: idUnidad(s.desde.unidad), unidadHasta: idUnidad(s.hasta) })));
    await spdf.escribirFragmentos(tx, finales.map((f) => aFilaFragmento(documento, f, idUnidad)));
  });
  if (puertos.indice?.borrar && sobrantes.length) {
    for (const e of [ia.embebedor, ...(ia.embebedoresExtra ?? [])]) await puertos.indice.borrar(e.espacio, sobrantes).catch(() => undefined);
  }
  marca('escritura', tm);

  // Vectores de lo nuevo, figuras (y sus vectores), y en medios, fotogramas.
  tm = reloj();
  const vf = await vectorizarYGuardar(ctx, finales.filter((f) => pendientesVector.has(f.id)).map((f) => ({ objetivo: 'fragmento' as const, id: f.id, texto: textoVectorizable(f) })), documentoFinal, tiemposVector);
  procedencia.push(...vf.procedencia.map((p) => ({ ...p, detalle: { ...p.detalle, que: 'fragmentos-consolidacion' } })));
  const fig = await figurasP;
  procedencia.push(fig.procedencia);
  for (const g of fig.figuras) if (g.t !== undefined) tiemposVector.set(g.id, g.t);
  const piezasFig: PiezaVector[] = fig.figuras
    .filter((f) => (f.t !== undefined && f.parte) || (f.region && f.parte && puertos.fuente.recorte))
    .map((f) => (f.t !== undefined ? { objetivo: 'figura', id: f.id, parte: f.parte as string } : { objetivo: 'figura', id: f.id, recorte: { parte: f.parte as string, region: f.region as NonNullable<typeof f.region> } }));
  const vg = await vectorizarYGuardar(ctx, piezasFig, documentoFinal, tiemposVector);
  procedencia.push(...vg.procedencia.map((p) => ({ ...p, detalle: { ...p.detalle, que: 'figuras' } })));
  // Vista de diapositivas (bloques): no hay tandas de páginas que la hayan hecho.
  if (plan.modo === 'bloques' && plan.paginasImagen.length) {
    const vv = await vectorizarYGuardar(ctx, plan.paginasImagen.map((p) => ({ objetivo: 'unidad' as const, id: idUnidad(p.fisica - 1), parte: p.parte })), documentoFinal);
    procedencia.push(...vv.procedencia);
  }
  await escribir(sql, (tx) => spdf.escribirFiguras(tx, fig.figuras.map((g) => ({
    id: g.id, documento, unidad: idUnidad(g.unidad), imagen: g.imagen ?? g.parte ?? '',
    ...(g.pie ? { pie: g.pie } : {}), ...(g.descripcion ? { descripcion: g.descripcion } : {}), ancla: g.ancla,
  }))));
  marca('vectores', tm);

  // Procedencia, cuenta de vectores y fuera el estado de trabajo.
  const cuenta = await sql.ejecutar<{ espacio: string; n: number }>('SELECT espacio, count(*) AS n FROM vectores WHERE documento = ? GROUP BY espacio', documento);
  const vectores = Object.fromEntries(cuenta.map((c) => [c.espacio, Number(c.n)]));
  procedencia.push({ fase: 'indexado', proveedor: 'tuberia', ms: 0, detalle: { tandas: plan.tandas.length, reaprovechados, rehechos: finales.length - reaprovechados, sobrantes: sobrantes.length, tiempos, vectores } });
  await escribir(sql, async (tx) => {
    await tx.ejecutar('DELETE FROM procedencia WHERE documento = ?', documento);
    for (const p of procedencia) await spdf.registrarProcedencia(tx, { documento, fase: p.fase, proveedor: p.proveedor ?? null, detalle: p.detalle, ms: Math.round(p.ms), cuando: ahora });
    await tx.ejecutar('DELETE FROM blobs WHERE substr(clave, 1, length(?)) = ?', prefijoTrabajo(documento), prefijoTrabajo(documento));
  });

  return {
    documento: documentoFinal,
    unidades: unidades.map((u) => ({ ...u, id: idUnidad(u.orden) })),
    secciones: est.secciones,
    fragmentos: finales,
    figuras: fig.figuras,
    procedencia,
    avisos,
    vectores,
    reaprovechados,
    cambiosTranscripcion,
    tiempos,
  };
}

// ---------------------------------------------------------------------------
// Modo económico: la API por lotes
// ---------------------------------------------------------------------------

/** Paso «enviar lote»: las tandas difíciles, de golpe, a la API por lotes. Devuelve el id del trabajo. */
export async function enviarLote(ctx: ContextoTuberia): Promise<string | null> {
  const { lotes } = ctx.puertos;
  if (!lotes) return null;
  const dificiles = ctx.plan.pliegos.filter((p) => p.dificultad !== 'facil' || !ctx.puertos.lectorEconomico);
  if (!dificiles.length) return null;
  const peticiones = await enParalelo(dificiles, 8, async (p) => ({
    clave: claveLote(p.desde, p.hasta),
    entrada: { ...(await entradaDePaginas(ctx.paquete, ctx.puertos.fuente as FuentePaquete, p.desde, p.hasta, p.envio)), ...(ctx.opciones.pista ? { pista: ctx.opciones.pista } : {}) },
  }));
  return lotes.enviar(peticiones);
}

/** ¿Ya está el lote? Si sí, sus resultados (lo que falte se lee en línea al procesar la tanda). */
export async function recogerLote(ctx: ContextoTuberia, id: string): Promise<{ listo: boolean; resultados?: Record<string, import('@scholaris/nucleo').PaginaLeida[]>; error?: string }> {
  const r = await (ctx.puertos.lotes as NonNullable<PuertosIngesta['lotes']>).consultar(id);
  if (r.estado === 'pendiente') return { listo: false };
  return { listo: true, ...(r.resultados ? { resultados: r.resultados } : {}), ...(r.error ? { error: r.error } : {}) };
}

