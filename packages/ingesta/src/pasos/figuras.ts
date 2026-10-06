/**
 * Paso de figuras: reúne las figuras que vio el lector (con pie, descripción y
 * región), las imágenes de las páginas digitales con sus pies (por regex) y los
 * fotogramas clave de los vídeos; describe en lote las que no tienen descripción.
 */

import { enParalelo, nuevoId, reintentar, type Ancla, type Redactor } from '@scholaris/nucleo';
import type { PaqueteConversion } from '@scholaris/imprenta';
import type { FiguraPlana, FuentePaquete, Procedencia, UnidadLeida } from '../tipos.js';
import { Cobertura } from '../cobertura.js';

export interface FiguraConAncla extends FiguraPlana {
  ancla: Ancla;
  /** Parte binaria de la que sale (página o fotograma). */
  parte?: string;
  t?: number;
}

const RE_PIE = /^\s*(?:\*\*|_)?((?:fig(?:ure|ura)?|table|tabla|cuadro|l[aá]mina|plate|ilustraci[oó]n|illustration|gr[aá]fico|chart|diagrama|map[a]?|abb(?:ildung)?|tableau)\.?\s*[\dIVXivx]+[a-z]?(?:[.:\-–—]|\s)\s*.*)$/i;

export function piesEnTexto(texto: string): string[] {
  return texto.split(/\n+/).map((l) => RE_PIE.exec(l)?.[1]?.replace(/[*_]+/g, '').trim()).filter((x): x is string => Boolean(x) && (x as string).length < 600);
}

export function reunirFiguras(paquete: PaqueteConversion, unidades: UnidadLeida[]): FiguraConAncla[] {
  const figuras: FiguraConAncla[] = [];
  const paginasPdf = paquete.contenido.clase === 'pdf' ? new Map(paquete.contenido.paginas.map((p) => [p.fisica, p])) : null;
  const paginasImg = paquete.contenido.clase === 'imagenes' ? new Map(paquete.contenido.paginas.map((p) => [p.fisica, p])) : null;
  for (const u of unidades) {
    if (!u.ancla || u.ancla.tipo === 'tiempo') continue;
    const parte = paginasPdf?.get(u.fisica)?.imagen ?? paginasImg?.get(u.fisica)?.imagen;
    if (u.figuras.length) {
      for (const f of u.figuras) {
        // Una «figura» que ocupa la página entera sin pie es la página (cubierta, guarda): no aporta.
        if (!f.pie && f.region && f.region.w * f.region.h >= 0.85) continue;
        figuras.push({ id: nuevoId('fg'), unidad: u.orden, fisica: u.fisica, ancla: u.ancla, ...(f.pie ? { pie: f.pie } : {}), ...(f.descripcion ? { descripcion: f.descripcion } : {}), ...(f.region ? { region: f.region } : {}), ...(parte ? { parte } : {}) });
      }
      continue;
    }
    // Página leída con visión: las figuras son las que vio el lector (las imágenes
    // incrustadas de un escaneado son el propio escaneo, a veces en tiras).
    const pdf = paginasPdf?.get(u.fisica);
    if (!pdf || u.lector !== 'capa-pdf' || pdf.clase === 'pdf_escaneado') continue;
    // Página digital: imágenes incrustadas grandes (pero no la página entera) con los pies que haya en el texto.
    const grandes = pdf.imagenes.filter((r) => r.w * r.h >= 0.02 && r.w * r.h < 0.85 && r.w >= 0.12 && r.h >= 0.06).slice(0, 12);
    const pies = piesEnTexto(u.texto);
    grandes.forEach((r, i) => {
      const pie = pies[i] ?? (grandes.length === 1 ? pies[0] : undefined);
      figuras.push({ id: nuevoId('fg'), unidad: u.orden, fisica: u.fisica, ancla: u.ancla as Ancla, region: { x: r.x, y: r.y, w: r.w, h: r.h }, ...(pie ? { pie } : {}), ...(parte ? { parte } : {}) });
    });
    // Pies de figuras vectoriales (sin imagen incrustada, como los diagramas de un artículo).
    if (!grandes.length && pies.length) {
      for (const pie of pies.filter((p) => /^fig|^figura|^l[aá]mina|^plate/i.test(p))) {
        figuras.push({ id: nuevoId('fg'), unidad: u.orden, fisica: u.fisica, ancla: u.ancla as Ancla, pie, ...(parte ? { parte } : {}) });
      }
    }
  }
  // Fotogramas clave del vídeo: figuras con ancla de tiempo, en la unidad que los contiene.
  if (paquete.contenido.clase === 'medio' && paquete.contenido.video) {
    const tramos = unidades.filter((u) => u.t0 !== undefined);
    for (const f of paquete.contenido.video.fotogramas) {
      const u = tramos.find((x) => f.t >= (x.t0 as number) && f.t <= (x.t1 as number)) ?? tramos.reduce<UnidadLeida | undefined>((m, x) => (!m || Math.abs((x.t0 as number) - f.t) < Math.abs((m.t0 as number) - f.t) ? x : m), undefined);
      figuras.push({ id: nuevoId('fg'), unidad: u?.orden ?? 0, fisica: u?.fisica ?? 1, t: f.t, parte: f.parte, imagen: f.parte, ancla: { tipo: 'tiempo', t0: f.t, t1: f.t, ...(u?.hablante ? { hablante: u.hablante } : {}) } });
    }
  }
  return figuras;
}

