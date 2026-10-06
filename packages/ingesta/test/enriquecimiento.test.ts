import { beforeEach, describe, expect, it } from 'vitest';
import {
  aIsbn13, aniosDelColofon, autorDe, crearConsultor, enriquecer, esEntidad, fusionarMetadatos, isbnsDelTexto, leerColofon,
  nombreDeImprenta, pasoMetadatos, refinarMetadatos, textoColofon, vaciarCacheConsultas,
} from '../src/pasos/metadatos.js';
import type { Http, UnidadLeida } from '../src/tipos.js';
import { redactorFalso } from './fakes.js';

/** HTTP falso: la primera regla cuyo trozo aparece en la URL responde. */
function httpFalso(reglas: Array<[string | RegExp, unknown]>, pedidas: string[] = []): Http {
  return async (url) => {
    pedidas.push(url);
    const r = reglas.find(([k]) => (typeof k === 'string' ? decodeURIComponent(url).includes(k) : k.test(decodeURIComponent(url))));
    if (!r) return { ok: false, status: 404, json: async () => ({}) };
    const v = r[1];
    return { ok: true, status: 200, json: async () => v, text: async () => (typeof v === 'string' ? v : JSON.stringify(v)) } as Awaited<ReturnType<Http>>;
  };
}

const pagina = (fisica: number, texto: string): UnidadLeida => ({
  orden: fisica - 1, fisica, texto, notas: [], cabecera: '', pie: '', folioVisto: null, titulos: [], figuras: [], vacia: !texto.trim(), lector: 'prueba', confianza: 1,
  ancla: { tipo: 'pagina', fisica, impresa: null, romana: false, origen: 'ninguno', confianza: 0 },
});

beforeEach(() => vaciarCacheConsultas());

describe('ISBN', () => {
  it('valida el control y pasa de 10 a 13', () => {
    expect(aIsbn13('0-521-47735-2')).toBe('9780521477352');
    expect(aIsbn13('0-521-47735-3')).toBeNull();
    expect(isbnsDelTexto('ISBN 0 521 47735 2 paperback\nISBN: 978-84-376-0494-7')).toEqual(['9780521477352', '9788437604947']);
  });
});

