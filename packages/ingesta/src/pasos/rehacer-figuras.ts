/**
 * Rehacer solo las figuras de un documento ya leído, sin volver a leer el texto.
 *
 * - Páginas (libros, artículos, escaneos, diapositivas): las imágenes de página
 *   ya guardadas van al modelo de visión por lotes; devuelve cada figura con su
 *   región (0-1), su pie impreso y lo que se ve. Se casan con las figuras que ya
 *   había (por región, por pie o por posición) para conservar sus ids.
 * - Fotogramas (vídeo): no hay que buscarlos (ya están guardados); se describen
 *   los que no tienen descripción, se vectorizan los que no tienen vector y los
 *   cambios de escena se deducen de la distancia entre los vectores de
 *   fotogramas seguidos.
 *
 * Con `simular`, no llama a ningún modelo: cuenta páginas, lotes y llamadas para
 * estimar el coste. La región y la escena se guardan en `figuras.ancla`
 * (`anclaGuardada`, ver figuras.ts).
 */

import { enParalelo, nuevoId, reintentar, type Ancla, type Embebedor, type Redactor, type SQL, type Vector } from '@scholaris/nucleo';
import * as spdf from '@scholaris/spdf';
import type { Binario } from '../tipos.js';
import { Cobertura } from '../cobertura.js';
import { anclaGuardada, describirFiguras, piesEnTexto, type FiguraConAncla } from './figuras.js';

export type Region = { x: number; y: number; w: number; h: number };

export interface PuertosRehacerFiguras {
  sql: SQL;
  /** Lee un binario del documento por su clave relativa («paginas/0003.jpg»). */
  imagen(clave: string): Promise<Binario | null>;
  /** Recorte de una región de una imagen (para el vector de la figura). Sin él, las figuras de página se quedan sin vector propio. */
  recorte?(clave: string, region: Region): Promise<Binario | null>;
  redactor?: Redactor;
  embebedor?: Embebedor;
  /** Escribe vectores (SQL e índice). */
  guardarVectores?(vectores: Vector[], tiempos: Map<string, number>): Promise<void>;
  /** Borra vectores de figuras que ya no existen o cuya región cambió. */
  borrarVectores?(ids: string[]): Promise<void>;
}

export interface OpcionesRehacerFiguras {
  simular?: boolean;
  /** 'todas' las páginas con imagen, o solo las 'candidatas' (con pie de figura en el texto, con figuras ya, o con poco texto). */
  paginas?: 'todas' | 'candidatas';
  /** Páginas por llamada de visión. */
  lote?: number;
  concurrencia?: number;
  idioma?: string;
  contexto?: string;
  reloj?: () => number;
}

export interface ResultadoRehacerFiguras {
  clase: 'paginas' | 'fotogramas' | 'ninguna';
  simulado: boolean;
  /** Páginas con imagen y, de ellas, las candidatas; las que se miraron de verdad. */
  paginas: { todas: number; candidatas: number; examinadas: number };
  llamadas: { vision: number; descripcion: number; vectores: number };
  /** Llamadas si se miraran todas las páginas o solo las candidatas (para elegir). */
  llamadasSegun: { todas: number; candidatas: number };
  /** Imágenes que irían al modelo de visión, para estimar tokens. */
  imagenesVision: number;
  figuras: { antes: number; despues: number; conservadas: number; nuevas: number; borradas: number; conRegion: number; descritas: number; conVector: number; sinVector: number };
  escenas?: number;
  ms: number;
  avisos: string[];
}

interface FilaUnidad { id: string; orden: number; ancla: string; texto: string; imagen: string | null }
interface FilaFigura { id: string; unidad: string; imagen: string; pie: string | null; descripcion: string | null; ancla: string }

const json = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

/** ¿Merece la pena mirar esta página? Pie de figura en el texto, figuras ya conocidas, o poco texto (láminas, diagramas). */
export function esCandidata(u: Pick<FilaUnidad, 'texto'>, conFiguras: boolean): boolean {
  if (conFiguras) return true;
  if (piesEnTexto(u.texto).length) return true;
  const t = u.texto.replace(/\s+/g, ' ').trim();
  return t.length < 700;
}

