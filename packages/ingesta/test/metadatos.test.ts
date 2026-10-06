import { describe, expect, it } from 'vitest';
import { coincidencia, esTituloBasura, fusionarMetadatos, normalizarLectura, pasoMetadatos, tituloDeArchivo } from '../src/pasos/metadatos.js';
import { partirAutores, separarNombre } from '../src/pasos/autores.js';
import type { Http } from '../src/tipos.js';
import { redactorFalso } from './fakes.js';

describe('títulos basura', () => {
  it('reconoce nombres de archivo y fichas de programa', () => {
    expect(esTituloBasura('The_Discarded_Image_An_Introduction_t_z_library_sk,_1lib_sk,')).toBe(true);
    expect(esTituloBasura('Microsoft Word - tesis_final.docx')).toBe(true);
    expect(esTituloBasura('265eed42-51b0-4061-8fc4-ac9013ed3f67')).toBe(true);
    expect(esTituloBasura('untitled')).toBe(true);
    expect(esTituloBasura('Attention Is All You Need')).toBe(false);
    expect(esTituloBasura('El perseguidor')).toBe(false);
    expect(tituloDeArchivo('cortazar1959perseguidor.pdf')).toBeNull();
  });
});

describe('autores', () => {
  it('separa nombre y apellidos', () => {
    expect(separarNombre('C. S. Lewis')).toEqual({ nombre: 'C. S.', apellidos: 'Lewis' });
    expect(separarNombre('Lope de Vega Carpio')).toEqual({ nombre: 'Lope', apellidos: 'de Vega Carpio' });
    expect(separarNombre('Joaquín Soler Serrano', 'es')).toEqual({ nombre: 'Joaquín', apellidos: 'Soler Serrano' });
    expect(separarNombre('Foucault, Michel')).toEqual({ nombre: 'Michel', apellidos: 'Foucault' });
    expect(separarNombre('JULIO CORTÁZAR')).toEqual({ nombre: 'Julio', apellidos: 'Cortázar' });
  });
  it('parte listas en todos los formatos', () => {
    expect(partirAutores('Ashish Vaswani, Noam Shazeer, Niki Parmar and Jakob Uszkoreit').map((a) => a.apellidos)).toEqual(['Vaswani', 'Shazeer', 'Parmar', 'Uszkoreit']);
    expect(partirAutores('Lewis, C. S.')).toEqual([{ nombre: 'C. S.', apellidos: 'Lewis' }]);
    expect(partirAutores('Vaswani, A., Shazeer, N.').map((a) => a.apellidos)).toEqual(['Vaswani', 'Shazeer']);
    expect(partirAutores('Foucault, Michel; Deleuze, Gilles').map((a) => a.nombre)).toEqual(['Michel', 'Gilles']);
    expect(partirAutores('Ana Pérez y Luis Gómez').map((a) => a.apellidos)).toEqual(['Pérez', 'Gómez']);
  });
});

describe('fusión', () => {
  it('gana la fuente de más confianza campo a campo y el título basura nunca gana', () => {
    const m = fusionarMetadatos([
      { fuente: 'pdf', confianza: 0.6, datos: { titulo: 'The_Discarded_Image_z_library', autores: [{ nombre: 'C. S.', apellidos: 'Lewis' }] } },
      { fuente: 'lectura', confianza: 0.8, datos: { titulo: 'The Discarded Image', subtitulo: 'An Introduction to Medieval and Renaissance Literature', anio: 1964, idioma: 'en' } },
      { fuente: 'openalex', confianza: 0.9, datos: { titulo: 'The Discarded Image', idioma: 'fr' } },
    ], 'x.pdf');
    expect(m.titulo).toBe('The Discarded Image');
    expect(m.idioma).toBe('en');
    expect(m.procedencia?.titulo?.fuente).toBe('openalex');
    expect(m.autores[0]?.apellidos).toBe('Lewis');
  });
  it('normaliza la lectura', () => {
    const l = normalizarLectura({ titulo: 'ATTENTION IS ALL YOU NEED', autores: [{ nombre: '', apellidos: 'Ashish Vaswani, Noam Shazeer' }], anio: '2017' as unknown as number, doi: 'https://doi.org/10.5555/ABC.1' });
    expect(l.titulo).toBe('Attention Is All You Need');
    expect(l.autores?.map((a) => a.apellidos)).toEqual(['Vaswani', 'Shazeer']);
    expect(l.anio).toBe(2017);
    expect(l.doi).toBe('10.5555/abc.1');
  });
  it('coincidencia exige título y autor compatibles', () => {
    const base = { titulo: 'The Discarded Image', autores: [{ nombre: 'C. S.', apellidos: 'Lewis' }], anio: 1964 };
    expect(coincidencia(base, { titulo: 'The Discarded Image: An Introduction', autores: [{ nombre: 'C.S.', apellidos: 'Lewis' }], anio: 1964 })).toBeGreaterThan(0.8);
    expect(coincidencia(base, { titulo: 'The Discarded Image', autores: [{ nombre: 'J.', apellidos: 'Smith' }] })).toBe(0);
  });
});

