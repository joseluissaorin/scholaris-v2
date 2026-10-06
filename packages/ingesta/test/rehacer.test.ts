/**
 * «Rehacer no empeora»: fichas parecidas a las de los SPDF migrados desde la v1
 * (sin procedencia) que en producción salieron peor al rehacerlas.
 */
import { describe, expect, it } from 'vitest';
import type { MetadatosDocumento } from '@scholaris/nucleo';
import { esTituloBasura, noEmpeorar, rehacerFicha } from '../src/pasos/metadatos.js';
import type { UnidadLeida } from '../src/tipos.js';
import { redactorFalso } from './fakes.js';

const pagina = (fisica: number, texto: string): UnidadLeida => ({
  orden: fisica - 1, fisica, texto, notas: [], cabecera: '', pie: '', folioVisto: null, titulos: [], figuras: [], vacia: !texto.trim(), lector: 'prueba', confianza: 1,
  ancla: { tipo: 'pagina', fisica, impresa: null, romana: false, origen: 'ninguno', confianza: 0 },
});
const tramo = (n: number, texto: string): UnidadLeida => ({
  orden: n, fisica: n + 1, texto, notas: [], cabecera: '', pie: '', folioVisto: null, titulos: [], figuras: [], vacia: false, lector: 'prueba', confianza: 1, t0: n * 60, t1: n * 60 + 60,
  ancla: { tipo: 'tiempo', t0: n * 60, t1: n * 60 + 60 },
});

async function rehacer(previa: MetadatosDocumento, lectura: Partial<MetadatosDocumento>, unidades: UnidadLeida[], tipo = 'pdf', nombreArchivo = 'original') {
  const r = await rehacerFicha(previa, { tipo, nombreArchivo, unidades }, { redactor: redactorFalso(() => lectura) }, { sinVerificacion: true });
  return r.metadatos;
}

const cuerpo = Array.from({ length: 6 }, (_, i) => pagina(i + 1, `Texto del cuerpo, página ${i + 1}, sin portada ni créditos.`));

describe('rehacer no empeora (casos de producción reconstruidos)', () => {
  it('Iconologia (Ripa, 1593): la clave «original» no es un título; autor y año se conservan', async () => {
    const previa = { titulo: 'Iconologia', autores: [{ nombre: 'Cesare', apellidos: 'Ripa' }], anio: 1593, idioma: 'it' };
    const m = await rehacer(previa, { idioma: 'it' }, cuerpo);
    expect(m).toMatchObject({ titulo: 'Iconologia', anio: 1593, autores: [{ nombre: 'Cesare', apellidos: 'Ripa' }] });
    expect(esTituloBasura('original')).toBe(true);
  });

  it('A fondo con Cela: «Entrevista» no sustituye al título y los autores no se pierden', async () => {
    const previa = { titulo: 'Camilo José Cela', autores: [{ nombre: 'Camilo José', apellidos: 'Cela' }], entrevistadores: [{ nombre: 'Joaquín', apellidos: 'Soler Serrano' }], contenedor: 'A fondo', anio: 1976, tipoCSL: 'broadcast' };
    const m = await rehacer(previa, { titulo: 'Entrevista', autores: [], tipoCSL: 'interview' }, [tramo(0, 'Buenas noches.'), tramo(1, 'Hablamos de literatura.')], 'video');
    expect(m).toMatchObject({ titulo: 'Camilo José Cela', anio: 1976, contenedor: 'A fondo', tipoCSL: 'broadcast' });
    expect(m.autores.map((a) => a.apellidos)).toEqual(['Cela']);
    expect(m.entrevistadores?.map((a) => a.apellidos)).toEqual(['Soler Serrano']);
  });

  it('A fondo con Rulfo y Borges: una lectura con menos autores no los quita', async () => {
    for (const [nombre, apellidos] of [['Juan', 'Rulfo'], ['Jorge Luis', 'Borges']] as const) {
      const previa = { titulo: `${nombre} ${apellidos}`, autores: [{ nombre, apellidos }, { nombre: 'Joaquín', apellidos: 'Soler Serrano' }], anio: 1977 };
      const m = await rehacer(previa, { titulo: 'A fondo', autores: [{ nombre: 'Joaquín', apellidos: 'Soler Serrano' }] }, [tramo(0, 'Buenas noches.')], 'video');
      expect(m.titulo).toBe(`${nombre} ${apellidos}`);
      expect(m.autores.map((a) => a.apellidos)).toContain(apellidos);
    }
  });

  it('Mafalda, El perseguidor y Zhuangzi: sin año en la lectura, el año se queda', async () => {
    for (const previa of [
      { titulo: 'Mafalda', autores: [{ nombre: '', apellidos: 'Quino' }], anio: 1993 },
      { titulo: 'El perseguidor', autores: [{ nombre: 'Julio', apellidos: 'Cortázar' }], anio: 1959 },
      { titulo: 'Zhuangzi', autores: [{ nombre: '', apellidos: 'Zhuangzi' }], anio: 2013, anioOriginal: -300 as unknown as number },
    ]) {
      const m = await rehacer(previa, { titulo: previa.titulo, autores: previa.autores }, cuerpo);
      expect(m.anio).toBe(previa.anio);
    }
  });

  it('Leclercq: una lectura sin autor no borra el autor', async () => {
    const previa = { titulo: 'L’amour des lettres et le désir de Dieu', autores: [{ nombre: 'Jean', apellidos: 'Leclercq' }], anio: 1957, idioma: 'fr' };
    const m = await rehacer(previa, { titulo: 'L’amour des lettres et le désir de Dieu', autores: [], idioma: 'fr' }, cuerpo);
    expect(m.autores).toEqual([{ nombre: 'Jean', apellidos: 'Leclercq' }]);
    expect(m.anio).toBe(1957);
  });
});

