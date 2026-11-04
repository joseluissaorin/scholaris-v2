/**
 * La región de las pruebas de las fichas en la página (docs/COMPRENSION.md,
 * principio 1): la comprensión pide el anclaje material del documento y pone la
 * región a las pruebas de página que solo tenían caracteres. Aquí el anclaje es el
 * de verdad (`anclarMaterial` de la percepción) con un redactor falso que devuelve
 * `box_2d`, imágenes falsas y una caché en memoria.
 */
import type { Documento, Evidencia, Ficha, Redactor, Region, SQL } from '@scholaris/nucleo';
import { aplicarEsquemaFunciones } from '@scholaris/funciones';
import { escribirDocumento, escribirUnidades, leerFichas, type UnidadSpdf } from '@scholaris/spdf';
import { describe, expect, it } from 'vitest';
import {
  anclarMaterial, comprenderDocumento, leerEstadoComprension, leerMaterial, regionesDeFichas,
  type AlmacenTrabajo, type AnclajeMaterialDocumento, type ContextoComprension, type ModeloComprension, type PeticionComprension,
} from '../src/index.js';
import { baseReal, embebedorFalso } from './fakes.js';

const PAGINAS = [
  'Diego me vio en Coppelia comiendo helado de chocolate. Se sentó frente a mí con su helado de fresa y me dijo que tenía libros que yo no podía encontrar en ninguna parte.',
  'Al domingo siguiente fui a la Guarida. Diego me enseñó sus libros prohibidos y una foto de Lezama.',
  'Cuando Diego se fue del país, volví solo a Coppelia y pedí helado de fresa.',
];
const ahora = '2026-11-04T10:00:00.000Z';
const CAJA = [400, 100, 450, 900];
const REGION: Region = { x: 0.1, y: 0.4, w: 0.8, h: 0.05 };

async function cuento(): Promise<{ sql: SQL; cerrar(): void }> {
  const { sql, archivo } = await baseReal();
  await aplicarEsquemaFunciones(sql);
  const doc: Documento = {
    id: 'cuento', tipo: 'pdf_escaneado', metadatos: { titulo: 'El lobo, el bosque y el hombre nuevo', autores: [{ nombre: 'Senel', apellidos: 'Paz' }], anio: 1994, idioma: 'es', tipoCSL: 'book', coleccion: 'Cuento' },
    estado: 'listo', huella: 'c'.padEnd(64, '0'), original: '', mime: 'application/pdf', bytes: 1, unidades: 3, creado: ahora, actualizado: ahora, bibliotecas: [],
  };
  await escribirDocumento(sql, doc);
  await escribirUnidades(sql, PAGINAS.map((texto, i): UnidadSpdf => ({
    id: `cuento:u${i}`, documento: 'cuento', orden: i, texto, lector: 'prueba', confianza: 1,
    ancla: { tipo: 'pagina', fisica: i + 1, impresa: String(i + 5), romana: false, origen: 'leido', confianza: 1 },
  })));
  return { sql, cerrar: () => archivo.cerrar() };
}

