/**
 * La comprensión fuera de la estantería: la extensión opcional `scholaris_comprension`
 * del SPDF 5.0, el .spdf 4.2 interno, la importación (en otra estantería y como copia)
 * y la memoria de una investigación como anotaciones W3C (.spdfa.json).
 *
 * Todo con datos inventados para la prueba: un cuento y su adaptación al cine que no
 * existen («El faro de la punta», «La farera»), sin texto de ninguna obra real.
 */
import { describe, expect, it } from 'vitest';
import type {
  Alineacion, Aparicion, Documento, Ficha, Fragmento, Relacion, Segmento, SQL,
} from '@scholaris/nucleo';
import {
  crearSpdf, escribirAlineaciones, escribirApariciones, escribirDocumento, escribirEspacio, escribirFichas, escribirFragmentos,
  escribirRelaciones, escribirSegmentos, escribirUnidades, escribirVectores, leerAlineaciones, leerApariciones, leerFichas, leerRelaciones,
  leerSegmentos, leerVectores, type ArchivoSpdf, type UnidadSpdf,
} from '@scholaris/spdf';
import { aplicarEsquemaFunciones, obtenerEntidad } from '@scholaris/funciones';
import { SpdfWriter, formatAnchorUri, openSpdf, parseAnchorUri, validate } from 'spdf-format/core';
import type { PuertosUsuario } from '../src/puertos.js';
import { archivoDesde50, armarSpdf50, motorSpdf50 } from '../src/compartido/spdf50.js';
import { importarSpdf } from '../src/compartido/importar-spdf.js';
import { armarSpdf } from '../src/rutas/spdf.js';
import {
  EXTENSION_COMPRENSION, anclaA50, anclaDe50Material, capaVacia, escribirExtensionComprension, leerCapaComprension, restaurarComprension,
} from '../src/compartido/comprension-spdf.js';
import { cuadernoComoAnotaciones } from '../src/compartido/anotaciones-spdf.js';
import { prepararMotorWorkers } from '@scholaris/spdf/workers';

// En workerd, sqlite-wasm llega ya compilado (como en el Worker de verdad).
prepararMotorWorkers();

const HUELLA_CUENTO = '1'.repeat(64);
const HUELLA_PELICULA = '2'.repeat(64);
const HUELLA_SUELTO = '3'.repeat(64);
const AHORA = '2026-11-04T10:00:00.000Z';
const ESPACIO = { id: 'prueba@4', proveedor: 'prueba', modelo: 'prueba', dims: 4, normalizado: true, modalidades: ['texto' as const] };

function documento(id: string, tipo: Documento['tipo'], huella: string, titulo: string, unidades: number, duracion?: number): Documento {
  return {
    id, tipo, huella, metadatos: { titulo, autores: [{ nombre: 'Ana', apellidos: 'Prueba' }], anio: 2020, idioma: 'es' },
    estado: 'listo', original: '', mime: tipo === 'video' ? 'video/mp4' : 'application/pdf', bytes: 1000, unidades,
    ...(duracion ? { duracion } : {}), creado: AHORA, actualizado: AHORA, bibliotecas: [],
  };
}

const pagina = (fisica: number) => ({ tipo: 'pagina' as const, fisica, impresa: String(fisica + 4), romana: false, origen: 'leido' as const, confianza: 1 });
const PAGINAS = [
  'La farera subió la escalera de caracol con el farol encendido. Abajo, el mar golpeaba las rocas de la punta.',
  'Cuando llegó arriba ya no había barco que avisar: solo la luz, girando sobre el agua vacía.',
];
const TRAMOS = [
  { t0: 0, t1: 30, texto: '¿Quién enciende el faro esta noche? Yo, como siempre.' },
  { t0: 30, t1: 60, texto: 'No queda ningún barco. Entonces lo enciendo para el mar.' },
];

/** Una estantería en memoria: el esquema SPDF 4.2 más el de @scholaris/funciones (el grafo). */
async function estanteria(): Promise<ArchivoSpdf> {
  const a = await crearSpdf({ generador: 'prueba' });
  await aplicarEsquemaFunciones(a.sql);
  return a;
}

async function ponerCuento(sql: SQL, id = 'd_cuento'): Promise<void> {
  await escribirDocumento(sql, documento(id, 'pdf', HUELLA_CUENTO, 'El faro de la punta', 2));
  const unidades: UnidadSpdf[] = PAGINAS.map((t, i) => ({ id: `${id}_u${i}`, documento: id, orden: i, ancla: pagina(i + 1), texto: t, lector: 'prueba', confianza: 1 }));
  await escribirUnidades(sql, unidades);
  await escribirFragmentos(sql, PAGINAS.map((t, i): Fragmento => ({ id: `${id}_f${i}`, documento: id, unidad: `${id}_u${i}`, orden: i, texto: t, contexto: '', seccion: [], ancla: pagina(i + 1) })));
}

