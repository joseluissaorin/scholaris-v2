import { describe, expect, it } from 'vitest';
import { htmlSeguro } from './resaltado';
import { textoLimpio } from './texto';

// Réplicas literales del capítulo VIII de la primera parte del Quijote (Project Gutenberg n.º 2000).
describe('marcas de hablante en los pasajes', () => {
  it('la marca partida por los puntos suspensivos no deja asteriscos', () => {
    expect(htmlSeguro('…Aquellos que allí ves. **Sancho Pan…')).toBe('…Aquellos que allí ves.');
    expect(textoLimpio('…Aquellos que allí ves. **Sancho Pan…')).toBe('…Aquellos que allí ves.');
  });
  it('la marca entera sale como etiqueta propia, venga cruda o del servidor', () => {
    const esperado = 'Aquellos que allí ves. <span class="hablante">Sancho Panza</span> ¿Qué <mark>gigantes</mark>?';
    expect(htmlSeguro('Aquellos que allí ves. **Sancho Panza:** ¿Qué <mark>gigantes</mark>?')).toBe(esperado);
    expect(htmlSeguro('Aquellos que allí ves. <b class="hablante">Sancho Panza</b> ¿Qué <mark>gigantes</mark>?')).toBe(esperado);
  });
  it('nada de HTML del corpus pasa, ni por el nombre', () => {
    const r = htmlSeguro('**<img src=x onerror=alert(1)>:** hola <script>');
    expect(r).not.toMatch(/<img|<script/);
    expect(r).not.toContain('*');
  });
  it('el marcado de la OCR de la v1 no se pinta', () => {
    expect(textoLimpio('![](page=0,bbox=[0, 0, 589, 753])')).toBe('');
    expect(htmlSeguro('![](page=0,bbox=[25, 11, 817, 447]) <div align="center">MAFALDA</div>')).toBe('MAFALDA');
  });
  it('el texto plano dice quién habla sin Markdown', () => {
    expect(textoLimpio('**Sancho Panza:** ¿Qué gigantes?')).toBe('Sancho Panza: ¿Qué gigantes?');
  });
});
