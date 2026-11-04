/**
 * Anclaje material de las páginas (docs/COMPRENSION.md, «Anclaje material»):
 * de una cita (o de unos caracteres) de una unidad a sus `caracteres` (puntos de
 * código NFC del texto de la unidad) y a su `region` en la imagen de la página.
 *
 * - PDF digital: la capa de texto del conversor trae la caja de cada línea; la
 *   región sale por cálculo (las líneas que ocupa la cita y, en la primera y la
 *   última, la parte proporcional a sus caracteres).
 * - Escaneado o foto: el modelo localiza la cita en la imagen (cajas
 *   `box_2d`) y el resultado se guarda en caché.
 */
import type { Ancla, AnclaMaterial, Redactor, Region } from '@scholaris/nucleo';
import { sha256 } from '@scholaris/nucleo';
import type { AlmacenTrabajo } from './tipos.js';
import { regionDeCaja } from './fusion.js';

/** Una línea de la capa de texto (la forma de `LineaTexto` de la imprenta). */
export interface LineaPagina {
  texto: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface UnidadAnclable {
  orden: number;
  texto: string;
  ancla: Ancla;
  /** Clave de su imagen (página, pliego, foto), si la hay. */
  imagen?: string | null;
}

export interface PuertosAnclaje {
  /** Líneas de la capa de texto de la página física (PDF digital); null si no las hay o es escaneada. */
  lineas?(fisica: number): Promise<LineaPagina[] | null>;
  /** Los bytes de la imagen de la unidad. */
  imagen?(clave: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** Modelo que localiza texto en una imagen (Gemini «alta»). */
  redactor?: Redactor;
  /** Caché de las localizaciones visuales (cuestan una llamada). */
  cache?: AlmacenTrabajo;
}

export interface AnclajeResultado {
  ancla: AnclaMaterial;
  /** Cómo se obtuvo la región. */
  metodo: 'capa' | 'vision' | 'ninguno';
  /** El texto exacto de la unidad en esos caracteres. */
  texto?: string;
  /** 0-1: cuánto se parece la cita a lo encontrado. */
  confianza: number;
}

// ---------------------------------------------------------------------------
// Caracteres
// ---------------------------------------------------------------------------

/** Esqueleto de un texto: solo letras y cifras, en minúscula y sin diacríticos, con el índice (en puntos de código NFC) de cada una. */
export function esqueleto(texto: string): { s: string; pos: number[] } {
  const cps = Array.from(texto.normalize('NFC'));
  let s = '';
  const pos: number[] = [];
  cps.forEach((c, i) => {
    const base = c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const b of base) if (/[\p{L}\p{N}]/u.test(b)) { s += b; pos.push(i); }
  });
  return { s, pos };
}

/**
 * [inicio, fin) de `cita` en `texto`, en puntos de código NFC: primero exacta,
 * luego por su esqueleto (sin mayúsculas, tildes, puntuación ni marcas de
 * Markdown) y, si no, por el principio y el final de la cita. null si no está.
 */
export function buscarCita(texto: string, cita: string): { caracteres: [number, number]; confianza: number } | null {
  const nfc = texto.normalize('NFC');
  const c = cita.normalize('NFC').trim();
  if (!c) return null;
  const i = nfc.indexOf(c);
  if (i >= 0) {
    const ini = Array.from(nfc.slice(0, i)).length;
    return { caracteres: [ini, ini + Array.from(c).length], confianza: 1 };
  }
  const t = esqueleto(nfc), q = esqueleto(c);
  if (q.s.length < 3) return null;
  const j = t.s.indexOf(q.s);
  if (j >= 0) return { caracteres: [t.pos[j]!, t.pos[j + q.s.length - 1]! + 1], confianza: 0.95 };
  // Cita con erratas o cortes: el principio y el final, cada uno de hasta 24 letras.
  const n = Math.min(24, Math.floor(q.s.length / 3));
  if (n < 8) return null;
  const a = t.s.indexOf(q.s.slice(0, n));
  if (a < 0) return null;
  const b = t.s.indexOf(q.s.slice(-n), a + n);
  if (b < 0 || b + n - a > q.s.length * 1.5) return null;
  return { caracteres: [t.pos[a]!, t.pos[b + n - 1]! + 1], confianza: 0.75 };
}

/** El trozo de texto de la unidad en [inicio, fin) de puntos de código NFC. */
export function textoEn(texto: string, caracteres: [number, number]): string {
  return Array.from(texto.normalize('NFC')).slice(caracteres[0], caracteres[1]).join('');
}

// ---------------------------------------------------------------------------
// Región por la capa de texto
// ---------------------------------------------------------------------------

const r4 = (x: number) => Math.round(x * 10000) / 10000;

export function unirRegiones(rs: Region[]): Region | undefined {
  if (!rs.length) return undefined;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: r4(x0), y: r4(y0), w: r4(x1 - x0), h: r4(y1 - y0) };
}

