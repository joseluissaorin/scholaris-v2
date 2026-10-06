import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Ancla, SQL } from '@scholaris/nucleo';
import {
  buscarEntidades, buscarFormas, caminoEntidades, calcularAristas, claveEntidad, contextoMencion, decidirFusiones, elegirCandidato,
  entidadesDocumento, entidadesLector, extraerEntidadesDocumento, fichaEntidad, formarLotes, leerRespuesta, lineaTemporalEntidad,
  localizarMenciones, rangosExcluidos, reanudarEntidades, rutasFunciones, sinSolapes, vecindarioEntidad,
  type PuertosFunciones,
} from '../src/index.js';
import { alBorrarDocumento, alIngerirDocumento } from '../src/ciclo.js';
import { estanteria, puertos, redactorFalso, sembrar } from './ayudas.js';

afterEach(() => { vi.unstubAllGlobals(); });

// ---------------------------------------------------------------------------
// Piezas puras
// ---------------------------------------------------------------------------

describe('normalizar y localizar', () => {
  it('claves: sin diacríticos, sin tratamientos ni artículos de obra', () => {
    expect(claveEntidad('Julio Cortázar', 'persona')).toBe('julio cortazar');
    expect(claveEntidad('Sr. Cortazar', 'persona')).toBe('cortazar');
    expect(claveEntidad('El perseguidor', 'obra')).toBe(claveEntidad('perseguidor', 'obra'));
    expect(claveEntidad('1959-03', 'fecha')).toBe('1959-03');
  });

  it('busca formas con límites de palabra, mayúsculas en nombres propios y sin la etiqueta del hablante', () => {
    // Personas inventadas.
    const t = '**Ana Prieto:** Hola.\nAnita llegó; una anita no. Ana Prieto era Anita.';
    const ex = rangosExcluidos(t);
    const cs = buscarFormas(t, ['Ana Prieto', 'Anita'], true, ex);
    expect(cs.map((c) => t.slice(c.ini, c.fin))).toEqual(['Ana Prieto', 'Anita', 'Anita']);
    expect(buscarFormas('Anitalandia', ['Anita'], true)).toEqual([]);
    expect(buscarFormas('el Gnosticismo y el gnosticismo', ['gnosticismo'], false)).toHaveLength(2);
    // Los espacios casan con saltos de línea.
    expect(buscarFormas('Julio\nCortázar', ['Julio Cortázar'], true)).toHaveLength(1);
  });

  it('sin solapes gana la forma más larga; el contexto marca la mención', () => {
    const cs = sinSolapes([{ ini: 0, fin: 14 }, { ini: 8, fin: 14 }, { ini: 20, fin: 26 }]);
    expect(cs).toEqual([{ ini: 0, fin: 14 }, { ini: 20, fin: 26 }]);
    const c = contextoMencion('Antes de todo, cuando leí la biografía de **Ana Prieto** lo supe.', 44, 54, 20);
    expect(c).toContain('⟦Ana Prieto⟧');
    expect(c.startsWith('…')).toBe(true);
  });

  it('lee la respuesta del redactor con tipos de una letra y descarta lo raro', () => {
    expect(leerRespuesta({ e: [{ n: ' Charlie  Parker ', t: 'p', f: ['Parker', 'Parker', ''] }, { n: 'x', t: 'z', f: [] }, { n: '', t: 'p', f: [] }] }))
      .toEqual([{ nombre: 'Charlie Parker', tipo: 'persona', formas: ['Parker'] }]);
    expect(leerRespuesta(null)).toEqual([]);
    // El formato compacto de una línea por entidad; «q» es un personaje de ficción.
    expect(leerRespuesta({ e: ['p|Julio Cortázar|Cortázar|Julio Cortázar', 'q|Johnny Carter|Johnny', 'f|1959', 'x|Nada', '|'] })).toEqual([
      { nombre: 'Julio Cortázar', tipo: 'persona', formas: ['Cortázar'] },
      { nombre: 'Johnny Carter', tipo: 'persona', formas: ['Johnny'], ficticia: true },
      { nombre: '1959', tipo: 'fecha', formas: [] },
    ]);
  });

  it('lotes deterministas por caracteres y menciones localizadas en el lote', () => {
    const fs = [0, 1, 2, 3].map((i) => ({ id: `f${i}`, orden: i, texto: i === 2 ? 'Parker y Charlie Parker' : 'x'.repeat(50), ancla: { tipo: 'pagina' as const, fisica: i + 1 } as unknown as Ancla }));
    const lotes = formarLotes(fs, 110);
    expect(lotes.map((l) => l.fragmentos.map((f) => f.id))).toEqual([['f0', 'f1'], ['f2', 'f3']]);
    expect(formarLotes(fs, 110)).toEqual(lotes);
    const ms = localizarMenciones(lotes[1]!, [{ nombre: 'Charlie Parker', tipo: 'persona', formas: ['Parker'] }]);
    expect(ms.map((m) => [m.texto, m.ini])).toEqual([['Parker', 0], ['Charlie Parker', 9]]);
    expect(ms[0]!.ancla).toEqual({ tipo: 'pagina', fisica: 3 });
  });

  it('aristas: más peso cuanto más cerca; contiguos pesan poco', () => {
    const as = calcularAristas([
      { entidad: 'a', orden: 0, fragmento: 'f0', ini: 0, fin: 5 },
      { entidad: 'b', orden: 0, fragmento: 'f0', ini: 6, fin: 10 },
      { entidad: 'c', orden: 0, fragmento: 'f0', ini: 2000, fin: 2005 },
      { entidad: 'd', orden: 1, fragmento: 'f1', ini: 0, fin: 5 },
    ]);
    const peso = (x: string, y: string) => as.find((e) => e.a === x && e.b === y)?.peso ?? 0;
    expect(peso('a', 'b')).toBeGreaterThan(0.95);
    expect(peso('a', 'c')).toBeLessThan(0.45);
    expect(peso('a', 'd')).toBeCloseTo(0.15);
    expect(as.find((e) => e.a === 'a' && e.b === 'b')!.fragmento).toBe('f0');
  });

  it('fusiones: apellido suelto solo si comparte documento; alias; Wikidata', () => {
    const c = (id: string, clave: string, docs: string[], extra: Partial<{ alias: string[]; wikidata: string; tipo: any; menciones: number }> = {}) => ({
      id, tipo: extra.tipo ?? 'persona', clave, palabras: clave.split(' '), alias: extra.alias ?? [], wikidata: extra.wikidata ?? null, menciones: extra.menciones ?? 3, docs: new Set(docs), nombre: clave,
    });
    const f = decidirFusiones([
      c('cp', 'charlie parker', ['entrevista'], { alias: ['Bird', 'Dedee'] }),
      c('dedee', 'dedee', ['entrevista'], { menciones: 60 }),
      c('horace', 'horace', ['discarded']),
      c('hw', 'horace walpole', ['discarded']),
      c('p1', 'parker', ['entrevista']),
      c('p2', 'parker', ['discarded']),
      c('bird', 'bird', ['perseguidor']),
      c('jc', 'julio cortazar', ['entrevista']),
      c('jfc', 'julio florencio cortazar', ['otro']),
      c('x1', 'el perseguidor', ['a'], { tipo: 'obra', wikidata: 'Q1' }),
      c('x2', 'the pursuer', ['b'], { tipo: 'obra', wikidata: 'Q1' }),
    ]);
    const m = Object.fromEntries(f);
    expect(m.p1).toBe('cp');
    expect(m.p2).toBeUndefined();
    expect(m.jc).toBe('jfc');
    expect(m.x2 ?? m.x1).toBeDefined();
    // «Bird» es alias de Charlie Parker pero de una sola palabra y sin documento común: no se fusiona a ciegas.
    expect(m.bird).toBeUndefined();
    // Una forma suelta no arrastra a una entidad con vida propia, ni un nombre de pila a quien lo comparte.
    expect(m.dedee).toBeUndefined();
    expect(m.horace).toBeUndefined();
  });

  it('Wikidata: solo coincidencia exacta con descripción compatible', () => {
    const cs = [
      { id: 'Q1', etiqueta: 'Parker', descripcion: 'apellido' },
      { id: 'Q2', etiqueta: 'Charlie Parker', descripcion: 'página de desambiguación de Wikimedia' },
      { id: 'Q103767', etiqueta: 'Charlie Parker', descripcion: 'saxofonista estadounidense de jazz' },
    ];
    expect(elegirCandidato('Charlie Parker', 'persona', cs)?.id).toBe('Q103767');
    expect(elegirCandidato('Parker', 'persona', cs)).toBeNull();
    expect(elegirCandidato('Charlie Parker', 'obra', [{ id: 'Q9', etiqueta: 'Charlie Parker', descripcion: 'ciudad de Texas' }])).toBeNull();
    // Personajes de ficción, sin enlace; personas reales nunca con personajes; obras solo si lo son.
    const johnny = [{ id: 'Q1', etiqueta: 'Johnny Carter', descripcion: 'cantante estadounidense' }, { id: 'Q2', etiqueta: 'Johnny Carter', descripcion: 'personaje de El perseguidor' }];
    expect(elegirCandidato('Johnny Carter', 'persona', johnny, true)).toBeNull();
    expect(elegirCandidato('Johnny Carter', 'persona', johnny.slice(1))).toBeNull();
    expect(elegirCandidato('Amorous', 'obra', [{ id: 'Q3', etiqueta: 'Amorous', descripcion: 'videojuego de 2018' }])).toBeNull();
    // Sin pistas de autor, una obra no se enlaza (si hay duda, no); con ellas, sí.
    expect(elegirCandidato('Rayuela', 'obra', [{ id: 'Q4', etiqueta: 'Rayuela', descripcion: 'novela de Julio Cortázar' }])).toBeNull();
    expect(elegirCandidato('Rayuela', 'obra', [{ id: 'Q4', etiqueta: 'Rayuela', descripcion: 'novela de Julio Cortázar' }], false, { apellidos: ['Cortázar'], anios: [1963] })?.id).toBe('Q4');
  });
});

