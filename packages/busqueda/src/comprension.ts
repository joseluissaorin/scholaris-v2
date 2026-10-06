/**
 * Entender una consulta en UNA llamada rápida al redactor: intención,
 * expansiones (paráfrasis, enunciado, HyDE), traducciones para buscar entre
 * lenguas y filtros dichos en lenguaje natural. Antes de llamar al modelo se
 * aplica una capa heurística determinista (comillas, años, autores conocidos,
 * «ir a la página»), que es también la respuesta si el modelo falla o tarda.
 */
import type { Filtros, Redactor, TipoEntrada } from '@scholaris/nucleo';
import type { Comprension, Expansion, Intencion } from './tipos.js';
import { citasLiterales, normalizarConsulta, plegar } from './texto.js';

export const IDIOMAS_BUSQUEDA = ['es', 'en', 'fr', 'it', 'la', 'de'] as const;

// ---------------------------------------------------------------------------
// Heurística (portada de query_expander.py y ampliada)
// ---------------------------------------------------------------------------

const CLAVES_VISUAL = ['show', 'image', 'picture', 'photo', 'diagram', 'chart', 'graph', 'figure', 'illustration', 'look like', 'video', 'frame', 'scene', 'screenshot',
  'imagen', 'foto', 'diagrama', 'grafico', 'mostrar', 'figura', 'lamina', 'ilustracion', 'esquema', 'mapa', 'tabla', 'grabado', 'manuscrito', 'portada',
  'diagramme', 'graphique', 'montrer', 'illustration', 'immagine', 'grafico', 'bild', 'diagramm', 'grafik', 'zeigen', 'abbildung'];
const CLAVES_CITA = ['quote', 'said', 'stated', 'according to', 'cited', 'who said', 'testimony',
  'cita textual', 'dijo', 'quien dijo', 'frase', 'literal', 'citation', 'qui a dit', 'chi disse', 'zitat', 'sagte', 'wer sagte'];
const CLAVES_TEMPORAL = ['when', 'timeline', 'chronology', 'cuando', 'cronologia', 'en que ano', 'en que siglo', 'fecha', 'epoca', 'periodo',
  'quand', 'chronologie', 'quando', 'cronologia', 'wann', 'zeitlinie', 'siglo', 'century', 'siecle', 'secolo', 'jahrhundert'];

function contieneClave(plano: string, claves: string[]): boolean {
  return claves.some((k) => new RegExp(`(?<![\\p{L}])${k}(?![\\p{L}])`, 'u').test(plano));
}

export function intencionHeuristica(consulta: string): Intencion {
  if (citasLiterales(consulta).length) return 'cita';
  const p = plegar(consulta);
  if (contieneClave(p, CLAVES_VISUAL)) return 'visual';
  if (contieneClave(p, CLAVES_CITA)) return 'cita';
  if (contieneClave(p, CLAVES_TEMPORAL)) return 'temporal';
  return 'conceptual';
}

const MARCAS_IDIOMA: Record<string, string[]> = {
  es: ['el', 'la', 'los', 'las', 'de', 'del', 'que', 'en', 'y', 'por', 'para', 'con', 'una', 'como', 'se', 'su', 'es', 'qué', 'cómo'],
  en: ['the', 'of', 'and', 'in', 'to', 'is', 'what', 'how', 'why', 'which', 'with', 'for', 'on', 'does', 'about'],
  fr: ['le', 'les', 'des', 'du', 'et', 'est', 'une', 'dans', 'pour', 'qui', 'que', 'pas', 'sur', 'au', 'aux'],
  it: ['il', 'gli', 'della', 'delle', 'che', 'e', 'per', 'una', 'con', 'non', 'nel', 'sono', 'del', 'dei'],
  la: ['et', 'est', 'in', 'non', 'ad', 'cum', 'quod', 'sed', 'ut', 'qui', 'quae', 'enim', 'atque', 'ac', 'sunt', 'esse'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'mit', 'von', 'zu', 'den', 'im', 'auf', 'wie'],
};

