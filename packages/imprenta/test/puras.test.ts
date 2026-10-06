import { describe, expect, it } from 'vitest';
import { construirCapa, cortarXY, detectarTitulillos, diagnosticar, unirLineas } from '../src/pdf/capa-texto.js';
import type { ItemCrudo } from '../src/pdf/pagina-cruda.js';
import { buscarDoi, fechaPdf, partirAutores, tituloBasura } from '../src/pdf/documento.js';
import { regionesDeImagen } from '../src/pdf/pagina-cruda.js';
import { detectar, compararNombres } from '../src/detectar.js';
import { bloquesDeHtml } from '../src/documentos/html.js';
import { bloquesDeMarkdown, bloquesDeRtf, decodificarTexto } from '../src/documentos/texto.js';
import { hojaAMarkdown } from '../src/documentos/hoja.js';
import { planPliegos } from '../src/pdf/cortar.js';

const item = (s: string, x: number, y: number, w: number, tam = 10): ItemCrudo => ({ s, x, y, w, h: tam / 792, tam, fl: false });

describe('diagnóstico de la capa de texto', () => {
  it('da por buena una capa digital limpia', () => {
    const items = Array.from({ length: 20 }, (_, i) => item('La interpretación de los textos medievales exige paciencia y método.', 0.1, 0.1 + i * 0.03, 0.8));
    const d = diagnosticar(items, 0);
    expect(d.util).toBe(true);
    expect(d.origen).toBe('digital');
    expect(d.calidad).toBeGreaterThan(0.9);
  });
  it('rechaza una capa OCR sucia sobre una página escaneada', () => {
    const basura = "EL CASAMIENTO EN LA ÑIVEf{TE, y HECHOS DE BERN ARDO l er1#41J Di\"t. Jdrigo ma~ fuerza• AS.AJtI1EN'TO Rold\\n qmera ~ombran Durandanee~ galan";
    const items = Array.from({ length: 12 }, (_, i) => item(basura, 0.1, 0.1 + i * 0.05, 0.8));
    const d = diagnosticar(items, 1);
    expect(d.origen).toBe('ocr');
    expect(d.util).toBe(false);
  });
  it('sin texto: escaneada', () => {
    expect(diagnosticar([], 1)).toMatchObject({ util: false, origen: 'ninguno' });
  });
  it('detecta caracteres de uso privado (fuentes sin ToUnicode)', () => {
    const items = Array.from({ length: 10 }, (_, i) => item('  texto', 0.1, 0.1 + i * 0.05, 0.8));
    expect(diagnosticar(items, 0).util).toBe(false);
  });
});

describe('líneas, bloques y zonas', () => {
  it('separa cabecera, pie y cuerpo, y saca candidatos a folio', () => {
    const items = [
      item('Vigilar y castigar', 0.35, 0.03, 0.3, 9),
      item('Primera línea del cuerpo de la página.', 0.1, 0.2, 0.8),
      item('Segunda línea del cuerpo, que sigue.', 0.1, 0.2 + 12 / 792, 0.8),
      item('xiv', 0.48, 0.95, 0.04, 9),
    ];
    const c = construirCapa(items, 612, 792);
    expect(c.cabecera.map((l) => l.texto)).toEqual(['Vigilar y castigar']);
    expect(c.pie.map((l) => l.texto)).toEqual(['xiv']);
    expect(c.bloques).toHaveLength(1);
    expect(c.cuerpo).toContain('Primera línea');
    expect(c.candidatosFolio).toEqual([expect.objectContaining({ texto: 'xiv', zona: 'pie', lado: 'centro', romano: true, valor: 14 })]);
  });
  it('lee a dos columnas por columnas', () => {
    const items: ItemCrudo[] = [];
    for (let i = 0; i < 5; i++) {
      items.push(item(`izquierda ${i}`, 0.08, 0.15 + i * 0.016, 0.38));
      items.push(item(`derecha ${i}`, 0.54, 0.15 + i * 0.016, 0.38));
    }
    const c = construirCapa(items, 612, 792);
    expect(c.bloques).toHaveLength(2);
    expect(c.bloques[0]?.texto).toMatch(/^izquierda 0 .* izquierda 4$/);
    expect(c.bloques[1]?.texto).toMatch(/^derecha 0/);
  });
  it('une palabras partidas con guion', () => {
    expect(unirLineas(['la interpre-', 'tación del texto'])).toBe('la interpretación del texto');
    expect(unirLineas(['Jean-', 'Paul'])).toBe('Jean- Paul');
  });
  it('corte XY: título arriba, luego columnas', () => {
    const c = (x0: number, y0: number, x1: number, y1: number, n: string) => ({ x0, y0, x1, y1, n });
    const orden = cortarXY([c(0.55, 0.3, 0.9, 0.8, 'der'), c(0.1, 0.3, 0.45, 0.8, 'izq'), c(0.2, 0.1, 0.8, 0.15, 'titulo')]).map((x) => x.n);
    expect(orden).toEqual(['titulo', 'izq', 'der']);
  });
  it('detecta titulillos repetidos sin contar números', () => {
    const l = (t: string) => ({ texto: t, x: 0, y: 0, w: 1, h: 0.01, tam: 9, bloque: -1 });
    const zonas = Array.from({ length: 10 }, (_, i) => [l(`${i + 10} The Discarded Image`)]);
    expect(detectarTitulillos(zonas)).toEqual(['10 The Discarded Image']);
  });
  it('regiones de imagen desde el operator list', () => {
    const OPS = { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, paintImageXObject: 85, paintInlineImageXObject: 86, paintImageMaskXObject: 83, paintImageXObjectRepeat: 88 };
    // Vista de una página de 100×200 (y hacia abajo) y una imagen que ocupa la mitad de arriba.
    const vista: [number, number, number, number, number, number] = [1, 0, 0, -1, 0, 200];
    const r = regionesDeImagen([10, 12, 85, 11], [null, [100, 0, 0, 100, 0, 100], ['img'], null], OPS, vista, 100, 200);
    expect(r.regiones[0]).toMatchObject({ x: 0, y: 0, w: 1, h: 0.5 });
    expect(r.cobertura).toBeCloseTo(0.5, 1);
  });
});

