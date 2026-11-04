/**
 * La capa de comprensión de punta a punta sobre una base real (SPDF 4.2 + el
 * esquema de las funciones, como la estantería), con un modelo falso que
 * responde por operación: lentes, estructura, fichas con evidencias ancladas,
 * entidades del grafo con apariciones, ficha global, vectores, reanudación,
 * presupuesto y el reparto de Wikidata.
 */
import type { Documento, PercepcionMedio, SQL } from '@scholaris/nucleo';
import { aplicarEsquemaFunciones } from '@scholaris/funciones';
import { buscarFichas, escribirDocumento, escribirUnidades, leerApariciones, leerFichas, leerSecciones, leerSegmentos, type UnidadSpdf } from '@scholaris/spdf';
import { describe, expect, it } from 'vitest';
import {
  anclarReferencia, comprenderDocumento, elegirLentes, leerEstadoComprension, leerMaterial, localizarCita, pasoSegmentos, pasoFichas, planificarComprension,
  limpiarProsa, textoDeCaracteres, tramoDeCaracteres, type ContextoComprension, type ModeloComprension, type PeticionComprension,
} from '../src/index.js';
import { baseReal, embebedorFalso } from './fakes.js';
import percepcionFresa from './datos/percepcion-fresa.json';

// ---------------------------------------------------------------------------
// Material de prueba
// ---------------------------------------------------------------------------

const PAGINAS = [
  'Diego me vio en Coppelia comiendo helado de chocolate. Se sentó frente a mí con su helado de fresa y me dijo que tenía libros que yo no podía encontrar en ninguna parte. Yo desconfié de él desde el primer momento.',
  'Al domingo siguiente fui a la Guarida. Diego me enseñó sus libros prohibidos y una foto de Lezama. Hablamos de literatura hasta la noche, y el helado de fresa se derretía en la mesa.',
  'Cuando Diego se fue del país, volví solo a Coppelia y pedí helado de fresa. Ya no era el mismo muchacho que desconfiaba de todo.',
];

const ahora = '2026-11-04T10:00:00.000Z';

function documento(id: string, tipo: Documento['tipo'], titulo: string, extra: Partial<Documento['metadatos']> = {}): Documento {
  return {
    id, tipo, metadatos: { titulo, autores: [{ nombre: 'Senel', apellidos: 'Paz' }], anio: 1994, idioma: 'es', ...extra }, estado: 'listo', huella: id.padEnd(64, '0'),
    original: '', mime: tipo === 'video' ? 'video/mp4' : 'application/pdf', bytes: 1, unidades: 3, creado: ahora, actualizado: ahora, bibliotecas: [],
  };
}

async function base() {
  const b = await baseReal();
  await aplicarEsquemaFunciones(b.sql);
  return b;
}

async function cuento(sql: SQL, id = 'cuento') {
  await escribirDocumento(sql, documento(id, 'pdf_escaneado', 'El lobo, el bosque y el hombre nuevo', { tipoCSL: 'book', coleccion: 'Cuento' }));
  await escribirUnidades(sql, PAGINAS.map((texto, i): UnidadSpdf => ({
    id: `${id}:u${i}`, documento: id, orden: i, texto, lector: 'prueba', confianza: 1,
    ancla: { tipo: 'pagina', fisica: i + 1, impresa: String(i + 5), romana: false, origen: 'leido', confianza: 1 },
  })));
}

const DIALOGO_COPPELIA = 'No pude resistir la tentación. Me encanta la fresa. Es lo único bueno que hacen en este país.';

