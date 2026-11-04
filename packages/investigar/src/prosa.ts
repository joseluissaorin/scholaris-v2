/**
 * Arreglos deterministas de la respuesta antes de darla por buena:
 *
 * - Sin localizadores en la prosa. Las páginas, los folios y los minutos los dan las
 *   marcas [E#] (que salen de anclas reales); uno escrito a mano en el texto («Cierre
 *   (pp. 35-37):») puede no existir. Se quitan todos; si la frase se queda sin ninguna
 *   marca y el localizador coincide con el ancla de una prueba ya citada, se cambia por
 *   su marca.
 * - Sin marcas en las tablas. Una fila se lee entera: cada marca tendría que sostener
 *   la fila completa y casi nunca lo hace. La tabla resume lo que la prosa ya cita.
 * - Las pruebas, renumeradas por orden de aparición tras los arreglos, y solo las que
 *   alguna frase cita.
 */
import type { Ancla } from '@scholaris/nucleo';
import type { EvidenciaInvestigacion } from '@scholaris/contrato';

const SEGUNDO = '\\d{1,2}:\\d{2}(?::\\d{2})?';
/** «pp. 35-37», «p. 14», «págs. 3 y 4», «pág. física 12», «p. [3]». */
const PAGINA = /\(?\s*(?:\b(?:en|de|desde|hasta)\s+)?(?:\b(?:la|las)\s+)?\b(?:pp?\.|págs?\.|páginas?)\s*(?:física\s+)?\[?(\d{1,4})\]?(?:\s*(?:[-–]|y|a)\s*\[?(\d{1,4})\]?)?\s*\)?/gi;
/** «1:45:03-1:45:50», «(9:36)», «del 9:36 al 13:05», «minuto 9:36», «minutos 40 y 41». */
const TIEMPO = new RegExp(
  `\\(?\\s*(?:\\b(?:(?:en|hacia|desde|hasta|a)\\s+(?:el|los)\\s+|del\\s+)?minutos?\\s+)?(?:\\b(?:del|desde\\s+el|entre\\s+el)\\s+)?(?<![\\d:])(${SEGUNDO})(?:\\s*(?:[-–]|al?|hasta(?:\\s+el)?|y\\s+el|to)\\s*(${SEGUNDO}))?(?![\\d:])\\s*\\)?`,
  'gi',
);
const MINUTO = /\(?\s*(?:\b(?:en|hacia|desde|hasta|a)\s+(?:el|los)\s+)?\bminutos?\s+(\d{1,3})(?![\d:])(?:\s*(?:[-–]|y|al?)\s*(\d{1,3})(?![\d:]))?\s*\)?/gi;

const aSegundos = (s: string): number => s.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);

interface Localizador { texto: string; desde: number; hasta: number; tipo: 'pagina' | 'tiempo' }

/** Los localizadores escritos en un trozo de texto. */
export function localizadoresEn(texto: string): Localizador[] {
  const salida: Localizador[] = [];
  for (const m of texto.matchAll(PAGINA)) salida.push({ texto: m[0], tipo: 'pagina', desde: Number(m[1]), hasta: Number(m[2] ?? m[1]) });
  for (const m of texto.matchAll(TIEMPO)) {
    const a = aSegundos(m[1] as string);
    salida.push({ texto: m[0], tipo: 'tiempo', desde: a, hasta: m[2] ? aSegundos(m[2]) : a });
  }
  for (const m of texto.matchAll(MINUTO)) salida.push({ texto: m[0], tipo: 'tiempo', desde: Number(m[1]) * 60, hasta: Number(m[2] ?? m[1]) * 60 + 59 });
  return salida;
}

/** ¿El localizador cae en el ancla de la prueba? */
function coincide(l: Localizador, a: Ancla, fin?: Ancla): boolean {
  if (l.tipo === 'pagina' && a.tipo === 'pagina') {
    const impresa = Number(a.impresa), impresaFin = fin?.tipo === 'pagina' ? Number(fin.impresa) : impresa;
    if (Number.isFinite(impresa) && l.desde <= (Number.isFinite(impresaFin) ? impresaFin : impresa) + 1 && l.hasta >= impresa) return true;
    return l.desde === a.fisica;
  }
  if (l.tipo === 'tiempo' && a.tipo === 'tiempo') {
    const t1 = fin?.tipo === 'tiempo' ? fin.t1 : a.t1;
    return l.desde <= t1 + 2 && Math.max(l.hasta, l.desde) >= a.t0 - 2;
  }
  return false;
}

const MARCA = /\[E\d+\]/g;
const esTabla = (linea: string) => /^\s*\|/.test(linea);
const esListaPruebas = (linea: string) => /^\s*-\s*\[E\d+\]\s/.test(linea);

