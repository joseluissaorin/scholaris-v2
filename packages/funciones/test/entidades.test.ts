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
    const t = '**Charlie Parker:** Toco.\nBird tocaba; un bird no. Charlie Parker era Bird.';
    const ex = rangosExcluidos(t);
    const cs = buscarFormas(t, ['Charlie Parker', 'Bird'], true, ex);
    expect(cs.map((c) => t.slice(c.ini, c.fin))).toEqual(['Charlie Parker', 'Bird', 'Bird']);
    expect(buscarFormas('Birdland', ['Bird'], true)).toEqual([]);
    expect(buscarFormas('el Gnosticismo y el gnosticismo', ['gnosticismo'], false)).toHaveLength(2);
    // Los espacios casan con saltos de línea.
    expect(buscarFormas('Julio\nCortázar', ['Julio Cortázar'], true)).toHaveLength(1);
  });

  it('sin solapes gana la forma más larga; el contexto marca la mención', () => {
    const cs = sinSolapes([{ ini: 0, fin: 14 }, { ini: 8, fin: 14 }, { ini: 20, fin: 26 }]);
    expect(cs).toEqual([{ ini: 0, fin: 14 }, { ini: 20, fin: 26 }]);
    const c = contextoMencion('Antes de todo, cuando leí la biografía de **Charlie Parker** lo supe.', 44, 58, 20);
    expect(c).toContain('⟦Charlie Parker⟧');
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
    const c = (id: string, clave: string, docs: string[], extra: Partial<{ alias: string[]; wikidata: string; tipo: any }> = {}) => ({
      id, tipo: extra.tipo ?? 'persona', clave, palabras: clave.split(' '), alias: extra.alias ?? [], wikidata: extra.wikidata ?? null, menciones: 3, docs: new Set(docs),
    });
    const f = decidirFusiones([
      c('cp', 'charlie parker', ['entrevista'], { alias: ['Bird'] }),
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
    // Personajes con personajes; personas reales nunca con personajes; obras solo si lo son.
    const johnny = [{ id: 'Q1', etiqueta: 'Johnny Carter', descripcion: 'cantante estadounidense' }, { id: 'Q2', etiqueta: 'Johnny Carter', descripcion: 'personaje de El perseguidor' }];
    expect(elegirCandidato('Johnny Carter', 'persona', johnny, true)?.id).toBe('Q2');
    expect(elegirCandidato('Johnny Carter', 'persona', johnny.slice(1))).toBeNull();
    expect(elegirCandidato('Amorous', 'obra', [{ id: 'Q3', etiqueta: 'Amorous', descripcion: 'videojuego de 2018' }])).toBeNull();
    expect(elegirCandidato('Rayuela', 'obra', [{ id: 'Q4', etiqueta: 'Rayuela', descripcion: 'novela de Julio Cortázar' }])?.id).toBe('Q4');
  });
});

// ---------------------------------------------------------------------------
// De punta a punta, con un redactor falso y un Wikidata falso
// ---------------------------------------------------------------------------

/** El «redactor»: reconoce lo que un catalogador reconocería en estos textos. */
const CATALOGO: Array<{ si: RegExp; e: { n: string; t: string; f: string[] } }> = [
  { si: /Charlie Parker|Parker/, e: { n: 'Charlie Parker', t: 'p', f: ['Charlie Parker', 'Parker'] } },
  { si: /CH\.P\./, e: { n: 'Charlie Parker', t: 'p', f: ['CH.P.'] } },
  { si: /Cortázar/, e: { n: 'Julio Cortázar', t: 'p', f: ['Cortázar', 'Julio Cortázar'] } },
  { si: /Johnny/, e: { n: 'Johnny Carter', t: 'q', f: ['Johnny'] } },
  { si: /El perseguidor/, e: { n: 'El perseguidor', t: 'o', f: ['El perseguidor'] } },
  { si: /París/, e: { n: 'París', t: 'l', f: ['París'] } },
  { si: /1951/, e: { n: '1951', t: 'f', f: ['1951'] } },
  { si: /Matthew Parker/, e: { n: 'Matthew Parker', t: 'p', f: ['Matthew Parker', 'Parker'] } },
  { si: /Boecio/, e: { n: 'Boecio', t: 'p', f: ['Boecio'] } },
];

function redactorCatalogo(fallarSi?: RegExp) {
  return redactorFalso((texto) => {
    if (texto.includes(' · B = ')) {
      // Relaciones: «A admira a B» cuando el pasaje dice «admiraba».
      const pares = texto.split(/\n\n(?=\[\d+\])/);
      return { r: pares.map((p, i) => ({ i: i + 1, e: /admiraba/.test(p) && /Charlie Parker/.test(p) && /Cortázar/.test(p) ? 'Julio Cortázar admira a Charlie Parker' : /admiraba/.test(p) ? 'Algo admira a Rayuela' : '' })) };
    }
    if (fallarSi?.test(texto)) throw new Error('el proveedor se ha caído');
    // En Discarded Image, «Parker» es Matthew Parker, no el músico.
    const discarded = texto.includes('Discarded');
    return { e: CATALOGO.filter((c) => c.si.test(texto) && !(discarded && c.e.n === 'Charlie Parker')).map((c) => c.e) };
  });
}

