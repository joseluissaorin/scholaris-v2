/**
 * Consultas sobre el grafo de entidades: buscar, ficha con menciones por
 * documento, vecinos, camino entre dos entidades, línea temporal, entidades
 * de un documento y formas para resaltar en el lector.
 */

import { anclaACita, enLista, type Ancla, type SQL, type ValorSQL } from '@scholaris/nucleo';
import type {
  CaminoEntidades, DocumentoConMenciones, ElementoLineaTemporal, Entidad, EntidadesDocumento, EntidadesLector, EstadoEntidades,
  FichaEntidad, LineaTemporalEntidad, MencionEntidad, Pagina, PasoCamino, TipoEntidad, VecindarioEntidad, VecinoEntidad,
} from '@scholaris/contrato';
import { leerDocumentos, type DocumentoBreve } from '../estanteria.js';
import { deJSON, limitar, marcas, noEncontrado, normalizarClave, num } from '../util.js';
import { anioDeFecha, contextoMencion, esTipoEntidad } from './normalizar.js';
import { entidadActiva } from './resolver.js';
import { estadoExtraccion } from './trabajo.js';

interface FilaEntidad {
  id: string; tipo: string; nombre: string; alias: string; wikidata: string | null; descripcion: string | null;
  n_menciones: number; n_documentos: number;
}

export function filaAEntidad(f: FilaEntidad): Entidad {
  return {
    id: f.id, nombre: f.nombre, tipo: f.tipo as TipoEntidad, alias: deJSON<string[]>(f.alias, []),
    ...(f.wikidata ? { wikidata: f.wikidata } : {}), ...(f.descripcion ? { descripcion: f.descripcion } : {}),
    menciones: num(f.n_menciones), documentos: num(f.n_documentos),
  };
}

const COLUMNAS = 'id, tipo, nombre, alias, wikidata, descripcion, n_menciones, n_documentos';

async function leerEntidades(sql: SQL, ids: readonly string[]): Promise<Map<string, Entidad>> {
  const salida = new Map<string, Entidad>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 90) {
    const lote = unicos.slice(i, i + 90);
    for (const f of await sql.ejecutar<FilaEntidad>(`SELECT ${COLUMNAS} FROM entidades WHERE id IN (${marcas(lote.length)})`, ...lote)) salida.set(f.id, filaAEntidad(f));
  }
  return salida;
}

async function activaONoEncontrada(sql: SQL, id: string) {
  const e = await entidadActiva(sql, id);
  if (!e) throw noEncontrado('esa entidad');
  return e;
}

// ---------------------------------------------------------------------------
// Buscar
// ---------------------------------------------------------------------------

export interface FiltrosEntidades {
  q?: string;
  tipo?: string;
  documento?: string;
  limite?: number;
  cursor?: string;
}

