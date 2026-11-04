/**
 * Transmedia y transidioma sobre una base real (SPDF 4.2 + el esquema de las
 * funciones), con un modelo y un Wikidata falsos: detección de relaciones por
 * metadatos, contenido, Wikidata y entidades; relaciones del usuario; alineación
 * gruesa y fina con anclas en los dos lados; ficha de la relación; traducciones
 * párrafo a párrafo. Los textos son inventados (las obras reales tienen derechos).
 */
import type { Documento, PercepcionMedio, Segmento, SQL } from '@scholaris/nucleo';
import { aplicarEsquemaFunciones } from '@scholaris/funciones';
import { escribirApariciones, escribirDocumento, escribirSegmentos, escribirUnidades, leerAlineaciones, leerFichas, leerRelaciones, type UnidadSpdf } from '@scholaris/spdf';
import { describe, expect, it } from 'vitest';
import {
  actualizarEstado, alinearRelacion, alinearTraduccion, confirmarRelacion, crearRelacionUsuario, detectarRelaciones, galeChurch, leerEstadoAlineacion, materialObra,
  obraDe, obraWikidata, parrafosDe, pasoTransmedia, rechazarRelacion, senalesMetadatos,
  type ContextoComprension, type ModeloComprension, type PeticionComprension,
} from '../src/index.js';
import { baseReal, embebedorFalso } from './fakes.js';

const ahora = '2026-11-04T10:00:00.000Z';

function documento(id: string, tipo: Documento['tipo'], titulo: string, extra: Partial<Documento['metadatos']> = {}): Documento {
  return {
    id, tipo, metadatos: { titulo, autores: [{ nombre: 'Senel', apellidos: 'Paz' }], anio: 1991, idioma: 'es', ...extra }, estado: 'listo', huella: id.padEnd(64, '0'),
    original: '', mime: tipo === 'video' ? 'video/mp4' : 'application/pdf', bytes: 1, unidades: 3, creado: ahora, actualizado: ahora, bibliotecas: [],
  };
}

// Texto inventado con los nombres de los personajes (no es el del cuento).
const PAGINAS = [
  'Diego me vio en Coppelia comiendo helado de chocolate. Se sentó frente a mí con su helado de fresa y me dijo que tenía libros que yo no podía encontrar en ninguna parte.\n\nYo desconfié de él desde el primer momento.',
  'Al domingo siguiente fui a la Guarida. Diego me enseñó sus libros prohibidos y una foto de Lezama.\n\nHablamos de literatura hasta la noche, y el helado de fresa se derretía en la mesa.',
  'Cuando Diego se fue del país, volví solo a Coppelia y pedí helado de fresa.\n\nYa no era el mismo muchacho que desconfiaba de todo.',
];

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

// Diálogos inventados: solo los nombres son los de la película.
async function pelicula(sql: SQL, id = 'pelicula', extra: Partial<Documento['metadatos']> = {}) {
  await escribirDocumento(sql, { ...documento(id, 'video', 'Fresa y chocolate', { tipoCSL: 'motion_picture', anio: 1993, autores: [{ nombre: 'Tomás', apellidos: 'Gutiérrez Alea' }], ...extra }), duracion: 1200 });
  await escribirUnidades(sql, [
    { id: `${id}:u0`, documento: id, orden: 0, texto: '**Diego:** No me pude contener con el helado. La fresa es mi debilidad.', lector: 'asr', confianza: 1, ancla: { tipo: 'tiempo', t0: 100, t1: 140, hablante: 'Diego' } },
    { id: `${id}:u1`, documento: id, orden: 1, texto: '**David:** No voy a casa de desconocidos.\n\n**Diego:** Tengo libros que no vas a encontrar.', lector: 'asr', confianza: 1, ancla: { tipo: 'tiempo', t0: 140, t1: 200, hablante: 'David' } },
    { id: `${id}:u2`, documento: id, orden: 2, texto: '**Diego:** Esta es mi guarida. Mira esta foto de Lezama.', lector: 'asr', confianza: 1, ancla: { tipo: 'tiempo', t0: 400, t1: 460, hablante: 'Diego' } },
    { id: `${id}:u3`, documento: id, orden: 3, texto: '**Nancy:** ¿Y este muchacho quién es?', lector: 'asr', confianza: 1, ancla: { tipo: 'tiempo', t0: 700, t1: 720, hablante: 'Nancy' } },
    { id: `${id}:u4`, documento: id, orden: 4, texto: '**David:** Pedí fresa, como tú.', lector: 'asr', confianza: 1, ancla: { tipo: 'tiempo', t0: 1100, t1: 1130, hablante: 'David' } },
  ]);
}

