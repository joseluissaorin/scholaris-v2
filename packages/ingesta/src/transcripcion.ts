/**
 * La transcripción completa de un medio (percepcion/NOTAS.md, «La transcripción»).
 *
 * 1. `completarTranscripcion`, en la ingesta, después de transcribir las tandas y
 *    antes de consolidar: comprueba la cobertura contra el mapa de la voz
 *    (`proxy.voz.json`; sin él, los silencios largos de la transcripción),
 *    vuelve a transcribir los huecos en subventanas de 75 s como mucho (Gemini
 *    mirando y oyendo el proxy; si no hay proxy o falla, la reserva con el audio
 *    recortado del tramo), sustituye las unidades con el tiempo roto y, si hay
 *    percepción (reparto con caras y voces), revisa quién dice cada frase. Deja
 *    las palabras corregidas para `consolidar`, que ya no las vuelve a casar.
 * 2. `reescribirTranscripcion`, para un documento que ya existe: rehace la capa
 *    literal (unidades, fragmentos, instantes de las palabras, hablantes,
 *    vectores) con la transcripción corregida. Los fragmentos cuyo texto no
 *    cambia conservan su id, su contexto y sus vectores; solo se paga lo nuevo.
 *
 * Todo lo que cuesta queda grabado (`AlmacenTrabajo`): repetir un paso no paga
 * dos veces ninguna llamada.
 */
import { enLista, type Documento, type Inteligencia, type MetadatosDocumento, type PalabraTranscrita, type PersonaPercibida, type SQL, type Vector } from '@scholaris/nucleo';
import * as spdf from '@scholaris/spdf';
import {
  aplicarCorrecciones, coberturaTranscripcion, palabrasTranscritas, revisarTranscripcionConVideo,
  type CoberturaTranscripcion, type CorreccionTranscripcion, type PuertosRevision, type RevisionTranscripcion,
} from './percepcion/revision.js';
import type { UnidadMedio } from './percepcion/tipos.js';
import { segmentarTranscripcion, type OpcionesSegmentar } from './pasos/medios.js';
import { fragmentosDeMedio } from './pasos/fragmentos.js';
import { contextoExtractivo, pasoContexto } from './pasos/contexto.js';
import { textoVectorizable, vectorizar } from './pasos/vectores.js';
import { entradasIndice } from './pasos/indexado.js';
import { claveTranscripcionCompleta, escribir, guardarJson, huellaCorta, idUnidadDe, palabrasDeTandas, type ContextoTuberia, type TranscripcionCompleta } from './tuberia.js';
import type { FragmentoPlano, PuertosIngesta, UnidadLeida } from './tipos.js';

/** Las palabras del transcriptor cortadas en unidades de 30-60 s, como unidades de un medio. */
export function unidadesDePalabras(palabras: PalabraTranscrita[], o?: OpcionesSegmentar): UnidadMedio[] {
  return segmentarTranscripcion(palabras, o).map((u, i) => ({
    orden: i, texto: u.texto, t0: u.t0 ?? 0, t1: u.t1 ?? 0, ...(u.hablante ? { hablante: u.hablante } : {}), ...(u.palabras ? { palabras: u.palabras } : {}),
  }));
}

const cuenta = (cs: CorreccionTranscripcion[]) => ({
  huecos: cs.filter((c) => c.tipo === 'hueco' && !c.reemplaza?.length).length,
  tiemposRotos: cs.filter((c) => c.tipo === 'hueco' && !!c.reemplaza?.length).length,
  hablantes: cs.filter((c) => c.tipo === 'hablante').length,
  desfases: cs.filter((c) => c.tipo === 'desfase').length,
});

const resumenCobertura = (c: CoberturaTranscripcion) => ({
  activo: c.activo, cubierto: c.cubierto, huecos: c.huecos.length,
  sinTexto: Math.round(c.huecos.filter((h) => h.motivo === 'sin_texto').reduce((s, h) => s + h.activo, 0)),
  palabrasRotas: c.palabrasRotas, palabras: c.palabras,
});

// ---------------------------------------------------------------------------
// En la ingesta: antes de consolidar
// ---------------------------------------------------------------------------

