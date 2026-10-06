import { describe, expect, it } from 'vitest';
import type { Progreso } from '@scholaris/nucleo';
import { ejecutarIngesta } from '../src/orquestador.js';
import { baseReal, inteligenciaFalsa, lectorFalso, paginaLeida, paginaPdf, paquetePdf, redactorFalso, fuenteFalsa } from './fakes.js';

const texto = (n: number) => Array.from({ length: 30 }, (_, i) => `Sentence ${i} on page ${n} about the medieval model of the universe.`).join(' ');

describe('ejecutarIngesta', () => {
  it('PDF mixto: capa + visión, folios, metadatos, contexto, vectores e indexado', async () => {
    const paginas = [
      paginaPdf(1, '', { clase: 'pdf_escaneado' }),
      ...[2, 3, 4, 5].map((f) => paginaPdf(f, `${f === 2 ? 'I. THE MEDIEVAL SITUATION\n\n' : ''}${texto(f)}`, { candidatosFolio: [{ texto: String(f + 8), zona: 'pie', lado: 'centro', romano: false, valor: f + 8, region: { x: 0.5, y: 0.95, w: 0.05, h: 0.02 } }] })),
    ];
    const paquete = paquetePdf(paginas, { metadatos: { titulo: 'The_Discarded_Image_z_library_sk' } });
    paquete.contenido = { ...paquete.contenido, esquema: [{ titulo: 'I. The Medieval Situation', nivel: 1, fisica: 2 }, { titulo: 'II. Selected Materials', nivel: 1, fisica: 4 }] } as typeof paquete.contenido;
    const lector = lectorFalso('vision', (d, h) => Array.from({ length: h - d + 1 }, (_, i) => paginaLeida(d + i, '# THE DISCARDED IMAGE\n\nC. S. LEWIS', { idioma: 'en' })));
    const redactor = redactorFalso((t) => (t.includes('Nombre del archivo')
      ? { titulo: 'The Discarded Image', autores: [{ nombre: 'C. S.', apellidos: 'Lewis' }], idioma: 'en', tipoCSL: 'book', anio: 1964 }
      : { contextos: Array.from({ length: 40 }, (_, i) => ({ n: i + 1, contexto: `Contexto ${i + 1}` })) }));
    const { sql, filas } = await baseReal();
    const progreso: Progreso[] = [];
    const r = await ejecutarIngesta(paquete, { inteligencia: inteligenciaFalsa({ lector, redactor }), fuente: fuenteFalsa, sql }, { sinVerificacion: true, documentoId: 'd1', onProgreso: (p) => progreso.push(p) });

    expect(r.unidades).toHaveLength(5);
    expect(r.unidades[0]?.lector).toBe('vision');
    expect(r.unidades[1]?.lector).toBe('capa-pdf');
    expect(r.unidades.map((u) => (u.ancla?.tipo === 'pagina' ? u.ancla.impresa : '?'))).toEqual([null, '10', '11', '12', '13']);
    expect(r.documento.metadatos.titulo).toBe('The Discarded Image');
    expect(r.documento.estado).toBe('listo');
    expect(r.secciones.map((s) => s.titulo)).toEqual(['I. The Medieval Situation', 'II. Selected Materials']);
    expect(r.fragmentos.length).toBeGreaterThan(3);
    expect(r.fragmentos.every((f) => f.contexto.startsWith('Contexto'))).toBe(true);
    // Vectores: un fragmento, uno; y la imagen de la página escaneada (las digitales de texto, no).
    expect(r.vectores['falso@4']).toBe(r.fragmentos.length + 1);
    const enBase = await filas<{ n: number }>('SELECT count(*) AS n FROM fragmentos WHERE documento = ?', 'd1');
    expect(Number(enBase[0]?.n)).toBe(r.fragmentos.length);
    expect(Number((await filas<{ n: number }>('SELECT count(*) AS n FROM unidades WHERE documento = ?', 'd1'))[0]?.n)).toBe(5);
    // La búsqueda léxica encuentra el texto.
    expect((await filas('SELECT rowid FROM fragmentos_fts WHERE fragmentos_fts MATCH ?', 'medieval')).length).toBeGreaterThan(0);
    // Sin estado de trabajo al terminar.
    expect((await filas('SELECT clave FROM blobs')).length).toBe(0);
    expect(progreso.at(-1)?.fase).toBe('listo');
    // Legible antes que buscable, y buscable antes de «listo».
    const primeraBuscable = progreso.findIndex((p) => (p.unidadesBuscables ?? 0) > 0);
    expect(primeraBuscable).toBeGreaterThan(-1);
    expect(primeraBuscable).toBeLessThan(progreso.length - 1);
    expect(progreso.some((p) => (p.unidadesListas ?? 0) > 0 && p.fase === 'lectura')).toBe(true);
  });
});

describe('vectores', () => {
  it('un fallo al guardar se propaga (no se da por bueno un documento a medio indexar)', async () => {
    const { vectorizar } = await import('../src/pasos/vectores.js');
    const { embebedorFalso, fuenteFalsa } = await import('./fakes.js');
    await expect(vectorizar([{ objetivo: 'fragmento', id: 'a', texto: 'x' }], embebedorFalso, fuenteFalsa, async () => { throw new Error('sqlite-vec: NULL'); })).rejects.toThrow('NULL');
  });
  it('un fallo del embebedor se cuenta y se sigue', async () => {
    const { vectorizar } = await import('../src/pasos/vectores.js');
    const { embebedorFalso, fuenteFalsa } = await import('./fakes.js');
    const malo = { ...embebedorFalso, vectorizar: async () => { throw new Error('500'); } };
    const p = await vectorizar([{ objetivo: 'fragmento', id: 'a', texto: 'x' }], malo, fuenteFalsa, async () => {}, { concurrencia: 1 });
    expect(p.detalle?.fallidos).toBe(1);
  }, 30000);
});