async function ponerPelicula(sql: SQL, id = 'd_peli'): Promise<void> {
  await escribirDocumento(sql, documento(id, 'video', HUELLA_PELICULA, 'La farera', 2, 60));
  await escribirUnidades(sql, TRAMOS.map((t, i): UnidadSpdf => ({ id: `${id}_u${i}`, documento: id, orden: i, ancla: { tipo: 'tiempo', t0: t.t0, t1: t.t1 }, texto: t.texto, lector: 'prueba', confianza: 1 })));
  await escribirFragmentos(sql, TRAMOS.map((t, i): Fragmento => ({ id: `${id}_f${i}`, documento: id, unidad: `${id}_u${i}`, orden: i, texto: t.texto, contexto: '', seccion: [], ancla: { tipo: 'tiempo', t0: t.t0, t1: t.t1 } })));
  await escribirEspacio(sql, ESPACIO);
  await escribirVectores(sql, TRAMOS.map((_, i) => ({ objetivo: 'fragmento' as const, id: `${id}_f${i}`, espacio: ESPACIO.id, documento: id, valores: new Float32Array([0.5, 0.5, 0.5, i ? -0.5 : 0.5]) })));
}

/** La comprensión de la película: escena y plano, fichas, la farera (personaje) y el faro (lugar con Wikidata), y la relación con el cuento. */
async function ponerComprension(sql: SQL): Promise<{ farera: string; faro: string }> {
  const farera = await obtenerEntidad(sql, 'persona', 'La farera', ['farera'], true);
  const faro = await obtenerEntidad(sql, 'lugar', 'Faro de la Punta', [], false);
  await sql.ejecutar("UPDATE entidades SET wikidata = 'Q99999901', descripcion = 'faro inventado para la prueba' WHERE id = ?", faro);
  const segmentos: Segmento[] = [
    { id: 'd_peli:seg:e1', documento: 'd_peli', padre: null, nivel: 1, orden: 0, tipo: 'escena', titulo: 'La subida al faro', ancla: { tipo: 'tiempo', t0: 0, t1: 30 }, unidadDesde: 'd_peli_u0', unidadHasta: 'd_peli_u0', resumen: 'La farera enciende el faro.', origen: 'modelo', confianza: 0.9 },
    { id: 'd_peli:seg:p1', documento: 'd_peli', padre: 'd_peli:seg:e1', nivel: 2, orden: 1, tipo: 'plano', titulo: 'Plano 1', ancla: { tipo: 'tiempo', t0: 0, t1: 12 }, unidadDesde: 'd_peli_u0', unidadHasta: 'd_peli_u0', origen: 'modelo', confianza: 0.8 },
  ];
  await escribirSegmentos(sql, segmentos);
  const fichas: Ficha[] = [
    {
      id: 'd_peli:fi:global', documento: 'd_peli', objetivo: 'documento', objetivoId: 'd_peli', lente: 'cine', clase: 'global', idioma: 'es',
      texto: 'Una mujer sola sostiene un faro que ya no guía a nadie.', datos: { temas: ['soledad', 'oficio'] }, evidencias: [],
      modelo: 'modelo-prueba', version: 'cine-1', creada: AHORA,
    },
    {
      id: 'd_peli:fi:e1', documento: 'd_peli', objetivo: 'segmento', objetivoId: 'd_peli:seg:e1', lente: 'cine', clase: 'escena', idioma: 'es',
      texto: 'Contrapicado de la farera en la escalera; el farol domina el encuadre.', datos: { escala: 'plano medio' },
      evidencias: [
        { documento: 'd_peli', modo: 'video', ancla: { tipo: 'tiempo', t0: 0, t1: 12, instante: 6.5, region: { x: 0.25, y: 0.1, w: 0.3, h: 0.6 } }, cita: 'La farera sube con el farol.', unidad: 'd_peli_u0' },
        { documento: 'd_peli', modo: 'texto', ancla: { tipo: 'tiempo', t0: 0, t1: 30, caracteres: [0, 34] }, cita: '¿Quién enciende el faro esta noche?', fragmento: 'd_peli_f0' },
        { documento: 'd_cuento', modo: 'texto', ancla: { ...pagina(1), caracteres: [0, 60] }, cita: 'La farera subió la escalera de caracol con el farol encendido.' },
      ],
      modelo: 'modelo-prueba', version: 'cine-1', creada: AHORA,
    },
    {
      id: 'd_peli:fi:ent:farera', documento: 'd_peli', objetivo: 'entidad', objetivoId: farera, lente: 'cine', clase: 'personaje', idioma: 'es',
      texto: 'La farera: oficio heredado, gesto de resistencia.', datos: {}, evidencias: [], modelo: 'modelo-prueba', version: 'cine-1', creada: AHORA,
    },
  ];
  await escribirFichas(sql, fichas);
  const apariciones: Aparicion[] = [
    { id: 'd_peli:ap:1', entidad: farera, documento: 'd_peli', segmento: 'd_peli:seg:p1', ancla: { tipo: 'tiempo', t0: 0, t1: 12, instante: 6.5, region: { x: 0.25, y: 0.1, w: 0.3, h: 0.6 } }, forma: 'la farera', rol: 'visible', confianza: 0.95 },
    { id: 'd_peli:ap:2', entidad: farera, documento: 'd_peli', ancla: { tipo: 'tiempo', t0: 0, t1: 4, hablante: 'La farera' }, forma: 'Yo, como siempre', rol: 'habla', confianza: 0.9 },
    { id: 'd_peli:ap:3', entidad: faro, documento: 'd_peli', ancla: { tipo: 'tiempo', t0: 0, t1: 30, caracteres: [24, 28] }, forma: 'faro', rol: 'nombrado', confianza: 1 },
  ];
  await escribirApariciones(sql, apariciones);
  const relacion: Relacion = {
    id: 'rel:adaptacion', origen: 'd_peli', destino: 'd_cuento', tipo: 'adaptacion_de', nota: 'La película adapta el cuento.',
    evidencias: [{ documento: 'd_cuento', modo: 'texto', ancla: pagina(1), cita: 'La farera subió la escalera de caracol' }], confianza: 0.9, fuente: 'modelo', creada: AHORA,
  };
  await escribirRelaciones(sql, [relacion]);
  const alineaciones: Alineacion[] = [
    { id: 'al:1', relacion: 'rel:adaptacion', orden: 0, tipo: 'transformado', a: { documento: 'd_peli', ancla: { tipo: 'tiempo', t0: 0, t1: 30 }, segmento: 'd_peli:seg:e1' }, b: { documento: 'd_cuento', ancla: { ...pagina(1), caracteres: [0, 60] }, anclaFin: pagina(2) }, nota: 'La subida se filma desde abajo.', confianza: 0.8 },
    { id: 'al:2', relacion: 'rel:adaptacion', orden: 1, tipo: 'anadido', a: { documento: 'd_peli', ancla: { tipo: 'tiempo', t0: 30, t1: 60 } }, nota: 'El diálogo final no está en el cuento.', confianza: 0.7 },
  ];
  await escribirAlineaciones(sql, alineaciones);
  await escribirVectores(sql, [{ objetivo: 'ficha', id: 'd_peli:fi:e1', espacio: ESPACIO.id, documento: 'd_peli', valores: new Float32Array([0.25, -0.5, 0.75, 1]) }]);
  return { farera, faro };
}

