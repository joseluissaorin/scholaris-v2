/**
 * Búsqueda por capas (docs/COMPRENSION.md, «Vectores y búsqueda»): la capa
 * literal (fragmentos, la de siempre) fundida con la de comprensión (fichas por
 * FTS y por vectores con objetivo «ficha»). Cada resultado dice de qué capa
 * viene y lleva sus evidencias literales: el pasaje con su ancla, o las pruebas
 * que guarda la ficha. Funciona igual con las tablas de comprensión vacías (o
 * sin crear, en una estantería antigua): entonces solo hay capa literal.
 *
 * Filtros además de los de siempre: tramo de páginas físicas o de tiempo,
 * entidad del grafo (menciones de texto y apariciones) y tipo de segmento.
 */
import type { Ancla, AnclaMaterial, Evidencia, Ficha, Filtros, Lente, ModoEvidencia, Resultado, Segmento, SQL, TipoSegmento } from '@scholaris/nucleo';
import { enLista, fusionarRangos } from '@scholaris/nucleo';
import { buscarFichas, leerFichasPorId } from '@scholaris/spdf';
import type { Buscador } from './buscador.js';
import type { DocumentoBreve } from './estanteria.js';
import { plegar, resaltar, terminos } from './texto.js';
import type { RespuestaBusqueda } from './tipos.js';

export type Capa = 'literal' | 'comprension';

export interface FiltrosCapas extends Filtros {
  /** Tramo de páginas físicas [desde, hasta] (ambas incluidas). */
  paginas?: [number, number];
  /** Tramo de tiempo [t0, t1] en segundos (audio y vídeo). */
  tiempo?: [number, number];
  /** Entidad del grafo de la biblioteca: pasajes que la mencionan y fichas que tratan de ella o de donde aparece. */
  entidad?: string;
  /** Solo fichas de segmentos de este tipo (escena, capítulo, plano…). */
  tipoSegmento?: TipoSegmento;
  lente?: Lente;
  /** Clase de ficha («global», «escena», «personaje»…). */
  clase?: string;
}

export interface OpcionesCapas {
  /** Capas en que buscar (las dos). */
  capas?: Capa[];
  filtros?: FiltrosCapas;
  /** Resultados que se devuelven entre las dos capas (10). */
  limite?: number;
  /** Peso de la capa de comprensión en la fusión (0,8: lo literal cita, lo comprendido orienta). */
  pesoComprension?: number;
  reordenar?: boolean;
}

interface BaseResultadoCapa {
  /** Id del fragmento o de la ficha. */
  id: string;
  puntuacion: number;
  /** Las pruebas literales del resultado (el pasaje con su ancla, o las evidencias de la ficha). */
  evidencias: Evidencia[];
}

export interface ResultadoLiteral extends BaseResultadoCapa {
  capa: 'literal';
  documento: DocumentoBreve;
  resultado: Resultado;
}

export interface ResultadoComprension extends BaseResultadoCapa {
  capa: 'comprension';
  /** null en las fichas de la biblioteca (una entidad, una relación entre obras). */
  documento: DocumentoBreve | null;
  ficha: Ficha;
  /** El segmento analizado, si la ficha es de un segmento. */
  segmento?: Segmento;
  /** Texto de la ficha con las coincidencias marcadas. */
  resaltado: string;
}

export type ResultadoCapa = ResultadoLiteral | ResultadoComprension;

export interface RespuestaCapas {
  resultados: ResultadoCapa[];
  /** La búsqueda literal completa (comprensión de la consulta, tiempos), si se hizo. */
  literal: RespuestaBusqueda | null;
  /** Cuántas fichas se encontraron antes de recortar. */
  fichas: number;
  avisos: string[];
  tiempos: Record<string, number>;
}

const ahora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** El modo de una prueba según su ancla: lo dicho en un medio es audio; lo de una página, texto. */
export function modoDeAncla(a: Ancla, tipoDocumento?: string): ModoEvidencia {
  if (a.tipo === 'tiempo') return 'audio';
  if (a.tipo === 'imagen') return tipoDocumento === 'video' ? 'video' : 'imagen';
  if (a.tipo === 'hoja') return 'dato';
  return 'texto';
}

