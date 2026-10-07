/**
 * El cliente y el límite de ritmo (429): espera lo que pide Retry-After y repite,
 * para que una ráfaga de pantallas no deje secciones vacías o con error.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearCliente } from '@scholaris/contrato';

const json = (estado: number, cuerpo: unknown, cabeceras: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json', ...cabeceras } });
const ritmo = (segundos: number) => json(429, { error: { codigo: 'limite_de_ritmo', mensaje: 'Vas demasiado deprisa.' } }, { 'retry-after': String(segundos) });

afterEach(() => { vi.useRealTimers(); });

describe('cliente ante el límite de ritmo', () => {
  it('espera Retry-After y repite la petición', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(ritmo(2)).mockResolvedValueOnce(json(200, { ok: true, version: 'x' }));
    const cliente = crearCliente({ base: 'https://x', fetch });
    const p = cliente.salud();
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ ok: true, version: 'x' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('si pide esperar demasiado, no espera: sube el error', async () => {
    const fetch = vi.fn().mockResolvedValue(ritmo(40));
    const cliente = crearCliente({ base: 'https://x', fetch });
    await expect(cliente.salud()).rejects.toMatchObject({ estado: 429 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('como mucho dos reintentos', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => ritmo(1));
    const cliente = crearCliente({ base: 'https://x', fetch });
    const p = cliente.salud().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toMatchObject({ estado: 429 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
