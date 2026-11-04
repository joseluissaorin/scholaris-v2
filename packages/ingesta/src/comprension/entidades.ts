/**
 * Entidades y apariciones (docs/COMPRENSION.md, paso 4).
 *
 * El modelo lee la obra entera (o por ventanas, arrastrando lo ya visto) y da el
 * reparto de entidades con correferencia: nombre canónico, todas sus formas y
 * las alusiones que las señalan sin nombrarlas. Se resuelven contra el grafo de
 * la biblioteca con el resolutor de @scholaris/funciones (así «Diego» del cuento
 * y «Diego» de la película son la misma entidad) y sus apariciones se localizan
 * aquí, en el material, con su sitio exacto: caracteres en el texto, la voz en
 * su tramo y, con la percepción, la región del fotograma en su instante.
 */
import type { Aparicion, Ficha, Lente, PercepcionMedio, RolAparicion, Segmento, SQL, TipoEntidadComprension } from '@scholaris/nucleo';
import { claveEntidad, entidadActiva, obtenerEntidad } from '@scholaris/funciones';
import { anclaDe, anclarReferencias, buscarFormasEnUnidad, limpiarProsa } from './anclaje.js';
import { ventanas } from './estructura.js';
import { cadena, cadenas, entero, ESQUEMA_EVIDENCIAS, lista, logico, objeto, opcion } from './lentes/comun.js';
import { lente, REGLAS_COMUNES } from './lentes/index.js';
import { fichaDocumento, textoParaModelo, type Material } from './material.js';
import { textoReparto } from './medios.js';
import { llamar } from './modelo.js';
import { buscarObraAudiovisual, repartoWikidata, type PapelWikidata } from './reparto.js';
import type { EntidadModelo, ModeloComprension, UsoModelo } from './tipos.js';
import { huella, localizadorSegmentos } from './util.js';

/** Los tipos del grafo de la biblioteca (los de @scholaris/funciones). */
type TipoEntidad = Parameters<typeof obtenerEntidad>[1];

export const TIPOS_FINOS: readonly TipoEntidadComprension[] = [
  'persona', 'personaje', 'lugar', 'obra', 'organizacion', 'concepto', 'evento', 'objeto', 'motivo', 'tema', 'obra_musical', 'fecha',
];

/** El tipo del grafo de la biblioteca para cada tipo fino de la comprensión. */
export const TIPO_GRAFO: Record<TipoEntidadComprension, TipoEntidad> = {
  persona: 'persona', personaje: 'persona', lugar: 'lugar', obra: 'obra', obra_musical: 'obra', organizacion: 'organizacion',
  concepto: 'concepto', evento: 'evento', objeto: 'concepto', motivo: 'concepto', tema: 'concepto', fecha: 'fecha',
};

/** Tipos que se buscan distinguiendo mayúsculas (nombres propios); los demás, sin distinguir. */
const PROPIOS = new Set<TipoEntidadComprension>(['persona', 'personaje', 'lugar', 'obra', 'obra_musical', 'organizacion', 'evento']);

export const ESQUEMA_ENTIDADES = objeto({
  entidades: lista(objeto({
    nombre: cadena('Nombre canónico: el más completo con que la obra (o la biblioteca) la conoce.'),
    tipo: opcion(TIPOS_FINOS),
    formas: cadenas('TODAS las formas literales con que aparece nombrada (nombre, apellido, apodos, títulos, diminutivos), tal como se escriben.'),
    alusiones: cadenas('Expresiones literales que la aluden sin nombrarla y que la señalan sin ambigüedad en esta obra («el muchacho del helado de chocolate»).'),
    descripcion: cadena('Quién o qué es, en una línea.'),
    ficticia: logico('true si es un personaje de ficción.'),
    importancia: entero('1 (de paso) a 5 (protagonista o eje).'),
    actor: cadena('En obras audiovisuales: quién la interpreta, solo si consta en el material (créditos, percepción).'),
    analisis: cadena('Solo para importancia 4 o 5: su papel en la obra, caracterización y transformación (80-200 palabras).'),
    evidencias: ESQUEMA_EVIDENCIAS,
  }, ['nombre', 'tipo', 'formas', 'descripcion', 'importancia'])),
}, ['entidades']);

