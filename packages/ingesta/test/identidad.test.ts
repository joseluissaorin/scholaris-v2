/**
 * Frontera de identidad de la ficha: un registro externo solo entra si es la
 * misma obra y la misma publicación. Respuestas reales de Crossref y OpenAlex
 * grabadas el 7-10-2026 (test/datos/catalogos-quijote-zipf.json), sin red.
 *
 * El caso de producción: el capítulo I del Quijote salió con el DOI
 * 10.2307/3716615 y la revista de una reseña de 1949 en The Modern Language
 * Review. En OpenAlex esa reseña se titula igual que la novela y lleva a
 * Cervantes como autor, detrás del reseñista (Entwistle).
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MetadatosDocumento } from '@scholaris/nucleo';
import {
  coincidencia, compararAnios, compararAutores, compararTipos, compararTitulos, crearConsultor, enriquecer, evaluarCandidato, fusionarMetadatos,
  pasoMetadatos, rehacerFicha, vaciarCacheConsultas,
} from '../src/pasos/metadatos.js';
import type { Http, UnidadLeida } from '../src/tipos.js';
import { redactorFalso } from './fakes.js';

const GRABADO = JSON.parse(readFileSync(new URL('./datos/catalogos-quijote-zipf.json', import.meta.url), 'utf8')) as Record<string, unknown>;

/** HTTP falso: la primera regla cuyo trozo aparece en la URL responde; lo demás, 404. */
function httpFalso(reglas: Array<[string, unknown]>, pedidas: string[] = []): Http {
  return async (url) => {
    pedidas.push(url);
    const r = reglas.find(([k]) => decodeURIComponent(url).includes(k));
    if (!r) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r[1] } as Awaited<ReturnType<Http>>;
  };
}

const pagina = (fisica: number, texto: string): UnidadLeida => ({
  orden: fisica - 1, fisica, texto, notas: [], cabecera: '', pie: '', folioVisto: null, titulos: [], figuras: [], vacia: !texto.trim(), lector: 'prueba', confianza: 1,
  ancla: { tipo: 'pagina', fisica, impresa: null, romana: false, origen: 'ninguno', confianza: 0 },
});

// Cervantes, Quijote I, cap. 1 (1605): dominio público.
const QUIJOTE = [
  pagina(1, 'EL INGENIOSO HIDALGO DON QUIJOTE DE LA MANCHA\n\nMiguel de Cervantes Saavedra\n\nCapítulo primero. Que trata de la condición y ejercicio del famoso hidalgo don Quijote de la Mancha\n\nEn un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor.'),
  pagina(2, 'Una olla de algo más vaca que carnero, salpicón las más noches, duelos y quebrantos los sábados, lantejas los viernes, algún palomino de añadidura los domingos, consumían las tres partes de su hacienda.'),
];
const CERVANTES = [{ nombre: 'Miguel', apellidos: 'de Cervantes Saavedra' }];
const catalogosQuijote: Array<[string, unknown]> = [
  ['api.crossref.org/works?query', GRABADO.crossrefQuijote],
  ['api.openalex.org/works?search', GRABADO.openalexQuijote],
];

// Corral, Boleda y Ferrer-i-Cancho (2015), PLoS ONE 10(7): e0129031, CC-BY. Primera página, recortada.
const ZIPF_TITULO = 'Zipf’s Law for Word Frequencies: Word Forms versus Lemmas in Long Texts';
const ZIPF_AUTORES = [{ nombre: 'Álvaro', apellidos: 'Corral' }, { nombre: 'Gemma', apellidos: 'Boleda' }, { nombre: 'Ramon', apellidos: 'Ferrer-i-Cancho' }];
const zipf = (conDoi: boolean) => [pagina(1, `RESEARCH ARTICLE\n\n${ZIPF_TITULO}\n\nÁlvaro Corral, Gemma Boleda, Ramon Ferrer-i-Cancho\n\nCitation: Corral Á, Boleda G, Ferrer-i-Cancho R (2015) ${ZIPF_TITULO}. PLoS ONE 10(7): e0129031.${conDoi ? ' doi:10.1371/journal.pone.0129031' : ''}\n\nData Availability Statement: All relevant data are available via Figshare (http://dx.doi.org/10.6084/m9.figshare.1430465).`)];
const lecturaZipf = (extra: Partial<MetadatosDocumento> = {}) => ({ titulo: ZIPF_TITULO, autores: ZIPF_AUTORES, idioma: 'en', tipoCSL: 'article-journal', anio: 2015, revista: 'PLoS ONE', volumen: '10', numero: '7', ...extra });

