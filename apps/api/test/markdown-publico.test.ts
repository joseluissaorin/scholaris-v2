import { describe, expect, it } from 'vitest';
import { esPaginaPublica, prefiereMarkdown, servirPublica } from '../src/compartido/markdown-publico.js';

const ESTATICOS: Record<string, [string, string]> = {
  '/saber/formatos': ['<!doctype html><h1>Formatos</h1>', 'text/html; charset=utf-8'],
  '/saber/formatos.md': ['# Formatos', 'text/markdown'],
  '/llms.txt': ['# Scholaris', 'text/plain'],
  '/acerca': ['<!doctype html>', 'text/html'],
};
const leer = async (ruta: string) => {
  const e = ESTATICOS[ruta];
  // Como Cloudflare con «single-page-application»: lo que no existe devuelve index.html.
  // (y con el tipo que diga _headers para esa ruta, p. ej. text/markdown en un .md).
  return e ? new Response(e[0], { headers: { 'content-type': e[1] } }) : new Response('<!doctype html>app', { headers: { 'content-type': ruta.endsWith('.md') ? 'text/markdown' : 'text/html' } });
};
const pedir = (ruta: string, accept?: string) => new Request(`https://scholaris.test${ruta}`, accept ? { headers: { accept } } : {});

describe('páginas públicas para agentes', () => {
  it('reconoce las rutas públicas', () => {
    for (const r of ['/acerca', '/en', '/api', '/en/api', '/saber', '/saber/formatos', '/agentes', '/en/knowledge', '/en/knowledge/faq', '/en/agents']) expect(esPaginaPublica(r)).toBe(true);
    for (const r of ['/', '/buscar', '/api/v1/buscar', '/ajustes/claves', '/saber/a/b']) expect(esPaginaPublica(r)).toBe(false);
  });

  it('negocia por Accept', () => {
    expect(prefiereMarkdown('text/markdown')).toBe(true);
    expect(prefiereMarkdown('text/markdown, text/html;q=0.9')).toBe(true);
    expect(prefiereMarkdown('text/html, text/markdown;q=0.5')).toBe(false);
    expect(prefiereMarkdown('text/html,application/xhtml+xml,*/*;q=0.8')).toBe(false);
    expect(prefiereMarkdown(null)).toBe(false);
  });

  it('sirve el gemelo en Markdown y el HTML con su Link', async () => {
    const md = (await servirPublica(pedir('/saber/formatos', 'text/markdown'), leer))!;
    expect(md.headers.get('content-type')).toMatch(/text\/markdown/);
    expect(md.headers.get('vary')).toBe('Accept');
    expect(await md.text()).toBe('# Formatos');

    const html = (await servirPublica(pedir('/saber/formatos'), leer))!;
    expect(html.headers.get('content-type')).toMatch(/text\/html/);
    expect(html.headers.get('link')).toContain('</saber/formatos.md>'.replace('</', '<https://scholaris.test/'));
  });

  it('«/» en Markdown es el llms.txt; sin Markdown no lo toca', async () => {
    const r = (await servirPublica(pedir('/', 'text/markdown'), leer))!;
    expect(await r.text()).toBe('# Scholaris');
    expect(await servirPublica(pedir('/'), leer)).toBeNull();
  });

  it('un .md que no existe es un 404, no la aplicación', async () => {
    const r = (await servirPublica(pedir('/saber/nada.md'), leer))!;
    expect(r.status).toBe(404);
  });

  it('no toca la aplicación ni la API', async () => {
    expect(await servirPublica(pedir('/buscar', 'text/markdown'), leer)).toBeNull();
    expect(await servirPublica(new Request('https://scholaris.test/saber', { method: 'POST' }), leer)).toBeNull();
  });
});
