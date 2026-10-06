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
  /** Personaje de ficción (no se enlaza con una persona real de Wikidata). */
  ficticia?: boolean;
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
  ficticia?: boolean;
}

export interface UsoLote {
  tokensEntrada: number;
  tokensSalida: number;
  llamadas: number;
}

/** Caracteres por lote: unos 13 000 tokens de entrada, lo bastante para que el sistema y la salida pesen poco. */
export const CARACTERES_LOTE = 48_000;
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
  properties: { e: { type: 'array', items: { type: 'string' } } },
  required: ['e'],
} as const;

/*
 * Formato compacto de una línea por entidad («p|Julio Cortázar|Cortázar»):
 * con objetos JSON la salida era seis veces más larga (2300 tokens por lote
 * frente a 360), y la salida es lo caro.
 */
export const SISTEMA_EXTRACCION = `Eres el catalogador de una biblioteca académica. Recibes pasajes numerados de un mismo documento. Enumera las entidades con nombre que aparecen escritas en ellos, una por elemento del array «e», con este formato exacto:
tipo|Nombre canónico completo|forma escrita|forma escrita
- tipo: p persona real · q personaje de ficción · o obra (libro, cuento, poema, película, disco, canción, artículo, cuadro) · l lugar · g organización (institución, editorial, revista, grupo) · e evento · f fecha explícita («AAAA», «AAAA-MM» o «AAAA-MM-DD») · c concepto teórico o técnico central (como mucho 5).
- Nombre canónico completo: SIEMPRE el nombre entero que usaría una enciclopedia en español (o el original si no tiene forma española asentada), aunque el texto lo abrevie: «Geoffrey Chaucer» y no «Chaucer»; «Platón» aunque el texto diga «Plato»; «Johnny Carter» si el texto dice «Johnny» y se sabe quién es. Resuelve apodos e iniciales solo cuando el documento o el conocimiento general dejan claro a quién se refieren; si dudas, deja la forma tal cual.
- Formas escritas: las formas que aparecen en el texto y no son idénticas al nombre canónico, copiadas carácter por carácter. Si el texto usa exactamente el nombre canónico, no lo repitas.
Nada de pronombres, nombres comunes genéricos ni lo que no esté escrito en los pasajes. Como mucho 40 elementos: los más importantes.`;

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
    let codigo: string, nombre: string, crudas: unknown[];
    if (typeof x === 'string') {
      const partes = x.split('|').map((s) => s.trim());
      codigo = partes[0] ?? '';
      nombre = partes[1] ?? '';
      crudas = partes.slice(2);
    } else {
      // También se acepta la forma larga { n, t, f }.
      const o = x as { n?: unknown; t?: unknown; f?: unknown };
      codigo = typeof o.t === 'string' ? o.t : '';
      nombre = typeof o.n === 'string' ? o.n : '';
      crudas = Array.isArray(o.f) ? o.f : [];
    }
    const c = codigo.toLowerCase().slice(0, 1);
    const ficticia = c === 'q';
    const tipo = ficticia ? 'persona' : CODIGOS_TIPO[c];
    nombre = nombre.replace(/\s+/g, ' ').replace(/^[«"“]+|[»"”]+$/g, '').trim();
    if (!tipo || !nombre || nombre.length > 160) continue;
    const formas = [...new Set(crudas.filter((s): s is string => typeof s === 'string')
      .map((s) => s.replace(/\s+/g, ' ').replace(/^[«"“]+|[»"”]+$/g, '').trim())
      .filter((s) => s.length >= 2 && s.length <= 160 && s !== nombre))];
    salida.push({ nombre, tipo, formas, ...(ficticia ? { ficticia: true } : {}) });
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
        maxTokens: 2048,
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
        candidatas.push({ fragmento: f.id, orden: f.orden, ancla: f.ancla, ini: c.ini, fin: c.fin, texto: f.texto.slice(c.ini, c.fin), nombre: e.nombre, tipo: e.tipo, ...(e.ficticia ? { ficticia: true } : {}) });
      }
    }
    salida.push(...sinSolapes(candidatas));
  }
  return salida;
}