beforeEach(() => vaciarCacheConsultas());

describe('el capítulo I del Quijote (caso de producción)', () => {
  // Lo que puede leer el modelo en la página: con o sin año, como capítulo, como libro o sin tipo.
  const lecturas: Array<[string, Partial<MetadatosDocumento>]> = [
    ['capítulo con el año de la obra', { tipoCSL: 'chapter', anioOriginal: 1605, contenedor: 'El ingenioso hidalgo don Quijote de la Mancha' }],
    ['libro sin año', { tipoCSL: 'book' }],
    ['sin tipo ni año', {}],
    ['libro con un año cualquiera', { tipoCSL: 'book', anio: 1949 }],
  ];
  it.each(lecturas)('%s: ni DOI ni revista de una reseña', async (_caso, extra) => {
    const redactor = redactorFalso(() => ({ titulo: 'El ingenioso hidalgo don Quijote de la Mancha', autores: CERVANTES, idioma: 'es', ...extra }));
    const pedidas: string[] = [];
    const { metadatos, procedencia } = await pasoMetadatos({ ficha: {}, nombreArchivo: 'quijote-cap1.pdf', tipo: 'pdf', epub: false, unidades: QUIJOTE }, { redactor, http: httpFalso(catalogosQuijote, pedidas) });
    // Se consultó de verdad (los dos catálogos respondieron) y no se aceptó nada.
    expect(pedidas.some((u) => u.includes('api.openalex.org/works?search'))).toBe(true);
    expect(pedidas.some((u) => u.includes('api.crossref.org/works?query'))).toBe(true);
    expect(metadatos.doi).toBeUndefined();
    expect(metadatos.revista).toBeUndefined();
    expect(metadatos.volumen).toBeUndefined();
    expect(metadatos.paginas).toBeUndefined();
    expect(metadatos.autores).toEqual(CERVANTES);
    expect(metadatos.tipoCSL).toBe(extra.tipoCSL);
    expect(Object.values(metadatos.procedencia ?? {}).some((p) => p.fuente === 'crossref' || p.fuente === 'openalex')).toBe(false);
    const v = procedencia.find((p) => (p.detalle as { respondieron?: string[] } | undefined)?.respondieron);
    expect(v?.detalle).toMatchObject({ encontrado: false, respondieron: expect.arrayContaining(['crossref', 'openalex']) });
    // Y se sabe por qué: en la procedencia van los rechazos.
    expect(JSON.stringify(v?.detalle)).toMatch(/3716615/);
  });

  it('la reseña de OpenAlex, una a una, no pasa por ninguna regla', () => {
    const resena = { titulo: 'El ingenioso hidalgo Don Quijote de la Mancha', autores: [{ nombre: 'William J.', apellidos: 'Entwistle' }, { nombre: 'Miguel', apellidos: 'de Cervantes Saavedra' }], anio: 1949, tipoCSL: 'article-journal', revista: 'The Modern Language Review', doi: '10.2307/3716615' };
    const doc = { titulo: 'El ingenioso hidalgo don Quijote de la Mancha', autores: CERVANTES, tipoCSL: 'chapter', anioOriginal: 1605 };
    expect(compararTitulos(doc, resena.titulo).puntuacion).toBe(1);
    expect(compararAutores(doc.autores, resena.autores)).toMatchObject({ casa: false, motivo: expect.stringMatching(/reseña/) });
    expect(compararTipos(doc, resena).casa).toBe(false);
    expect(compararTipos({ anioOriginal: 1605 }, resena)).toMatchObject({ casa: false, motivo: expect.stringMatching(/1605 no es un artículo/) });
    expect(compararAnios(doc, [1949]).casa).toBeNull();
    expect(coincidencia(doc, resena)).toBe(0);
    // Aunque el documento fuera del mismo año y sin tipo, el primer autor sigue sin ser el suyo.
    expect(evaluarCandidato({ ...doc, tipoCSL: undefined, anioOriginal: undefined, anio: 1949 }, resena)).toMatchObject({ acepta: false, motivo: expect.stringMatching(/Entwistle/) });
  });

  it('rehacer la ficha estropeada la limpia: fuera el DOI, la revista y el reseñista', async () => {
    const estropeada: MetadatosDocumento = {
      titulo: 'El ingenioso hidalgo don Quijote de la Mancha', autores: [{ nombre: 'William J.', apellidos: 'Entwistle' }, ...CERVANTES, { nombre: 'Francisco', apellidos: 'Rodríguez Marín' }],
      anio: 1949, doi: '10.2307/3716615', revista: 'The Modern Language Review', volumen: '44', numero: '4', paginas: '577', tipoCSL: 'article-journal', idioma: 'es',
      procedencia: {
        titulo: { fuente: 'lectura', confianza: 0.8 }, autores: { fuente: 'openalex', confianza: 0.94 }, anio: { fuente: 'openalex', confianza: 0.94 }, doi: { fuente: 'openalex', confianza: 0.94 },
        revista: { fuente: 'openalex', confianza: 0.94 }, volumen: { fuente: 'openalex', confianza: 0.94 }, numero: { fuente: 'openalex', confianza: 0.94 }, paginas: { fuente: 'openalex', confianza: 0.94 },
        tipoCSL: { fuente: 'openalex', confianza: 0.94 }, idioma: { fuente: 'lectura', confianza: 0.85 },
      },
    };
    const redactor = redactorFalso(() => ({ titulo: 'El ingenioso hidalgo don Quijote de la Mancha', autores: CERVANTES, idioma: 'es', tipoCSL: 'chapter' }));
    const r = await rehacerFicha(estropeada, { tipo: 'pdf', nombreArchivo: 'quijote-cap1.pdf', unidades: QUIJOTE }, { redactor, http: httpFalso(catalogosQuijote) });
    expect(r.metadatos).toMatchObject({ titulo: 'El ingenioso hidalgo don Quijote de la Mancha', autores: CERVANTES, tipoCSL: 'chapter' });
    for (const campo of ['doi', 'revista', 'volumen', 'numero', 'paginas', 'anio'] as const) expect(r.metadatos[campo], campo).toBeUndefined();
  });

  it('sin respuesta de los catálogos, rehacer no tira nada (no hay pruebas en ningún sentido)', async () => {
    const previa: MetadatosDocumento = { titulo: 'Un artículo', autores: [{ nombre: 'Ana', apellidos: 'Prieto' }], anio: 2001, doi: '10.5555/prueba', revista: 'Revista de Prueba', procedencia: { doi: { fuente: 'crossref', confianza: 0.95 }, revista: { fuente: 'crossref', confianza: 0.95 } } };
    const redactor = redactorFalso(() => ({ titulo: 'Un artículo', autores: [{ nombre: 'Ana', apellidos: 'Prieto' }], idioma: 'es', anio: 2001, tipoCSL: 'article-journal' }));
    const r = await rehacerFicha(previa, { tipo: 'pdf', nombreArchivo: 'a.pdf', unidades: [pagina(1, 'Un artículo. Ana Prieto, 2001.')] }, { redactor, http: httpFalso([]) });
    expect(r.metadatos).toMatchObject({ doi: '10.5555/prueba', revista: 'Revista de Prueba' });
  });
});