const PERCEPCION: PercepcionMedio = {
  documento: 'pelicula', modelo: 'percepcion-falsa', version: 'p1', duracion: 1200, reparto: [{ nombre: 'Diego' }, { nombre: 'David' }, { nombre: 'Nancy' }], avisos: [],
  escenas: [
    { t0: 0, t1: 60, titulo: 'Créditos', personas: [], accion: 'Créditos.', dialogoClave: [], sonido: [], planos: [{ t0: 20, t1: 30, personas: [], objetos: [], textoEnPantalla: 'guion basado en el cuento El lobo, el bosque y el hombre nuevo', descripcion: 'Rótulo.' }] },
    {
      t0: 90, t1: 220, titulo: 'Coppelia', lugar: 'Coppelia', personas: ['Diego', 'David'], accion: 'Diego aborda a David en la heladería.', dialogoClave: [], sonido: [],
      planos: [{ t0: 90, t1: 130, escala: 'primer plano', personas: [{ nombre: 'Diego', region: { x: 0.5, y: 0.2, w: 0.3, h: 0.6 }, instante: 110 }], objetos: [{ nombre: 'copa de helado de fresa', region: { x: 0.4, y: 0.7, w: 0.1, h: 0.1 }, instante: 112 }], descripcion: 'Diego come su helado.' }],
    },
    { t0: 380, t1: 480, titulo: 'La guarida', personas: ['Diego', 'David'], accion: 'Primera visita.', dialogoClave: [], sonido: [], planos: [] },
    { t0: 690, t1: 730, titulo: 'Nancy', personas: ['Nancy', 'David'], accion: 'Nancy conoce a David.', dialogoClave: [], sonido: [], planos: [] },
    { t0: 1090, t1: 1140, titulo: 'Final en Coppelia', personas: ['David'], accion: 'David pide fresa.', dialogoClave: [], sonido: [], planos: [] },
  ],
};

function segmento(doc: string, orden: number, titulo: string, ancla: Segmento['ancla'], desde: string, hasta: string): Segmento {
  return { id: `${doc}:sg${orden}`, documento: doc, padre: null, nivel: 1, orden, tipo: 'escena', titulo, ancla, unidadDesde: desde, unidadHasta: hasta, origen: 'modelo', confianza: 0.9 };
}

/** Las dos obras «comprendidas»: segmentos y estado hecho. */
async function comprendidas(sql: SQL) {
  const pag = (f: number) => ({ tipo: 'pagina' as const, fisica: f, impresa: String(f + 4), romana: false, origen: 'leido' as const, confianza: 1 });
  await escribirSegmentos(sql, [
    segmento('cuento', 0, 'Coppelia', pag(1), 'cuento:u0', 'cuento:u0'),
    segmento('cuento', 1, 'La Guarida', pag(2), 'cuento:u1', 'cuento:u1'),
    segmento('cuento', 2, 'El regreso', pag(3), 'cuento:u2', 'cuento:u2'),
    segmento('pelicula', 0, 'Coppelia', { tipo: 'tiempo', t0: 90, t1: 220 }, 'pelicula:u0', 'pelicula:u1'),
    segmento('pelicula', 1, 'La guarida', { tipo: 'tiempo', t0: 380, t1: 480 }, 'pelicula:u2', 'pelicula:u2'),
    segmento('pelicula', 2, 'Nancy', { tipo: 'tiempo', t0: 690, t1: 730 }, 'pelicula:u3', 'pelicula:u3'),
    segmento('pelicula', 3, 'Final en Coppelia', { tipo: 'tiempo', t0: 1090, t1: 1140 }, 'pelicula:u4', 'pelicula:u4'),
  ]);
  for (const d of ['cuento', 'pelicula']) await actualizarEstado(sql, d, { estado: 'hecho', lentes: [d === 'cuento' ? 'narrativa' : 'cine'], version: 'comprension@2', huella: 'h' }, ahora);
}

