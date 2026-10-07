/**
 * /demo/…: el vídeo de la portada desde R2, con Range (206), HEAD, ETag,
 * 304, 416 y 404, contra R2 de verdad (miniflare) y a través del Worker entero
 * (sin sesión).
 */
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { CACHE_DEMO, leerRango, servirDemo } from '../src/cloudflare/demo';

const TAM = 4096;
const BYTES = Uint8Array.from({ length: TAM }, (_, i) => i % 251);
const URL_VIDEO = 'https://scholaris.prueba/demo/prueba-v1.mp4';
const pide = (cabeceras: Record<string, string> = {}, metodo = 'GET', url = URL_VIDEO) => new Request(url, { method: metodo, headers: cabeceras });
const servir = (p: Request) => servirDemo(p, env.BUCKET);

beforeAll(async () => {
  await env.BUCKET.put('publico/demo/prueba-v1.mp4', BYTES);
});

describe('leerRango', () => {
  it('entiende los tres tipos de intervalo', () => {
    expect(leerRango('bytes=0-1023', TAM)).toEqual({ inicio: 0, fin: 1023 });
    expect(leerRango('bytes=4000-', TAM)).toEqual({ inicio: 4000, fin: TAM - 1 });
    expect(leerRango('bytes=-100', TAM)).toEqual({ inicio: TAM - 100, fin: TAM - 1 });
    expect(leerRango('bytes=0-999999', TAM)).toEqual({ inicio: 0, fin: TAM - 1 });
  });
  it('fuera de rango o ilegible', () => {
    expect(leerRango('bytes=5000-', TAM)).toBe('fuera');
    expect(leerRango('bytes=10-5', TAM)).toBe('fuera');
    expect(leerRango('items=0-1', TAM)).toBeNull();
    expect(leerRango('bytes=0-1,5-9', TAM)).toBeNull();
    expect(leerRango(null, TAM)).toBeNull();
  });
});

describe('/demo/', () => {
  it('no se ocupa de otras rutas', async () => {
    expect(await servir(pide({}, 'GET', 'https://scholaris.prueba/acerca'))).toBeNull();
  });

  it('GET entero: 200 con tipo, longitud, ETag y caché inmutable', async () => {
    const r = (await servir(pide()))!;
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('video/mp4');
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(r.headers.get('cache-control')).toBe(CACHE_DEMO);
    expect(r.headers.get('etag')).toMatch(/^"[^"]+"$/);
    expect(r.headers.get('content-length')).toBe(String(TAM));
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(BYTES);
  });

  it('Range: 206 con content-range y solo esos bytes', async () => {
    const r = (await servir(pide({ range: 'bytes=0-1023' })))!;
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe(`bytes 0-1023/${TAM}`);
    expect(r.headers.get('content-length')).toBe('1024');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(BYTES.slice(0, 1024));

    const medio = (await servir(pide({ range: 'bytes=2000-2099' })))!;
    expect(new Uint8Array(await medio.arrayBuffer())).toEqual(BYTES.slice(2000, 2100));

    const cola = (await servir(pide({ range: 'bytes=-10' })))!;
    expect(cola.status).toBe(206);
    expect(cola.headers.get('content-range')).toBe(`bytes ${TAM - 10}-${TAM - 1}/${TAM}`);
    expect(new Uint8Array(await cola.arrayBuffer())).toEqual(BYTES.slice(TAM - 10));
  });

  it('Range fuera del fichero: 416', async () => {
    const r = (await servir(pide({ range: `bytes=${TAM}-` })))!;
    expect(r.status).toBe(416);
    expect(r.headers.get('content-range')).toBe(`bytes */${TAM}`);
  });

  it('HEAD: 200 sin cuerpo y con la longitud', async () => {
    const r = (await servir(pide({}, 'HEAD')))!;
    expect(r.status).toBe(200);
    expect(r.headers.get('content-length')).toBe(String(TAM));
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(r.body).toBeNull();
  });

  it('If-None-Match con el ETag: 304', async () => {
    const etag = (await servir(pide({}, 'HEAD')))!.headers.get('etag')!;
    const r = (await servir(pide({ 'if-none-match': etag })))!;
    expect(r.status).toBe(304);
  });

  it('404 si no existe o el nombre no vale; 405 si no es GET ni HEAD', async () => {
    expect((await servir(pide({}, 'GET', 'https://scholaris.prueba/demo/no-existe.mp4')))!.status).toBe(404);
    expect((await servir(pide({}, 'GET', 'https://scholaris.prueba/demo/../secretos/x.mp4')))?.status ?? 404).toBe(404);
    expect((await servir(pide({}, 'GET', 'https://scholaris.prueba/demo/%2e%2e%2fx.mp4')))!.status).toBe(404);
    expect((await servir(pide({}, 'GET', 'https://scholaris.prueba/demo/script.js')))!.status).toBe(404);
    expect((await servir(pide({}, 'POST')))!.status).toBe(405);
  });

  it('a través del Worker, sin sesión: 206 y 404', async () => {
    const r = await SELF.fetch(URL_VIDEO, { headers: { range: 'bytes=0-1023' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe(`bytes 0-1023/${TAM}`);
    expect((await r.arrayBuffer()).byteLength).toBe(1024);
    const h = await SELF.fetch(URL_VIDEO, { method: 'HEAD' });
    expect(h.status).toBe(200);
    expect(h.headers.get('content-length')).toBe(String(TAM));
    const no = await SELF.fetch('https://scholaris.prueba/demo/no-existe.mp4');
    expect(no.status).toBe(404);
    await no.arrayBuffer();
  });
});
