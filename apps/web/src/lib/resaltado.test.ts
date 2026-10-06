import { describe, expect, it } from 'vitest';
import { htmlSeguro } from './resaltado';
import { textoLimpio } from './texto';

describe('marcas de hablante en los pasajes', () => {
  it('la marca partida por los puntos suspensivos no deja asteriscos', () => {
    expect(htmlSeguro('…Sí, exacto. **Joaquín Soler…')).toBe('…Sí, exacto.');
    expect(textoLimpio('…Sí, exacto. **Joaquín Soler…')).toBe('…Sí, exacto.');
  });
  it('la marca entera sale como etiqueta propia, venga cruda o del servidor', () => {
    const esperado = 'Sí. <span class="hablante">Joaquín Soler Serrano</span> ¿Y el <mark>jazz</mark>?';
    expect(htmlSeguro('Sí. **Joaquín Soler Serrano:** ¿Y el <mark>jazz</mark>?')).toBe(esperado);
    expect(htmlSeguro('Sí. <b class="hablante">Joaquín Soler Serrano</b> ¿Y el <mark>jazz</mark>?')).toBe(esperado);
  });
  it('nada de HTML del corpus pasa, ni por el nombre', () => {
    const r = htmlSeguro('**<img src=x onerror=alert(1)>:** hola <script>');
    expect(r).not.toMatch(/<img|<script/);
    expect(r).not.toContain('*');
  });
  it('el texto plano dice quién habla sin Markdown', () => {
    expect(textoLimpio('**Julio Cortázar:** El jazz es libertad.')).toBe('Julio Cortázar: El jazz es libertad.');
  });
});
