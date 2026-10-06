/**
 * Extracción de entidades de un documento con el redactor rápido.
 *
 * Para gastar poco, el redactor NO devuelve menciones: devuelve, por lote de
 * pasajes, la lista de entidades distintas con su nombre canónico y las formas
 * exactas en que aparecen. Las menciones (fragmento, desplazamiento, ancla) se
 * localizan después aquí, buscando esas formas en el texto de los fragmentos
 * del lote. Así la salida, que es lo caro, crece con las entidades y no con
 * las menciones.
 */

import type { Ancla, Redactor } from '@scholaris/nucleo';
import type { TipoEntidad } from '@scholaris/contrato';
import { buscarFormas, CODIGOS_TIPO, rangosExcluidos, sinSolapes } from './normalizar.js';

export interface FragmentoEntidades {
  id: string;
  orden: number;
  texto: string;
  ancla: Ancla;
}

export interface Lote {
  indice: number;
  fragmentos: FragmentoEntidades[];
  caracteres: number;
}

export interface EntidadExtraida {
  nombre: string;
  tipo: TipoEntidad;
  formas: string[];
}

export interface MencionLocalizada {
  fragmento: string;
  orden: number;
  ancla: Ancla;
  ini: number;
  fin: number;
  texto: string;
  nombre: string;
  tipo: TipoEntidad;
}

export interface UsoLote {
  tokensEntrada: number;
  tokensSalida: number;
  llamadas: number;
}

/** Caracteres por lote: unos 5000 tokens de entrada, lo bastante para que el sistema pese poco. */
export const CARACTERES_LOTE = 20_000;
/** Un fragmento muy largo se recorta para el redactor (sus menciones se buscan en el texto entero). */
const MAX_FRAGMENTO = 4_000;

/** Lotes deterministas en el orden del documento: el mismo documento da siempre los mismos lotes. */
export function formarLotes(fragmentos: readonly FragmentoEntidades[], maxCaracteres = CARACTERES_LOTE): Lote[] {
  const lotes: Lote[] = [];
  let actual: Lote = { indice: 0, fragmentos: [], caracteres: 0 };
  for (const f of fragmentos) {
    const n = Math.min(f.texto.length, MAX_FRAGMENTO);
    if (actual.fragmentos.length && actual.caracteres + n > maxCaracteres) {
      lotes.push(actual);
      actual = { indice: lotes.length, fragmentos: [], caracteres: 0 };
    }
    actual.fragmentos.push(f);
    actual.caracteres += n;
  }
  if (actual.fragmentos.length) lotes.push(actual);
  return lotes;
}

export const ESQUEMA_EXTRACCION = {
  type: 'object',
  properties: {
    e: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'string' },
          t: { type: 'string', enum: Object.keys(CODIGOS_TIPO) },
          f: { type: 'array', items: { type: 'string' } },
        },
        required: ['n', 't', 'f'],
      },
    },
  },
  required: ['e'],
} as const;

export const SISTEMA_EXTRACCION = `Eres el catalogador de una biblioteca académica. Recibes pasajes numerados de un mismo documento y extraes las entidades con nombre que se mencionan en ellos.

Tipos (campo t):
p persona (también personajes de ficción) · o obra (libro, cuento, poema, película, disco, canción, artículo, cuadro) · l lugar · g organización (institución, editorial, revista, grupo) · e evento (guerra, congreso, revolución) · f fecha explícita · c concepto (solo los conceptos teóricos o técnicos centrales del pasaje, como mucho 8 por respuesta)

Para cada entidad:
- n: nombre canónico completo, el que usaría una enciclopedia («Julio Cortázar» aunque el texto diga «Cortázar» o «Julio»). Resuelve apodos, iniciales y nombres parciales cuando el texto o el conocimiento general lo dejan claro. Las obras, con su título habitual. Las fechas, como «AAAA», «AAAA-MM» o «AAAA-MM-DD».
- f: TODAS las formas en que aparece escrita en los pasajes, copiadas carácter por carácter (mismas tildes, mayúsculas y puntos), sin repetir. Solo formas que estén literalmente en el texto.

No incluyas pronombres, nombres comunes genéricos («el autor», «la ciudad»), ni nada que no esté escrito en los pasajes. Como mucho 60 entidades: si hay más, las más importantes. Responde solo con el JSON.`;

/** Tokens aproximados (sin tokenizador): basta para estimar el coste. */
export const tokensAprox = (s: string) => Math.ceil(s.length / 3.6);

