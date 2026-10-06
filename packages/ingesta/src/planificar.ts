/**
 * El plan: qué páginas se leen con visión y cuáles con la capa de texto, cómo se
 * cortan los pliegos y qué tramos de audio y fotogramas hay. Puro y determinista.
 */

import type { PaginaPdf, PaqueteConversion } from '@scholaris/imprenta';
import type { OpcionesPlan, Plan, Pliego, Tanda, ViaLectura } from './tipos.js';

/** Medido en el banco (48 páginas, Flash-Lite): 1 → 5,6 s y 0,00165 $/p; 4 → 7,5 s y 0,00143 $/p; 8 → 11,2 s y 0,00131 $/p. */
export const PAGINAS_POR_PLIEGO = 4;
export const CONCURRENCIA = 48;
/** Páginas de capa de texto por tanda: cientos por segundo, pero la escritura en la estantería va por lotes. */
export const PAGINAS_POR_TANDA_CAPA = 24;

export function planificar(paquete: PaqueteConversion, opciones: OpcionesPlan = {}): Plan {
  const porPliego = Math.max(1, opciones.paginasPorPliego ?? PAGINAS_POR_PLIEGO);
  const concurrencia = opciones.concurrencia ?? CONCURRENCIA;
  const notas: string[] = [];
  const base: Omit<Plan, 'modo' | 'unidades'> = {
    tandas: [],
    tipo: paquete.tipo,
    concurrencia,
    notas,
    tramos: [],
    fotogramas: [],
    paginasImagen: [],
    pliegos: [],
    vias: [],
  };
  const c = paquete.contenido;

  if (c.clase === 'medio') {
    const tramos = (c.audio?.tramos ?? []).map((t) => ({ n: t.n, t0: t.t0, t1: t.t1, propioDesde: t.propioDesde, propioHasta: t.propioHasta, parte: t.parte }));
    if (!tramos.length) notas.push('El medio no trae audio: solo se indexan los fotogramas');
    const fotogramas = (c.video?.fotogramas ?? []).map((f) => ({ t: f.t, parte: f.parte }));
    const tandas: Tanda[] = tramos.map((t, i) => ({ id: i, clase: 'tramo', desde: t.n, hasta: t.n, tramo: t.n }));
    return { ...base, modo: 'medio', unidades: tramos.length, tramos, fotogramas, tandas };
  }

  if (c.clase === 'imagenes') {
    const motivos = c.paginas.map(() => 'fotos' as const);
    const pliegos = cortarPliegos(c.paginas.map((p) => p.fisica), motivos, porPliego, 'imagenes');
    return {
      ...base,
      modo: 'paginas',
      unidades: c.paginas.length,
      vias: c.paginas.map(() => 'vision'),
      pliegos,
      tandas: tandasDePaginas(c.paginas.map((p) => p.fisica), pliegos, opciones.paginasPorTandaCapa ?? PAGINAS_POR_TANDA_CAPA),
      paginasImagen: vista(opciones) === 'ninguna' ? [] : c.paginas.map((p) => ({ fisica: p.fisica, parte: p.imagen })),
    };
  }

  if (c.clase !== 'pdf') {
    const n = c.clase === 'presentacion' ? c.diapositivas.length : c.clase === 'hoja' ? c.hojas.length : c.bloques.length;
    // Diapositivas con imagen (la pone el conversor del servidor): vía visual como las páginas.
    const paginasImagen = c.clase === 'presentacion'
      ? c.diapositivas.filter((d) => d.imagen).map((d, i) => ({ fisica: i + 1, parte: d.imagen as string }))
      : [];
    return { ...base, modo: 'bloques', unidades: n, paginasImagen: vista(opciones) === 'ninguna' ? [] : paginasImagen, tandas: n ? [{ id: 0, clase: 'bloques', desde: 1, hasta: n }] : [] };
  }

  const paginas = c.paginas;
  const digital = opciones.digital ?? 'auto';
  // Una capa de texto que viene de un OCR ajeno (Acrobat Paper Capture, ABBYY…) trae
  // erratas («n6o», «beliefis»), titulillos dentro del cuerpo y notas mezcladas: se relee.
  const ocrAjeno = digital === 'auto' && capaDeOcr(paquete);
  const economico = opciones.modo === 'economico';
  if (ocrAjeno) notas.push('La capa de texto es de un OCR anterior: se relee con visión');
  const motivos: Array<Pliego['motivo'] | null> = paginas.map((p) => {
    if (p.clase === 'pdf_escaneado') return 'sin_capa';
    if (digital === 'vision') return 'todo_vision';
    const t = p.texto;
    if (ocrAjeno && (t.caracteres > 0 || p.imagenes.length > 0 || t.coberturaImagen > 0.02)) {
      // En modo económico, una capa de OCR buena se aprovecha tal cual: cero llamadas.
      if (economico && t.util && t.calidad >= 0.9 && !paginaCompleja(p)) return null;
      return 'capa_ocr';
    }
    if (!t.util) {
      // Sin capa útil: si no hay nada que ver (página en blanco), no se manda.
      if (t.caracteres === 0 && p.imagenes.length === 0 && t.coberturaImagen < 0.02) return null;
      return t.caracteres > 0 ? 'capa_mala' : 'sin_capa';
    }
    if (digital === 'auto' && (t.coberturaImagen > 0.3 || paginaCompleja(p))) return 'maquetacion';
    return null;
  });

  // Si casi todo va por visión, es un escaneado con alguna página de texto: todo por visión.
  const nVision = motivos.filter(Boolean).length;
  if (digital === 'auto' && !ocrAjeno && nVision > paginas.length * 0.5 && nVision < paginas.length) {
    notas.push(`${nVision}/${paginas.length} páginas sin capa útil: se lee entero con visión`);
    for (let i = 0; i < motivos.length; i++) motivos[i] ??= 'sin_capa';
  }

  const vias: ViaLectura[] = motivos.map((m) => (m ? 'vision' : 'capa'));
  // Modo económico: las páginas con una capa de OCR legible son «fáciles» (lector barato,
  // p. ej. Workers AI); las demás, «difíciles» (Gemini por la API por lotes).
  const dificultades = economico
    ? paginas.map((p, i) => (motivos[i] ? (p.texto.origen === 'ocr' && p.texto.caracteres > 200 && p.texto.calidad >= 0.6 && p.imagenes.filter((r) => r.w * r.h < 0.85).length === 0 ? 'facil' : 'dificil') : null))
    : null;
  const pliegos = cortarPliegos(paginas.map((p) => p.fisica), motivos, porPliego, 'pdf', dificultades);
  const modoVista = vista(opciones);
  // Vector de imagen de página solo donde aporta algo que el texto no tiene.
  const conVista = paginas.filter((p, i) => {
    if (!p.imagen || modoVista === 'ninguna') return false;
    if (modoVista === 'todas') return true;
    const figuras = p.imagenes.some((r) => r.w * r.h >= 0.02 && r.w * r.h < 0.85);
    return p.clase === 'pdf_escaneado' || motivos[i] === 'capa_ocr' || motivos[i] === 'sin_capa' || motivos[i] === 'maquetacion' || figuras;
  });
  return {
    ...base,
    modo: 'paginas',
    unidades: paginas.length,
    vias,
    pliegos,
    tandas: tandasDePaginas(paginas.map((p) => p.fisica), pliegos, opciones.paginasPorTandaCapa ?? PAGINAS_POR_TANDA_CAPA),
    paginasImagen: conVista.map((p) => ({ fisica: p.fisica, parte: p.imagen as string })),
  };
}