/** Intersección sobre unión de dos regiones. */
export function iou(a: Region, b: Region): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const u = a.w * a.h + b.w * b.h - i;
  return u > 0 ? i / u : 0;
}

const normalizarPie = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Una región sensata: dentro de la página, ni diminuta ni la página entera sin pie. */
export function regionValida(r: Partial<Region> | undefined, pie?: string): Region | null {
  if (!r || [r.x, r.y, r.w, r.h].some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  // Algunos modelos responden en 0-1000.
  const escala = Math.max(r.x!, r.y!, r.w!, r.h!) > 1.5 ? 1000 : 1;
  let x = r.x! / escala, y = r.y! / escala, w = r.w! / escala, h = r.h! / escala;
  x = Math.min(1, Math.max(0, x)); y = Math.min(1, Math.max(0, y));
  w = Math.min(1 - x, Math.max(0, w)); h = Math.min(1 - y, Math.max(0, h));
  const area = w * h;
  if (area < 0.01) return null;
  if (area >= 0.85 && !pie) return null;
  const red = (v: number) => Math.round(v * 1000) / 1000;
  return { x: red(x), y: red(y), w: red(w), h: red(h) };
}

/**
 * Casa las figuras nuevas de una página con las que había: primero por región
 * (IoU ≥ 0,3), luego por pie igual, y si en la página había una y hay una, esa.
 */
export function casarFiguras<N extends { region?: Region; pie?: string }, V extends { id: string; region?: Region; pie?: string | null }>(nuevas: N[], viejas: V[]): Map<N, V> {
  const libres = new Set(viejas);
  const casadas = new Map<N, V>();
  const pares: Array<{ n: N; v: V; s: number }> = [];
  for (const n of nuevas) for (const v of viejas) {
    if (n.region && v.region) { const s = iou(n.region, v.region); if (s >= 0.3) pares.push({ n, v, s: 1 + s }); }
    else if (n.pie && v.pie && normalizarPie(n.pie) === normalizarPie(v.pie)) pares.push({ n, v, s: 1 });
  }
  for (const p of pares.sort((a, b) => b.s - a.s)) {
    if (casadas.has(p.n) || !libres.has(p.v)) continue;
    casadas.set(p.n, p.v);
    libres.delete(p.v);
  }
  const sinCasar = nuevas.filter((n) => !casadas.has(n));
  if (sinCasar.length === 1 && libres.size === 1) casadas.set(sinCasar[0]!, [...libres][0]!);
  return casadas;
}

/** Cambios de escena: fotogramas cuyo vector se aleja del anterior bastante más que lo normal. */
export function cambiosDeEscena(vectores: Array<Float32Array | null>): boolean[] {
  const d: number[] = vectores.map((v, i) => {
    const a = vectores[i - 1];
    if (!v || !a) return NaN;
    let p = 0, na = 0, nb = 0;
    for (let k = 0; k < v.length; k++) { p += v[k]! * a[k]!; na += a[k]! * a[k]!; nb += v[k]! * v[k]!; }
    return 1 - p / (Math.sqrt(na * nb) || 1);
  });
  const validas = d.filter((x) => Number.isFinite(x));
  if (!validas.length) return vectores.map(() => false);
  const media = validas.reduce((s, x) => s + x, 0) / validas.length;
  const desv = Math.sqrt(validas.reduce((s, x) => s + (x - media) ** 2, 0) / validas.length);
  const umbral = Math.max(0.06, media + desv);
  return d.map((x) => Number.isFinite(x) && x > umbral);
}

const ESQUEMA_VISION = {
  type: 'object',
  properties: {
    paginas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          figuras: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                pie: { type: 'string' },
                descripcion: { type: 'string' },
                region: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['x', 'y', 'w', 'h'] },
              },
              required: ['descripcion', 'region'],
            },
          },
        },
        required: ['n', 'figuras'],
      },
    },
  },
  required: ['paginas'],
};

