import { describe, expect, it } from 'vitest';
import { aHtml, analizarEnLinea, analizarMarkdown, enlaceSeguro, idsDeMarca, marcasDe, separarPruebas, textoDe, type Bloque } from './markdown-respuesta';

describe('marcas de las pruebas', () => {
  it('una, varias, seguidas y en tramo', () => {
    expect(idsDeMarca('E1')).toEqual(['E1']);
    expect(idsDeMarca('E1, E3')).toEqual(['E1', 'E3']);
    expect(idsDeMarca('E2-E4')).toEqual(['E2', 'E3', 'E4']);
    expect(idsDeMarca('E2–4; E9')).toEqual(['E2', 'E3', 'E4', 'E9']);
    expect(marcasDe('Uno [E2]. Dos [E1][E3] y otra vez [E2].')).toEqual(['E2', 'E1', 'E3']);
  });

  it('en el texto: chips, «[sin prueba]» y nada más se confunde con una marca', () => {
    const h = analizarEnLinea('Coppelia baila [E1][E3] y el helado vuelve [sin prueba]. Véase [nota] y [E].');
    expect(h.filter((x) => x.t === 'cita')).toEqual([{ t: 'cita', ids: ['E1'] }, { t: 'cita', ids: ['E3'] }]);
    expect(h.some((x) => x.t === 'sin-prueba')).toBe(true);
    expect(textoDe(h)).toContain('Véase [nota] y [E].');
  });
});

describe('en línea', () => {
  it('negrita, cursiva, código y anidados', () => {
    expect(analizarEnLinea('**la *autómata* de Hoffmann**')).toEqual([{ t: 'negrita', hijos: [{ t: 'texto', v: 'la ' }, { t: 'cursiva', hijos: [{ t: 'texto', v: 'autómata' }] }, { t: 'texto', v: ' de Hoffmann' }] }]);
    expect(analizarEnLinea('el `plano 12` y _Der Sandmann_')).toEqual([{ t: 'texto', v: 'el ' }, { t: 'codigo', v: 'plano 12' }, { t: 'texto', v: ' y ' }, { t: 'cursiva', hijos: [{ t: 'texto', v: 'Der Sandmann' }] }]);
  });

  it('lo que aún no se ha cerrado (mientras se escribe) se queda como texto', () => {
    expect(analizarEnLinea('una **negrita a medias')).toEqual([{ t: 'texto', v: 'una **negrita a medias' }]);
    expect(analizarEnLinea('cita a medias [E1')).toEqual([{ t: 'texto', v: 'cita a medias [E1' }]);
  });

  it('los guiones bajos dentro de una palabra no son cursiva', () => {
    expect(analizarEnLinea('x_scholaris_comprension')).toEqual([{ t: 'texto', v: 'x_scholaris_comprension' }]);
  });

  it('enlaces: solo los seguros; los demás quedan en su texto', () => {
    expect(enlaceSeguro('javascript:alert(1)')).toBeNull();
    expect(enlaceSeguro('//malo.example')).toBeNull();
    expect(enlaceSeguro('https://rae.es')).toBe('https://rae.es');
    expect(analizarEnLinea('[pulsa](javascript:alert(1))')).toEqual([{ t: 'texto', v: 'pulsa' }]);
    expect(analizarEnLinea('[DPD](https://www.rae.es/dpd/raya)')).toEqual([{ t: 'enlace', href: 'https://www.rae.es/dpd/raya', hijos: [{ t: 'texto', v: 'DPD' }] }]);
  });

  it('los saltos de línea: espacio en un párrafo, salto en una cita en bloque', () => {
    expect(analizarEnLinea('uno\ndos')).toEqual([{ t: 'texto', v: 'uno dos' }]);
    expect(analizarEnLinea('uno\ndos', true)).toEqual([{ t: 'texto', v: 'uno' }, { t: 'salto' }, { t: 'texto', v: 'dos' }]);
  });
});

describe('bloques', () => {
  const md = [
    '## La función de Coppelia',
    '',
    'En el cuento es un **autómata** [E1]; en la película,',
    'otra cosa [E2].',
    '',
    '| Obra | Coppelia | Prueba |',
    '|:--|:-:|--:|',
    '| Cuento | autómata | [E1] |',
    '| Película | niña \\| muñeca |',
    '',
    '1. Primero',
    '2. Segundo',
    '   - dentro',
    '   - y otro',
    '',
    '> Verso uno',
    '> verso dos',
    '',
    '---',
    '',
    '- suelto',
  ].join('\n');
  const b = analizarMarkdown(md);

  it('reconoce cada tipo de bloque en orden', () => {
    expect(b.map((x) => x.t)).toEqual(['titulo', 'parrafo', 'tabla', 'lista', 'cita-bloque', 'separador', 'lista']);
    expect(b[0]).toMatchObject({ t: 'titulo', nivel: 2 });
  });

  it('la tabla: cabecera, alineación, columnas completas y la barra escapada', () => {
    const t = b[2] as Extract<Bloque, { t: 'tabla' }>;
    expect(t.alineacion).toEqual(['izquierda', 'centro', 'derecha']);
    expect(t.filas).toHaveLength(2);
    expect(t.filas[1]).toHaveLength(3);
    expect(textoDe(t.filas[1]![1]!)).toBe('niña | muñeca');
    expect(t.filas[0]![2]).toEqual([{ t: 'cita', ids: ['E1'] }]);
  });

  it('la lista numerada con otra anidada', () => {
    const l = b[3] as Extract<Bloque, { t: 'lista' }>;
    expect(l.ordenada).toBe(true);
    expect(l.elementos).toHaveLength(2);
    expect(l.elementos[1]!.map((x) => x.t)).toEqual(['parrafo', 'lista']);
  });

  it('la cita en bloque respeta los versos', () => {
    const c = b[4] as Extract<Bloque, { t: 'cita-bloque' }>;
    expect(c.hijos[0]).toEqual({ t: 'parrafo', hijos: [{ t: 'texto', v: 'Verso uno' }, { t: 'salto' }, { t: 'texto', v: 'verso dos' }] });
  });

  it('una tabla a medias (sin la línea de guiones) es un párrafo hasta que llega', () => {
    expect(analizarMarkdown('| Obra | Coppelia |').map((x) => x.t)).toEqual(['parrafo']);
  });

  it('separa la lista de pruebas del final', () => {
    const { cuerpo, pruebas } = separarPruebas(analizarMarkdown('Algo [E1].\n\n## Pruebas\n\n- [E1] «cita» (Hoffmann, 1816, p. 3)'));
    expect(cuerpo.map((x) => x.t)).toEqual(['parrafo']);
    expect(pruebas.map((x) => x.t)).toEqual(['titulo', 'lista']);
  });
});

describe('HTML para copiar', () => {
  it('escapa el texto y pone las citas', () => {
    const html = aHtml(analizarMarkdown('Dice <script>alert(1)</script> algo [E1][E2].\n\n| a | b |\n|---|---|\n| 1 | 2 |'), (ids) => `(${ids.join('; ')})`);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('algo (E1; E2).');
    expect(html).toContain('<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  });
});