/** Lo que ya conoce la biblioteca y conviene nombrar igual (las de este documento y las más vistas). */
export async function conocidasEnBiblioteca(sql: SQL, documento: string, limite = 250): Promise<string> {
  try {
    const filas = await sql.ejecutar<{ nombre: string; tipo: string; ficticia: number | null; alias: string; descripcion: string | null }>(
      `SELECT nombre, tipo, ficticia, alias, descripcion FROM entidades
        WHERE fusionada_en IS NULL AND tipo IN ('persona', 'obra', 'lugar', 'organizacion', 'evento')
          AND (id IN (SELECT entidad FROM menciones WHERE documento = ?) OR id IN (SELECT DISTINCT entidad FROM apariciones) OR n_documentos >= 2)
        ORDER BY n_menciones DESC LIMIT ?`, documento, limite,
    );
    return filas.map((f) => {
      const alias = (() => { try { return (JSON.parse(f.alias) as string[]).slice(0, 4); } catch { return []; } })();
      return `- ${f.nombre} (${f.tipo}${Number(f.ficticia) === 1 ? ', personaje' : ''}${f.descripcion ? `; ${f.descripcion.slice(0, 80)}` : ''}${alias.length ? `; también: ${alias.join(', ')}` : ''})`;
    }).join('\n');
  } catch {
    return '';
  }
}

/** Une dos listas de entidades del modelo por tipo y nombre canónico. */
export function unirEntidades(listas: ReadonlyArray<readonly EntidadModelo[]>): EntidadModelo[] {
  const porClave = new Map<string, EntidadModelo>();
  for (const l of listas) for (const e of l) {
    if (!e?.nombre?.trim() || !TIPOS_FINOS.includes(e.tipo)) continue;
    const k = `${TIPO_GRAFO[e.tipo]}\u0000${claveEntidad(e.nombre, TIPO_GRAFO[e.tipo])}`;
    const previa = porClave.get(k);
    if (!previa) { porClave.set(k, { ...e, formas: [...new Set([e.nombre, ...(e.formas ?? [])])], alusiones: [...new Set(e.alusiones ?? [])] }); continue; }
    previa.formas = [...new Set([...previa.formas, ...(e.formas ?? [])])];
    previa.alusiones = [...new Set([...(previa.alusiones ?? []), ...(e.alusiones ?? [])])];
    previa.importancia = Math.max(previa.importancia ?? 1, e.importancia ?? 1);
    if (!previa.analisis && e.analisis) previa.analisis = e.analisis;
    if (!previa.actor && e.actor) previa.actor = e.actor;
    previa.evidencias = [...(previa.evidencias ?? []), ...(e.evidencias ?? [])];
  }
  return [...porClave.values()];
}

