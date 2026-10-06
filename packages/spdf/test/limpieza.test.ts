import { describe, expect, it } from 'vitest';
import { detectarIdioma, esVacio, limpiarTitulo, normalizarIdioma, parsearAutor, parsearAutores } from '../src/limpieza.js';
import { colaDeTexto, mimeImagen, pareceEscaneado } from '../src/migrar-v3.js';

describe('autores', () => {
  it.each([
    ['Julio Cortázar', 'Julio', 'Cortázar'],
    ['C. S. Lewis', 'C. S.', 'Lewis'],
    ['Lope de Vega Carpio', 'Lope', 'de Vega Carpio'],
    ['Joaquín Soler Serrano', 'Joaquín', 'Soler Serrano'],
    ['José Luis Saorín Ferrer', 'José Luis', 'Saorín Ferrer'],
    ['Foucault, Michel', 'Michel', 'Foucault'],
    ['Vaswani', '', 'Vaswani'],
    ['  Shazeer ', '', 'Shazeer'],
    ['J.R.R. Tolkien', 'J.R.R.', 'Tolkien'],
  ])('%s', (entrada, nombre, apellidos) => {
    expect(parsearAutor(entrada)).toEqual({ nombre, apellidos });
  });

  it('listas JSON, cadenas con separadores y vacíos', () => {
    expect(parsearAutores('["Vaswani", " Shazeer", " Parmar"]').map((a) => a.apellidos)).toEqual(['Vaswani', 'Shazeer', 'Parmar']);
    expect(parsearAutores('["Julio Cort\\u00e1zar"]')).toEqual([{ nombre: 'Julio', apellidos: 'Cortázar' }]);
    expect(parsearAutores('Deleuze; Guattari')).toHaveLength(2);
    expect(parsearAutores('Gilles Deleuze y Félix Guattari')).toHaveLength(2);
    expect(parsearAutores('[]')).toEqual([]);
    expect(parsearAutores('["[NOT_FOUND]"]')).toEqual([]);
    expect(parsearAutores([{ given: 'Ada', family: 'Lovelace' }])).toEqual([{ nombre: 'Ada', apellidos: 'Lovelace' }]);
  });
});

describe('títulos e idioma', () => {
  it('limpia títulos de nombre de fichero', () => {
    expect(limpiarTitulo('The_Discarded_Image_An_Introduction_t_z_library_sk,_1lib_sk,')).toBe('The Discarded Image An Introduction');
    expect(limpiarTitulo('El casamiento en la muerte - Viuda de Francisco Leefdael ')).toBe('El casamiento en la muerte - Viuda de Francisco Leefdael');
    expect(limpiarTitulo('Rayuela.pdf')).toBe('Rayuela');
    expect(limpiarTitulo('Attention Is All You Need')).toBe('Attention Is All You Need');
  });

  it('detecta el idioma por palabras vacías', () => {
    expect(detectarIdioma('Nunca me preocupo demasiado por las cosas que dice Johnny pero ahora, con su manera de hablar de la música y de lo que le pasa cuando toca, me quedo pensando en el tiempo y en la gente que se va')?.idioma).toBe('es');
    expect(detectarIdioma('The fundamental root of it all building block for linear algebra is the vector, so it is worth making sure that we are all on the same page about what exactly a vector is and what it means for the rest')?.idioma).toBe('en');
    expect(detectarIdioma('corto')).toBeNull();
  });

  it('normaliza códigos de idioma', () => {
    expect(normalizarIdioma('EN')).toBe('en');
    expect(normalizarIdioma('es_ES')).toBe('es-es');
    expect(normalizarIdioma('Spanish')).toBe('es');
    expect(normalizarIdioma('[NOT_FOUND]')).toBeNull();
    expect(normalizarIdioma('???')).toBeNull();
    expect(esVacio(' n/a ')).toBe(true);
  });
});