export async function buscarEntidades(sql: SQL, f: FiltrosEntidades = {}): Promise<Pagina<Entidad>> {
  const limite = limitar(f.limite, 1, 200, 50);
  const desde = Math.max(0, Math.trunc(num(f.cursor, 0)));
  const donde: string[] = ['fusionada_en IS NULL', 'n_menciones > 0'];
  const p: ValorSQL[] = [];
  const q = normalizarClave(f.q);
  if (q) { donde.push('busqueda LIKE ?'); p.push(`%${q.replace(/[%_]/g, '')}%`); }
  if (f.tipo) {
    const tipos = f.tipo.split(',').map((t) => t.trim()).filter(esTipoEntidad);
    if (tipos.length) { const l = enLista(tipos); donde.push(`tipo IN ${l.sql}`); p.push(l.param); }
  }
  if (f.documento) { donde.push('id IN (SELECT entidad FROM menciones WHERE documento = ?)'); p.push(f.documento); }
  // Con consulta, primero lo que empieza por ella; después, lo más presente.
  const orden = q ? `CASE WHEN busqueda LIKE ? THEN 0 ELSE 1 END, n_documentos DESC, n_menciones DESC, nombre` : 'n_documentos DESC, n_menciones DESC, nombre';
  const pOrden: ValorSQL[] = q ? [`%|${q.replace(/[%_]/g, '')}%`] : [];
  const filas = await sql.ejecutar<FilaEntidad>(
    `SELECT ${COLUMNAS} FROM entidades WHERE ${donde.join(' AND ')} ORDER BY ${orden} LIMIT ? OFFSET ?`,
    ...p, ...pOrden, limite + 1, desde,
  );
  const [t] = await sql.ejecutar<{ n: number }>(`SELECT COUNT(*) AS n FROM entidades WHERE ${donde.join(' AND ')}`, ...p);
  return {
    elementos: filas.slice(0, limite).map(filaAEntidad),
    total: num(t?.n),
    ...(filas.length > limite ? { siguiente: String(desde + limite) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Menciones
// ---------------------------------------------------------------------------

interface FilaMencion {
  id: string; documento: string; fragmento: string; texto: string; ini: number; fin: number; ancla: string;
  ftexto: string | null; uorden: number | null;
}

function aMencion(f: FilaMencion): MencionEntidad {
  const ancla = deJSON<Ancla>(f.ancla, { tipo: 'imagen' });
  const t = f.ftexto ?? '';
  return {
    id: f.id, documento: f.documento, fragmento: f.fragmento, unidad: num(f.uorden), ancla, etiqueta: anclaACita(ancla), texto: f.texto,
    contexto: t ? contextoMencion(t, num(f.ini), num(f.fin)) : `⟦${f.texto}⟧`,
  };
}

const SELECT_MENCION = `SELECT m.id, m.documento, m.fragmento, m.texto, m.ini, m.fin, m.ancla, f.texto AS ftexto, u.orden AS uorden
  FROM menciones m LEFT JOIN fragmentos f ON f.id = m.fragmento LEFT JOIN unidades u ON u.id = f.unidad`;

export async function mencionesEntidad(sql: SQL, id: string, o: { documento?: string; limite?: number; cursor?: string } = {}): Promise<Pagina<MencionEntidad>> {
  const e = await activaONoEncontrada(sql, id);
  const limite = limitar(o.limite, 1, 500, 100);
  const desde = Math.max(0, Math.trunc(num(o.cursor, 0)));
  const donde = o.documento ? 'm.entidad = ? AND m.documento = ?' : 'm.entidad = ?';
  const p: ValorSQL[] = o.documento ? [e.id, o.documento] : [e.id];
  const filas = await sql.ejecutar<FilaMencion>(`${SELECT_MENCION} WHERE ${donde} ORDER BY m.documento, m.orden, m.ini LIMIT ? OFFSET ?`, ...p, limite + 1, desde);
  const [t] = await sql.ejecutar<{ n: number }>(`SELECT COUNT(*) AS n FROM menciones m WHERE ${donde}`, ...p);
  return {
    elementos: filas.slice(0, limite).map(aMencion),
    total: num(t?.n),
    ...(filas.length > limite ? { siguiente: String(desde + limite) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Vecinos
// ---------------------------------------------------------------------------

async function relaciones(sql: SQL, pares: ReadonlyArray<[string, string]>, _nombres?: Map<string, Entidad>): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  for (const [x, y] of pares) {
    const [a, b] = x < y ? [x, y] : [y, x];
    const [r] = await sql.ejecutar<{ etiqueta: string | null }>('SELECT etiqueta FROM entidades_relaciones WHERE a = ? AND b = ?', a, b);
    // La etiqueta es ya la frase entera («Julio Cortázar admira a Charlie Parker»).
    if (r?.etiqueta) salida.set(`${a}\u0000${b}`, r.etiqueta);
  }
  return salida;
}

const clavePar = (x: string, y: string) => (x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`);

async function vecinosCrudos(sql: SQL, id: string, limite: number): Promise<Array<{ otro: string; peso: number; docs: number }>> {
  return (await sql.ejecutar<{ otro: string; peso: number; docs: number }>(
    `SELECT CASE WHEN a = ? THEN b ELSE a END AS otro, SUM(peso) AS peso, COUNT(DISTINCT documento) AS docs
       FROM aristas_entidades WHERE a = ? OR b = ? GROUP BY otro ORDER BY peso DESC LIMIT ?`,
    id, id, id, limite,
  )).map((f) => ({ otro: f.otro, peso: num(f.peso), docs: num(f.docs) }));
}

export async function vecinosEntidad(sql: SQL, id: string, limite = 12): Promise<VecinoEntidad[]> {
  const e = await activaONoEncontrada(sql, id);
  const crudos = await vecinosCrudos(sql, e.id, limitar(limite, 1, 100, 12));
  const ents = await leerEntidades(sql, [e.id, ...crudos.map((c) => c.otro)]);
  const rel = await relaciones(sql, crudos.map((c) => [e.id, c.otro]), ents);
  return crudos.filter((c) => ents.has(c.otro)).map((c) => ({
    entidad: ents.get(c.otro)!, peso: Math.round(c.peso * 100) / 100, documentos: c.docs,
    ...(rel.get(clavePar(e.id, c.otro)) ? { relacion: rel.get(clavePar(e.id, c.otro))! } : {}),
  }));
}

/** El vecindario para dibujar: vecinos directos y, con dos saltos, los vecinos más fuertes de cada uno. */
export async function vecindarioEntidad(sql: SQL, id: string, o: { limite?: number; saltos?: number } = {}): Promise<VecindarioEntidad> {
  const e = await activaONoEncontrada(sql, id);
  const limite = limitar(o.limite, 1, 30, 14);
  const directos = await vecinosCrudos(sql, e.id, limite);
  const nodos = new Set([e.id, ...directos.map((d) => d.otro)]);
  if ((o.saltos ?? 1) >= 2) {
    for (const d of directos) {
      for (const v of await vecinosCrudos(sql, d.otro, 4)) {
        if (nodos.size >= 48) break;
        nodos.add(v.otro);
      }
    }
  }
  const lista = [...nodos];
  const enNodos = enLista(lista);
  const aristas = (await sql.ejecutar<{ a: string; b: string; peso: number }>(
    `SELECT a, b, SUM(peso) AS peso FROM aristas_entidades WHERE a IN ${enNodos.sql} AND b IN ${enNodos.sql} GROUP BY a, b`,
    enNodos.param, enNodos.param,
  )).map((f) => ({ a: f.a, b: f.b, peso: num(f.peso) }));
  // Para no dibujar una maraña: todas las del centro y, del resto, las de peso apreciable.
  const visibles = aristas.filter((x) => x.a === e.id || x.b === e.id || x.peso >= 0.8);
  const ents = await leerEntidades(sql, lista);
  const rel = await relaciones(sql, visibles.filter((x) => x.a === e.id || x.b === e.id).map((x) => [x.a, x.b]), ents);
  return {
    centro: e.id,
    nodos: lista.map((n) => ents.get(n)).filter((x): x is Entidad => !!x),
    aristas: visibles.map((x) => ({ desde: x.a, hacia: x.b, peso: Math.round(x.peso * 100) / 100, ...(rel.get(clavePar(x.a, x.b)) ? { relacion: rel.get(clavePar(x.a, x.b))! } : {}) })),
  };
}

// ---------------------------------------------------------------------------
// Ficha
// ---------------------------------------------------------------------------

function autoresTexto(d: DocumentoBreve): string {
  return d.autores.length > 2 ? `${d.autores[0]} et al.` : d.autores.join(' y ');
}

export async function fichaEntidad(sql: SQL, id: string, o: { porDocumento?: number } = {}): Promise<FichaEntidad> {
  const e = await activaONoEncontrada(sql, id);
  const [base] = (await leerEntidades(sql, [e.id])).values();
  const porDoc = await sql.ejecutar<{ documento: string; n: number }>('SELECT documento, COUNT(*) AS n FROM menciones WHERE entidad = ? GROUP BY documento', e.id);
  const docs = await leerDocumentos(sql, porDoc.map((x) => x.documento));
  const cuantas = limitar(o.porDocumento, 1, 200, 25);
  const porDocumento: DocumentoConMenciones[] = [];
  for (const x of porDoc) {
    const d = docs.get(x.documento);
    if (!d) continue;
    const filas = await sql.ejecutar<FilaMencion>(`${SELECT_MENCION} WHERE m.entidad = ? AND m.documento = ? ORDER BY m.orden, m.ini LIMIT ?`, e.id, x.documento, cuantas);
    porDocumento.push({
      documento: d.id, titulo: d.titulo, autores: autoresTexto(d), ...(d.anio ? { anio: d.anio } : {}), tipo: d.tipo,
      total: num(x.n), menciones: filas.map(aMencion),
    });
  }
  porDocumento.sort((a, b) => b.total - a.total || (a.anio ?? 9999) - (b.anio ?? 9999));
  return {
    ...base!,
    ...(e.id !== id ? { fusionadaDesde: id } : {}),
    porDocumento,
    vecinos: await vecinosEntidad(sql, e.id, 12),
  };
}

// ---------------------------------------------------------------------------
// Camino entre dos entidades
// ---------------------------------------------------------------------------

/**
 * Búsqueda en anchura por los dos extremos a la vez, con las aristas más
 * fuertes de cada nodo (como mucho 40). Hasta `maxSaltos` saltos. Entre los
 * caminos más cortos gana el más fuerte: cada nodo guarda el padre que le da
 * más peso acumulado (cada arista cuenta hasta 5), y de los puntos de
 * encuentro se elige el de más peso total.
 */
export async function caminoEntidades(sql: SQL, desde: string, hasta: string, maxSaltos = 4): Promise<CaminoEntidades> {
  const a = await activaONoEncontrada(sql, desde);
  const b = await activaONoEncontrada(sql, hasta);
  if (a.id === b.id) return { pasos: [{ entidad: (await leerEntidades(sql, [a.id])).get(a.id)! }] };
  const padres = [new Map<string, string | null>([[a.id, null]]), new Map<string, string | null>([[b.id, null]])];
  const puntos = [new Map<string, number>([[a.id, 0]]), new Map<string, number>([[b.id, 0]])];
  const fronteras = [[a.id], [b.id]];
  let encuentro: string | null = null;
  for (let saltos = 0; saltos < maxSaltos && !encuentro; saltos++) {
    // Se expande el lado con la frontera más pequeña, una capa entera.
    const lado = fronteras[0]!.length <= fronteras[1]!.length ? 0 : 1;
    const otro = 1 - lado;
    const capa = new Map<string, { padre: string; puntos: number }>();
    for (let i = 0; i < fronteras[lado]!.length; i += 45) {
      const lote = fronteras[lado]!.slice(i, i + 45);
      const filas = await sql.ejecutar<{ x: string; y: string; peso: number }>(
        `SELECT x, y, peso FROM (
           SELECT a AS x, b AS y, SUM(peso) AS peso FROM aristas_entidades WHERE a IN (${marcas(lote.length)}) GROUP BY a, b
           UNION ALL
           SELECT b AS x, a AS y, SUM(peso) AS peso FROM aristas_entidades WHERE b IN (${marcas(lote.length)}) GROUP BY b, a
         ) ORDER BY peso DESC`,
        ...lote, ...lote,
      );
      const cuenta = new Map<string, number>();
      for (const f of filas) {
        const c = cuenta.get(f.x) ?? 0;
        if (c >= 40) continue;
        cuenta.set(f.x, c + 1);
        if (padres[lado]!.has(f.y)) continue;
        const p = (puntos[lado]!.get(f.x) ?? 0) + Math.min(5, num(f.peso));
        const previo = capa.get(f.y);
        if (!previo || p > previo.puntos) capa.set(f.y, { padre: f.x, puntos: p });
      }
    }
    if (!capa.size) break;
    let mejor = -Infinity;
    for (const [y, v] of capa) {
      padres[lado]!.set(y, v.padre);
      puntos[lado]!.set(y, v.puntos);
      if (padres[otro]!.has(y)) {
        const total = v.puntos + (puntos[otro]!.get(y) ?? 0);
        if (total > mejor) { mejor = total; encuentro = y; }
      }
    }
    fronteras[lado] = [...capa.keys()];
  }
  if (!encuentro) return { pasos: [] };
  const ida: string[] = [];
  for (let x: string | null = encuentro; x; x = padres[0]!.get(x) ?? null) ida.unshift(x);
  const vuelta: string[] = [];
  for (let x: string | null = padres[1]!.get(encuentro) ?? null; x; x = padres[1]!.get(x) ?? null) vuelta.push(x);
  const ruta = [...ida, ...vuelta];
  const ents = await leerEntidades(sql, ruta);
  const pasos: PasoCamino[] = [];
  for (let i = 0; i < ruta.length; i++) {
    const ent = ents.get(ruta[i]!);
    if (!ent) return { pasos: [] };
    if (i === 0) { pasos.push({ entidad: ent }); continue; }
    const via = await evidencia(sql, ruta[i - 1]!, ruta[i]!, ents);
    pasos.push({ entidad: ent, ...(via ? { via } : {}) });
  }
  return { pasos };
}

async function evidencia(sql: SQL, x: string, y: string, ents: Map<string, Entidad>): Promise<PasoCamino['via'] | null> {
  const [a, b] = x < y ? [x, y] : [y, x];
  const [arista] = await sql.ejecutar<{ documento: string; fragmento: string | null; peso: number }>(
    'SELECT documento, fragmento, peso FROM aristas_entidades WHERE a = ? AND b = ? ORDER BY coapariciones > 0 DESC, peso DESC LIMIT 1', a, b,
  );
  if (!arista?.fragmento) return null;
  const [total] = await sql.ejecutar<{ p: number }>('SELECT SUM(peso) AS p FROM aristas_entidades WHERE a = ? AND b = ?', a, b);
  const [fr] = await sql.ejecutar<{ texto: string; ancla: string }>('SELECT texto, ancla FROM fragmentos WHERE id = ?', arista.fragmento);
  const ms = await sql.ejecutar<{ ini: number; fin: number }>('SELECT ini, fin FROM menciones WHERE fragmento = ? AND entidad IN (?, ?) ORDER BY ini', arista.fragmento, a, b);
  const docs = await leerDocumentos(sql, [arista.documento]);
  const ancla = deJSON<Ancla>(fr?.ancla, { tipo: 'imagen' });
  const rel = await relaciones(sql, [[a, b]], ents);
  const m = ms[0];
  return {
    peso: Math.round(num(total?.p) * 100) / 100,
    ...(rel.get(clavePar(a, b)) ? { relacion: rel.get(clavePar(a, b))! } : {}),
    documento: arista.documento, titulo: docs.get(arista.documento)?.titulo ?? '', fragmento: arista.fragmento, ancla, etiqueta: anclaACita(ancla),
    contexto: fr && m ? contextoMencion(fr.texto, num(m.ini), num(m.fin), 160) : '',
  };
}

// ---------------------------------------------------------------------------
// Línea temporal
// ---------------------------------------------------------------------------

export async function lineaTemporalEntidad(sql: SQL, id: string, limite = 300): Promise<LineaTemporalEntidad> {
  const e = await activaONoEncontrada(sql, id);
  const [ent] = (await leerEntidades(sql, [e.id])).values();
  // Una entrada por fragmento: la primera mención.
  const filas = await sql.ejecutar<FilaMencion>(
    `${SELECT_MENCION} WHERE m.entidad = ? AND m.id IN (SELECT MIN(id) FROM menciones WHERE entidad = ? GROUP BY fragmento) ORDER BY m.documento, m.orden LIMIT ?`,
    e.id, e.id, limitar(limite, 1, 1000, 300),
  );
  const docs = await leerDocumentos(sql, filas.map((f) => f.documento));
  const fragmentos = [...new Set(filas.map((f) => f.fragmento))];
  const fechas = new Map<string, string>();
  for (let i = 0; i < fragmentos.length; i += 90) {
    const lote = fragmentos.slice(i, i + 90);
    for (const f of await sql.ejecutar<{ fragmento: string; nombre: string }>(
      `SELECT m.fragmento, e.nombre FROM menciones m JOIN entidades e ON e.id = m.entidad WHERE m.tipo = 'fecha' AND m.fragmento IN (${marcas(lote.length)}) ORDER BY m.ini`,
      ...lote,
    )) if (!fechas.has(f.fragmento)) fechas.set(f.fragmento, f.nombre);
  }
  const elementos: ElementoLineaTemporal[] = filas.map((f) => {
    const m = aMencion(f);
    const d = docs.get(f.documento);
    const fecha = fechas.get(f.fragmento);
    const anio = (fecha ? anioDeFecha(fecha) : undefined) ?? d?.anio ?? undefined;
    return {
      ...(anio !== undefined && anio !== null ? { anio } : {}), ...(fecha ? { fecha } : {}),
      documento: f.documento, titulo: d?.titulo ?? '', fragmento: f.fragmento, ancla: m.ancla, etiqueta: m.etiqueta, contexto: m.contexto,
    };
  });
  // Por año (lo que no tiene año, al final) y, dentro, en el orden de lectura.
  const posicion = new Map(filas.map((f, i) => [f.fragmento, i]));
  elementos.sort((x, y) => (x.anio ?? 1e9) - (y.anio ?? 1e9) || posicion.get(x.fragmento)! - posicion.get(y.fragmento)!);
  return { entidad: ent!, elementos };
}

// ---------------------------------------------------------------------------
// Por documento
// ---------------------------------------------------------------------------

export async function entidadesDocumento(sql: SQL, documento: string, limite = 60): Promise<EntidadesDocumento> {
  const filas = await sql.ejecutar<{ entidad: string; n: number }>(
    "SELECT entidad, COUNT(*) AS n FROM menciones WHERE documento = ? AND tipo <> 'fecha' GROUP BY entidad ORDER BY n DESC LIMIT ?",
    documento, limitar(limite, 1, 500, 60),
  );
  const ents = await leerEntidades(sql, filas.map((f) => f.entidad));
  const extraccion = await estadoExtraccion(sql, documento);
  return {
    documento,
    ...(extraccion ? { extraccion } : {}),
    entidades: filas.filter((f) => ents.has(f.entidad)).map((f) => ({ ...ents.get(f.entidad)!, aqui: num(f.n) })),
  };
}

/** Formas a resaltar en el lector, por unidad (sin fechas ni conceptos: el resaltado ha de ser discreto). */
export async function entidadesLector(sql: SQL, documento: string): Promise<EntidadesLector> {
  const filas = await sql.ejecutar<{ entidad: string; texto: string; uorden: number | null }>(
    `SELECT m.entidad, m.texto, u.orden AS uorden FROM menciones m
       LEFT JOIN fragmentos f ON f.id = m.fragmento LEFT JOIN unidades u ON u.id = f.unidad
      WHERE m.documento = ? AND m.tipo NOT IN ('fecha', 'concepto')`,
    documento,
  );
  const formas = new Map<string, { texto: string; entidad: string; unidades: Set<number> }>();
  for (const f of filas) {
    const k = `${f.entidad}\u0000${f.texto}`;
    const x = formas.get(k) ?? { texto: f.texto, entidad: f.entidad, unidades: new Set<number>() };
    if (f.uorden !== null && f.uorden !== undefined) x.unidades.add(num(f.uorden));
    formas.set(k, x);
  }
  const ents = await leerEntidades(sql, [...new Set(filas.map((f) => f.entidad))]);
  const entidades: EntidadesLector['entidades'] = {};
  for (const [id, e] of ents) {
    entidades[id] = { nombre: e.nombre, tipo: e.tipo, documentos: e.documentos, menciones: e.menciones, ...(e.descripcion ? { descripcion: e.descripcion } : {}) };
  }
  return {
    documento,
    entidades,
    formas: [...formas.values()].filter((x) => ents.has(x.entidad)).map((x) => ({ texto: x.texto, entidad: x.entidad, unidades: [...x.unidades].sort((a, b) => a - b) })),
  };
}

export async function estadoEntidades(sql: SQL): Promise<EstadoEntidades> {
  const trabajos = await sql.ejecutar<{ documento: string }>('SELECT documento FROM entidades_trabajos ORDER BY actualizado DESC');
  const documentos = [];
  for (const t of trabajos) {
    const e = await estadoExtraccion(sql, t.documento);
    if (e) documentos.push(e);
  }
  const [c] = await sql.ejecutar<{ e: number; m: number; a: number }>(
    `SELECT (SELECT COUNT(*) FROM entidades WHERE fusionada_en IS NULL AND n_menciones > 0) AS e,
            (SELECT COUNT(*) FROM menciones) AS m,
            (SELECT COUNT(*) FROM (SELECT DISTINCT a, b FROM aristas_entidades)) AS a`,
  );
  return { documentos, entidades: num(c?.e), menciones: num(c?.m), aristas: num(c?.a) };
}