export async function extraerEntidadesDelModelo(
  m: Material, l: Lente, modelo: ModeloComprension, acumulado: { uso: UsoModelo },
  o: { largo: boolean; calidad: 'alta' | 'rapida'; maxCaracteres: number; percepcion?: PercepcionMedio | null; conocidas?: string },
): Promise<EntidadModelo[]> {
  const def = lente(l);
  const guia = [
    o.conocidas ? `Entidades que ya conoce la biblioteca (si alguna es la misma, usa EXACTAMENTE ese nombre canónico):\n${o.conocidas}` : '',
    o.percepcion?.reparto.length ? `Reparto percibido (guía):\n${textoReparto(o.percepcion)}` : '',
  ].filter(Boolean).join('\n\n');
  const tramos = o.largo ? [[m.unidades[0]?.orden ?? 0, m.unidades.at(-1)?.orden ?? 0] as [number, number]] : ventanas(m, o.maxCaracteres);
  const listas: EntidadModelo[][] = [];
  for (const [desde, hasta] of tramos) {
    const vistas = listas.length ? `\n\nYa vistas en tramos anteriores (mismo nombre canónico si reaparecen):\n${unirEntidades(listas).map((e) => `- ${e.nombre} (${e.tipo})`).join('\n')}` : '';
    const r = await llamar<{ entidades: EntidadModelo[] }>(modelo, {
      sistema: `${REGLAS_COMUNES}\n\n${def.instrucciones}\n\nTarea: reconocer las entidades de la obra con correferencia en todo el documento: cada persona, personaje, lugar, obra, organización, objeto significativo, motivo, acontecimiento o concepto, una sola vez, con todas las formas en que aparece. Tipos que importan en esta lente, por orden: ${def.entidades.join(', ')}.`,
      partes: [
        { texto: `${fichaDocumento(m.documento)}${guia ? `\n\n${guia}` : ''}\n\nMaterial${o.largo ? '' : ` (unidades ${desde} a ${hasta})`}:\n\n${textoParaModelo(m, { desde, hasta, fotogramas: m.medio && !o.percepcion, maxCaracteres: o.maxCaracteres })}${vistas}` },
        { texto: 'Devuelve las entidades. Las formas, literales y completas (son las que se buscarán en el texto). Las alusiones, solo si no son ambiguas. Responde solo con el JSON.' },
      ],
      esquema: ESQUEMA_ENTIDADES, calidad: o.calidad, maxTokens: 30_000, operacion: 'entidades',
    }, acumulado);
    listas.push(r.entidades ?? []);
  }
  return unirEntidades(listas);
}

export interface EntidadResuelta extends EntidadModelo {
  /** Id activo en el grafo de la biblioteca. */
  id: string;
  grafo: TipoEntidad;
}

/** Crea o encuentra cada entidad en el grafo (resolutor de @scholaris/funciones). */
export async function resolverEntidades(sql: SQL, entidades: readonly EntidadModelo[]): Promise<EntidadResuelta[]> {
  const porId = new Map<string, EntidadResuelta>();
  for (const e of entidades) {
    const grafo = TIPO_GRAFO[e.tipo];
    const ficticia = e.tipo === 'personaje' ? true : e.tipo === 'persona' ? (e.ficticia ?? false) : null;
    const formas = [...new Set([e.nombre, ...(e.formas ?? [])])].filter((f) => f.trim().length >= 2);
    const id0 = await obtenerEntidad(sql, grafo, e.nombre.trim(), formas, ficticia);
    const id = (await entidadActiva(sql, id0))?.id ?? id0;
    if (e.descripcion) await sql.ejecutar('UPDATE entidades SET descripcion = ? WHERE id = ? AND descripcion IS NULL', e.descripcion.slice(0, 300), id);
    const previa = porId.get(id);
    if (previa) {
      previa.formas = [...new Set([...previa.formas, ...formas])];
      previa.alusiones = [...new Set([...(previa.alusiones ?? []), ...(e.alusiones ?? [])])];
      previa.importancia = Math.max(previa.importancia ?? 1, e.importancia ?? 1);
      continue;
    }
    porId.set(id, { ...e, formas, id, grafo });
  }
  return [...porId.values()];
}

// ---------------------------------------------------------------------------
// Apariciones en el material
// ---------------------------------------------------------------------------

const idAparicion = (doc: string, origen: 'e' | 't' | 'p', x: unknown) => `${doc}:ap:${origen}:${huella(JSON.stringify(x))}`;

/** Normaliza un nombre para casar hablantes y personas percibidas con las entidades. */
const llano = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

