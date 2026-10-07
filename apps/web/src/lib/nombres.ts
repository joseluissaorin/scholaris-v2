/**
 * Nombres legibles de códigos que guarda la ficha: el idioma (ISO 639, «es»,
 * «en», «la») y el tipo CSL («chapter», «article-journal»). En la ficha se
 * guarda el código; a la persona se le enseña el nombre, en el idioma de la
 * interfaz.
 */

/** El idioma de la interfaz (el `lang` de la página; la app está en español). */
export function idiomaInterfaz(): string {
  return (typeof document !== 'undefined' && document.documentElement.lang) || 'es';
}

const nombresIdioma = new Map<string, Intl.DisplayNames | null>();

/** «es» → «Español», «la» → «Latín», «pt-BR» → «Portugués (Brasil)». Lo que no es un código, tal cual. */
export function nombreIdioma(codigo: string | null | undefined, interfaz = idiomaInterfaz()): string {
  const c = (codigo ?? '').trim();
  if (!c) return '';
  if (!nombresIdioma.has(interfaz)) {
    try { nombresIdioma.set(interfaz, new Intl.DisplayNames([interfaz], { type: 'language', fallback: 'none' })); } catch { nombresIdioma.set(interfaz, null); }
  }
  let n: string | undefined;
  try { n = nombresIdioma.get(interfaz)?.of(c); } catch { /* no es un código BCP 47 */ }
  if (!n || n.toLowerCase() === c.toLowerCase()) return c;
  return n.charAt(0).toLocaleUpperCase(interfaz) + n.slice(1);
}

/** Los tipos de CSL 1.0.2, en español. */
const TIPOS_CSL: Record<string, string> = {
  article: 'Artículo',
  'article-journal': 'Artículo de revista',
  'article-magazine': 'Artículo de revista divulgativa',
  'article-newspaper': 'Artículo de prensa',
  bill: 'Proyecto de ley',
  book: 'Libro',
  broadcast: 'Emisión (radio o televisión)',
  chapter: 'Capítulo',
  classic: 'Obra clásica',
  collection: 'Colección',
  dataset: 'Conjunto de datos',
  document: 'Documento',
  entry: 'Entrada',
  'entry-dictionary': 'Entrada de diccionario',
  'entry-encyclopedia': 'Entrada de enciclopedia',
  event: 'Acontecimiento',
  figure: 'Figura',
  graphic: 'Obra gráfica',
  hearing: 'Comparecencia',
  interview: 'Entrevista',
  legal_case: 'Caso judicial',
  legislation: 'Legislación',
  manuscript: 'Manuscrito',
  map: 'Mapa',
  motion_picture: 'Película',
  musical_score: 'Partitura',
  pamphlet: 'Folleto',
  'paper-conference': 'Ponencia',
  patent: 'Patente',
  performance: 'Representación',
  periodical: 'Publicación periódica',
  personal_communication: 'Comunicación personal',
  post: 'Publicación en línea',
  'post-weblog': 'Entrada de blog',
  regulation: 'Reglamento',
  report: 'Informe',
  review: 'Reseña',
  'review-book': 'Reseña de libro',
  software: 'Programa informático',
  song: 'Canción o grabación',
  speech: 'Discurso o conferencia',
  standard: 'Norma',
  thesis: 'Tesis',
  treaty: 'Tratado',
  webpage: 'Página web',
};

/** «chapter» → «Capítulo». Un tipo desconocido, tal cual. */
export function nombreTipoCsl(tipo: string | null | undefined): string {
  const t = (tipo ?? '').trim();
  return TIPOS_CSL[t] ?? t;
}
