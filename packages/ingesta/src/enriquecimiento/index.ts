/**
 * Enriquecimiento de la ficha consciente de la edición.
 *
 * Identifica la OBRA y la EDICIÓN que se tiene delante:
 * - la edición, por lo impreso en el propio libro (créditos y colofón: ISBN,
 *   «Esta edición», «Reprinted», pie de imprenta) y por el registro del ISBN;
 * - la obra, por catálogos de obras (Wikidata, Open Library, Wikipedia):
 *   primer año de publicación, lengua original, libro que la contiene.
 *
 * `anio` es siempre el de la edición; `anioOriginal`, el de la primera
 * publicación de la obra (lo que usa la lógica temporal de las citas).
 * Devuelve hallazgos con fuente y confianza por campo; la fusión decide.
 */

import type { Autor, MetadatosDocumento } from '@scholaris/nucleo';
import { autorDe, claveAutor } from '../pasos/metadatos/nombres.js';
import { aniosDelColofon, leerColofon, tipoTitulo, type Colofon } from './colofon.js';
import {
  arxivPorId, arxivPorTitulo, autoresCasan, datacite, googleBooksPorIsbn, openAlexOrcid, openLibraryObra, openLibraryPorIsbn,
  titulosCasan, wikidataObra, wikidataPrograma, wikipediaContenedor, type Hallazgo,
} from './fuentes.js';
import { actividadImpresor } from './impresores.js';
import type { Consultor } from './red.js';

export type { Hallazgo, CampoMeta } from './fuentes.js';
export { leerColofon, aniosDelColofon, nombreDeImprenta, tipoTitulo, type Colofon } from './colofon.js';
export { isbnsDelTexto, aIsbn13, isbn10Valido, isbn13Valido } from './isbn.js';
export { crearConsultor, vaciarCacheConsultas, CONTACTO, type Consultor, type CacheConsultas, type OpcionesConsultor } from './red.js';
export { actividadImpresor, type ActividadImpresor } from './impresores.js';
export { titulosCasan, autoresCasan, wikidataBuscar, type EntidadWikidata } from './fuentes.js';

export interface EntradaEnriquecimiento {
  /** Ficha provisional (lectura + verificación). */
  base: Partial<MetadatosDocumento>;
  /** Texto de las primeras y las últimas páginas (créditos y colofón). */
  texto: string;
  tipo: string;
}

export interface ResultadoEnriquecimiento {
  hallazgos: Hallazgo[];
  colofon: Colofon | null;
  /** ORCID por clave de autor (apellido|inicial). */
  orcid: Map<string, string>;
  avisos: string[];
}

const FORMAS_PARTE = /cuento|relato|short story|poema|poem|ensayo|essay|art[íi]culo|novela corta|novella|cap[íi]tulo|chapter/i;
const actual = () => new Date().getFullYear();

/** Lo que dice el colofón, como hallazgo. */
export function hallazgoDelColofon(c: Colofon, idioma?: string): Hallazgo | null {
  const d: Partial<MetadatosDocumento> = {};
  const porCampo: Hallazgo['porCampo'] = {};
  const { anio, anioOriginal, confianzaAnio } = aniosDelColofon(c);
  if (anio) { d.anio = anio; porCampo.anio = confianzaAnio; }
  if (anioOriginal) { d.anioOriginal = anioOriginal; porCampo.anioOriginal = 0.9; }
  if (c.isbns[0]) d.isbn = c.isbns[0];
  if (c.edicion) d.edicion = c.edicion;
  if (c.tituloOriginal) d.tituloOriginal = c.tituloOriginal;
  if (c.idiomaOriginal) d.idiomaOriginal = c.idiomaOriginal;
  if (c.traductores.length) d.traductores = c.traductores.map((t) => autorDe(t, idioma));
  if (c.impresor) { d.editorial = c.impresor; porCampo.editorial = 0.85; }
  else if (c.editorial) { d.editorial = tipoTitulo(c.editorial); porCampo.editorial = 0.85; }
  if (c.lugar) { d.lugar = c.lugar; porCampo.lugar = 0.85; }
  if (c.coleccion) d.coleccion = c.coleccion;
  if (c.doi) { d.doi = c.doi; porCampo.doi = 0.8; }
  if (c.arxiv) d.url = `https://arxiv.org/abs/${c.arxiv}`;
  if (c.congreso) {
    d.contenedor = c.congreso.nombre;
    d.tipoCSL = 'paper-conference';
    porCampo.tipoCSL = 0.9;
    if (!anio && c.congreso.anio) { d.anio = c.congreso.anio; porCampo.anio = 0.9; }
  }
  if (!Object.keys(d).length) return null;
  return { fuente: 'colofon', confianza: 0.92, porCampo, datos: d };
}