export function buscadorPorNombre(ents: readonly EntidadResuelta[]) {
  const mapa = new Map<string, EntidadResuelta | null>();
  for (const e of ents) {
    for (const f of [e.nombre, ...e.formas]) {
      const k = llano(f);
      if (!k) continue;
      const ya = mapa.get(k);
      mapa.set(k, ya === undefined || ya?.id === e.id ? e : null);
    }
  }
  return (nombre: string): EntidadResuelta | undefined => {
    const k = llano(nombre);
    const exacta = mapa.get(k);
    if (exacta) return exacta;
    // «Diego (Jorge Perugorría)» o «David, el estudiante»: la primera palabra con mayúscula.
    const primera = llano(nombre.split(/[,(]/)[0] ?? '');
    return mapa.get(primera) ?? undefined;
  };
}

/**
 * Apariciones en el texto de las unidades: nombres (rol «nombrado»), alusiones
 * («aludido») y, en los medios, los turnos de palabra («habla»), cada una con
 * sus caracteres y, si hay instantes por palabra, su tramo exacto.
 */
export function aparicionesDeTexto(m: Material, ents: readonly EntidadResuelta[], segmentos: readonly Segmento[], o: { maximo?: number } = {}): Aparicion[] {
  const doc = m.documento.id;
  const loc = localizadorSegmentos(m, segmentos);
  // Una forma que reclaman dos entidades no se usa (no se sabe de quién es).
  const duenos = new Map<string, Set<string>>();
  const anota = (forma: string, id: string) => { const k = forma.trim(); if (k.length >= 2) (duenos.get(k) ?? duenos.set(k, new Set()).get(k)!).add(id); };
  for (const e of ents) { for (const f of e.formas) anota(f, e.id); for (const a of e.alusiones ?? []) anota(a, e.id); }
  const salida: Aparicion[] = [];
  const maximo = o.maximo ?? 20_000;
  const buscarHablante = buscadorPorNombre(ents);
  for (const u of m.unidades) {
    if (salida.length >= maximo) break;
    const candidatas: Array<{ e: EntidadResuelta; c: [number, number]; literal: string; rol: RolAparicion; largo: number }> = [];
    for (const e of ents) {
      const formas = e.formas.filter((f) => duenos.get(f.trim())?.size === 1);
      const alusiones = (e.alusiones ?? []).filter((f) => duenos.get(f.trim())?.size === 1 && f.trim().split(/\s+/).length >= 2);
      for (const x of buscarFormasEnUnidad(u, formas, { mayusculas: PROPIOS.has(e.tipo) })) candidatas.push({ e, c: x.caracteres, literal: x.literal, rol: 'nombrado', largo: x.literal.length });
      for (const x of buscarFormasEnUnidad(u, alusiones, { mayusculas: false })) candidatas.push({ e, c: x.caracteres, literal: x.literal, rol: 'aludido', largo: x.literal.length });
    }
    // Sin solapes entre entidades: gana la forma más larga.
    candidatas.sort((a, b) => b.largo - a.largo);
    const tomadas: typeof candidatas = [];
    for (const c of candidatas) if (!tomadas.some((t) => c.c[0] < t.c[1] && c.c[1] > t.c[0])) tomadas.push(c);
    // Las marcas de turno no son menciones: son voces.
    const turnos = [...u.texto.matchAll(/\*\*([^*\n]{1,60}):\*\*/g)].map((x) => {
      const a = Array.from(u.texto.slice(0, x.index!)).length;
      return { nombre: x[1]!.trim(), ini: a, fin: a + Array.from(x[0]).length };
    });
    for (const t of tomadas.sort((a, b) => a.c[0] - b.c[0])) {
      if (turnos.some((x) => t.c[0] >= x.ini && t.c[1] <= x.fin)) continue;
      const ancla = anclaDe(u, t.c, m.voces);
      const segmento = ancla.tipo === 'tiempo' ? loc.enTiempo(ancla.t0) : loc.enTexto(u.orden, t.c[0]);
      salida.push({
        id: idAparicion(doc, 'e', [t.e.id, u.id, t.c, t.rol]), entidad: t.e.id, documento: doc, ...(segmento ? { segmento } : {}),
        ancla, forma: t.literal, rol: t.rol, confianza: t.rol === 'nombrado' ? 0.95 : 0.75,
      });
    }
    // Voces: cada turno, de su marca a la siguiente.
    if (u.ancla.tipo === 'tiempo') {
      const largo = Array.from(u.texto).length;
      const voces = turnos.length ? turnos : u.ancla.hablante ? [{ nombre: u.ancla.hablante, ini: 0, fin: 0 }] : [];
      voces.forEach((v, i) => {
        const c: [number, number] = [v.fin, turnos.length ? (voces[i + 1]?.ini ?? largo) : largo];
        if (c[1] <= c[0]) return;
        // La percepción (imagen y voz) manda sobre la etiqueta de la transcripción, que a veces se cruza.
        const ancla = anclaDe(u, c, m.voces);
        const percibido = ancla.tipo === 'tiempo' && m.voces?.length ? ancla.hablante : undefined;
        const corregido = percibido && llano(percibido) !== llano(v.nombre) ? percibido : undefined;
        const e = buscarHablante(corregido ?? v.nombre);
        if (!e) return;
        const segmento = ancla.tipo === 'tiempo' ? loc.enTiempo(ancla.t0) : undefined;
        salida.push({
          id: idAparicion(doc, 'e', [e.id, u.id, c, 'habla']), entidad: e.id, documento: doc, ...(segmento ? { segmento } : {}),
          ancla, forma: corregido ? `${corregido} (la transcripción dice ${v.nombre})` : v.nombre, rol: 'habla',
          confianza: corregido ? 0.85 : m.voces?.length && !percibido ? 0.75 : 0.9,
        });
      });
    }
  }
  return salida;
}

/**
 * Apariciones que da la percepción: quién está en cada escena («presente»), quién
 * y qué se ve en cada plano («visible», con región e instante), quién habla en el
 * diálogo clave («habla») y qué música suena («audible»). Lo percibido que no casa
 * con ninguna entidad se crea en el grafo.
 */
export async function aparicionesDePercepcion(
  sql: SQL, m: Material, p: PercepcionMedio, ents: EntidadResuelta[], segmentos: readonly Segmento[],
): Promise<{ apariciones: Aparicion[]; nuevas: EntidadResuelta[] }> {
  const doc = m.documento.id;
  const loc = localizadorSegmentos(m, segmentos);
  const nuevas: EntidadResuelta[] = [];
  let buscar = buscadorPorNombre(ents);
  const entidad = async (nombre: string, tipo: TipoEntidadComprension): Promise<EntidadResuelta | undefined> => {
    const limpio = nombre.trim();
    if (limpio.length < 2) return undefined;
    const ya = buscar(limpio);
    if (ya) return ya;
    const r = (await resolverEntidades(sql, [{ nombre: limpio, tipo, formas: [limpio], importancia: 1, ...(tipo === 'personaje' ? { ficticia: true } : {}) }]))[0];
    if (r) { nuevas.push(r); ents.push(r); buscar = buscadorPorNombre(ents); }
    return r;
  };
  const reparto = new Map(p.reparto.map((r) => [llano(r.nombre), r]));
  const tipoPersona = (nombre: string): TipoEntidadComprension => (reparto.get(llano(nombre))?.ficticia === false ? 'persona' : 'personaje');
  const salida: Aparicion[] = [];
  for (const e of [...p.escenas].sort((a, b) => a.t0 - b.t0)) {
    const segEscena = loc.enTiempo((e.t0 + e.t1) / 2);
    for (const nombre of e.personas) {
      const ent = await entidad(nombre, tipoPersona(nombre));
      if (!ent) continue;
      salida.push({ id: idAparicion(doc, 'p', [ent.id, e.t0, e.t1, 'presente']), entidad: ent.id, documento: doc, ...(segEscena ? { segmento: segEscena } : {}), ancla: { tipo: 'tiempo', t0: e.t0, t1: e.t1 }, forma: nombre, rol: 'presente', confianza: 0.85 });
    }
    for (const pl of e.planos) {
      const segPlano = loc.enTiempo((pl.t0 + pl.t1) / 2, { planos: true });
      for (const [lista_, tipo] of [[pl.personas, 'personaje'], [pl.objetos, 'objeto']] as const) {
        for (const x of lista_) {
          const ent = await entidad(x.nombre, tipo === 'personaje' ? tipoPersona(x.nombre) : 'objeto');
          if (!ent) continue;
          const instante = x.instante ?? (pl.t0 + pl.t1) / 2;
          salida.push({
            id: idAparicion(doc, 'p', [ent.id, pl.t0, instante, x.region ?? null, 'visible']), entidad: ent.id, documento: doc, ...(segPlano ? { segmento: segPlano } : {}),
            ancla: { tipo: 'tiempo', t0: pl.t0, t1: pl.t1, instante, ...(x.region ? { region: x.region } : {}) },
            forma: x.nota ? `${x.nombre}: ${x.nota}`.slice(0, 200) : x.nombre, rol: 'visible', confianza: x.region ? 0.85 : 0.7,
          });
        }
      }
    }
    for (const d of e.dialogoClave) {
      if (!d.hablante) continue;
      const ent = await entidad(d.hablante, tipoPersona(d.hablante));
      if (!ent) continue;
      salida.push({ id: idAparicion(doc, 'p', [ent.id, d.t, 'habla']), entidad: ent.id, documento: doc, ...(segEscena ? { segmento: segEscena } : {}), ancla: { tipo: 'tiempo', t0: d.t, t1: d.t + Math.max(1, d.texto.split(/\s+/).length * 0.35) }, forma: d.texto.slice(0, 200), rol: 'habla', confianza: 0.8 });
    }
    for (const s of e.sonido) {
      if (!s.obra) continue;
      const ent = await entidad(s.obra, 'obra_musical');
      if (!ent) continue;
      salida.push({ id: idAparicion(doc, 'p', [ent.id, s.t0, 'audible']), entidad: ent.id, documento: doc, ...(segEscena ? { segmento: segEscena } : {}), ancla: { tipo: 'tiempo', t0: s.t0, t1: s.t1 }, forma: `${s.obra}${s.diegetico === undefined ? '' : s.diegetico ? ' (diegética)' : ' (extradiegética)'}`, rol: 'audible', confianza: 0.8 });
    }
  }
  return { apariciones: salida, nuevas };
}

// ---------------------------------------------------------------------------
// Reparto: quién interpreta a quién
// ---------------------------------------------------------------------------

export interface Papel {
  personaje: string;
  personajeId: string;
  actor: string;
  actorId: string;
  fuente: 'wikidata' | 'percepcion' | 'material';
  qidActor?: string;
}

/**
 * Une actores y personajes: Wikidata (P161 con P453 o P4633), la percepción y lo
 * que diga el material. Deja la relación en el grafo («X interpreta a Y») y el
 * enlace del actor con Wikidata.
 */
export async function enlazarReparto(
  sql: SQL, m: Material, ents: EntidadResuelta[], o: { fetch?: typeof fetch; wikidata?: boolean; percepcion?: PercepcionMedio | null; ahora: string },
): Promise<{ papeles: Papel[]; avisos: string[] }> {
  const avisos: string[] = [];
  const buscar = buscadorPorNombre(ents);
  const candidatos: Array<{ personaje: string; actor: string; fuente: Papel['fuente']; qidActor?: string; qidPersonaje?: string }> = [];
  if (o.fetch && o.wikidata !== false && (m.documento.tipo === 'video' || m.documento.metadatos.tipoCSL === 'motion_picture' || m.documento.metadatos.tipoCSL === 'broadcast')) {
    try {
      const qid = await buscarObraAudiovisual(o.fetch, m.documento);
      if (qid) {
        const papeles: PapelWikidata[] = await repartoWikidata(o.fetch, qid);
        for (const p of papeles) if (p.personaje) candidatos.push({ personaje: p.personaje.nombre, actor: p.actor.nombre, fuente: 'wikidata', qidActor: p.actor.qid, ...(p.personaje.qid ? { qidPersonaje: p.personaje.qid } : {}) });
        if (!papeles.some((p) => p.personaje)) avisos.push(`Wikidata (${qid}) tiene el reparto sin papeles: actor y personaje se unen solo con la percepción.`);
      }
    } catch (e) {
      avisos.push(`Wikidata no respondió: ${(e as Error).message}`.slice(0, 200));
    }
  }
  for (const r of o.percepcion?.reparto ?? []) if (r.actor && r.ficticia !== false) candidatos.push({ personaje: r.nombre, actor: r.actor, fuente: 'percepcion' });
  for (const e of ents) if (e.actor && e.tipo === 'personaje') candidatos.push({ personaje: e.nombre, actor: e.actor, fuente: 'material' });
  const papeles: Papel[] = [];
  const hechos = new Set<string>();
  for (const c of candidatos) {
    const p = buscar(c.personaje);
    if (!p || p.tipo !== 'personaje' && p.ficticia !== true) continue;
    if (hechos.has(p.id)) continue;
    const actorId0 = await obtenerEntidad(sql, 'persona', c.actor.trim(), [c.actor.trim()], false);
    const actorId = (await entidadActiva(sql, actorId0))?.id ?? actorId0;
    if (c.qidActor) await sql.ejecutar('UPDATE entidades SET wikidata = ?, wikidata_visto = 1 WHERE id = ? AND wikidata IS NULL', c.qidActor, actorId);
    if (c.qidPersonaje) await sql.ejecutar('UPDATE entidades SET wikidata = ?, wikidata_visto = 1 WHERE id = ? AND wikidata IS NULL AND ficticia = 1', c.qidPersonaje, p.id);
    const [a, b] = actorId < p.id ? [actorId, p.id] : [p.id, actorId];
    await sql.ejecutar(
      'INSERT OR REPLACE INTO entidades_relaciones (a, b, etiqueta, documento, fragmento, creada) VALUES (?, ?, ?, ?, ?, ?)',
      a, b, `${c.actor.trim()} interpreta a ${p.nombre}`, m.documento.id, null, o.ahora,
    );
    hechos.add(p.id);
    papeles.push({ personaje: p.nombre, personajeId: p.id, actor: c.actor.trim(), actorId, fuente: c.fuente, ...(c.qidActor ? { qidActor: c.qidActor } : {}) });
  }
  return { papeles, avisos };
}

// ---------------------------------------------------------------------------
// Fichas de entidad (las principales)
// ---------------------------------------------------------------------------

export function fichasDeEntidades(
  m: Material, l: Lente, ents: readonly EntidadResuelta[], apariciones: readonly Aparicion[], papeles: readonly Papel[],
  o: { modelo: string; idioma: string; creada: string },
): { fichas: Ficha[]; descartadas: number } {
  const cuenta = new Map<string, Record<string, number>>();
  for (const a of apariciones) {
    const c = cuenta.get(a.entidad) ?? {};
    c[a.rol] = (c[a.rol] ?? 0) + 1;
    cuenta.set(a.entidad, c);
  }
  const fichas: Ficha[] = [];
  let descartadas = 0;
  for (const e of ents) {
    if ((e.importancia ?? 1) < 3 && !e.analisis) continue;
    const a = anclarReferencias(m, e.evidencias, { maximo: 12 });
    descartadas += a.descartadas;
    const papel = papeles.find((p) => p.personajeId === e.id);
    const texto = limpiarProsa((e.analisis ?? e.descripcion ?? '').trim(), m);
    if (!texto) continue;
    fichas.push({
      id: `${m.documento.id}:fi:ent:${e.id}`, documento: m.documento.id, objetivo: 'entidad', objetivoId: e.id, lente: l, clase: e.tipo, idioma: o.idioma,
      texto,
      datos: {
        nombre: e.nombre, tipo: e.tipo, descripcion: e.descripcion ?? '', importancia: e.importancia ?? 1, formas: e.formas.slice(0, 30),
        ...(e.alusiones?.length ? { alusiones: e.alusiones.slice(0, 20) } : {}),
        ...(papel ? { actor: papel.actor, actorEntidad: papel.actorId, fuenteActor: papel.fuente } : e.actor ? { actor: e.actor } : {}),
        apariciones: cuenta.get(e.id) ?? {},
        resumen: { es: e.descripcion ?? '' },
        ...(a.descartadas ? { citasNoVerificadas: a.descartadas } : {}),
      },
      evidencias: a.evidencias, modelo: o.modelo, version: lente(l).version, creada: o.creada,
    });
  }
  return { fichas, descartadas };
}

// ---------------------------------------------------------------------------
// Temas y motivos de la ficha global: entidades con todas sus apariciones
// ---------------------------------------------------------------------------

export async function aparicionesDeTemas(
  sql: SQL, m: Material, temas: ReadonlyArray<{ nombre: string; descripcion: string; formas?: string[]; apariciones?: Array<{ u?: number; cita?: string; f?: number; t?: number; apoya?: string }> }>,
  tipo: 'tema' | 'motivo', segmentos: readonly Segmento[],
): Promise<{ apariciones: Aparicion[]; entidades: Array<{ nombre: string; id: string; apariciones: number }>; descartadas: number }> {
  const doc = m.documento.id;
  const loc = localizadorSegmentos(m, segmentos);
  const salida: Aparicion[] = [];
  const entidades: Array<{ nombre: string; id: string; apariciones: number }> = [];
  let descartadas = 0;
  for (const t of temas) {
    if (!t?.nombre?.trim()) continue;
    const [ent] = await resolverEntidades(sql, [{ nombre: t.nombre.trim(), tipo, formas: [], descripcion: t.descripcion, importancia: 3 }]);
    if (!ent) continue;
    const antes = salida.length;
    const vistas = new Set<string>();
    const citadas: Array<[string, number, number]> = [];
    // Lo que citó el modelo («aludido»: el tema está ahí aunque no se nombre).
    const a = anclarReferencias(m, t.apariciones);
    descartadas += a.descartadas;
    for (const ev of a.evidencias) {
      const u = ev.unidad ? m.porId.get(ev.unidad) : undefined;
      const c = ev.ancla.caracteres;
      const clave = JSON.stringify([ev.unidad, c, ev.figura]);
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      if (u && c) citadas.push([u.id, c[0], c[1]]);
      const segmento = ev.ancla.tipo === 'tiempo' ? loc.enTiempo(ev.ancla.instante ?? ev.ancla.t0) : u && c ? loc.enTexto(u.orden, c[0]) : undefined;
      salida.push({ id: idAparicion(doc, 't', [ent.id, clave]), entidad: ent.id, documento: doc, ...(segmento ? { segmento } : {}), ancla: ev.ancla, forma: (ev.cita ?? t.nombre).slice(0, 300), rol: 'aludido', confianza: 0.75 });
    }
    // Y todas las veces que aparecen sus formas literales («nombrado»).
    const formas = (t.formas ?? []).filter((f) => f.trim().length >= 3);
    if (formas.length) for (const u of m.unidades) {
      for (const x of buscarFormasEnUnidad(u, formas, { mayusculas: false })) {
        // Dentro de una cita que ya está como alusión: no se cuenta dos veces.
        if (citadas.some(([id, a, b]) => id === u.id && x.caracteres[0] < b && x.caracteres[1] > a)) continue;
        const clave = JSON.stringify([u.id, x.caracteres]);
        if (vistas.has(clave)) continue;
        vistas.add(clave);
        const ancla = anclaDe(u, x.caracteres);
        const segmento = ancla.tipo === 'tiempo' ? loc.enTiempo(ancla.t0) : loc.enTexto(u.orden, x.caracteres[0]);
        salida.push({ id: idAparicion(doc, 't', [ent.id, clave]), entidad: ent.id, documento: doc, ...(segmento ? { segmento } : {}), ancla, forma: x.literal, rol: 'nombrado', confianza: 0.7 });
      }
    }
    entidades.push({ nombre: ent.nombre, id: ent.id, apariciones: salida.length - antes });
  }
  return { apariciones: salida, entidades, descartadas };
}
