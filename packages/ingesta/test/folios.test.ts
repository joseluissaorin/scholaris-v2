import { describe, expect, it } from 'vitest';
import { deducirFolios, type EntradaFolio } from '../src/pasos/folios.js';

const e = (fisica: number, visto: string | null, etiqueta: string | null = null): EntradaFolio => ({ fisica, visto, etiqueta, vacia: false });

describe('deducirFolios', () => {
  it('deduce los huecos dentro de una zona y corrige un folio mal leído', () => {
    const ent = [e(1, null), e(2, null), e(3, '1'), e(4, '2'), e(5, null), e(6, '4'), e(7, '9'), e(8, '6'), e(9, null)];
    const a = deducirFolios(ent);
    expect(a.map((x) => x.impresa)).toEqual([null, null, '1', '2', '3', '4', '5', '6', '7']);
    expect(a[4]?.origen).toBe('deducido');
    expect(a[6]?.origen).toBe('deducido');
    expect(a[2]?.origen).toBe('leido');
  });

  it('preliminares en romanos y cuerpo en arábigos', () => {
    const ent = [e(1, null), e(2, 'v'), e(3, 'vi'), e(4, null), e(5, '1'), e(6, '2'), e(7, '3')];
    const a = deducirFolios(ent);
    expect(a.map((x) => x.impresa)).toEqual([null, 'v', 'vi', 'vii', '1', '2', '3']);
    expect(a[3]?.romana).toBe(true);
  });

  it('usa las etiquetas del PDF si son informativas y concuerdan', () => {
    const ent = [e(1, null, 'i'), e(2, 'ii', 'ii'), e(3, '1', '1'), e(4, null, '2')];
    const a = deducirFolios(ent);
    expect(a.map((x) => x.impresa)).toEqual(['i', 'ii', '1', '2']);
    expect(a[2]?.origen).toBe('leido');
  });

  it('ignora etiquetas triviales (1..n) y se queda con lo que ve', () => {
    const ent = [e(1, null, '1'), e(2, '231', '2'), e(3, '232', '3'), e(4, null, '4')];
    const a = deducirFolios(ent);
    expect(a.map((x) => x.impresa)).toEqual(['230', '231', '232', '233']);
  });
});