/**
 * La región de una cita en una página con capa de texto. Las líneas se unen por
 * su esqueleto, así que da igual cómo se partieran las palabras con guion o cómo
 * quedara el Markdown de la unidad.
 */
export function regionPorLineas(lineas: LineaPagina[], cita: string): { region: Region; lineas: number[]; confianza: number } | null {
  const q = esqueleto(cita).s;
  if (q.length < 3) return null;
  let s = '';
  const linea: number[] = [];
  const enLinea: number[] = [];
  const largos: number[] = [];
  lineas.forEach((l, k) => {
    const e = esqueleto(l.texto).s;
    largos.push(e.length);
    for (let i = 0; i < e.length; i++) { linea.push(k); enLinea.push(i); }
    s += e;
  });
  let a = s.indexOf(q), b = a >= 0 ? a + q.length - 1 : -1, confianza = 1;
  if (a < 0) {
    const n = Math.min(24, Math.floor(q.length / 3));
    if (n < 8) return null;
    a = s.indexOf(q.slice(0, n));
    const fin = a >= 0 ? s.indexOf(q.slice(-n), a + n) : -1;
    if (a < 0 || fin < 0 || fin + n - a > q.length * 1.5) return null;
    b = fin + n - 1; confianza = 0.75;
  }
  const la = linea[a]!, lb = linea[b]!;
  const parte = (k: number, desde: number, hasta: number): Region => {
    const l = lineas[k]!;
    const n = Math.max(1, largos[k]!);
    const x0 = l.x + (l.w * desde) / n, x1 = l.x + (l.w * (hasta + 1)) / n;
    return { x: x0, y: l.y, w: Math.max(0.001, x1 - x0), h: l.h };
  };
  const rs: Region[] = [];
  for (let k = la; k <= lb; k++) {
    const desde = k === la ? enLinea[a]! : 0;
    const hasta = k === lb ? enLinea[b]! : Math.max(0, largos[k]! - 1);
    // Las líneas intermedias, enteras: la cita ocupa todo su ancho.
    rs.push(k === la || k === lb ? parte(k, desde, hasta) : { x: lineas[k]!.x, y: lineas[k]!.y, w: lineas[k]!.w, h: lineas[k]!.h });
  }
  const region = unirRegiones(rs)!;
  return { region, lineas: Array.from({ length: lb - la + 1 }, (_, i) => la + i), confianza };
}

// ---------------------------------------------------------------------------
// Región por visión
// ---------------------------------------------------------------------------

const ESQUEMA_LOCALIZAR = {
  type: 'object',
  properties: {
    encontrada: { type: 'boolean' },
    cajas: {
      type: 'array',
      description: 'Una caja por cada línea (o trozo de línea) que ocupa la cita, en orden de lectura: [ymin, xmin, ymax, xmax] en 0-1000 sobre la imagen entera.',
      items: { type: 'array', items: { type: 'integer' } },
    },
  },
  required: ['encontrada', 'cajas'],
};

