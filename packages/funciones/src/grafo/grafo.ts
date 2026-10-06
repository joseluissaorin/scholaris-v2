/**
 * Grafo de citas dentro de la biblioteca: qué documento cita a cuál.
 *
 * Cada entrada de la bibliografía se intenta resolver contra los documentos
 * de la estantería, por este orden:
 *   1. DOI exacto (confianza 1).
 *   2. Título parecido (conjunto de palabras ≥ 0,85) con año compatible (0,85).
 *   3. Apellido del primer autor + año, si solo encaja un documento (0,7).
 * Además, un DOI de un documento de la biblioteca mencionado en cualquier
 * parte del texto cuenta como mención (0,95). Lo que no se resuelve queda como
 * referencia huérfana: lo que el usuario cita pero no tiene.
 */

import { anclaACita, type Ancla, type SQL } from '@scholaris/nucleo';
import type { AristaGrafo, GrafoCitas, NodoGrafo, NodoGrafoDetalle, ReferenciaHuerfana } from '@scholaris/contrato';
import { fijarAjuste, leerAjuste } from '../ajustes.js';
import { apellidoPrincipal, leerDocumentos, type DocumentoBreve } from '../estanteria.js';
import type { AlProgreso } from '../puertos.js';
import { deJSON, limitar, noEncontrado, normalizarClave, num, texto } from '../util.js';
import { analizarBibliografia, doisEnTexto, trozosDeReferencias, type EntradaBibliografica } from './bibliografia.js';

function palabras(s: string): Set<string> {
  return new Set(normalizarClave(s).split(' ').filter((p) => p.length > 2));
}

/** Coincidencia por conjunto de palabras (simétrica, sin dependencias). */
export function parecidoTitulos(a: string, b: string): number {
  const pa = palabras(a), pb = palabras(b);
  if (!pa.size || !pb.size) return 0;
  let comun = 0;
  for (const p of pa) if (pb.has(p)) comun++;
  return comun / Math.max(pa.size, pb.size);
}

interface Indice {
  porDoi: Map<string, string>;
  porPalabra: Map<string, Set<string>>;
  docs: Map<string, DocumentoBreve>;
  porApellidoAnio: Map<string, string[]>;
}

function construirIndice(docs: Map<string, DocumentoBreve>): Indice {
  const porDoi = new Map<string, string>();
  const porPalabra = new Map<string, Set<string>>();
  const porApellidoAnio = new Map<string, string[]>();
  for (const d of docs.values()) {
    if (d.doi) porDoi.set(d.doi, d.id);
    for (const p of palabras(d.titulo)) {
      if (!porPalabra.has(p)) porPalabra.set(p, new Set());
      porPalabra.get(p)!.add(d.id);
    }
    const anios = [d.anio, d.metadatos.anioOriginal].filter((x): x is number => typeof x === 'number');
    for (const a of d.metadatos.autores ?? []) {
      for (const anio of anios) {
        const k = `${normalizarClave(a.apellidos || a.nombre)}|${anio}`;
        porApellidoAnio.set(k, [...(porApellidoAnio.get(k) ?? []), d.id]);
      }
    }
    if (!(d.metadatos.autores ?? []).length && d.autores.length) {
      for (const anio of anios) {
        const k = `${normalizarClave(apellidoPrincipal(d))}|${anio}`;
        porApellidoAnio.set(k, [...(porApellidoAnio.get(k) ?? []), d.id]);
      }
    }
  }
  return { porDoi, porPalabra, docs, porApellidoAnio };
}

function anioCompatible(e: number | null, d: DocumentoBreve): boolean {
  if (!e) return true;
  const anios = [d.anio, d.metadatos.anioOriginal].filter((x): x is number => typeof x === 'number');
  return !anios.length || anios.some((a) => Math.abs(a - e) <= 1);
}

export interface Resolucion { documento: string; via: 'doi' | 'titulo_anio' | 'autor_anio'; confianza: number }

export function resolverEntrada(e: EntradaBibliografica, idx: Indice, origen: string): Resolucion | null {
  if (e.doi) {
    const d = idx.porDoi.get(e.doi);
    if (d && d !== origen) return { documento: d, via: 'doi', confianza: 1 };
  }
  if (e.titulo) {
    const candidatos = new Set<string>();
    for (const p of palabras(e.titulo)) for (const d of idx.porPalabra.get(p) ?? []) candidatos.add(d);
    let mejor: string | null = null, mejorR = 0;
    for (const id of candidatos) {
      if (id === origen) continue;
      const d = idx.docs.get(id)!;
      if (!anioCompatible(e.anio, d)) continue;
      // También vale que el título del documento esté contenido en la entrada (subtítulos, ediciones).
      const r = Math.max(parecidoTitulos(e.titulo, d.titulo), normalizarClave(e.texto).includes(normalizarClave(d.titulo)) && d.titulo.length > 12 ? 0.9 : 0);
      if (r > mejorR) { mejorR = r; mejor = id; }
    }
    if (mejor && mejorR >= 0.85) return { documento: mejor, via: 'titulo_anio', confianza: 0.85 };
  }
  if (e.autores.length && e.anio) {
    const c = (idx.porApellidoAnio.get(`${normalizarClave(e.autores[0]!)}|${e.anio}`) ?? []).filter((d) => d !== origen);
    if (new Set(c).size === 1) return { documento: c[0]!, via: 'autor_anio', confianza: 0.7 };
  }
  return null;
}