async function pelicula(sql: SQL, id = 'pelicula') {
  await escribirDocumento(sql, { ...documento(id, 'video', 'Fresa y chocolate', { tipoCSL: 'motion_picture', anio: 1993, autores: [{ nombre: 'Tomás', apellidos: 'Gutiérrez Alea' }] }), duracion: 700 });
  const palabras = DIALOGO_COPPELIA.split(/\s+/);
  const unidades: UnidadSpdf[] = [
    { id: `${id}:u0`, documento: id, orden: 0, texto: '**Vivian:** Aquí parece que vamos a hacer algo malo.\n\n**David:** Ya nosotros habíamos hablado.', lector: 'asr', confianza: 1, ancla: { tipo: 'tiempo', t0: 107, t1: 145.7, hablante: 'Vivian' } },
    { id: `${id}:u1`, documento: id, orden: 1, texto: '**David:** Yo te quiero mucho, Vivian.\n\n**Vivian:** Solo te interesa el sexo, como a todos.', lector: 'asr', confianza: 1, ancla: { tipo: 'tiempo', t0: 373.6, t1: 417.5, hablante: 'David' } },
    { id: `${id}:u2`, documento: id, orden: 2, texto: '**Diego:** ¡Vivan los novios! Qué profundo es, cruel, mi tormento.', lector: 'asr', confianza: 1, ancla: { tipo: 'tiempo', t0: 466.9, t1: 519.6, hablante: 'Diego' } },
    {
      id: `${id}:u3`, documento: id, orden: 3, texto: DIALOGO_COPPELIA, lector: 'asr', confianza: 1, ancla: { tipo: 'tiempo', t0: 594.6, t1: 641.8, hablante: 'Diego' },
      palabras: { v: 1, t0: 594.6, cs: palabras.flatMap((_, i) => [i * 50, 45]) },
    },
    { id: `${id}:u4`, documento: id, orden: 4, texto: '**Diego:** Aprovecha, niño. ¿Dónde vas a encontrar esos libros?\n\n**David:** Que no voy a casa de gente que no conozco.', lector: 'asr', confianza: 1, ancla: { tipo: 'tiempo', t0: 641.8, t1: 689, hablante: 'Diego' } },
  ];
  await escribirUnidades(sql, unidades);
}

// ---------------------------------------------------------------------------
// Modelo falso
// ---------------------------------------------------------------------------

function modeloFalso(respuestas: Partial<Record<string, (p: PeticionComprension, texto: string) => unknown>>): ModeloComprension & { llamadas: PeticionComprension[] } {
  const llamadas: PeticionComprension[] = [];
  return {
    nombre: 'falso', llamadas,
    modelo: (c) => (c === 'alta' ? 'falso-alto' : 'falso-rapido'),
    precio: () => ({ entrada: 2, salida: 12 }),
    async generar<T>(p: PeticionComprension) {
      llamadas.push(p);
      const texto = p.partes.map((x) => ('texto' in x ? x.texto : '')).join('\n');
      const r = respuestas[p.operacion];
      if (!r) throw new Error(`sin respuesta para ${p.operacion}`);
      return { json: r(p, texto) as T, uso: { modelo: this.modelo(p.calidad), tokensEntrada: 1000, tokensSalida: 200, usd: 0.01, ms: 5, llamadas: 1 } };
    },
  };
}

