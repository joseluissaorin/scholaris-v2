/**
 * Guardado de menciones y resolución de entidades en toda la biblioteca.
 *
 * Una entidad es un par (tipo, clave normalizada): «Cortázar» y «Cortazar»
 * caen en la misma por construcción. Después, `resolverBiblioteca` fusiona lo
 * que el redactor dejó separado:
 *   1. el mismo identificador de Wikidata;
 *   2. una forma de una entidad que es el nombre de otra («Bird» → «Charlie Parker»);
 *   3. un apellido o un nombre de pila suelto que solo encaja con una persona
 *      del mismo documento («Parker» → «Charlie Parker»);
 *   4. un nombre que es el de otra persona sin los intermedios («Julio Cortázar»
 *      → «Julio Florencio Cortázar»).
 * La entidad que pierde se queda con `fusionada_en`: sus enlaces siguen vivos.
 */

import { nuevoId, type SQL } from '@scholaris/nucleo';
import type { TipoEntidad } from '@scholaris/contrato';
import { ahora, deJSON, marcas, normalizarClave, num } from '../util.js';
import { claveEntidad, palabrasSignificativas } from './normalizar.js';
import type { MencionLocalizada } from './extraer.js';

const MAX_ALIAS = 30;

export function textoBusqueda(clave: string, alias: readonly string[]): string {
  const claves = [...new Set([clave, ...alias.map((a) => normalizarClave(a))].filter(Boolean))];
  return `|${claves.join('|')}|`;
}

function unirAlias(nombre: string, actuales: readonly string[], nuevas: Iterable<string>): string[] {
  const vistas = new Set([nombre.toLowerCase(), ...actuales.map((a) => a.toLowerCase())]);
  const salida = [...actuales];
  for (const n of nuevas) {
    const t = n.replace(/\s+/g, ' ').trim();
    if (!t || vistas.has(t.toLowerCase()) || salida.length >= MAX_ALIAS) continue;
    vistas.add(t.toLowerCase());
    salida.push(t);
  }
  return salida;
}

interface FilaEntidad {
  id: string;
  tipo: TipoEntidad;
  clave: string;
  nombre: string;
  alias: string;
  wikidata: string | null;
  descripcion: string | null;
  fusionada_en: string | null;
  n_menciones: number;
}

/** La entidad activa a la que lleva un id (sigue las fusiones). */
export async function entidadActiva(sql: SQL, id: string): Promise<FilaEntidad | null> {
  let actual = id;
  for (let i = 0; i < 12; i++) {
    const [f] = await sql.ejecutar<FilaEntidad>('SELECT * FROM entidades WHERE id = ?', actual);
    if (!f) return null;
    if (!f.fusionada_en) return f;
    actual = f.fusionada_en;
  }
  return null;
}

