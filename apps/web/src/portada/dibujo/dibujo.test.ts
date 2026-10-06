import { describe, expect, it } from 'vitest';
import { generador, semillaDe } from './azar';
import { curva, contorno, temblar, rayas, simplificar } from './pluma';
import { aSvg, enLengua, type Dibujo } from './boceto';
import { DIBUJOS } from './dibujos';

const todos = Object.entries(DIBUJOS) as [string, Dibujo][];

/** Todos los atributos d de un SVG. */
const caminos = (svg: string) => [...svg.matchAll(/\sd="([^"]*)"/g)].map((m) => m[1]!);

/** Un camino válido: empieza con M, solo usa M, L y Z, y todos sus números son finitos y vienen por pares. */
function caminoValido(d: string): boolean {
  if (!/^M/.test(d)) return false;
  if (/[^MLZ0-9.\- ]/.test(d)) return false;
  const tramos = d.split(/[MLZ]/).filter((t) => t.trim());
  return tramos.every((t) => {
    const n = t.trim().split(/\s+/).map(Number);
    return n.length % 2 === 0 && n.every(Number.isFinite);
  });
}

describe('el azar de la mano', () => {
  it('la misma semilla da la misma secuencia', () => {
    const a = generador(semillaDe('manicula')), b = generador(semillaDe('manicula'));
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });
  it('semillas distintas dan secuencias distintas y siempre en [0, 1)', () => {
    const a = generador(1), b = generador(2);
    const va = Array.from({ length: 20 }, a), vb = Array.from({ length: 20 }, b);
    expect(va).not.toEqual(vb);
    for (const v of [...va, ...vb]) expect(v >= 0 && v < 1).toBe(true);
  });
});

describe('la pluma', () => {
  it('la curva pasa por los puntos escritos a mano', () => {
    const pts = [[0, 0], [50, 20], [100, 0]] as const;
    const c = curva(pts);
    expect(c[0]).toEqual([0, 0]);
    expect(c[c.length - 1]).toEqual([100, 0]);
    expect(c.some(([x, y]) => Math.abs(x - 50) < 0.01 && Math.abs(y - 20) < 0.01)).toBe(true);
  });
  it('el temblor es leve: ningún punto se aleja más de lo pedido (más el desborde)', () => {
    const base = curva([[0, 0], [200, 0]]);
    const t = temblar(base, 7, { temblor: 1, desborde: 0 });
    for (const [, y] of t) expect(Math.abs(y)).toBeLessThan(1.7);
  });
  it('el contorno de un trazo es un polígono cerrado sin números raros', () => {
    const c = contorno(curva([[0, 0], [80, 10], [160, 0]]), 3, 0.3);
    expect(c.length).toBeGreaterThan(10);
    for (const [x, y] of c) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  });
  it('el sombreado se queda dentro de la zona y a medias si se pide', () => {
    const zona = [[0, 0], [100, 0], [100, 100], [0, 100]] as const;
    const enteras = rayas(zona, 45, 6, 1, 3), medias = rayas(zona, 45, 6, 0.5, 3);
    expect(medias.length).toBeLessThan(enteras.length);
    for (const l of enteras) for (const [x, y] of l) expect(x > -1 && x < 101 && y > -1 && y < 101).toBe(true);
  });
  it('simplificar conserva los extremos', () => {
    const pts = curva([[0, 0], [30, 5], [60, 0], [90, 5]]);
    const s = simplificar(pts, 0.5);
    expect(s[0]).toEqual(pts[0]);
    expect(s[s.length - 1]).toEqual(pts[pts.length - 1]);
    expect(s.length).toBeLessThan(pts.length);
  });
});

describe.each(todos)('el dibujo «%s»', (nombre, dibujo) => {
  const svg = aSvg(dibujo);

  it('es determinista: sale idéntico cada vez', () => {
    expect(aSvg(dibujo)).toBe(svg);
    expect(aSvg(dibujo, { lengua: 'en' })).toBe(aSvg(dibujo, { lengua: 'en' }));
  });
  it('todos sus caminos son válidos', () => {
    const ds = caminos(svg);
    expect(ds.length).toBeGreaterThan(0);
    for (const d of ds) expect(caminoValido(d), `${nombre}: ${d.slice(0, 80)}`).toBe(true);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });
  it('tiene título y descripción en las dos lenguas, y una descripción que dice algo', () => {
    for (const l of ['es', 'en'] as const) {
      expect(enLengua(dibujo.titulo, l).length).toBeGreaterThan(5);
      expect(enLengua(dibujo.descripcion, l).length).toBeGreaterThan(40);
    }
    expect(svg).toContain('role="img"');
    expect(aSvg(dibujo, { decorativo: true })).toContain('aria-hidden="true"');
  });
  it('las notas en inglés no se quedan en español', () => {
    const notas = (s: string) => [...s.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((m) => m[1]);
    const es = notas(svg), en = notas(aSvg(dibujo, { lengua: 'en' }));
    expect(en.length).toBe(es.length);
    if (es.some((t) => /[áéíóúñ¿]/.test(t ?? ''))) expect(en).not.toEqual(es);
  });
  it('pesa poco (menos de 120 KB sin comprimir)', () => {
    expect(svg.length).toBeLessThan(120_000);
  });
});

describe('el cuaderno entero', () => {
  it('cada dibujo tiene un identificador propio (las máscaras no se pisan)', () => {
    const ids = todos.map(([, d]) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
