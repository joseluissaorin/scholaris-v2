/// <reference path="./citeproc.d.ts" />
/**
 * Motor CSL sobre citeproc-js con los estilos y configuraciones regionales
 * oficiales vendorizados (src/csl/vendor, generados con scripts/vendorizar-csl.mjs).
 * Se cargan por import dinámico: funcionan en Workers, Durable Objects, Node y
 * navegador sin sistema de ficheros.
 */
import CSL, { type MotorCiteproc } from 'citeproc';
import type { Ancla } from '@scholaris/nucleo';
import { htmlAMarkdown, htmlATexto, htmlATramos, type Tramo } from './html.js';
import { aItemCSL, localizador, type DocumentoCitable, type ItemCSL } from './mapeo.js';

export type FormatoEstilo = 'autor-fecha' | 'numérico' | 'nota';

export interface EstiloCsl { id: string; titulo: string; formato: FormatoEstilo }

const ESTILOS: Record<string, EstiloCsl & { cargar: () => Promise<{ default: string }> }> = {
  apa: { id: 'apa', titulo: 'APA, 7.ª edición', formato: 'autor-fecha', cargar: () => import('./vendor/estilos/apa.js') },
  'chicago-author-date': { id: 'chicago-author-date', titulo: 'Chicago, 18.ª edición (autor-fecha)', formato: 'autor-fecha', cargar: () => import('./vendor/estilos/chicago-author-date.js') },
  'chicago-note-bibliography': { id: 'chicago-note-bibliography', titulo: 'Chicago, 18.ª edición (notas y bibliografía)', formato: 'nota', cargar: () => import('./vendor/estilos/chicago-note-bibliography.js') },
  mla: { id: 'mla', titulo: 'MLA, 9.ª edición', formato: 'autor-fecha', cargar: () => import('./vendor/estilos/mla.js') },
  harvard: { id: 'harvard', titulo: 'Harvard (Cite Them Right, 12.ª edición)', formato: 'autor-fecha', cargar: () => import('./vendor/estilos/harvard.js') },
  iso690: { id: 'iso690', titulo: 'ISO 690 (autor-fecha, español)', formato: 'autor-fecha', cargar: () => import('./vendor/estilos/iso690.js') },
  'iso690-en': { id: 'iso690-en', titulo: 'ISO 690 (autor-fecha, inglés)', formato: 'autor-fecha', cargar: () => import('./vendor/estilos/iso690-en.js') },
  'iso690-numerico': { id: 'iso690-numerico', titulo: 'ISO 690 (numérico)', formato: 'numérico', cargar: () => import('./vendor/estilos/iso690-numerico.js') },
  ieee: { id: 'ieee', titulo: 'IEEE', formato: 'numérico', cargar: () => import('./vendor/estilos/ieee.js') },
};

const ALIAS: Record<string, string> = {
  apa7: 'apa', 'apa-7': 'apa', chicago: 'chicago-author-date', chicago17: 'chicago-author-date', 'chicago-notes-bibliography': 'chicago-note-bibliography',
  'chicago-notas': 'chicago-note-bibliography', 'modern-language-association': 'mla', 'harvard-cite-them-right': 'harvard', 'iso-690': 'iso690',
  'iso690-author-date-es': 'iso690', 'iso690-author-date-en': 'iso690-en', 'iso690-numeric-en': 'iso690-numerico',
};

const LOCALES: Record<string, () => Promise<{ default: string }>> = {
  'es-ES': () => import('./vendor/locales/es-ES.js'),
  'en-US': () => import('./vendor/locales/en-US.js'),
  'fr-FR': () => import('./vendor/locales/fr-FR.js'),
  'it-IT': () => import('./vendor/locales/it-IT.js'),
};