describe('ficha del PDF', () => {
  it('fechas PDF a ISO', () => {
    expect(fechaPdf("D:20100715143156+02'00'")).toBe('2010-07-15T14:31:56+02:00');
    expect(fechaPdf('D:20240410211143Z')).toBe('2024-04-10T21:11:43Z');
  });
  it('autores', () => {
    expect(partirAutores('C. S. Lewis')).toEqual([{ nombre: 'C. S.', apellidos: 'Lewis' }]);
    expect(partirAutores('Foucault, Michel; Deleuze, Gilles')).toEqual([{ nombre: 'Michel', apellidos: 'Foucault' }, { nombre: 'Gilles', apellidos: 'Deleuze' }]);
  });
  it('DOI y títulos basura', () => {
    expect(buscarDoi('see https://doi.org/10.1145/3292500.3330701.')).toBe('10.1145/3292500.3330701');
    expect(tituloBasura('LecturasPDF________')).toBe(true);
    expect(tituloBasura('Microsoft Word - tesis.docx')).toBe(true);
    expect(tituloBasura('The Discarded Image')).toBe(false);
  });
  it('plan de pliegos', () => {
    expect(planPliegos(23, 10)).toEqual([[1, 10], [11, 20], [21, 23]]);
  });
});

describe('detección y texto', () => {
  it('detecta por firma', () => {
    expect(detectar(new TextEncoder().encode('%PDF-1.7\n'), 'x.bin').tipo).toBe('pdf');
    expect(detectar(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'a').tipo).toBe('imagen');
    expect(detectar(new TextEncoder().encode('# Hola'), 'notas.md').formato).toBe('markdown');
    expect(detectar(new TextEncoder().encode('{\\rtf1 hola}'), 'x').formato).toBe('rtf');
  });
  it('orden natural de nombres', () => {
    expect(['IMG_10.jpg', 'IMG_2.jpg', 'IMG_1.jpg'].sort(compararNombres)).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg']);
  });
  it('Windows-1252 de reserva', () => {
    expect(decodificarTexto(new Uint8Array([0x63, 0x61, 0xf1, 0x61]))).toBe('caña');
  });
  it('HTML: notas, saltos de página y rutas', () => {
    const r = bloquesDeHtml('<h1>Cap</h1><p>Uno<sup><a href="#fn1">1</a></sup></p><span epub:type="pagebreak" title="45"></span><p>Dos</p><aside epub:type="footnote" id="fn1"><p>Nota.</p></aside>');
    expect(r.bloques.map((b) => [b.tipo, b.texto, b.impresa ?? null])).toEqual([['titulo', 'Cap', null], ['parrafo', 'Uno[^fn1]', null], ['parrafo', 'Dos', '45']]);
    expect(r.notas).toEqual([{ id: 'fn1', texto: 'Nota.' }]);
    expect(r.bloques[2]?.ruta).toEqual(['Cap']);
  });
  it('Markdown con front matter', () => {
    const r = bloquesDeMarkdown('---\ntitle: T\n---\n# A\n\ntexto\n\n## B\n\n```\ncódigo\n```\n');
    expect(r.metadatos.titulo).toBe('T');
    expect(r.bloques.map((b) => b.tipo)).toEqual(['titulo', 'parrafo', 'titulo', 'codigo']);
    expect(r.bloques[3]?.ruta).toEqual(['A', 'B']);
  });
  it('RTF con unicode y nota', () => {
    const r = bloquesDeRtf(String.raw`{\rtf1\ansi{\fonttbl{\f0 X;}}{\pard a\u241?o {\footnote nota}\par}}`);
    expect(r.bloques[0]?.texto).toBe('año [^rtf-1]');
    expect(r.notas[0]?.texto).toBe('nota');
  });
  it('hoja: tramos con la cabecera repetida', () => {
    const h = hojaAMarkdown('H', [['a', 'b'], ...Array.from({ length: 5 }, (_, i) => [i, `x|${i}`])], 1, 2);
    expect(h.tramos.map((t) => [t.filaDesde, t.filaHasta])).toEqual([[2, 3], [4, 5], [6, 6]]);
    expect(h.tramos[0]?.markdown.split('\n')[0]).toBe('| a | b |');
    expect(h.tramos[0]?.markdown).toContain('x\\|0');
  });
});