/** Wikidata falso: el cuento y la película, con P144 y P58, y un homónimo que no es la película. */
function wikidataFalso(): typeof fetch & { pedidas: string[] } {
  const pedidas: string[] = [];
  const entidades: Record<string, unknown> = {
    Q1: { id: 'Q1', labels: { es: { value: 'Fresa y chocolate' } }, descriptions: { es: { value: 'película de 1993 dirigida por Tomás Gutiérrez Alea' } }, claims: {
      P31: [{ mainsnak: { datavalue: { value: { id: 'Q11424' } } } }], P58: [{ mainsnak: { datavalue: { value: { id: 'Q9' } } } }], P57: [{ mainsnak: { datavalue: { value: { id: 'Q8' } } } }],
      P577: [{ mainsnak: { datavalue: { value: { time: '+1993-12-00T00:00:00Z' } } } }], P144: [{ mainsnak: { datavalue: { value: { id: 'Q2' } } } }],
    } },
    Q2: { id: 'Q2', labels: { es: { value: 'El lobo, el bosque y el hombre nuevo' } }, descriptions: { en: { value: 'short story by Senel Paz' } }, claims: {} },
    Q3: { id: 'Q3', labels: { es: { value: 'Fresa y chocolate' } }, descriptions: { es: { value: 'postre' } }, claims: {} },
    Q8: { id: 'Q8', labels: { es: { value: 'Tomás Gutiérrez Alea' } }, claims: {} },
    Q9: { id: 'Q9', labels: { es: { value: 'Senel Paz' } }, claims: {} },
  };
  const f = (async (url: string | URL) => {
    const u = new URL(String(url));
    const accion = u.searchParams.get('action') ?? '';
    pedidas.push(accion);
    if (accion === 'wbsearchentities') {
      const q = u.searchParams.get('search') ?? '';
      const r = q.startsWith('Fresa')
        ? [{ id: 'Q1', label: 'Fresa y chocolate', description: 'película de 1993', match: { text: 'Fresa y chocolate' } }, { id: 'Q3', label: 'Fresa y chocolate', description: 'postre', match: { text: 'Fresa y chocolate' } }]
        : q.startsWith('El lobo') ? [{ id: 'Q2', label: 'El lobo, el bosque y el hombre nuevo', description: 'short story by Senel Paz', match: { text: q } }] : [];
      return new Response(JSON.stringify({ search: r }));
    }
    const id = u.searchParams.get('ids') ?? '';
    return new Response(JSON.stringify({ entities: entidades[id] ? { [id]: entidades[id] } : {} }));
  }) as unknown as typeof fetch & { pedidas: string[] };
  f.pedidas = pedidas;
  return f;
}

function modeloFalso(respuestas: Partial<Record<string, (p: PeticionComprension, texto: string) => unknown>>): ModeloComprension & { llamadas: PeticionComprension[] } {
  const llamadas: PeticionComprension[] = [];
  return {
    nombre: 'falso', llamadas,
    modelo: (c) => (c === 'alta' ? 'falso-alto' : 'falso-rapido'),
    async generar<T>(p: PeticionComprension) {
      llamadas.push(p);
      const texto = p.partes.map((x) => ('texto' in x ? x.texto : '')).join('\n');
      const r = respuestas[p.operacion];
      if (!r) throw new Error(`sin respuesta para ${p.operacion}`);
      return { json: r(p, texto) as T, uso: { modelo: this.modelo(p.calidad), tokensEntrada: 1000, tokensSalida: 200, usd: 0.01, ms: 5, llamadas: 1 } };
    },
  };
}

const ctxDe = (sql: SQL, modelo: ModeloComprension | null, extra: Partial<ContextoComprension> = {}): ContextoComprension => ({
  sql, modelo, embebedor: embebedorFalso, ahora: () => new Date(ahora), percepcion: async (d) => (d === 'pelicula' ? PERCEPCION : null), ...extra,
});

// ---------------------------------------------------------------------------
// Detección
// ---------------------------------------------------------------------------