/** Localiza una cita en la imagen de una página con el modelo (y lo guarda en caché). */
export async function regionPorVision(p: PuertosAnclaje, claveImagen: string, cita: string): Promise<{ region: Region; cajas: Region[] } | null> {
  if (!p.redactor || !p.imagen) return null;
  const clave = `anclaje/${(await sha256(`${claveImagen}␟${cita.normalize('NFC')}`)).slice(0, 24)}.json`;
  const guardada = await p.cache?.leer(clave).catch(() => null);
  if (guardada) {
    try {
      const g = JSON.parse(guardada) as { region: Region | null; cajas: Region[] };
      return g.region ? { region: g.region, cajas: g.cajas } : null;
    } catch { /* se repite */ }
  }
  const img = await p.imagen(claveImagen);
  if (!img) return null;
  const r = await p.redactor.generar<{ encontrada?: boolean; cajas?: unknown[] }>({
    sistema: 'Localizas texto en imágenes de páginas (escaneos, fotos, pliegos de dos páginas). Devuelves cajas ajustadas a las letras, no a la columna entera.',
    mensajes: [{ rol: 'usuario', partes: [
      { bytes: img.bytes, mime: img.mime },
      { texto: `Localiza en la imagen este pasaje (puede venir con pequeñas diferencias de transcripción, sin guiones de fin de línea o con marcas de formato):\n«${cita}»\n\nDa una caja por cada línea que ocupa, desde la primera palabra hasta la última del pasaje. Si la imagen tiene dos páginas, usa las coordenadas de la imagen entera. Si no está, «encontrada»: false.` },
    ] }],
    esquema: ESQUEMA_LOCALIZAR,
    temperatura: 0,
    maxTokens: 2000,
    calidad: 'alta',
  });
  const cajas = (r.json?.encontrada !== false ? r.json?.cajas ?? [] : []).map(regionDeCaja).filter((x): x is Region => !!x);
  const region = unirRegiones(cajas) ?? null;
  await p.cache?.escribir(clave, JSON.stringify({ region, cajas })).catch(() => undefined);
  return region ? { region, cajas } : null;
}

// ---------------------------------------------------------------------------
// El puerto que llaman los demás equipos
// ---------------------------------------------------------------------------

/**
 * El ancla material de una cita o de unos caracteres de una unidad:
 * `caracteres` siempre que se encuentre, y `region` cuando la unidad es una
 * página (por la capa de texto si la hay; si no, por visión).
 */
export async function anclarMaterial(p: PuertosAnclaje, unidad: UnidadAnclable, o: { cita?: string; caracteres?: [number, number]; vision?: boolean }): Promise<AnclajeResultado> {
  let caracteres = o.caracteres;
  let confianza = caracteres ? 1 : 0;
  if (!caracteres && o.cita) {
    const b = buscarCita(unidad.texto, o.cita);
    if (b) { caracteres = b.caracteres; confianza = b.confianza; }
  }
  const texto = caracteres ? textoEn(unidad.texto, caracteres) : undefined;
  const ancla: AnclaMaterial = { ...unidad.ancla, ...(caracteres ? { caracteres } : {}) };
  const buscado = o.cita ?? texto;
  if (!buscado || unidad.ancla.tipo !== 'pagina') return { ancla, metodo: 'ninguno', ...(texto ? { texto } : {}), confianza };

  const lineas = p.lineas ? await p.lineas(unidad.ancla.fisica).catch(() => null) : null;
  if (lineas?.length) {
    const r = regionPorLineas(lineas, buscado);
    if (r) return { ancla: { ...ancla, region: r.region }, metodo: 'capa', ...(texto ? { texto } : {}), confianza: Math.max(confianza, r.confianza * 0.9) };
  }
  if (o.vision !== false && unidad.imagen) {
    const r = await regionPorVision(p, unidad.imagen, buscado).catch(() => null);
    if (r) return { ancla: { ...ancla, region: r.region }, metodo: 'vision', ...(texto ? { texto } : {}), confianza: Math.max(confianza, 0.8) };
  }
  return { ancla, metodo: 'ninguno', ...(texto ? { texto } : {}), confianza };
}