/** Busca (o crea) la entidad de un nombre y le suma las formas vistas. Devuelve el id activo. */
export async function obtenerEntidad(sql: SQL, tipo: TipoEntidad, nombre: string, formas: Iterable<string>): Promise<string> {
  const clave = claveEntidad(nombre, tipo);
  const [f] = await sql.ejecutar<FilaEntidad>('SELECT * FROM entidades WHERE tipo = ? AND clave = ?', tipo, clave);
  const t = ahora();
  if (!f) {
    const id = nuevoId('ent');
    const alias = unirAlias(nombre, [], formas);
    await sql.ejecutar(
      `INSERT INTO entidades (id, tipo, clave, nombre, alias, busqueda, creada, actualizada) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, tipo, clave, nombre, JSON.stringify(alias), textoBusqueda(clave, alias), t, t,
    );
    return id;
  }
  const activa = f.fusionada_en ? await entidadActiva(sql, f.id) : f;
  if (!activa) return f.id;
  const actuales = deJSON<string[]>(activa.alias, []);
  const alias = unirAlias(activa.nombre, actuales, [...formas, ...(activa.id !== f.id ? [nombre] : [])]);
  if (alias.length !== actuales.length) {
    await sql.ejecutar('UPDATE entidades SET alias = ?, busqueda = ?, actualizada = ? WHERE id = ?', JSON.stringify(alias), textoBusqueda(activa.clave, alias), t, activa.id);
  }
  return activa.id;
}

/**
 * Sustituye las menciones de unos fragmentos por las nuevas (idempotente: el
 * mismo lote dos veces deja lo mismo). Devuelve los ids de entidad tocados.
 */
export async function guardarMenciones(sql: SQL, documento: string, fragmentos: readonly string[], menciones: readonly MencionLocalizada[]): Promise<Set<string>> {
  const tocadas = new Set<string>();
  for (let i = 0; i < fragmentos.length; i += 90) {
    const lote = fragmentos.slice(i, i + 90);
    for (const f of await sql.ejecutar<{ entidad: string }>(`SELECT DISTINCT entidad FROM menciones WHERE fragmento IN (${marcas(lote.length)})`, ...lote)) tocadas.add(f.entidad);
    await sql.ejecutar(`DELETE FROM menciones WHERE fragmento IN (${marcas(lote.length)})`, ...lote);
  }
  // Una entidad por (tipo, nombre canónico); sus formas, las que de verdad aparecen.
  const grupos = new Map<string, { tipo: TipoEntidad; nombre: string; formas: Set<string> }>();
  for (const m of menciones) {
    const k = `${m.tipo}\u0000${claveEntidad(m.nombre, m.tipo)}`;
    const g = grupos.get(k) ?? { tipo: m.tipo, nombre: m.nombre, formas: new Set<string>() };
    g.formas.add(m.texto.replace(/\s+/g, ' '));
    grupos.set(k, g);
  }
  const ids = new Map<string, string>();
  for (const [k, g] of grupos) ids.set(k, await obtenerEntidad(sql, g.tipo, g.nombre, g.formas));
  const filas = menciones.map((m) => {
    const entidad = ids.get(`${m.tipo}\u0000${claveEntidad(m.nombre, m.tipo)}`)!;
    tocadas.add(entidad);
    return [nuevoId('m'), entidad, documento, m.fragmento, m.orden, m.texto, m.nombre, m.tipo, m.ini, m.fin, JSON.stringify(m.ancla)] as const;
  });
  for (let i = 0; i < filas.length; i += 9) {
    const lote = filas.slice(i, i + 9);
    await sql.ejecutar(
      `INSERT INTO menciones (id, entidad, documento, fragmento, orden, texto, normalizado, tipo, ini, fin, ancla) VALUES ${lote.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      ...lote.flat(),
    );
  }
  return tocadas;
}

/** Recalcula los contadores de menciones y documentos (de unas entidades o de todas). */
export async function recontar(sql: SQL, ids?: Iterable<string>): Promise<void> {
  const t = ahora();
  const consulta = `UPDATE entidades SET
      n_menciones = (SELECT COUNT(*) FROM menciones m WHERE m.entidad = entidades.id),
      n_documentos = (SELECT COUNT(DISTINCT m.documento) FROM menciones m WHERE m.entidad = entidades.id),
      actualizada = ?`;
  if (!ids) {
    await sql.ejecutar(`${consulta} WHERE fusionada_en IS NULL`, t);
    return;
  }
  const lista = [...new Set(ids)];
  for (let i = 0; i < lista.length; i += 90) {
    const lote = lista.slice(i, i + 90);
    await sql.ejecutar(`${consulta} WHERE id IN (${marcas(lote.length)})`, t, ...lote);
  }
}

/** Fusiona `perdedora` en `ganadora`. Devuelve los documentos cuyas aristas hay que rehacer. */
export async function fusionar(sql: SQL, ganadora: string, perdedora: string): Promise<string[]> {
  if (ganadora === perdedora) return [];
  const [g] = await sql.ejecutar<FilaEntidad>('SELECT * FROM entidades WHERE id = ?', ganadora);
  const [p] = await sql.ejecutar<FilaEntidad>('SELECT * FROM entidades WHERE id = ?', perdedora);
  if (!g || !p) return [];
  const docs = (await sql.ejecutar<{ documento: string }>('SELECT DISTINCT documento FROM menciones WHERE entidad = ?', perdedora)).map((f) => f.documento);
  const alias = unirAlias(g.nombre, deJSON<string[]>(g.alias, []), [p.nombre, ...deJSON<string[]>(p.alias, [])]);
  const t = ahora();
  await sql.ejecutar('UPDATE menciones SET entidad = ? WHERE entidad = ?', ganadora, perdedora);
  await sql.ejecutar('UPDATE entidades SET fusionada_en = ? WHERE fusionada_en = ?', ganadora, perdedora);
  await sql.ejecutar(
    `UPDATE entidades SET alias = ?, busqueda = ?, wikidata = COALESCE(wikidata, ?), descripcion = COALESCE(descripcion, ?), actualizada = ? WHERE id = ?`,
    JSON.stringify(alias), textoBusqueda(g.clave, alias), p.wikidata, p.descripcion, t, ganadora,
  );
  await sql.ejecutar('UPDATE entidades SET fusionada_en = ?, n_menciones = 0, n_documentos = 0, actualizada = ? WHERE id = ?', ganadora, t, perdedora);
  await sql.ejecutar('DELETE FROM entidades_relaciones WHERE a = ? OR b = ?', perdedora, perdedora);
  return docs;
}

interface Candidata {
  id: string;
  tipo: TipoEntidad;
  clave: string;
  palabras: string[];
  alias: string[];
  wikidata: string | null;
  menciones: number;
  docs: Set<string>;
}

/** Cuál se queda al fusionar: la enlazada con Wikidata, la de nombre más completo, la más mencionada. */
function prefiere(a: Candidata, b: Candidata): Candidata {
  if (!!a.wikidata !== !!b.wikidata) return a.wikidata ? a : b;
  if (a.palabras.length !== b.palabras.length) return a.palabras.length > b.palabras.length ? a : b;
  if (a.menciones !== b.menciones) return a.menciones > b.menciones ? a : b;
  return a.id < b.id ? a : b;
}

const compartenDocumento = (a: Candidata, b: Candidata) => [...a.docs].some((d) => b.docs.has(d));

/** Decide las fusiones (puro, sin SQL): pares [perdedora, ganadora]. */
export function decidirFusiones(cs: readonly Candidata[]): Array<[string, string]> {
  const padre = new Map(cs.map((c) => [c.id, c.id]));
  const porId = new Map(cs.map((c) => [c.id, c]));
  const raiz = (id: string): string => {
    let r = id;
    while (padre.get(r) !== r) r = padre.get(r)!;
    padre.set(id, r);
    return r;
  };
  const unir = (x: string, y: string) => {
    const rx = raiz(x), ry = raiz(y);
    if (rx === ry) return;
    const g = prefiere(porId.get(rx)!, porId.get(ry)!);
    if (g.id === rx) padre.set(ry, rx); else padre.set(rx, ry);
  };

  const porTipo = new Map<TipoEntidad, Candidata[]>();
  for (const c of cs) if (c.tipo !== 'fecha') porTipo.set(c.tipo, [...(porTipo.get(c.tipo) ?? []), c]);

  for (const [tipo, lista] of porTipo) {
    // 1. Mismo Wikidata.
    const porQid = new Map<string, Candidata>();
    for (const c of lista) {
      if (!c.wikidata) continue;
      const otra = porQid.get(c.wikidata);
      if (otra) unir(otra.id, c.id); else porQid.set(c.wikidata, c);
    }
    // 2. Una forma de una es el nombre de otra.
    const porClave = new Map(lista.map((c) => [c.clave, c]));
    for (const c of lista) {
      for (const a of c.alias) {
        const k = claveEntidad(a, tipo);
        const otra = porClave.get(k);
        if (!otra || otra.id === c.id) continue;
        if (k.split(' ').length >= 2 || compartenDocumento(c, otra)) unir(c.id, otra.id);
      }
    }
    if (tipo !== 'persona') continue;
    // 3. Apellido o nombre de pila suelto, solo si encaja con una persona del mismo documento.
    const completas = lista.filter((c) => c.palabras.length >= 2);
    for (const c of lista) {
      if (c.palabras.length !== 1 || c.palabras[0]!.length < 3) continue;
      const p = c.palabras[0]!;
      const porApellido = completas.filter((o) => o.palabras.at(-1) === p && compartenDocumento(c, o));
      const porNombre = completas.filter((o) => o.palabras[0] === p && compartenDocumento(c, o));
      if (porApellido.length === 1) unir(c.id, porApellido[0]!.id);
      else if (!porApellido.length && porNombre.length === 1) unir(c.id, porNombre[0]!.id);
    }
    // 4. Mismo nombre y mismo apellido final, sin los intermedios.
    for (const c of completas) {
      const otras = completas.filter((o) => o.id !== c.id && o.palabras.length > c.palabras.length
        && o.palabras[0] === c.palabras[0] && o.palabras.at(-1) === c.palabras.at(-1)
        && c.palabras.every((w) => o.palabras.includes(w)));
      if (otras.length === 1) unir(c.id, otras[0]!.id);
    }
  }
  const salida: Array<[string, string]> = [];
  for (const c of cs) {
    const r = raiz(c.id);
    if (r !== c.id) salida.push([c.id, r]);
  }
  return salida;
}

/** Pasa la resolución por toda la biblioteca. Devuelve los documentos afectados. */
export async function resolverBiblioteca(sql: SQL): Promise<{ fusiones: number; documentos: Set<string>; tocadas: Set<string> }> {
  const filas = await sql.ejecutar<FilaEntidad>('SELECT * FROM entidades WHERE fusionada_en IS NULL AND n_menciones > 0');
  const docs = new Map<string, Set<string>>();
  for (const f of await sql.ejecutar<{ entidad: string; documento: string }>('SELECT DISTINCT entidad, documento FROM menciones')) {
    const s = docs.get(f.entidad) ?? new Set<string>();
    s.add(f.documento);
    docs.set(f.entidad, s);
  }
  const cs: Candidata[] = filas.map((f) => ({
    id: f.id, tipo: f.tipo, clave: f.clave, palabras: palabrasSignificativas(f.clave), alias: deJSON<string[]>(f.alias, []),
    wikidata: f.wikidata, menciones: num(f.n_menciones), docs: docs.get(f.id) ?? new Set(),
  }));
  const fusiones = decidirFusiones(cs);
  const documentos = new Set<string>();
  const tocadas = new Set<string>();
  for (const [perdedora, ganadora] of fusiones) {
    for (const d of await fusionar(sql, ganadora, perdedora)) documentos.add(d);
    tocadas.add(ganadora);
  }
  if (tocadas.size) await recontar(sql, tocadas);
  return { fusiones: fusiones.length, documentos, tocadas };
}