/** La prueba literal de un resultado de la capa literal: el pasaje (sus oraciones, con su ancla) o el fragmento entero. */
export function evidenciaDeResultado(r: Resultado): Evidencia {
  // Un acierto de la vía visual sin texto es una figura (o un fotograma) con su pie: orden -1.
  if (r.fragmento.orden === -1) {
    const a = r.fragmento.ancla as AnclaMaterial;
    // Un fotograma no habla: el hablante que arrastra su ancla es el del tramo de transcripción.
    const ancla: AnclaMaterial = a.tipo === 'tiempo' ? { tipo: 'tiempo', t0: a.t0, t1: a.t1, instante: a.instante ?? a.t0, ...(a.region ? { region: a.region } : {}) } : a;
    return { documento: r.documento.id, ancla, cita: r.fragmento.texto, modo: 'imagen', unidad: r.fragmento.unidad, figura: r.fragmento.id };
  }
  const ancla = (r.pasaje?.ancla ?? r.fragmento.ancla) as AnclaMaterial;
  const fin = r.pasaje?.ancla ? r.pasaje.anclaFin : r.fragmento.anclaFin;
  return {
    documento: r.documento.id,
    ancla,
    ...(fin ? { anclaFin: fin as AnclaMaterial } : {}),
    cita: r.pasaje?.texto || r.fragmento.texto,
    modo: modoDeAncla(ancla, r.documento.tipo),
    unidad: r.fragmento.unidad,
    fragmento: r.fragmento.id,
  };
}

/** ¿Cae el ancla en el tramo de páginas o de tiempo? Las anclas de otro tipo no pasan un filtro de tramo. */
export function anclaEnTramo(a: Ancla | undefined, fin: Ancla | undefined, f: Pick<FiltrosCapas, 'paginas' | 'tiempo'>): boolean {
  if (!a) return !f.paginas && !f.tiempo;
  if (f.paginas) {
    const [d, h] = f.paginas;
    const p0 = a.tipo === 'pagina' ? a.fisica : a.tipo === 'diapositiva' ? a.n : null;
    if (p0 === null) return false;
    const p1 = fin?.tipo === 'pagina' ? fin.fisica : fin?.tipo === 'diapositiva' ? fin.n : p0;
    if (p1 < d || p0 > h) return false;
  }
  if (f.tiempo) {
    const [t0, t1] = f.tiempo;
    if (a.tipo !== 'tiempo') return false;
    const fin1 = fin?.tipo === 'tiempo' ? fin.t1 : a.t1;
    if (fin1 < t0 || a.t0 > t1) return false;
  }
  return true;
}

async function intentar<T>(f: () => Promise<T>, defecto: T, avisos: string[], aviso?: string): Promise<T> {
  try { return await f(); } catch (e) {
    const m = (e as Error).message ?? '';
    // Una estantería sin las tablas de comprensión (o del grafo) no es un error: esa capa está vacía.
    if (!/no such table|no such column/i.test(m) && aviso) avisos.push(`${aviso}: ${m}`);
    return defecto;
  }
}

/** Fragmentos donde el grafo ve la entidad (menciones de texto) y unidades donde aparece (apariciones). */
interface LugaresEntidad {
  fragmentos: Set<string>;
  /** «documento|página física» de las apariciones en páginas. */
  paginas: Set<string>;
  segmentos: Set<string>;
  tramos: Array<{ documento: string; t0: number; t1: number }>;
}

async function lugaresDeEntidad(sql: SQL, entidad: string, avisos: string[]): Promise<LugaresEntidad> {
  const fragmentos = new Set((await intentar(() => sql.ejecutar<{ fragmento: string }>('SELECT DISTINCT fragmento FROM menciones WHERE entidad = ?', entidad), [], avisos)).map((f) => String(f.fragmento)));
  const apariciones = await intentar(() => sql.ejecutar<{ documento: string; segmento: string | null; ancla: string; ancla_fin: string | null }>('SELECT documento, segmento, ancla, ancla_fin FROM apariciones WHERE entidad = ? LIMIT 2000', entidad), [], avisos);
  const paginas = new Set<string>();
  const segmentos = new Set<string>();
  const tramos: Array<{ documento: string; t0: number; t1: number }> = [];
  for (const a of apariciones) {
    if (a.segmento) segmentos.add(String(a.segmento));
    try {
      const ancla = JSON.parse(String(a.ancla)) as Ancla;
      if (ancla.tipo === 'tiempo') {
        const fin = a.ancla_fin ? (JSON.parse(String(a.ancla_fin)) as Ancla) : undefined;
        tramos.push({ documento: String(a.documento), t0: ancla.t0, t1: fin?.tipo === 'tiempo' ? fin.t1 : ancla.t1 });
      } else if (ancla.tipo === 'pagina') paginas.add(`${String(a.documento)}|${ancla.fisica}`);
    } catch { /* ancla ilegible: se ignora */ }
  }
  return { fragmentos, paginas, segmentos, tramos };
}

/**
 * Busca en las dos capas y las funde por rangos recíprocos. La capa literal es la
 * búsqueda de siempre (con sus vías, su reordenador y sus pasajes); la de comprensión,
 * las fichas por BM25 y por vectores, fundidas entre sí antes de entrar en la fusión.
 */