describe('transmedia: detección de relaciones', () => {
  it('una película y el cuento que adapta: Wikidata (P144, P58) y los créditos en pantalla, con sus pruebas', async () => {
    const { sql } = await base();
    await cuento(sql); await pelicula(sql);
    const w = wikidataFalso();
    const r = await detectarRelaciones(ctxDe(sql, null, { fetch: w }), 'pelicula');
    expect(r.relaciones).toHaveLength(1);
    const rel = r.relaciones[0]!;
    expect(rel).toMatchObject({ origen: 'pelicula', destino: 'cuento', tipo: 'adaptacion_de', fuente: 'wikidata' });
    expect(rel.confianza).toBeGreaterThan(0.9);
    // La prueba de Wikidata lleva la URL del dato; la de los créditos, el segundo del rótulo.
    expect(rel.evidencias.some((e) => e.modo === 'dato' && e.ancla.tipo === 'web' && e.ancla.url.includes('Q1#P144'))).toBe(true);
    const creditos = rel.evidencias.find((e) => e.modo === 'video' && e.ancla.tipo === 'tiempo');
    expect(creditos?.ancla).toMatchObject({ t0: 20, t1: 30, instante: 25 });
    expect(rel.nota).toMatch(/^La película «Fresa y chocolate» \(Gutiérrez Alea, 1993\) adapta el cuento «El lobo, el bosque y el hombre nuevo»/);
    // La caché: la segunda pasada no vuelve a preguntar a Wikidata.
    const antes = w.pedidas.length;
    await detectarRelaciones(ctxDe(sql, null, { fetch: w }), 'pelicula');
    expect(w.pedidas.length).toBe(antes);
    expect(await leerRelaciones(sql)).toHaveLength(1);
  });

  it('sin Wikidata: el contenido declara la adaptación («basado en el cuento…»); y el homónimo de otro tipo no se enlaza', async () => {
    const { sql } = await base();
    await cuento(sql); await pelicula(sql);
    const r = await detectarRelaciones(ctxDe(sql, null), null, { wikidata: false });
    expect(r.relaciones).toMatchObject([{ origen: 'pelicula', destino: 'cuento', tipo: 'adaptacion_de', fuente: 'metadatos' }]);
    // Wikidata: «Fresa y chocolate» el postre no es la película.
    const w = await obraWikidata(wikidataFalso(), sql, obraDe(documento('p2', 'video', 'Fresa y chocolate', { anio: 1993, autores: [{ nombre: 'Tomás', apellidos: 'Gutiérrez Alea' }] })));
    expect(w?.qid).toBe('Q1');
    expect(w?.claims.P144).toEqual(['Q2']);
  });

  it('una traducción por sus metadatos (título original, traductor, lengua original)', () => {
    const original = obraDe(documento('o', 'pdf', 'Marianela', { autores: [{ nombre: 'Benito', apellidos: 'Pérez Galdós' }], idioma: 'es' }));
    const traduccion = obraDe(documento('t', 'pdf', 'Marianela: a story of Spanish love', {
      autores: [{ nombre: 'Benito', apellidos: 'Pérez Galdós' }], idioma: 'en', tituloOriginal: 'Marianela', idiomaOriginal: 'es', traductores: [{ nombre: 'Clara', apellidos: 'Bell' }],
    }));
    const s = senalesMetadatos(traduccion, original);
    expect(s).toEqual([expect.objectContaining({ tipo: 'traduccion_de', sentido: 'a' })]);
    expect(s[0]!.peso).toBeGreaterThan(0.9);
  });

  it('solo personajes comunes: decide el modelo (o no hay relación si dice que no)', async () => {
    const { sql } = await base();
    await escribirDocumento(sql, documento('n1', 'pdf', 'Novela primera', { autores: [{ nombre: 'Ana', apellidos: 'Ruiz' }] }));
    await escribirDocumento(sql, documento('n2', 'video', 'Otra cosa', { autores: [{ nombre: 'Luis', apellidos: 'Gil' }], anio: 2001 }));
    await sql.ejecutar("INSERT INTO entidades (id, tipo, clave, nombre, ficticia, creada, actualizada) VALUES ('e1','persona','marta','Marta',1,?,?), ('e2','persona','tomas','Tomás',1,?,?), ('e3','lugar','vigo','Vigo',0,?,?)", ahora, ahora, ahora, ahora, ahora, ahora);
    const aps = ['n1', 'n2'].flatMap((d) => ['e1', 'e2', 'e3'].flatMap((e) => [0, 1].map((k) => ({
      id: `${d}:${e}:${k}`, entidad: e, documento: d, ancla: d === 'n1' ? { tipo: 'pagina' as const, fisica: 1, impresa: '1', romana: false, origen: 'leido' as const, confianza: 1 } : { tipo: 'tiempo' as const, t0: k * 10, t1: k * 10 + 5 },
      forma: e, rol: 'nombrado' as const, confianza: 1,
    }))));
    await escribirApariciones(sql, aps);
    const si = modeloFalso({ 'transmedia:decidir': () => ({ relacion: true, tipo: 'adaptacion_de', origen: 'b', confianza: 0.8, nota: 'La película lleva a la pantalla a los personajes de la novela.' }) });
    const r = await detectarRelaciones(ctxDe(sql, si), 'n2', { wikidata: false });
    expect(r.relaciones).toMatchObject([{ origen: 'n2', destino: 'n1', tipo: 'adaptacion_de', fuente: 'modelo' }]);
    expect(si.llamadas[0]!.calidad).toBe('rapida');
    const no = modeloFalso({ 'transmedia:decidir': () => ({ relacion: false, tipo: 'relacionado', origen: 'a', confianza: 0.2, nota: 'Coinciden por azar.' }) });
    const r2 = await detectarRelaciones(ctxDe(sql, no), 'n2', { wikidata: false });
    expect(r2.relaciones).toHaveLength(0);
    // La relación detectada antes en ese par ya no se sostiene: fuera.
    expect(await leerRelaciones(sql)).toHaveLength(0);
  });

  it('el usuario manda: confirmar, crear y rechazar (lo rechazado no vuelve)', async () => {
    const { sql } = await base();
    await cuento(sql); await pelicula(sql);
    const [rel] = (await detectarRelaciones(ctxDe(sql, null), null, { wikidata: false })).relaciones;
    const confirmada = await confirmarRelacion(sql, rel!.id);
    expect(confirmada).toMatchObject({ fuente: 'usuario', confianza: 1 });
    // La detección no toca una relación del usuario.
    await detectarRelaciones(ctxDe(sql, null), null, { wikidata: false });
    expect((await leerRelaciones(sql))[0]).toMatchObject({ id: rel!.id, fuente: 'usuario' });
    // Rechazar: se borra y no vuelve.
    await rechazarRelacion(sql, rel!.id, ahora);
    await detectarRelaciones(ctxDe(sql, null), null, { wikidata: false });
    expect(await leerRelaciones(sql)).toHaveLength(0);
    // Crear a mano (otro tipo): queda la del usuario y se olvida el rechazo del par.
    const nueva = await crearRelacionUsuario(sql, { origen: 'pelicula', destino: 'cuento', tipo: 'version_de', nota: 'La trato como versión.' }, ahora);
    expect(nueva).toMatchObject({ fuente: 'usuario', tipo: 'version_de', confianza: 1, nota: 'La trato como versión.' });
    await expect(crearRelacionUsuario(sql, { origen: 'pelicula', destino: 'pelicula', tipo: 'cita_a' }, ahora)).rejects.toThrow(/consigo misma/);
    await expect(crearRelacionUsuario(sql, { origen: 'pelicula', destino: 'nada', tipo: 'cita_a' }, ahora)).rejects.toThrow(/No existe/);
  });
});