/** Puertos falsos: lo justo para exportar e importar sin almacén, cola ni índice. */
function puertos(sql: SQL, usuario = 'u_prueba'): PuertosUsuario {
  return {
    sql, usuario: { id: usuario }, indice: null,
    almacen: { bytes: async () => null, poner: async () => undefined, urlLectura: async () => 'https://prueba.invalid/x' },
    inteligencia: async () => ({ embebedor: { espacio: { id: ESPACIO.id } } }),
    cuentas: { totales: async () => undefined, referenciar: async () => undefined },
    config: { version: 'prueba', espacioNombres: () => 'ns' },
  } as unknown as PuertosUsuario;
}

async function leerDocumentoDe(sql: SQL, id: string): Promise<Documento> {
  const { leerDocumento } = await import('@scholaris/spdf');
  return (await leerDocumento(sql, id))!;
}

/**
 * Lo que importa de la capa para comparar dos estanterías: los ids de las copias sin su
 * sufijo, el propio documento como «D», los demás por su huella y las entidades por su
 * Wikidata o, si no lo tienen, por su nombre (sus ids dependen de cada grafo).
 */
async function resumen(sql: SQL, doc: string, sufijo = '') {
  const s = <T extends string | null | undefined>(x: T): T => (sufijo && typeof x === 'string' ? (x.split(`_${sufijo}`).join('') as T) : x);
  const huellas = new Map((await sql.ejecutar<{ id: string; huella: string }>('SELECT id, huella FROM documentos')).map((d) => [d.id, `sha256-${d.huella}`]));
  const d = (x: string) => (x === doc ? 'D' : huellas.get(x) ?? x);
  const nombres = new Map((await sql.ejecutar<{ id: string; nombre: string; wikidata: string | null }>('SELECT id, nombre, wikidata FROM entidades')).map((e) => [e.id, e.wikidata ?? e.nombre]));
  return {
    segmentos: (await leerSegmentos(sql, doc)).map((x) => ({ ...x, id: s(x.id), padre: s(x.padre), documento: 'D', unidadDesde: s(x.unidadDesde), unidadHasta: s(x.unidadHasta) })),
    fichas: (await leerFichas(sql, { documento: doc })).map((f) => ({
      id: s(f.id), texto: f.texto, clase: f.clase, lente: f.lente, datos: f.datos, objetivo: f.objetivo,
      objetivoId: f.objetivo === 'entidad' ? nombres.get(f.objetivoId) : f.objetivo === 'documento' ? d(f.objetivoId) : s(f.objetivoId),
      evidencias: f.evidencias.map((e) => ({ ...e, documento: d(e.documento), fragmento: s(e.fragmento), unidad: s(e.unidad) })),
    })),
    apariciones: (await leerApariciones(sql, { documento: doc })).map((m) => ({ id: s(m.id), entidad: nombres.get(m.entidad), segmento: s(m.segmento), ancla: m.ancla, rol: m.rol, forma: m.forma }))
      .sort((x, y) => (x.id < y.id ? -1 : 1)),
  };
}