export async function buscarEnCapas(buscador: Buscador, consulta: string, opciones: OpcionesCapas = {}): Promise<RespuestaCapas> {
  const t0 = ahora();
  const { sql, indice } = buscador.puertos;
  const capas = new Set<Capa>(opciones.capas ?? ['literal', 'comprension']);
  const limite = opciones.limite ?? 10;
  const f = opciones.filtros ?? {};
  const avisos: string[] = [];
  const tiempos: Record<string, number> = {};
  const { paginas, tiempo, entidad, tipoSegmento, lente, clase, ...filtrosLiterales } = f;
  const hayTramo = !!paginas || !!tiempo;
  const lugares = entidad ? await lugaresDeEntidad(sql, entidad, avisos) : null;
  const { porId: docs } = await buscador.estanteria.documentos();
  const permitidos = await buscador.estanteria.documentosPermitidos(filtrosLiterales);

  // --- Capa literal -------------------------------------------------------
  const pLiteral = (async (): Promise<{ r: RespuestaBusqueda | null; lista: ResultadoLiteral[] }> => {
    if (!capas.has('literal')) return { r: null, lista: [] };
    const tl = ahora();
    // Con tramo o entidad se filtra después: se piden más para que queden bastantes.
    const pedir = hayTramo || lugares ? Math.min(100, limite * 5) : limite;
    const r = await buscador.buscar(consulta, { filtros: filtrosLiterales, limite: pedir, ...(opciones.reordenar !== undefined ? { reordenar: opciones.reordenar } : {}) });
    tiempos.literal = Math.round(ahora() - tl);
    let rs = r.resultados;
    if (hayTramo) rs = rs.filter((x) => anclaEnTramo(x.fragmento.ancla, x.fragmento.anclaFin, f));
    if (lugares) {
      rs = rs.filter((x) => lugares.fragmentos.has(x.fragmento.id)
        || (x.fragmento.ancla.tipo === 'pagina' && lugares.paginas.has(`${x.documento.id}|${x.fragmento.ancla.fisica}`))
        || lugares.tramos.some((t) => t.documento === x.documento.id && x.fragmento.ancla.tipo === 'tiempo' && x.fragmento.ancla.t0 < t.t1 && x.fragmento.ancla.t1 > t.t0));
    }
    return {
      r,
      lista: rs.map((x) => ({ capa: 'literal' as const, id: x.fragmento.id, puntuacion: x.puntuacion, documento: x.documento as DocumentoBreve, resultado: x, evidencias: [evidenciaDeResultado(x)] })),
    };
  })();

  // --- Capa de comprensión -----------------------------------------------
  const pComprension = (async (): Promise<ResultadoComprension[]> => {
    if (!capas.has('comprension')) return [];
    const tc = ahora();
    const documentos = permitidos ? [...permitidos] : undefined;
    if (documentos && !documentos.length) return [];
    const k = Math.max(20, limite * 3);
    const lexicas = await intentar(() => buscarFichas(sql, consulta, { ...(documentos && documentos.length <= 90 ? { documentos } : {}), limite: k }), [], avisos, 'Fichas (FTS)');
    let densas: string[] = [];
    if (indice && buscador.puertos.embebedor) {
      densas = await intentar(async () => {
        const [v] = await buscador.vectorizarConsultas([consulta]);
        if (!v) return [];
        const filtro: Record<string, unknown> = { objetivo: 'ficha' };
        if (documentos && documentos.length <= 100) filtro.documento = { $in: documentos };
        const cs = await indice.consultar(buscador.puertos.espacioNombres ?? 'estanteria', v, { k, filtro, conMetadatos: true });
        return cs.map((c) => c.id);
      }, [], avisos, 'Fichas (vectores)');
    }
    const puntos = fusionarRangos([{ ids: lexicas.map((x) => x.id), peso: 0.6 }, { ids: densas, peso: 1 }], 10);
    if (!puntos.size) { tiempos.comprension = Math.round(ahora() - tc); return []; }
    const porId = new Map<string, Ficha>(lexicas.map((x) => [x.id, x]));
    const faltan = [...puntos.keys()].filter((id) => !porId.has(id));
    for (const x of await intentar(() => leerFichasPorId(sql, faltan), [], avisos)) porId.set(x.id, x);
    // Los segmentos de las fichas de segmento (para filtrar por tipo y por tramo).
    const idsSeg = [...new Set([...porId.values()].filter((x) => x.objetivo === 'segmento').map((x) => x.objetivoId))];
    const segmentos = new Map<string, Segmento>();
    if (idsSeg.length) {
      for (let i = 0; i < idsSeg.length; i += 90) {
        const l = enLista(idsSeg.slice(i, i + 90));
        const filas = await intentar(() => sql.ejecutar<Record<string, unknown>>(`SELECT id, documento, padre, nivel, orden, tipo, titulo, ancla, ancla_fin, unidad_desde, unidad_hasta, resumen, origen, confianza FROM segmentos WHERE id IN ${l.sql}`, l.param), [], avisos);
        for (const s of filas) {
          const seg: Segmento = {
            id: String(s.id), documento: String(s.documento), padre: s.padre ? String(s.padre) : null, nivel: Number(s.nivel), orden: Number(s.orden),
            tipo: String(s.tipo) as TipoSegmento, titulo: String(s.titulo), ancla: JSON.parse(String(s.ancla)) as AnclaMaterial,
            unidadDesde: String(s.unidad_desde), unidadHasta: String(s.unidad_hasta), origen: String(s.origen) as Segmento['origen'], confianza: Number(s.confianza),
          };
          if (s.ancla_fin) seg.anclaFin = JSON.parse(String(s.ancla_fin)) as AnclaMaterial;
          if (s.resumen) seg.resumen = String(s.resumen);
          segmentos.set(seg.id, seg);
        }
      }
    }
    const ts = terminos(consulta);
    const salida: ResultadoComprension[] = [];
    const ordenados = [...puntos.entries()].sort((a, b) => b[1] - a[1]);
    const max = ordenados[0]?.[1] ?? 1;
    for (const [id, p] of ordenados) {
      const ficha = porId.get(id);
      if (!ficha) continue;
      if (ficha.documento && (!docs.has(ficha.documento) || (permitidos && !permitidos.has(ficha.documento)))) continue;
      if (!ficha.documento && permitidos && !ficha.evidencias.some((e) => permitidos.has(e.documento))) continue;
      if (f.idiomas?.length && ficha.idioma && !f.idiomas.some((i) => plegar(i).slice(0, 2) === plegar(ficha.idioma).slice(0, 2))) continue;
      if (lente && ficha.lente !== lente) continue;
      if (clase && ficha.clase !== clase) continue;
      const segmento = ficha.objetivo === 'segmento' ? segmentos.get(ficha.objetivoId) : undefined;
      if (tipoSegmento && segmento?.tipo !== tipoSegmento && ficha.clase !== tipoSegmento) continue;
      if (hayTramo) {
        const dentro = segmento ? anclaEnTramo(segmento.ancla, segmento.anclaFin, f) : ficha.evidencias.some((e) => anclaEnTramo(e.ancla, e.anclaFin, f));
        if (!dentro) continue;
      }
      if (lugares) {
        const trata = (ficha.objetivo === 'entidad' && ficha.objetivoId === entidad) || (segmento && lugares.segmentos.has(segmento.id))
          || ficha.evidencias.some((e) => (e.fragmento && lugares.fragmentos.has(e.fragmento)) || (e.ancla.tipo === 'pagina' && lugares.paginas.has(`${e.documento}|${e.ancla.fisica}`)));
        if (!trata) continue;
      }
      const documento = ficha.documento ? docs.get(ficha.documento) ?? null : null;
      salida.push({
        capa: 'comprension', id, puntuacion: Math.round((p / max) * 1e4) / 1e4, documento, ficha,
        ...(segmento ? { segmento } : {}),
        evidencias: ficha.evidencias,
        resaltado: resaltar(ficha.texto, ts, 360),
      });
      if (salida.length >= k) break;
    }
    tiempos.comprension = Math.round(ahora() - tc);
    return salida;
  })();

  const [{ r: literal, lista: literales }, comprension] = await Promise.all([pLiteral, pComprension]);

  // --- Fusión ------------------------------------------------------------
  const pesoC = opciones.pesoComprension ?? 0.8;
  const puntos = fusionarRangos([
    { ids: literales.map((x) => `l:${x.id}`), peso: 1 },
    { ids: comprension.map((x) => `c:${x.id}`), peso: pesoC },
  ], 10);
  const todos = new Map<string, ResultadoCapa>([
    ...literales.map((x) => [`l:${x.id}`, x] as const),
    ...comprension.map((x) => [`c:${x.id}`, x] as const),
  ]);
  const orden = [...puntos.entries()].sort((a, b) => b[1] - a[1]);
  const max = orden[0]?.[1] ?? 1;
  const resultados = orden.slice(0, limite).map(([clave, p]) => ({ ...(todos.get(clave) as ResultadoCapa), puntuacion: Math.round((p / max) * 1e4) / 1e4 }));
  tiempos.total = Math.round(ahora() - t0);
  if (literal) avisos.push(...literal.avisos);
  return { resultados, literal, fichas: comprension.length, avisos, tiempos };
}
