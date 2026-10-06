import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { estadoGrabacion, fijarGrabacion } from '../src/ajustes.js';
import { alIngerirDocumento } from '../src/ciclo.js';
import { construirInstantanea, kpisCorpus, obtenerInstantanea } from '../src/corpus.js';
import { reconstruirGrafo } from '../src/grafo/grafo.js';
import { registrarBusqueda } from '../src/historial.js';
import { construirMapa } from '../src/mapa/construir.js';
import { arqueologia, descartarRecomendacion, huecos, recomendaciones, registrarApertura } from '../src/perspectivas.js';
import { exportarDatos, purgarHistorial, purgarTodo, zipExportacion } from '../src/privacidad.js';
import { crearVigilante } from '../src/vigilantes.js';
import { estanteria, puertos, sembrar, vectorDeTexto, ESPACIO } from './ayudas.js';

describe('corpus', () => {
  it('cuenta la biblioteca y cachea la instantánea', async () => {
    const sql = await estanteria();
    await sembrar(sql, { id: 'a', titulo: 'A', anio: 1975, idioma: 'es', paginas: ['uno', 'dos'] });
    await sembrar(sql, { id: 'b', titulo: 'B', anio: 1982, idioma: 'en', tipo: 'audio', paginas: ['tres'] });
    const i = await construirInstantanea(sql);
    expect(i).toMatchObject({ documentos: 2, unidades: 3, fragmentos: 3, porIdioma: { es: 1, en: 1 }, porDecada: { '1970s': 1, '1980s': 1 }, porTipo: { pdf: 1, audio: 1 } });
    await sembrar(sql, { id: 'c', titulo: 'C', paginas: ['cuatro'] });
    expect((await obtenerInstantanea(sql)).documentos).toBe(2); // en caché
    await alIngerirDocumento(puertos(sql), 'c');
    expect((await kpisCorpus(sql)).documentos).toBe(3);
  });
});

describe('perspectivas', () => {
  it('olvidados, huecos y recomendaciones', async () => {
    const sql = await estanteria();
    const temas = ['panóptico vigilancia disciplina prisión', 'banalidad mal totalitarismo juicio', 'rizoma deseo máquina territorio'];
    for (const [i, t] of temas.entries()) {
      await sembrar(sql, { id: `d${i}`, titulo: `Libro ${i}`, paginas: Array.from({ length: 6 }, (_, j) => `${t} ${j}`) });
    }
    await sql.ejecutar("UPDATE documentos SET creado = '2020-01-01T00:00:00.000Z'");
    await construirMapa(puertos(sql), { k: 3 });
    // Busca dos veces sobre vigilancia, abre d1 hace mucho.
    for (let i = 0; i < 2; i++) {
      await registrarBusqueda(sql, { consulta: 'panóptico vigilancia', vector: vectorDeTexto('panóptico vigilancia disciplina prisión'), espacio: ESPACIO.id,
        principales: [{ fragmento: 'd0-f1', documento: 'd0', etiqueta: 'p. 11', titulo: 'Libro 0', puntuacion: 1 }] });
    }
    await registrarBusqueda(sql, { consulta: 'teoría cuántica de campos', confianza: 'baja', nResultados: 0 });
    await registrarBusqueda(sql, { consulta: 'campos cuánticos y gravedad', confianza: 'baja', nResultados: 1 });
    await registrarApertura(sql, { documento: 'd1', superficie: 'visor' });
    await sql.ejecutar("UPDATE insights_aperturas SET abierta = '2021-01-01T00:00:00.000Z'");

    const a = await arqueologia(sql);
    expect(a.olvidados[0]!.documento).toBe('d0'); // nunca abierto y vuelve a salir en búsquedas
    expect(a.olvidados.find((o) => o.documento === 'd1')!.ultimaApertura).toBe('2021-01-01T00:00:00.000Z');
    expect(a.linea.length).toBeGreaterThan(0);

    const h = await huecos(sql);
    expect(h).toHaveLength(1);
    expect(h[0]!.consultas).toBe(2);
    expect(h[0]!.resultadosMedios).toBe(0.5);

    const r = await recomendaciones(sql);
    expect(r[0]!.documento).toBe('d0');
    expect(r[0]!.motivo).toContain('2 veces');
    await descartarRecomendacion(sql, 'd0');
    expect((await recomendaciones(sql)).find((x) => x.documento === 'd0')).toBeUndefined();
  });
});

describe('privacidad', () => {
  it('apaga la grabación, exporta en ZIP y purga', async () => {
    const sql = await estanteria();
    await sembrar(sql, { id: 'a', titulo: 'Á', paginas: ['texto con tildes: canción'] });
    await registrarBusqueda(sql, { consulta: 'canción', vector: new Float32Array([1, 0]) });
    await crearVigilante(sql, { nombre: 'v', consulta: 'q' });
    await reconstruirGrafo(sql);
    expect((await estadoGrabacion(sql)).activa).toBe(true);
    const e = await fijarGrabacion(sql, false);
    expect(e.activa).toBe(false);
    expect(e.desde).toBeDefined();
    expect(await registrarApertura(sql, { documento: 'a' })).toBe(false);

    const zip = zipExportacion(await exportarDatos(sql));
    const archivos = unzipSync(zip);
    expect(Object.keys(archivos)).toEqual(expect.arrayContaining(['LEEME.txt', 'manifiesto.json', 'funciones/historial.ndjson', 'biblioteca/fragmentos.ndjson']));
    const h = JSON.parse(strFromU8(archivos['funciones/historial.ndjson']!).trim());
    expect(h.consulta).toBe('canción');
    expect(h.vector).toBeUndefined();

    expect((await purgarHistorial(sql)).borrados.historial).toBe(1);
    const todo = await purgarTodo(sql);
    expect(todo.borrados).toMatchObject({ vigilantes: 1, documentos: 1, fragmentos: 1 });
    expect((await sql.ejecutar("SELECT count(*) AS n FROM fragmentos_fts WHERE fragmentos_fts MATCH 'cancion'"))[0]).toEqual({ n: 0 });
  });
});