/** El modelo de comprensión falso (cada llamada cuesta 0,01 $). */
function modeloFalso(): ModeloComprension {
  const pedidos = (t: string) => [...t.split('Haz la ficha de estos segmentos')[1]!.matchAll(/^(s\d+) \(/gm)].map((x) => x[1]!);
  const respuestas: Record<string, (t: string) => unknown> = {
    estructura: () => ({ segmentos: [
      { id: 's1', tipo: 'escena', titulo: 'Coppelia', desde: { u: 0, inicio: 'Diego me vio' }, hasta: { u: 0, fin: 'en ninguna parte.' } },
      { id: 's2', tipo: 'escena', titulo: 'La Guarida', desde: { u: 1, inicio: 'Al domingo siguiente' }, hasta: { u: 2, fin: 'helado de fresa.' } },
    ] }),
    fichas: (t) => ({ fichas: pedidos(t).map((s) => ({
      segmento: s, texto: `Ficha de ${s}.`, resumen_es: s, resumen_en: s, datos: {},
      // La misma cita en las dos fichas: se localiza una vez.
      evidencias: [{ u: 0, cita: 'Se sentó frente a mí con su helado de fresa' }, { u: 1, cita: 'Diego me enseñó sus libros prohibidos' }],
    })) }),
    entidades: () => ({ entidades: [
      { nombre: 'Diego', tipo: 'personaje', formas: ['Diego'], descripcion: 'Artista.', ficticia: true, importancia: 5, analisis: 'El eje del relato.', evidencias: [{ u: 2, cita: 'Cuando Diego se fue del país' }] },
    ] }),
    // El análisis de los personajes principales es su propio paso («personajes»), en tandas.
    personajes: (t) => {
      const pedidas = [...t.split('Analiza estas entidades')[1]!.matchAll(/^- (.+?) \(/gm)].map((x) => x[1]!);
      return { entidades: pedidas.includes('Diego') ? [{ nombre: 'Diego', analisis: 'El eje del relato.', evidencias: [{ u: 2, cita: 'Cuando Diego se fue del país' }] }] : [] };
    },
    global: () => ({ texto: 'De la desconfianza a la amistad.', resumen_es: 'Amistad.', resumen_en: 'Friendship.', sinopsis: 'David conoce a Diego.', evidencias: [{ u: 2, cita: 'volví solo a Coppelia y pedí helado de fresa' }] }),
  };
  return {
    nombre: 'falso', modelo: (c) => (c === 'alta' ? 'falso-alto' : 'falso-rapido'), precio: () => ({ entrada: 2, salida: 12 }),
    async generar<T>(p: PeticionComprension) {
      const t = p.partes.map((x) => ('texto' in x ? x.texto : '')).join('\n');
      const r = respuestas[p.operacion];
      if (!r) throw new Error(`sin respuesta para ${p.operacion}`);
      return { json: r(t) as T, uso: { modelo: this.modelo(p.calidad), tokensEntrada: 1000, tokensSalida: 200, usd: 0.01, ms: 5, llamadas: 1 } };
    },
  };
}

/**
 * El anclaje material como lo monta la plataforma, pero en memoria: `anclarMaterial`
 * con la unidad de la base, una imagen falsa, un redactor que devuelve `box_2d` y
 * una caché compartida entre pasos. Cada localización por visión cuesta 0,001 $.
 */
function anclajePercepcion(sql: SQL, o: { falla?: boolean } = {}) {
  const cache = new Map<string, string>();
  const almacen: AlmacenTrabajo = { async leer(c) { return cache.get(c) ?? null; }, async escribir(c, t) { cache.set(c, t); } };
  const vistas: string[] = [];
  const redactor: Redactor = {
    nombre: 'falso',
    async generar<T>(p: Parameters<Redactor['generar']>[0]) {
      vistas.push(p.mensajes[0]!.partes.map((x) => ('texto' in x ? x.texto : x.mime)).join(' '));
      return { texto: '', json: { encontrada: true, cajas: [CAJA] } as T };
    },
  };
  const fabrica = (documento: string): AnclajeMaterialDocumento => {
    // Cada instancia cuenta sus propias miradas (los pasos corren a la vez).
    let llamadas = 0;
    const propio: Redactor = { nombre: 'falso', generar: (p) => { llamadas++; return redactor.generar(p); } };
    return {
      async region(orden, x) {
        if (o.falla) throw new Error('sin imagen');
        const [f] = await sql.ejecutar<{ ancla: string; texto: string }>('SELECT ancla, texto FROM unidades WHERE documento = ? AND orden = ?', documento, orden);
        const r = await anclarMaterial({
          imagen: async () => ({ bytes: new Uint8Array([1]), mime: 'image/jpeg' }), redactor: propio, cache: almacen,
        }, { orden, texto: f!.texto, ancla: JSON.parse(f!.ancla), imagen: `paginas/${orden}.jpg` }, x);
        return r.ancla.region;
      },
      uso: () => ({ modelo: 'gemini-3.8-flash', tokensEntrada: 1500 * llamadas, tokensSalida: 60 * llamadas, usd: 0.001 * llamadas, ms: 0, llamadas }),
    };
  };
  return { fabrica, vistas, cache };
}

const contexto = (sql: SQL, extra: Partial<ContextoComprension> = {}): ContextoComprension => ({
  sql, modelo: modeloFalso(), embebedor: embebedorFalso, ahora: () => new Date(ahora), ...extra,
});

const regiones = (fs: Ficha[]) => fs.flatMap((f) => f.evidencias).map((e) => e.ancla.region);

describe('comprensión: regiones de las pruebas', () => {
  it('las pruebas de página de las fichas, las de entidad y las de la global reciben su región; se paga y queda dicho', async () => {
    const { sql, cerrar } = await cuento();
    const a = anclajePercepcion(sql);
    const e = await comprenderDocumento(contexto(sql, { anclajeMaterial: a.fabrica }), 'cuento');
    expect(e.estado).toBe('hecho');
    const segmento = await leerFichas(sql, { documento: 'cuento', objetivo: 'segmento' });
    expect(segmento).toHaveLength(2);
    expect(regiones(segmento)).toEqual([REGION, REGION, REGION, REGION]);
    // Los caracteres siguen ahí: la región se suma, no los sustituye.
    expect(segmento[0]!.evidencias[0]!.ancla).toMatchObject({ tipo: 'pagina', fisica: 1, caracteres: [55, 98], region: REGION });
    expect(regiones(await leerFichas(sql, { documento: 'cuento', objetivo: 'entidad' }))).toEqual([REGION]);
    expect(regiones(await leerFichas(sql, { documento: 'cuento', clase: 'global' }))).toEqual([REGION]);
    // Dos sitios en las fichas de segmento (repetidos en las dos), uno en la entidad, uno en la global.
    expect(a.vistas).toHaveLength(4);
    // Las fichas y los personajes van en paralelo: el orden de las miradas no está fijado.
    expect(a.vistas.some((v) => v.includes('«Se sentó frente a mí con su helado de fresa»'))).toBe(true);
    expect(e.pasos['fichas:0']!.detalle).toMatchObject({ regiones: 4 });
    // Las fichas de entidad las escribe el paso «personajes».
    expect(e.pasos['personajes']!.detalle).toMatchObject({ regiones: 1 });
    expect(e.pasos['global']!.detalle).toMatchObject({ regiones: 1 });
    expect(e.pasos['fichas:0']!.usd).toBeCloseTo(0.012, 5);
    // Cinco llamadas del modelo (estructura, fichas, entidades, personajes y global: 0,05 $) y cuatro localizaciones (0,004 $).
    expect(e.usd).toBeCloseTo(0.054, 5);
    expect(e.modelo).toContain('gemini-3.8-flash');

    // Rehecha: las localizaciones salen de la caché (ni una mirada más, nada que pagar).
    const otra = await comprenderDocumento(contexto(sql, { anclajeMaterial: a.fabrica }), 'cuento', { forzar: true });
    expect(a.vistas).toHaveLength(4);
    expect(otra.usd).toBeCloseTo(0.05, 5);
    expect(regiones(await leerFichas(sql, { documento: 'cuento', objetivo: 'segmento' }))).toEqual([REGION, REGION, REGION, REGION]);
    cerrar();
  });

  it('sin presupuesto no se mira; si el anclaje falla, las fichas se guardan con sus caracteres', async () => {
    const { sql, cerrar } = await cuento();
    const pobre = anclajePercepcion(sql);
    const e = await comprenderDocumento(contexto(sql, { anclajeMaterial: pobre.fabrica }), 'cuento', { presupuestoUsd: 0.015 });
    expect(e.estado).toBe('hecho');
    expect(pobre.vistas).toHaveLength(0);
    expect(regiones(await leerFichas(sql, { documento: 'cuento' })).every((r) => r === undefined)).toBe(true);
    expect(e.pasos['fichas:0']!.detalle).toMatchObject({ regiones: 0, sinRegion: 4 });

    const rota = anclajePercepcion(sql, { falla: true });
    const f = await comprenderDocumento(contexto(sql, { anclajeMaterial: rota.fabrica }), 'cuento', { forzar: true });
    expect(f.estado).toBe('hecho');
    const fichas = await leerFichas(sql, { documento: 'cuento', objetivo: 'segmento' });
    expect(fichas).toHaveLength(2);
    expect(fichas[0]!.evidencias[0]!.ancla).toMatchObject({ caracteres: [55, 98] });
    expect(fichas[0]!.evidencias[0]!.ancla.region).toBeUndefined();
    expect(f.usd).toBeCloseTo(0.05, 5);
    cerrar();
  });

  it('una localización por sitio, solo en las páginas sin región, y la visión se pregunta antes de cada una', async () => {
    const { sql, cerrar } = await cuento();
    const m = await leerMaterial(sql, 'cuento');
    const pedidas: Array<{ orden: number; caracteres?: [number, number]; cita?: string; vision?: boolean }> = [];
    const anclaje: AnclajeMaterialDocumento = {
      async region(orden, o) { pedidas.push({ orden, ...o }); return o.vision ? REGION : undefined; },
      uso: () => ({ modelo: '', tokensEntrada: 0, tokensSalida: 0, usd: 0, ms: 0, llamadas: 0 }),
    };
    const ev = (unidad: string, caracteres?: [number, number], extra: Partial<Evidencia['ancla']> = {}): Evidencia => ({
      documento: 'cuento', modo: 'texto', unidad, ancla: { ...m.porId.get(unidad)!.ancla, ...(caracteres ? { caracteres } : {}), ...extra } as Evidencia['ancla'],
    });
    const ficha = (evidencias: Evidencia[]) => ({ evidencias }) as unknown as Ficha;
    const a = ev('cuento:u1', [0, 37]), b = ev('cuento:u1', [0, 37]), c = ev('cuento:u2', [0, 10]);
    const entera = ev('cuento:u0'), ya = ev('cuento:u0', [0, 5], { region: { x: 0, y: 0, w: 1, h: 1 } });
    const tiempo: Evidencia = { documento: 'cuento', modo: 'video', ancla: { tipo: 'tiempo', t0: 1, t1: 2 } };
    let vision = true;
    const r = await regionesDeFichas(anclaje, m, [ficha([a, entera, ya, tiempo]), ficha([b, c])], {
      concurrencia: 1, vision: () => { const v = vision; vision = false; return v; },
    });
    expect(pedidas).toEqual([
      { orden: 1, caracteres: [0, 37], cita: 'Al domingo siguiente fui a la Guarida', vision: true },
      { orden: 2, caracteres: [0, 10], cita: 'Cuando Die', vision: false },
    ]);
    expect(r).toEqual({ candidatas: 3, regiones: 2 });
    expect([a.ancla.region, b.ancla.region, c.ancla.region]).toEqual([REGION, REGION, undefined]);
    expect(entera.ancla.region).toBeUndefined();
    expect(ya.ancla.region).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    cerrar();
  });
});
