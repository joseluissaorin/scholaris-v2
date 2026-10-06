import { describe, expect, it } from 'vitest';
import * as spdf from '@scholaris/spdf';
import type { Documento, Vector } from '@scholaris/nucleo';
import { cambiosDeEscena, casarFiguras, esCandidata, regionValida, rehacerFiguras, vectorizarFigurasPendientes } from '../src/pasos/rehacer-figuras.js';
import { baseReal, embebedorFalso, redactorFalso } from './fakes.js';

const doc = (id: string, tipo: Documento['tipo']): Documento => ({
  id, tipo, metadatos: { titulo: 'Prueba', autores: [] }, estado: 'listo', huella: 'h', original: '', mime: 'application/pdf', bytes: 1,
  unidades: 3, creado: '2026-10-06T00:00:00Z', actualizado: '2026-10-06T00:00:00Z', bibliotecas: [],
});

async function libro() {
  const b = await baseReal();
  await spdf.escribirDocumento(b.sql, doc('d1', 'pdf'));
  await spdf.escribirUnidades(b.sql, [1, 2, 3].map((n) => ({
    id: `u${n}`, documento: 'd1', orden: n - 1, texto: n === 2 ? 'Figura 1: El cosmos medieval.\n\nTexto.' : 'Texto corrido '.repeat(80),
    ancla: { tipo: 'pagina' as const, fisica: n, impresa: String(n), romana: false, origen: 'leido' as const, confianza: 1 },
    lector: 'capa-pdf', confianza: 1, imagen: `paginas/000${n}.jpg`,
  })));
  // Una figura vieja sin región en la página 2 (como las de antes del 6-10-2026) y una falsa en la 3.
  await spdf.escribirFiguras(b.sql, [
    { id: 'fg-vieja', documento: 'd1', unidad: 'u2', imagen: 'paginas/0002.jpg', pie: 'Figura 1: El cosmos medieval.', ancla: { tipo: 'pagina', fisica: 2, impresa: '2', romana: false, origen: 'leido', confianza: 1 } },
    { id: 'fg-falsa', documento: 'd1', unidad: 'u3', imagen: 'paginas/0003.jpg', descripcion: 'Escudo de la editorial', ancla: { tipo: 'pagina', fisica: 3, impresa: '3', romana: false, origen: 'leido', confianza: 1 } },
  ]);
  return b;
}

const imagen = async (k: string) => ({ bytes: new TextEncoder().encode(k), mime: 'image/jpeg' });

