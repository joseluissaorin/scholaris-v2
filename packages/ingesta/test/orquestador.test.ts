import { describe, expect, it } from 'vitest';
import type { Progreso } from '@scholaris/nucleo';
import { ejecutarIngesta } from '../src/orquestador.js';
import { inteligenciaFalsa, lectorFalso, paginaLeida, paginaPdf, paquetePdf, redactorFalso, SqlFalso, fuenteFalsa } from './fakes.js';

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
    const redactor = redactorFalso((t) => (t.includes('Principio del documento')
      ? { titulo: 'The Discarded Image', autores: [{ nombre: 'C. S.', apellidos: 'Lewis' }], idioma: 'en', tipoCSL: 'book', anio: 1964 }
      : { contextos: Array.from({ length: 40 }, (_, i) => ({ n: i + 1, contexto: `Contexto ${i + 1}` })) }));
    const sql = new SqlFalso();
    const progreso: Progreso[] = [];
    const r = await ejecutarIngesta(paquete, { inteligencia: inteligenciaFalsa({ lector, redactor }), fuente: fuenteFalsa, sql }, { sinVerificacion: true, onProgreso: (p) => progreso.push(p) });

    expect(r.unidades).toHaveLength(5);
    expect(r.unidades[0]?.lector).toBe('vision');
    expect(r.unidades[1]?.lector).toBe('capa-pdf');
    expect(r.unidades.map((u) => (u.ancla?.tipo === 'pagina' ? u.ancla.impresa : '?'))).toEqual(['9', '10', '11', '12', '13']);
    expect(r.documento.metadatos.titulo).toBe('The Discarded Image');
    expect(r.secciones.map((s) => s.titulo)).toEqual(['I. The Medieval Situation', 'II. Selected Materials']);
    expect(r.fragmentos.length).toBeGreaterThan(3);
    expect(r.fragmentos.every((f) => f.contexto.startsWith('Contexto'))).toBe(true);
    expect(r.vectores['falso@4']).toBe(r.fragmentos.length + 5);
    expect(sql.filas.fragmentos?.length).toBe(r.fragmentos.length);
    expect(sql.filas.unidades?.length).toBe(5);
    expect(sql.filas.vectores?.length).toBe(r.fragmentos.length + 5);
    // Los vectores de página llevan el id de la unidad escrita.
    const idsUnidad = new Set(sql.filas.unidades?.map((f) => f[0]));
    expect(sql.filas.vectores?.filter((v) => v[0] === 'unidad').every((v) => idsUnidad.has(v[1]))).toBe(true);
    expect(progreso.at(-1)?.fase).toBe('listo');
    expect(progreso.some((p) => (p.unidadesListas ?? 0) > 0 && p.fase === 'lectura')).toBe(true);
  });
});