// ---------------------------------------------------------------------------
// Alineación
// ---------------------------------------------------------------------------

const respuestasAlineacion = {
  'transmedia:gruesa': () => ({
    correspondencias: [
      { a: ['a0'], b: ['b0'], tipo: 'transformado', nota: 'La película dramatiza el encuentro que el cuento narra en retrospectiva.', confianza: 0.9 },
      { a: ['a1'], b: ['b1'], tipo: 'condensado', nota: 'La visita se reduce a un plano.', confianza: 0.8 },
      { a: ['a2'], b: [], tipo: 'anadido', nota: 'Nancy no está en el cuento: la película le da una subtrama.', confianza: 0.9 },
      { a: ['a3'], b: ['b2'], tipo: 'equivalente', nota: 'El final en Coppelia se conserva.', confianza: 0.9 },
      { a: ['a9'], b: ['b7'], tipo: 'equivalente', nota: 'Ids que no existen: fuera.', confianza: 0.9 },
    ],
  }),
  'transmedia:fina': (_p: PeticionComprension, texto: string) => {
    if (!texto.includes('b0 «Coppelia»')) return { alineaciones: [] };
    return {
      alineaciones: [
        // Diálogo frente a narración, con las dos citas literales (una «arreglada» por el modelo, sin tildes).
        { tipo: 'transformado', a: { u: 0, cita: 'La fresa es mi debilidad' }, b: { u: 0, cita: 'Se sento frente a mi con su helado de fresa' }, nota: 'La narración en retrospectiva pasa a diálogo en presente: cambia la distancia.', confianza: 0.9 },
        // Lo visual: tramo, instante y lo que se ve (la región sale de la percepción).
        { tipo: 'equivalente', a: { t0: 105, t1: 118, t: 112, que: 'Primer plano de la copa de helado de fresa de Diego' }, b: { u: 0, cita: 'comiendo helado de chocolate' }, nota: 'El contraste de los helados pasa al encuadre.', confianza: 0.8 },
        // Una cita inventada: el lado se queda con el segmento y menos confianza.
        { tipo: 'equivalente', a: { u: 1, cita: 'una frase que nadie dice en la película' }, b: { u: 0, cita: 'tenía libros que yo no podía encontrar' }, nota: 'Los libros como cebo.', confianza: 0.9 },
        // Un tramo fuera de las escenas del grupo: no se cree.
        { tipo: 'anadido', a: { t0: 900, t1: 910, que: 'nada' }, nota: 'Inventado.', confianza: 0.5 },
        // Lo que el cuento tiene y la película no recoge.
        { tipo: 'suprimido', b: { u: 0, cita: 'Yo desconfié de él desde el primer momento' }, nota: 'La película no verbaliza la desconfianza.', confianza: 0.7 },
      ],
    };
  },
  'transmedia:ficha': () => ({
    texto: 'La película transforma el relato retrospectivo del cuento en una dramatización en presente.', resumen_es: 'Adaptación que dramatiza el cuento.', resumen_en: 'An adaptation that dramatizes the story.',
    modo: 'Transposición con amplificación de personajes secundarios.',
    cambios: [
      { aspecto: 'punto_de_vista', afirmacion: 'El narrador autodiegético desaparece: la cámara reparte la focalización.', a: [{ u: 0, cita: 'La fresa es mi debilidad' }], b: [{ u: 0, cita: 'Diego me vio en Coppelia' }] },
      { aspecto: 'final', afirmacion: 'Se conserva el gesto final de pedir fresa.', a: [{ u: 4, cita: 'Pedí fresa, como tú' }], b: [{ u: 99, cita: 'una cita que no existe en ninguna página' }] },
    ],
    personajes: [{ nombre: 'Nancy', cambio: 'anadido', nota: 'Personaje nuevo.', a: [{ u: 3, cita: '¿Y este muchacho quién es?' }], b: [] }],
    evidencias: [{ obra: 'B', u: 2, cita: 'volví solo a Coppelia y pedí helado de fresa' }],
  }),
};