const SISTEMA_VISION = (idioma?: string) => `Buscas las figuras en imágenes de páginas de libros, artículos o diapositivas: ilustraciones, grabados, láminas, fotografías, diagramas, gráficos, mapas, esquemas y tablas.
NO son figuras: el texto corrido, títulos, cabeceras y pies de página, números de página, filetes, viñetas y orlas decorativas, capitulares, ni sellos o logotipos pequeños de la editorial. Una página que es solo texto no tiene figuras.
Para cada figura devuelve:
- region: el rectángulo que la encierra (sin el pie), como fracciones de la página entre 0 y 1: x e y de la esquina superior izquierda, w el ancho y h el alto;
- pie: el pie impreso tal cual («Figura 1: …», «Lámina III», «Table 2: …»), si lo tiene;
- descripcion: una o dos frases de lo que se ve, con el texto legible relevante y el tipo (diagrama, tabla, grabado…). Idioma: ${idioma ?? 'el del documento'}.
Responde una entrada por página, con su número n tal como se te da, aunque no tenga figuras (figuras vacía).`;

/** Rehace las figuras de un documento (ver arriba). */
export async function rehacerFiguras(documento: string, puertos: PuertosRehacerFiguras, opciones: OpcionesRehacerFiguras = {}): Promise<ResultadoRehacerFiguras> {
  const reloj = opciones.reloj ?? Date.now;
  const t0 = reloj();
  const { sql } = puertos;
  const avisos: string[] = [];
  const unidades = await sql.ejecutar<FilaUnidad>('SELECT id, orden, ancla, texto, imagen FROM unidades WHERE documento = ? ORDER BY orden', documento);
  const viejas = await sql.ejecutar<FilaFigura>('SELECT id, unidad, imagen, pie, descripcion, ancla FROM figuras WHERE documento = ? ORDER BY rowid', documento);
  const fotogramas = viejas.filter((f) => json<Ancla>(f.ancla, { tipo: 'imagen' }).tipo === 'tiempo');
  const lote = opciones.lote ?? 6;
  const base: ResultadoRehacerFiguras = {
    clase: 'ninguna', simulado: !!opciones.simular, paginas: { todas: 0, candidatas: 0, examinadas: 0 },
    llamadas: { vision: 0, descripcion: 0, vectores: 0 }, llamadasSegun: { todas: 0, candidatas: 0 }, imagenesVision: 0,
    figuras: { antes: viejas.length, despues: viejas.length, conservadas: 0, nuevas: 0, borradas: 0, conRegion: 0, descritas: 0, conVector: 0, sinVector: 0 },
    ms: 0, avisos,
  };

  // ------------------------------------------------------------------ vídeo
  const esMedio = unidades.some((u) => json<Ancla>(u.ancla, { tipo: 'imagen' }).tipo === 'tiempo');
  if (esMedio) {
    base.clase = fotogramas.length ? 'fotogramas' : 'ninguna';
    if (!fotogramas.length) { avisos.push('Este audio o vídeo no tiene fotogramas guardados.'); base.ms = reloj() - t0; return base; }
    const espacio = puertos.embebedor?.espacio.id;
    const conVector = new Map<string, Float32Array>();
    if (espacio) {
      for (const f of await sql.ejecutar<{ id: string; valores: Uint8Array }>("SELECT id, valores FROM vectores WHERE documento = ? AND objetivo = 'figura' AND espacio = ?", documento, espacio)) {
        const b = f.valores;
        conVector.set(f.id, new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
      }
    }
    const orden = [...fotogramas].sort((a, b) => json<{ t0: number }>(a.ancla, { t0: 0 }).t0 - json<{ t0: number }>(b.ancla, { t0: 0 }).t0);
    const sinDescripcion = orden.filter((f) => !f.descripcion?.trim());
    const sinVector = puertos.embebedor?.admite('imagen') ? orden.filter((f) => !conVector.has(f.id)) : [];
    base.llamadas.descripcion = Math.ceil(sinDescripcion.length / 4);
    base.llamadas.vectores = Math.ceil(sinVector.length / 8);
    base.llamadasSegun = { todas: base.llamadas.descripcion + base.llamadas.vectores, candidatas: base.llamadas.descripcion + base.llamadas.vectores };
    base.imagenesVision = sinDescripcion.length;
    if (opciones.simular) { base.figuras.descritas = orden.length - sinDescripcion.length; base.figuras.conVector = conVector.size; base.ms = reloj() - t0; return base; }

    // Vectores que faltan (el fotograma entero; no hace falta recortar).
    if (sinVector.length && puertos.embebedor && puertos.guardarVectores) {
      const e = puertos.embebedor;
      const lotes: FilaFigura[][] = [];
      for (let i = 0; i < sinVector.length; i += 8) lotes.push(sinVector.slice(i, i + 8));
      await enParalelo(lotes, 4, async (l) => {
        const piezas: Array<{ f: FilaFigura; b: Binario }> = [];
        for (const f of l) { const b = await puertos.imagen(f.imagen); if (b) piezas.push({ f, b }); }
        if (!piezas.length) return;
        try {
          const vs = await reintentar(() => e.vectorizar(piezas.map((p) => ({ modalidad: 'imagen' as const, bytes: p.b.bytes, mime: p.b.mime })), 'documento'), { intentos: 3, base: 1000 });
          const tiempos = new Map(piezas.map((p) => [p.f.id, json<{ t0: number }>(p.f.ancla, { t0: 0 }).t0]));
          await puertos.guardarVectores!(piezas.map((p, i) => ({ objetivo: 'figura', id: p.f.id, espacio: e.espacio.id, valores: vs[i]! })), tiempos);
          piezas.forEach((p, i) => conVector.set(p.f.id, vs[i]!));
        } catch { avisos.push('Algún lote de fotogramas no se pudo vectorizar.'); }
      });
    }
    // Descripciones que faltan.
    if (sinDescripcion.length && puertos.redactor) {
      const figs: FiguraConAncla[] = sinDescripcion.map((f) => { const a = json<Ancla>(f.ancla, { tipo: 'tiempo', t0: 0, t1: 0 }); return { id: f.id, unidad: 0, fisica: 1, ancla: a, imagen: f.imagen, parte: f.imagen, ...(a.tipo === 'tiempo' ? { t: a.t0 } : {}) }; });
      await describirFiguras(figs, { parte: (k) => puertos.imagen(k) }, puertos.redactor, { ...(opciones.idioma ? { idioma: opciones.idioma } : {}), ...(opciones.contexto ? { contexto: opciones.contexto } : {}), concurrencia: opciones.concurrencia ?? 6 });
      for (const g of figs) if (g.descripcion) { const f = sinDescripcion.find((x) => x.id === g.id)!; f.descripcion = g.descripcion; }
    }
    // Cambios de escena por la distancia entre vectores seguidos.
    const escenas = cambiosDeEscena(orden.map((f) => conVector.get(f.id) ?? null));
    base.escenas = escenas.filter(Boolean).length;
    await sql.transaccion(async (tx) => {
      for (const [i, f] of orden.entries()) {
        const a = json<Record<string, unknown>>(f.ancla, {});
        delete a.escena;
        if (escenas[i]) a.escena = true;
        await tx.ejecutar('UPDATE figuras SET ancla = ?, descripcion = ? WHERE id = ?', JSON.stringify(a), f.descripcion ?? null, f.id);
      }
    });
    base.figuras.descritas = orden.filter((f) => f.descripcion?.trim()).length;
    base.figuras.conVector = orden.filter((f) => conVector.has(f.id)).length;
    base.figuras.sinVector = orden.length - base.figuras.conVector;
    base.figuras.conservadas = orden.length;
    base.ms = reloj() - t0;
    return base;
  }

  // ------------------------------------------------------------------ páginas
  const conImagen = unidades.filter((u) => u.imagen);
  if (!conImagen.length) { avisos.push('Este documento no guarda imágenes de página: no hay dónde buscar figuras.'); base.ms = reloj() - t0; return base; }
  base.clase = 'paginas';
  const unidadesConFiguras = new Set(viejas.map((f) => f.unidad));
  const candidatas = conImagen.filter((u) => esCandidata(u, unidadesConFiguras.has(u.id)));
  base.paginas = { todas: conImagen.length, candidatas: candidatas.length, examinadas: 0 };
  base.llamadasSegun = { todas: Math.ceil(conImagen.length / lote), candidatas: Math.ceil(candidatas.length / lote) };
  const examinar = (opciones.paginas ?? 'todas') === 'candidatas' ? candidatas : conImagen;
  base.paginas.examinadas = examinar.length;
  base.llamadas.vision = Math.ceil(examinar.length / lote);
  base.imagenesVision = examinar.length;
  if (opciones.simular) { base.ms = reloj() - t0; return base; }
  if (!puertos.redactor) throw new Error('Hace falta un modelo de visión para buscar figuras.');

  // Visión por lotes.
  type Detectada = { unidad: FilaUnidad; region: Region; pie?: string; descripcion: string };
  const detectadas = new Map<string, Detectada[]>();
  const lotes: FilaUnidad[][] = [];
  for (let i = 0; i < examinar.length; i += lote) lotes.push(examinar.slice(i, i + lote));
  const cobertura = new Cobertura(20_000, 2);
  const fallidas = new Set<string>();
  await enParalelo(lotes, opciones.concurrencia ?? 6, async (l) => {
    const partes: Array<{ texto: string } | { bytes: Uint8Array; mime: string }> = [];
    const incluidas: FilaUnidad[] = [];
    for (const u of l) {
      const b = await puertos.imagen(u.imagen!);
      if (!b) continue;
      incluidas.push(u);
      partes.push({ texto: `Página n=${incluidas.length}:` }, { bytes: b.bytes, mime: b.mime });
    }
    if (!incluidas.length) return;
    try {
      const r = await reintentar(() => cobertura.llamar(() => puertos.redactor!.generar<{ paginas: Array<{ n: number; figuras: Array<{ pie?: string; descripcion?: string; region?: Partial<Region> }> }> }>({
        sistema: SISTEMA_VISION(opciones.idioma),
        mensajes: [{ rol: 'usuario', partes: [...(opciones.contexto ? [{ texto: `Documento: ${opciones.contexto}` }] : []), ...partes] }],
        esquema: ESQUEMA_VISION,
        temperatura: 0.1,
        maxTokens: 600 + incluidas.length * 400,
        calidad: 'alta',
      })), { intentos: 3, base: 1500 });
      for (const u of incluidas) detectadas.set(u.id, []);
      for (const p of r.json?.paginas ?? []) {
        const u = incluidas[p.n - 1];
        if (!u) continue;
        for (const f of p.figuras ?? []) {
          const pie = f.pie?.trim() || undefined;
          const region = regionValida(f.region, pie);
          if (!region) continue;
          detectadas.get(u.id)!.push({ unidad: u, region, ...(pie ? { pie } : {}), descripcion: (f.descripcion ?? '').trim() });
        }
      }
    } catch { for (const u of incluidas) fallidas.add(u.id); }
  });
  if (fallidas.size) avisos.push(`${fallidas.size} páginas no se pudieron mirar; conservan las figuras que tenían.`);

  // Casar con las que había y escribir.
  const porUnidad = new Map<string, FilaFigura[]>();
  for (const f of viejas) if (json<Ancla>(f.ancla, { tipo: 'imagen' }).tipo !== 'tiempo') porUnidad.set(f.unidad, [...(porUnidad.get(f.unidad) ?? []), f]);
  const escribir: FiguraConAncla[] = [];
  const borrar: string[] = [];
  const vectoresViejos: string[] = [];
  for (const [unidadId, nuevas] of detectadas) {
    const antes = (porUnidad.get(unidadId) ?? []).map((f) => ({ ...f, region: (json<{ region?: Region }>(f.ancla, {})).region }));
    const casadas = casarFiguras(nuevas, antes);
    const u = nuevas[0]?.unidad ?? unidades.find((x) => x.id === unidadId)!;
    const anclaPagina = json<Ancla>(u.ancla, { tipo: 'imagen' });
    if (anclaPagina.tipo === 'pagina' || anclaPagina.tipo === 'diapositiva' || anclaPagina.tipo === 'seccion') delete (anclaPagina as { region?: unknown }).region;
    for (const n of nuevas) {
      const v = casadas.get(n);
      if (v) base.figuras.conservadas++; else base.figuras.nuevas++;
      if (v && (!v.region || iou(v.region, n.region) < 0.9)) vectoresViejos.push(v.id);
      escribir.push({
        id: v?.id ?? nuevoId('fg'), unidad: u.orden, fisica: u.orden + 1, ancla: anclaPagina, region: n.region, parte: u.imagen!, imagen: u.imagen!,
        ...(n.pie ?? v?.pie ? { pie: (n.pie ?? v?.pie)! } : {}), ...(n.descripcion || v?.descripcion ? { descripcion: n.descripcion || v!.descripcion! } : {}),
      });
    }
    for (const v of antes) if (![...casadas.values()].includes(v)) borrar.push(v.id);
  }
  base.figuras.borradas = borrar.length;
  await sql.transaccion(async (tx) => {
    for (const id of borrar) await tx.ejecutar('DELETE FROM figuras WHERE id = ?', id);
    await spdf.escribirFiguras(tx, escribir.map((g) => ({
      id: g.id, documento, unidad: unidades.find((x) => x.orden === g.unidad)!.id, imagen: g.imagen ?? '',
      ...(g.pie ? { pie: g.pie } : {}), ...(g.descripcion ? { descripcion: g.descripcion } : {}), ancla: anclaGuardada(g),
    })));
  });
  const caducos = [...borrar, ...vectoresViejos];
  if (caducos.length && puertos.borrarVectores) await puertos.borrarVectores(caducos);

  // Vectores de las figuras (solo si se puede recortar la región).
  if (puertos.recorte && puertos.embebedor?.admite('imagen') && puertos.guardarVectores) {
    const e = puertos.embebedor;
    const tienen = new Set((await sql.ejecutar<{ id: string }>("SELECT id FROM vectores WHERE documento = ? AND objetivo = 'figura' AND espacio = ?", documento, e.espacio.id)).map((f) => f.id));
    const faltan = escribir.filter((g) => !tienen.has(g.id));
    base.llamadas.vectores = Math.ceil(faltan.length / 8);
    const lotesV: FiguraConAncla[][] = [];
    for (let i = 0; i < faltan.length; i += 8) lotesV.push(faltan.slice(i, i + 8));
    await enParalelo(lotesV, 4, async (l) => {
      const piezas: Array<{ g: FiguraConAncla; b: Binario }> = [];
      for (const g of l) { const b = await puertos.recorte!(g.imagen!, g.region!); if (b) piezas.push({ g, b }); }
      if (!piezas.length) return;
      try {
        const vs = await reintentar(() => e.vectorizar(piezas.map((p) => ({ modalidad: 'imagen' as const, bytes: p.b.bytes, mime: p.b.mime })), 'documento'), { intentos: 3, base: 1000 });
        await puertos.guardarVectores!(piezas.map((p, i) => ({ objetivo: 'figura', id: p.g.id, espacio: e.espacio.id, valores: vs[i]! })), new Map());
      } catch { avisos.push('Algún lote de figuras no se pudo vectorizar.'); }
    });
  }
  const todas = await sql.ejecutar<{ id: string; ancla: string; descripcion: string | null }>('SELECT id, ancla, descripcion FROM figuras WHERE documento = ?', documento);
  const vecs = puertos.embebedor ? new Set((await sql.ejecutar<{ id: string }>("SELECT id FROM vectores WHERE documento = ? AND objetivo = 'figura' AND espacio = ?", documento, puertos.embebedor.espacio.id)).map((f) => f.id)) : new Set<string>();
  base.figuras.despues = todas.length;
  base.figuras.conRegion = todas.filter((f) => json<{ region?: Region }>(f.ancla, {}).region).length;
  base.figuras.descritas = todas.filter((f) => f.descripcion?.trim()).length;
  base.figuras.conVector = todas.filter((f) => vecs.has(f.id)).length;
  base.figuras.sinVector = todas.length - base.figuras.conVector;
  if (!puertos.recorte && base.figuras.sinVector) avisos.push('Las figuras de página no tienen vector propio aquí (no se puede recortar la imagen en el servidor); «Buscar parecidas» usa el de su página.');
  base.ms = reloj() - t0;
  return base;
}
