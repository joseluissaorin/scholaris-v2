import { describe, expect, it } from 'vitest';
import { escribirAlineaciones, escribirRelaciones } from '@scholaris/spdf';
import type { ContextoHerramientas, Herramienta } from '../src/contexto.js';
import { HERRAMIENTAS_LECTURA } from '../src/herramientas.js';
import { HERRAMIENTAS_MEMORIA } from '../src/memoria.js';
import { Contabilidad } from '../src/modelo.js';
import { CuadernoPruebas, fichaDocumento, type Prueba } from '../src/pruebas.js';
import { CUENTO, crearSQL, ModeloGuion, PELICULA, puertos, sembrar } from './apoyo.js';

const h = (nombre: string): Herramienta => [...HERRAMIENTAS_LECTURA, ...HERRAMIENTAS_MEMORIA].find((x) => x.declaracion.nombre === nombre)!;

async function contexto() {
  const sql = crearSQL();
  await sembrar(sql);
  const p = puertos(sql, new ModeloGuion(() => ({ texto: '' })));
  const { porId } = await p.buscador.estanteria.documentos();
  const nuevas: Prueba[] = [];
  const ctx: ContextoHerramientas = {
    p, pruebas: new CuadernoPruebas(), docs: porId, fichas: new Map([...porId.values()].map((d) => [d.id, fichaDocumento(d)])), ambito: null, filtros: {}, notas: [],
    cuentas: new Contabilidad(), segundosVer: 300, resultadosPorBusqueda: 6, idioma: 'es', alPrueba: (x) => nuevas.push(x), avisos: [],
  };
  return { sql, ctx, nuevas };
}

describe('herramientas de lectura', () => {
  it('leer por páginas físicas: cada página es una prueba con su texto entero como ámbito', async () => {
    const { ctx, nuevas } = await contexto();
    const r = await h('leer').ejecutar({ documento: 'El lobo, el bosque', paginas: { desde: 2, hasta: 3 } }, ctx);
    expect(r.pruebas).toEqual(['P1', 'P2']);
    expect(r.texto).toContain('p. 4 (pág. física 2)');
    expect(nuevas[0]!.ambito?.texto).toContain('había pedido fresa');
    expect(nuevas[0]!.imagen).toBe('paginas/0002.jpg');
  });

  it('leer un tramo de tiempo, con los fotogramas descritos', async () => {
    const { ctx } = await contexto();
    const r = await h('leer').ejecutar({ documento: PELICULA, tiempo: { desde: '9:50', hasta: '10:45' }, fotogramas: true }, ctx);
    expect(r.texto).toContain('Me encanta la fresa');
    expect(r.texto).toContain('fotograma 10:00');
    const fotograma = ctx.pruebas.todas().find((x) => x.evidencia.figura === 'fig1');
    expect(fotograma?.evidencia).toMatchObject({ modo: 'imagen', ancla: { tipo: 'tiempo', t0: 600, instante: 600 } });
  });

  it('un documento que no existe es un error que el modelo puede leer', async () => {
    const { ctx } = await contexto();
    const r = await h('leer').ejecutar({ documento: 'Rayuela', paginas: { desde: 1, hasta: 1 } }, ctx);
    expect(r.error).toBeDefined();
    expect(r.texto).toMatch(/^ERROR: No conozco ese documento\. Disponibles: «El lobo/);
  });

  it('mapa: ficha, recorrido sin estructura, fotogramas y entidades', async () => {
    const { ctx } = await contexto();
    const r = await h('mapa').ejecutar({ documento: PELICULA }, ctx);
    expect(r.texto).toContain('«Fresa y chocolate» (Gutiérrez Alea y Tabío, 1993)');
    expect(r.texto).toContain('Recorrido (3 unidades)');
    expect(r.texto).toContain('Fotogramas descritos (1');
    expect(r.texto).toContain('Entidades principales: Diego');
  });

  it('buscar en la capa literal con filtro de tramo de tiempo', async () => {
    const { ctx } = await contexto();
    const r = await h('buscar').ejecutar({ consulta: 'fresa', documentos: [PELICULA], tiempo: { desde: '1:45:00', hasta: '1:47:00' } }, ctx);
    expect(r.pruebas.length).toBe(1);
    expect(r.texto).toContain('Una fresa');
  });

  it('entidad: menciones de cada obra como pruebas y vecinos', async () => {
    const { ctx } = await contexto();
    const r = await h('entidad').ejecutar({ nombre: 'diego' }, ctx);
    expect(r.texto).toMatch(/^Diego \(persona\)/);
    expect(r.pruebas).toHaveLength(2);
    expect(ctx.pruebas.todas().map((x) => x.evidencia.documento).sort()).toEqual([CUENTO, PELICULA].sort());
    const vacia = await h('entidad').ejecutar({ nombre: 'Lezama' }, ctx);
    expect(vacia.resumen).toBe('no está en el grafo');
  });

  it('relaciones: las de la comprensión y las obras con entidades comunes', async () => {
    const { sql, ctx } = await contexto();
    await escribirRelaciones(sql, [{ id: 'r1', origen: PELICULA, destino: CUENTO, tipo: 'adaptacion_de', nota: 'La película adapta el cuento.', evidencias: [], confianza: 0.95, fuente: 'wikidata', creada: '2026-11-04' }]);
    const r = await h('relaciones').ejecutar({ documento: PELICULA }, ctx);
    expect(r.texto).toContain('adaptacion_de → «El lobo, el bosque y el hombre nuevo»');
    expect(r.texto).toContain('Comparte entidades con: «El lobo');
  });

  it('alinear: las alineaciones calculadas o, si no hay, lo más parecido de la otra obra', async () => {
    const { sql, ctx } = await contexto();
    const sin = await h('alinear').ejecutar({ documento: CUENTO, paginas: { desde: 2, hasta: 2 }, con: PELICULA }, ctx);
    expect(sin.texto).toMatch(/^No hay alineación calculada/);
    expect(sin.pruebas.length).toBeGreaterThan(0);
    await escribirRelaciones(sql, [{ id: 'r1', origen: PELICULA, destino: CUENTO, tipo: 'adaptacion_de', evidencias: [], confianza: 0.95, fuente: 'wikidata', creada: '2026-11-04' }]);
    await escribirAlineaciones(sql, [{
      id: 'a1', relacion: 'r1', orden: 0, tipo: 'transformado', nota: 'El encuentro del cuento se vuelve escena con la fresa en primer plano.',
      a: { documento: CUENTO, ancla: { tipo: 'pagina', fisica: 2, impresa: '4', romana: false, origen: 'leido', confianza: 1 } },
      b: { documento: PELICULA, ancla: { tipo: 'tiempo', t0: 594.6, t1: 641.8 } }, confianza: 0.8,
    }]);
    const con = await h('alinear').ejecutar({ documento: CUENTO, paginas: { desde: 2, hasta: 2 } }, ctx);
    expect(con.texto).toMatch(/^transformado: /);
    expect(con.pruebas).toHaveLength(2);
  });

  it('anotar guarda hallazgos con pruebas que existen', async () => {
    const { ctx } = await contexto();
    await h('leer').ejecutar({ documento: CUENTO, paginas: { desde: 2, hasta: 2 } }, ctx);
    await h('anotar').ejecutar({ tipo: 'hipotesis', texto: 'La fresa es una seña.', pruebas: ['[P1]', 'P77'] }, ctx);
    expect(ctx.notas).toEqual([{ tipo: 'hipotesis', texto: 'La fresa es una seña.', pruebas: ['P1'] }]);
  });
});
