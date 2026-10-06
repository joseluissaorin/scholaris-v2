import { describe, expect, it } from 'vitest';
import { aBase64, deBase64, extraerJSON, limitador, pedir, ContadorUso, ErrorProveedor } from '../src/comun.js';
import { evaluarPagina, normalizarPaginas, normalizarRegion, proporcionBasura, hayBucle, paginaFaltante } from '../src/lectura.js';
import { costeTokens } from '../src/precios.js';
import { fetchFalso } from './falso.js';

describe('pedir', () => {
  it('reintenta 503 y 429 y acaba devolviendo el JSON', async () => {
    const { fetch, llamadas } = fetchFalso((_, n) => (n < 3 ? { estado: n === 1 ? 503 : 429, cuerpo: 'ocupado' } : { ok: true }));
    const r = await pedir<{ ok: boolean }>({ proveedor: 'x', url: 'https://a/b', cuerpo: { a: 1 } }, { fetch, esperaBase: 1 });
    expect(r.ok).toBe(true);
    expect(llamadas).toHaveLength(3);
    expect(llamadas[0]?.cabeceras['content-type']).toBe('application/json');
  });

  it('no reintenta un 400 y quita la clave del mensaje', async () => {
    const { fetch, llamadas } = fetchFalso(() => ({ estado: 400, cuerpo: 'malo' }));
    await expect(pedir({ proveedor: 'x', url: 'https://a/b?key=SECRETO' }, { fetch, esperaBase: 1 })).rejects.toThrow(/HTTP 400.*key=\*\*\*/);
    expect(llamadas).toHaveLength(1);
  });

  it('corta por tiempo y reintenta', async () => {
    let n = 0;
    const lento = (async (_u: unknown, init: RequestInit) => {
      n++;
      if (n === 1) {
        return new Promise((_, rechazar) => init.signal?.addEventListener('abort', () => rechazar(Object.assign(new Error('abort'), { name: 'AbortError' }))));
      }
      return new Response('{"ok":1}');
    }) as typeof fetch;
    const r = await pedir<{ ok: number }>({ proveedor: 'x', url: 'https://a' }, { fetch: lento, timeoutMs: 20, esperaBase: 1 });
    expect(r.ok).toBe(1);
    expect(n).toBe(2);
  });

  it('respeta la cancelación externa sin reintentar', async () => {
    const control = new AbortController();
    control.abort('basta');
    const { fetch, llamadas } = fetchFalso(() => ({ ok: true }));
    await expect(pedir({ proveedor: 'x', url: 'https://a' }, { fetch, signal: control.signal })).rejects.toThrow(/cancelado/);
    expect(llamadas).toHaveLength(0);
  });
});