export interface OpcionesCompletar {
  duracion: number;
  /** Tramos con sonido en la banda de la voz (`proxy.voz.json`). */
  actividad?: Array<[number, number]>;
  /** El reparto que vio la percepción (caras y voces): con él (y con vídeo) se revisan también los hablantes. */
  reparto?: PersonaPercibida[];
  /** Revisar los hablantes mirando el vídeo (por defecto, solo si hay reparto de la percepción). */
  hablantes?: boolean;
  ficha?: string;
  idioma?: string;
  modelo?: string;
  modeloHablantes?: string;
  presupuestoUsd?: number;
  maxSubventanas?: number;
  concurrencia?: number;
  prefijoTrabajo?: string;
  /** Confianza mínima de las correcciones que se aplican (0,7). */
  minConfianza?: number;
}

export interface ResultadoCompletar {
  /** La revisión, ya marcada como aplicada (sus `unidad` se refieren a las unidades provisionales). */
  revision: RevisionTranscripcion;
  /** Para la procedencia y el informe. */
  resumen: Record<string, unknown>;
  palabras: number;
}

/**
 * Completa la transcripción de un medio antes de consolidarlo (ver arriba). Deja
 * las palabras corregidas en el estado de trabajo; `consolidar` las recoge.
 */
export async function completarTranscripcion(ctx: ContextoTuberia, p: PuertosRevision, o: OpcionesCompletar): Promise<ResultadoCompletar> {
  const palabras = await palabrasDeTandas(ctx, { completa: false });
  const unidades = unidadesDePalabras(palabras, ctx.opciones.tramosMedio);
  const hablantes = o.hablantes ?? !!(o.reparto?.length && p.vidente && p.fuente);
  const revision = await revisarTranscripcionConVideo(p, {
    documento: ctx.documento, duracion: o.duracion, unidades,
    ...(o.actividad ? { actividad: o.actividad } : {}), ...(o.reparto ? { reparto: o.reparto } : {}),
    ...(o.ficha ? { ficha: o.ficha } : {}), ...(o.idioma ? { idioma: o.idioma } : {}),
    ...(o.modelo ? { modelo: o.modelo } : {}), ...(o.modeloHablantes ? { modeloHablantes: o.modeloHablantes } : {}),
    hablantes, ...(o.presupuestoUsd !== undefined ? { presupuestoUsd: o.presupuestoUsd } : {}),
    ...(o.maxSubventanas !== undefined ? { maxSubventanas: o.maxSubventanas } : {}),
    ...(o.concurrencia ? { concurrencia: o.concurrencia } : {}), prefijoTrabajo: o.prefijoTrabajo ?? 'revision/',
  });
  const corregidas = aplicarCorrecciones(unidades, revision.correcciones, { minConfianza: o.minConfianza ?? 0.7 });
  const nuevas = palabrasTranscritas(corregidas);
  const coberturaFinal = coberturaTranscripcion(corregidas, { duracion: o.duracion, ...(o.actividad ? { actividad: o.actividad } : {}) });
  const resumen = {
    antes: resumenCobertura(revision.cobertura), despues: resumenCobertura(coberturaFinal), correcciones: cuenta(revision.correcciones),
    mapaVoz: !!o.actividad, conVideo: !!(p.vidente && p.fuente), hablantesRevisados: hablantes,
    modelo: revision.modelo, usd: Math.round(revision.coste.usd * 10000) / 10000, llamadas: revision.coste.llamadas, grabadas: revision.coste.grabadas,
    palabras: { antes: palabras.length, despues: nuevas.length }, avisos: revision.avisos.slice(0, 20),
  };
  const hablantesRevisados = hablantes && revision.correcciones.some((c) => c.tipo === 'hablante');
  await guardarJson(ctx, claveTranscripcionCompleta(ctx.documento), { palabras: nuevas, ...(hablantesRevisados ? { hablantesRevisados: true } : {}), resumen } satisfies TranscripcionCompleta);
  return { revision: { ...revision, aplicada: new Date().toISOString(), coberturaFinal }, resumen, palabras: nuevas.length };
}

// ---------------------------------------------------------------------------
// Documentos que ya existen: reescribir la capa literal
// ---------------------------------------------------------------------------

export interface PuertosReescritura {
  sql: SQL;
  inteligencia: Pick<Inteligencia, 'embebedor' | 'embebedoresExtra' | 'redactor'>;
  indice?: PuertosIngesta['indice'];
  reloj?: () => number;
}

export interface OpcionesReescritura {
  tramosMedio?: OpcionesSegmentar;
  sinContexto?: boolean;
  /** Lo que se apunta en la procedencia (`transcripcion-revisada`). */
  detalle?: Record<string, unknown>;
  concurrencia?: number;
}

export interface ResultadoReescritura {
  unidades: { antes: number; despues: number };
  fragmentos: { total: number; conservados: number; nuevos: number; borrados: number };
  vectores: number;
  figuras: number;
  ms: number;
}