function wikidataFalso() {
  const llamadas: string[] = [];
  const f = (async (url: string) => {
    const busqueda = new URL(url).searchParams.get('search') ?? '';
    llamadas.push(busqueda);
    const datos: Record<string, unknown[]> = {
      'Charlie Parker': [{ id: 'Q103767', label: 'Charlie Parker', description: 'saxofonista estadounidense de jazz' }],
      'Julio Cortázar': [{ id: 'Q93959', label: 'Julio Cortázar', description: 'escritor argentino' }],
    };
    return new Response(JSON.stringify({ search: datos[busqueda] ?? [] }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

async function biblioteca() {
  const sql = await estanteria();
  await sembrar(sql, {
    id: 'entrevista', titulo: 'A fondo: Julio Cortázar', anio: 1977, paginas: [
      'Hablamos de París y de Cortázar, que vivía allí desde 1951.',
      'Cortázar cuenta que admiraba a Charlie Parker como músico; Parker fue la semilla de El perseguidor.',
    ],
  });
  await sembrar(sql, {
    id: 'perseguidor', titulo: 'El perseguidor', autores: [['Julio', 'Cortázar']], anio: 1959, paginas: [
      'In memoriam CH.P. Dédée me ha llamado por la tarde diciéndome que Johnny no estaba bien.',
      'Johnny tocaba aquella noche en el club.',
    ],
  });
  await sembrar(sql, {
    id: 'discarded', titulo: 'The Discarded Image', autores: [['C. S.', 'Lewis']], anio: 1964, paginas: [
      'Boecio fue leído por todos; Matthew Parker reunió manuscritos. Parker los legó a su colegio.',
    ],
  });
  return sql;
}

async function extraerTodo(p: PuertosFunciones, w = wikidataFalso()) {
  for (const d of ['entrevista', 'perseguidor', 'discarded']) {
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
  it('extrae, resuelve, enlaza con Wikidata y teje el grafo entre documentos', async () => {
    const sql = await biblioteca();
    const redactor = redactorCatalogo();
    const p = puertos(sql, { inteligencia: { redactor } });
    const w = await extraerTodo(p);

    const parker = await fichaEntidad(sql, await idDe(sql, 'Charlie Parker'));
    expect(parker.wikidata).toBe('Q103767');
    expect(parker.descripcion).toBe('saxofonista estadounidense de jazz');
    expect(parker.documentos).toBe(2);
    expect(parker.porDocumento.map((d) => d.documento).sort()).toEqual(['entrevista', 'perseguidor']);
    const enEntrevista = parker.porDocumento.find((d) => d.documento === 'entrevista')!;
    expect(enEntrevista.menciones.map((m) => m.texto)).toEqual(['Charlie Parker', 'Parker']);
    expect(enEntrevista.menciones[0]!.etiqueta).toBe('p. 12');
    expect(enEntrevista.menciones[0]!.unidad).toBe(1);
    expect(enEntrevista.menciones[0]!.contexto).toContain('⟦Charlie Parker⟧');
    const enNovela = parker.porDocumento.find((d) => d.documento === 'perseguidor')!;
    expect(enNovela.menciones[0]!.texto).toBe('CH.P.');
    expect(parker.alias).toEqual(expect.arrayContaining(['Parker', 'CH.P.']));

    // El Parker de Lewis es otro.
    const matthew = await fichaEntidad(sql, await idDe(sql, 'Matthew Parker'));
    expect(matthew.porDocumento.map((d) => d.documento)).toEqual(['discarded']);
    expect(matthew.menciones).toBe(2);

    // Vecinos con la relación nombrada.
    const cortazar = await idDe(sql, 'Julio Cortázar');
    const v = parker.vecinos.find((x) => x.entidad.id === cortazar)!;
    expect(v).toBeDefined();
    expect(v.relacion).toBe('Julio Cortázar admira a Charlie Parker');

    // Camino: Cortázar → Charlie Parker → Johnny Carter (de la entrevista a la novela).
    const johnny = await idDe(sql, 'Johnny Carter');
    const camino = await caminoEntidades(sql, cortazar, johnny);
    expect(camino.pasos.map((x) => x.entidad.nombre)).toEqual(['Julio Cortázar', 'Charlie Parker', 'Johnny Carter']);
    expect(camino.pasos[1]!.via!.documento).toBe('entrevista');
    expect(camino.pasos[2]!.via!.documento).toBe('perseguidor');
    expect(camino.pasos[2]!.via!.etiqueta).toBe('p. 11');
    const boecio = await idDe(sql, 'Boecio');
    expect((await caminoEntidades(sql, cortazar, boecio)).pasos).toEqual([]);

    // Vecindario para dibujar.
    const vec = await vecindarioEntidad(sql, cortazar, { saltos: 2 });
    expect(vec.nodos.map((n) => n.nombre)).toEqual(expect.arrayContaining(['Charlie Parker', 'Johnny Carter']));
    expect(vec.aristas.length).toBeGreaterThan(1);

    // Línea temporal: 1951 (fecha en el pasaje) antes que 1959 y 1977.
    const linea = await lineaTemporalEntidad(sql, cortazar);
    expect(linea.elementos[0]).toMatchObject({ anio: 1951, fecha: '1951', documento: 'entrevista' });
    expect(linea.elementos.map((x) => x.anio)).toEqual([...linea.elementos.map((x) => x.anio)].sort((a, b) => (a ?? 1e9) - (b ?? 1e9)));

    // Por documento y para el lector.
    const ed = await entidadesDocumento(sql, 'entrevista');
    expect(ed.extraccion?.estado).toBe('hecho');
    expect(ed.entidades.slice(0, 2).map((e) => e.nombre).sort()).toEqual(['Charlie Parker', 'Julio Cortázar']);
    const lector = await entidadesLector(sql, 'perseguidor');
    const forma = lector.formas.find((f) => f.texto === 'Johnny')!;
    expect(forma.unidades).toEqual([0, 1]);
    expect(lector.entidades[forma.entidad]!.descripcion).toBe('personaje de ficción');
    expect(lector.entidades[forma.entidad]!.nombre).toBe('Johnny Carter');
    expect(Object.values(lector.entidades).some((e) => e.tipo === 'fecha')).toBe(false);

    // Buscar por un alias, sin tildes, y por tipo.
    expect((await buscarEntidades(sql, { q: 'cortazar' })).elementos[0]!.nombre).toBe('Julio Cortázar');
    expect((await buscarEntidades(sql, { q: 'ch.p' })).elementos.map((e) => e.nombre)).toContain('Charlie Parker');
    expect((await buscarEntidades(sql, { tipo: 'lugar' })).elementos.map((e) => e.nombre)).toEqual(['París']);

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
    const roto = redactorCatalogo(/admiraba/);
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
    expect(ed.entidades.map((e) => e.nombre)).toEqual(expect.arrayContaining(['Charlie Parker', 'Julio Cortázar']));
  });

  it('sin redactor no hace nada (y lo dice); al borrar un documento se recuentan las entidades', async () => {
    const sql = await biblioteca();
    const r = await extraerEntidadesDocumento(puertos(sql), 'entrevista');
    expect(r.estado).toBe('sin_redactor');
    const p = puertos(sql, { inteligencia: { redactor: redactorCatalogo() } });
    await extraerTodo(p);
    const parker = await idDe(sql, 'Charlie Parker');
    await alBorrarDocumento(p, 'perseguidor');
    const f = await fichaEntidad(sql, parker);
    expect(f.documentos).toBe(1);
    expect((await sql.ejecutar("SELECT * FROM menciones WHERE documento = 'perseguidor'")).length).toBe(0);
    expect((await sql.ejecutar("SELECT * FROM aristas_entidades WHERE documento = 'perseguidor'")).length).toBe(0);
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
    const lista = await pedir('GET', '/entidades?q=parker');
    expect(lista.estado).toBe(200);
    expect(lista.cuerpo.elementos.map((e: any) => e.nombre)).toEqual(expect.arrayContaining(['Charlie Parker', 'Matthew Parker']));
    const parker = lista.cuerpo.elementos.find((e: any) => e.nombre === 'Charlie Parker').id;
    const cortazar = await idDe(sql, 'Julio Cortázar');

    const ficha = await pedir('GET', `/entidades/${parker}`);
    expect(ficha.cuerpo.porDocumento).toHaveLength(2);
    expect((await pedir('GET', `/entidades/${parker}/menciones?documento=entrevista`)).cuerpo.total).toBe(2);
    expect((await pedir('GET', `/entidades/${parker}/vecinos?saltos=2`)).cuerpo.centro).toBe(parker);
    expect((await pedir('GET', `/entidades/${cortazar}/linea`)).cuerpo.elementos.length).toBeGreaterThan(0);
    expect((await pedir('GET', `/entidades/camino?desde=${cortazar}&hasta=${parker}`)).cuerpo.pasos).toHaveLength(2);
    expect((await pedir('GET', '/entidades/camino?desde=x')).estado).toBe(400);
    expect((await pedir('GET', '/entidades/documentos/entrevista')).cuerpo.entidades.length).toBeGreaterThan(0);
    expect((await pedir('GET', '/entidades/documentos/perseguidor/lector')).cuerpo.formas.length).toBeGreaterThan(0);
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
    await sql.ejecutar("INSERT INTO entidades (id, tipo, clave, nombre, alias, busqueda, fusionada_en, creada, actualizada) VALUES ('viejo', 'persona', 'bird', 'Bird', '[]', '|bird|', ?, '', '')", parker);
    const redir = await pedir('GET', '/entidades/viejo');
    expect(redir.cuerpo.id).toBe(parker);
    expect(redir.cuerpo.fusionadaDesde).toBe('viejo');
  });
});
