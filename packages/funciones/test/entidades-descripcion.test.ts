/**
 * La descripción de Wikidata va en el idioma de la interfaz; el inglés, solo si no hay otra.
 * Antes, una entidad encontrada por la búsqueda inglesa se quedaba con «oldest son of…».
 */
import { describe, expect, it } from 'vitest';
import { estanteria } from './ayudas.js';
import { descripcionWikidata, enlazarWikidata } from '../src/entidades/wikidata.js';

function falso(descripciones: Record<string, Record<string, string>>) {
  const llamadas: string[] = [];
  const f = (async (url: string) => {
    const u = new URL(url);
    llamadas.push(u.searchParams.get('action') ?? '');
    const id = u.searchParams.get('ids') ?? '';
    const langs = (u.searchParams.get('languages') ?? '').split('|');
    const d = Object.fromEntries(Object.entries(descripciones[id] ?? {}).filter(([l]) => langs.includes(l)).map(([l, v]) => [l, { language: l, value: v }]));
    return new Response(JSON.stringify({ entities: { [id]: { descriptions: d } } }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

describe('descripciones de Wikidata en el idioma de la interfaz', () => {
  it('prefiere el español y cae al inglés solo si no hay', async () => {
    const sql = await estanteria();
    const w = falso({ Q1035: { en: 'English naturalist', es: 'naturalista británico' }, Q2: { en: 'only in English' } });
    expect(await descripcionWikidata(sql, 'Q1035', ['es', 'en'], w.f)).toBe('naturalista británico');
    expect(await descripcionWikidata(sql, 'Q2', ['es', 'en'], w.f)).toBe('only in English');
    // Con caché: la segunda vez no se pregunta.
    await descripcionWikidata(sql, 'Q1035', ['es', 'en'], w.f);
    expect(w.llamadas.length).toBe(2);
  });

  it('las entidades ya enlazadas con la descripción inglesa se corrigen una sola vez', async () => {
    const sql = await estanteria();
    const t = new Date().toISOString();
    await sql.ejecutar(
      "INSERT INTO entidades (id, tipo, clave, nombre, wikidata, descripcion, wikidata_visto, n_menciones, n_documentos, creada, actualizada) VALUES ('e1', 'persona', 'charles darwin', 'Charles Darwin', 'Q1035', 'oldest son of Erasmus Darwin', 1, 3, 2, ?, ?)", t, t,
    );
    const w = falso({ Q1035: { en: 'English naturalist', es: 'naturalista británico' } });
    await enlazarWikidata(sql, { fetch: w.f, pausa: 0 });
    const [e] = await sql.ejecutar<{ descripcion: string }>("SELECT descripcion FROM entidades WHERE id = 'e1'");
    expect(e!.descripcion).toBe('naturalista británico');
    const n = w.llamadas.length;
    await enlazarWikidata(sql, { fetch: w.f, pausa: 0 });
    expect(w.llamadas.length).toBe(n);
  });
});