describe('un artículo con DOI (Corral, Boleda y Ferrer-i-Cancho, PLoS ONE 2015)', () => {
  it('con el DOI impreso: DOI, revista, volumen, número y páginas de Crossref, en bloque', async () => {
    const redactor = redactorFalso(() => lecturaZipf({ doi: '10.1371/journal.pone.0129031' }));
    const { metadatos } = await pasoMetadatos({ ficha: {}, nombreArchivo: 'journal.pone.0129031.pdf', tipo: 'pdf', epub: false, unidades: zipf(true) }, { redactor, http: httpFalso([['api.crossref.org/works/10.1371', GRABADO.crossrefZipfDoi]]) });
    expect(metadatos).toMatchObject({ doi: '10.1371/journal.pone.0129031', revista: 'PLOS ONE', volumen: '10', numero: '7', anio: 2015, tipoCSL: 'article-journal' });
    for (const campo of ['doi', 'revista', 'volumen', 'numero']) expect(metadatos.procedencia?.[campo]?.fuente, campo).toBe('crossref');
    expect(metadatos.autores.map((a) => a.apellidos)).toEqual(['Corral', 'Boleda', 'Ferrer-i-Cancho']);
  });

  it('sin DOI impreso: se recupera por búsqueda porque título, primer autor, año y tipo casan', async () => {
    const redactor = redactorFalso(() => lecturaZipf());
    const { metadatos } = await pasoMetadatos({ ficha: {}, nombreArchivo: 'zipf.pdf', tipo: 'pdf', epub: false, unidades: zipf(false) }, { redactor, http: httpFalso([['api.crossref.org/works?query', GRABADO.crossrefZipf], ['api.openalex.org/works?search', GRABADO.openalexZipf]]) });
    expect(metadatos).toMatchObject({ doi: '10.1371/journal.pone.0129031', revista: 'PLOS ONE', volumen: '10', numero: '7' });
    expect(metadatos.procedencia?.doi?.fuente).toBe('crossref');
    expect(metadatos.procedencia?.revista?.fuente).toBe('crossref');
  });

  it('sin DOI impreso y sin año en el documento: con duda, ni DOI ni revista del catálogo', async () => {
    const redactor = redactorFalso(() => ({ ...lecturaZipf(), anio: undefined, revista: undefined, volumen: undefined, numero: undefined }));
    const { metadatos } = await pasoMetadatos({ ficha: {}, nombreArchivo: 'zipf.pdf', tipo: 'pdf', epub: false, unidades: zipf(false) }, { redactor, http: httpFalso([['api.crossref.org/works?query', GRABADO.crossrefZipf], ['api.openalex.org/works?search', GRABADO.openalexZipf]]) });
    expect(metadatos.doi).toBeUndefined();
    expect(metadatos.revista).toBeUndefined();
    expect(metadatos.volumen).toBeUndefined();
  });

  it('un DOI que el modelo dice leer y no figura en el documento no cuenta', async () => {
    const redactor = redactorFalso(() => lecturaZipf({ doi: '10.9999/inventado.1' }));
    const pedidas: string[] = [];
    const { metadatos } = await pasoMetadatos({ ficha: {}, nombreArchivo: 'zipf.pdf', tipo: 'pdf', epub: false, unidades: zipf(false) }, { redactor, http: httpFalso([['api.crossref.org/works?query', GRABADO.crossrefZipf], ['api.openalex.org/works?search', GRABADO.openalexZipf]], pedidas) });
    expect(pedidas.some((u) => u.includes('10.9999'))).toBe(false);
    expect(metadatos.doi).toBe('10.1371/journal.pone.0129031');
  });

  it('un DOI impreso que resuelve a otra obra (una referencia, la obra reseñada) no se queda', async () => {
    // En la página figura el DOI de la reseña de 1949; Crossref dice que es «El Ingenioso Hidalgo…», de Walsh y Cervantes.
    const resena = (GRABADO.crossrefQuijote as { message: { items: Array<Record<string, unknown>> } }).message.items.find((x) => x.DOI === '10.2307/334345');
    const redactor = redactorFalso(() => lecturaZipf({ doi: '10.2307/334345', revista: undefined, volumen: undefined, numero: undefined }));
    const unidades = [pagina(1, `${ZIPF_TITULO}\n\nÁlvaro Corral, Gemma Boleda, Ramon Ferrer-i-Cancho\n\n[1] Walsh DD (1949) doi:10.2307/334345`)];
    const { metadatos, procedencia } = await pasoMetadatos({ ficha: {}, nombreArchivo: 'zipf.pdf', tipo: 'pdf', epub: false, unidades }, { redactor, http: httpFalso([['api.crossref.org/works/10.2307', { message: resena }]]) });
    expect(metadatos.doi).toBeUndefined();
    expect(metadatos.revista).toBeUndefined();
    expect(JSON.stringify(procedencia)).toMatch(/doiAjeno/);
  });

  it('el mismo título en otro año o con otro primer autor es otra publicación', () => {
    const base = { titulo: ZIPF_TITULO, autores: ZIPF_AUTORES, anio: 2015, tipoCSL: 'article-journal' };
    const registro = { titulo: ZIPF_TITULO, autores: ZIPF_AUTORES, anio: 2015, tipoCSL: 'article-journal', doi: '10.1371/journal.pone.0129031' };
    expect(coincidencia(base, registro)).toBeGreaterThan(0.95);
    expect(coincidencia(base, { ...registro, anio: 2025, doi: '10.65215/copia' })).toBe(0);
    expect(coincidencia(base, { ...registro, autores: [{ nombre: 'Beat', apellidos: 'Döbeli Honegger' }, ...ZIPF_AUTORES] })).toBe(0);
    expect(coincidencia(base, { ...registro, tipoCSL: 'review' })).toBe(0);
  });
});