const vista = (o: OpcionesPlan) => (o.vectorPorPagina === false ? 'ninguna' : o.vistaPaginas ?? 'utiles');

/**
 * Las tandas de un documento de páginas: cada pliego de visión es una tanda; las
 * páginas que se leen por la capa, en lotes contiguos. Se procesan primero los
 * lotes de capa (buscables al instante) y luego los pliegos por orden de página.
 */
export function tandasDePaginas(fisicas: number[], pliegos: Pliego[], porTanda: number): Tanda[] {
  const enPliego = new Map<number, Pliego>();
  for (const p of pliegos) for (let f = p.desde; f <= p.hasta; f++) enPliego.set(f, p);
  const tandas: Array<Omit<Tanda, 'id'>> = [];
  let capa: number[] = [];
  const volcar = () => {
    for (let i = 0; i < capa.length; i += porTanda) {
      const t = capa.slice(i, i + porTanda);
      tandas.push({ clase: 'capa', desde: t[0] as number, hasta: t.at(-1) as number });
    }
    capa = [];
  };
  for (const f of fisicas) {
    const p = enPliego.get(f);
    if (!p) { capa.push(f); continue; }
    volcar();
    if (p.desde === f) tandas.push({ clase: 'pliego', desde: p.desde, hasta: p.hasta, pliego: p.id });
  }
  volcar();
  const conId = tandas.map((t, id) => ({ id, ...t }));
  return [...conId.filter((t) => t.clase === 'capa'), ...conId.filter((t) => t.clase !== 'capa')];
}

