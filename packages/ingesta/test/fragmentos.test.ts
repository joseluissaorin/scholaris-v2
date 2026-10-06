import { describe, expect, it } from 'vitest';
import type { AnclaPagina } from '@scholaris/nucleo';
import type { UnidadLeida } from '../src/tipos.js';
import { trocear } from '../src/pasos/fragmentos.js';
import { pasoEstructura } from '../src/pasos/estructura.js';
import { contarTokens } from '../src/texto.js';

const ancla = (fisica: number): AnclaPagina => ({ tipo: 'pagina', fisica, impresa: String(fisica + 10), romana: false, origen: 'leido', confianza: 1 });
const unidad = (orden: number, texto: string, notas: string[] = []): UnidadLeida => ({
  orden, fisica: orden + 1, texto, notas, cabecera: '', pie: '', folioVisto: null, titulos: [], figuras: [], vacia: false, lector: 't', confianza: 1, ancla: ancla(orden + 1),
});
const frase = (i: number) => `This is sentence number ${i} of a long scholarly paragraph about medieval cosmology and its models.`;
const parrafo = (n: number, desde = 0) => Array.from({ length: n }, (_, i) => frase(desde + i)).join(' ');

describe('trocear', () => {
  it('nunca cruza secciones y respeta el rango de tokens', () => {
    const us = [
      unidad(0, `# Chapter One\n\n${parrafo(12)}\n\n${parrafo(10, 100)}`),
      unidad(1, `${parrafo(9, 200)}\n\n# Chapter Two\n\n${parrafo(14, 300)}`),
      unidad(2, parrafo(20, 400)),
    ];
    const { secciones } = pasoEstructura(us, undefined);
    expect(secciones.map((s) => s.titulo)).toEqual(['Chapter One', 'Chapter Two']);
    const fr = trocear(us, secciones);
    for (const f of fr) expect(f.seccion).toHaveLength(1);
    const uno = fr.filter((f) => f.seccion[0] === 'Chapter One');
    const dos = fr.filter((f) => f.seccion[0] === 'Chapter Two');
    expect(uno.length).toBeGreaterThan(0);
    expect(dos.length).toBeGreaterThan(0);
    // Ningún fragmento de «One» contiene texto de «Two».
    expect(uno.some((f) => f.texto.includes('number 300 '))).toBe(false);
    for (const f of fr) expect(contarTokens(f.texto)).toBeLessThanOrEqual(520);
    // La mayoría en el rango objetivo.
    const enRango = fr.filter((f) => f.tokens >= 150 && f.tokens <= 470).length;
    expect(enRango / fr.length).toBeGreaterThan(0.7);
    // El título va dentro del primer fragmento de su sección.
    expect(uno[0]?.texto.startsWith('## Chapter One')).toBe(true);
    // Orden correlativo.
    expect(fr.map((f) => f.orden)).toEqual(fr.map((_, i) => i));
  });

  it('une un párrafo partido entre páginas y lleva ancla y ancla_fin', () => {
    const us = [unidad(0, `${parrafo(3)} And this sentence continues on the`), unidad(1, `next page without any break. ${parrafo(2, 50)}`)];
    const fr = trocear(us, []);
    expect(fr).toHaveLength(1);
    expect(fr[0]?.texto).toContain('continues on the next page');
    expect((fr[0]?.ancla as AnclaPagina).fisica).toBe(1);
    expect((fr[0]?.anclaFin as AnclaPagina).fisica).toBe(2);
  });

  it('las notas al pie van con el fragmento que las llama; las demás, aparte', () => {
    const us = [
      unidad(0, `${parrafo(3)} As Ptolemy says.[^1]\n\n## Other\n\n${parrafo(2, 10)}`, ['[^1]: Almagest, I.7.', '[^9]: An orphan note.']),
    ];
    const { secciones } = pasoEstructura(us, undefined);
    const fr = trocear(us, secciones);
    const llama = fr.find((f) => f.texto.includes('As Ptolemy says.[^1]'));
    expect(llama?.texto).toContain('[^1]: Almagest, I.7.');
    const huerfana = fr.find((f) => f.texto.includes('orphan'));
    expect(huerfana).toBeDefined();
    expect(huerfana?.texto).not.toContain('Ptolemy says');
  });

  it('parte párrafos enormes por frases sin perder texto', () => {
    const largo = parrafo(80);
    const fr = trocear([unidad(0, largo)], []);
    expect(fr.length).toBeGreaterThan(3);
    expect(fr.map((f) => f.texto).join(' ').replace(/\s+/g, ' ')).toBe(largo);
  });

  it('respeta el verso al partir', () => {
    const versos = Array.from({ length: 120 }, (_, i) => `Verso número ${i} del acto`).join('\n');
    const fr = trocear([unidad(0, versos)], []);
    expect(fr.length).toBeGreaterThan(1);
    expect(fr[0]?.texto.split('\n').length).toBeGreaterThan(10);
  });
});

describe('estructura con índice', () => {
  it('ancla las entradas del índice al párrafo que coincide', () => {
    const us = [unidad(0, `Preface text here. ${parrafo(2)}`), unidad(1, `Some leftover text.\n\nThe Medieval Situation\n\n${parrafo(4)}`)];
    const { secciones } = pasoEstructura(us, [{ titulo: 'Preface', nivel: 1, fisica: 1 }, { titulo: 'I. The Medieval Situation', nivel: 1, fisica: 2 }]);
    expect(secciones[1]?.desde).toEqual({ unidad: 1, parrafo: 1 });
    const fr = trocear(us, secciones);
    expect(fr.find((f) => f.texto.includes('leftover'))?.seccion).toEqual(['Preface']);
  });
});
