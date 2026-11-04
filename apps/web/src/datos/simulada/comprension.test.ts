import { describe, expect, it } from 'vitest';
import type { Pagina } from '@scholaris/contrato';
import type { Alineacion, Segmento } from '@scholaris/nucleo';
import type { AparicionVista, MapaComprension } from '@scholaris/contrato';
import { textoDeCaracteres } from '../../lib/anclas';
import { textoDe } from './corpus';
import { maquetar, regionDeCaracteres } from './comprension';
import { CUENTO, ID_CUENTO, ID_PELICULA, PELICULA, SECUENCIAS } from './obras-inventadas';
import { fetchSimulado } from './servidor';

(globalThis as { location?: unknown }).location ??= { origin: 'http://localhost' };
const pedir = async <T,>(ruta: string) => (await (await fetchSimulado(`/api/v2${ruta}`)).json()) as T;
const dentro = (r: { x: number; y: number; w: number; h: number }) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001 && r.w > 0 && r.h > 0;

describe('las obras inventadas de la demostración', () => {
  it('cada página del cuento cabe en su hoja, renglón a renglón y sin perder caracteres', () => {
    for (let o = 1; o <= CUENTO.unidades; o++) {
      const t = textoDe(CUENTO, o);
      const rs = maquetar(t);
      expect(rs.at(-1)!.y).toBeLessThan(800);
      for (const r of rs.filter((x) => !x.titulo)) expect(Array.from(t).slice(r.desde, r.hasta).join('')).toBe(r.texto);
    }
  });

  it('el découpage es continuo: escenas dentro de su secuencia y planos dentro de su escena, sin huecos', () => {
    let fin = 0;
    for (const s of SECUENCIAS) for (const e of s.escenas) {
      expect(e.t0).toBe(fin);
      fin = e.t1;
      let t = e.t0;
      for (const p of e.planos) { expect(p.t0).toBe(t); t = p.t1; expect(p.t1).toBeGreaterThan(p.t0); for (const v of [...(p.personas ?? []), ...(p.objetos ?? [])]) expect(dentro(v.region)).toBe(true); }
      expect(t).toBe(e.t1);
    }
    expect(fin).toBe(PELICULA.duracion);
  });

  it('las apariciones del cuento señalan exactamente su forma, con su región en la página', async () => {
    const { elementos } = await pedir<Pagina<AparicionVista>>(`/documentos/${ID_CUENTO}/apariciones?limite=5000`);
    expect(elementos.length).toBeGreaterThan(60);
    for (const a of elementos.filter((x) => x.rol === 'nombrado')) {
      expect(a.ancla.tipo).toBe('pagina');
      if (a.ancla.tipo !== 'pagina' || !a.ancla.caracteres) continue;
      expect(textoDeCaracteres(textoDe(CUENTO, a.ancla.fisica), a.ancla.caracteres)).toBe(a.forma);
      expect(a.ancla.region && dentro(a.ancla.region)).toBe(true);
    }
    expect(regionDeCaracteres(textoDe(CUENTO, 1), [0, 5])).toBeUndefined(); // el título de la parte no tiene región de texto
  });

  it('el mapa, la estructura y las alineaciones se sostienen', async () => {
    const m = await pedir<MapaComprension>(`/documentos/${ID_PELICULA}/comprension`);
    expect(m.estado?.estado).toBe('hecho');
    expect(m.segmentos.some((s) => s.tipo === 'plano')).toBe(false);
    expect(m.totales.planos).toBeGreaterThan(30);
    expect(m.global[0]?.clase).toBe('global');
    const segs = await pedir<Segmento[]>(`/documentos/${ID_PELICULA}/segmentos`);
    const ids = new Set(segs.map((s) => s.id));
    for (const s of segs) if (s.padre) expect(ids.has(s.padre)).toBe(true);
    const rel = await pedir<Array<{ id: string; sentido: string; otro: { id: string } }>>(`/documentos/${ID_CUENTO}/relaciones`);
    expect(rel[0]).toMatchObject({ sentido: 'destino', otro: { id: ID_PELICULA } });
    const als = await pedir<Pagina<Alineacion>>(`/relaciones/${rel[0]!.id}/alineaciones`);
    expect(als.elementos.length).toBeGreaterThan(10);
    for (const al of als.elementos) {
      expect(al.a || al.b).toBeTruthy();
      if (al.a) expect(al.a.documento).toBe(ID_PELICULA);
      if (al.b) { expect(al.b.documento).toBe(ID_CUENTO); expect(al.b.ancla.caracteres).toBeTruthy(); }
    }
  });
});

