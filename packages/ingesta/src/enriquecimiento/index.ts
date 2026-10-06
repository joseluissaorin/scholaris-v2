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
import { presencia, rtveEpisodio, type EvidenciaGrabacion } from './rtve.js';
import { normalizar } from '../texto.js';
import type { CampoMeta } from './fuentes.js';
import type { Consultor } from './red.js';

export type { Hallazgo, CampoMeta } from './fuentes.js';
export { leerColofon, aniosDelColofon, nombreDeImprenta, tipoTitulo, type Colofon } from './colofon.js';
export { isbnsDelTexto, aIsbn13, isbn10Valido, isbn13Valido } from './isbn.js';
export { crearConsultor, vaciarCacheConsultas, cacheEnKv, cacheEnAlmacen, huella, CONTACTO, type Consultor, type CacheConsultas, type OpcionesConsultor, type PuertoCatalogos } from './red.js';
export { actividadImpresor, type ActividadImpresor } from './impresores.js';
export { rtveEpisodio, fechaRtve, slugRtve, presencia, personasDelTitulo, type EvidenciaGrabacion } from './rtve.js';
export { titulosCasan, autoresCasan, wikidataBuscar, type EntidadWikidata } from './fuentes.js';

export interface EntradaEnriquecimiento {
  /** Ficha provisional (lectura + verificación). */
  base: Partial<MetadatosDocumento>;
  /** Texto de las primeras y las últimas páginas (créditos y colofón). */
  texto: string;
  tipo: string;
  /** Audio y vídeo: la transcripción, los hablantes con nombre y la duración (pruebas para identificar el episodio). */
  grabacion?: EvidenciaGrabacion;
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
      if (h.datos.contenedor && !colofon?.congreso) { d.contenedor = h.datos.contenedor; d.tipoCSL = 'paper-conference'; }
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
      const r = await fichaDeEmision(base, red, idioma, e.grabacion);
      hallazgos.push(...r.hallazgos);
      avisos.push(...r.avisos);
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

const mismaPersona = (a: Autor, b: Autor) => claveAutor(a).split('|')[0] === claveAutor(b).split('|')[0];
const nombreDe = (a: Autor) => [a.nombre, a.apellidos].filter(Boolean).join(' ');

/**
 * Audio y vídeo de un programa (radio, televisión, pódcast). La ficha correcta es la del EPISODIO:
 * - `contenedor`: el programa («A fondo»), con su cadena en `editorial` («RTVE»);
 * - `titulo`: el del episodio en el catálogo («Julio Cortázar» en RTVE Play) o, si no lo hay,
 *   el nombre de los invitados, como hace RTVE;
 * - `autores`: los entrevistados; `entrevistadores`: quien pregunta (el presentador);
 * - `anio` y `fecha`: los de la emisión, si el catálogo los da.
 *
 * Nada de esto se acepta sin pruebas de la grabación: un invitado que la
 * transcripción no nombra ni habla (el modelo lo sacó del nombre del archivo o
 * de una canción) no es el invitado, y el episodio del catálogo se elige por
 * menciones, hablantes y duración, o no se elige.
 */
export async function fichaDeEmision(base: Partial<MetadatosDocumento>, red: Consultor, idioma?: string, ev?: EvidenciaGrabacion): Promise<{ hallazgos: Hallazgo[]; avisos: string[] }> {
  const hallazgos: Hallazgo[] = [];
  const avisos: string[] = [];
  const titulo = base.titulo;
  const autores = base.autores ?? [];
  // El programa: el contenedor leído, o el título o el subtítulo si alguno es un programa conocido.
  let programa = base.contenedor ?? (titulo as string);
  let wp: Hallazgo | null = null;
  for (const candidato of [base.contenedor, titulo, base.subtitulo]) {
    if (!candidato) continue;
    wp = await wikidataPrograma(candidato, autores, red, idioma ?? 'es');
    if (wp) { programa = (wp.datos.contenedor as string | undefined) ?? candidato; break; }
  }
  const tituloEsPrograma = titulosCasan(titulo, programa, 0.9);
  const presentadores = wp?.datos.autores ?? [];
  if (wp) delete wp.datos.autores;
  let entrevistadores = base.entrevistadores?.length ? base.entrevistadores : presentadores;
  const evidencia = ev ? { textoNormalizado: ` ${normalizar(ev.texto)} `, hablantes: ev.hablantes } : null;
  // Con una transcripción corta no hay pruebas en ningún sentido: no se quita a nadie.
  const concluyente = Boolean(evidencia && evidencia.textoNormalizado.length > 1500);
  const respaldado = (a: Autor) => !concluyente || presencia(nombreDe(a), evidencia!) >= 5;
  let invitados = autores.filter((a) => !entrevistadores.some((e) => mismaPersona(a, e)));
  // Invitados que la grabación no respalda: fuera (y el título que los nombra, también).
  const sinPruebas = invitados.filter((a) => !respaldado(a));
  if (sinPruebas.length) {
    avisos.push(`La grabación no nombra a ${sinPruebas.map(nombreDe).join(', ')}: no se da por invitado.`);
    invitados = invitados.filter(respaldado);
  }
  // Hablantes con nombre que no están en la ficha: también son invitados.
  for (const h of ev?.hablantes ?? []) {
    const a = autorDe(h, idioma ?? 'es');
    if (a.apellidos && respaldado(a) && ![...invitados, ...entrevistadores].some((x) => mismaPersona(x, a))) invitados.push(a);
  }
  const tituloSinPruebas = Boolean(titulo && sinPruebas.some((a) => normalizar(titulo).includes(normalizar(a.apellidos).split(' ').pop() ?? '\u0000')));
  if (wp) {
    const { desde, hasta } = wp.control ?? {};
    if (base.anio && desde && (base.anio < desde || base.anio > (hasta ?? actual()))) avisos.push(`El año ${base.anio} cae fuera de los años en antena de «${programa}» (${desde}-${hasta ?? 'hoy'}).`);
  }
  // RTVE Play: el episodio concreto, con su fecha de emisión, si la grabación lo respalda.
  const deRtve = /rtve|televisi[óo]n espa[ñn]ola|\btve\b|radio nacional/i.test(`${wp?.datos.editorial ?? ''} ${base.editorial ?? ''}`) || (!wp && (idioma ?? 'es').startsWith('es'));
  const eleccion = deRtve && ev ? await rtveEpisodio(programa, ev, red) : null;
  const rt = eleccion?.hallazgo ?? null;
  if (eleccion) avisos.push(`RTVE Play: ${eleccion.motivo}.`);
  if (rt) {
    if (rt.datos.entrevistadores?.length) entrevistadores = rt.datos.entrevistadores;
    invitados = (rt.datos.autores ?? invitados).filter((a) => !entrevistadores.some((e) => mismaPersona(a, e)));
  }
  if (!wp && !rt && !(base.contenedor && !tituloEsPrograma) && !sinPruebas.length) return { hallazgos, avisos };
  const reparto: Partial<MetadatosDocumento> = {};
  const porCampo: Hallazgo['porCampo'] = {};
  const anula: CampoMeta[] = [];
  if (invitados.length) {
    reparto.autores = invitados;
    porCampo.autores = sinPruebas.length ? 0.95 : 0.88;
  } else if (sinPruebas.length) anula.push('autores');
  if (entrevistadores.length) { reparto.entrevistadores = entrevistadores; porCampo.entrevistadores = 0.88; }
  if ((tituloEsPrograma || tituloSinPruebas) && !rt) {
    if (invitados.length) {
      // Sin episodio en el catálogo: el nombre de los invitados, como en RTVE Play.
      reparto.titulo = invitados.map(nombreDe).join(' y ');
      porCampo.titulo = tituloSinPruebas ? 0.95 : 0.86;
    } else if (tituloSinPruebas && programa !== titulo) {
      // Ni catálogo ni invitado con pruebas: mejor el nombre del programa que un nombre falso.
      reparto.titulo = programa;
      porCampo.titulo = 0.95;
    }
    anula.push('subtitulo');
  }
  if (rt) anula.push('subtitulo');
  if (wp) hallazgos.push(wp);
  if (rt) hallazgos.push({ ...rt, anula });
  if (Object.keys(reparto).length || anula.length) hallazgos.push({ fuente: rt ? 'rtve' : wp ? 'wikidata' : 'lectura', confianza: 0.86, porCampo, datos: { ...reparto, ...(wp || rt ? {} : { contenedor: programa }) }, ...(anula.length ? { anula } : {}) });
  return { hallazgos, avisos };
}

/** Añade ORCID a los autores que casan (sin tocar sus nombres). */
export function conOrcid(autores: Autor[], orcid: Map<string, string>): Autor[] {
  if (!orcid.size) return autores;
  return autores.map((a) => (a.orcid ? a : orcid.has(claveAutor(a)) ? { ...a, orcid: orcid.get(claveAutor(a)) as string } : a));
}