/** ¿El texto trae pruebas de la edición que no estaban en otro? (para decidir si se repite el paso). */
export function pruebasNuevas(antes: Colofon | null, ahora: Colofon): boolean {
  const a = antes ?? { isbns: [], copyright: [], reimpresiones: [], traductores: [] } as unknown as Colofon;
  return (ahora.isbns.length > a.isbns.length) || (Boolean(ahora.impresor) && !a.impresor) || (ahora.copyright.length > a.copyright.length)
    || (Boolean(ahora.primeraEdicion ?? ahora.estaEdicion ?? ahora.primeraEnEsta) && !(a.primeraEdicion ?? a.estaEdicion ?? a.primeraEnEsta))
    || (ahora.traductores.length > a.traductores.length) || (Boolean(ahora.tituloOriginal) && !a.tituloOriginal) || (Boolean(ahora.arxiv) && !a.arxiv) || (Boolean(ahora.congreso) && !a.congreso);
}

export async function enriquecer(e: EntradaEnriquecimiento, red: Consultor | null): Promise<ResultadoEnriquecimiento> {
  const medio = e.tipo === 'audio' || e.tipo === 'video';
  const base = e.base;
  const idioma = base.idioma;
  const hallazgos: Hallazgo[] = [];
  const avisos: string[] = [];
  let orcid = new Map<string, string>();

  // 1. Lo impreso en el libro.
  const colofon = medio || !e.texto ? null : leerColofon(e.texto);
  const hc = colofon ? hallazgoDelColofon(colofon, idioma) : null;
  if (hc) hallazgos.push(hc);
  const anioEdicion = hc?.datos.anio ?? base.anio;

  // Impreso antiguo sin fecha: horquilla por el impresor, solo si hay pruebas.
  if (colofon?.impresor && !hc?.datos.anio && !base.anio) {
    const act = await actividadImpresor(colofon.impresor, red).catch(() => null);
    if (act) {
      const d: Partial<MetadatosDocumento> = { sinFecha: { ...(act.desde ? { desde: act.desde } : {}), ...(act.hasta ? { hasta: act.hasta } : {}), fundamento: act.fundamento } };
      if (/viuda|herederos/i.test(colofon.impresor) || act.nombre.length > colofon.impresor.length) d.editorial = act.nombre;
      if (act.lugar && !colofon.lugar) d.lugar = act.lugar;
      hallazgos.push({ fuente: 'impresores', confianza: act.confianza, porCampo: { editorial: 0.88 }, datos: d });
    } else avisos.push(`Sin fecha: no hay datos del impresor «${colofon.impresor}» para acotarla.`);
  }
  if (!red) return { hallazgos, colofon, orcid, avisos };

  // 2. Consultas en paralelo.
  const tareas: Array<Promise<void>> = [];
  const isbn = hc?.datos.isbn ?? base.isbn;
  const titulo = base.titulo;
  const autores = base.autores ?? [];

  if (isbn && !medio) {
    tareas.push((async () => {
      const ol = await openLibraryPorIsbn(isbn, red, idioma);
      if (ol.length) hallazgos.push(...ol);
      else {
        const gb = await googleBooksPorIsbn(isbn, red, idioma);
        if (gb) hallazgos.push(gb);
      }
    })());
  }

  const articulo = /article|paper-conference|report/.test(base.tipoCSL ?? '') || Boolean(colofon?.congreso || colofon?.arxiv);
  if (titulo && !medio && !articulo) {
    tareas.push((async () => {
      const [wd, ol] = await Promise.all([wikidataObra(titulo, autores, red, idioma), isbn ? Promise.resolve(null) : openLibraryObra(titulo, autores, red, idioma)]);
      if (ol) hallazgos.push(ol);
      if (!wd) return;
      hallazgos.push(wd);
      // Un cuento o un ensayo: ¿en qué libro salió? (Wikipedia, mismo autor).
      const forma = wd.control?.forma ?? '';
      const articuloWiki = wd.control?.articulo ?? wd.control?.articuloEn;
      if (!wd.datos.contenedor && articuloWiki && wd.control?.autorQid) {
        const wc = await wikipediaContenedor(articuloWiki, wd.control.autorQid, titulo, red, autores);
        if (wc) {
          if (FORMAS_PARTE.test(forma)) { wc.datos.tipoCSL = 'chapter'; wc.porCampo = { ...wc.porCampo, tipoCSL: 0.85 }; }
          hallazgos.push(wc);
        }
      } else if (wd.datos.contenedor && FORMAS_PARTE.test(forma)) {
        wd.datos.tipoCSL = 'chapter';
      }
    })());
  }

  if (titulo && !medio && (colofon?.arxiv || (articulo && !base.isbn))) {
    tareas.push((async () => {
      const id = colofon?.arxiv ?? (await arxivPorTitulo(titulo, red));
      if (!id) return;
      const h = await arxivPorId(id, red);
      if (!h) return;
      // Aunque el identificador venga del propio PDF, el registro tiene que ser la misma obra.
      if (!titulosCasan(titulo, h.datos.titulo, 0.92) || autoresCasan(autores, h.datos.autores) === false) return;
      // El año de arXiv es el de la primera versión: en un artículo de congreso coincide; si no, es otra cosa.
      const d: Partial<MetadatosDocumento> = { url: h.datos.url as string };
      if (!base.doi) d.doi = h.datos.doi as string;
      if (h.datos.anio) d.anio = h.datos.anio;
      if (!base.tipoCSL && !colofon?.congreso) d.tipoCSL = 'article';
      if (h.datos.autores?.length && !autores.length) d.autores = h.datos.autores;
      hallazgos.push({ fuente: 'arxiv', confianza: 0.88, porCampo: { anio: 0.85, doi: 0.8 }, datos: d, ...(h.id ? { id: h.id } : {}) });
    })());
  }

  const doi = hc?.datos.doi ?? base.doi;
  if (doi && !medio) {
    tareas.push((async () => {
      // Crossref ya se consultó en la verificación; DataCite cubre lo que no es suyo.
      if (base.procedencia?.doi?.fuente !== 'crossref' && !/^10\.48550\//.test(doi)) {
        const dc = await datacite(doi, red);
        if (dc && titulosCasan(titulo, dc.datos.titulo, 0.85)) {
          delete dc.datos.titulo;
          hallazgos.push(dc);
        }
      }
      orcid = await openAlexOrcid(doi, red);
    })());
  }

  if (medio && (titulo || base.contenedor)) {
    tareas.push((async () => {
      const programa = base.contenedor ?? titulo as string;
      const wp = await wikidataPrograma(programa, autores, red, idioma ?? 'es');
      if (!wp) return;
      // El presentador se añade si falta; nunca se quita al invitado.
      const presentadores = wp.datos.autores ?? [];
      delete wp.datos.autores;
      const faltan = presentadores.filter((p) => !autores.some((a) => claveAutor(a).split('|')[0] === claveAutor(p).split('|')[0]));
      // Lista ampliada (presentador + los de la lectura): gana a la lectura sola.
      if (faltan.length && autores.length) { wp.datos.autores = [...faltan, ...autores]; wp.porCampo = { ...wp.porCampo, autores: 0.85 }; }
      const { desde, hasta } = wp.control ?? {};
      if (base.anio && desde && (base.anio < desde || base.anio > (hasta ?? actual()))) {
        avisos.push(`El año ${base.anio} cae fuera de los años en antena de «${programa}» (${desde}-${hasta ?? 'hoy'}).`);
      }
      hallazgos.push(wp);
    })());
  }

  await Promise.all(tareas.map((t) => t.catch((err) => { avisos.push(`Consulta fallida: ${String((err as Error)?.message ?? err).slice(0, 120)}`); })));

  // 3. Coherencia de los años de la obra.
  for (const h of hallazgos) {
    const ao = h.datos.anioOriginal;
    if (ao === undefined) continue;
    const nac = h.control?.nacimientoAutor;
    if (nac && ao < nac + 8) { delete h.datos.anioOriginal; avisos.push(`${h.fuente}: ${ao} es anterior a que naciera el autor (${nac}).`); continue; }
    if (hc?.datos.anio && hc.porCampo?.anio && hc.porCampo.anio >= 0.9 && ao > hc.datos.anio) { delete h.datos.anioOriginal; avisos.push(`${h.fuente}: la obra (${ao}) no puede ser posterior a esta edición (${hc.datos.anio}).`); }
  }
  // Consenso: dos fuentes independientes con el mismo año de la obra lo afianzan.
  const votos = new Map<number, Hallazgo[]>();
  for (const h of hallazgos) if (h.datos.anioOriginal !== undefined) votos.set(h.datos.anioOriginal, [...(votos.get(h.datos.anioOriginal) ?? []), h]);
  for (const [, hs] of votos) {
    if (new Set(hs.map((h) => h.fuente)).size < 2) continue;
    for (const h of hs) h.porCampo = { ...h.porCampo, anioOriginal: Math.min(0.97, Math.max(h.porCampo?.anioOriginal ?? h.confianza, 0.9) + 0.05) };
  }
  if (anioEdicion === undefined && !hallazgos.some((h) => h.datos.anio) && !medio) avisos.push('Sin año de edición impreso.');
  return { hallazgos, colofon, orcid, avisos };
}

/** Añade ORCID a los autores que casan (sin tocar sus nombres). */
export function conOrcid(autores: Autor[], orcid: Map<string, string>): Autor[] {
  if (!orcid.size) return autores;
  return autores.map((a) => (a.orcid ? a : orcid.has(claveAutor(a)) ? { ...a, orcid: orcid.get(claveAutor(a)) as string } : a));
}