/** Limpia lo que deja un localizador quitado: paréntesis vacíos, dobles espacios, espacios ante signos. */
function limpiar(s: string): string {
  return s
    .replace(/\(\s*[,;:–-]?\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\s+([,.;:)\]»])/g, '$1')
    .replace(/([(«])\s+/g, '$1')
    .replace(/,\s*([.;:])/g, '$1')
    .replace(/(\*\*|__)\s*(\*\*|__)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +$/gm, '');
}

/**
 * Quita los localizadores de la prosa (también de títulos y tablas, nunca de la lista de
 * pruebas del final). Devuelve el texto y cuántos quitó y cuántos cambió por una marca.
 */
export function quitarLocalizadores(markdown: string, evidencias: ReadonlyArray<Pick<EvidenciaInvestigacion, 'id' | 'ancla' | 'anclaFin'>>): { markdown: string; quitados: number; convertidos: number } {
  let quitados = 0, convertidos = 0;
  const lineas = markdown.split('\n').map((linea) => {
    if (esListaPruebas(linea)) return linea;
    // Frase a frase dentro de la línea, para saber si se queda sin marcas.
    // (sin cortar tras abreviaturas: «pp. 35», «cap. 7»)
    return linea.split(/(?<=[.!?…])(?<!(?:^|[\s(])(?:p|pp|pág|págs|cap|caps|vol|núm|n|fig|cf|ss|s)\.)(\s+)/i).map((frase) => {
      const ls = localizadoresEn(frase);
      if (!ls.length) return frase;
      let nueva = frase;
      const anadir: string[] = [];
      for (const l of ls) {
        nueva = nueva.replace(l.texto, ' ');
        quitados++;
        const tieneMarca = MARCA.test(frase);
        MARCA.lastIndex = 0;
        if (!tieneMarca && !esTabla(linea)) {
          const e = evidencias.find((x) => coincide(l, x.ancla, x.anclaFin));
          if (e && !anadir.includes(e.id)) { anadir.push(e.id); convertidos++; }
        }
      }
      nueva = limpiar(nueva);
      // Lo que queda colgando al principio (un espacio, una coma) si lo quitado abría la frase.
      if (!/^\s/.test(frase)) nueva = nueva.replace(/^[\s,;:]+/, '');
      // Si lo quitado abría la frase, la frase vuelve a empezar con mayúscula.
      const inicio = /^(\s*(?:[-*>]\s+|\d+[.)]\s+|\*\*|__)*)(\p{Ll})/u.exec(nueva);
      if (inicio && /^\s*(?:[-*>]\s+|\d+[.)]\s+|\*\*|__)*\p{Lu}/u.test(frase)) nueva = `${inicio[1]}${inicio[2]!.toUpperCase()}${nueva.slice(inicio[0].length)}`;
      if (anadir.length) {
        const marcas = anadir.map((id) => `[${id}]`).join('');
        nueva = /[.!?…]\s*$/.test(nueva) ? nueva.replace(/\s*([.!?…])\s*$/, ` ${marcas}$1`) : `${nueva} ${marcas}`;
      }
      return nueva;
    }).join('');
  });
  return { markdown: limpiar(lineas.join('\n')), quitados, convertidos };
}

/** Quita las marcas de las filas de las tablas (la cabecera y el separador no llevan). */
export function tablasSinMarcas(markdown: string): { markdown: string; quitadas: number } {
  let quitadas = 0;
  const salida = markdown.split('\n').map((l) => {
    if (!esTabla(l)) return l;
    const n = (l.match(MARCA) ?? []).length;
    if (!n) return l;
    quitadas += n;
    return l.replace(/\s*\[E\d+\]/g, '').replace(/ +\|/g, ' |');
  });
  return { markdown: salida.join('\n'), quitadas };
}

/**
 * Renumera las marcas por orden de aparición (E1, E2…) y deja solo las pruebas que alguna
 * frase cita. Las marcas que no correspondan a ninguna prueba se quitan.
 */
export function renumerar<T extends { id: string }>(markdown: string, evidencias: readonly T[]): { markdown: string; evidencias: T[]; mapa: Map<string, string> } {
  const porId = new Map(evidencias.map((e) => [e.id, e]));
  const nuevo = new Map<string, string>();
  const salida: T[] = [];
  const texto = markdown.replace(/\[(E\d+)\]/g, (todo, id: string) => {
    const e = porId.get(id);
    if (!e) return '';
    let n = nuevo.get(id);
    if (!n) {
      n = `E${nuevo.size + 1}`;
      nuevo.set(id, n);
      salida.push({ ...e, id: n });
    }
    return `[${n}]`;
  });
  return { markdown: texto.replace(/\[(E\d+)\]\[\1\]/g, '[$1]'), evidencias: salida, mapa: nuevo };
}
