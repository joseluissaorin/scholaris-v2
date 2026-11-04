/**
 * La capa de comprensión (SPDF 4.2) de ida y vuelta contra la base real: el contrato
 * que comparten la ingesta, la capa transmedia, Investigar y la exportación.
 */
import type { Alineacion, Documento, Entidad, Evidencia, Ficha, Mencion, Recuerdo, Relacion, Segmento } from '@scholaris/nucleo';
import { describe, expect, it } from 'vitest';
import { crearSpdf } from '../src/archivo.js';
import {
  borrarComprension, borrarEntidadesHuerfanas, buscarEntidades, buscarFichas, buscarRecuerdos, entidadesDeDocumento, entidadPorQid,
  escribirAlineaciones, escribirEntidades, escribirFichas, escribirMenciones, escribirRecuerdos, escribirRelaciones, escribirSegmentos,
  leerAlineaciones, leerFichas, leerMenciones, leerRecuerdos, leerRelaciones, leerSegmentos, segmentosEnTiempo,
} from '../src/comprension.js';
import { escribirDocumento } from '../src/repositorio.js';

const base = (id: string, tipo: Documento['tipo'], titulo: string): Documento => ({
  id, tipo, metadatos: { titulo, autores: [], idioma: 'es' }, estado: 'listo', huella: id.repeat(64).slice(0, 64), original: '',
  mime: tipo === 'video' ? 'video/mp4' : 'application/pdf', bytes: 1, unidades: 1, creado: '2026-11-04T00:00:00.000Z', actualizado: '2026-11-04T00:00:00.000Z', bibliotecas: [],
});

const pagina = (fisica: number, impresa: string) => ({ tipo: 'pagina' as const, fisica, impresa, romana: false, origen: 'leido' as const, confianza: 1 });

const coppeliaCuento: Evidencia = {
  documento: 'cuento', modo: 'texto', unidad: 'cuento:u1',
  ancla: { ...pagina(2, '5'), caracteres: [0, 112], region: { x: 0.52, y: 0.08, w: 0.44, h: 0.07 } },
  cita: 'Ismael y yo salimos del bar y nos despedimos',
};
const coppeliaPelicula: Evidencia = {
  documento: 'pelicula', modo: 'video', ancla: { tipo: 'tiempo', t0: 410, t1: 455, region: { x: 0.1, y: 0.2, w: 0.3, h: 0.6 }, instante: 421 },
  cita: 'Diego se sienta frente a David con su helado de fresa',
};