/** Recalcula las referencias y aristas que salen de un documento (con un índice ya hecho). */
async function procesarDocumento(sql: SQL, documento: string, idx: Indice): Promise<{ entradas: number; resueltas: number }> {
  const entradas = analizarBibliografia(await trozosDeReferencias(sql, documento));
  const aristas = new Map<string, { destino: string; via: string; confianza: number; referencia: string }>();
  let resueltas = 0;
  await sql.ejecutar('DELETE FROM grafo_referencias WHERE origen = ?', documento);
  await sql.ejecutar('DELETE FROM grafo_aristas WHERE origen = ?', documento);
  const vistas = new Set<string>();
  for (const e of entradas) {
    if (vistas.has(e.texto)) continue;
    vistas.add(e.texto);
    const r = resolverEntrada(e, idx, documento);
    if (r) {
      resueltas++;
      const previa = aristas.get(r.documento);
      if (!previa || previa.confianza < r.confianza) aristas.set(r.documento, { destino: r.documento, via: r.via, confianza: r.confianza, referencia: e.texto });
    }
    await sql.ejecutar(
      `INSERT INTO grafo_referencias (origen, fragmento, texto, doi, titulo, autores, anio, resuelto, via, confianza) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      documento, e.fragmento, e.texto, e.doi, e.titulo, JSON.stringify(e.autores), e.anio, r?.documento ?? null, r?.via ?? null, r?.confianza ?? null,
    );
  }
  for (const m of await doisEnTexto(sql, documento)) {
    const d = idx.porDoi.get(m.doi);
    if (!d || d === documento || aristas.has(d)) continue;
    aristas.set(d, { destino: d, via: 'doi_en_texto', confianza: 0.95, referencia: m.doi });
    await sql.ejecutar(
      `INSERT OR IGNORE INTO grafo_referencias (origen, fragmento, texto, doi, resuelto, via, confianza) VALUES (?, ?, ?, ?, ?, 'doi_en_texto', 0.95)`,
      documento, m.fragmento, `doi:${m.doi}`, m.doi, d,
    );
  }
  for (const a of aristas.values()) {
    await sql.ejecutar(
      'INSERT INTO grafo_aristas (origen, destino, tipo, via, confianza, referencia) VALUES (?, ?, ?, ?, ?, ?)',
      documento, a.destino, a.via === 'doi_en_texto' ? 'menciona' : 'cita', a.via, a.confianza, a.referencia,
    );
  }
  return { entradas: entradas.length, resueltas };
}

export interface ResultadoGrafo {
  nodos: number;
  aristas: number;
  ms: number;
  documentos: number;
  referencias: number;
  huerfanas: number;
}

/** Reconstruye el grafo entero. */
export async function reconstruirGrafo(sql: SQL, alProgreso?: AlProgreso): Promise<ResultadoGrafo> {
  const t0 = Date.now();
  const docs = await leerDocumentos(sql);
  const idx = construirIndice(docs);
  let referencias = 0, resueltas = 0, i = 0;
  await sql.ejecutar('DELETE FROM grafo_referencias');
  await sql.ejecutar('DELETE FROM grafo_aristas');
  for (const id of docs.keys()) {
    const r = await procesarDocumento(sql, id, idx);
    referencias += r.entradas;
    resueltas += r.resueltas;
    i++;
    if (alProgreso) await alProgreso({ fase: 'grafo', estado: 'avance', mensaje: `Analizada la bibliografía de ${i} de ${docs.size} documentos.`, avance: i / docs.size, ms: Date.now() - t0 });
  }
  await fijarAjuste(sql, 'grafo_construido', new Date().toISOString());
  const aristas = num((await sql.ejecutar('SELECT count(*) AS n FROM grafo_aristas'))[0]?.n);
  const nodos = num((await sql.ejecutar('SELECT count(*) AS n FROM (SELECT origen AS d FROM grafo_aristas UNION SELECT destino FROM grafo_aristas)'))[0]?.n);
  return { nodos, aristas, ms: Date.now() - t0, documentos: docs.size, referencias, huerfanas: referencias - resueltas };
}

/**
 * Tras ingerir un documento: sus referencias salientes, y las entrantes de los
 * demás documentos que lo citaban sin poder resolverlo.
 */
export async function actualizarGrafoDocumento(sql: SQL, documento: string): Promise<void> {
  const docs = await leerDocumentos(sql);
  if (!docs.has(documento)) {
    await sql.ejecutar('DELETE FROM grafo_aristas WHERE origen = ? OR destino = ?', documento, documento);
    await sql.ejecutar('DELETE FROM grafo_referencias WHERE origen = ?', documento);
    await sql.ejecutar('UPDATE grafo_referencias SET resuelto = NULL, via = NULL, confianza = NULL WHERE resuelto = ?', documento);
    return;
  }
  const idx = construirIndice(docs);
  await procesarDocumento(sql, documento, idx);
  // Referencias huérfanas de otros documentos que ahora se resuelven al nuevo.
  const soloNuevo = construirIndice(new Map([[documento, docs.get(documento)!]]));
  const huerfanas = await sql.ejecutar('SELECT id, origen, texto, doi, titulo, autores, anio FROM grafo_referencias WHERE resuelto IS NULL AND origen <> ?', documento);
  for (const h of huerfanas) {
    const e: EntradaBibliografica = {
      texto: String(h.texto), doi: texto(h.doi), titulo: texto(h.titulo), autores: deJSON(h.autores, []), anio: h.anio === null ? null : num(h.anio), fragmento: null,
    };
    const r = resolverEntrada(e, soloNuevo, String(h.origen));
    if (!r) continue;
    await sql.ejecutar('UPDATE grafo_referencias SET resuelto = ?, via = ?, confianza = ? WHERE id = ?', r.documento, r.via, r.confianza, num(h.id));
    await sql.ejecutar(
      `INSERT INTO grafo_aristas (origen, destino, tipo, via, confianza, referencia) VALUES (?, ?, 'cita', ?, ?, ?)
       ON CONFLICT(origen, destino, tipo) DO UPDATE SET confianza = max(confianza, excluded.confianza)`,
      String(h.origen), r.documento, r.via, r.confianza, e.texto,
    );
  }
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

function autoresTexto(d: DocumentoBreve): string {
  return d.autores.join('; ');
}

function nodo(d: DocumentoBreve, citas: number, citadoPor: number): NodoGrafo {
  return { documento: d.id, titulo: d.titulo, autores: autoresTexto(d), ...(d.anio ? { anio: d.anio } : {}), tipo: d.tipo, citas, citadoPor };
}

/** Páginas (o etiquetas) donde aparece cada referencia resuelta, por par origen→destino. */
async function etiquetasPorPar(sql: SQL, donde: string, ...p: string[]): Promise<Map<string, { etiquetas: string[]; fisicas: number[] }>> {
  const filas = await sql.ejecutar(
    `SELECT r.origen, r.resuelto, f.ancla FROM grafo_referencias r LEFT JOIN fragmentos f ON f.id = r.fragmento WHERE r.resuelto IS NOT NULL AND ${donde}`,
    ...p,
  );
  const salida = new Map<string, { etiquetas: string[]; fisicas: number[] }>();
  for (const f of filas) {
    const clave = `${f.origen}→${f.resuelto}`;
    const e = salida.get(clave) ?? { etiquetas: [], fisicas: [] };
    const a = deJSON<Ancla | null>(f.ancla, null);
    if (a) {
      const et = anclaACita(a);
      if (!e.etiquetas.includes(et)) e.etiquetas.push(et);
      if (a.tipo === 'pagina' && !e.fisicas.includes(a.fisica)) e.fisicas.push(a.fisica);
    }
    salida.set(clave, e);
  }
  return salida;
}

export async function obtenerGrafo(sql: SQL, o: { biblioteca?: string; confianzaMinima?: number; todos?: boolean } = {}): Promise<GrafoCitas & { aristas: Array<AristaGrafo & { confianza: number; via: string }> }> {
  const filas = await sql.ejecutar('SELECT origen, destino, tipo, via, confianza FROM grafo_aristas WHERE confianza >= ?', o.confianzaMinima ?? 0.7);
  const docs = await leerDocumentos(sql);
  let permitidos: Set<string> | null = null;
  if (o.biblioteca) {
    const f = await sql.ejecutar('SELECT d.id FROM documentos d WHERE EXISTS (SELECT 1 FROM json_each(d.bibliotecas) b WHERE b.value = ?)', o.biblioteca);
    permitidos = new Set(f.map((x) => String(x.id)));
  }
  const etiquetas = await etiquetasPorPar(sql, '1');
  const aristas: Array<AristaGrafo & { confianza: number; via: string }> = [];
  const salientes = new Map<string, number>(), entrantes = new Map<string, number>();
  for (const f of filas) {
    const a = String(f.origen), b = String(f.destino);
    if (!docs.has(a) || !docs.has(b)) continue;
    if (permitidos && (!permitidos.has(a) || !permitidos.has(b))) continue;
    const et = etiquetas.get(`${a}→${b}`);
    aristas.push({ desde: a, hacia: b, peso: Math.max(1, et?.etiquetas.length ?? 1), ...(et?.fisicas.length ? { unidades: et.fisicas.sort((x, y) => x - y) } : {}), confianza: num(f.confianza), via: String(f.via) });
    salientes.set(a, (salientes.get(a) ?? 0) + 1);
    entrantes.set(b, (entrantes.get(b) ?? 0) + 1);
  }
  const ids = o.todos ? [...docs.keys()].filter((d) => !permitidos || permitidos.has(d)) : [...new Set([...salientes.keys(), ...entrantes.keys()])];
  const construido = await leerAjuste(sql, 'grafo_construido');
  return {
    nodos: ids.sort().map((id) => nodo(docs.get(id)!, salientes.get(id) ?? 0, entrantes.get(id) ?? 0)),
    aristas,
    ...(construido ? { construido } : {}),
  };
}

export async function detalleNodo(sql: SQL, documento: string): Promise<NodoGrafoDetalle & { bibliografia: Array<{ texto: string; doi?: string; anio?: number; resuelto?: string; via?: string }> }> {
  const docs = await leerDocumentos(sql);
  const d = docs.get(documento);
  if (!d) throw noEncontrado('ese documento');
  const salen = await sql.ejecutar('SELECT destino FROM grafo_aristas WHERE origen = ?', documento);
  const entran = await sql.ejecutar('SELECT origen FROM grafo_aristas WHERE destino = ?', documento);
  const etiquetas = await etiquetasPorPar(sql, '(r.origen = ? OR r.resuelto = ?)', documento, documento);
  const bib = await sql.ejecutar('SELECT texto, doi, anio, resuelto, via FROM grafo_referencias WHERE origen = ? ORDER BY id', documento);
  return {
    ...nodo(d, salen.length, entran.length),
    cita: salen.filter((f) => docs.has(String(f.destino))).map((f) => ({
      documento: String(f.destino), titulo: docs.get(String(f.destino))!.titulo, etiquetas: etiquetas.get(`${documento}→${f.destino}`)?.etiquetas ?? [],
    })),
    citadoEn: entran.filter((f) => docs.has(String(f.origen))).map((f) => ({
      documento: String(f.origen), titulo: docs.get(String(f.origen))!.titulo, etiquetas: etiquetas.get(`${f.origen}→${documento}`)?.etiquetas ?? [],
    })),
    bibliografia: bib.map((b) => ({
      texto: String(b.texto),
      ...(b.doi ? { doi: String(b.doi) } : {}),
      ...(b.anio !== null && b.anio !== undefined ? { anio: num(b.anio) } : {}),
      ...(b.resuelto ? { resuelto: String(b.resuelto) } : {}),
      ...(b.via ? { via: String(b.via) } : {}),
    })),
  };
}

/** Referencias que la biblioteca cita pero no tiene, de las más citadas a las menos. */
export async function referenciasHuerfanas(sql: SQL, o: { minimo?: number; limite?: number } = {}): Promise<Array<ReferenciaHuerfana & { veces: number }>> {
  const filas = await sql.ejecutar(
    `SELECT origen, texto, doi, titulo, anio FROM grafo_referencias WHERE resuelto IS NULL AND (doi IS NOT NULL OR titulo IS NOT NULL)`,
  );
  const grupos = new Map<string, { referencia: string; doi?: string; anio?: number; citadaPor: Set<string>; veces: number }>();
  for (const f of filas) {
    const doi = texto(f.doi);
    const clave = doi ?? normalizarClave(texto(f.titulo));
    if (!clave) continue;
    const g = grupos.get(clave) ?? { referencia: String(f.texto), citadaPor: new Set<string>(), veces: 0 };
    if (doi) g.doi = doi;
    if (f.anio !== null && f.anio !== undefined) g.anio = num(f.anio);
    if (String(f.texto).length < g.referencia.length) g.referencia = String(f.texto);
    g.citadaPor.add(String(f.origen));
    g.veces++;
    grupos.set(clave, g);
  }
  const minimo = limitar(o.minimo, 1, 100, 1);
  return [...grupos.values()]
    .filter((g) => g.citadaPor.size >= minimo)
    .sort((a, b) => b.citadaPor.size - a.citadaPor.size || b.veces - a.veces)
    .slice(0, limitar(o.limite, 1, 500, 50))
    .map((g) => ({ referencia: g.referencia, ...(g.doi ? { doi: g.doi } : {}), ...(g.anio ? { anio: g.anio } : {}), citadaPor: [...g.citadaPor], veces: g.veces }));
}