// ---------------------------------------------------------------------------
// De punta a punta, con un redactor falso y un Wikidata falso
// ---------------------------------------------------------------------------
//
// Tres documentos reales con su texto literal:
//   - «A Day with Dr. Conan Doyle», entrevista de Harry How en The Strand Magazine, vol. 4, agosto de 1892:
//     https://en.wikisource.org/wiki/The_Strand_Magazine/Volume_4/Issue_20/A_Day_with_Dr._Conan_Doyle
//   - «The Adventures of Sherlock Holmes» (Newnes, 1892): la dedicatoria a Joseph Bell, de la primera edición
//     en Internet Archive (https://archive.org/details/adventuresofsher001892doyl), y el segundo párrafo de
//     «A Scandal in Bohemia», de Project Gutenberg n.º 1661;
//   - Darwin, «The Expression of the Emotions in Man and Animals» (1872), introducción, Project Gutenberg n.º 1227.
// Joseph Bell, el maestro de Conan Doyle, es la persona real; Sherlock Holmes, el personaje que inspiró;
// Charles Bell, otro Bell. Los folios (11, 12…) son los de esta copia de prueba.

/** El «redactor»: reconoce lo que un catalogador reconocería en estos textos. */
const CATALOGO: Array<{ si: RegExp; e: { n: string; t: string; f: string[] } }> = [
  { si: /Joseph Bell|Bell/, e: { n: 'Joseph Bell', t: 'p', f: ['Joseph Bell', 'Bell'] } },
  { si: /JOSEPH BELL/, e: { n: 'Joseph Bell', t: 'p', f: ['JOSEPH BELL'] } },
  { si: /Doyle/, e: { n: 'Arthur Conan Doyle', t: 'p', f: ['Doyle', 'Conan Doyle'] } },
  { si: /Holmes/, e: { n: 'Sherlock Holmes', t: 'q', f: ['Holmes'] } },
  { si: /Edinburgh/, e: { n: 'Edinburgh', t: 'l', f: ['Edinburgh'] } },
  { si: /1859/, e: { n: '1859', t: 'f', f: ['1859'] } },
  { si: /Charles Bell/, e: { n: 'Charles Bell', t: 'p', f: ['Charles Bell', 'C. Bell'] } },
  { si: /Donders/, e: { n: 'Donders', t: 'p', f: ['Donders'] } },
];

