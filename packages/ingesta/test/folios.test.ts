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

describe('etiquetas del PDF frente a lo que se ve', () => {
  it('se aceptan si el valor está entre los números del pie aunque el elegido sea una nota', async () => {
    const { pasoFolios } = await import('../src/pasos/folios.js');
    const u = (fisica: number, etiqueta: string, pie: string) => ({ orden: fisica - 1, fisica, texto: 'x', notas: [], cabecera: '', pie, folioVisto: pie.split(' ')[0] ?? null, etiqueta, titulos: [], figuras: [], vacia: false, lector: 't', confianza: 1 });
    const us = [u(1, 'i', 'i'), u(2, 'ii', ''), u(3, '1', '1 Ed. Madden / 1'), u(4, '2', '3 Cf. / 2'), u(5, '3', '3'), u(6, '4', '1 nota / 4')];
    const r = await pasoFolios(us, { propio: true });
    expect(r.anclas.map((a) => a.impresa)).toEqual(['i', 'ii', '1', '2', '3', '4']);
    expect(r.procedencia.proveedor).toBe('etiquetas-pdf');
  });
});
