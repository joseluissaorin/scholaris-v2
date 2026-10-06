/**
 * Migración de los SPDF v3 reales (bench/datos/spdf-v3, no versionado; si no
 * están, estas pruebas se saltan). Se compara el resultado con la base v3
 * leída directamente con node:sqlite.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import type { AnclaPagina, AnclaTiempo } from '@scholaris/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirSpdf, type ArchivoSpdf } from '../src/archivo.js';
import { migrarBaseV3, migrarV3aV4, type InformeMigracion } from '../src/migrar-v3.js';
import { VERSION_SPDF } from '../src/esquema.js';

const DIR = join(import.meta.dirname, '../../../bench/datos/spdf-v3');
const ficheros = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.spdf')).sort() : [];
const tmp = ficheros.length ? mkdtempSync(join(tmpdir(), 'spdf-v3-')) : '';
afterAll(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

function baseV3(fichero: string): DatabaseSync {
  const ruta = join(tmp, fichero.replace(/\.spdf$/, '.db'));
  if (!existsSync(ruta)) writeFileSync(ruta, gunzipSync(readFileSync(join(DIR, fichero))));
  return new DatabaseSync(ruta, { readOnly: true });
}

const contar = (db: DatabaseSync, consulta: string): number => {
  try { return Number((db.prepare(consulta).get() as { n: number }).n); } catch { return 0; }
};

const resultados = new Map<string, { archivo: ArchivoSpdf; informe: InformeMigracion; bytes: Uint8Array }>();

describe.skipIf(!ficheros.length)('migración v3 → v4 con los SPDF reales', () => {
  beforeAll(async () => {
    for (const f of ficheros) {
      const { archivo, informe } = await migrarBaseV3(readFileSync(join(DIR, f)));
      resultados.set(f, { archivo, informe, bytes: archivo.exportar() });
    }
  }, 120_000);
  afterAll(() => { for (const r of resultados.values()) r.archivo.cerrar(); });

  it('migra los ocho ficheros', () => {
    expect(ficheros.length).toBe(8);
    expect(resultados.size).toBe(ficheros.length);
  });

  it.each(ficheros)('%s: cuentas, vectores intactos, integridad y reapertura', async (f) => {
    const { archivo, informe, bytes } = resultados.get(f)!;
    const v3 = baseV3(f);
    const doc = (await archivo.leerDocumento())!;
    expect(doc.estado).toBe('listo');
    expect(doc.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.metadatos.titulo.length).toBeGreaterThan(0);

    // Unidades: páginas en documentos, segmentos de transcripción en medios.
    const esMedio = doc.tipo === 'video' || doc.tipo === 'audio';
    const segmentos = Math.max(contar(v3, 'SELECT count(*) n FROM video_segments'), contar(v3, 'SELECT count(*) n FROM audio_segments'));
    const esperadas = esMedio && segmentos ? segmentos : contar(v3, 'SELECT count(*) n FROM pages');
    expect(informe.unidades).toBe(esperadas);
    expect(doc.unidades).toBe(esperadas);
    expect(informe.fragmentos).toBe(contar(v3, 'SELECT count(*) n FROM chunks'));

    // Cada vector de texto de v3 está en el espacio base, byte a byte.
    const base = 'qwen3-vl-embedding-2b@2048';
    const emb = v3.prepare('SELECT chunk_id, vector FROM embeddings ORDER BY chunk_id LIMIT 3').all() as Array<{ chunk_id: number; vector: Uint8Array }>;
    for (const e of emb) {
      const [v] = await archivo.leerVectores({ espacio: base, ids: [`${doc.id}:f${e.chunk_id}`] });
      expect(v, `vector del chunk ${e.chunk_id}`).toBeDefined();
      expect(new Uint8Array(v!.valores.buffer)).toEqual(new Uint8Array(e.vector));
    }
    const vectoresV3 = contar(v3, 'SELECT count(*) n FROM embeddings')
      + contar(v3, 'SELECT count(*) n FROM images WHERE length(embedding) = 8192')
      + contar(v3, 'SELECT count(*) n FROM video_frames WHERE length(embedding) = 8192')
      + contar(v3, "SELECT count(*) n FROM video_embeddings WHERE embedding_type = 'direct_video'");
    expect(informe.vectores[base] ?? 0).toBe(vectoresV3);
    expect(informe.vectores[`${base}+contexto`] ?? 0).toBe(contar(v3, 'SELECT count(*) n FROM chunk_contexts WHERE length(context_embedding) = 8192'));
    expect(informe.vectores[`${base}+fotogramas`] ?? 0).toBe(contar(v3, "SELECT count(*) n FROM video_embeddings WHERE embedding_type = 'composite_segment'"));
    const espacio = (await archivo.espacios()).find((e) => e.id === base);
    expect(espacio).toMatchObject({ dims: 2048, modelo: 'Qwen/Qwen3-VL-Embedding-2B' });

    // Blobs: el original, las miniaturas de página y las figuras.
    const original = await archivo.leerBlob('original');
    expect(original?.datos.byteLength).toBe(contar(v3, 'SELECT length(data) n FROM media_blob'));
    expect((await archivo.blobs('paginas/')).length).toBe(contar(v3, 'SELECT count(*) n FROM previews WHERE length(thumbnail) > 0'));

    // Todo fragmento tiene ancla, y su unidad existe.
    const fr = await archivo.leerFragmentos(doc.id);
    const ids = new Set((await archivo.leerUnidades(doc.id)).map((u) => u.id));
    for (const x of fr) {
      expect(ids.has(x.unidad)).toBe(true);
      expect(x.ancla.tipo).toBe(esMedio ? 'tiempo' : 'pagina');
    }

    expect(await archivo.comprobarIntegridad()).toEqual([]);
    const otra = await abrirSpdf(bytes);
    expect(await otra.leerDocumento()).toEqual(doc);
    otra.cerrar();
    v3.close();
  });

  it('The Discarded Image: folios corregidos, título y autor limpios, secciones', async () => {
    const { archivo, informe } = resultados.get('the_discarded_image_an_introduction_t_z_library_sk,_1lib_sk,.spdf')!;
    const doc = (await archivo.leerDocumento())!;
    expect(doc.metadatos.titulo).toBe('The Discarded Image An Introduction');
    expect(doc.metadatos.autores).toEqual([{ nombre: 'C. S.', apellidos: 'Lewis' }]);
    expect(doc.tipo).toBe('pdf');
    const us = await archivo.leerUnidades(doc.id);
    const impresa = (fisica: number) => (us[fisica - 1]!.ancla as AnclaPagina).impresa;
    expect(impresa(78)).toBe('65'); // v3: «5»
    expect(impresa(94)).toBe('81'); // v3: «8»
    expect(impresa(100)).toBe('87'); // v3: «100» (deducido sin fundamento)
    expect(impresa(11)).toBe('viii');
    expect((us[10]!.ancla as AnclaPagina).romana).toBe(true);
    expect(informe.folios?.cambiados).toBeGreaterThan(100);
    expect(informe.secciones).toBe(2);
    const fr = await archivo.leerFragmentos(doc.id);
    expect(fr.some((f) => f.seccion.includes('CHAPTER IV'))).toBe(true);
    expect(fr.filter((f) => f.contexto.length > 0).length).toBeGreaterThan(200);
    // «Ir a la página 65»: la página física 78, que es la unidad 77 (el contrato numera desde 0).
    const u65 = (await archivo.unidadPorFolio(doc.id, '65'))[0];
    expect(u65?.orden).toBe(77);
    expect((u65?.ancla as { fisica?: number } | undefined)?.fisica).toBe(78);
    // Ninguna unidad migrada empieza en 1 ni trae el marcado de la OCR vieja.
    const todas = await archivo.leerUnidades(doc.id);
    expect(Math.min(...todas.map((u) => u.orden))).toBe(0);
    expect(todas.some((u) => /!\[[^\]]*\]\(page=|<div align/.test(u.texto))).toBe(false);
  });

  it('El perseguidor: el idioma pasa de «EN» a «es» y la búsqueda encuentra a Johnny', async () => {
    const { archivo } = resultados.get('cortazar1959perseguidor.spdf')!;
    const doc = (await archivo.leerDocumento())!;
    expect(doc.metadatos.idioma).toBe('es');
    expect(doc.metadatos.procedencia?.idioma?.fuente).toBe('lectura');
    expect(doc.metadatos.autores).toEqual([{ nombre: 'Julio', apellidos: 'Cortázar' }]);
    const r = await archivo.buscarTexto('saxo Johnny', { modo: 'todas' });
    expect(r.length).toBeGreaterThan(0);
    expect((r[0]!.fragmento.ancla as AnclaPagina).impresa).toMatch(/^\d+$/);
  });

  it('El casamiento en la muerte: escaneado, sin folios inventados, figuras con su página', async () => {
    const { archivo, informe } = resultados.get('el-casamiento-en-la-muerte-y-hechos-de-bernardo-del-carpio-comedia-famosa.spdf')!;
    const doc = (await archivo.leerDocumento())!;
    expect(doc.tipo).toBe('pdf_escaneado');
    expect(doc.metadatos.anio).toBe(1753);
    expect(doc.metadatos.autores).toEqual([{ nombre: 'Lope', apellidos: 'de Vega Carpio' }]);
    expect(doc.metadatos.idioma).toBe('es');
    const us = await archivo.leerUnidades(doc.id);
    expect(us.every((u) => (u.ancla as AnclaPagina).origen === 'ninguno')).toBe(true);
    expect(informe.figuras).toBe(734);
    const figs = await archivo.leerFiguras(doc.id);
    expect(figs[0]?.ancla.tipo).toBe('pagina');
    expect((await archivo.leerBlob(figs[0]!.imagen))?.datos.byteLength).toBeGreaterThan(100);
    expect(informe.ignorado.cross_modal_links).toBe(1895);
  });

  it('Attention: autores solo con apellido, folios 1-15', async () => {
    const { archivo } = resultados.get('attention_2017.spdf')!;
    const doc = (await archivo.leerDocumento())!;
    expect(doc.metadatos.autores.map((a) => a.apellidos)).toEqual(['Vaswani', 'Shazeer', 'Parmar']);
    const us = await archivo.leerUnidades(doc.id);
    expect(us.map((u) => (u.ancla as AnclaPagina).impresa)).toEqual(Array.from({ length: 15 }, (_, i) => String(i + 1)));
  });

  it('A fondo (vídeo de 54 min): tramos con tiempo, fotogramas y vectores visuales', async () => {
    const { archivo } = resultados.get('serrano1977fondo.spdf')!;
    const doc = (await archivo.leerDocumento())!;
    expect(doc.tipo).toBe('video');
    expect(doc.duracion).toBeCloseTo(3219.33, 1);
    expect(doc.metadatos.idioma).toBe('es');
    expect(doc.metadatos.autores).toEqual([{ nombre: 'Joaquín', apellidos: 'Soler Serrano' }, { nombre: 'Facundo', apellidos: 'Cabral' }]);
    const us = await archivo.leerUnidades(doc.id);
    const a = us[100]!.ancla as AnclaTiempo;
    expect(a.tipo).toBe('tiempo');
    expect(a.t1).toBeGreaterThan(a.t0);
    for (let i = 1; i < us.length; i++) expect((us[i]!.ancla as AnclaTiempo).t0).toBeGreaterThanOrEqual((us[i - 1]!.ancla as AnclaTiempo).t0);
    expect(us.filter((u) => u.imagen).length).toBeGreaterThan(50);
    const figs = await archivo.leerFiguras(doc.id);
    expect(figs.filter((f) => f.id.includes(':v')).length).toBe(429);
    expect(figs.filter((f) => f.id.includes(':k')).length).toBe(495);
    const r = await archivo.buscarTexto('Mallorca');
    expect(r[0]?.fragmento.ancla.tipo).toBe('tiempo');
  });

  it('audio: unidades con tiempo y vectores', async () => {
    const { archivo, informe } = resultados.get('audio_conference.spdf')!;
    const doc = (await archivo.leerDocumento())!;
    expect(doc.tipo).toBe('audio');
    expect(doc.mime).toBe('audio/mpeg');
    expect(informe.unidades).toBe(7);
    const fr = await archivo.leerFragmentos(doc.id);
    expect((fr[1]!.ancla as AnclaTiempo).t0).toBeCloseTo(33.93, 2);
  });

  it('abrirSpdf migra al vuelo un v3 y migrarV3aV4 es determinista en los identificadores', async () => {
    const bytes = readFileSync(join(DIR, 'scanned_ocr_test.spdf'));
    const a = await abrirSpdf(bytes);
    expect(await a.version()).toBe(VERSION_SPDF);
    expect(await a.leerClave('migrado_de')).toBe('spdf 2.1');
    const id1 = (await a.leerDocumento())!.id;
    a.cerrar();
    const b = await abrirSpdf(await migrarV3aV4(bytes));
    expect((await b.leerDocumento())!.id).toBe(id1);
    b.cerrar();
    await expect(abrirSpdf(bytes, { migrar: false })).rejects.toThrow(/migrar/);
  });
});
