/**
 * La capa de comprensión (SPDF 4.2) de ida y vuelta contra la base real: el contrato
 * que comparten la ingesta, la capa transmedia, Investigar y la exportación.
 */
import type { Alineacion, Aparicion, Documento, Evidencia, Ficha, Relacion, Segmento } from '@scholaris/nucleo';
import { describe, expect, it } from 'vitest';
import { crearSpdf } from '../src/archivo.js';
import {
  aparicionesEnTiempo, borrarComprension, buscarFichas, correspondencias, escribirAlineaciones, escribirApariciones, escribirFichas, escribirRelaciones,
  escribirSegmentos, leerAlineaciones, leerApariciones, leerFichas, leerRelaciones, leerSegmentos, segmentosEnTiempo,
} from '../src/comprension.js';
import { escribirDocumento, escribirUnidades } from '../src/repositorio.js';

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
  it('segmentos, fichas, apariciones, relaciones y alineaciones', async () => {
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

    // Dónde aparece Diego (entidad del grafo de la biblioteca) en las dos obras, y Lezama en la película.
    const apariciones: Aparicion[] = [
      { id: 'm1', entidad: 'ent-diego', documento: 'cuento', ancla: coppeliaCuento.ancla, forma: 'Diego', rol: 'nombrado', confianza: 1 },
      { id: 'm2', entidad: 'ent-diego', documento: 'pelicula', segmento: 'es1', ancla: coppeliaPelicula.ancla, forma: 'Diego', rol: 'visible', confianza: 0.97 },
      { id: 'm3', entidad: 'ent-lezama', documento: 'pelicula', segmento: 'es2', ancla: { tipo: 'tiempo', t0: 600, t1: 612 }, forma: 'Lezama', rol: 'nombrado', confianza: 1 },
    ];
    await escribirApariciones(sql, apariciones);
    expect((await leerApariciones(sql, { entidad: 'ent-diego' })).map((m) => m.documento)).toEqual(['cuento', 'pelicula']);
    expect((await leerApariciones(sql, { entidad: 'ent-diego', documento: 'pelicula' }))[0]?.ancla).toMatchObject({ instante: 421, region: { w: 0.3 } });
    expect((await aparicionesEnTiempo(sql, 'pelicula', 400, 620)).map((m) => m.id)).toEqual(['m2', 'm3']);

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

    // Rehacer la comprensión de la película: fuera lo suyo, la biblioteca se queda.
    await borrarComprension(sql, 'pelicula');
    expect(await leerSegmentos(sql, 'pelicula')).toEqual([]);
    expect(await leerFichas(sql, { documento: 'pelicula' })).toEqual([]);
    expect(await leerApariciones(sql, { documento: 'pelicula' })).toEqual([]);
    expect(await leerApariciones(sql, { documento: 'cuento' })).toHaveLength(1);
    expect(await leerAlineaciones(sql, { relacion: 'r1' })).toEqual([]);
    expect(await leerRelaciones(sql, 'pelicula')).toHaveLength(1);
    a.cerrar();
  });
});

describe('comprensión: correspondencias', () => {
  it('lo que corresponde a un párrafo en la otra obra, con su texto literal (original y traducción)', async () => {
    const { sql } = await crearSpdf();
    await escribirDocumento(sql, base('es', 'pdf', 'Marianela'));
    await escribirDocumento(sql, base('en', 'pdf', 'Marianela'));
    // Dominio público (Pérez Galdós, 1878) y una traducción inglesa de prueba.
    const es = 'Se puso el sol.\n\nEl viajero siguió adelante en su camino.';
    const en = 'The sun went down.\n\nThe traveller went on his way.';
    await escribirUnidades(sql, [
      { id: 'es:u0', documento: 'es', orden: 0, texto: es, lector: 'prueba', confianza: 1, ancla: pagina(1, '1') },
      { id: 'en:u0', documento: 'en', orden: 0, texto: en, lector: 'prueba', confianza: 1, ancla: pagina(1, '1') },
    ]);
    await escribirRelaciones(sql, [{ id: 'r', origen: 'en', destino: 'es', tipo: 'traduccion_de', evidencias: [], confianza: 1, fuente: 'usuario', creada: '2026-11-04' }]);
    await escribirAlineaciones(sql, [
      { id: 'r:p0', relacion: 'r', orden: 0, tipo: 'traducido', a: { documento: 'en', ancla: { ...pagina(1, '1'), caracteres: [0, 18] } }, b: { documento: 'es', ancla: { ...pagina(1, '1'), caracteres: [0, 15] } }, nota: '', confianza: 1 },
      { id: 'r:p1', relacion: 'r', orden: 1, tipo: 'traducido', a: { documento: 'en', ancla: { ...pagina(1, '1'), caracteres: [20, 50] } }, b: { documento: 'es', ancla: { ...pagina(1, '1'), caracteres: [17, 56] } }, nota: '', confianza: 1 },
    ]);
    const [c] = await correspondencias(sql, 'es', { ...pagina(1, '1'), caracteres: [20, 30] });
    expect(c!.alineacion.id).toBe('r:p1');
    expect(c!.textoOtro).toBe('The traveller went on his way.');
    expect((await correspondencias(sql, 'en', { ...pagina(1, '1'), caracteres: [0, 5] }))[0]!.textoOtro).toBe('Se puso el sol.');
    expect(await correspondencias(sql, 'es', { ...pagina(2, '2') })).toEqual([]);
  });
});