describe('nombres de pila', () => {
  it('«C. S. Lewis» no es «Cynthia Lewis» (OpenAlex le atribuye The Discarded Image a ella)', async () => {
    const { verificar } = await import('../src/pasos/metadatos.js');
    const doc = { titulo: 'The Discarded Image', subtitulo: 'An Introduction to Medieval and Renaissance Literature', autores: [{ nombre: 'C. S.', apellidos: 'Lewis' }], anio: 1964, tipoCSL: 'book' };
    const v = await verificar(doc, httpFalso([['api.openalex.org/works?search', GRABADO.openalexDiscarded]]));
    expect(v.registro?.autores).toEqual([{ nombre: 'C. S.', apellidos: 'Lewis' }]);
    expect(v.registro?.titulo).toMatch(/^The discarded image : an introduction/);
    expect(v.rechazados.find((r) => /Cynthia|Lewis/.test(r.motivo) || r.titulo === 'The Discarded Image')?.motivo).toMatch(/Lewis|autor/);
    expect(compararAutores(doc.autores, [{ nombre: 'Cynthia', apellidos: 'Lewis' }]).casa).toBe(false);
    expect(compararAutores(doc.autores, [{ nombre: 'Clive Staples', apellidos: 'Lewis' }]).casa).toBe(true);
    expect(compararAutores([{ nombre: 'Niki', apellidos: 'Parmar' }], [{ nombre: 'Niki Jitendra', apellidos: 'Parmar' }]).casa).toBe(true);
    expect(compararAutores(ZIPF_AUTORES, [{ nombre: '√Ålvaro', apellidos: 'Corral' }]).casa).toBe(true);
  });
});

