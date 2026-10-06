import { describe, expect, it } from 'vitest';
import { fijarGrabacion } from '../src/ajustes.js';
import {
  anotarBusqueda,
  borrarBusqueda,
  estadisticasHistorial,
  eventosBusqueda,
  fijarBusqueda,
  GrabadorBusqueda,
  listarHistorial,
  obtenerBusqueda,
  ocultarBusqueda,
  parametrosRepeticion,
  registrarBusqueda,
} from '../src/historial.js';
import { estanteria } from './ayudas.js';

describe('historial', () => {
  it('graba, lista con cursor y busca por texto', async () => {
    const sql = await estanteria();
    for (let i = 0; i < 5; i++) {
      await registrarBusqueda(sql, { consulta: `panóptico ${i}`, intencion: 'conceptual', confianza: i % 2 ? 'alta' : 'baja', nResultados: i });
    }
    await registrarBusqueda(sql, { consulta: 'biopolítica y soberanía', filtros: { bibliotecas: ['b1'] } });
    const p1 = await listarHistorial(sql, { limite: 4 });
    expect(p1.elementos).toHaveLength(4);
    expect(p1.elementos[0]!.consulta).toBe('biopolítica y soberanía');
    expect(p1.siguiente).toBeDefined();
    const p2 = await listarHistorial(sql, { limite: 4, cursor: p1.siguiente! });
    expect(p2.elementos).toHaveLength(2);
    expect(p2.siguiente).toBeUndefined();
    const fts = await listarHistorial(sql, { q: 'panoptico' });
    expect(fts.elementos).toHaveLength(5);
    const bib = await listarHistorial(sql, { biblioteca: 'b1' });
    expect(bib.elementos[0]!.filtros).toEqual({ bibliotecas: ['b1'] });
  });

  it('fija, anota, oculta, repite y borra', async () => {
    const sql = await estanteria();
    const id = (await registrarBusqueda(sql, {
      consulta: 'vigilar y castigar',
      respuesta: 'El panóptico…',
      filtros: { anioDesde: 1970 },
      eventos: [{ ms: 1, etapa: 'resultados', datos: { tipo: 'resultados' } }],
    }))!;
    await fijarBusqueda(sql, id, true);
    await anotarBusqueda(sql, id, 'para el capítulo dos');
    expect((await listarHistorial(sql, { fijados: true })).elementos).toHaveLength(1);
    expect((await listarHistorial(sql, { q: 'capitulo' })).elementos).toHaveLength(1);
    expect(await parametrosRepeticion(sql, id)).toEqual({ consulta: 'vigilar y castigar', filtros: { anioDesde: 1970 } });
    expect(await eventosBusqueda(sql, id)).toHaveLength(1);
    await ocultarBusqueda(sql, id);
    const d = await obtenerBusqueda(sql, id);
    expect(d.oculto).toBe(true);
    expect(d.consulta).toBe('(oculta)');
    expect(d.respuesta).toBeUndefined();
    expect((await listarHistorial(sql, { q: 'vigilar' })).elementos).toHaveLength(0);
    await expect(parametrosRepeticion(sql, id)).rejects.toMatchObject({ estado: 410 });
    await borrarBusqueda(sql, id);
    await expect(obtenerBusqueda(sql, id)).rejects.toMatchObject({ codigo: 'no_encontrado' });
  });

  it('no graba nada con la grabación apagada', async () => {
    const sql = await estanteria();
    await fijarGrabacion(sql, false);
    expect(await registrarBusqueda(sql, { consulta: 'secreto' })).toBeNull();
    expect((await listarHistorial(sql)).elementos).toHaveLength(0);
  });

  it('el grabador recoge los eventos del flujo', async () => {
    const sql = await estanteria();
    const g = new GrabadorBusqueda(sql, { consulta: 'Arendt', tipo: 'respuesta' });
    g.registrar({ tipo: 'resultados', resultados: [], intencion: 'factual' });
    g.registrar({ tipo: 'texto', delta: 'La banalidad ' });
    g.registrar({ tipo: 'texto', delta: 'del mal.' });
    g.registrar({ tipo: 'fin', confianza: 'media' });
    const id = await g.finalizar();
    const d = await obtenerBusqueda(sql, id!);
    expect(d.respuesta).toBe('La banalidad del mal.');
    expect(d.confianza).toBe('media');
    expect(d.intencion).toBe('factual');
    expect(d.reproducible).toBe(true);
    const e = await estadisticasHistorial(sql, 'todo');
    expect(e.total).toBe(1);
    expect(e.porIntencion.factual).toBe(1);
    expect(e.porDia).toHaveLength(1);
  });
});