describe('utilidades', () => {
  it('base64 de ida y vuelta, también con trozos grandes', () => {
    const b = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(deBase64(aBase64(b))).toEqual(b);
  });

  it('extraerJSON quita las vallas de código y la prosa', () => {
    expect(extraerJSON('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extraerJSON('Aquí va: {"a":[1,2]} y fin')).toEqual({ a: [1, 2] });
  });

  it('limitador no pasa de n tareas a la vez', async () => {
    const lim = limitador(2);
    let activas = 0, max = 0;
    await Promise.all(Array.from({ length: 8 }, () => lim(async () => { activas++; max = Math.max(max, activas); await new Promise((r) => setTimeout(r, 5)); activas--; })));
    expect(max).toBe(2);
  });

  it('el contador acumula por modelo y avisa al oyente', () => {
    const vistos: number[] = [];
    const c = new ContadorUso((u) => vistos.push(u.tokensEntrada));
    c.registrar({ proveedor: 'g', modelo: 'm', operacion: 'leer', tokensEntrada: 10, tokensSalida: 5, usd: 0.1, ms: 1 });
    c.registrar({ proveedor: 'g', modelo: 'm', operacion: 'leer', tokensEntrada: 20, tokensSalida: 5, usd: 0.2, ms: 1 });
    expect(c.total().tokensEntrada).toBe(30);
    expect(c.total().usd).toBeCloseTo(0.3);
    expect(Object.keys(c.detalle())).toEqual(['g/m/leer']);
    expect(vistos).toEqual([10, 20]);
  });

  it('precios: coste con caché y salida', () => {
    // 1M entrada de los que 0,5M en caché + 1M salida en gemini-3.8-flash
    expect(costeTokens('gemini-3.8-flash', 1e6, 1e6, 5e5)).toBeCloseTo(0.375 + 0.0375 + 3.75);
    expect(costeTokens('desconocido', 1, 1)).toBeUndefined();
  });

  it('ErrorProveedor lleva estado y si es reintentable', () => {
    const e = new ErrorProveedor('p', 'm', { estado: 429, reintentable: true });
    expect(e.message).toBe('[p] m');
    expect(e.reintentable).toBe(true);
  });
});

describe('lectura', () => {
  it('acepta numeración relativa y la pasa a absoluta, rellenando las que faltan', () => {
    const json = { paginas: [{ fisica: 1, texto: 'uno', folio: '7' }, { fisica: 3, texto: 'tres', folio: '' }] };
    const p = normalizarPaginas(json, 3, 21);
    expect(p.map((x) => x.fisica)).toEqual([21, 22, 23]);
    expect(p[0]?.folio).toBe('7');
    expect(p[1]?.confianza).toBe(0);
    expect(p[2]?.folio).toBeNull();
  });

  it('acepta numeración absoluta, normaliza la s larga y las ligaduras', () => {
    const p = normalizarPaginas({ paginas: [{ fisica: 10, texto: 'ſobre la ﬁesta', cabecera: 'EL CASAMIENTO', folio: '[4]' }] }, 1, 10);
    expect(p[0]?.texto).toBe('sobre la fiesta');
    expect(p[0]?.folio).toBe('4');
    const d = normalizarPaginas({ paginas: [{ fisica: 1, texto: 'ſobre' }] }, 1, 1, { sLarga: 'conservar' });
    expect(d[0]?.texto).toBe('ſobre');
  });

  it('escala regiones 0-1000 a 0-1', () => {
    expect(normalizarRegion({ x: 100, y: 200, w: 500, h: 250 })).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 });
    expect(normalizarRegion({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 })).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 });
  });

  it('el control de calidad rechaza basura, bucles y páginas vacías que no lo son', () => {
    const base = paginaFaltante(1);
    expect(evaluarPagina({ ...base, confianza: 0.9, texto: 'Texto normal y corriente, con su puntuación.' }).aceptable).toBe(true);
    expect(evaluarPagina({ ...base, confianza: 0.5, texto: '' }).aceptable).toBe(false);
    // Sin texto pero el modelo está seguro: página en blanco mal marcada (portadas, guardas).
    expect(evaluarPagina({ ...base, confianza: 0.9, texto: '' }).aceptable).toBe(true);
    expect(evaluarPagina({ ...base, confianza: 0.9, texto: 'I' }).aceptable).toBe(true);
    expect(evaluarPagina({ ...base, confianza: 0.9, texto: '', vacia: true }).aceptable).toBe(true);
    expect(evaluarPagina({ ...base, confianza: 0.9, texto: '▓▒░▓▒░ ▓▒░▓▒░ ▓▒░ texto ▓▒░▓▒░▓▒░' }).aceptable).toBe(false);
    expect(evaluarPagina({ ...base, confianza: 0.9, texto: 'la la la '.repeat(60) }).aceptable).toBe(false);
    expect(proporcionBasura('Cel. Dirè mas? «Bel.» —No digas mas.')).toBe(0);
    expect(hayBucle(Array.from({ length: 10 }, () => 'misma línea').join('\n'))).toBe(true);
  });
});
