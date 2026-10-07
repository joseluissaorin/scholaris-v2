import { describe, expect, it } from 'vitest';
import { recordarDemostracion, redireccionPortada } from '../src/cloudflare/portada.js';

const pide = (ruta: string, cabeceras: Record<string, string> = {}) => new Request(`https://scholaris.test${ruta}`, { headers: cabeceras });

describe('portada', () => {
  it('«/» sin sesión va a /acerca o /en según el idioma', () => {
    expect(redireccionPortada(pide('/'))?.headers.get('location')).toBe('/acerca');
    expect(redireccionPortada(pide('/', { 'accept-language': 'es-ES,es;q=0.9' }))?.headers.get('location')).toBe('/acerca');
    expect(redireccionPortada(pide('/', { 'accept-language': 'en-GB,en;q=0.8' }))?.headers.get('location')).toBe('/en');
  });
  it('con sesión, con consulta, en otras rutas o en demostración se sirve la aplicación', () => {
    expect(redireccionPortada(pide('/', { cookie: 'a=1; __session=eyJ' }))).toBeNull();
    expect(redireccionPortada(pide('/', { cookie: '__client_uat_x1=1712345' }))).toBeNull();
    expect(redireccionPortada(pide('/', { cookie: 'scholaris_demostracion=1' }))).toBeNull();
    expect(redireccionPortada(pide('/?entrar'))).toBeNull();
    expect(redireccionPortada(pide('/?demostracion'))).toBeNull();
    expect(redireccionPortada(pide('/biblioteca'))).toBeNull();
    expect(redireccionPortada(new Request('https://scholaris.test/', { method: 'POST' }))).toBeNull();
  });
  it('__client_uat=0 (sesión cerrada) no cuenta como sesión', () => {
    expect(redireccionPortada(pide('/', { cookie: '__client_uat=0' }))?.status).toBe(302);
  });
  it('«/?demostracion» deja la cookie de la demostración', () => {
    const r = recordarDemostracion(pide('/?demostracion'), new Response('<html>'));
    expect(r.headers.get('set-cookie')).toContain('scholaris_demostracion=1');
    expect(recordarDemostracion(pide('/'), new Response('x')).headers.get('set-cookie')).toBeNull();
  });
});

import { servirPortadaEnRaiz } from '../src/cloudflare/portada.js';

describe('portada en la raíz', () => {
  const estaticos = async (ruta: string) => new Response(`<html>${ruta}</html>`, { status: 200, headers: { 'content-type': 'text/html' } });
  it('sirve la portada con 200 y su canónica, sin redirigir', async () => {
    const r = await servirPortadaEnRaiz(new Request('https://ejemplo.org/'), estaticos);
    expect(r?.status).toBe(200);
    expect(await r?.text()).toContain('/acerca');
    expect(r?.headers.get('link')).toContain('<https://ejemplo.org/acerca>; rel="canonical"');
  });
  it('en inglés sirve /en', async () => {
    const r = await servirPortadaEnRaiz(new Request('https://ejemplo.org/', { headers: { 'accept-language': 'en-US' } }), estaticos);
    expect(await r?.text()).toContain('/en');
  });
  it('con sesión no interviene', async () => {
    expect(await servirPortadaEnRaiz(new Request('https://ejemplo.org/', { headers: { cookie: '__session=abc' } }), estaticos)).toBeNull();
  });
});

import { sinVueltaSpa } from '../src/cloudflare/portada.js';

describe('sin vuelta de la SPA para ficheros', () => {
  const html = () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  it('un .json que no existe da 404, no el index.html', async () => {
    const r = sinVueltaSpa('/.well-known/ai-catalog.json', html());
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toContain('text/plain');
    expect(sinVueltaSpa('/ai-catalog.json', html()).status).toBe(404);
  });
  it('las páginas, los .html y los ficheros que sí existen pasan', () => {
    expect(sinVueltaSpa('/biblioteca', html()).status).toBe(200);
    expect(sinVueltaSpa('/acerca.html', html()).status).toBe(200);
    const json = new Response('{}', { headers: { 'content-type': 'application/json' } });
    expect(sinVueltaSpa('/.well-known/mcp/server-card.json', json).status).toBe(200);
  });
});