interface FilaFragmento { id: string; texto: string; contexto: string | null }

/**
 * Rehace la capa literal de un medio que ya existe con una transcripción nueva
 * (las palabras corregidas): unidades de 30-60 s, fragmentos, instantes por
 * palabra y hablantes. Lo que no cambia se queda como estaba (mismo id, mismo
 * contexto, mismos vectores); lo nuevo se sitúa y se vectoriza; lo que sobra se
 * borra de la estantería y del índice. Los fotogramas se vuelven a colgar de la
 * unidad que los contiene. No toca la comprensión: esa se vuelve a lanzar aparte
 * y rehace solo los segmentos cuyo material cambió.
 */
export async function reescribirTranscripcion(p: PuertosReescritura, documento: string, palabras: PalabraTranscrita[], o: OpcionesReescritura = {}): Promise<ResultadoReescritura> {
  const reloj = p.reloj ?? Date.now;
  const t0 = reloj();
  const doc = (await spdf.leerDocumento(p.sql, documento)) as Documento | null;
  if (!doc) throw new Error(`No existe el documento ${documento}`);
  if (doc.tipo !== 'video' && doc.tipo !== 'audio') throw new Error('Solo se reescribe la transcripción de un audio o un vídeo.');
  if (!palabras.length) throw new Error('La transcripción nueva está vacía: no se reescribe nada.');
  const meta: MetadatosDocumento = doc.metadatos;
  const unidades: UnidadLeida[] = segmentarTranscripcion(palabras, o.tramosMedio).map((u, i) => ({ ...u, orden: i, fisica: i + 1 }));
  const finales: FragmentoPlano[] = fragmentosDeMedio(unidades);
  const idUnidad = (orden: number) => idUnidadDe(documento, orden);

  // Lo que había: fragmentos (por su texto) y qué vectores tiene cada uno en cada espacio.
  const viejos = await p.sql.ejecutar<FilaFragmento>('SELECT id, texto, contexto FROM fragmentos WHERE documento = ? ORDER BY orden', documento);
  const [{ n: antes = 0 } = { n: 0 }] = await p.sql.ejecutar<{ n: number }>('SELECT count(*) AS n FROM unidades WHERE documento = ?', documento);
  const embebedores = [p.inteligencia.embebedor, ...(p.inteligencia.embebedoresExtra ?? [])];
  const conVector = new Map<string, Set<string>>();
  for (const e of embebedores) {
    const filas = await p.sql.ejecutar<{ id: string }>("SELECT id FROM vectores WHERE documento = ? AND objetivo = 'fragmento' AND espacio = ?", documento, e.espacio.id);
    conVector.set(e.espacio.id, new Set(filas.map((f) => f.id)));
  }
  const libres = new Map<string, FilaFragmento[]>();
  for (const v of viejos) libres.set(v.texto, [...(libres.get(v.texto) ?? []), v]);
  const conservados = new Set<string>();
  const nuevos: FragmentoPlano[] = [];
  finales.forEach((f, i) => {
    f.orden = i;
    const v = libres.get(f.texto)?.shift();
    if (v) { f.id = v.id; f.contexto = v.contexto ?? ''; conservados.add(v.id); }
    else { f.id = `${documento}:c${huellaCorta(`${i}|${f.seccion.join('›')}|${f.texto}`)}`; nuevos.push(f); }
  });
  // Un id nuevo que coincide con el de uno viejo que sobra (mismo sitio y mismo texto en otra pasada): es el mismo.
  const idsFinales = new Set(finales.map((f) => f.id));
  const sobrantes = viejos.map((v) => v.id).filter((id) => !idsFinales.has(id));

  // Contexto de lo nuevo.
  if (nuevos.length && !o.sinContexto) {
    const r = await pasoContexto(nuevos, meta, p.inteligencia.redactor, { concurrencia: o.concurrencia ?? 16, reloj, limiteMs: 20_000 }).catch(() => null);
    for (const f of nuevos) f.contexto = r?.contextos[f.id] || contextoExtractivo(f, meta);
  } else for (const f of nuevos) if (!f.contexto) f.contexto = contextoExtractivo(f, meta);

  // Escribir: unidades, fragmentos, fuera lo que sobra.
  const ahora = new Date().toISOString();
  await escribir(p.sql, async (tx) => {
    for (let i = 0; i < sobrantes.length; i += 500) {
      const l = enLista(sobrantes.slice(i, i + 500));
      await tx.ejecutar(`DELETE FROM fragmentos WHERE id IN ${l.sql}`, l.param);
      await tx.ejecutar(`DELETE FROM vectores WHERE objetivo = 'fragmento' AND id IN ${l.sql}`, l.param);
    }
    await tx.ejecutar('DELETE FROM unidades WHERE documento = ? AND orden >= ?', documento, unidades.length);
    await spdf.escribirUnidades(tx, unidades.map((u) => ({
      id: idUnidad(u.orden), documento, orden: u.orden, texto: u.texto, notas: [], lector: 'transcripcion-revisada', confianza: u.confianza,
      ancla: u.ancla ?? { tipo: 'tiempo' as const, t0: u.t0 ?? 0, t1: u.t1 ?? 0 }, ...(u.palabras ? { palabras: u.palabras } : {}),
    })));
    await spdf.escribirFragmentos(tx, finales.map((f) => ({
      id: f.id, documento, unidad: idUnidad(f.unidad), orden: f.orden, texto: f.texto, contexto: f.contexto, seccion: f.seccion, ancla: f.ancla, ...(f.anclaFin ? { anclaFin: f.anclaFin } : {}),
    })));
    await tx.ejecutar('UPDATE documentos SET unidades = ?, actualizado = ? WHERE id = ?', unidades.length, ahora, documento);
  });
  if (p.indice?.borrar && sobrantes.length) for (const e of embebedores) await p.indice.borrar(e.espacio, sobrantes).catch(() => undefined);

  // Los fotogramas, colgados de la unidad que los contiene (y con su hablante).
  const figuras = await p.sql.ejecutar<{ id: string; ancla: string }>('SELECT id, ancla FROM figuras WHERE documento = ?', documento);
  let movidas = 0;
  await escribir(p.sql, async (tx) => {
    for (const g of figuras) {
      const a = JSON.parse(g.ancla) as { tipo: string; t0?: number; instante?: number };
      if (a.tipo !== 'tiempo') continue;
      const t = a.instante ?? a.t0 ?? 0;
      const u = unidades.find((x) => t >= (x.t0 ?? 0) && t <= (x.t1 ?? 0)) ?? unidades.reduce<UnidadLeida | undefined>((m, x) => (!m || Math.abs((x.t0 ?? 0) - t) < Math.abs((m.t0 ?? 0) - t) ? x : m), undefined);
      if (!u) continue;
      await tx.ejecutar('UPDATE figuras SET unidad = ? WHERE id = ?', idUnidad(u.orden), g.id);
      movidas++;
    }
  });

  // Vectores: los fragmentos nuevos y los conservados a los que les falte el de algún espacio.
  const tiempos = new Map<string, number>();
  for (const f of finales) if (f.ancla.tipo === 'tiempo') tiempos.set(f.id, f.ancla.t0);
  const documentoFinal = { ...doc, unidades: unidades.length, actualizado: ahora };
  let nVectores = 0;
  for (const e of embebedores) {
    const tiene = conVector.get(e.espacio.id) ?? new Set<string>();
    const piezas = finales.filter((f) => !tiene.has(f.id)).map((f) => ({ objetivo: 'fragmento' as const, id: f.id, texto: textoVectorizable(f) }));
    if (!piezas.length) continue;
    await vectorizar(piezas, e, { parte: async () => null }, async (vs: Vector[]) => {
      await escribir(p.sql, (tx) => spdf.escribirVectores(tx, vs.map((v) => ({ ...v, documento }))));
      if (p.indice) await p.indice.insertar(e.espacio, entradasIndice(documentoFinal, vs, tiempos)).catch(() => undefined);
      nVectores += vs.length;
    }, { concurrencia: 16, loteTexto: 50, reloj });
  }

  const resultado: ResultadoReescritura = {
    unidades: { antes: Number(antes), despues: unidades.length },
    fragmentos: { total: finales.length, conservados: conservados.size, nuevos: nuevos.length, borrados: sobrantes.length },
    vectores: nVectores, figuras: movidas, ms: reloj() - t0,
  };
  await escribir(p.sql, async (tx) => {
    await tx.ejecutar("DELETE FROM procedencia WHERE documento = ? AND fase = 'lectura' AND proveedor = 'transcripcion-revisada'", documento);
    await spdf.registrarProcedencia(tx, { documento, fase: 'lectura', proveedor: 'transcripcion-revisada', detalle: { ...resultado, ...(o.detalle ?? {}) }, ms: resultado.ms, cuando: ahora });
  });
  return resultado;
}
