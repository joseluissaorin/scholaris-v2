/**
 * `pnpm bench comparar [etiqueta…]`: compara cada SPDF 4.0 de bench/datos/salida
 * con el SPDF 3 antiguo de bench/datos/spdf-v3 (calidad y velocidad).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { contarTokens, normalizar } from '@scholaris/ingesta';
import { RAIZ, SALIDA } from './ingesta.js';

const V3 = join(RAIZ, 'datos', 'spdf-v3');

type Fila = Record<string, unknown>;

/** F1 de palabras (bolsa de palabras normalizadas): robusto a cortes y a cabeceras desplazadas. */
export function f1Palabras(a: string, b: string): number {
  const bolsa = (s: string) => { const m = new Map<string, number>(); for (const w of normalizar(s).split(' ').filter(Boolean)) m.set(w, (m.get(w) ?? 0) + 1); return m; };
  const x = bolsa(a), y = bolsa(b);
  let comun = 0, nx = 0, ny = 0;
  for (const [w, n] of x) { nx += n; comun += Math.min(n, y.get(w) ?? 0); }
  for (const n of y.values()) ny += n;
  return nx && ny ? (2 * comun) / (nx + ny) : 0;
}

function abrirV3(etiqueta: string, archivo?: string): Database.Database | null {
  const prefijos = [etiqueta.slice(0, 20), ...(archivo ? [archivo.replace(/\.[^.]+$/, '').slice(0, 20)] : [])];
  const f = readdirSync(V3).find((x) => prefijos.some((p) => x.startsWith(p)) && x.endsWith('.spdf'));
  if (!f) return null;
  const tmp = join('/tmp', `v3-${etiqueta}.db`);
  if (!existsSync(tmp)) writeFileSync(tmp, gunzipSync(readFileSync(join(V3, f))));
  return new Database(tmp, { readonly: true });
}

const pct = (x: number) => `${(x * 100).toFixed(0)} %`;
const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[Math.floor(s.length / 2)] as number) : 0; };

export interface Comparacion {
  etiqueta: string;
  nuevo: Record<string, unknown>;
  viejo: Record<string, unknown>;
  textoSimilitud?: { media: number; peores: Array<{ fisica: number; sim: number }> };
}