describe('noEmpeorar', () => {
  it('una fuente más fiable sí sustituye (y se lleva el subtítulo viejo)', () => {
    const previa = { titulo: 'A fondo', subtitulo: 'Entrevista a Facundo Cabral', autores: [{ nombre: 'Facundo', apellidos: 'Cabral' }], anio: 1977 };
    const nueva = { titulo: 'Facundo Cabral', autores: [{ nombre: 'Facundo', apellidos: 'Cabral' }], anio: 1978, procedencia: { titulo: { fuente: 'rtve' as const, confianza: 0.92 }, anio: { fuente: 'rtve' as const, confianza: 0.95 }, autores: { fuente: 'rtve' as const, confianza: 0.9 } } };
    const m = noEmpeorar(previa, nueva);
    expect(m).toMatchObject({ titulo: 'Facundo Cabral', anio: 1978 });
    expect(m.subtitulo).toBeUndefined();
  });
  it('la lectura (0,8) no gana a un valor sin procedencia; el usuario no se toca nunca', () => {
    const previa = { titulo: 'Vigilar y castigar', autores: [], anio: 2002, anioOriginal: 1976, procedencia: { anioOriginal: { fuente: 'usuario' as const, confianza: 1 } } };
    const nueva = { titulo: 'Vigilar y castigar', autores: [], anio: 2009, anioOriginal: 1975, procedencia: { anio: { fuente: 'lectura' as const, confianza: 0.8 }, anioOriginal: { fuente: 'wikidata' as const, confianza: 0.97 } } };
    const m = noEmpeorar(previa, nueva);
    expect(m).toMatchObject({ anio: 2002, anioOriginal: 1976 });
    expect(m.procedencia?.anioOriginal?.fuente).toBe('usuario');
  });
});

