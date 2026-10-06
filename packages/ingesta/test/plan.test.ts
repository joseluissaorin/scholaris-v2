import { describe, expect, it } from 'vitest';
import { cortarPliegos, planificar } from '../src/planificar.js';
import { paginaPdf, paquetePdf } from './fakes.js';

const texto = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(5);

describe('planificar', () => {
  it('un PDF digital limpio va entero por la capa', () => {
    const plan = planificar(paquetePdf([1, 2, 3].map((f) => paginaPdf(f, texto))));
    expect(plan.modo).toBe('paginas');
    expect(plan.vias).toEqual(['capa', 'capa', 'capa']);
    expect(plan.pliegos).toEqual([]);
    expect(plan.paginasImagen.map((p) => p.fisica)).toEqual([1, 2, 3]);
  });

  it('las páginas escaneadas y las de capa mala van por visión; las blancas no', () => {
    const ps = [
      paginaPdf(1, texto),
      paginaPdf(2, '', { clase: 'pdf_escaneado' }),
      paginaPdf(3, ''),
      paginaPdf(4, 'x(cid:3)', { texto: { util: false, calidad: 0.1, origen: 'digital', caracteres: 9, basura: 0.8, palabrasRaras: 1, coberturaImagen: 0 } }),
      paginaPdf(5, texto),
    ];
    const plan = planificar(paquetePdf(ps));
    expect(plan.vias).toEqual(['capa', 'vision', 'capa', 'vision', 'capa']);
    expect(plan.pliegos.map((p) => [p.desde, p.hasta, p.motivo])).toEqual([[2, 2, 'sin_capa'], [4, 4, 'capa_mala']]);
  });

  it('si más de la mitad no tiene capa, se lee todo con visión', () => {
    const ps = [paginaPdf(1, texto), ...[2, 3, 4].map((f) => paginaPdf(f, '', { clase: 'pdf_escaneado' }))];
    const plan = planificar(paquetePdf(ps), { paginasPorPliego: 10 });
    expect(plan.vias.every((v) => v === 'vision')).toBe(true);
    expect(plan.pliegos).toHaveLength(1);
  });

  it('digital: vision manda todo al lector', () => {
    const plan = planificar(paquetePdf([1, 2].map((f) => paginaPdf(f, texto))), { digital: 'vision' });
    expect(plan.pliegos).toEqual([{ id: 0, desde: 1, hasta: 2, envio: 'pdf', motivo: 'todo_vision' }]);
  });
});

describe('cortarPliegos', () => {
  it('reparte en tamaños parejos', () => {
    const f = Array.from({ length: 13 }, (_, i) => i + 1);
    const ps = cortarPliegos(f, f.map(() => 'sin_capa' as const), 6, 'pdf');
    expect(ps.map((p) => p.hasta - p.desde + 1)).toEqual([5, 5, 3]);
    expect(ps[0]?.desde).toBe(1);
    expect(ps.at(-1)?.hasta).toBe(13);
  });
  it('no junta páginas no consecutivas', () => {
    const ps = cortarPliegos([1, 2, 3, 4], ['sin_capa', null, 'sin_capa', 'sin_capa'], 6, 'imagenes');
    expect(ps.map((p) => [p.desde, p.hasta])).toEqual([[1, 1], [3, 4]]);
  });
});

describe('capa de OCR ajeno', () => {
  it('un PDF de Paper Capture se relee entero con visión (menos las páginas en blanco)', () => {
    const ps = [paginaPdf(1, texto), paginaPdf(2, ''), paginaPdf(3, texto)];
    const plan = planificar(paquetePdf(ps, { metadatos: { productor: 'Adobe Acrobat 10.1.7 Paper Capture Plug-in with ClearScan' } }));
    expect(plan.vias).toEqual(['vision', 'capa', 'vision']);
    expect(plan.pliegos.every((p) => p.motivo === 'capa_ocr')).toBe(true);
  });
  it('las letras espaciadas van por visión', () => {
    const plan = planificar(paquetePdf([paginaPdf(1, 'T H E D I S C A R D E D I M A G E by C. S. L E W I S')]));
    expect(plan.vias).toEqual(['vision']);
  });
});

describe('limpieza de la capa', () => {
  it('quita el adorno repetido y pone rayas de diálogo', async () => {
    const { prefijoBasura, limpiarUnidad } = await import('../src/pasos/capa.js');
    const ps = Array.from({ length: 4 }, (_, i) => paginaPdf(i + 1, 'OO −¿Cuándo empiezas, Johnny?\n\nOO −No sé. Hoy, creo, ¿eh, Dé?\n\nOO −No, pasado mañana −dijo ella.'));
    const b = prefijoBasura(ps);
    expect(b).toBe('OO');
    const u = limpiarUnidad({ orden: 0, fisica: 1, texto: 'OO −¿Cuándo empiezas, Johnny?\n\nOO −No, pasado mañana −dijo ella.', notas: [], cabecera: '', pie: '', folioVisto: null, titulos: [], figuras: [], vacia: false, lector: 'c', confianza: 1 }, b);
    expect(u.texto).toBe('—¿Cuándo empiezas, Johnny?\n\n—No, pasado mañana —dijo ella.');
  });
});