/**
 * Agrupa las páginas que van por visión en pliegos de páginas consecutivas,
 * repartidos en tamaños parejos (mejor 5+5 que 9+1: termina antes).
 */
export function cortarPliegos(
  fisicas: number[],
  motivos: Array<Pliego['motivo'] | null>,
  porPliego: number,
  envio: Pliego['envio'],
  dificultades: Array<'facil' | 'dificil' | null> | null = null,
): Pliego[] {
  const tiradas: Array<{ desde: number; hasta: number; motivo: Pliego['motivo']; dificultad?: 'facil' | 'dificil' }> = [];
  for (let i = 0; i < fisicas.length; i++) {
    const m = motivos[i];
    if (!m) continue;
    const f = fisicas[i] as number;
    const d = dificultades?.[i] ?? undefined;
    const ultima = tiradas.at(-1);
    if (ultima && ultima.hasta === f - 1 && ultima.dificultad === d) ultima.hasta = f;
    else tiradas.push({ desde: f, hasta: f, motivo: m, ...(d ? { dificultad: d } : {}) });
  }
  const pliegos: Pliego[] = [];
  for (const t of tiradas) {
    const n = t.hasta - t.desde + 1;
    const partes = Math.ceil(n / porPliego);
    const tam = Math.ceil(n / partes);
    for (let d = t.desde; d <= t.hasta; d += tam) {
      pliegos.push({ id: pliegos.length, desde: d, hasta: Math.min(t.hasta, d + tam - 1), envio, motivo: t.motivo, ...(t.dificultad ? { dificultad: t.dificultad } : {}) });
    }
  }
  return pliegos;
}

const RE_MATES = /[∑∏∫√∂∇≤≥≈≠∈∉⊂⊆∪∩→←↔⇒∀∃±×÷·∞αβγδεθλμσφψωΩΣΠ]/gu;

/**
 * ¿La capa de texto destroza esta página? Tablas y fórmulas salen de pdf.js como
 * muchos bloques diminutos («O(1) O(n)», «P E», «(pos,2i)»): esas páginas se leen
 * con visión, que devuelve tablas en Markdown y fórmulas en LaTeX. La prosa,
 * aunque sea de un libro de 600 páginas, se queda en la capa (gratis e inmediata).
 */
const RE_OCR = /paper capture|clearscan|abbyy|finereader|omnipage|readiris|tesseract|ocrmypdf|\bocr\b|scansnap|capture|kofax|naps2|vflat|camscanner|adobe scan|internet archive|djvu|luratech/i;

/** ¿La capa de texto del PDF es un OCR hecho por otro programa? */
export function capaDeOcr(paquete: PaqueteConversion): boolean {
  const c = paquete.contenido;
  if (c.clase !== 'pdf') return false;
  const ficha = [paquete.metadatos.productor, paquete.metadatos.creador, c.info.Producer, c.info.Creator, c.xmp ? Object.values(c.xmp).join(' ') : ''].filter(Boolean).join(' ');
  if (RE_OCR.test(ficha)) return true;
  const conTexto = c.paginas.filter((p) => p.texto.caracteres > 0);
  return conTexto.length > 0 && conTexto.filter((p) => p.texto.origen === 'ocr').length / conTexto.length > 0.3;
}

/** Letras espaciadas («T H E  M E D I E V A L»): la capa no sabe dónde acaban las palabras. */
export function capaEspaciada(texto: string): boolean {
  const fichas = texto.split(/\s+/).filter(Boolean);
  if (fichas.length < 8) return false;
  const sueltas = fichas.filter((f) => /^\p{L}$/u.test(f)).length;
  return sueltas / fichas.length > 0.3;
}

export function paginaCompleja(p: PaginaPdf): boolean {
  if (capaEspaciada(p.cuerpo)) return true;
  const bloques = p.bloques.filter((b) => b.texto.trim());
  if (bloques.length < 6) return false;
  const palabras = (t: string) => t.trim().split(/\s+/).length;
  const diminutos = bloques.filter((b) => palabras(b.texto) <= 3).length;
  const mates = (p.cuerpo.match(RE_MATES)?.length ?? 0) / Math.max(1, p.cuerpo.length);
  return (diminutos >= 6 && diminutos / bloques.length >= 0.35) || mates > 0.01;
}