function redactorCatalogo(fallarSi?: RegExp) {
  return redactorFalso((texto) => {
    if (texto.includes(' · B = ')) {
      // Relaciones: «A fue alumno de B» cuando el pasaje habla del puesto de «clerk».
      const pares = texto.split(/\n\n(?=\[\d+\])/);
      return { r: pares.map((p, i) => ({ i: i + 1, e: /clerk/.test(p) && /Joseph Bell/.test(p) && /Doyle/.test(p) ? 'Arthur Conan Doyle fue alumno de Joseph Bell' : '' })) };
    }
    if (fallarSi?.test(texto)) throw new Error('el proveedor se ha caído');
    // En el libro de Darwin, «Bell» es Charles Bell, no el maestro de Conan Doyle.
    const darwin = texto.includes('Expression of the Emotions');
    return { e: CATALOGO.filter((c) => c.si.test(texto) && !(darwin && c.e.n === 'Joseph Bell')).map((c) => c.e) };
  });
}

function wikidataFalso() {
  const llamadas: string[] = [];
  const f = (async (url: string) => {
    const busqueda = new URL(url).searchParams.get('search') ?? '';
    llamadas.push(busqueda);
    const datos: Record<string, unknown[]> = {
      'Joseph Bell': [{ id: 'Q648680', label: 'Joseph Bell', description: 'médico y profesor escocés' }],
      'Arthur Conan Doyle': [{ id: 'Q35610', label: 'Arthur Conan Doyle', description: 'escritor británico (1859-1930)' }],
    };
    return new Response(JSON.stringify({ search: datos[busqueda] ?? [] }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

async function biblioteca() {
  const sql = await estanteria();
  await sembrar(sql, {
    id: 'entrevista', titulo: 'A Day with Dr. Conan Doyle', autores: [['Harry', 'How']], anio: 1892, paginas: [
      "Dr. Doyle was born in Edinburgh in 1859.",
      "I looked at the portrait. It represented the features of Mr. Joseph Bell, M.D., whose name I had heard mentioned whilst with Professor Blackie a few months ago in the Scotch capital.\n\n\"I was clerk in Mr. Bell's ward,\" continued Dr. Doyle.",
    ],
  });
  await sembrar(sql, {
    id: 'aventuras', titulo: 'The Adventures of Sherlock Holmes', autores: [['Arthur Conan', 'Doyle']], anio: 1892, paginas: [
      "MY OLD TEACHER, JOSEPH BELL, M.D., &c. OF 2, MELVILLE CRESCENT, EDINBURGH.\n\nI had seen little of Holmes lately.",
      "My marriage had drifted us away from each other. My own complete happiness, and the home-centred interests which rise up around the man who first finds himself master of his own establishment, were sufficient to absorb all my attention, while Holmes, who loathed every form of society with his whole Bohemian soul, remained in our lodgings in Baker Street, buried among his old books, and alternating from week to week between cocaine and ambition, the drowsiness of the drug, and the fierce energy of his own keen nature.",
    ],
  });
  await sembrar(sql, {
    id: 'expresion', titulo: 'The Expression of the Emotions in Man and Animals', autores: [['Charles', 'Darwin']], anio: 1872, paginas: [
      "Sir Charles Bell, so illustrious for his discoveries in physiology, published in 1806 the first edition, and in the third edition of his ‘Anatomy and Philosophy of Expression.’[4] He may with justice be said, not only to have laid the foundations of the subject as a branch of science, but to have built up a noble structure. His work is in every way deeply interesting; it includes graphic descriptions of the various emotions, and is admirably illustrated. It is generally admitted that his service consists chiefly in having shown the intimate relation which exists between the movements of expression and those of respiration. One of the most important points, small as it may at first appear, is that the muscles round the eyes are involuntarily contracted during violent expiratory efforts, in order to protect these delicate organs from the pressure of the blood. This fact, which has been fully investigated for me with the greatest kindness by Professors Donders of Utrecht, throws, as we shall hereafter see, a flood of light on several of the most important expressions of the human countenance. The merits of Sir C. Bell’s work have been undervalued or quite ignored by several foreign writers, but have been fully admitted by some, for instance by M. Lemoine,[5] who with great justice says:—“Le livre de Ch. Bell devrait être médité par quiconque essaye de faire parler le visage de l’homme, par les philosophes aussi bien que par les artistes, car, sous une apparence plus légère et sous le prétexte de l’esthétique, c’est un des plus beaux monuments de la science des rapports du physique et du moral.”",
    ],
  });
  return sql;
}

async function extraerTodo(p: PuertosFunciones, w = wikidataFalso()) {
  for (const d of ['entrevista', 'aventuras', 'expresion']) {
    await extraerEntidadesDocumento(p, d, { wikidata: { fetch: w.f, pausa: 0 }, concurrencia: 2 });
  }
  return w;
}

async function idDe(sql: SQL, nombre: string): Promise<string> {
  const r = await buscarEntidades(sql, { q: nombre });
  const e = r.elementos.find((x) => x.nombre === nombre);
  if (!e) throw new Error(`no está ${nombre}`);
  return e.id;
}

describe('grafo de entidades de la biblioteca', () => {
  it('la pasada de todo el documento añade lo que el redactor calló en otro lote, sin duplicar', async () => {
    const sql = await estanteria();
    // «The Adventures of Sherlock Holmes», literal de Project Gutenberg n.º 1661 («A Scandal in Bohemia» y
    // «The Boscombe Valley Mystery»); la tercera página, de relleno.
    await sembrar(sql, { id: 'd', titulo: 'Novela', paginas: ['To Sherlock Holmes she is always the woman.', 'I did not wonder at Lestrade’s opinion, and yet I had so much faith in Sherlock Holmes’ insight that I could not lose hope as long as every fresh fact seemed to strengthen his conviction of young McCarthy’s innocence. It was late before Sherlock Holmes returned.', 'Nada.'] });
    const redactor = redactorFalso((t) => (t.includes(' · B = ') ? { r: [] } : { e: t.includes('she is always') ? ['q|Sherlock Holmes'] : [] }));
    const p = puertos(sql, { inteligencia: { redactor } });
    await extraerEntidadesDocumento(p, 'd', { caracteresLote: 30, wikidata: false });
    const filas = await sql.ejecutar<{ orden: number }>('SELECT orden FROM menciones ORDER BY orden, ini');
    expect(filas.map((f) => f.orden)).toEqual([0, 1, 1]);
    const { completarMenciones, obtenerEntidad } = await import('../src/entidades/resolver.js');
    // Enlazado antes con una película homónima: al saberse que es un personaje, se desenlaza.
    await sql.ejecutar("UPDATE entidades SET wikidata = 'Q200396', descripcion = 'película de 2009 dirigida por Guy Ritchie'");
    await obtenerEntidad(sql, 'persona', 'Sherlock Holmes', [], true);
    expect(await sql.ejecutar('SELECT wikidata, descripcion FROM entidades')).toEqual([{ wikidata: null, descripcion: 'personaje de ficción' }]);
    const frs = (await sql.ejecutar<{ id: string; orden: number; texto: string; ancla: string }>('SELECT id, orden, texto, ancla FROM fragmentos')).map((f) => ({ ...f, ancla: JSON.parse(f.ancla) }));
    expect(await completarMenciones(sql, 'd', frs)).toBe(0);
  });


  it('extrae, resuelve, enlaza con Wikidata y teje el grafo entre documentos', async () => {
    const sql = await biblioteca();
    const redactor = redactorCatalogo();
    const p = puertos(sql, { inteligencia: { redactor } });
    const w = await extraerTodo(p);

    const bell = await fichaEntidad(sql, await idDe(sql, 'Joseph Bell'));
    expect(bell.wikidata).toBe('Q648680');
    expect(bell.descripcion).toBe('médico y profesor escocés');
    expect(bell.documentos).toBe(2);
    expect(bell.porDocumento.map((d) => d.documento).sort()).toEqual(['aventuras', 'entrevista']);
    const enEntrevista = bell.porDocumento.find((d) => d.documento === 'entrevista')!;
    expect(enEntrevista.menciones.map((m) => m.texto)).toEqual(['Joseph Bell', 'Bell']);
    expect(enEntrevista.menciones[0]!.etiqueta).toBe('p. 12');
    expect(enEntrevista.menciones[0]!.unidad).toBe(1);
    expect(enEntrevista.menciones[0]!.contexto).toContain('⟦Joseph Bell⟧');
    const enNovela = bell.porDocumento.find((d) => d.documento === 'aventuras')!;
    expect(enNovela.menciones[0]!.texto).toBe('JOSEPH BELL');
    // «JOSEPH BELL» es el mismo nombre en mayúsculas: casa con la entidad, pero no es un alias aparte.
    expect(bell.alias).toEqual(expect.arrayContaining(['Bell']));

    // El Bell de Darwin es otro.
    const charles = await fichaEntidad(sql, await idDe(sql, 'Charles Bell'));
    expect(charles.porDocumento.map((d) => d.documento)).toEqual(['expresion']);
    expect(charles.menciones).toBe(2);

    // Vecinos con la relación nombrada.
    const doyle = await idDe(sql, 'Arthur Conan Doyle');
    const v = bell.vecinos.find((x) => x.entidad.id === doyle)!;
    expect(v).toBeDefined();
    expect(v.relacion).toBe('Arthur Conan Doyle fue alumno de Joseph Bell');

    // Camino: Conan Doyle → Joseph Bell → Sherlock Holmes (de la entrevista al libro).
    const holmes = await idDe(sql, 'Sherlock Holmes');
    const camino = await caminoEntidades(sql, doyle, holmes);
    expect(camino.pasos.map((x) => x.entidad.nombre)).toEqual(['Arthur Conan Doyle', 'Joseph Bell', 'Sherlock Holmes']);
    expect(camino.pasos[1]!.via!.documento).toBe('entrevista');
    expect(camino.pasos[2]!.via!.documento).toBe('aventuras');
    expect(camino.pasos[2]!.via!.etiqueta).toBe('p. 11');
    const donders = await idDe(sql, 'Donders');
    expect((await caminoEntidades(sql, doyle, donders)).pasos).toEqual([]);

    // Vecindario para dibujar.
    const vec = await vecindarioEntidad(sql, doyle, { saltos: 2 });
    expect(vec.nodos.map((n) => n.nombre)).toEqual(expect.arrayContaining(['Joseph Bell', 'Sherlock Holmes']));
    expect(vec.aristas.length).toBeGreaterThan(1);

    // Línea temporal: 1859 (fecha en el pasaje) antes que 1892, el año de los dos documentos.
    const linea = await lineaTemporalEntidad(sql, doyle);
    expect(linea.elementos[0]).toMatchObject({ anio: 1859, fecha: '1859', documento: 'entrevista' });
    expect(linea.elementos.map((x) => x.anio)).toEqual([...linea.elementos.map((x) => x.anio)].sort((a, b) => (a ?? 1e9) - (b ?? 1e9)));

    // Por documento y para el lector.
    const ed = await entidadesDocumento(sql, 'entrevista');
    expect(ed.extraccion?.estado).toBe('hecho');
    expect(ed.entidades.slice(0, 2).map((e) => e.nombre).sort()).toEqual(['Arthur Conan Doyle', 'Joseph Bell']);
    const lector = await entidadesLector(sql, 'aventuras');
    const forma = lector.formas.find((f) => f.texto === 'Holmes')!;
    expect(forma.unidades).toEqual([0, 1]);
    expect(lector.entidades[forma.entidad]!.descripcion).toBe('personaje de ficción');
    expect(lector.entidades[forma.entidad]!.nombre).toBe('Sherlock Holmes');
    expect(Object.values(lector.entidades).some((e) => e.tipo === 'fecha')).toBe(false);

    // Buscar por un alias, sin tildes, y por tipo.
    expect((await buscarEntidades(sql, { q: 'conan' })).elementos[0]!.nombre).toBe('Arthur Conan Doyle');
    expect((await buscarEntidades(sql, { q: 'JOSEPH BELL' })).elementos.map((e) => e.nombre)).toContain('Joseph Bell');
    expect((await buscarEntidades(sql, { tipo: 'lugar' })).elementos.map((e) => e.nombre)).toEqual(['Edinburgh']);

    // Wikidata, una vez por nombre: la segunda pasada sale de la caché.
    const antes = w.llamadas.length;
    expect(antes).toBeGreaterThan(0);
    await sql.ejecutar('UPDATE entidades SET wikidata_visto = 0');
    await extraerEntidadesDocumento(p, 'entrevista', { forzar: true, wikidata: { fetch: w.f, pausa: 0 } });
    expect(w.llamadas.length).toBe(antes);
  });

  it('idempotente: lo hecho no se repite; con «forzar» se rehace igual', async () => {
    const sql = await biblioteca();
    const redactor = redactorCatalogo();
    const p = puertos(sql, { inteligencia: { redactor } });
    await extraerTodo(p);
    const llamadas = redactor.llamadas;
    const [antes] = await sql.ejecutar<{ n: number }>('SELECT COUNT(*) AS n FROM menciones');
    await extraerEntidadesDocumento(p, 'entrevista', { wikidata: false });
    expect(redactor.llamadas).toBe(llamadas);
    await extraerEntidadesDocumento(p, 'entrevista', { forzar: true, wikidata: false });
    const [despues] = await sql.ejecutar<{ n: number }>('SELECT COUNT(*) AS n FROM menciones');
    expect(despues!.n).toBe(antes!.n);
  });

  it('reanudable: un lote que falla queda pendiente y la siguiente pasada solo hace ese', async () => {
    const sql = await biblioteca();
    const roto = redactorCatalogo(/clerk/);
    const p = puertos(sql, { inteligencia: { redactor: roto } });
    // Dos fragmentos por lote no caben: un lote por página.
    const r1 = await extraerEntidadesDocumento(p, 'entrevista', { caracteresLote: 70, concurrencia: 1, wikidata: false, relaciones: false });
    expect(r1.estado).toBe('error');
    expect(r1.lotes).toBe(2);
    expect(r1.lotesHechos).toBe(1);
    expect(r1.error).toContain('el proveedor se ha caído');
    // El trabajo con error se recoge pasado el plazo (aquí, a mano).
    await sql.ejecutar("UPDATE entidades_trabajos SET actualizado = '2000-01-01T00:00:00.000Z'");
    const bueno = redactorCatalogo();
    const p2 = puertos(sql, { inteligencia: { redactor: bueno } });
    expect(await reanudarEntidades(p2, { caracteresLote: 70, wikidata: false, relaciones: false })).toEqual(['entrevista']);
    expect(bueno.llamadas).toBe(1);
    const ed = await entidadesDocumento(sql, 'entrevista');
    expect(ed.extraccion).toMatchObject({ estado: 'hecho', lotes: 2, lotesHechos: 2 });
    expect(ed.extraccion!.usdEstimado).toBeGreaterThan(0);
    expect(ed.entidades.map((e) => e.nombre)).toEqual(expect.arrayContaining(['Joseph Bell', 'Arthur Conan Doyle']));
  });

  it('sin redactor no hace nada (y lo dice); al borrar un documento se recuentan las entidades', async () => {
    const sql = await biblioteca();
    const r = await extraerEntidadesDocumento(puertos(sql), 'entrevista');
    expect(r.estado).toBe('sin_redactor');
    const p = puertos(sql, { inteligencia: { redactor: redactorCatalogo() } });
    await extraerTodo(p);
    const bell = await idDe(sql, 'Joseph Bell');
    await alBorrarDocumento(p, 'aventuras');
    const f = await fichaEntidad(sql, bell);
    expect(f.documentos).toBe(1);
    expect((await sql.ejecutar("SELECT * FROM menciones WHERE documento = 'aventuras'")).length).toBe(0);
    expect((await sql.ejecutar("SELECT * FROM aristas_entidades WHERE documento = 'aventuras'")).length).toBe(0);
  });

  it('el enganche tras la ingesta extrae las entidades', async () => {
    const w = wikidataFalso();
    vi.stubGlobal('fetch', w.f);
    const sql = await biblioteca();
    const p = puertos(sql, { inteligencia: { redactor: redactorCatalogo() } });
    const r = await alIngerirDocumento(p, 'entrevista');
    expect(r.errores).toEqual([]);
    expect((await entidadesDocumento(sql, 'entrevista')).extraccion?.estado).toBe('hecho');
  });
});

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

describe('rutas de entidades', () => {
  type Entorno = { Variables: { funciones: PuertosFunciones } };
  async function montar() {
    const sql = await biblioteca();
    const p = puertos(sql, { inteligencia: { redactor: redactorCatalogo() } });
    await extraerTodo(p);
    const raiz = new Hono<Entorno>();
    raiz.use('*', async (c, next) => { c.set('funciones', p); await next(); });
    const api = new Hono<Entorno>();
    rutasFunciones(api);
    raiz.route('/api/v2', api);
    const pedir = async (metodo: string, ruta: string, cuerpo?: unknown) => {
      const r = await raiz.request(`/api/v2${ruta}`, { method: metodo, ...(cuerpo !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) } : {}) });
      return { estado: r.status, cuerpo: (await r.json()) as any };
    };
    return { sql, pedir };
  }

  it('responde las rutas del contrato', async () => {
    const { sql, pedir } = await montar();
    const lista = await pedir('GET', '/entidades?q=bell');
    expect(lista.estado).toBe(200);
    expect(lista.cuerpo.elementos.map((e: any) => e.nombre)).toEqual(expect.arrayContaining(['Joseph Bell', 'Charles Bell']));
    const bell = lista.cuerpo.elementos.find((e: any) => e.nombre === 'Joseph Bell').id;
    const doyle = await idDe(sql, 'Arthur Conan Doyle');

    const ficha = await pedir('GET', `/entidades/${bell}`);
    expect(ficha.cuerpo.porDocumento).toHaveLength(2);
    expect((await pedir('GET', `/entidades/${bell}/menciones?documento=entrevista`)).cuerpo.total).toBe(2);
    expect((await pedir('GET', `/entidades/${bell}/vecinos?saltos=2`)).cuerpo.centro).toBe(bell);
    expect((await pedir('GET', `/entidades/${doyle}/linea`)).cuerpo.elementos.length).toBeGreaterThan(0);
    expect((await pedir('GET', `/entidades/camino?desde=${doyle}&hasta=${bell}`)).cuerpo.pasos).toHaveLength(2);
    expect((await pedir('GET', '/entidades/camino?desde=x')).estado).toBe(400);
    expect((await pedir('GET', '/entidades/documentos/entrevista')).cuerpo.entidades.length).toBeGreaterThan(0);
    expect((await pedir('GET', '/entidades/documentos/aventuras/lector')).cuerpo.formas.length).toBeGreaterThan(0);
    const estado = await pedir('GET', '/entidades/estado');
    expect(estado.cuerpo.documentos).toHaveLength(3);
    expect(estado.cuerpo.entidades).toBeGreaterThan(5);
    const no = await pedir('GET', '/entidades/nada');
    expect(no.estado).toBe(404);
    expect(no.cuerpo.error).toEqual({ codigo: 'no_encontrado', mensaje: 'No existe esa entidad.' });
    const ex = await pedir('POST', '/entidades/documentos/entrevista/extraer', { forzar: true });
    expect(ex.estado).toBe(201);
    expect(ex.cuerpo.estado).toBe('hecho');
    expect((await pedir('POST', '/entidades/documentos/nada/extraer', {})).estado).toBe(404);

    // Una entidad fusionada sigue resolviendo por su id antiguo.
    await sql.ejecutar("INSERT INTO entidades (id, tipo, clave, nombre, alias, busqueda, fusionada_en, creada, actualizada) VALUES ('viejo', 'persona', 'dr bell', 'Dr. Bell', '[]', '|dr bell|', ?, '', '')", bell);
    const redir = await pedir('GET', '/entidades/viejo');
    expect(redir.cuerpo.id).toBe(bell);
    expect(redir.cuerpo.fusionadaDesde).toBe('viejo');
  });
});