export function comparar(etiqueta: string): Comparacion | null {
  const rutaNueva = join(SALIDA, `${etiqueta}.sqlite`);
  if (!existsSync(rutaNueva)) return null;
  const n = new Database(rutaNueva, { readonly: true });
  const informe = JSON.parse(readFileSync(join(SALIDA, `${etiqueta}.informe.json`), 'utf8')) as Record<string, unknown>;
  const v = abrirV3(etiqueta, String(informe.archivo ?? ''));

  const doc = n.prepare('SELECT metadatos FROM documentos').get() as { metadatos: string };
  const meta = JSON.parse(doc.metadatos) as { titulo: string; autores: Array<{ nombre: string; apellidos: string }>; anio?: number; idioma?: string; doi?: string; procedencia?: Record<string, { fuente: string }> };
  const unidades = n.prepare('SELECT orden, ancla, texto, impresa, lector FROM unidades ORDER BY orden').all() as Fila[];
  const frags = n.prepare('SELECT texto, contexto, seccion, ancla_fin FROM fragmentos ORDER BY orden').all() as Fila[];
  const tokens = frags.map((f) => contarTokens(String(f.texto)));
  const nuevo = {
    titulo: meta.titulo,
    autores: meta.autores.map((a) => `${a.nombre} | ${a.apellidos}`).join('; '),
    anio: meta.anio ?? null,
    idioma: meta.idioma ?? null,
    doi: meta.doi ?? null,
    fuenteTitulo: meta.procedencia?.titulo?.fuente ?? null,
    unidades: unidades.length,
    conFolio: unidades.filter((u) => u.impresa !== null).length,
    fragmentos: frags.length,
    tokensMediana: mediana(tokens),
    tokensMin: Math.min(...tokens),
    tokensMax: Math.max(...tokens),
    enRango: pct(tokens.filter((t) => t >= 150 && t <= 500).length / Math.max(1, tokens.length)),
    conContexto: pct(frags.filter((f) => String(f.contexto)).length / Math.max(1, frags.length)),
    cruzanPagina: frags.filter((f) => f.ancla_fin).length,
    secciones: (n.prepare('SELECT count(*) c FROM secciones').get() as { c: number }).c,
    figuras: (n.prepare('SELECT count(*) c FROM figuras').get() as { c: number }).c,
    vectores: (n.prepare('SELECT count(*) c FROM vectores').get() as { c: number }).c,
    ms: informe.ms, usd: informe.usd,
    caracteres: unidades.reduce((n, u) => n + String(u.texto).length, 0),
    paginasVacias: unidades.filter((u) => String(u.texto).trim().length < 100).length,
    folioIgualFisica: unidades.filter((u) => u.impresa !== null && String(u.impresa) === String(JSON.parse(String(u.ancla)).fisica)).length,
  };
  let viejo: Record<string, unknown> = {};
  let textoSimilitud: Comparacion['textoSimilitud'];
  if (v) {
    const m = Object.fromEntries((v.prepare('SELECT key, value FROM metadata').all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
    const paginas = v.prepare('SELECT pdf_page, book_page, text FROM pages ORDER BY pdf_page').all() as Array<{ pdf_page: number; book_page: number; text: string }>;
    const chunks = v.prepare('SELECT text FROM chunks').all() as Array<{ text: string }>;
    const tv = chunks.map((c) => contarTokens(c.text));
    const caracteresViejo = paginas.reduce((n, p) => n + p.text.length, 0);
    let secciones = 0;
    try { secciones = (v.prepare('SELECT count(*) c FROM sections').get() as { c: number }).c; } catch { /* sin tabla */ }
    viejo = {
      titulo: m.title, autores: m.authors, anio: m.year, idioma: m.language, doi: m.doi ?? null,
      unidades: paginas.length, fragmentos: chunks.length, tokensMediana: mediana(tv), tokensMin: Math.min(...tv), tokensMax: Math.max(...tv),
      enRango: pct(tv.filter((t) => t >= 150 && t <= 500).length / Math.max(1, tv.length)), secciones,
      contextual: m.contextual_chunks ?? 'no',
      caracteres: caracteresViejo,
      paginasVacias: paginas.filter((p) => p.text.trim().length < 100).length,
      folioIgualFisica: paginas.filter((p) => p.book_page === p.pdf_page).length,
    };
    // Fidelidad: similitud por página entre el texto viejo y el nuevo (solo documentos de páginas).
    const porFisica = new Map(unidades.map((u) => [JSON.parse(String(u.ancla)).fisica as number, String(u.texto)]));
    const sims: Array<{ fisica: number; sim: number }> = [];
    for (const p of paginas) {
      const nuevoTexto = porFisica.get(p.pdf_page);
      if (nuevoTexto === undefined || (!p.text.trim() && !nuevoTexto.trim())) continue;
      sims.push({ fisica: p.pdf_page, sim: f1Palabras(p.text, nuevoTexto.replace(/^#+\s/gm, '')) });
    }
    if (sims.length) textoSimilitud = { media: sims.reduce((s, x) => s + x.sim, 0) / sims.length, peores: [...sims].sort((a, b) => a.sim - b.sim).slice(0, 5) };
  }
  return { etiqueta, nuevo, viejo, ...(textoSimilitud ? { textoSimilitud } : {}) };
}

export function compararTodo(etiquetas?: string[]): Comparacion[] {
  const todas = etiquetas?.length ? etiquetas : readdirSync(SALIDA).filter((f) => f.endsWith('.informe.json')).map((f) => f.replace('.informe.json', ''));
  const salida = todas.map(comparar).filter((x): x is Comparacion => x !== null);
  writeFileSync(join(SALIDA, 'comparacion.json'), JSON.stringify(salida, null, 2));
  return salida;
}