describe('comprensión: repositorio', () => {
  it('segmentos, fichas, entidades, menciones, relaciones, alineaciones y memoria', async () => {
    const a = await crearSpdf();
    const sql = a.sql;
    await escribirDocumento(sql, base('cuento', 'pdf_escaneado', 'El lobo, el bosque y el hombre nuevo'));
    await escribirDocumento(sql, base('pelicula', 'video', 'Fresa y chocolate'));

    // Estructura de la película: una secuencia con dos escenas.
    const segmentos: Segmento[] = [
      { id: 'sq1', documento: 'pelicula', padre: null, nivel: 1, orden: 0, tipo: 'secuencia', titulo: 'Coppelia', ancla: { tipo: 'tiempo', t0: 400, t1: 700 }, unidadDesde: 'pelicula:u10', unidadHasta: 'pelicula:u15', origen: 'modelo', confianza: 0.9 },
      { id: 'es1', documento: 'pelicula', padre: 'sq1', nivel: 2, orden: 1, tipo: 'escena', titulo: 'El encuentro', resumen: 'Diego aborda a David en la heladería', ancla: { tipo: 'tiempo', t0: 400, t1: 520 }, unidadDesde: 'pelicula:u10', unidadHasta: 'pelicula:u12', origen: 'modelo', confianza: 0.95 },
      { id: 'es2', documento: 'pelicula', padre: 'sq1', nivel: 2, orden: 2, tipo: 'escena', titulo: 'La invitación', ancla: { tipo: 'tiempo', t0: 520, t1: 700 }, unidadDesde: 'pelicula:u12', unidadHasta: 'pelicula:u15', origen: 'modelo', confianza: 0.9 },
    ];
    await escribirSegmentos(sql, segmentos);
    expect((await leerSegmentos(sql, 'pelicula')).map((s) => s.id)).toEqual(['sq1', 'es1', 'es2']);
    expect((await leerSegmentos(sql, 'pelicula', { tipo: 'escena' })).map((s) => s.titulo)).toEqual(['El encuentro', 'La invitación']);
    expect((await segmentosEnTiempo(sql, 'pelicula', 500, 510)).map((s) => s.id)).toEqual(['sq1', 'es1']);

    // Una ficha de escena con evidencia material (región e instante).
    const ficha: Ficha = {
      id: 'fi1', documento: 'pelicula', objetivo: 'segmento', objetivoId: 'es1', lente: 'cine', clase: 'escena', idioma: 'es',
      texto: 'Plano medio de David con el helado de chocolate; Diego entra por la izquierda y ocupa el encuadre.',
      datos: { escala: 'plano medio', dominaEncuadre: 'Diego' }, evidencias: [coppeliaPelicula], modelo: 'gemini-4-argon', version: 'cine@1', creada: '2026-11-04T00:00:00.000Z',
    };
    await escribirFichas(sql, [ficha]);
    await escribirFichas(sql, [{ ...ficha, texto: `${ficha.texto} La cámara se queda con David.` }]);
    const [leida] = await leerFichas(sql, { documento: 'pelicula', clase: 'escena' });
    expect(leida?.texto).toMatch(/se queda con David/);
    expect(leida?.evidencias[0]?.ancla).toMatchObject({ region: { x: 0.1 }, instante: 421 });
    expect((await buscarFichas(sql, 'encuadre helado')).map((f) => f.id)).toEqual(['fi1']);

    // La misma entidad en las dos obras.
    const diego: Entidad = { id: 'ent-diego', tipo: 'personaje', nombre: 'Diego', alias: ['el maricón', 'Diego'], qid: 'Q999', datos: { interpretadoPor: 'Jorge Perugorría' } };
    const lezama: Entidad = { id: 'ent-lezama', tipo: 'persona', nombre: 'José Lezama Lima', alias: ['Lezama'], qid: 'Q370941' };
    const huerfana: Entidad = { id: 'ent-nada', tipo: 'objeto', nombre: 'Taza de Sèvres', alias: [] };
    await escribirEntidades(sql, [diego, lezama, huerfana]);
    const menciones: Mencion[] = [
      { id: 'm1', entidad: 'ent-diego', documento: 'cuento', ancla: coppeliaCuento.ancla, forma: 'Diego', rol: 'nombrado', confianza: 1 },
      { id: 'm2', entidad: 'ent-diego', documento: 'pelicula', segmento: 'es1', ancla: coppeliaPelicula.ancla, forma: 'Diego', rol: 'visible', confianza: 0.97 },
      { id: 'm3', entidad: 'ent-lezama', documento: 'pelicula', segmento: 'es2', ancla: { tipo: 'tiempo', t0: 600, t1: 612 }, forma: 'Lezama', rol: 'nombrado', confianza: 1 },
    ];
    await escribirMenciones(sql, menciones);
    expect((await leerMenciones(sql, { entidad: 'ent-diego' })).map((m) => m.documento)).toEqual(['cuento', 'pelicula']);
    expect((await entidadPorQid(sql, 'Q370941'))?.nombre).toBe('José Lezama Lima');
    expect((await buscarEntidades(sql, 'Lezama')).map((e) => e.id)).toEqual(['ent-lezama']);
    expect((await entidadesDeDocumento(sql, 'pelicula')).map((e) => [e.id, e.menciones])).toEqual([['ent-diego', 1], ['ent-lezama', 1]]);

    // La película adapta el cuento; la escena de Coppelia se alinea con su pasaje.
    const relacion: Relacion = { id: 'r1', origen: 'pelicula', destino: 'cuento', tipo: 'adaptacion_de', evidencias: [], confianza: 0.99, fuente: 'wikidata', creada: '2026-11-04T00:00:00.000Z' };
    await escribirRelaciones(sql, [relacion]);
    const alineaciones: Alineacion[] = [
      { id: 'al1', relacion: 'r1', orden: 0, tipo: 'transformado', a: { documento: 'pelicula', ancla: coppeliaPelicula.ancla, segmento: 'es1' }, b: { documento: 'cuento', ancla: coppeliaCuento.ancla }, nota: 'El narrador del cuento cuenta el encuentro; la película lo muestra.', confianza: 0.9 },
      { id: 'al2', relacion: 'r1', orden: 1, tipo: 'anadido', a: { documento: 'pelicula', ancla: { tipo: 'tiempo', t0: 3000, t1: 3200 } }, nota: 'Nancy no está en el cuento.', confianza: 0.8 },
    ];
    await escribirAlineaciones(sql, alineaciones);
    expect((await leerRelaciones(sql, 'cuento')).map((r) => r.tipo)).toEqual(['adaptacion_de']);
    const al = await leerAlineaciones(sql, { relacion: 'r1' });
    expect(al.map((x) => x.tipo)).toEqual(['transformado', 'anadido']);
    expect(al[1]?.b).toBeUndefined();
    expect((await leerAlineaciones(sql, { segmento: 'es1' })).map((x) => x.id)).toEqual(['al1']);

    // Memoria de la investigación.
    const pregunta: Recuerdo = { id: 'q1', tipo: 'pregunta', texto: '¿Cómo cambia Coppelia entre el cuento y la película?', evidencias: [], documentos: ['cuento', 'pelicula'], proyecto: 'tfg', fuente: 'investigar', creado: '2026-11-04T10:00:00.000Z' };
    const respuesta: Recuerdo = { id: 'a1', tipo: 'respuesta', texto: 'En el cuento Coppelia es un recuerdo narrado; en la película, un espacio filmado.', evidencias: [coppeliaCuento, coppeliaPelicula], documentos: ['cuento', 'pelicula'], proyecto: 'tfg', fuente: 'investigar', creado: '2026-11-04T10:01:00.000Z', padre: 'q1', fijado: true };
    await escribirRecuerdos(sql, [pregunta, respuesta]);
    expect((await leerRecuerdos(sql, { proyecto: 'tfg' })).map((r) => r.id)).toEqual(['a1', 'q1']);
    expect((await leerRecuerdos(sql, { padre: 'q1' }))[0]?.evidencias).toHaveLength(2);
    expect((await buscarRecuerdos(sql, 'Coppelia filmado')).map((r) => r.id)).toContain('a1');

    // Rehacer la comprensión de la película: fuera lo suyo, la biblioteca se queda.
    await borrarComprension(sql, 'pelicula');
    expect(await leerSegmentos(sql, 'pelicula')).toEqual([]);
    expect(await leerFichas(sql, { documento: 'pelicula' })).toEqual([]);
    expect(await leerMenciones(sql, { documento: 'pelicula' })).toEqual([]);
    expect(await leerAlineaciones(sql, { relacion: 'r1' })).toEqual([]);
    expect(await leerRelaciones(sql, 'pelicula')).toHaveLength(1);
    // Lezama ya no tiene menciones; Diego sigue en el cuento.
    expect((await borrarEntidadesHuerfanas(sql)).sort()).toEqual(['ent-lezama', 'ent-nada']);
    expect((await buscarEntidades(sql, 'Diego')).map((e) => e.id)).toEqual(['ent-diego']);
    a.cerrar();
  });
});