describe('SPDF 5.0: la comprensión como extensión opcional', () => {
  it('se exporta en x_scholaris_* con anclas 5.0, el validador la acepta y los vectores de las fichas no entran en «vectors»', async () => {
    const a = await estanteria();
    await ponerCuento(a.sql);
    await ponerPelicula(a.sql);
    await ponerComprension(a.sql);
    const p = puertos(a.sql);
    const { bytes } = await armarSpdf50(p, await leerDocumentoDe(a.sql, 'd_peli'), { incrustar: false, maxIncrustado: 0 });
    const engine = await motorSpdf50();
    const informe = await validate(bytes, { engine });
    expect(informe.errors).toEqual([]);
    expect(informe.warnings).toEqual([]);
    expect(informe.valid).toBe(true);

    const d = await openSpdf(bytes, { engine });
    try {
      expect(await d.extensions()).toEqual([{ name: EXTENSION_COMPRENSION, version: '1.0', required: false }]);
      const c = d.connection;
      const tablas = (await c.all("SELECT name, type FROM sqlite_master WHERE name LIKE 'x_scholaris_%' AND type = 'table' ORDER BY name")).map((f) => f.name);
      expect(tablas).toEqual(['x_scholaris_alignments', 'x_scholaris_appearances', 'x_scholaris_cards', 'x_scholaris_entities', 'x_scholaris_relations', 'x_scholaris_segments', 'x_scholaris_vectors']);
      // Ninguna tabla virtual más que el índice de los fragmentos (§2.1).
      expect((await c.all("SELECT name FROM sqlite_master WHERE sql LIKE 'CREATE VIRTUAL TABLE%'")).map((f) => f.name)).toEqual(['fragments_fts']);
      // `vectors` solo tiene la capa literal; el vector de la ficha va en la extensión.
      expect((await c.all('SELECT DISTINCT target FROM vectors')).map((f) => f.target)).toEqual(['fragment']);
      expect(await c.all('SELECT target, id, space, length(data) AS n FROM x_scholaris_vectors')).toEqual([{ target: 'card', id: 'd_peli:fi:e1', space: 'prueba@4', n: 16 }]);

      const segs = await c.all('SELECT id, parent, kind, origin, anchor, t0, t1 FROM x_scholaris_segments ORDER BY ord');
      expect(segs.map((s) => [s.kind, s.origin])).toEqual([['scene', 'model'], ['shot', 'model']]);
      expect(JSON.parse(String(segs[0]!.anchor))).toEqual({ type: 'time', t0: 0, t1: 30 });

      const cards = await c.all('SELECT * FROM x_scholaris_cards ORDER BY n');
      expect(cards.map((f) => [f.target, f.lens, f.class])).toEqual([['document', 'film', 'global'], ['segment', 'film', 'scene'], ['entity', 'film', 'character']]);
      expect(cards[0]!.target_id).toBe('d_peli');
      const ev = JSON.parse(String(cards[1]!.evidence)) as Array<Record<string, any>>;
      // Lo que se ve en el instante 6,5 s: el punto de tiempo con la región; el plano, en `span`.
      expect(ev[0]).toEqual({ doc: `sha256-${HUELLA_PELICULA}`, mode: 'video', anchor: { type: 'time', t0: 6.5, t1: 6.5, span: [0, 12], region: { x: 0.25, y: 0.1, w: 0.3, h: 0.6 } }, quote: 'La farera sube con el farol.', unit: 'd_peli_u0' });
      expect(formatAnchorUri(ev[0]!.doc, ev[0]!.anchor)).toBe(`spdf:sha256-${HUELLA_PELICULA}#t=6.5,6.5&xywh=percent:25,10,30,60`);
      expect(ev[1]!.anchor).toEqual({ type: 'time', t0: 0, t1: 30, chars: [0, 34] });
      expect(ev[2]).toMatchObject({ doc: `sha256-${HUELLA_CUENTO}`, anchor: { type: 'page', physical: 1, printed: '5', chars: [0, 60] } });
      expect(formatAnchorUri(ev[2]!.doc, ev[2]!.anchor)).toBe(`spdf:sha256-${HUELLA_CUENTO}#p=1&f=5&char=0,60`);

      const ents = await c.all('SELECT kind, name, wikidata, fictional FROM x_scholaris_entities ORDER BY name');
      expect(ents).toEqual([
        { kind: 'place', name: 'Faro de la Punta', wikidata: 'Q99999901', fictional: null },
        { kind: 'person', name: 'La farera', wikidata: null, fictional: 1 },
      ]);
      const aps = await c.all('SELECT role, anchor, t0 FROM x_scholaris_appearances ORDER BY id');
      expect(aps.map((m) => m.role)).toEqual(['visible', 'speaks', 'named']);
      expect(aps[0]!.t0).toBe(6.5);
      expect(JSON.parse(String(aps[1]!.anchor))).toEqual({ type: 'time', t0: 0, t1: 4, speaker: 'La farera' });

      const rel = await c.all('SELECT source, target, kind, origin FROM x_scholaris_relations');
      expect(rel).toEqual([{ source: `sha256-${HUELLA_PELICULA}`, target: `sha256-${HUELLA_CUENTO}`, kind: 'adaptation_of', origin: 'model' }]);
      const al = await c.all('SELECT kind, doc_a, doc_b, segment_a, anchor_b, anchor_end_b FROM x_scholaris_alignments ORDER BY ord');
      expect(al.map((x) => x.kind)).toEqual(['transformed', 'added']);
      expect(al[0]).toMatchObject({ doc_a: `sha256-${HUELLA_PELICULA}`, doc_b: `sha256-${HUELLA_CUENTO}`, segment_a: 'd_peli:seg:e1' });
      expect(JSON.parse(String(al[0]!.anchor_end_b))).toEqual({ type: 'page', physical: 2, printed: '6', roman: false, source: 'read', confidence: 1 });
      expect(al[1]).toMatchObject({ doc_b: null, anchor_b: null });
    } finally {
      await d.close();
    }
    a.cerrar();
  });

  it('sin comprensión no hay extensión, y el fichero entra igual', async () => {
    const a = await estanteria();
    await escribirDocumento(a.sql, documento('d_suelto', 'pdf', HUELLA_SUELTO, 'Hoja suelta', 1));
    await escribirUnidades(a.sql, [{ id: 'd_suelto_u0', documento: 'd_suelto', orden: 0, ancla: pagina(1), texto: 'Una hoja sin más.', lector: 'prueba', confianza: 1 }]);
    await escribirFragmentos(a.sql, [{ id: 'd_suelto_f0', documento: 'd_suelto', unidad: 'd_suelto_u0', orden: 0, texto: 'Una hoja sin más.', contexto: '', seccion: [], ancla: pagina(1) }]);
    const { bytes } = await armarSpdf50(puertos(a.sql), await leerDocumentoDe(a.sql, 'd_suelto'), { incrustar: false, maxIncrustado: 0 });
    const engine = await motorSpdf50();
    const d = await openSpdf(bytes, { engine });
    expect(await d.extensions()).toEqual([]);
    expect(await d.connection.all("SELECT name FROM sqlite_master WHERE name LIKE 'x_%'")).toEqual([]);
    await d.close();
    const { archivo, avisos } = await archivoDesde50(bytes, 'prueba');
    expect(avisos).toEqual([]);
    const capa = await leerCapaComprension(archivo.sql, 'd_suelto', { entidades: 'archivo' });
    expect(capa && capaVacia(capa)).toBe(true);
    archivo.cerrar();
    a.cerrar();
  });

  it('se importa en otra estantería: entidades resueltas contra su grafo, la relación con la obra que ya tiene y los vectores de las fichas', async () => {
    const origen = await estanteria();
    await ponerCuento(origen.sql);
    await ponerPelicula(origen.sql);
    await ponerComprension(origen.sql);
    const { bytes } = await armarSpdf50(puertos(origen.sql), await leerDocumentoDe(origen.sql, 'd_peli'), { incrustar: false, maxIncrustado: 0 });

    // La otra estantería ya tiene el cuento (con otro id) y un faro con el mismo Wikidata.
    const destino = await estanteria();
    await ponerCuento(destino.sql, 'd_otro_cuento');
    const faroLocal = await obtenerEntidad(destino.sql, 'lugar', 'Faro de la Punta (torre)', [], false);
    await destino.sql.ejecutar("UPDATE entidades SET wikidata = 'Q99999901' WHERE id = ?", faroLocal);
    const r = await importarSpdf(puertos(destino.sql, 'u_otra'), bytes);
    expect(r.versionOrigen).toBe(500);
    expect(r.avisos).toEqual([]);
    const id = r.documentos[0]!.documento;
    expect(id).toBe('d_peli');

    expect(await resumen(destino.sql, id)).toEqual(await resumen(origen.sql, 'd_peli'));
    const aps = await leerApariciones(destino.sql, { documento: id });
    expect(aps.find((m) => m.forma === 'faro')?.entidad).toBe(faroLocal);
    expect(aps.find((m) => m.rol === 'visible')?.ancla).toEqual({ tipo: 'tiempo', t0: 0, t1: 12, instante: 6.5, region: { x: 0.25, y: 0.1, w: 0.3, h: 0.6 } });
    const [rel] = await leerRelaciones(destino.sql, id);
    expect(rel).toMatchObject({ origen: id, destino: 'd_otro_cuento', tipo: 'adaptacion_de', fuente: 'modelo' });
    expect(rel!.evidencias[0]!.documento).toBe('d_otro_cuento');
    const al = await leerAlineaciones(destino.sql, { relacion: rel!.id });
    expect(al.map((x) => [x.tipo, x.a?.documento, x.b?.documento ?? null])).toEqual([['transformado', id, 'd_otro_cuento'], ['anadido', id, null]]);
    expect(al[0]!.b?.ancla).toEqual({ ...pagina(1), caracteres: [0, 60] });
    // La ficha de la entidad apunta a la entidad del grafo de esta estantería.
    const farera = (await destino.sql.ejecutar<{ id: string }>("SELECT id FROM entidades WHERE nombre = 'La farera'"))[0]!.id;
    expect((await leerFichas(destino.sql, { objetivo: 'entidad' }))[0]!.objetivoId).toBe(farera);
    expect((await leerVectores(destino.sql, { espacio: ESPACIO.id, objetivo: 'ficha' })).map((v) => [v.id, [...v.valores]])).toEqual([['d_peli:fi:e1', [0.25, -0.5, 0.75, 1]]]);
    // Las fichas se buscan: el índice FTS se rehace solo al entrar.
    const fts = await destino.sql.ejecutar<{ id: string }>("SELECT f.id FROM fichas_fts JOIN fichas f ON f.n = fichas_fts.rowid WHERE fichas_fts MATCH 'contrapicado'");
    expect(fts.map((f) => f.id)).toEqual(['d_peli:fi:e1']);
    origen.cerrar();
    destino.cerrar();
  });

  it('sin la otra obra en la estantería, la relación se deja fuera con un aviso', async () => {
    const origen = await estanteria();
    await ponerCuento(origen.sql);
    await ponerPelicula(origen.sql);
    await ponerComprension(origen.sql);
    const { bytes } = await armarSpdf50(puertos(origen.sql), await leerDocumentoDe(origen.sql, 'd_peli'), { incrustar: false, maxIncrustado: 0 });
    const destino = await estanteria();
    const r = await importarSpdf(puertos(destino.sql), bytes);
    expect(r.avisos).toEqual(['1 relación con una obra que no está en tu estantería se ha dejado fuera.']);
    expect(await leerRelaciones(destino.sql, 'd_peli')).toEqual([]);
    expect(await leerAlineaciones(destino.sql, { documento: 'd_peli' })).toEqual([]);
    // La prueba que cita el cuento conserva su docref y su ancla.
    const e1 = (await leerFichas(destino.sql, { documento: 'd_peli', clase: 'escena' }))[0]!;
    expect(e1.evidencias[2]).toMatchObject({ documento: `sha256-${HUELLA_CUENTO}`, ancla: { tipo: 'pagina', fisica: 1, caracteres: [0, 60] } });
    origen.cerrar();
    destino.cerrar();
  });

  it('una copia en la misma estantería lleva ids nuevos y no pisa la comprensión del original', async () => {
    const a = await estanteria();
    await ponerCuento(a.sql);
    await ponerPelicula(a.sql);
    await ponerComprension(a.sql);
    const antes = await resumen(a.sql, 'd_peli');
    const { bytes } = await armarSpdf50(puertos(a.sql), await leerDocumentoDe(a.sql, 'd_peli'), { incrustar: false, maxIncrustado: 0 });
    const r = await importarSpdf(puertos(a.sql), bytes);
    const copia = r.documentos[0]!.documento;
    expect(copia).not.toBe('d_peli');
    expect(await resumen(a.sql, 'd_peli')).toEqual(antes);
    const sufijo = copia.slice(-6);
    expect(await resumen(a.sql, copia, sufijo)).toEqual(antes);
    expect((await leerSegmentos(a.sql, copia)).map((s) => [s.id, s.padre])).toEqual([[`d_peli:seg:e1_${sufijo}`, null], [`d_peli:seg:p1_${sufijo}`, `d_peli:seg:e1_${sufijo}`]]);
    expect((await leerFichas(a.sql, { documento: copia, clase: 'escena' }))[0]!.objetivoId).toBe(`d_peli:seg:e1_${sufijo}`);
    // Dos relaciones con el cuento: la del original y la de la copia, cada una con sus alineaciones.
    const rels = await leerRelaciones(a.sql, 'd_cuento');
    expect(rels.map((x) => x.origen).sort()).toEqual([copia, 'd_peli'].sort());
    for (const x of rels) expect(await leerAlineaciones(a.sql, { relacion: x.id })).toHaveLength(2);
    a.cerrar();
  });

  it('las filas mal formadas se saltan con un aviso, y una versión mayor desconocida no se lee', async () => {
    const a = await estanteria();
    await ponerCuento(a.sql);
    await ponerPelicula(a.sql);
    await ponerComprension(a.sql);
    const engine = await motorSpdf50();
    const capa = (await leerCapaComprension(a.sql, 'd_peli', { entidades: 'grafo' }))!;
    const armar = async (version: string | null) => {
      const w = await SpdfWriter.create({ engine, generator: 'prueba/1' });
      await w.setDocument({ id: 'd_peli', kind: 'video', metadata: { type: 'motion_picture', title: 'La farera' }, source_sha256: HUELLA_PELICULA, mime: 'video/mp4', bytes: 1000, duration: 60 });
      await w.addUnits([{ id: 'd_peli_u0', ord: 1, anchor: { type: 'time', t0: 0, t1: 30 }, text: TRAMOS[0]!.texto, reader: 'prueba', t0: 0, t1: 30 }]);
      await escribirExtensionComprension(w, { ...capa, vectores: [] }, { docref: `sha256-${HUELLA_PELICULA}`, espacios: new Set() });
      await w.connection.run("INSERT INTO x_scholaris_segments (id, document, level, ord, kind, title, anchor, unit_from, unit_to, origin) VALUES ('roto', 'd_peli', 0, 9, 'scene', 'Roto', '{\"type\":', 'd_peli_u0', 'd_peli_u0', 'model')");
      if (version) await w.connection.run('UPDATE extensions SET version = ? WHERE name = ?', [version, EXTENSION_COMPRENSION]);
      return w.finish();
    };
    const bien = await archivoDesde50(await armar(null), 'prueba');
    expect(bien.avisos).toEqual(['1 fila de la comprensión estaba mal formada y se ha dejado fuera.']);
    expect((await leerSegmentos(bien.archivo.sql, 'd_peli')).map((s) => s.id)).toEqual(['d_peli:seg:e1', 'd_peli:seg:p1']);
    bien.archivo.cerrar();
    const futura = await archivoDesde50(await armar('2.0'), 'prueba');
    expect(futura.avisos).toEqual(['La comprensión del fichero viene en una versión que esta instancia no entiende (2.0): se importa solo el texto.']);
    expect(await leerSegmentos(futura.archivo.sql, 'd_peli')).toEqual([]);
    futura.archivo.cerrar();
    a.cerrar();
  });
});