describe('créditos y colofón', () => {
  it('The Discarded Image (1964): primera impresión y reimpresión del mismo año', () => {
    const c = leerColofon('PUBLISHED BY\nTHE SYNDICS OF THE CAMBRIDGE UNIVERSITY PRESS\nBentley House, 200 Euston Road, London\n\n©\nCAMBRIDGE UNIVERSITY PRESS\n1964\n\nFirst printed 1964\nReprinted 1964');
    expect(c.editorial).toBe('Cambridge University Press');
    expect(aniosDelColofon(c)).toMatchObject({ anio: 1964, anioOriginal: 1964 });
  });
  it('edición Canto: el año de la edición no es el de la obra', () => {
    const c = leerColofon('First published 1964\nFirst paperback edition 1967\nCanto edition 1994\nReprinted 1995, 1998\nISBN 0 521 47735 2 paperback');
    expect(c.edicion).toBe('Canto edition');
    expect(aniosDelColofon(c)).toMatchObject({ anio: 1994, anioOriginal: 1964 });
    expect(c.isbns).toEqual(['9780521477352']);
  });
  it('traducción: título original, traductor, lengua y © del original', () => {
    const c = leerColofon('Título original: Surveiller et punir\nTraducción del francés de Aurelio Garzón del Camino\n© Éditions Gallimard, 1975\n© de la traducción: Siglo XXI Editores, 1976\nPrimera edición: 1976\nEsta edición: 2002\nD.L.: M-1234-2002');
    expect(c).toMatchObject({ tituloOriginal: 'Surveiller et punir', idiomaOriginal: 'fr', traductores: ['Aurelio Garzón del Camino'], depositoLegal: 'M-1234-2002' });
    expect(aniosDelColofon(c)).toMatchObject({ anio: 2002, anioOriginal: 1975 });
  });
  it('ediciones numeradas en palabras', () => {
    const c = leerColofon('© 1975, Éditions Gallimard\nTítulo original: Surveiller et punir\nprimera edición en español, 1976\nvigesimonovena edición, 2001');
    expect(aniosDelColofon(c)).toMatchObject({ anio: 2001, anioOriginal: 1975 });
  });
  it('pie de imprenta de una suelta del XVIII', () => {
    const c = leerColofon('# FIN.\n\nCon licencia: En Sevilla, en la Imprenta de la VIVDA de FRANCISCO LEEFDAEL, en la Casa del Correo Viejo.');
    expect(c).toMatchObject({ lugar: 'Sevilla', impresor: 'Viuda de Francisco Leefdael' });
    expect(nombreDeImprenta('IMPRENTA DE LA VIVDA DE FRANCISCO LEEFDAEL')).toBe('Imprenta de la Viuda de Francisco Leefdael');
    expect(aniosDelColofon(c).anio).toBeUndefined();
  });
  it('arXiv: el sello del margen sí, una referencia no; congreso del pie', () => {
    expect(leerColofon('arXiv:1706.03762v7 [cs.CL] 2 Aug 2023').arxiv).toBe('1706.03762');
    expect(leerColofon('[3] J. Ba. Layer normalization. arXiv:1607.06450, 2016.').arxiv).toBeUndefined();
    expect(leerColofon('31st Conference on Neural Information Processing Systems (NIPS 2017), Long Beach, CA, USA.').congreso).toMatchObject({ anio: 2017, lugar: 'Long Beach, CA, USA' });
    expect(leerColofon('See 10.1000/xyz in the references').doi).toBeUndefined();
    expect(leerColofon('DOI: 10.1017/CBO9780511605390').doi).toBe('10.1017/cbo9780511605390');
  });
  it('solo se leen como créditos las páginas con señales de créditos', () => {
    const t = textoColofon([pagina(1, 'Título'), pagina(2, 'Texto del cuerpo sin nada más'), pagina(3, '© 1975 Gallimard')], [pagina(40, 'Con licencia: En Sevilla, por Juan Pérez.')]);
    expect(t).toContain('© 1975');
    expect(t).toContain('Con licencia');
    expect(t).not.toContain('cuerpo');
  });
});

