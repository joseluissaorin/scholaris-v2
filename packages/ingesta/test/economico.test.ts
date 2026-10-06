import { describe, expect, it } from 'vitest';
import type { PaginaLeida } from '@scholaris/nucleo';
import { planificar } from '../src/planificar.js';
import { ejecutarIngesta } from '../src/orquestador.js';
import type { LotesLectura } from '../src/tipos.js';
import { baseReal, fuenteFalsa, inteligenciaFalsa, lectorFalso, paginaLeida, paginaPdf, paquetePdf } from './fakes.js';

const texto = Array.from({ length: 8 }, (_, i) => `Sentence number ${i} about the ${['moon', 'sun', 'stars', 'planets', 'heavens', 'earth', 'sea', 'air'][i]} in medieval cosmology.`).join(' ');
const ocr = (calidad: number) => ({ util: true, calidad, origen: 'ocr' as const, caracteres: 400, basura: 0, palabrasRaras: 0, coberturaImagen: 1 });

describe('modo económico', () => {
  it('capa de OCR buena: se aprovecha sin llamadas; mala: fácil (lector barato) o difícil (lotes)', () => {
    const ps = [
      paginaPdf(1, texto, { texto: ocr(0.95) }),
      paginaPdf(2, texto, { texto: ocr(0.7) }),
      paginaPdf(3, '', { clase: 'pdf_escaneado' }),
    ];
    const paquete = paquetePdf(ps, { metadatos: { productor: 'ABBYY FineReader' } });
    const rapido = planificar(paquete);
    expect(rapido.vias).toEqual(['vision', 'vision', 'vision']);
    const eco = planificar(paquete, { modo: 'economico' });
    expect(eco.vias).toEqual(['capa', 'vision', 'vision']);
    expect(eco.pliegos.map((p) => [p.desde, p.hasta, p.dificultad])).toEqual([[2, 2, 'facil'], [3, 3, 'dificil']]);
  });

  it('el lector barato lee lo fácil, la API por lotes lo difícil y el lector normal no se usa', async () => {
    const ps = [paginaPdf(1, texto, { texto: ocr(0.7) }), paginaPdf(2, '', { clase: 'pdf_escaneado' }), paginaPdf(3, '', { clase: 'pdf_escaneado' })];
    const paquete = paquetePdf(ps, { metadatos: { productor: 'ABBYY FineReader' } });
    const barato = lectorFalso('workers-ai', (d, h) => Array.from({ length: h - d + 1 }, (_, i) => paginaLeida(d + i, `barato ${d + i}. ${texto}`)));
    const caro = lectorFalso('gemini', (d, h) => Array.from({ length: h - d + 1 }, (_, i) => paginaLeida(d + i, `caro ${d + i}. ${texto}`)));
    const enviados: string[] = [];
    let consultas = 0;
    const lotes: LotesLectura = {
      nombre: 'gemini-lotes',
      async enviar(ps) { enviados.push(...ps.map((p) => p.clave)); return 'lote-1'; },
      async consultar() {
        consultas++;
        if (consultas < 2) return { estado: 'pendiente' };
        const resultados: Record<string, PaginaLeida[]> = {};
        for (const k of enviados) { const [d, h] = k.split('-').map(Number); resultados[k] = Array.from({ length: h! - d! + 1 }, (_, i) => paginaLeida(d! + i, `lote ${d! + i}. ${texto}`)); }
        return { estado: 'listo', resultados };
      },
    };
    const { sql } = await baseReal();
    const r = await ejecutarIngesta(paquete, { inteligencia: inteligenciaFalsa({ lector: caro }), lectorEconomico: barato, lotes, fuente: fuenteFalsa, sql }, { modo: 'economico', sinVerificacion: true, esperaLote: { cadaMs: 1 } });
    expect(enviados).toEqual(['2-3']);
    expect(consultas).toBe(2);
    expect(r.unidades.map((u) => u.texto.split(' ')[0])).toEqual(['barato', 'lote', 'lote']);
    expect(caro.llamadas).toEqual([]);
  });
});