/** Los ids de segmento que pide una tanda de fichas («s1 (escena…»). */
const pedidos = (texto: string) => [...texto.split('Haz la ficha de estos segmentos')[1]!.matchAll(/^(s\d+) \(/gm)].map((x) => x[1]!);

const respuestasCuento = {
  estructura: () => ({
    segmentos: [
      { id: 's1', tipo: 'escena', titulo: 'Coppelia', resumen: 'Diego aborda al narrador en la heladería.', desde: { u: 0, inicio: 'Diego me vio en Coppelia' }, hasta: { u: 0, fin: 'desde el primer momento.' }, confianza: 0.9 },
      { id: 's2', tipo: 'escena', titulo: 'La Guarida', resumen: 'Primera visita a la casa de Diego.', desde: { u: 1, inicio: 'Al domingo siguiente fui a la Guarida' }, hasta: { u: 1, fin: 'se derretía en la mesa.' } },
      { id: 's3', tipo: 'escena', titulo: 'El regreso', desde: { u: 2, inicio: 'Cuando Diego se fue del país' }, hasta: { u: 2, fin: 'que desconfiaba de todo.' } },
    ],
  }),
  fichas: (_p: PeticionComprension, texto: string) => ({
    fichas: pedidos(texto).map((s) => ({
      segmento: s, texto: `Análisis narratológico de ${s}: focalización interna fija en el narrador autodiegético.`, resumen_es: `Escena ${s}`, resumen_en: `Scene ${s}`,
      datos: { acontecimientos: ['encuentro'], personajes: [{ nombre: 'Diego', papel: 'seductor' }], orden: 'cronológico', duracion: 'escena', focalizacion: 'interna fija', funcionTrama: 'detonante' },
      evidencias: [
        // Sin tilde y con otra puntuación: el modelo «arregla» al citar; se guarda la literal.
        { u: 0, cita: 'se sento frente a mi con su helado de fresa', apoya: 'el encuentro' },
        { u: 1, cita: 'una frase inventada que no está en ninguna parte del cuento', apoya: 'nada' },
      ],
    })),
  }),
  entidades: () => ({
    entidades: [
      { nombre: 'Diego', tipo: 'personaje', formas: ['Diego'], descripcion: 'Artista homosexual que seduce al narrador con libros.', ficticia: true, importancia: 5, analisis: 'Diego es el eje del relato: encarna la cultura que la Revolución margina.', evidencias: [{ u: 1, cita: 'Diego me enseñó sus libros prohibidos' }] },
      { nombre: 'David', tipo: 'personaje', formas: ['David'], alusiones: ['el mismo muchacho que desconfiaba de todo'], descripcion: 'El narrador, joven comunista.', ficticia: true, importancia: 5, analisis: 'El narrador cambia de la desconfianza a la amistad.' },
      { nombre: 'Coppelia', tipo: 'lugar', formas: ['Coppelia'], descripcion: 'Heladería de La Habana.', importancia: 4 },
      { nombre: 'La Guarida', tipo: 'lugar', formas: ['la Guarida', 'Guarida'], descripcion: 'La casa de Diego.', importancia: 4 },
      { nombre: 'José Lezama Lima', tipo: 'persona', formas: ['Lezama'], descripcion: 'Poeta cubano.', importancia: 3 },
    ],
  }),
  global: () => ({
    texto: 'El relato narra, desde la focalización del narrador, el paso de la desconfianza a la amistad.', resumen_es: 'Amistad entre Diego y David.', resumen_en: 'Friendship between Diego and David.',
    sinopsis: 'David conoce a Diego en Coppelia…', contexto: [{ dato: 'Publicado en 1991 y llevado al cine en 1993.', externo: true }],
    temas: [{ nombre: 'la amistad', descripcion: 'De la desconfianza a la amistad.', formas: ['amistad'], apariciones: [{ u: 1, cita: 'Hablamos de literatura hasta la noche' }] }],
    motivos: [{ nombre: 'el helado de fresa', descripcion: 'Signo de la diferencia de Diego.', formas: ['helado de fresa'], apariciones: [{ u: 0, cita: 'con su helado de fresa' }] }],
    datos: { fabula: [{ acontecimiento: 'Encuentro en Coppelia', segmento: 's1' }], ordenRelato: 'lineal con un cierre en analepsis', narrador: 'autodiegético', focalizacion: 'interna fija', personajes: [{ nombre: 'Diego', papel: 'mentor' }], sentido: 'la tolerancia' },
    evidencias: [{ u: 2, cita: 'volví solo a Coppelia y pedí helado de fresa' }],
  }),
};

const contexto = (sql: SQL, modelo: ModeloComprension | null, extra: Partial<ContextoComprension> = {}): ContextoComprension => ({
  sql, modelo, embebedor: embebedorFalso, ahora: () => new Date(ahora), ...extra,
});

// ---------------------------------------------------------------------------
// Pruebas
// ---------------------------------------------------------------------------

describe('comprensión: anclaje', () => {
  it('localiza citas con otras tildes, puntuación y erratas del OCR, en puntos de código', () => {
    const u = { texto: 'Se sentó frente a mí con su helado de fresa, y me dijo: «tengo libros».' };
    const a = localizarCita(u, 'se sento frente a mi con su helado de fresa')!;
    expect(a.literal).toBe('Se sentó frente a mí con su helado de fresa');
    expect(textoDeCaracteres(u, a.caracteres)).toBe(a.literal);
    const b = localizarCita({ texto: 'con la goardia en alto, razonando que las langostas eran un soborno' }, 'con la guardia en alto, razonando que las langostas eran un soborno')!;
    expect(b.exacta).toBe(false);
    expect(b.literal).toMatch(/^con la goardia en alto/);
    expect(localizarCita(u, 'nada de esto aparece en la página')).toBeNull();
    // Un carácter astral delante cuenta como uno.
    const c = localizarCita({ texto: '𝔄 Diego vio a David.' }, 'Diego vio a David')!;
    expect(c.caracteres).toEqual([2, 19]);
  });

  it('limpia de la prosa las marcas del material', () => {
    const m = { porOrden: new Map([[15, { etiqueta: 'p. 14' }]]) as never, fotogramas: [{ n: 81, t: 864.2, id: 'f', descripcion: '', unidad: 'u' }] };
    expect(limpiarProsa('La guarida (⟦U15⟧, ⟦F81⟧) y el té ⟦U99⟧.', m)).toBe('La guarida (p. 14, 14:24) y el té.');
    expect(limpiarProsa('Como dice ⟦U3 · p. 6⟧, nada.', m)).toBe('Como dice p. 6, nada.');
  });

  it('elige la lente por el tipo, el CSL y el contenido', () => {
    expect(elegirLentes({ tipo: 'video', metadatos: { tipoCSL: 'motion_picture' }, muestra: '' }).lentes).toEqual(['cine']);
    expect(elegirLentes({ tipo: 'video', metadatos: { genero: 'documental' }, muestra: '' }).lentes).toEqual(['cine', 'documental']);
    expect(elegirLentes({ tipo: 'pdf', metadatos: { tipoCSL: 'legislation' }, muestra: '' }).lentes).toEqual(['juridico']);
    expect(elegirLentes({ tipo: 'pdf', metadatos: { tipoCSL: 'article-journal' }, muestra: 'Introducción\nMétodo\nResultados\nDiscusión' }).lentes).toEqual(['cientifico']);
    expect(elegirLentes({ tipo: 'pdf', metadatos: { coleccion: 'Cuento' }, muestra: PAGINAS.join('\n') }).lentes).toEqual(['narrativa']);
    const versos = Array.from({ length: 16 }, (_, i) => (i % 4 === 3 ? '' : `verso número ${i} de la canción`)).join('\n');
    expect(elegirLentes({ tipo: 'pdf', metadatos: {}, muestra: versos }).lentes).toEqual(['poesia']);
    expect(elegirLentes({ tipo: 'audio', metadatos: {}, muestra: '', hablantes: 2 }).lentes).toEqual(['entrevista']);
  });
});

describe('comprensión: un cuento', () => {
  it('estructura, fichas ancladas, entidades del grafo, temas, vectores y estado', async () => {
    const { sql, archivo } = await base();
    await cuento(sql);
    const modelo = modeloFalso(respuestasCuento);
    const e = await comprenderDocumento(contexto(sql, modelo), 'cuento');
    expect(e.estado).toBe('hecho');
    expect(e.lentes).toEqual(['narrativa']);
    expect(e.version).toBe('comprension@1 narrativa@1');
    expect(Object.keys(e.pasos).sort()).toEqual(['entidades', 'estructura', 'fichas:0', 'global', 'indexado']);
    expect(e.usd).toBeCloseTo(0.04, 5);
    expect(e.modelo).toContain('falso-alto');

    // Estructura: tres escenas en preorden, ancladas a sus palabras de inicio y fin.
    const segs = await leerSegmentos(sql, 'cuento');
    expect(segs.map((s) => [s.orden, s.tipo, s.titulo, s.nivel])).toEqual([[0, 'escena', 'Coppelia', 1], [1, 'escena', 'La Guarida', 1], [2, 'escena', 'El regreso', 1]]);
    expect(segs[1]!.ancla).toMatchObject({ tipo: 'pagina', impresa: '6', caracteres: [0, 37] });
    expect(segs[1]!.unidadDesde).toBe('cuento:u1');
    expect(segs[0]!.origen).toBe('modelo');
    // Sin índice propio: las escenas hacen de secciones.
    expect((await leerSecciones(sql, 'cuento')).map((s) => s.titulo)).toEqual(['Coppelia', 'La Guarida', 'El regreso']);

    // Fichas de escena: la cita guardada es la del material, con sus caracteres; la inventada no entra.
    const fichas = await leerFichas(sql, { documento: 'cuento', objetivo: 'segmento' });
    expect(fichas).toHaveLength(3);
    const f = fichas[0]!;
    expect(f).toMatchObject({ lente: 'narrativa', clase: 'escena', version: 'narrativa@1', modelo: 'falso-alto', idioma: 'es' });
    expect(f.evidencias).toHaveLength(1);
    expect(f.evidencias[0]).toMatchObject({ documento: 'cuento', modo: 'texto', unidad: 'cuento:u0', cita: 'Se sentó frente a mí con su helado de fresa' });
    expect(textoDeCaracteres({ texto: PAGINAS[0]! }, f.evidencias[0]!.ancla.caracteres!)).toBe('Se sentó frente a mí con su helado de fresa');
    expect(f.datos).toMatchObject({ focalizacion: 'interna fija', resumen: { es: 'Escena s0', en: 'Scene s0' }, citasNoVerificadas: 1 });

    // Ficha global con temas y motivos enlazados a entidades del grafo.
    const [global] = await leerFichas(sql, { documento: 'cuento', clase: 'global' });
    expect(global!.objetivo).toBe('documento');
    expect(global!.datos.contexto).toEqual([{ dato: 'Publicado en 1991 y llevado al cine en 1993.', externo: true }]);
    const motivo = (global!.datos.motivos as Array<{ nombre: string; entidad?: string; apariciones?: number }>)[0]!;
    expect(motivo.nombre).toBe('el helado de fresa');
    // Tres veces «helado de fresa» en el texto; una de ellas dentro de la cita del modelo.
    expect(motivo.apariciones).toBe(3);

    // Entidades del grafo y sus apariciones con caracteres.
    const diego = (await sql.ejecutar<{ id: string; ficticia: number }>("SELECT id, ficticia FROM entidades WHERE tipo = 'persona' AND clave = 'diego'"))[0]!;
    expect(diego.ficticia).toBe(1);
    const apDiego = await leerApariciones(sql, { entidad: diego.id });
    expect(apDiego.map((a) => a.ancla.tipo === 'pagina' && a.ancla.impresa)).toEqual(['5', '6', '7']);
    expect(apDiego.every((a) => a.rol === 'nombrado' && a.forma === 'Diego' && a.ancla.caracteres)).toBe(true);
    expect(apDiego[1]!.segmento).toBe(segs[1]!.id);
    const guarida = (await sql.ejecutar<{ id: string }>("SELECT id FROM entidades WHERE tipo = 'lugar' AND clave = 'la guarida'"))[0]!;
    expect((await leerApariciones(sql, { entidad: guarida.id })).map((a) => a.forma)).toEqual(['la Guarida']);
    const david = (await sql.ejecutar<{ id: string }>("SELECT id FROM entidades WHERE tipo = 'persona' AND clave = 'david'"))[0]!;
    expect((await leerApariciones(sql, { entidad: david.id })).map((a) => a.rol)).toEqual(['aludido']);
    // Fichas de personaje para las principales.
    const personajes = await leerFichas(sql, { documento: 'cuento', objetivo: 'entidad' });
    expect(personajes.map((x) => x.datos.nombre).sort()).toEqual(['Coppelia', 'David', 'Diego', 'José Lezama Lima', 'La Guarida']);
    expect(personajes.find((x) => x.datos.nombre === 'Diego')!.evidencias[0]!.cita).toBe('Diego me enseñó sus libros prohibidos');

    // Búsqueda: FTS de las fichas y un vector por ficha en el espacio de los fragmentos.
    expect((await buscarFichas(sql, 'focalización autodiegético')).length).toBeGreaterThan(0);
    const [v] = await sql.ejecutar<{ n: number }>("SELECT COUNT(*) AS n FROM vectores WHERE documento = 'cuento' AND objetivo = 'ficha' AND espacio = 'falso@4'");
    expect(v!.n).toBe((await leerFichas(sql, { documento: 'cuento' })).length);

    // Otra vez: ya está hecha con esta versión, no se llama al modelo.
    const n = modelo.llamadas.length;
    expect((await comprenderDocumento(contexto(sql, modelo), 'cuento')).estado).toBe('hecho');
    expect(modelo.llamadas.length).toBe(n);
    // Forzada: se rehace de cero y sustituye (mismos ids, nada duplicado).
    await comprenderDocumento(contexto(sql, modelo), 'cuento', { forzar: true });
    expect(modelo.llamadas.length).toBe(n * 2);
    expect(await leerFichas(sql, { documento: 'cuento', objetivo: 'segmento' })).toHaveLength(3);
    expect(await leerApariciones(sql, { entidad: diego.id })).toHaveLength(3);
    archivo.cerrar();
  });

  it('reanuda tras una caída sin repetir lo hecho, empieza de cero tras un error y respeta el presupuesto', async () => {
    const { sql, archivo } = await base();
    await cuento(sql);
    let fallar = false;
    const modelo = modeloFalso({
      ...respuestasCuento,
      fichas: (p, t) => { if (fallar) throw new Error('respuesta bloqueada por seguridad'); return respuestasCuento.fichas(p, t); },
    });
    const ctx = contexto(sql, modelo);
    const cuenta = (op: string) => modelo.llamadas.filter((p) => p.operacion === op).length;
    const plan = await planificarComprension(ctx, 'cuento');
    await pasoSegmentos(ctx, plan);
    expect(cuenta('estructura')).toBe(1);
    // El proceso muere aquí. El relanzamiento (misma versión, «en_marcha») reanuda: la estructura no se repite.
    const plan2 = await planificarComprension(ctx, 'cuento');
    expect((await pasoSegmentos(ctx, plan2)).lotes).toBe(1);
    expect(cuenta('estructura')).toBe(1);
    // Una tanda que falla no cuenta como hecha; el reintento la hace.
    fallar = true;
    await expect(pasoFichas(ctx, plan2, 0)).rejects.toThrow(/bloqueada/);
    fallar = false;
    expect((await pasoFichas(ctx, plan2, 0)).fichas).toBe(3);
    expect((await pasoFichas(ctx, plan2, 0)).fichas).toBe(0);
    expect(cuenta('fichas')).toBe(2);

    // Un error que llega al cierre deja el estado en «error» y la siguiente vez se empieza de cero.
    fallar = true;
    await expect(comprenderDocumento(ctx, 'cuento', { forzar: true })).rejects.toThrow(/bloqueada/);
    expect((await leerEstadoComprension(sql, 'cuento'))!).toMatchObject({ estado: 'error', error: expect.stringMatching(/bloqueada/) });
    fallar = false;
    const e = await comprenderDocumento(ctx, 'cuento');
    expect(e.estado).toBe('hecho');
    expect(e.error).toBeUndefined();

    // Presupuesto agotado: la tanda de fichas no llama al modelo y lo deja dicho.
    const pobre = await planificarComprension(ctx, 'cuento', { presupuestoUsd: 0, forzar: true });
    await pasoSegmentos(ctx, pobre);
    const antes = cuenta('fichas');
    await pasoFichas(ctx, pobre, 0);
    expect(cuenta('fichas')).toBe(antes);
    expect((await leerEstadoComprension(sql, 'cuento'))!.avisos.join(' ')).toMatch(/Presupuesto agotado/);
    archivo.cerrar();
  });

  it('sin modelo, queda dicho y no se toca nada', async () => {
    const { sql, archivo } = await base();
    await cuento(sql);
    const e = await comprenderDocumento(contexto(sql, null), 'cuento');
    expect(e.estado).toBe('sin_modelo');
    expect(await leerSegmentos(sql, 'cuento')).toEqual([]);
    archivo.cerrar();
  });
});

describe('comprensión: una película con su percepción', () => {
  const percepcion = { ...(percepcionFresa as unknown as PercepcionMedio), documento: 'pelicula' };
  const respuestasPelicula = {
    'estructura:secuencias': () => ({ secuencias: [{ titulo: 'Prólogo en la posada', desde: 0, hasta: 0, resumen: 'David y Vivian.' }, { titulo: 'Diego', desde: 1, hasta: 2, resumen: 'La boda y Coppelia.' }] }),
    fichas: (_p: PeticionComprension, texto: string) => ({
      fichas: pedidos(texto).map((s) => ({
        segmento: s, texto: `Escena ${s}: plano medio, Diego domina el encuadre.`, resumen_es: 'Coppelia', resumen_en: 'Coppelia',
        datos: { lugar: 'Coppelia', personajes: [{ nombre: 'Diego' }], accion: 'Diego aborda a David', funcionNarrativa: 'encuentro' },
        evidencias: [{ u: 3, cita: 'Me encanta la fresa' }, { t: 610, apoya: 'Diego con la copa de helado de fresa a la izquierda del encuadre' }],
      })),
    }),
    entidades: () => ({
      entidades: [
        { nombre: 'Diego', tipo: 'personaje', formas: ['Diego'], descripcion: 'Artista', importancia: 5, analisis: 'Diego, interpretado en la película…' },
        { nombre: 'David', tipo: 'personaje', formas: ['David'], descripcion: 'Estudiante', importancia: 5, analisis: 'David…' },
        { nombre: 'Vivian', tipo: 'personaje', formas: ['Vivian'], descripcion: 'Novia de David', importancia: 3 },
      ],
    }),
    global: () => ({
      texto: 'Película sobre la amistad.', resumen_es: 'r', resumen_en: 'r', sinopsis: 's', contexto: [],
      temas: [], motivos: [{ nombre: 'el helado de fresa', descripcion: 'd', formas: ['fresa'], apariciones: [{ t: 610, apoya: 'la copa de helado' }] }],
      datos: { estructura: 'e', narracion: 'n', montaje: 'm', personajes: [], sentido: 's' }, evidencias: [],
    }),
  };

  it('secuencias, escenas y planos; fichas de plano; quién se ve, dónde y cuándo; quién habla', async () => {
    const { sql, archivo } = await base();
    await cuento(sql);
    await pelicula(sql);
    const modelo = modeloFalso({ ...respuestasCuento, ...respuestasPelicula });
    await comprenderDocumento(contexto(sql, modelo), 'cuento');
    const e = await comprenderDocumento(contexto(sql, modelo, { percepcion: async (d) => (d === 'pelicula' ? percepcion : null) }), 'pelicula');
    expect(e.estado).toBe('hecho');
    expect(e.lentes).toEqual(['cine']);

    const segs = await leerSegmentos(sql, 'pelicula');
    expect(segs.filter((s) => s.nivel === 1).map((s) => [s.tipo, s.titulo])).toEqual([['secuencia', 'Prólogo en la posada'], ['secuencia', 'Diego']]);
    expect(segs.filter((s) => s.tipo === 'escena').map((s) => s.titulo)).toEqual(['La posada', 'La boda de Vivian', 'Coppelia']);
    const planos = segs.filter((s) => s.tipo === 'plano');
    expect(planos).toHaveLength(5);
    expect(planos.every((p) => p.nivel === 3 && p.ancla.tipo === 'tiempo')).toBe(true);
    // Las secuencias son los capítulos del reproductor.
    expect((await leerSecciones(sql, 'pelicula')).map((s) => s.titulo)).toEqual(['Prólogo en la posada', 'Diego']);

    // Fichas de plano sin modelo, con quién está en cuadro y dónde.
    const fp = await leerFichas(sql, { documento: 'pelicula', clase: 'plano' });
    expect(fp).toHaveLength(5);
    const coppelia = fp.find((f) => f.texto.startsWith('Plano medio con angulación normal y cámara fija, de 9:54'))!;
    expect(coppelia.texto).toMatch(/Composición: Diego entra por la izquierda/);
    expect(coppelia.evidencias.find((x) => x.cita?.startsWith('Diego'))!.ancla).toMatchObject({ tipo: 'tiempo', instante: 610, region: { x: 0.1, w: 0.45 } });

    // Fichas de escena: la cita del diálogo se estrecha a sus palabras; lo visual va con su instante.
    const fe = await leerFichas(sql, { documento: 'pelicula', clase: 'escena' });
    expect(fe.length).toBe(3);
    const cita = fe[0]!.evidencias.find((x) => x.cita === 'Me encanta la fresa')!;
    expect(cita.modo).toBe('video');
    expect(cita.ancla).toMatchObject({ tipo: 'tiempo', hablante: 'Diego' });
    if (cita.ancla.tipo !== 'tiempo') throw new Error('ancla de tiempo');
    // «Me encanta la fresa» son las palabras 5-8 (una cada 0,5 s desde 594,6; cada una dura 0,45 s).
    expect(cita.ancla.t0).toBeCloseTo(594.6 + 2.5, 2);
    expect(cita.ancla.t1).toBeCloseTo(594.6 + 4.45, 2);
    expect(fe[0]!.evidencias.find((x) => x.ancla.instante === 610)!.cita).toMatch(/copa de helado/);

    // Diego es la misma entidad en el cuento y en la película.
    const [diego] = await sql.ejecutar<{ id: string }>("SELECT id FROM entidades WHERE tipo = 'persona' AND clave = 'diego'");
    const ap = await leerApariciones(sql, { entidad: diego!.id });
    expect(new Set(ap.map((a) => a.documento))).toEqual(new Set(['cuento', 'pelicula']));
    const enPelicula = ap.filter((a) => a.documento === 'pelicula');
    const roles = new Set(enPelicula.map((a) => a.rol));
    expect(roles).toEqual(new Set(['habla', 'presente', 'visible']));
    const visible = enPelicula.find((a) => a.rol === 'visible' && a.ancla.instante === 610)!;
    expect(visible.ancla.region).toEqual({ x: 0.1, y: 0.15, w: 0.45, h: 0.8 });
    expect(segs.find((s) => s.id === visible.segmento)!.tipo).toBe('plano');
    // La voz: el turno de Diego en la unidad 4, con su tramo.
    const habla = enPelicula.filter((a) => a.rol === 'habla' && a.ancla.tipo === 'tiempo' && a.ancla.t0 >= 641);
    expect(habla.map((a) => a.forma)).toEqual(['Diego']);
    // El objeto y la canción percibidos también entran en el grafo.
    const [helado] = await sql.ejecutar<{ id: string }>("SELECT id FROM entidades WHERE clave = 'helado de fresa'");
    expect((await leerApariciones(sql, { entidad: helado!.id, documento: 'pelicula' })).some((a) => a.rol === 'visible' && a.ancla.region)).toBe(true);
    const [bolero] = await sql.ejecutar<{ id: string }>("SELECT id FROM entidades WHERE tipo = 'obra' AND clave = 'mi tormento'");
    expect((await leerApariciones(sql, { entidad: bolero!.id }))[0]).toMatchObject({ rol: 'audible' });

    // Actor ↔ personaje, desde la percepción (sin red no hay Wikidata).
    const [rel] = await sql.ejecutar<{ etiqueta: string }>('SELECT etiqueta FROM entidades_relaciones WHERE etiqueta LIKE ?', '%interpreta a Diego');
    expect(rel!.etiqueta).toBe('Jorge Perugorría interpreta a Diego');
    archivo.cerrar();
  });

  it('el reparto de Wikidata (P161 con P453) une actor y personaje y enlaza al actor', async () => {
    const { sql, archivo } = await base();
    await pelicula(sql);
    const llamadas: string[] = [];
    const fetchFalso = (async (url: string) => {
      llamadas.push(url);
      const u = new URL(url);
      const q = Object.fromEntries(u.searchParams);
      let cuerpo: unknown = {};
      if (q.action === 'wbsearchentities') cuerpo = { search: [{ id: 'Q1', description: 'película de 1993 dirigida por Tomás Gutiérrez Alea y Juan Carlos Tabío' }, { id: 'Q9', description: 'postre' }] };
      else if (q.props === 'claims') cuerpo = { entities: { Q1: { id: 'Q1', claims: {
        P577: [{ mainsnak: { datavalue: { value: { time: '+1993-12-01T00:00:00Z' } } } }],
        P161: [
          { mainsnak: { datavalue: { value: { id: 'Q10' } } }, qualifiers: { P453: [{ datavalue: { value: { id: 'Q20' } } }] } },
          { mainsnak: { datavalue: { value: { id: 'Q11' } } }, qualifiers: { P4633: [{ datavalue: { value: 'David' } }] } },
        ],
      } } } };
      else if (q.props === 'labels') cuerpo = { entities: { Q10: { id: 'Q10', labels: { es: { value: 'Jorge Perugorría' } } }, Q11: { id: 'Q11', labels: { es: { value: 'Vladimir Cruz' } } }, Q20: { id: 'Q20', labels: { es: { value: 'Diego' } } } } };
      return new Response(JSON.stringify(cuerpo), { status: 200 });
    }) as unknown as typeof fetch;
    const modelo = modeloFalso({ ...respuestasCuento, ...respuestasPelicula, estructura: () => ({ segmentos: [{ id: 's1', tipo: 'escena', titulo: 'Coppelia', desde: { u: 3, t: 594.6 }, hasta: { u: 4, t: 689 } }] }) });
    await comprenderDocumento(contexto(sql, modelo, { fetch: fetchFalso }), 'pelicula');
    expect(llamadas.some((x) => x.includes('wbsearchentities'))).toBe(true);
    const filas = await sql.ejecutar<{ etiqueta: string }>('SELECT etiqueta FROM entidades_relaciones ORDER BY etiqueta');
    expect(filas.map((f) => f.etiqueta)).toEqual(['Jorge Perugorría interpreta a Diego', 'Vladimir Cruz interpreta a David']);
    const [actor] = await sql.ejecutar<{ wikidata: string; ficticia: number }>("SELECT wikidata, ficticia FROM entidades WHERE clave = 'jorge perugorria'");
    expect(actor).toMatchObject({ wikidata: 'Q10', ficticia: 0 });
    const [diego] = await sql.ejecutar<{ wikidata: string }>("SELECT wikidata FROM entidades WHERE tipo = 'persona' AND clave = 'diego'");
    expect(diego!.wikidata).toBe('Q20');
    // Sin percepción, la estructura de la película la propone el modelo con sus segundos.
    const [s] = await leerSegmentos(sql, 'pelicula');
    expect(s!.ancla).toMatchObject({ tipo: 'tiempo', t0: 594.6, t1: 689 });
    const ficha = (await leerFichas(sql, { documento: 'pelicula', objetivo: 'entidad' })).find((f) => f.datos.nombre === 'Diego')!;
    expect(ficha.datos).toMatchObject({ actor: 'Jorge Perugorría', fuenteActor: 'wikidata' });
    archivo.cerrar();
  });

  it('las anclas de los medios: tramo de unas palabras y voz del turno', async () => {
    const { sql, archivo } = await base();
    await pelicula(sql);
    const m = await leerMaterial(sql, 'pelicula');
    const u3 = m.porOrden.get(3)!;
    expect(tramoDeCaracteres(u3, [0, 2])).toEqual([594.6, 595.05]);
    const e = anclarReferencia(m, { u: 4, cita: 'gente que no conozco' })!;
    expect(e.ancla).toMatchObject({ tipo: 'tiempo', hablante: 'David', t0: 641.8, t1: 689 });
    expect(e.cita).toBe('gente que no conozco');
    archivo.cerrar();
  });
});