describe('SPDF 4.2 interno: la comprensión va y vuelve', () => {
  it('el .spdf de Scholaris lleva la capa y las entidades, y entra en otra estantería', async () => {
    const origen = await estanteria();
    await ponerCuento(origen.sql);
    await ponerPelicula(origen.sql);
    await ponerComprension(origen.sql);
    const { bytes } = await armarSpdf(puertos(origen.sql), await leerDocumentoDe(origen.sql, 'd_peli'), { incrustar: false });
    expect(bytes[0]).toBe(0x1f);

    const { abrirSpdf } = await import('@scholaris/spdf');
    const archivo = await abrirSpdf(bytes);
    const leida = (await leerCapaComprension(archivo.sql, 'd_peli', { entidades: 'archivo' }))!;
    const original = (await leerCapaComprension(origen.sql, 'd_peli', { entidades: 'grafo' }))!;
    expect(leida.segmentos).toEqual(original.segmentos);
    expect(leida.fichas).toEqual(original.fichas);
    expect(leida.apariciones).toEqual(original.apariciones);
    expect(leida.relaciones).toEqual(original.relaciones);
    expect(leida.alineaciones).toEqual(original.alineaciones);
    expect(leida.entidades).toEqual(original.entidades);
    expect(leida.vectores.map((v) => [v.ficha, [...v.valores]])).toEqual([['d_peli:fi:e1', [0.25, -0.5, 0.75, 1]]]);
    // Fuera de la estantería, el cuento va por su huella.
    expect(leida.relaciones[0]!.destino).toBe(`sha256-${HUELLA_CUENTO}`);
    archivo.cerrar();

    const destino = await estanteria();
    await ponerCuento(destino.sql, 'd_otro_cuento');
    const r = await importarSpdf(puertos(destino.sql, 'u_otra'), bytes);
    expect(r.versionOrigen).toBe(400);
    expect(r.avisos).toEqual([]);
    expect(await resumen(destino.sql, 'd_peli')).toEqual(await resumen(origen.sql, 'd_peli'));
    expect((await leerRelaciones(destino.sql, 'd_peli'))[0]?.destino).toBe('d_otro_cuento');
    origen.cerrar();
    destino.cerrar();
  });
});

