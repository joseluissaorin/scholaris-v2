/**
 * Que ningún paso de la comprensión se quede colgado (incidente del 4-11-2026: el paso
 * de entidades del cuento caducó tres veces seguidas en producción). Cada llamada al
 * modelo se acota a lo que queda del plazo y se apunta en el diario; Wikidata y el
 * índice tienen su propio límite; la lista de entidades y el análisis de las
 * principales van en llamadas separadas y pequeñas.
 */
import type { Documento, Ficha, IndiceVectorial, SQL } from '@scholaris/nucleo';
import { aplicarEsquemaFunciones } from '@scholaris/funciones';
import { escribirDocumento, escribirFichas, escribirUnidades, leerApariciones, leerFichas, type UnidadSpdf } from '@scholaris/spdf';
import { describe, expect, it } from 'vitest';
import {
  enlazarReparto, ErrorPlazo, indexarFichas, leerMaterial, llamar, modeloDelPaso, pasoEntidades, pasoPersonajes, pasoSegmentos, planificarComprension, resolverEntidades,
  usoVacio, type ContextoComprension, type ModeloComprension, type PeticionComprension, type RegistroComprension,
} from '../src/index.js';
import { baseReal, embebedorFalso } from './fakes.js';

const ahora = '2026-11-04T10:00:00.000Z';

async function base() {
  const b = await baseReal();
  await aplicarEsquemaFunciones(b.sql);
  return b;
}

async function cuento(sql: SQL) {
  const d: Documento = {
    id: 'cuento', tipo: 'pdf', metadatos: { titulo: 'Un cuento', autores: [], idioma: 'es', tipoCSL: 'book', coleccion: 'Cuento' }, estado: 'listo', huella: 'h'.repeat(64),
    original: '', mime: 'application/pdf', bytes: 1, unidades: 2, creado: ahora, actualizado: ahora, bibliotecas: [],
  };
  await escribirDocumento(sql, d);
  const textos = ['Diego me vio en Coppelia comiendo helado. Yo desconfié de él.', 'Al domingo siguiente fui a la Guarida con Diego y vi a Germán.'];
  await escribirUnidades(sql, textos.map((texto, i): UnidadSpdf => ({
    id: `cuento:u${i}`, documento: 'cuento', orden: i, texto, lector: 'prueba', confianza: 1,
    ancla: { tipo: 'pagina', fisica: i + 1, impresa: String(i + 5), romana: false, origen: 'leido', confianza: 1 },
  })));
}

const uso = (modelo = 'falso') => ({ modelo, tokensEntrada: 100, tokensSalida: 50, usd: 0.001, ms: 1, llamadas: 1 });