describe('títulos: el mismo, no uno que trata de la obra', () => {
  const doc = { titulo: 'Don Quijote de la Mancha', autores: CERVANTES };
  it.each([
    ['A review of Don Quijote de la Mancha', /trata de la obra/],
    ['Notes on Don Quijote de la Mancha', /trata de la obra/],
    ['Voces de Cervantes en Don Quijote de la Mancha', /trata de la obra|nombra al autor/],
    ['Cervantes, Miguel de <i>Don Quijote de la Mancha</i>. Edición de Castilla-La Mancha. Al cuidado de Francisco Rico. 2005. CI + 1243 pp.', /trata de la obra|nombra al autor/],
    ['Don Quijote de la Mancha y la crítica romántica', /sigue después|trata de la obra/],
    ['Don Quijote de la Mancha: estudio de sus fuentes', /trata de la obra/],
    ['Las estacas de don Quijote: tradición literaria', /distintos|otro/],
  ])('«%s» no es la obra', (titulo, motivo) => {
    const t = compararTitulos(doc, titulo);
    expect(t.puntuacion).toBeLessThan(0.9);
    expect(t.motivo).toMatch(motivo);
  });
  it('la misma obra con mayúsculas, artículo, marcado o subtítulo sí', () => {
    expect(compararTitulos(doc, 'DON QUIJOTE DE LA MANCHA').puntuacion).toBe(1);
    expect(compararTitulos(doc, 'El Don Quijote de la Mancha').puntuacion).toBe(1);
    expect(compararTitulos({ titulo: 'The Discarded Image' }, 'The discarded image : an introduction to medieval and Renaissance literature').puntuacion).toBeGreaterThanOrEqual(0.9);
    expect(compararTitulos({ titulo: 'The Discarded Image', subtitulo: 'An Introduction to Medieval and Renaissance Literature' }, 'The Discarded Image: An Introduction to Medieval and Renaissance Literature').puntuacion).toBeGreaterThanOrEqual(0.95);
    expect(compararTitulos({ titulo: 'Attention Is All You Need' }, 'Attention is All you Need').puntuacion).toBe(1);
    // Mismo principio con otro subtítulo, y un título que sigue sin separador: no.
    expect(compararTitulos({ titulo: 'Attention Is All You Need', subtitulo: 'Transformers' }, 'Attention is all you need: utilizing attention in AI-enabled drug discovery').puntuacion).toBe(0);
    expect(compararTitulos({ titulo: 'Attention Is All You Need' }, 'Attention Is All You Need In Speech Separation').puntuacion).toBe(0);
  });
});