describe('transmedia: alineación de una adaptación', () => {
  it('gruesa y fina con anclas en los dos lados, región del fotograma, citas comprobadas, ficha y estado', async () => {
    const { sql } = await base();
    await cuento(sql); await pelicula(sql); await comprendidas(sql);
    const modelo = modeloFalso(respuestasAlineacion);
    const ctx = ctxDe(sql, modelo);
    const t = await pasoTransmedia(ctx, 'pelicula', { wikidata: false, modelo: false });
    expect(t.relaciones).toBe(1);
    expect(t.porAlinear).toHaveLength(1);
    const id = t.porAlinear[0]!;
    const r = await alinearRelacion(ctx, id, { concurrencia: 1 });
    expect(r).toMatchObject({ estado: 'hecho', ficha: true });
    const als = await leerAlineaciones(sql, { relacion: id });
    // Ordenadas por el lado de la película.
    const tiempos = als.filter((x) => x.a?.ancla.tipo === 'tiempo').map((x) => (x.a!.ancla as { t0: number }).t0);
    expect(tiempos).toEqual([...tiempos].sort((x, y) => x - y));
    const dialogo = als.find((x) => x.nota.startsWith('La narración en retrospectiva'))!;
    expect(dialogo.a).toMatchObject({ documento: 'pelicula', segmento: 'pelicula:sg0' });
    expect(dialogo.a!.ancla).toMatchObject({ tipo: 'tiempo', caracteres: expect.any(Array) });
    // La cita del cuento se guarda tal como está (con sus tildes) y con sus caracteres exactos.
    expect(dialogo.b!.ancla).toMatchObject({ tipo: 'pagina', fisica: 1 });
    expect(Array.from(PAGINAS[0]!).slice(...dialogo.b!.ancla.caracteres!).join('')).toBe('Se sentó frente a mí con su helado de fresa');
    const visual = als.find((x) => x.nota.startsWith('El contraste'))!;
    expect(visual.a!.ancla).toMatchObject({ tipo: 'tiempo', t0: 105, t1: 118, instante: 112, region: { x: 0.4, y: 0.7, w: 0.1, h: 0.1 } });
    const cebo = als.find((x) => x.nota.startsWith('Los libros'))!;
    expect(cebo.confianza).toBeLessThan(0.6);
    expect(cebo.a!.ancla).toMatchObject({ tipo: 'tiempo', t0: 90, t1: 220 });
    expect(als.some((x) => x.nota === 'Inventado.')).toBe(false);
    expect(als.find((x) => x.tipo === 'suprimido')!.a).toBeUndefined();
    // Las gruesas sin detalle quedan como tales: el añadido de Nancy, la visita y el final.
    const anadido = als.find((x) => x.tipo === 'anadido' && x.id.includes(':g'))!;
    expect(anadido.b).toBeUndefined();
    expect(anadido.a).toMatchObject({ segmento: 'pelicula:sg2', ancla: { tipo: 'tiempo', t0: 690, t1: 730 } });
    expect(als.some((x) => x.nota.includes('Ids que no existen'))).toBe(false);
    // La ficha de la relación: de la biblioteca (sin documento), con pruebas en los dos lados.
    const [ficha] = await leerFichas(sql, { objetivo: 'relacion' });
    expect(ficha).toMatchObject({ documento: null, clase: 'adaptacion', lente: 'cine', objetivoId: id });
    const cambios = ficha!.datos.cambios as Array<{ aspecto: string; pruebas: { a: number[]; b: number[] }; inferido?: boolean }>;
    expect(cambios[0]!.pruebas.a.length).toBeGreaterThan(0);
    expect(cambios[0]!.pruebas.b.length).toBeGreaterThan(0);
    expect(cambios[1]).toMatchObject({ aspecto: 'final', inferido: true });
    expect(ficha!.datos.citasNoVerificadas).toBe(1);
    expect((ficha!.datos.personajes as Array<{ nombre: string; cambio: string }>)[0]).toMatchObject({ nombre: 'Nancy', cambio: 'anadido' });
    expect(ficha!.evidencias.every((e) => ['pelicula', 'cuento'].includes(e.documento))).toBe(true);
    // Estado con su coste; la segunda vez, al día y sin llamar al modelo.
    const e = await leerEstadoAlineacion(ctx, { id, origen: 'pelicula' });
    expect(e).toMatchObject({ estado: 'hecho', llamadas: 3, alineaciones: als.length });
    const llamadas = modelo.llamadas.length;
    expect((await alinearRelacion(ctx, id)).estado).toBe('al_dia');
    expect(modelo.llamadas.length).toBe(llamadas);
    expect((await pasoTransmedia(ctx, 'pelicula', { wikidata: false, modelo: false })).porAlinear).toEqual([]);
  });

  it('nunca afirma una ausencia de diálogo con huecos en la transcripción; y el cerrojo impide alinear dos veces a la vez', async () => {
    const { sql } = await base();
    await cuento(sql); await pelicula(sql); await comprendidas(sql);
    // Un hueco grande en la escena de Coppelia (90-220 s): fuera la segunda unidad y la primera acaba antes.
    await sql.ejecutar("DELETE FROM unidades WHERE id = 'pelicula:u1'");
    await sql.ejecutar("UPDATE unidades SET ancla = json_set(ancla, '$.t1', 105), t1 = 105 WHERE id = 'pelicula:u0'");
    const modelo = modeloFalso(respuestasAlineacion);
    const ctx = ctxDe(sql, modelo);
    const { porAlinear: [id] } = await pasoTransmedia(ctx, 'pelicula', { wikidata: false, modelo: false });
    const r = await alinearRelacion(ctx, id!, { concurrencia: 1, ficha: false });
    expect(r.estado).toBe('hecho');
    const sup = (await leerAlineaciones(sql, { relacion: id! })).find((x) => x.tipo === 'suprimido' && x.id.includes(':f'))!;
    expect(sup.confianza).toBeLessThanOrEqual(0.45);
    expect(sup.nota).toMatch(/Cautela: la transcripción .* tiene huecos/);
    // Otra instancia con el cerrojo tomado (y vivo): esta no alinea.
    const ya = new Date().toISOString();
    await sql.ejecutar("UPDATE procedencia SET detalle = json_set(detalle, '$.estado', 'en_marcha', '$.instancia', 'otra', '$.actualizado', ?), cuando = ? WHERE fase LIKE 'transmedia:alineacion:%'", ya, ya);
    expect((await alinearRelacion(ctxDe(sql, modelo, { ahora: () => new Date(ya) }), id!, { forzar: true, instancia: 'esta' })).estado).toBe('ocupada');
  });

  it('sin modelo: la gruesa por posición, sin ficha', async () => {
    const { sql } = await base();
    await cuento(sql); await pelicula(sql); await comprendidas(sql);
    const ctx = ctxDe(sql, null);
    const { porAlinear: [id] } = await pasoTransmedia(ctx, 'pelicula', { wikidata: false });
    const r = await alinearRelacion(ctx, id!);
    expect(r).toMatchObject({ estado: 'hecho', ficha: false });
    const als = await leerAlineaciones(sql, { relacion: id! });
    expect(als).toHaveLength(3);
    expect(als.every((x) => x.a && x.b && x.confianza <= 0.3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Traducciones
// ---------------------------------------------------------------------------

// Dominio público: Pérez Galdós, «Marianela» (1878), y una traducción inglesa de prueba.
const ORIGINAL = [
  'Se puso el sol. Tras el breve crepúsculo vino tranquila y oscura la noche, en cuyo negro seno murieron poco a poco los últimos rumores de la tierra soñolienta.',
  'El viajero siguió adelante en su camino.',
  'Apresuró el paso, y mientras más andaba, más se convencía de que estaba perdido en aquellas soledades.',
];
const TRADUCCION = [
  'The sun went down. After the brief twilight came the night, calm and dark, in whose black bosom the last murmurs of the drowsy earth died away little by little.',
  'The traveller went on his way. He quickened his pace, and the more he walked, the more convinced he became that he was lost in that solitude.',
];

describe('transidioma: traducciones párrafo a párrafo', () => {
  it('Gale y Church empareja por longitudes (1-1 y 2-1)', () => {
    expect(galeChurch([150, 40, 100], [160, 150])).toEqual([{ a: [0], b: [0] }, { a: [1, 2], b: [1] }]);
    expect(galeChurch([100], [])).toEqual([{ a: [0], b: [] }]);
  });

  it('alinea la traducción con el original con anclas exactas de párrafo en las dos lenguas, y el modelo corrige', async () => {
    const { sql } = await base();
    await escribirDocumento(sql, documento('es', 'pdf', 'Marianela', { autores: [{ nombre: 'Benito', apellidos: 'Pérez Galdós' }], anio: 1878 }));
    await escribirDocumento(sql, documento('en', 'pdf', 'Marianela', { autores: [{ nombre: 'Benito', apellidos: 'Pérez Galdós' }], anio: 1892, idioma: 'en', tituloOriginal: 'Marianela', idiomaOriginal: 'es', traductores: [{ nombre: 'Clara', apellidos: 'Bell' }] }));
    const pag = (f: number) => ({ tipo: 'pagina' as const, fisica: f, impresa: String(f), romana: false, origen: 'leido' as const, confianza: 1 });
    await escribirUnidades(sql, [
      { id: 'es:u0', documento: 'es', orden: 0, texto: ORIGINAL.join('\n\n'), lector: 'prueba', confianza: 1, ancla: pag(1) },
      { id: 'en:u0', documento: 'en', orden: 0, texto: TRADUCCION.join('\n\n'), lector: 'prueba', confianza: 1, ancla: pag(1) },
    ]);
    // Sin comprensión: una traducción entre textos se alinea igual (por párrafos).
    const ctx = ctxDe(sql, null);
    const t = await pasoTransmedia(ctx, 'en', { wikidata: false });
    expect(t.porAlinear).toHaveLength(1);
    const [rel] = await leerRelaciones(sql);
    expect(rel).toMatchObject({ origen: 'en', destino: 'es', tipo: 'traduccion_de' });
    const a = await materialObra(ctx, 'en', 'A'), b = await materialObra(ctx, 'es', 'B');
    expect(parrafosDe(b).map((p) => p.id)).toEqual(['B1', 'B2', 'B3']);
    const sin = await alinearTraduccion(rel!, a, b, null, { uso: { modelo: '', tokensEntrada: 0, tokensSalida: 0, usd: 0, ms: 0, llamadas: 0 } }, { calidad: 'rapida', concurrencia: 1, presupuestoUsd: 1 });
    expect(sin.alineaciones.map((x) => x.tipo)).toEqual(['traducido', 'traducido']);
    const segunda = sin.alineaciones[1]!;
    // El segundo párrafo inglés traduce dos del original: ancla y ancla de cierre exactas.
    expect(Array.from(TRADUCCION.join('\n\n')).slice(...segunda.a!.ancla.caracteres!).join('')).toBe(TRADUCCION[1]);
    expect(Array.from(ORIGINAL.join('\n\n')).slice(...segunda.b!.ancla.caracteres!).join('')).toBe(ORIGINAL[1]);
    expect(Array.from(ORIGINAL.join('\n\n')).slice(...segunda.b!.anclaFin!.caracteres!).join('')).toBe(ORIGINAL[2]);
    // Con modelo: corrige la propuesta y anota un desplazamiento.
    const modelo = modeloFalso({
      'transmedia:parrafos': () => ({ grupos: [
        { a: ['A1'], b: ['B1'], tipo: 'traducido', nota: '' },
        { a: ['A2'], b: ['B2', 'B3'], tipo: 'condensado', nota: 'La traducción une dos párrafos y explicita el sujeto.' },
      ] }),
    });
    const con = await alinearRelacion(ctxDe(sql, modelo), rel!.id, { ficha: false, calidad: 'rapida' });
    expect(con.estado).toBe('hecho');
    const als = await leerAlineaciones(sql, { relacion: rel!.id });
    expect(als.map((x) => [x.tipo, x.nota])).toEqual([['traducido', 'Traducción sin desplazamientos notables.'], ['condensado', 'La traducción une dos párrafos y explicita el sujeto.']]);
  });
});