/** Estilos disponibles, con filtro por texto. */
export function listarEstilos(q?: string): EstiloCsl[] {
  const t = q?.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return Object.values(ESTILOS)
    .map(({ id, titulo, formato }) => ({ id, titulo, formato }))
    .filter((e) => !t || `${e.id} ${e.titulo}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(t));
}

export function resolverEstilo(id: string): string {
  const k = id.toLowerCase();
  return ESTILOS[k] ? k : ALIAS[k] ?? 'apa';
}

/** «es» → «es-ES»; lo que no está, «en-US». */
export function resolverIdioma(idioma?: string): string {
  if (!idioma) return 'es-ES';
  if (LOCALES[idioma]) return idioma;
  const corto = idioma.slice(0, 2).toLowerCase();
  return Object.keys(LOCALES).find((l) => l.startsWith(corto)) ?? 'en-US';
}

const cacheEstilos = new Map<string, Promise<string>>();
const cacheLocales = new Map<string, string>();

/**
 * El locale es-ES de CSL deja sin traducir algunos términos («broadcast»,
 * «on», «video»…) y salen en inglés en las referencias en español. Se corrigen
 * aquí, sin tocar el fichero vendorizado.
 */
const TERMINOS_ES: Record<string, string> = {
  broadcast: 'emisión',
  on: 'en',
  video: 'vídeo',
  podcast: 'pódcast',
  'podcast-episode': 'episodio de pódcast',
  'television-series': 'serie de televisión',
  'television-series-episode': 'episodio de serie de televisión',
  'radio-series': 'serie de radio',
  'radio-series-episode': 'episodio de serie de radio',
  'online': 'en línea',
};

export function parchearLocale(id: string, xml: string): string {
  if (!id.startsWith('es')) return xml;
  let out = xml;
  for (const [nombre, valor] of Object.entries(TERMINOS_ES)) {
    // Solo la forma larga sin traducir (el contenido coincide con el nombre en inglés o falta).
    out = out.replace(new RegExp(`(<term name="${nombre}">)([^<]*)(</term>)`, 'g'), (m, a, contenido: string, c) => (/^[a-z -]*$/.test(contenido) && /[a-z]/.test(contenido) && !/[áéíóúñ]/.test(contenido) && (contenido === nombre || contenido === nombre.replace(/-/g, ' ') || contenido === 'on') ? `${a}${valor}${c}` : m));
  }
  return out;
}

async function xmlEstilo(estilo: string): Promise<string> {
  if (estilo.trimStart().startsWith('<')) return estilo; // CSL propio, en crudo
  const id = resolverEstilo(estilo);
  let p = cacheEstilos.get(id);
  if (!p) { p = ESTILOS[id]!.cargar().then((m) => m.default); cacheEstilos.set(id, p); }
  return p;
}

async function cargarLocales(): Promise<void> {
  if (cacheLocales.size === Object.keys(LOCALES).length) return;
  await Promise.all(Object.entries(LOCALES).map(async ([id, cargar]) => { cacheLocales.set(id, parchearLocale(id, (await cargar()).default)); }));
}

/** Un elemento de una cita: qué documento y en qué punto. */
export interface ElementoCita {
  documento: string;
  ancla?: Ancla;
  anclaFin?: Ancla;
  prefijo?: string;
  sufijo?: string;
  /** Solo el año: «Foucault (1975) sostiene…». */
  soloAnio?: boolean;
}

const motores = new Map<string, MotorCitas>();

export type FormatoSalida = 'texto' | 'html' | 'markdown';

function convertir(html: string, formato: FormatoSalida): string {
  return formato === 'html' ? html : formato === 'markdown' ? htmlAMarkdown(html) : htmlATexto(html);
}

export class MotorCitas {
  private items = new Map<string, ItemCSL>();

  private constructor(readonly estilo: string, readonly idioma: string, private xml: string, readonly esNotas: boolean, readonly esNumerico: boolean) {}

  /**
   * Crea (o reutiliza: hay una caché por estilo e idioma en el isolate) un motor.
   * Los documentos se añaden al registro del motor.
   */
  static async crear(opciones: { estilo?: string; idioma?: string; documentos?: DocumentoCitable[] } = {}): Promise<MotorCitas> {
    const estilo = opciones.estilo ?? 'apa';
    const propio = estilo.trimStart().startsWith('<');
    const clave = propio ? '' : `${resolverEstilo(estilo)}|${resolverIdioma(opciones.idioma)}`;
    const previo = clave ? motores.get(clave) : undefined;
    if (previo) {
      if (previo.items.size > 5000) previo.items.clear();
      if (opciones.documentos) previo.agregar(opciones.documentos);
      return previo;
    }
    const [xml] = await Promise.all([xmlEstilo(estilo), cargarLocales()]);
    const clase = xml.match(/<style[^>]*\bclass="([a-z-]+)"/)?.[1];
    const numerico = /citation-format="numeric"/.test(xml);
    const m = new MotorCitas(estilo.trimStart().startsWith('<') ? 'propio' : resolverEstilo(estilo), resolverIdioma(opciones.idioma), xml, clase === 'note', numerico);
    if (opciones.documentos) m.agregar(opciones.documentos);
    if (clave) motores.set(clave, m);
    return m;
  }

  agregar(documentos: DocumentoCitable[]): void {
    for (const d of documentos) this.items.set(d.id, aItemCSL(d, this.idioma));
  }

  item(id: string): ItemCSL | undefined { return this.items.get(id); }

  private motorCiteproc?: MotorCiteproc;

  /**
   * El motor de citeproc se construye una vez (con APA o Chicago cuesta unos
   * 400 ms) y se reinicia entre operaciones.
   */
  private motor(): MotorCiteproc {
    if (this.motorCiteproc) {
      this.motorCiteproc.restoreProcessorState([]);
      this.motorCiteproc.updateItems([]);
      return this.motorCiteproc;
    }
    const sistema = {
      retrieveLocale: (l: string) => cacheLocales.get(l) ?? cacheLocales.get(resolverIdioma(l)) ?? cacheLocales.get('en-US'),
      retrieveItem: (id: string) => {
        const it = this.items.get(id);
        if (!it) throw new Error(`Documento sin metadatos para citar: ${id}`);
        return it;
      },
    };
    const e = new CSL.Engine(sistema, this.xml, this.idioma, true);
    e.setOutputFormat('html');
    this.motorCiteproc = e;
    return e;
  }

  private aItemsCita(grupo: ElementoCita[]): object[] {
    const corto = this.idioma.slice(0, 2);
    return grupo.map((el) => {
      const loc = localizador(el.ancla, el.anclaFin, corto);
      const sufijo = [loc.suffix, el.sufijo].filter(Boolean).join('');
      return {
        id: el.documento,
        ...(loc.locator ? { locator: loc.locator, label: loc.label } : {}),
        ...(el.prefijo ? { prefix: el.prefijo } : {}),
        ...(sufijo ? { suffix: sufijo } : {}),
        ...(el.soloAnio ? { 'suppress-author': true } : {}),
      };
    });
  }

  /**
   * Procesa varias citas en orden de aparición (desambiguación, «ibid.», números
   * de IEEE…) y devuelve el texto final de cada una. En estilos de notas cada
   * cita es el texto de su nota.
   */
  citar(grupos: ElementoCita[][], formato: FormatoSalida = 'texto'): { citas: string[]; bibliografia: string[] } {
    const e = this.motor();
    const previas: Array<[string, number]> = [];
    const porId = new Map<string, string>();
    grupos.forEach((grupo, i) => {
      const id = `c${i}`;
      const nota = this.esNotas ? i + 1 : 0;
      const [, cambios] = e.processCitationCluster({ citationID: id, citationItems: this.aItemsCita(grupo), properties: { noteIndex: nota } }, previas, []);
      // Devuelve la nueva y las anteriores que cambian (desambiguación, «ibid.»).
      for (const [, texto, cid] of cambios) porId.set(cid, texto);
      previas.push([id, nota]);
    });
    const citas = grupos.map((_, i) => convertir(porId.get(`c${i}`) ?? '', formato));
    return { citas, bibliografia: this.bibliografiaDe(e, formato) };
  }

  /** Una cita suelta, sin contexto de documento. */
  citarUno(grupo: ElementoCita[], formato: FormatoSalida = 'texto'): string {
    return this.citar([grupo], formato).citas[0] ?? '';
  }

  /** Tramos con formato de una bibliografía (para DOCX). */
  bibliografiaTramos(documentos?: string[], citados?: ElementoCita[][]): Tramo[][] {
    const e = this.motor();
    if (citados?.length) {
      const previas: Array<[string, number]> = [];
      citados.forEach((g, i) => {
        e.processCitationCluster({ citationID: `c${i}`, citationItems: this.aItemsCita(g), properties: { noteIndex: this.esNotas ? i + 1 : 0 } }, previas, []);
        previas.push([`c${i}`, this.esNotas ? i + 1 : 0]);
      });
    } else e.updateItems(documentos ?? [...this.items.keys()]);
    const b = e.makeBibliography();
    return b ? b[1].map((h) => htmlATramos(h)) : [];
  }

  /** Bibliografía de unos documentos (o de todos los añadidos). */
  bibliografia(documentos?: string[], formato: FormatoSalida = 'texto'): string[] {
    const e = this.motor();
    e.updateItems(documentos ?? [...this.items.keys()]);
    return this.bibliografiaDe(e, formato);
  }

  private bibliografiaDe(e: MotorCiteproc, formato: FormatoSalida): string[] {
    const b = e.makeBibliography();
    if (!b) return [];
    const es = this.idioma.startsWith('es');
    return b[1].map((h) => { const r = formato === 'html' ? h.trim() : convertir(h, formato); return es ? fechasEnEspanol(r) : r; });
  }
}

const MESES = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre';
/**
 * Algunos estilos (APA, Chicago) componen la fecha mes-día a la inglesa
 * («marzo 20»). En español es «20 de marzo».
 */
export function fechasEnEspanol(s: string): string {
  // «Vega, L. de. (s. f.)»: el punto tras la partícula sobra delante del año.
  s = s.replace(/\b(de la|de los|del|de|van|von)\. \(/g, '$1 (');
  return s.replace(new RegExp(`\\b(${MESES}) (\\d{1,2})\\b(?!\\d)`, 'g'), '$2 de $1');
}