describe('tipos y años', () => {
  it('un libro o un capítulo no es un artículo; una reseña o una entrada de enciclopedia nunca son el documento', () => {
    expect(compararTipos({ tipoCSL: 'book' }, { tipoCSL: 'article-journal' }).casa).toBe(false);
    expect(compararTipos({ tipoCSL: 'chapter' }, { tipoCSL: 'article-journal' }).casa).toBe(false);
    expect(compararTipos({ tipoCSL: 'book' }, { tipoCSL: 'chapter' }).casa).toBe(false);
    expect(compararTipos({ tipoCSL: 'paper-conference' }, { tipoCSL: 'chapter' }).casa).toBe(true);
    expect(compararTipos({ tipoCSL: 'article-journal' }, { tipoCSL: 'paper-conference' }).casa).toBe(true);
    expect(compararTipos({}, { tipoCSL: 'review' }).casa).toBe(false);
    expect(compararTipos({ tipoCSL: 'book' }, { tipoCSL: 'reference-entry' }).casa).toBe(false);
    expect(compararTipos({}, { tipoCSL: 'article-journal' }).casa).toBeNull();
  });
  it('el año es el de la edición que se tiene delante', () => {
    expect(compararAnios({ anio: 2015 }, [2015]).casa).toBe(true);
    expect(compararAnios({ anio: 2015 }, [2014, 2015]).casa).toBe(true);
    expect(compararAnios({ anio: 2015 }, [2025]).casa).toBe(false);
    expect(compararAnios({}, [2015]).casa).toBeNull();
    expect(compararAnios({ anioOriginal: 1605 }, [1949]).casa).toBeNull();
    expect(compararAnios({ anioOriginal: 1950 }, [1605]).casa).toBe(false);
  });
});