describe('rehacer figuras', () => {
  it('regiones: se recortan a la página, se aceptan en 0-1000 y se descartan las diminutas o la página entera sin pie', () => {
    expect(regionValida({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 })).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    expect(regionValida({ x: 100, y: 200, w: 500, h: 400 })).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    expect(regionValida({ x: 0.5, y: 0.5, w: 0.05, h: 0.05 })).toBeNull();
    expect(regionValida({ x: 0, y: 0, w: 1, h: 1 })).toBeNull();
    expect(regionValida({ x: 0, y: 0, w: 1, h: 1 }, 'Lámina I')).not.toBeNull();
    expect(regionValida({ x: 0.8, y: 0.8, w: 0.5, h: 0.5 })).toEqual({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 });
  });

  it('candidatas: pie de figura, figuras ya conocidas o poco texto', () => {
    expect(esCandidata({ texto: 'Fig. 3: Mapa del mundo.\n\n' + 'texto '.repeat(200) }, false)).toBe(true);
    expect(esCandidata({ texto: 'palabra '.repeat(200) }, false)).toBe(false);
    expect(esCandidata({ texto: 'palabra '.repeat(200) }, true)).toBe(true);
    expect(esCandidata({ texto: '' }, false)).toBe(true);
  });

  it('casar: por región, por pie y la única que queda', () => {
    const r = (x: number) => ({ x, y: 0.1, w: 0.3, h: 0.3 });
    const nuevas = [{ region: r(0.1) }, { region: r(0.6), pie: 'Figura 2' }];
    const viejas = [{ id: 'a', region: r(0.62) }, { id: 'b', region: r(0.12) }];
    const m = casarFiguras(nuevas, viejas);
    expect(m.get(nuevas[0]!)?.id).toBe('b');
    expect(m.get(nuevas[1]!)?.id).toBe('a');
    const una = [{ region: r(0.1) }];
    expect(casarFiguras(una, [{ id: 'sin-region' }]).get(una[0]!)?.id).toBe('sin-region');
    const pie = [{ region: r(0.1), pie: 'Figura 1: Uno.' }, { region: r(0.6) }];
    expect(casarFiguras(pie, [{ id: 'p', pie: 'figura 1 uno' }]).get(pie[0]!)?.id).toBe('p');
  });

  it('escenas: los saltos grandes entre fotogramas seguidos', () => {
    const v = (a: number, b: number) => new Float32Array([a, b, 0, 0]);
    const e = cambiosDeEscena([v(1, 0), v(1, 0.01), v(0, 1), v(0.01, 1), v(0, 1), v(1, 0)]);
    expect(e).toEqual([false, false, true, false, false, true]);
  });

  it('simulado: cuenta páginas y llamadas sin llamar a nadie', async () => {
    const { sql } = await libro();
    const redactor = redactorFalso(() => { throw new Error('no debía llamar'); });
    const r = await rehacerFiguras('d1', { sql, imagen, redactor }, { simular: true, lote: 2 });
    expect(r).toMatchObject({ clase: 'paginas', simulado: true, paginas: { todas: 3, candidatas: 2, examinadas: 3 }, llamadas: { vision: 2 }, llamadasSegun: { todas: 2, candidatas: 1 } });
    expect(redactor.llamadas).toBe(0);
  });

  it('páginas: conserva el id de la figura que ya estaba, le pone región y descripción, y borra la falsa', async () => {
    const { sql, filas } = await libro();
    const redactor = redactorFalso(() => ({ paginas: [
      { n: 1, figuras: [] },
      { n: 2, figuras: [{ pie: 'Figura 1: El cosmos medieval.', descripcion: 'Diagrama de esferas concéntricas.', region: { x: 0.2, y: 0.1, w: 0.6, h: 0.5 } }] },
      { n: 3, figuras: [] },
    ] }));
    const borrados: string[] = [];
    const r = await rehacerFiguras('d1', { sql, imagen, redactor, borrarVectores: async (ids) => { borrados.push(...ids); } }, { lote: 3 });
    expect(r.figuras).toMatchObject({ antes: 2, despues: 1, conservadas: 1, nuevas: 0, borradas: 1, conRegion: 1, descritas: 1 });
    const [f] = await filas<{ id: string; descripcion: string; ancla: string }>('SELECT id, descripcion, ancla FROM figuras');
    expect(f!.id).toBe('fg-vieja');
    expect(f!.descripcion).toBe('Diagrama de esferas concéntricas.');
    expect(JSON.parse(f!.ancla)).toMatchObject({ tipo: 'pagina', fisica: 2, region: { x: 0.2, y: 0.1, w: 0.6, h: 0.5 } });
    expect(borrados.sort()).toEqual(['fg-falsa', 'fg-vieja']);
    expect(r.avisos.join(' ')).toMatch(/vector propio/);
  });

  it('páginas con recorte: vectoriza las figuras nuevas', async () => {
    const { sql } = await libro();
    await spdf.escribirEspacio(sql, embebedorFalso.espacio);
    const redactor = redactorFalso(() => ({ paginas: [{ n: 1, figuras: [{ descripcion: 'Un mapa.', region: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 } }] }] }));
    const guardados: Vector[] = [];
    const r = await rehacerFiguras('d1', {
      sql, imagen, redactor, embebedor: embebedorFalso, recorte: imagen,
      guardarVectores: async (vs) => { guardados.push(...vs); await spdf.escribirVectores(sql, vs.map((v) => ({ ...v, documento: 'd1' }))); },
    }, { lote: 1, paginas: 'candidatas' });
    expect(r.paginas.examinadas).toBe(2);
    expect(guardados.length).toBeGreaterThan(0);
    expect(r.figuras.sinVector).toBe(0);
  });

  it('relleno de vectores: simula, vectoriza las que faltan por su recorte y es idempotente', async () => {
    const { sql } = await libro();
    await spdf.escribirEspacio(sql, embebedorFalso.espacio);
    // Las figuras de la v1 tenían región pero no vector propio.
    await sql.ejecutar("UPDATE figuras SET ancla = json_set(ancla, '$.region', json('{\"x\":0.1,\"y\":0.1,\"w\":0.5,\"h\":0.5}'))");
    const recortes: string[] = [];
    const puertos = {
      sql, imagen, embebedor: embebedorFalso,
      recorte: async (clave: string, region: { x: number }) => { recortes.push(`${clave}@${region.x}`); return imagen(clave); },
      guardarVectores: async (vs: Vector[]) => { await spdf.escribirVectores(sql, vs.map((v) => ({ ...v, documento: 'd1' }))); },
    };
    const sim = await vectorizarFigurasPendientes('d1', puertos, { simular: true });
    expect(sim).toMatchObject({ simulado: true, figuras: 2, sinVector: 2, vectorizadas: 0, imagenes: 2, llamadas: 1 });
    expect(recortes).toEqual([]);
    const r = await vectorizarFigurasPendientes('d1', puertos);
    expect(r).toMatchObject({ simulado: false, sinVector: 2, vectorizadas: 2 });
    expect(recortes.every((x) => x.endsWith('@0.1'))).toBe(true);
    const otra = await vectorizarFigurasPendientes('d1', puertos);
    expect(otra).toMatchObject({ sinVector: 0, vectorizadas: 0, llamadas: 0 });
    // Sin recortador lo dice y no finge.
    await sql.ejecutar("DELETE FROM vectores WHERE objetivo = 'figura'");
    const sinRecorte = await vectorizarFigurasPendientes('d1', { sql, imagen, embebedor: embebedorFalso });
    expect(sinRecorte.vectorizadas).toBe(0);
    expect(sinRecorte.avisos.join(' ')).toMatch(/recortador/);
  });

  it('vídeo: describe, vectoriza y marca los cambios de escena sin tocar los ids', async () => {
    const b = await baseReal();
    await spdf.escribirDocumento(b.sql, { ...doc('v1', 'video'), mime: 'video/mp4' });
    await spdf.escribirEspacio(b.sql, embebedorFalso.espacio);
    await spdf.escribirUnidades(b.sql, [{ id: 'm0', documento: 'v1', orden: 0, texto: 'Hola.', ancla: { tipo: 'tiempo', t0: 0, t1: 60 }, lector: 'transcripcion', confianza: 0.9 }]);
    await spdf.escribirFiguras(b.sql, [0, 10, 20, 30].map((t, i) => ({ id: `f${i}`, documento: 'v1', unidad: 'm0', imagen: `fotogramas/000${i + 1}.jpg`, ...(i ? {} : { descripcion: 'Rótulo' }), ancla: { tipo: 'tiempo' as const, t0: t, t1: t } })));
    // El embebedor falso da [i,1,0,0] por posición en el lote: f0 y f1 parecidos, f2 y f3 lejos.
    const embebedor = { ...embebedorFalso, async vectorizar(p: unknown[]) { return p.map((_, i) => new Float32Array(i < 2 ? [0, 1, 0, 0] : [1, 0, 0, 0])); } };
    const redactor = redactorFalso(() => ({ figuras: [{ n: 1, descripcion: 'Plano de estudio.' }, { n: 2, descripcion: 'Libros.' }, { n: 3, descripcion: 'Primer plano.' }] }));
    const sim = await rehacerFiguras('v1', { sql: b.sql, imagen, redactor, embebedor }, { simular: true });
    expect(sim.llamadas).toEqual({ vision: 0, descripcion: 1, vectores: 1 });
    const r = await rehacerFiguras('v1', {
      sql: b.sql, imagen, redactor, embebedor,
      guardarVectores: async (vs) => spdf.escribirVectores(b.sql, vs.map((v) => ({ ...v, documento: 'v1' }))),
    });
    expect(r.clase).toBe('fotogramas');
    expect(r.figuras).toMatchObject({ conservadas: 4, descritas: 4, conVector: 4 });
    const filas = await b.filas<{ id: string; ancla: string }>('SELECT id, ancla FROM figuras ORDER BY id');
    expect(filas.map((f) => f.id)).toEqual(['f0', 'f1', 'f2', 'f3']);
    expect(filas.map((f) => !!JSON.parse(f.ancla).escena)).toEqual([false, false, true, false]);
  });
});
