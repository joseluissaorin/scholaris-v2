import type { Documento, Fragmento } from '@scholaris/nucleo';
import { gunzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { abrirSpdf, ArchivoSpdf, crearSpdf, esGzip, esSqlite } from '../src/archivo.js';
import { consultaFts } from '../src/repositorio.js';
import { VERSION_SPDF } from '../src/esquema.js';
import { bytesAFloat32, float32ABytes } from '../src/vectores.js';

const doc: Documento = {
  id: 'doc1',
  tipo: 'pdf',
  metadatos: { titulo: 'Rayuela', autores: [{ nombre: 'Julio', apellidos: 'Cortázar' }], anio: 1963, idioma: 'es' },
  estado: 'listo',
  huella: 'a'.repeat(64),
  original: '',
  mime: 'application/pdf',
  bytes: 1234,
  unidades: 3,
  creado: '2026-10-06T10:00:00.000Z',
  actualizado: '2026-10-06T10:00:00.000Z',
  bibliotecas: ['b1'],
};

const pagina = (fisica: number, impresa: string | null) => ({ tipo: 'pagina' as const, fisica, impresa, romana: false, origen: 'leido' as const, confianza: 0.98 });

const fragmentos: Fragmento[] = [
  { id: 'f1', documento: 'doc1', unidad: 'u1', orden: 1, texto: '¿Encontraría a la Maga? Tantas veces me había bastado asomarme…', contexto: 'Capítulo 1, del lado de allá', seccion: ['Del lado de allá', '1'], ancla: pagina(1, '15') },
  { id: 'f2', documento: 'doc1', unidad: 'u2', orden: 2, texto: 'La canción de la Maga sonaba en el puente de las Artes.', contexto: '', seccion: ['Del lado de allá', '2'], ancla: pagina(2, '16'), anclaFin: pagina(3, '17') },
  { id: 'f3', documento: 'doc1', unidad: 'u3', orden: 3, texto: 'Oliveira pensaba en el club de la Serpiente y en el jazz.', contexto: '', seccion: ['Del lado de allá', '3'], ancla: pagina(3, '17') },
];

async function lleno(): Promise<ArchivoSpdf> {
  const a = await crearSpdf();
  await a.escribirDocumento(doc);
  await a.escribirUnidades([1, 2, 3].map((n) => ({
    id: `u${n}`, documento: 'doc1', orden: n, ancla: pagina(n, String(14 + n)), texto: `texto ${n}`, lector: 'prueba', confianza: 0.9,
    cabecera: 'RAYUELA', pie: String(14 + n), notas: n === 2 ? ['¹ Nota.'] : [], miniatura: `paginas/000${n}.jpg`,
  })));
  await a.escribirSecciones([{ id: 's1', documento: 'doc1', nivel: 1, titulo: 'Del lado de allá', unidadDesde: 'u1', unidadHasta: 'u3' }]);
  await a.escribirFragmentos(fragmentos);
  await a.escribirFiguras([{ id: 'g1', documento: 'doc1', unidad: 'u2', imagen: 'figuras/1.png', pie: 'Mapa de París', ancla: pagina(2, '16') }]);
  await a.escribirEspacio({ id: 'prueba@4', proveedor: 'local', modelo: 'prueba', dims: 4, normalizado: true, modalidades: ['texto'] });
  await a.escribirVectores([
    { objetivo: 'fragmento', id: 'f1', espacio: 'prueba@4', documento: 'doc1', valores: new Float32Array([0.5, -0.25, 0.125, 1e-7]) },
    { objetivo: 'fragmento', id: 'f2', espacio: 'prueba@4', documento: 'doc1', valores: new Float32Array([1, 0, 0, 0]) },
  ]);
  await a.ponerBlob('figuras/1.png', 'image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  await a.registrarProcedencia({ documento: 'doc1', fase: 'lectura', proveedor: 'prueba', detalle: { paginas: 3 }, ms: 12 });
  return a;
}

describe('ArchivoSpdf', () => {
  it('crea un SPDF 4.1 vacío', async () => {
    const a = await crearSpdf();
    expect(await a.version()).toBe(VERSION_SPDF);
    expect(await a.documentos()).toEqual([]);
    const [v] = await a.sql.ejecutar<{ user_version: number }>('PRAGMA user_version');
    expect(v?.user_version).toBe(410);
    a.cerrar();
  });

  it('ida y vuelta: exportar (gzip) y abrir conserva todo', async () => {
    const a = await lleno();
    const bytes = a.exportar();
    a.cerrar();
    expect(esGzip(bytes)).toBe(true);
    expect(esSqlite(gunzipSync(bytes))).toBe(true);

    const b = await abrirSpdf(bytes);
    expect(await b.leerDocumento()).toEqual(doc);
    const us = await b.leerUnidades('doc1');
    expect(us).toHaveLength(3);
    expect(us[1]).toMatchObject({ id: 'u2', cabecera: 'RAYUELA', pie: '16', notas: ['¹ Nota.'], ancla: pagina(2, '16'), miniatura: 'paginas/0002.jpg' });
    expect(await b.leerFragmentos('doc1')).toEqual(fragmentos);
    expect((await b.leerSecciones('doc1'))[0]).toMatchObject({ titulo: 'Del lado de allá', unidadDesde: 'u1', unidadHasta: 'u3' });
    expect((await b.leerFiguras('doc1'))[0]).toMatchObject({ id: 'g1', pie: 'Mapa de París' });
    expect(await b.espacios()).toEqual([{ id: 'prueba@4', proveedor: 'local', modelo: 'prueba', dims: 4, normalizado: true, modalidades: ['texto'] }]);
    expect((await b.leerBlob('figuras/1.png'))?.datos).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    expect(await b.blobs('figuras/')).toEqual([{ clave: 'figuras/1.png', mime: 'image/png', bytes: 7 }]);
    expect((await b.leerProcedencia('doc1'))[0]).toMatchObject({ fase: 'lectura', detalle: { paginas: 3 }, ms: 12 });
    expect((await b.unidadPorFolio('doc1', '17'))[0]?.id).toBe('u3');
    expect(await b.comprobarIntegridad()).toEqual([]);
    b.cerrar();
  });

  it('abre también SQLite sin comprimir', async () => {
    const a = await lleno();
    const crudo = a.exportarSqlite();
    a.cerrar();
    const b = await abrirSpdf(crudo);
    expect((await b.leerDocumento())?.id).toBe('doc1');
    b.cerrar();
  });

  it('rechaza lo que no es un SPDF', async () => {
    await expect(abrirSpdf(new Uint8Array([1, 2, 3]))).rejects.toThrow(/SPDF/);
    const otra = await crearSpdf();
    otra.db.exec('DROP TABLE documentos');
    const bytes = otra.exportar();
    otra.cerrar();
    await expect(abrirSpdf(bytes)).rejects.toThrow(/esquema/);
  });

  it('las transacciones se deshacen si algo falla', async () => {
    const a = await lleno();
    await expect(a.sql.transaccion(async (t) => {
      await t.ejecutar("DELETE FROM fragmentos WHERE id = 'f1'");
      throw new Error('falla a propósito');
    })).rejects.toThrow('falla');
    expect(await a.leerFragmento('f1')).not.toBeNull();
    // anidadas
    await a.sql.transaccion(async (t) => {
      await t.ejecutar("DELETE FROM fragmentos WHERE id = 'f3'");
      await t.transaccion(async (u) => { await u.ejecutar("DELETE FROM fragmentos WHERE id = 'f2'"); });
    });
    expect((await a.leerFragmentos('doc1')).map((f) => f.id)).toEqual(['f1']);
    a.cerrar();
  });

  it('borrarDocumento quita todo lo que cuelga de él', async () => {
    const a = await lleno();
    await a.borrarDocumento('doc1');
    for (const t of ['documentos', 'unidades', 'fragmentos', 'figuras', 'vectores', 'secciones', 'procedencia']) {
      const [f] = await a.sql.ejecutar<{ n: number }>(`SELECT count(*) AS n FROM ${t}`);
      expect(f?.n, t).toBe(0);
    }
    expect(await a.buscarTexto('Maga')).toEqual([]);
    a.cerrar();
  });
});

describe('FTS5', () => {
  it('busca sin tildes, ordena por BM25 y resalta', async () => {
    const a = await lleno();
    const r = await a.buscarTexto('cancion maga');
    expect(r[0]?.fragmento.id).toBe('f2');
    expect(r[0]?.resaltado).toContain('[canción]');
    expect(r.map((x) => x.fragmento.id)).toContain('f1');
    expect(r[0]!.puntuacion).toBeGreaterThan(r[r.length - 1]!.puntuacion - 1e-9);
    a.cerrar();
  });

  it('modos: todas las palabras, frase exacta, consulta cruda', async () => {
    const a = await lleno();
    expect((await a.buscarTexto('maga puente', { modo: 'todas' })).map((x) => x.fragmento.id)).toEqual(['f2']);
    expect((await a.buscarTexto('puente de las artes', { modo: 'frase' })).map((x) => x.fragmento.id)).toEqual(['f2']);
    expect((await a.buscarTexto('serp*', { crudo: true })).map((x) => x.fragmento.id)).toEqual(['f3']);
    expect((await a.buscarTexto('seccion:"lado"', { crudo: true })).length).toBe(3);
    a.cerrar();
  });

  it('indexa el contexto y la sección, y filtra por documento', async () => {
    const a = await lleno();
    expect((await a.buscarTexto('alla')).length).toBe(3);
    expect(await a.buscarTexto('Maga', { documentos: ['otro'] })).toEqual([]);
    a.cerrar();
  });

  it('el índice sigue a las actualizaciones y los borrados', async () => {
    const a = await lleno();
    await a.escribirFragmentos([{ ...(fragmentos[2] as Fragmento), texto: 'Morelli escribía notas sobre la novela.' }]);
    expect(await a.buscarTexto('Serpiente')).toEqual([]);
    expect((await a.buscarTexto('Morelli'))[0]?.fragmento.id).toBe('f3');
    await a.sql.ejecutar("DELETE FROM fragmentos WHERE id = 'f3'");
    expect(await a.buscarTexto('Morelli')).toEqual([]);
    await a.optimizarIndice();
    expect(await a.comprobarIntegridad()).toEqual([]);
    a.cerrar();
  });

  it('consultaFts neutraliza los operadores', () => {
    expect(consultaFts('AND NEAR - "hola"', 'alguna', false)).toBe('"AND" OR "NEAR" OR "hola"');
    for (const q of [consultaFts('AND NEAR - "hola"'), consultaFts('"NEAR(a b)" OR x*', 'todas'), consultaFts('a"b', 'frase')]) {
      expect(q).not.toMatch(/NEAR\(|\*/);
    }
    expect(consultaFts('   ')).toBe('');
  });

  it('el índice sobrevive a VACUUM (rowid estable)', async () => {
    const a = await lleno();
    await a.sql.ejecutar("DELETE FROM fragmentos WHERE id = 'f1'");
    a.compactar();
    expect((await a.buscarTexto('Oliveira'))[0]?.fragmento.id).toBe('f3');
    expect(await a.comprobarIntegridad()).toEqual([]);
    a.cerrar();
  });
});

describe('vectores', () => {
  it('float32 little-endian, exactos en la ida y vuelta', async () => {
    const a = await lleno();
    const b = await abrirSpdf(a.exportar());
    a.cerrar();
    const vs = await b.leerVectores({ espacio: 'prueba@4', documento: 'doc1' });
    expect(vs.map((v) => v.id)).toEqual(['f1', 'f2']);
    expect(Array.from(vs[0]!.valores)).toEqual(Array.from(new Float32Array([0.5, -0.25, 0.125, 1e-7])));
    const [crudo] = await b.sql.ejecutar<{ valores: Uint8Array }>("SELECT valores FROM vectores WHERE id = 'f1'");
    expect(crudo?.valores.byteLength).toBe(16);
    expect(new DataView(crudo!.valores.buffer, crudo!.valores.byteOffset).getFloat32(4, true)).toBe(-0.25);
    expect((await b.leerVectores({ espacio: 'prueba@4', ids: ['f2'] }))[0]?.valores[0]).toBe(1);
    b.cerrar();
  });

  it('rechaza dimensiones equivocadas y espacios sin registrar', async () => {
    const a = await lleno();
    await expect(a.escribirVectores([{ objetivo: 'fragmento', id: 'f3', espacio: 'prueba@4', documento: 'doc1', valores: new Float32Array(3) }])).rejects.toThrow(/dimensiones/);
    await expect(a.escribirVectores([{ objetivo: 'fragmento', id: 'f3', espacio: 'nada@4', documento: 'doc1', valores: new Float32Array(4) }])).rejects.toThrow(/no está registrado/);
    a.cerrar();
  });

  it('varios espacios por objetivo', async () => {
    const a = await lleno();
    await a.escribirEspacio({ id: 'otro@2', proveedor: 'google', modelo: 'otro', dims: 2, normalizado: false, modalidades: ['texto', 'imagen'] });
    await a.escribirVectores([{ objetivo: 'fragmento', id: 'f1', espacio: 'otro@2', documento: 'doc1', valores: new Float32Array([3, 4]) }]);
    expect(await a.leerVectores({ espacio: 'otro@2' })).toHaveLength(1);
    expect(await a.leerVectores({ espacio: 'prueba@4' })).toHaveLength(2);
    a.cerrar();
  });

  it('conversión de bytes sin alinear', () => {
    const v = new Float32Array([1.5, -2, 3.25]);
    const b = float32ABytes(v);
    const desalineado = new Uint8Array(b.length + 1);
    desalineado.set(b, 1);
    expect(Array.from(bytesAFloat32(desalineado.subarray(1)))).toEqual([1.5, -2, 3.25]);
  });
});