describe('fusión: el bloque de la publicación sale de una sola fuente', () => {
  it('el DOI de un registro no se mezcla con la revista y el volumen de otro', () => {
    const m = fusionarMetadatos([
      { fuente: 'lectura', confianza: 0.8, datos: { titulo: 'Un artículo', revista: 'Revista impresa', volumen: '3' } },
      { fuente: 'datacite', confianza: 0.85, datos: { doi: '10.5555/uno' } },
      { fuente: 'openalex', confianza: 0.95, datos: { revista: 'Otra revista', volumen: '44', numero: '4' } },
    ], 'x.pdf');
    expect(m).toMatchObject({ doi: '10.5555/uno', revista: 'Revista impresa', volumen: '3' });
    expect(m.numero).toBeUndefined();
    expect(m.procedencia?.revista?.fuente).toBe('lectura');
  });
  it('las fuentes que dan el mismo DOI son la misma publicación', () => {
    const m = fusionarMetadatos([
      { fuente: 'lectura', confianza: 0.8, datos: { titulo: 'Un artículo', doi: '10.5555/uno', paginas: '1-10' } },
      { fuente: 'crossref', confianza: 0.95, datos: { doi: '10.5555/uno', revista: 'La revista', volumen: '7' } },
    ], 'x.pdf');
    expect(m).toMatchObject({ doi: '10.5555/uno', revista: 'La revista', volumen: '7', paginas: '1-10' });
    expect(m.procedencia?.doi?.fuente).toBe('crossref');
  });
  it('lo que puso el usuario se respeta campo a campo', () => {
    const m = fusionarMetadatos([
      { fuente: 'crossref', confianza: 0.95, datos: { titulo: 'Un artículo', doi: '10.5555/uno', revista: 'La revista', volumen: '7' } },
      { fuente: 'usuario', confianza: 1, datos: { volumen: '8' } },
    ], 'x.pdf');
    expect(m).toMatchObject({ doi: '10.5555/uno', revista: 'La revista', volumen: '8' });
  });
});

describe('catálogos de obras con el mismo criterio', () => {
  it('Open Library: un ISBN impreso de otra obra no trae ni año ni editorial', async () => {
    const http = httpFalso([
      ['openlibrary.org/isbn/9780521477352', { title: 'Le livre d’essai', publishers: ['Éditions de l’Exemple'], publish_date: '1975', key: '/books/OL1M' }],
      ['openlibrary.org/search.json?isbn', { docs: [{ key: '/works/OL1W', title: 'Le livre d’essai', author_name: ['Ana Prieto'], first_publish_year: 1975 }] }],
    ]);
    const r = await enriquecer({ base: { titulo: 'El libro de prueba', autores: [{ nombre: 'Ana', apellidos: 'Prieto' }], tipoCSL: 'book' }, texto: 'ISBN 0 521 47735 2', tipo: 'pdf' }, crearConsultor({ http }));
    expect(r.hallazgos.some((h) => h.fuente === 'openlibrary')).toBe(false);
  });
  it('Wikidata: un artículo o una reseña que se llama como la obra no es la obra', async () => {
    const http = httpFalso([
      ['wbsearchentities', { search: [{ id: 'Q1', label: 'El ingenioso hidalgo don Quijote de la Mancha', description: 'scholarly article by William J. Entwistle published 1949' }] }],
      ['query.wikidata.org', { results: { bindings: [{ item: { value: 'http://www.wikidata.org/entity/Q1' }, itemLabel: { value: 'El ingenioso hidalgo don Quijote de la Mancha' }, fecha: { value: '1949-01-01T00:00:00Z' }, autor: { value: 'http://www.wikidata.org/entity/Q5682' }, autorLabel: { value: 'Miguel de Cervantes' }, claseLabel: { value: 'artículo científico' } }] } }],
    ]);
    const r = await enriquecer({ base: { titulo: 'El ingenioso hidalgo don Quijote de la Mancha', autores: CERVANTES, tipoCSL: 'book' }, texto: '', tipo: 'pdf' }, crearConsultor({ http }));
    expect(r.hallazgos.some((h) => h.fuente === 'wikidata')).toBe(false);
  });
  it('un título sacado del nombre del archivo no se busca en ningún catálogo', async () => {
    const pedidas: string[] = [];
    const { metadatos } = await pasoMetadatos({ ficha: {}, nombreArchivo: 'El ingenioso hidalgo don Quijote de la Mancha.pdf', tipo: 'pdf', epub: false, unidades: [] }, { http: httpFalso(catalogosQuijote, pedidas) });
    expect(metadatos.procedencia?.titulo?.confianza).toBeLessThan(0.5);
    expect(pedidas.filter((u) => /works\?|search|wbsearchentities/.test(u))).toEqual([]);
    expect(metadatos.doi).toBeUndefined();
  });
});