/** Precio del redactor rápido (Gemini Flash-Lite), en dólares por millón de tokens. */
export const PRECIO_RAPIDO = { entrada: 0.3, salida: 2.5 };

export function usdAprox(uso: Pick<UsoLote, 'tokensEntrada' | 'tokensSalida'>): number {
  return (uso.tokensEntrada * PRECIO_RAPIDO.entrada + uso.tokensSalida * PRECIO_RAPIDO.salida) / 1e6;
}

export interface ContextoDocumento {
  titulo: string;
  autores: string[];
  anio: number | null;
}

function peticionLote(lote: Lote, doc: ContextoDocumento): string {
  const cabecera = `Documento: «${doc.titulo || 'sin título'}»${doc.autores.length ? `, de ${doc.autores.slice(0, 3).join(', ')}` : ''}${doc.anio ? ` (${doc.anio})` : ''}.`;
  const pasajes = lote.fragmentos.map((f, i) => `[${i + 1}] ${f.texto.slice(0, MAX_FRAGMENTO).replace(/\s+\n/g, '\n').trim()}`).join('\n\n');
  return `${cabecera}\n\n${pasajes}`;
}

/** Lo que devuelve el redactor, limpio: tipos conocidos, nombres y formas no vacíos. */
export function leerRespuesta(json: unknown): EntidadExtraida[] {
  const lista = (json as { e?: unknown })?.e;
  if (!Array.isArray(lista)) return [];
  const salida: EntidadExtraida[] = [];
  for (const x of lista) {
    const o = x as { n?: unknown; t?: unknown; f?: unknown };
    const tipo = typeof o.t === 'string' ? CODIGOS_TIPO[o.t.trim().toLowerCase().slice(0, 1)] : undefined;
    const nombre = typeof o.n === 'string' ? o.n.replace(/\s+/g, ' ').trim() : '';
    if (!tipo || !nombre || nombre.length > 160) continue;
    const formas = [...new Set((Array.isArray(o.f) ? o.f : []).filter((s): s is string => typeof s === 'string').map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length >= 2 && s.length <= 160))];
    salida.push({ nombre, tipo, formas });
  }
  return salida;
}

/** Una llamada al redactor por lote (con un reintento). */
export async function extraerLote(redactor: Redactor, lote: Lote, doc: ContextoDocumento): Promise<{ entidades: EntidadExtraida[]; uso: UsoLote }> {
  const texto = peticionLote(lote, doc);
  const uso: UsoLote = { tokensEntrada: 0, tokensSalida: 0, llamadas: 0 };
  let ultimo: unknown;
  for (let intento = 0; intento < 2; intento++) {
    uso.llamadas++;
    uso.tokensEntrada += tokensAprox(SISTEMA_EXTRACCION) + tokensAprox(texto);
    try {
      const r = await redactor.generar<{ e: unknown }>({
        sistema: SISTEMA_EXTRACCION,
        mensajes: [{ rol: 'usuario', partes: [{ texto }] }],
        esquema: ESQUEMA_EXTRACCION as unknown as Record<string, unknown>,
        calidad: 'rapida',
        temperatura: 0,
        maxTokens: 4096,
      });
      uso.tokensSalida += tokensAprox(r.texto ?? '');
      return { entidades: leerRespuesta(r.json ?? safeParse(r.texto)), uso };
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error(String(ultimo));
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Busca las formas de cada entidad en los fragmentos del lote. El nombre
 * canónico también cuenta como forma. Sin solapes dentro de un fragmento
 * («Charlie Parker» gana a «Parker»); las etiquetas de hablante no cuentan.
 */
export function localizarMenciones(lote: Lote, entidades: readonly EntidadExtraida[]): MencionLocalizada[] {
  const salida: MencionLocalizada[] = [];
  for (const f of lote.fragmentos) {
    const excluidos = rangosExcluidos(f.texto);
    const candidatas: Array<MencionLocalizada> = [];
    for (const e of entidades) {
      const formas = [...new Set([...e.formas, e.nombre])];
      const propio = e.tipo !== 'concepto';
      for (const c of buscarFormas(f.texto, formas, propio, excluidos)) {
        candidatas.push({ fragmento: f.id, orden: f.orden, ancla: f.ancla, ini: c.ini, fin: c.fin, texto: f.texto.slice(c.ini, c.fin), nombre: e.nombre, tipo: e.tipo });
      }
    }
    salida.push(...sinSolapes(candidatas));
  }
  return salida;
}