describe('la demostración: relaciones a mano y medios', () => {
  const enviar = async <T,>(metodo: string, ruta: string, cuerpo?: unknown) => {
    const r = await fetchSimulado(`/api/v2${ruta}`, { method: metodo, ...(cuerpo ? { body: JSON.stringify(cuerpo), headers: { 'content-type': 'application/json' } } : {}) });
    return { estado: r.status, datos: (await r.json()) as T };
  };

  it('poner, rechazar y no repetir una relación; alinear con su avance', async () => {
    const nueva = await enviar<{ id: string; confirmada: boolean; sentido: string }>('POST', '/relaciones', { origen: ID_CUENTO, destino: 'd-quijote', tipo: 'comenta_a' });
    expect(nueva.estado).toBe(201);
    expect(nueva.datos).toMatchObject({ confirmada: true, sentido: 'origen' });
    expect((await enviar('POST', '/relaciones', { origen: 'd-quijote', destino: ID_CUENTO, tipo: 'relacionado' })).estado).toBe(400);
    expect((await enviar('POST', '/relaciones', { origen: ID_CUENTO, destino: 'd-quijote', tipo: 'otra' })).estado).toBe(400);
    const lanzada = await enviar<{ relaciones: number }>('POST', `/documentos/${ID_CUENTO}/alinear`, { relacion: nueva.datos.id, forzar: true });
    expect(lanzada.estado).toBe(202);
    const r = await enviar<{ estadoAlineacion: { estado: string; hechos: number; total: number } }>('GET', `/relaciones/${nueva.datos.id}`);
    expect(r.datos.estadoAlineacion).toMatchObject({ estado: 'en_marcha', hechos: 0, total: 4 });
    expect((await enviar('DELETE', `/relaciones/${nueva.datos.id}`)).datos).toEqual({ borrada: true });
    expect((await enviar('GET', `/relaciones/${nueva.datos.id}`)).estado).toBe(404);
  });

  it('la revisión de la transcripción: simular no lanza nada; la película, aplicada con sus huecos', async () => {
    const sim = await enviar<{ lanzada: boolean; estimacion: { hara: string[]; usd: number } }>('POST', '/documentos/d-rice/transcripcion/revisar', { simular: true });
    expect(sim.datos.lanzada).toBe(false);
    expect(sim.datos.estimacion.hara).toEqual(['proxy', 'huecos', 'reescritura']);
    expect(sim.datos.estimacion.usd).toBeGreaterThan(0);
    expect((await enviar('GET', '/documentos/d-rice/transcripcion/revision')).estado).toBe(404);
    const peli = await enviar<{ aplicada: string; cobertura: { antes: { lista: unknown[] }; despues: { lista: unknown[] } } }>('GET', `/documentos/${ID_PELICULA}/transcripcion/revision`);
    expect(peli.datos.aplicada).toBeTruthy();
    expect(peli.datos.cobertura.despues.lista.length).toBeLessThan(peli.datos.cobertura.antes.lista.length);
    const tope = await enviar('POST', '/medios/percibir', { confirmar: true, presupuestoUsd: 0.01 });
    expect(tope.estado).toBe(409);
  });
});