describe('pasoMetadatos', () => {
  it('lee con el redactor y verifica en Crossref por búsqueda', async () => {
    const redactor = redactorFalso(() => ({ titulo: 'Attention Is All You Need', autores: [{ nombre: 'Ashish', apellidos: 'Vaswani' }], idioma: 'en', tipoCSL: 'paper-conference', anio: 2017 }));
    const urls: string[] = [];
    const http: Http = async (url) => {
      urls.push(url);
      const json = url.includes('crossref') ? { message: { items: [{ title: ['Attention is All you Need'], author: [{ given: 'Ashish', family: 'Vaswani' }, { given: 'Noam', family: 'Shazeer' }], issued: { 'date-parts': [[2017]] }, DOI: '10.48550/ARXIV.1706.03762', type: 'proceedings-article', 'container-title': ['NeurIPS'] }] } } : { results: [] };
      return { ok: true, status: 200, json: async () => json };
    };
    const { metadatos } = await pasoMetadatos({ ficha: { titulo: 'Microsoft Word - nips.docx' }, nombreArchivo: 'attention_2017.pdf', tipo: 'pdf', epub: false, unidades: [] }, { redactor, http });
    expect(metadatos.titulo).toBe('Attention Is All You Need');
    expect(metadatos.autores.map((a) => a.apellidos)).toEqual(['Vaswani', 'Shazeer']);
    expect(metadatos.doi).toBe('10.48550/arxiv.1706.03762');
    expect(metadatos.procedencia?.doi?.fuente).toBe('crossref');
    expect(metadatos.idioma).toBe('en');
    expect(urls.some((u) => u.includes('openalex'))).toBe(true);
  });
  it('sin coincidencia externa se queda con la lectura', async () => {
    const redactor = redactorFalso(() => ({ titulo: 'El casamiento en la muerte', autores: [{ nombre: 'Lope', apellidos: 'de Vega Carpio' }], idioma: 'es', tipoCSL: 'book' }));
    const http: Http = async () => ({ ok: true, status: 200, json: async () => ({ message: { items: [{ title: ['Otra cosa muy distinta'] }] }, results: [] }) });
    const { metadatos } = await pasoMetadatos({ ficha: {}, nombreArchivo: 'el-casamiento.pdf', tipo: 'pdf_escaneado', epub: false, unidades: [] }, { redactor, http });
    expect(metadatos.titulo).toBe('El casamiento en la muerte');
    expect(metadatos.procedencia?.titulo?.fuente).toBe('lectura');
  });  it('el idioma lo dice el texto, no el modelo (el modelo tiende a contestar «es»)', async () => {
    // Darwin, «On the Origin of Species» (1859), texto literal de Project Gutenberg n.º 1228.
    const paginas = ["When on board H.M.S. ‘Beagle,’ as naturalist, I was much struck with certain facts in the distribution of the inhabitants of South America, and in the geological relations of the present to the past inhabitants of that continent.", "These facts seemed to me to throw some light on the origin of species—that mystery of mysteries, as it has been called by one of our greatest philosophers.", "If such do occur, can we doubt (remembering that many more individuals are born than can possibly survive) that individuals having any advantage, however slight, over others, would have the best chance of surviving and of procreating their kind?", "On the other hand, we may feel sure that any variation in the least degree injurious would be rigidly destroyed. This preservation of favourable variations and the rejection of injurious variations, I call Natural Selection.", "Thus, from the war of nature, from famine and death, the most exalted object which we are capable of conceiving, namely, the production of the higher animals, directly follows."];
    const unidades = paginas.map((texto, i) => ({ orden: i, fisica: i + 1, texto, vacia: false })) as never;
    const redactor = redactorFalso(() => ({ titulo: 'On the Origin of Species', autores: [{ nombre: 'Charles', apellidos: 'Darwin' }], idioma: 'es', tipoCSL: 'book', anio: 1859 }));
    const http: Http = async () => ({ ok: true, status: 200, json: async () => ({ message: { items: [] }, results: [] }) });
    const { metadatos } = await pasoMetadatos({ ficha: {}, nombreArchivo: 'origin.pdf', tipo: 'pdf_escaneado', epub: false, unidades }, { redactor, http });
    expect(metadatos.idioma).toBe('en');
    expect(metadatos.procedencia?.idioma).toMatchObject({ fuente: 'lectura', confianza: 0.85 });
    // Con poco texto no se arriesga: manda la lectura del modelo.
    const corto = await pasoMetadatos({ ficha: {}, nombreArchivo: 'origin.pdf', tipo: 'pdf_escaneado', epub: false, unidades: [] }, { redactor, http });
    expect(corto.metadatos.idioma).toBe('es');
  });
});

describe('nombres compatibles', () => {
  it('iniciales y nombres', async () => {
    const { nombresCompatibles } = await import('../src/pasos/metadatos.js');
    expect(nombresCompatibles('C. S.', 'Cynthia')).toBe(false);
    expect(nombresCompatibles('C. S.', 'Clive Staples')).toBe(true);
    expect(nombresCompatibles('Ashish', 'A.')).toBe(true);
    expect(nombresCompatibles('Julio', 'Julio')).toBe(true);
    expect(nombresCompatibles('Julio', 'Javier')).toBe(false);
  });
});
