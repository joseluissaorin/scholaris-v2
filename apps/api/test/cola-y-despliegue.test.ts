/**
 * El consumidor de la cola no se come los mensajes que no conoce (un despliegue
 * viejo los devuelve a la cola) y la guarda de despliegue solo deja pasar lo que
 * contiene origin/main, con su salida de emergencia.
 */
import { describe, expect, it } from 'vitest';
import { atenderLote } from '../src/cloudflare/cola.js';
// @ts-expect-error: módulo de Node en JavaScript, sin tipos
import { decidirDespliegue } from '../scripts/guarda-despliegue.mjs';

function mensaje(body: unknown) {
  const m = { body, attempts: 1, acks: 0, reintentos: [] as Array<number | undefined>, ack() { m.acks++; }, retry(o?: { delaySeconds?: number }) { m.reintentos.push(o?.delaySeconds); } };
  return m;
}

describe('cola', () => {
  it('confirma lo que sabe hacer y devuelve a la cola lo que no conoce', async () => {
    const hechos: string[] = [];
    const conocido = mensaje({ tipo: 'mantenimiento', usuario: 'u', trabajo: 'figuras' });
    const futuro = mensaje({ tipo: 'algo-de-un-despliegue-futuro', usuario: 'u' });
    const roto = mensaje({ tipo: 'reindexar', usuario: 'u', documento: 'd' });
    const r = await atenderLote([conocido, futuro, roto], {
      vigilantes: async () => hechos.push('vigilantes'),
      mantenimiento: async () => hechos.push('mantenimiento'),
      reindexar: async () => { throw new Error('Vectorize caído'); },
    });
    expect(r).toEqual({ hechos: 1, reintentos: 1, desconocidos: 1 });
    expect(hechos).toEqual(['mantenimiento']);
    expect(conocido.acks).toBe(1);
    expect(futuro.acks).toBe(0);
    expect(futuro.reintentos).toEqual([300]);
    expect(roto.acks).toBe(0);
    expect(roto.reintentos.length).toBe(1);
  });
});

describe('guarda de despliegue', () => {
  it('solo despliega lo que contiene origin/main, y deja forzarlo a propósito', () => {
    expect(decidirDespliegue({ sucio: false, igual: true, contiene: true, forzado: false })).toEqual({ ok: true });
    expect(decidirDespliegue({ sucio: true, igual: true, contiene: true, forzado: false }).ok).toBe(false);
    expect(decidirDespliegue({ sucio: false, igual: false, contiene: false, forzado: false }).ok).toBe(false);
    const delante = decidirDespliegue({ sucio: false, igual: false, contiene: true, forzado: false });
    expect(delante.ok).toBe(true);
    expect(delante.aviso).toMatch(/git push/);
    const forzado = decidirDespliegue({ sucio: true, igual: false, contiene: false, forzado: true });
    expect(forzado.ok).toBe(true);
    expect(forzado.aviso).toMatch(/FORZADO/);
  });
});