describe('nombres', () => {
  it('personas y entidades', () => {
    expect(autorDe('Joaquín Soler Serrano', 'es')).toEqual({ nombre: 'Joaquín', apellidos: 'Soler Serrano' });
    expect(autorDe('Lope de Vega')).toEqual({ nombre: 'Lope', apellidos: 'de Vega' });
    expect(autorDe('Ludwig van Beethoven')).toEqual({ nombre: 'Ludwig', apellidos: 'van Beethoven' });
    expect(autorDe('Real Academia Española')).toEqual({ nombre: '', apellidos: 'Real Academia Española' });
    expect(esEntidad('RTVE')).toBe(true);
    expect(esEntidad('C. S.')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Catálogos (respuestas reales recortadas)
// ---------------------------------------------------------------------------

const busquedaPerseguidor = { search: [{ id: 'Q5826138', label: 'El perseguidor', description: 'short story by Julio Cortázar' }, { id: 'Q129721131', label: 'El perseguidor y otros relatos', description: '1980 edition of written work by Julio Cortázar' }] };
const sparqlPerseguidor = { results: { bindings: [{
  item: { value: 'http://www.wikidata.org/entity/Q5826138' }, itemLabel: { value: 'El perseguidor' }, fecha: { value: '1959-01-01T00:00:00Z' }, lengua: { value: 'es' },
  autor: { value: 'http://www.wikidata.org/entity/Q174210' }, autorLabel: { value: 'Julio Cortázar' }, nac: { value: '1914-08-26T00:00:00Z' }, muerte: { value: '1984-02-12T00:00:00Z' },
  formaLabel: { value: 'cuento' }, artEs: { value: 'https://es.wikipedia.org/wiki/El_perseguidor' },
}] } };
const obrasCortazar = { results: { bindings: [
  { w: { value: 'http://www.wikidata.org/entity/Q1999338' }, wLabel: { value: 'Las armas secretas' }, f: { value: '1959-01-01T00:00:00Z' } },
  { w: { value: 'http://www.wikidata.org/entity/Q129718634' }, wLabel: { value: 'Las armas secretas' }, f: { value: '1978-01-01T00:00:00Z' } },
  { w: { value: 'http://www.wikidata.org/entity/Q129721892' }, wLabel: { value: 'Julio Cortázar' } },
] } };
const introPerseguidor = { query: { pages: { 1: { extract: 'Véase también el apartado "El perseguidor" del artículo "Las armas secretas"\n\nEl perseguidor es un cuento del escritor argentino Julio Cortázar. Fue publicado en 1959 e incluido en su clásica colección antológica Las armas secretas.' } } } };

describe('enriquecer', () => {
  it('El perseguidor: año de la obra, libro que lo contiene y tipo «chapter»', async () => {
    const http = httpFalso([
      ['wbsearchentities', busquedaPerseguidor],
      ['wdt:P50 wd:Q174210', obrasCortazar],
      ['query.wikidata.org', sparqlPerseguidor],
      ['es.wikipedia.org/w/api.php', introPerseguidor],
      ['openlibrary.org/search.json', { docs: [{ key: '/works/OL1W', title: 'El perseguidor', author_name: ['Julio Cortázar'], first_publish_year: 1959 }] }],
    ]);
    const r = await enriquecer({ base: { titulo: 'El perseguidor', autores: [{ nombre: 'Julio', apellidos: 'Cortázar' }], idioma: 'es', tipoCSL: 'document' }, texto: 'EL PERSEGUIDOR Julio Cortázar', tipo: 'pdf' }, crearConsultor({ http }));
    const m = fusionarMetadatos([{ fuente: 'lectura', confianza: 0.8, datos: { titulo: 'El perseguidor', autores: [{ nombre: 'Julio', apellidos: 'Cortázar' }], tipoCSL: 'document' } }, ...r.hallazgos], 'x.pdf');
    expect(m).toMatchObject({ anioOriginal: 1959, contenedor: 'Las armas secretas', tipoCSL: 'chapter' });
    expect(m.procedencia?.anioOriginal?.fuente).toMatch(/wikidata|openlibrary/);
    // Wikidata y Open Library coinciden: confianza alta.
    expect(m.procedencia?.anioOriginal?.confianza).toBeGreaterThanOrEqual(0.9);
    expect(m.procedencia?.contenedor?.fuente).toBe('wikipedia');
  });

  it('una obra de otro autor con el mismo título no vale', async () => {
    const http = httpFalso([['wbsearchentities', busquedaPerseguidor], ['query.wikidata.org', sparqlPerseguidor]]);
    const r = await enriquecer({ base: { titulo: 'El perseguidor', autores: [{ nombre: 'Osías', apellidos: 'Wilenski' }] }, texto: '', tipo: 'pdf' }, crearConsultor({ http }));
    expect(r.hallazgos.some((h) => h.fuente === 'wikidata')).toBe(false);
  });

  it('suelta sin fecha: «s. f.» con horquilla por el impresor, sin inventar el año', async () => {
    const r = await enriquecer({ base: { titulo: 'El casamiento en la muerte', autores: [{ nombre: 'Lope', apellidos: 'de Vega Carpio' }] }, texto: 'Con licencia: En Sevilla, en la Imprenta de la VIVDA de FRANCISCO LEEFDAEL, en la Casa del Correo Viejo.', tipo: 'pdf_escaneado' }, null);
    const m = fusionarMetadatos(r.hallazgos.map((h) => ({ fuente: h.fuente, confianza: h.confianza, ...(h.porCampo ? { porCampo: h.porCampo } : {}), datos: h.datos })), 'x.pdf');
    expect(m.anio).toBeUndefined();
    expect(m.sinFecha).toMatchObject({ desde: 1729, hasta: 1753 });
    expect(m.sinFecha?.fundamento).toMatch(/BNE/);
    expect(m.procedencia?.sinFecha?.confianza).toBeLessThan(0.75);
    expect(m).toMatchObject({ lugar: 'Sevilla', editorial: 'Viuda de Francisco de Leefdael' });
  });

  it('ISBN impreso: la edición por Open Library y la obra por su primer año', async () => {
    const http = httpFalso([
      ['openlibrary.org/isbn/9780521477352', { title: 'The discarded image', publishers: ['Cambridge University Press'], publish_date: '1994', publish_places: ['Cambridge'], key: '/books/OL1215600M' }],
      ['openlibrary.org/search.json?isbn', { docs: [{ key: '/works/OL71146W', title: 'The discarded image', author_name: ['C. S. Lewis'], first_publish_year: 1964 }] }],
    ]);
    const r = await enriquecer({ base: { titulo: 'The Discarded Image', autores: [{ nombre: 'C. S.', apellidos: 'Lewis' }], tipoCSL: 'book' }, texto: 'ISBN 0 521 47735 2 paperback', tipo: 'pdf' }, crearConsultor({ http }));
    const m = fusionarMetadatos(r.hallazgos.map((h) => ({ fuente: h.fuente, confianza: h.confianza, ...(h.porCampo ? { porCampo: h.porCampo } : {}), datos: h.datos })), 'x.pdf');
    expect(m).toMatchObject({ anio: 1994, anioOriginal: 1964, isbn: '9780521477352', editorial: 'Cambridge University Press' });
  });

  it('programa de televisión: cadena, contenedor y presentador; el invitado se queda', async () => {
    const http = httpFalso([
      ['wbsearchentities', { search: [{ id: 'Q8183492', label: 'A fondo', description: 'Spanish television show' }] }],
      ['query.wikidata.org', { results: { bindings: [
        { item: { value: 'http://www.wikidata.org/entity/Q8183492' }, itemLabel: { value: 'A fondo' }, inicio: { value: '1976-01-01T00:00:00Z' }, claseLabel: { value: 'programa de televisión' }, redLabel: { value: 'La 1' }, duenoLabel: { value: 'Televisión Española' }, presLabel: { value: 'Joaquín Soler Serrano' } },
        { item: { value: 'http://www.wikidata.org/entity/Q8183492' }, itemLabel: { value: 'A fondo' }, duenoLabel: { value: 'RTVE' } },
      ] } }],
    ]);
    const base = { titulo: 'A fondo', autores: [{ nombre: 'Julio', apellidos: 'Cortázar' }], anio: 1977, tipoCSL: 'interview' };
    const r = await enriquecer({ base, texto: '', tipo: 'video' }, crearConsultor({ http }));
    const m = fusionarMetadatos([{ fuente: 'lectura', confianza: 0.8, datos: base }, ...r.hallazgos.map((h) => ({ fuente: h.fuente, confianza: h.confianza, ...(h.porCampo ? { porCampo: h.porCampo } : {}), datos: h.datos }))], 'x.mp4');
    expect(r.hallazgos.length, JSON.stringify(r)).toBe(1);
    expect(m).toMatchObject({ editorial: 'RTVE', contenedor: 'A fondo', tipoCSL: 'broadcast', anio: 1977 });
    expect(m.autores.map((a) => a.apellidos)).toEqual(['Soler Serrano', 'Cortázar']);
    expect(r.avisos).toEqual([]);
  });
});

describe('fusión y usuario', () => {
  it('lo que editó el usuario no se pisa nunca', () => {
    const m = fusionarMetadatos([
      { fuente: 'colofon', confianza: 0.92, datos: { anio: 2002, anioOriginal: 1975 } },
      { fuente: 'wikidata', confianza: 1, datos: { anioOriginal: 1975 } },
      { fuente: 'usuario', confianza: 1, datos: { anio: 1990 } },
    ], 'x.pdf');
    expect(m.anio).toBe(1990);
    expect(m.procedencia?.anio?.fuente).toBe('usuario');
    expect(m.anioOriginal).toBe(1975);
  });
  it('la obra no puede ser posterior a la edición: cede la menos fiable', () => {
    const m = fusionarMetadatos([{ fuente: 'colofon', confianza: 0.95, datos: { anio: 1964 } }, { fuente: 'openlibrary', confianza: 0.7, datos: { anioOriginal: 1994 } }], 'x.pdf');
    expect(m.anio).toBe(1964);
    expect(m.anioOriginal).toBeUndefined();
  });
  it('mismo año de obra y edición: se conservan los dos (primera edición)', () => {
    const m = fusionarMetadatos([{ fuente: 'colofon', confianza: 0.9, datos: { anio: 1964, anioOriginal: 1964 } }], 'x.pdf');
    expect(m).toMatchObject({ anio: 1964, anioOriginal: 1964 });
  });
});

describe('paso completo', () => {
  it('refinar con el libro entero lee el colofón del final', async () => {
    const redactor = redactorFalso(() => ({ titulo: 'El casamiento en la muerte', autores: [{ nombre: 'Lope', apellidos: 'de Vega Carpio' }], idioma: 'es', tipoCSL: 'book' }));
    const paginas = [pagina(1, ''), pagina(2, 'EL CASAMIENTO EN LA MVERTE. COMEDIA FAMOSA, DE LOPE DE VEGA CARPIO.'), pagina(3, 'Versos'), pagina(4, 'Más versos'), pagina(5, 'Versos'), pagina(6, 'Versos'),
      pagina(7, 'Y aqui acaba la Comedia del Casamiento en la Muerte.\n\nFIN.\n\nCon licencia: En Sevilla, en la Imprenta de la VIVDA de FRANCISCO LEEFDAEL, en la Casa del Correo Viejo.'), pagina(8, '')];
    const entrada = { ficha: {}, nombreArchivo: 'el-casamiento.pdf', tipo: 'pdf_escaneado', epub: false, unidades: paginas.slice(0, 5) };
    const r0 = await pasoMetadatos(entrada, { redactor }, { sinVerificacion: true });
    expect(r0.metadatos.sinFecha).toBeUndefined();
    const r = await refinarMetadatos(r0, { ...entrada, todas: paginas }, { redactor }, { sinVerificacion: true });
    expect(r.metadatos.sinFecha).toMatchObject({ desde: 1729, hasta: 1753 });
    expect(r.metadatos.lugar).toBe('Sevilla');
    expect(r.metadatos.autores[0]).toEqual({ nombre: 'Lope', apellidos: 'de Vega Carpio' });
  });
  it('el usuario manda también en el paso completo', async () => {
    const redactor = redactorFalso(() => ({ titulo: 'Vigilar y castigar', autores: [{ nombre: 'Michel', apellidos: 'Foucault' }], idioma: 'es', tipoCSL: 'book', anio: 2002 }));
    const { metadatos } = await pasoMetadatos({ ficha: {}, nombreArchivo: 'v.pdf', tipo: 'pdf', epub: false, unidades: [pagina(1, '© Éditions Gallimard, 1975\nTítulo original: Surveiller et punir\nEsta edición: 2002')], usuario: { anioOriginal: 1976 } }, { redactor }, { sinVerificacion: true });
    expect(metadatos.anioOriginal).toBe(1976);
    expect(metadatos.procedencia?.anioOriginal?.fuente).toBe('usuario');
    expect(metadatos).toMatchObject({ anio: 2002, tituloOriginal: 'Surveiller et punir' });
  });
});