describe('comprensión: plazos, diario y latido', () => {
  it('cada llamada se acota a lo que queda del plazo, late y queda en el diario; sin tiempo, ni se empieza', async () => {
    const registro: RegistroComprension[] = [];
    const pedidas: PeticionComprension[] = [];
    let reloj = 1_000_000;
    let latidos = 0;
    const base_: ModeloComprension = { nombre: 'falso', modelo: () => 'falso', async generar<T>(p: PeticionComprension) { pedidas.push(p); return { json: { ok: true } as T, uso: uso() }; } };
    const m = modeloDelPaso(base_, { documento: 'd', paso: 'entidades', limite: reloj + 120_000, registro: (r) => registro.push(r), latido: () => { latidos++; }, reloj: () => reloj });
    const p: PeticionComprension = { sistema: 's', partes: [{ texto: 't' }], esquema: {}, calidad: 'alta', operacion: 'entidades' };
    await m.generar(p);
    // 120 s de plazo menos 20 s de margen para escribir lo hecho.
    expect(pedidas[0]!.limiteMs).toBe(100_000);
    expect(registro.map((r) => [r.sub, r.estado])).toEqual([['modelo:entidades', 'inicio'], ['modelo:entidades', 'fin']]);
    expect(registro[1]).toMatchObject({ documento: 'd', paso: 'entidades', tokensSalida: 50, usd: 0.001 });
    expect(latidos).toBe(2);
    // Con 10 s por delante, una llamada no se empieza: error de plazo, y `llamar` no lo reintenta.
    reloj += 110_000;
    const acumulado = { uso: usoVacio() };
    await expect(llamar(m, p, acumulado)).rejects.toBeInstanceOf(ErrorPlazo);
    expect(pedidas).toHaveLength(1);
  });

  it('un modelo que se queda sin tiempo deja el paso en error claro, apuntado y sin reintentos dentro del paso', async () => {
    const { sql, archivo } = await base();
    await cuento(sql);
    const registro: RegistroComprension[] = [];
    let llamadas = 0;
    const modelo: ModeloComprension = {
      nombre: 'colgado', modelo: () => 'colgado',
      async generar<T>(p: PeticionComprension): Promise<{ json: T; uso: ReturnType<typeof uso> }> {
        if (p.operacion === 'estructura') return { json: { segmentos: [{ id: 's1', tipo: 'escena', titulo: 'Todo', desde: { u: 0 }, hasta: { u: 1 } }] } as T, uso: uso() };
        llamadas++;
        // Como el adaptador de Gemini: con `limiteMs`, la llamada se corta y lo dice.
        expect(p.limiteMs).toBeGreaterThan(0);
        throw new Error(`colgado: sin respuesta dentro del plazo (${Math.round(p.limiteMs! / 1000)} s) en ${p.operacion}`);
      },
    };
    const ctx: ContextoComprension = { sql, modelo, registro: (r) => registro.push(r), limite: Date.now() + 300_000 };
    const plan = await planificarComprension(ctx, 'cuento');
    await pasoSegmentos(ctx, plan);
    await expect(pasoEntidades(ctx, plan)).rejects.toThrow(/dentro del plazo \(\d+ s\) en entidades/);
    expect(llamadas).toBe(1);
    expect(registro.filter((r) => r.paso === 'entidades').map((r) => `${r.sub}:${r.estado}`)).toEqual(['conocidas:inicio', 'conocidas:fin', 'modelo:entidades:inicio', 'modelo:entidades:error']);
    // El intento siguiente del paso va con el modelo rápido: mejor algo menos fino que un paso que nunca termina.
    const calidades: string[] = [];
    const repuesto: ModeloComprension = {
      nombre: 'repuesto', modelo: (c) => c,
      async generar<T>(p: PeticionComprension) { calidades.push(`${p.operacion}:${p.calidad}`); return { json: { entidades: [{ nombre: 'Diego', tipo: 'personaje', formas: ['Diego'], importancia: 2 }] } as T, uso: uso() }; },
    };
    await pasoEntidades({ ...ctx, modelo: repuesto, limite: Date.now() + 300_000 }, plan);
    expect(calidades).toEqual(['entidades:rapida']);
    archivo.cerrar();
  });

  it('la lista de entidades y el análisis de las principales van aparte: llamadas pequeñas y a la vez', async () => {
    const { sql, archivo } = await base();
    await cuento(sql);
    const pedidas: PeticionComprension[] = [];
    const nombres = ['Diego', 'David', 'Coppelia', 'La Guarida', 'Germán', 'Lezama', 'Nancy'];
    const modelo: ModeloComprension = {
      nombre: 'falso', modelo: () => 'falso',
      async generar<T>(p: PeticionComprension) {
        pedidas.push(p);
        const texto = p.partes.map((x) => ('texto' in x ? x.texto : '')).join('\n');
        if (p.operacion === 'estructura') return { json: { segmentos: [{ id: 's1', tipo: 'escena', titulo: 'Todo', desde: { u: 0 }, hasta: { u: 1 } }] } as T, uso: uso() };
        if (p.operacion === 'entidades') {
          return { json: { entidades: nombres.map((n, i) => ({ nombre: n, tipo: i < 2 || i > 4 ? 'personaje' : i < 4 ? 'lugar' : 'personaje', formas: [n.replace('La ', 'la ')], descripcion: `${n}, en una línea.`, importancia: i === 5 ? 3 : 5 })) } as T, uso: uso() };
        }
        if (p.operacion === 'personajes') {
          const pedidasAqui = [...texto.split('Analiza estas entidades')[1]!.matchAll(/^- (.+?) \(/gm)].map((x) => x[1]!);
          return { json: { entidades: pedidasAqui.map((n) => ({ nombre: n, analisis: `Análisis de ${n}.`, evidencias: [{ u: 0, cita: 'Diego me vio en Coppelia' }] })) } as T, uso: uso() };
        }
        throw new Error(`sin respuesta para ${p.operacion}`);
      },
    };
    const ctx: ContextoComprension = { sql, modelo };
    const plan = await planificarComprension(ctx, 'cuento');
    await pasoSegmentos(ctx, plan);
    await pasoEntidades(ctx, plan);
    // Tras las entidades: apariciones sí, fichas de entidad todavía no; la lista no pide análisis.
    expect((await leerApariciones(sql, { documento: 'cuento' })).length).toBeGreaterThan(0);
    expect(await leerFichas(sql, { documento: 'cuento', objetivo: 'entidad' })).toEqual([]);
    const lista = pedidas.find((p) => p.operacion === 'entidades')!;
    expect(JSON.stringify(lista.esquema)).not.toMatch(/analisis|evidencias/);
    await pasoPersonajes(ctx, plan);
    // Seis principales (importancia 5) en tandas de cinco: dos llamadas; Lezama (importancia 3) solo con su línea.
    const tandas = pedidas.filter((p) => p.operacion === 'personajes');
    expect(tandas).toHaveLength(2);
    const fichas = await leerFichas(sql, { documento: 'cuento', objetivo: 'entidad' });
    expect(fichas.find((f) => f.datos.nombre === 'Diego')!).toMatchObject({ texto: 'Análisis de Diego.' });
    expect(fichas.find((f) => f.datos.nombre === 'Diego')!.evidencias[0]!.cita).toBe('Diego me vio en Coppelia');
    expect(fichas.find((f) => f.datos.nombre === 'Lezama')!.texto).toBe('Lezama, en una línea.');
    archivo.cerrar();
  });

  it('Wikidata colgada no bloquea el reparto (límite total) y lo ya preguntado sale de la caché', async () => {
    const { sql, archivo } = await base();
    const d: Documento = {
      id: 'peli', tipo: 'video', metadatos: { titulo: 'Fresa y chocolate', autores: [], anio: 1993, idioma: 'es', tipoCSL: 'motion_picture' }, estado: 'listo', huella: 'p'.repeat(64),
      original: '', mime: 'video/mp4', bytes: 1, unidades: 1, creado: ahora, actualizado: ahora, bibliotecas: [],
    };
    await escribirDocumento(sql, d);
    await escribirUnidades(sql, [{ id: 'peli:u0', documento: 'peli', orden: 0, texto: '**Diego:** Hola.', lector: 'asr', confianza: 1, ancla: { tipo: 'tiempo', t0: 0, t1: 5, hablante: 'Diego' } }]);
    const m = await leerMaterial(sql, 'peli');
    const ents = await resolverEntidades(sql, [{ nombre: 'Diego', tipo: 'personaje', formas: ['Diego'], importancia: 5 }]);
    const percepcion = { documento: 'peli', modelo: 'p', version: '1', duracion: 5, reparto: [{ nombre: 'Diego', ficticia: true, actor: 'Jorge Perugorría' }], escenas: [], avisos: [] };
    // Una Wikidata que nunca contesta (solo se rinde si la cortan).
    const colgada = ((_u: string, init?: RequestInit) => new Promise<Response>((_, no) => init?.signal?.addEventListener('abort', () => no(new Error('abortada'))))) as unknown as typeof fetch;
    const t0 = Date.now();
    const r = await enlazarReparto(sql, m, ents, { fetch: colgada, percepcion, ahora, esperaWikidataMs: 50 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.avisos.join(' ')).toMatch(/Wikidata no respondió: Wikidata no contestó a tiempo/);
    expect(r.papeles.map((p) => `${p.actor} → ${p.personaje} (${p.fuente})`)).toEqual(['Jorge Perugorría → Diego (percepcion)']);
    // Una que contesta: la segunda vez, de la caché.
    let llamadas = 0;
    const viva = (async (url: string) => {
      llamadas++;
      const q = Object.fromEntries(new URL(url).searchParams);
      const cuerpo = q.action === 'wbsearchentities' ? { search: [] } : { entities: {} };
      return new Response(JSON.stringify(cuerpo), { status: 200 });
    }) as unknown as typeof fetch;
    await enlazarReparto(sql, m, ents, { fetch: viva, percepcion, ahora });
    const antes = llamadas;
    expect(antes).toBe(1);
    await enlazarReparto(sql, m, ents, { fetch: viva, percepcion, ahora });
    expect(llamadas).toBe(antes);
    archivo.cerrar();
  });

  it('el índice que no contesta a tiempo no cuelga el indexado: los vectores quedan en la estantería como pendientes', async () => {
    const { sql, archivo } = await base();
    await cuento(sql);
    const ficha: Ficha = {
      id: 'cuento:fi:global:narrativa', documento: 'cuento', objetivo: 'documento', objetivoId: 'cuento', lente: 'narrativa', clase: 'global', idioma: 'es',
      texto: 'Un cuento sobre la amistad.', datos: {}, evidencias: [], modelo: 'm', version: 'v', creada: ahora,
    };
    await escribirFichas(sql, [ficha]);
    let insertadas = 0;
    const indice: IndiceVectorial = {
      espacio: embebedorFalso.espacio,
      insertar: () => { insertadas++; return new Promise<void>(() => undefined); },
      consultar: async () => [], borrar: async () => undefined,
    };
    // Con 7 s de plazo queda tiempo para empezar, pero el envío se corta antes de agotarlo (5 s de margen).
    const ctx: ContextoComprension = { sql, modelo: null, embebedor: embebedorFalso, indice, espacioNombres: 'u', limite: Date.now() + 7_000 };
    const t0 = Date.now();
    const r = await indexarFichas(ctx, 'cuento');
    expect(r).toEqual({ vectores: 1, pendientes: true });
    expect(insertadas).toBe(1);
    expect(Date.now() - t0).toBeLessThan(6_000);
    // Sin tiempo ni para empezar: ni se intenta.
    const r2 = await indexarFichas({ ...ctx, limite: Date.now() + 4_000 }, 'cuento');
    expect(r2.pendientes).toBe(true);
    expect(insertadas).toBe(1);
    const [v] = await sql.ejecutar<{ n: number }>("SELECT COUNT(*) AS n FROM vectores WHERE objetivo = 'ficha'");
    expect(v!.n).toBe(1);
    archivo.cerrar();
  }, 20_000);
});