describe('rehacer con otra identidad y canales (preview)', () => {
  const httpFalso = (reglas: Array<[string, unknown]>): import('../src/tipos.js').Http => async (url) => {
    const r = reglas.find(([k]) => decodeURIComponent(url).includes(k));
    if (!r) return { ok: false, status: 404, json: async () => ({}) };
    const v = r[1];
    return { ok: true, status: 200, json: async () => v, text: async () => (typeof v === 'string' ? v : JSON.stringify(v)) } as Awaited<ReturnType<import('../src/tipos.js').Http>>;
  };

  it('«Entrevista a Alberto Cortez» que en realidad es Cabral: el autor falso no sobrevive', async () => {
    const http = httpFalso([
      ['rtve.es/play/videos/a-fondo/', '… https://www.rtve.es/api/programas/73250 …'],
      ['api/programas/73250/videos.json', { page: { totalPages: 1, items: [
        { id: '3127003', title: 'Facundo Cabral', dateOfEmission: '02-07-1978 00:00:00', duration: 3_300_000, htmlUrl: 'https://www.rtve.es/play/videos/a-fondo/facundo-cabral/3127003/', description: '<p>Joaqu&iacute;n Soler Serrano entrevista al cantautor.</p>' },
        { id: '3000001', title: 'Alberto Cortez', dateOfEmission: '11-11-1979 00:00:00', duration: 3_500_000, htmlUrl: 'https://www.rtve.es/play/videos/a-fondo/alberto-cortez/3000001/' },
      ] } }],
      ['wbsearchentities', { search: [{ id: 'Q8183492', label: 'A fondo', description: 'Spanish television show' }] }],
      ['query.wikidata.org', { results: { bindings: [{ item: { value: 'http://www.wikidata.org/entity/Q8183492' }, itemLabel: { value: 'A fondo' }, claseLabel: { value: 'programa de televisión' }, duenoLabel: { value: 'RTVE' }, presLabel: { value: 'Joaquín Soler Serrano' } }] } }],
    ]);
    const previa = { titulo: 'Entrevista a Alberto Cortez', autores: [{ nombre: 'Alberto', apellidos: 'Cortez' }], entrevistadores: [{ nombre: 'Joaquín', apellidos: 'Soler Serrano' }], contenedor: 'A fondo', tipoCSL: 'interview' };
    const unidades = Array.from({ length: 20 }, (_, i) => tramo(i, 'Joaquín Soler Serrano: Facundo Cabral, bienvenido. Cabral, ¿eres un místico? Facundo Cabral: Es inevitable, Joaquín.'));
    const redactor = redactorFalso(() => ({ titulo: 'Entrevista a Alberto Cortez', contenedor: 'A fondo', autores: [{ nombre: 'Alberto', apellidos: 'Cortez' }], tipoCSL: 'interview' }));
    const r = await rehacerFicha(previa, { tipo: 'video', nombreArchivo: 'Entrevista a Alberto Cortez.mp4', duracion: 3219, unidades }, { redactor, http });
    expect(r.metadatos).toMatchObject({ titulo: 'Facundo Cabral', anio: 1978, contenedor: 'A fondo' });
    expect(r.metadatos.autores.map((a) => a.apellidos)).toEqual(['Cabral']);
    expect(r.metadatos.entrevistadores?.map((a) => a.apellidos)).toEqual(['Soler Serrano']);
  });

  it('«Vectors»: sin autor duplicado, sin el canal como apellido y con el canal en editorial', async () => {
    const previa = { titulo: 'Vectors', autores: [{ nombre: '', apellidos: '3Blue1Brown' }], tipoCSL: 'broadcast' };
    const lectura = { titulo: 'Vectors', contenedor: 'Essence of linear algebra', autores: [{ nombre: 'Grant', apellidos: 'Sanderson' }, { nombre: 'Grant Sanderson', apellidos: '(3Blue1Brown)' }] };
    const m = await rehacer(previa, lectura, [tramo(0, 'The fundamental root of it all is the vector.')], 'video', 'vectors.mp4');
    expect(m.autores).toEqual([{ nombre: 'Grant', apellidos: 'Sanderson' }]);
    expect(m.editorial).toBe('3Blue1Brown');
  });
});