describe('utilidades de migración', () => {
  it('mime de imágenes por la firma', () => {
    expect(mimeImagen(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(mimeImagen(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(mimeImagen(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
  });

  it('PDF escaneado: sin fuentes y con imágenes', () => {
    const t = (s: string) => new TextEncoder().encode(s);
    expect(pareceEscaneado(t('<< /Type /XObject /Subtype /Image >>'), 1)).toBe(true);
    expect(pareceEscaneado(t('<< /Font /F1 >> << /Font /F2 >> << /Font /F3 >> << /Font /F4 >> << /Subtype /Image >>'), 1)).toBe(false);
  });

  it('cola de texto cortada por palabra', () => {
    expect(colaDeTexto('uno dos tres', 240)).toBe('uno dos tres');
    const c = colaDeTexto('palabra '.repeat(100), 30);
    expect(c.startsWith('…')).toBe(true);
    expect(c.length).toBeLessThanOrEqual(31);
  });
});

describe('reparación de los documentos migrados con el migrador antiguo', () => {
  it('renumera desde 0 y quita el marcado de la OCR vieja una sola vez', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { aplicarEsquema, repararMigrados, REPARACION_MIGRADOS } = await import('../src/index.js');
    const bd = new DatabaseSync(':memory:');
    const sql = { async ejecutar<T>(c: string, ...p: unknown[]) { return bd.prepare(c).all(...(p as never[])) as T[]; }, async transaccion<T>(fn: (s: never) => Promise<T>) { return fn(sql as never); } };
    await aplicarEsquema(sql as never);
    // Simula una estantería anterior a la reparación.
    await sql.ejecutar('DELETE FROM spdf WHERE clave = ?', REPARACION_MIGRADOS);
    await sql.ejecutar(`INSERT INTO documentos (id, tipo, metadatos, estado, huella, original, mime, bytes, creado, actualizado) VALUES ('m', 'pdf_escaneado', '{"titulo":"Mafalda 1","autores":[]}', 'listo', 'h', '', 'x', 1, 'x', 'x')`);
    await sql.ejecutar(`INSERT INTO documentos (id, tipo, metadatos, estado, huella, original, mime, bytes, creado, actualizado) VALUES ('n', 'pdf', '{"titulo":"Nuevo","autores":[]}', 'listo', 'h2', '', 'x', 1, 'x', 'x')`);
    const ancla = (f: number) => JSON.stringify({ tipo: 'pagina', fisica: f, impresa: null, romana: false, origen: 'ninguno', confianza: 1 });
    for (const o of [1, 2, 3]) await sql.ejecutar('INSERT INTO unidades (id, documento, orden, ancla, texto, lector, confianza) VALUES (?, ?, ?, ?, ?, ?, 1)', `m:u${o}`, 'm', o, ancla(o), o === 1 ? '![](page=0,bbox=[25, 11, 817, 447])\n\n<div align="center">\n\n# MAFALDA\n\n</div>' : `página ${o}`, 'scholaris-v3');
    // Un documento nuevo a medio leer (empieza en 1 porque falta la 0): no se toca.
    for (const o of [1, 2]) await sql.ejecutar('INSERT INTO unidades (id, documento, orden, ancla, texto, lector, confianza) VALUES (?, ?, ?, ?, ?, ?, 1)', `n:u${o}`, 'n', o, ancla(o + 1), 'x', 'gemini');
    await sql.ejecutar(`INSERT INTO fragmentos (id, documento, unidad, orden, texto, contexto, seccion, ancla) VALUES ('f', 'm', 'm:u1', 0, '![](page=0,bbox=[1, 2, 3, 4]) MAFALDA', '', '[]', ?)`, ancla(1));
    const r = await repararMigrados(sql as never);
    expect(r.renumerados).toBe(1);
    const m = await sql.ejecutar<{ orden: number; texto: string }>("SELECT orden, texto FROM unidades WHERE documento = 'm' ORDER BY orden");
    expect(m.map((u) => u.orden)).toEqual([0, 1, 2]);
    expect(m[0]!.texto).toBe('# MAFALDA');
    expect((await sql.ejecutar<{ orden: number }>("SELECT orden FROM unidades WHERE documento = 'n' ORDER BY orden")).map((u) => u.orden)).toEqual([1, 2]);
    const [f] = await sql.ejecutar<{ texto: string; tb: string | null }>("SELECT texto, texto_busqueda AS tb FROM fragmentos WHERE id = 'f'");
    expect(f!.texto).toBe('MAFALDA');
    expect(f!.tb).not.toBeNull();
    // La segunda vez no hace nada.
    expect(await repararMigrados(sql as never)).toEqual({ renumerados: 0, textos: 0 });
  });
});

describe('descripciones de figuras de la v1', () => {
  it('se queda solo la descripción, también con negritas', async () => {
    const { limpiarDescripcionV1 } = await import('@scholaris/nucleo');
    expect(limpiarDescripcionV1('Image type: ARTWORK Description: Una ilustración.')).toBe('Una ilustración.');
    expect(limpiarDescripcionV1('**Image type:** DOCUMENT **Description:** A page.')).toBe('A page.');
    expect(limpiarDescripcionV1('Grabado ovalado con la inscripción «25. Harmony».')).toBe('Grabado ovalado con la inscripción «25. Harmony».');
  });
});