const ESQUEMA = {
  type: 'object',
  properties: { figuras: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, descripcion: { type: 'string' } }, required: ['n', 'descripcion'] } } },
  required: ['figuras'],
};

/** Describe en lotes las figuras que no traen descripción (una llamada por lote de imágenes). */
export async function describirFiguras(
  figuras: FiguraConAncla[],
  fuente: FuentePaquete,
  redactor: Redactor,
  opciones: { lote?: number; concurrencia?: number; idioma?: string; contexto?: string } = {},
): Promise<number> {
  const pendientes = figuras.filter((f) => !f.descripcion && (f.parte || f.imagen));
  const lote = opciones.lote ?? 4;
  const lotes: FiguraConAncla[][] = [];
  for (let i = 0; i < pendientes.length; i += lote) lotes.push(pendientes.slice(i, i + lote));
  let descritas = 0;
  const cobertura = new Cobertura(12_000, 2);
  await enParalelo(lotes, opciones.concurrencia ?? 8, async (l) => {
    const partes: Array<{ texto: string } | { bytes: Uint8Array; mime: string }> = [];
    const incluidas: FiguraConAncla[] = [];
    for (const f of l) {
      const b = f.region && f.parte && fuente.recorte ? await fuente.recorte(f.parte, f.region) : await fuente.parte((f.imagen ?? f.parte) as string);
      if (!b) continue;
      incluidas.push(f);
      partes.push({ texto: `Imagen ${incluidas.length}${f.pie ? ` (pie: ${f.pie})` : ''}${f.t !== undefined ? ` (fotograma en ${Math.round(f.t)} s)` : ''}:` }, { bytes: b.bytes, mime: b.mime });
    }
    if (!incluidas.length) return;
    try {
      const r = await reintentar(() => cobertura.llamar(() => redactor.generar<{ figuras: Array<{ n: number; descripcion: string }> }>({
        sistema: `Describes imágenes de documentos y vídeos para un buscador: qué se ve, texto legible relevante (fórmulas, rótulos, títulos de diapositiva), tipo (diagrama, tabla, foto, grabado, plano). Una o dos frases por imagen, sin adornos. Idioma: ${opciones.idioma ?? 'el del documento'}.`,
        mensajes: [{ rol: 'usuario', partes: [...(opciones.contexto ? [{ texto: `Documento: ${opciones.contexto}` }] : []), ...partes] }],
        esquema: ESQUEMA,
        temperatura: 0.2,
        maxTokens: 200 + incluidas.length * 160,
        calidad: 'rapida',
      })), { intentos: 3, base: 1500 });
      for (const d of r.json?.figuras ?? []) {
        const f = incluidas[d.n - 1];
        if (f && d.descripcion?.trim()) { f.descripcion = d.descripcion.trim(); descritas++; }
      }
    } catch { /* sin descripción: la figura sigue valiendo por su pie y su vector */ }
  });
  return descritas;
}

export async function pasoFiguras(
  paquete: PaqueteConversion,
  unidades: UnidadLeida[],
  fuente: FuentePaquete,
  redactor: Redactor | undefined,
  opciones: { reloj?: () => number; idioma?: string; contexto?: string; describir?: boolean } = {},
): Promise<{ figuras: FiguraConAncla[]; procedencia: Procedencia }> {
  const reloj = opciones.reloj ?? Date.now;
  const t = reloj();
  const figuras = reunirFiguras(paquete, unidades);
  const descritas = redactor && opciones.describir !== false ? await describirFiguras(figuras, fuente, redactor, opciones) : 0;
  return { figuras, procedencia: { fase: 'figuras', proveedor: redactor?.nombre ?? 'lector', ms: reloj() - t, detalle: { figuras: figuras.length, descritas, conPie: figuras.filter((f) => f.pie).length } } };
}