/** Idioma probable de un texto corto (por palabras funcionales). Por defecto, «es». */
export function detectarIdioma(texto: string, porDefecto = 'es'): string {
  const palabras = texto.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  let mejor = porDefecto, max = 0;
  for (const [idioma, marcas] of Object.entries(MARCAS_IDIOMA)) {
    const set = new Set(marcas);
    const n = palabras.filter((w) => set.has(w)).length;
    if (n > max) { max = n; mejor = idioma; }
  }
  if (/[ñ¿¡]/.test(texto)) return 'es';
  return mejor;
}

export interface ContextoComprension {
  /** Apellidos de los autores presentes en la estantería (para filtros). */
  autores?: string[];
  /** Idiomas presentes en la estantería (para decidir a qué traducir). */
  idiomas?: string[];
}

interface Heuristica {
  filtros: Filtros;
  literales: string[];
  irA?: { folio: string; pista?: string };
}

const N = '(\\d{3,4})';

/** Filtros, comillas y saltos de página que se leen sin modelo. */
export function analizarHeuristico(consulta: string, ctx: ContextoComprension = {}): Heuristica {
  const p = plegar(consulta);
  const filtros: Filtros = {};
  let m: RegExpMatchArray | null;
  if ((m = p.match(new RegExp(`\\b(?:entre|between|entre les annees|tra il|zwischen)\\s+${N}\\s+(?:y|and|et|e|und|-)\\s+${N}`)))) {
    filtros.anioDesde = Math.min(Number(m[1]), Number(m[2]));
    filtros.anioHasta = Math.max(Number(m[1]), Number(m[2]));
  } else {
    if ((m = p.match(new RegExp(`\\b(?:antes de|anterior(?:es)? a|before|prior to|avant|prima del?|vor)\\s+(?:del?\\s+|el\\s+|l'|the\\s+)?(?:ano\\s+|year\\s+)?${N}`)))) filtros.anioHasta = Number(m[1]) - 1;
    if ((m = p.match(new RegExp(`\\b(?:hasta|until|till|jusqu'en|fino al|bis)\\s+(?:el\\s+)?${N}`)))) filtros.anioHasta = Number(m[1]);
    if ((m = p.match(new RegExp(`\\b(?:despues de|posterior(?:es)? a|tras|after|apres|dopo il?|nach)\\s+(?:del?\\s+|el\\s+|l'|the\\s+)?(?:ano\\s+|year\\s+)?${N}`)))) filtros.anioDesde = Number(m[1]) + 1;
    if ((m = p.match(new RegExp(`\\b(?:desde|since|depuis|dal|seit)\\s+(?:el\\s+)?${N}`)))) filtros.anioDesde = Number(m[1]);
  }
  if (ctx.autores?.length) {
    const encontrados: string[] = [];
    for (const a of ctx.autores) {
      const pa = plegar(a).trim();
      if (pa.length < 3) continue;
      if (new RegExp(`(?<![\\p{L}])${pa.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(p) && !encontrados.includes(a)) encontrados.push(a);
    }
    if (encontrados.length) filtros.autores = encontrados;
  }
  let irA: Heuristica['irA'];
  const pag = p.match(/^\s*(?:ir a (?:la )?|ve a (?:la )?|abre (?:la )?|go to |aller a la )?(?:pagina|pag\.?|p\.|page|folio|fol\.|seite|pagine?)\s*([0-9]{1,5}|[ivxlcdm]{1,8})\b(?:\s+(?:de|del|of|in|en|di|von)\s+(.+?))?\s*$/);
  if (pag) irA = { folio: pag[1] as string, ...(pag[2] ? { pista: consulta.slice(consulta.length - pag[2].length).trim() } : {}) };
  return { filtros, literales: citasLiterales(consulta), ...(irA ? { irA } : {}) };
}

// ---------------------------------------------------------------------------
// Llamada al modelo
// ---------------------------------------------------------------------------

interface SalidaModelo {
  intencion?: string;
  idioma?: string;
  parafrasis?: string[];
  enunciado?: string | null;
  hyde?: string | null;
  traducciones?: Record<string, string>;
  filtros?: { autores?: string[]; anioDesde?: number | null; anioHasta?: number | null; idiomas?: string[]; tipos?: string[] };
}

export const ESQUEMA_COMPRENSION = {
  type: 'object',
  properties: {
    intencion: { type: 'string', enum: ['conceptual', 'visual', 'cita', 'temporal'] },
    idioma: { type: 'string' },
    parafrasis: { type: 'array', items: { type: 'string' }, maxItems: 2 },
    enunciado: { type: ['string', 'null'] },
    hyde: { type: ['string', 'null'] },
    traducciones: { type: 'object', additionalProperties: { type: 'string' } },
    filtros: {
      type: 'object',
      properties: {
        autores: { type: 'array', items: { type: 'string' } },
        anioDesde: { type: ['integer', 'null'] },
        anioHasta: { type: ['integer', 'null'] },
        idiomas: { type: 'array', items: { type: 'string' } },
        tipos: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  required: ['intencion', 'parafrasis', 'traducciones', 'filtros'],
} as const;

const SISTEMA = `Eres el módulo de comprensión de consultas de una biblioteca académica (Scholaris).
Recibes una consulta de búsqueda y devuelves SOLO JSON con:
- intencion: "conceptual" (ideas, definiciones), "visual" (imágenes, láminas, esquemas, fotogramas), "cita" (busca una frase literal o quién dijo qué), "temporal" (fechas, épocas, cronología).
- idioma: código ISO 639-1 de la consulta ("la" para latín).
- parafrasis: 2 reformulaciones breves con otras palabras que podrían aparecer en los textos, en el idioma de la consulta.
- enunciado: si es una pregunta, la afirmación que la respondería tal como aparecería en un texto; si no, null.
- hyde: un pasaje académico hipotético de 2-3 frases que respondería a la consulta, en su idioma (no inventes citas ni páginas).
- traducciones: la consulta traducida a CADA idioma pedido, con terminología académica de ese idioma (en latín, la forma clásica).
- filtros: SOLO lo que la consulta pide expresamente: autores (apellidos) si dice «en X», «según X», «de X»; anioDesde/anioHasta si habla de fechas de publicación («antes de 1980» → anioHasta 1979); idiomas si pide textos en un idioma; tipos entre pdf, audio, video, imagen, epub, web, presentacion, hoja, documento. Si no hay filtro, deja el campo vacío.`;

const TIPOS_VALIDOS = new Set<TipoEntrada>(['pdf', 'pdf_escaneado', 'fotos', 'imagen', 'audio', 'video', 'documento', 'epub', 'presentacion', 'hoja', 'web']);

function anioValido(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isInteger(n) && n > -3000 && n < 2200 ? n : undefined;
}

/** Valida lo que dice el modelo: nada de filtros que dejen la estantería vacía por error. */
function validarSalida(s: SalidaModelo, consulta: string, ctx: ContextoComprension, objetivos: string[]): Omit<Comprension, 'consulta' | 'normalizada' | 'literales' | 'origen'> {
  const intencion = (['conceptual', 'visual', 'cita', 'temporal'] as const).find((i) => i === s.intencion) ?? intencionHeuristica(consulta);
  const limpio = (t: unknown) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '');
  const expansiones: Expansion[] = [{ texto: consulta, tipo: 'original', peso: 1 }];
  const vistas = new Set([normalizarConsulta(consulta)]);
  const agregar = (texto: string, tipo: Expansion['tipo'], peso: number, idioma?: string) => {
    const t = limpio(texto).slice(0, 600);
    const n = normalizarConsulta(t);
    if (t.length < 3 || vistas.has(n)) return;
    vistas.add(n);
    expansiones.push({ texto: t, tipo, peso, ...(idioma ? { idioma } : {}) });
  };
  for (const pf of (s.parafrasis ?? []).slice(0, 2)) agregar(pf, 'parafrasis', 0.85);
  if (s.enunciado) agregar(s.enunciado, 'enunciado', 0.9);
  if (s.hyde) agregar(s.hyde, 'hyde', 0.7);
  const traducciones: Record<string, string> = {};
  for (const [idioma, texto] of Object.entries(s.traducciones ?? {})) {
    const i = idioma.toLowerCase().slice(0, 2);
    if (!objetivos.includes(i) || !limpio(texto)) continue;
    traducciones[i] = limpio(texto);
    agregar(texto, 'traduccion', 0.8, i);
  }
  const filtros: Filtros = {};
  const f = s.filtros ?? {};
  // Autores: solo los que existen en la estantería (si se conoce).
  const autores = (f.autores ?? []).map(limpio).filter(Boolean);
  if (autores.length) {
    const conocidos = ctx.autores;
    const validos = conocidos ? autores.map((a) => conocidos.find((c) => plegar(c) === plegar(a) || plegar(a).includes(plegar(c)) || plegar(c).includes(plegar(a)))).filter((x): x is string => !!x) : autores;
    if (validos.length) filtros.autores = [...new Set(validos)];
  }
  const d = anioValido(f.anioDesde), h = anioValido(f.anioHasta);
  if (d !== undefined) filtros.anioDesde = d;
  if (h !== undefined) filtros.anioHasta = h;
  if (d !== undefined && h !== undefined && d > h) { delete filtros.anioDesde; delete filtros.anioHasta; }
  const idiomas = (f.idiomas ?? []).map((x) => limpio(x).toLowerCase().slice(0, 2)).filter((x) => x.length === 2);
  if (idiomas.length && (!ctx.idiomas || idiomas.some((i) => ctx.idiomas!.includes(i)))) filtros.idiomas = idiomas;
  const tipos = (f.tipos ?? []).filter((t): t is TipoEntrada => TIPOS_VALIDOS.has(t as TipoEntrada));
  if (tipos.length) filtros.tipos = tipos;
  return { intencion, expansiones, traducciones, filtros };
}

/** Une filtros: los explícitos mandan; los años se intersecan. */
export function unirFiltros(base: Filtros, extra: Filtros): Filtros {
  const r: Filtros = { ...extra, ...Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined)) };
  if (base.anioDesde !== undefined || extra.anioDesde !== undefined) r.anioDesde = Math.max(base.anioDesde ?? -Infinity, extra.anioDesde ?? -Infinity);
  if (base.anioHasta !== undefined || extra.anioHasta !== undefined) r.anioHasta = Math.min(base.anioHasta ?? Infinity, extra.anioHasta ?? Infinity);
  return r;
}

/** Comprensión sin modelo (heurística pura). */
export function comprenderSinModelo(consulta: string, ctx: ContextoComprension = {}): Comprension {
  const h = analizarHeuristico(consulta, ctx);
  return {
    consulta,
    normalizada: normalizarConsulta(consulta),
    intencion: intencionHeuristica(consulta),
    expansiones: [{ texto: consulta, tipo: 'original', peso: 1 }],
    traducciones: {},
    filtros: h.filtros,
    literales: h.literales,
    ...(h.irA ? { irA: h.irA } : {}),
    origen: 'heuristica',
  };
}

/**
 * Comprensión completa: heurística + una llamada al redactor (calidad «rápida»).
 * Si el modelo falla devuelve la heurística; nunca lanza.
 */
export async function comprenderConModelo(redactor: Redactor, consulta: string, ctx: ContextoComprension = {}): Promise<Comprension> {
  const base = comprenderSinModelo(consulta, ctx);
  const idiomaConsulta = detectarIdioma(consulta);
  const objetivos = (ctx.idiomas?.length ? ctx.idiomas : [...IDIOMAS_BUSQUEDA])
    .map((i) => i.toLowerCase().slice(0, 2))
    .filter((i, k, a) => i !== idiomaConsulta && (IDIOMAS_BUSQUEDA as readonly string[]).includes(i) && a.indexOf(i) === k);
  try {
    const r = await redactor.generar<SalidaModelo>({
      sistema: SISTEMA,
      mensajes: [{ rol: 'usuario', partes: [{ texto: JSON.stringify({ consulta, traducir_a: objetivos, autores_en_la_biblioteca: (ctx.autores ?? []).slice(0, 200) }) }] }],
      esquema: ESQUEMA_COMPRENSION as unknown as Record<string, unknown>,
      temperatura: 0.2,
      maxTokens: 700,
      calidad: 'rapida',
    });
    const salida = r.json ?? (JSON.parse(r.texto.slice(r.texto.indexOf('{'), r.texto.lastIndexOf('}') + 1)) as SalidaModelo);
    const v = validarSalida(salida, consulta, ctx, objetivos);
    return {
      ...base,
      intencion: base.literales.length ? 'cita' : v.intencion,
      expansiones: v.expansiones,
      traducciones: v.traducciones,
      // Lo leído con reglas (años, autores conocidos) es más fiable: manda.
      filtros: unirFiltros(base.filtros, v.filtros),
      origen: 'modelo',
    };
  } catch {
    return base;
  }
}