describe('anclas materiales ↔ anclas 5.0', () => {
  it('van y vuelven sin perder nada', () => {
    const casos = [
      { tipo: 'tiempo', t0: 0, t1: 12, instante: 6.5, region: { x: 0.25, y: 0.1, w: 0.3, h: 0.6 } },
      { tipo: 'tiempo', t0: 3, t1: 3, instante: 3 },
      { tipo: 'tiempo', t0: 0, t1: 4, hablante: 'La farera' },
      { ...pagina(3), caracteres: [5, 9], region: { x: 0, y: 0.5, w: 1, h: 0.25 } },
      { tipo: 'seccion', ruta: ['Capítulo 1'], parrafo: 2, caracteres: [0, 10] },
      { tipo: 'diapositiva', n: 4, region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    ] as const;
    for (const c of casos) expect(anclaDe50Material(anclaA50(c as never))).toEqual(c);
    expect(parseAnchorUri(formatAnchorUri('sha256-' + HUELLA_PELICULA, anclaA50(casos[0] as never))).locator).toEqual({ t: [6.5, 6.5], xywh: [0.25, 0.1, 0.3, 0.6] });
  });
});

describe('la memoria de una investigación como .spdfa.json', () => {
  it('cada prueba verificada es una anotación con su URI de ancla y su cita; notas y síntesis apuntan a sus pruebas', async () => {
    const a = await estanteria();
    await ponerCuento(a.sql);
    await ponerPelicula(a.sql);
    const t = AHORA;
    await a.sql.ejecutar("INSERT INTO cuadernos (id, titulo, cuerpo, creado, actualizado) VALUES ('c1', 'Investigación: el faro sin barcos', '', ?, ?)", t, t);
    const tarjeta = async (id: string, pos: number, campos: Record<string, unknown>) => {
      const fila = { tipo: 'fragmento', documento: null, objetivo: null, ancla: null, ancla_fin: null, pasaje: null, cita: null, contenido: '{}', afirmacion: null, estado: 'verificada', ...campos };
      await a.sql.ejecutar(
        `INSERT INTO cuadernos_tarjetas (id, cuaderno, tipo, documento, objetivo, ancla, ancla_fin, pasaje, cita, huella, contenido, afirmacion, respaldo, posicion, estado, verificada, creada, actualizada)
         VALUES (?, 'c1', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        id, fila.tipo, fila.documento, fila.objetivo, fila.ancla, fila.ancla_fin, fila.pasaje, fila.cita, fila.contenido, fila.afirmacion, pos, fila.estado, t, t, t,
      );
    };
    await tarjeta('t1', 0, {
      documento: 'd_cuento', objetivo: 'd_cuento_f0', ancla: JSON.stringify(pagina(1)), pasaje: PAGINAS[0], cita: '(Prueba, 2020, p. 5)',
      afirmacion: 'En el cuento, la subida es un trabajo de rutina.',
      contenido: JSON.stringify({ evidencia: { id: 'E1', documento: 'd_cuento', modo: 'texto', ancla: { ...pagina(1), caracteres: [0, 61] }, cita: 'La farera subió la escalera de caracol con el farol encendido.' } }),
    });
    await tarjeta('t2', 1, {
      tipo: 'tramo', documento: 'd_peli', ancla: JSON.stringify({ tipo: 'tiempo', t0: 0, t1: 12 }), pasaje: TRAMOS[0]!.texto, cita: '(Prueba, 2020, 0:00-0:12)',
      contenido: JSON.stringify({ evidencia: { id: 'E2', documento: 'd_peli', modo: 'video', ancla: { tipo: 'tiempo', t0: 0, t1: 12, instante: 6.5, region: { x: 0.25, y: 0.1, w: 0.3, h: 0.6 } }, cita: 'Contrapicado de la farera con el farol.' } }),
    });
    await tarjeta('t3', 2, { tipo: 'nota', contenido: JSON.stringify({ texto: 'La película convierte la rutina en resistencia.', clase: 'hipotesis', pruebas: ['E1', 'E2'] }) });
    await tarjeta('t4', 3, { documento: 'd_cuento', estado: 'huerfana', ancla: JSON.stringify(pagina(2)), pasaje: 'Ya no existe.' });
    await a.sql.ejecutar("INSERT INTO cuadernos_sintesis (id, cuaderno, peticion, cuerpo, fuentes, creada) VALUES ('s1', 'c1', '¿Cómo cambia la subida al faro?', 'Del oficio [1] a la resistencia [2].', ?, ?)",
      JSON.stringify([{ n: 1, tarjeta: 't1', etiqueta: '(Prueba, 2020, p. 5)' }, { n: 2, tarjeta: 't2', etiqueta: '(Prueba, 2020, 0:00-0:12)' }]), t);

    const col = await cuadernoComoAnotaciones(a.sql, 'c1');
    expect(col).toMatchObject({ '@context': 'http://www.w3.org/ns/anno.jsonld', type: 'AnnotationCollection', spdf_annotations: '1.1', label: 'Investigación: el faro sin barcos', total: 4 });
    const [a1, a2, nota, sintesis] = col.first.items;
    expect(a1).toMatchObject({ type: 'Annotation', motivation: 'commenting', target: { source: `spdf:sha256-${HUELLA_CUENTO}` } });
    const sel1 = (a1!.target as { selector: Array<Record<string, unknown>> }).selector;
    expect(sel1[0]).toEqual({ type: 'SpdfAnchorSelector', value: `spdf:sha256-${HUELLA_CUENTO}#p=1&f=5&char=0,61` });
    const exacta = 'La farera subió la escalera de caracol con el farol encendido.';
    expect(sel1[1]).toEqual({ type: 'TextQuoteSelector', exact: exacta, prefix: '', suffix: PAGINAS[0]!.slice(exacta.length, exacta.length + 32) });
    expect(a1!.body).toEqual([
      { type: 'TextualBody', value: 'En el cuento, la subida es un trabajo de rutina.', format: 'text/plain', purpose: 'commenting' },
      { type: 'TextualBody', value: '(Prueba, 2020, p. 5)', format: 'text/plain', purpose: 'identifying' },
    ]);
    const sel2 = (a2!.target as { selector: Array<Record<string, unknown>> }).selector;
    expect(sel2[0]).toEqual({ type: 'SpdfAnchorSelector', value: `spdf:sha256-${HUELLA_PELICULA}#t=6.5,6.5&xywh=percent:25,10,30,60` });
    expect(sel2).toContainEqual({ type: 'FragmentSelector', conformsTo: 'http://www.w3.org/TR/media-frags/', value: 't=6.5,6.5&xywh=percent:25,10,30,60' });
    expect(a2!.motivation).toBe('highlighting');
    expect(nota).toMatchObject({ motivation: 'questioning', body: [{ value: 'La película convierte la rutina en resistencia.' }] });
    expect(nota!.target).toEqual([a1!.target, a2!.target]);
    expect(sintesis).toMatchObject({ motivation: 'describing', body: [{ value: 'Del oficio [1] a la resistencia [2].', format: 'text/markdown' }, { value: '¿Cómo cambia la subida al faro?' }] });
    expect(sintesis!.target).toEqual([a1!.target, a2!.target]);
    // Todas las URI se leen con el analizador de spdf-format.
    for (const it of col.first.items) for (const d of [it.target].flat()) expect(() => parseAnchorUri(String(d.selector[0]!.value))).not.toThrow();
    // Sin notas ni síntesis, cada anotación tiene un solo destino: la colección es 1.0.
    await a.sql.ejecutar("DELETE FROM cuadernos_tarjetas WHERE id = 't3'");
    await a.sql.ejecutar("DELETE FROM cuadernos_sintesis WHERE id = 's1'");
    expect((await cuadernoComoAnotaciones(a.sql, 'c1')).spdf_annotations).toBe('1.0');
    a.cerrar();
  });
});
