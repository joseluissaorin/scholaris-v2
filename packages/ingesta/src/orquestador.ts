/**
 * El orquestador local: la tubería por tandas con paralelismo real (Node, banco
 * de pruebas, versión local). En Cloudflare, la plataforma llama a las mismas
 * funciones como pasos del Workflow (ver NOTAS.md):
 *
 *   prepararDocumento
 *   [modo económico] enviarLote → (dormir) → recogerLote
 *   por cada tanda, en paralelo: leerTanda → indexarTanda   (legible → buscable → vectores)
 *   metadatosTempranos, en cuanto están las primeras páginas
 *   consolidar                                               (folios, secciones, costuras, figuras, «listo»)
 *
 * Señales para la interfaz: `unidadesListas` (legibles) y `unidadesBuscables`
 * (ya en el índice léxico) en cada `Progreso`, y `alUnidades(desde, hasta, buscables)`.
 * En audio y vídeo, el orden de una unidad provisional es su segundo de inicio; al
 * consolidar se sustituyen por las definitivas (orden 0…n) y se avisa de todas.
 */

import { enParalelo, nuevoId, type Documento, type FaseIngesta, type MetadatosDocumento, type Progreso } from '@scholaris/nucleo';
import type { PaqueteConversion } from '@scholaris/imprenta';
import { planificar } from './planificar.js';
import type { FragmentoPlano, OpcionesIngesta, Plan, Procedencia, PuertosIngesta, Seccion, UnidadLeida } from './tipos.js';
import type { OpcionesFolios } from './pasos/folios.js';
import type { FiguraConAncla } from './pasos/figuras.js';
import { Cobertura } from './cobertura.js';
import {
  consolidar, enviarLote, indexarTanda, leerTanda, metadatosTempranos, prepararDocumento, recogerLote,
  type ContextoTuberia, type OpcionesTuberia, type ResumenTanda,
} from './tuberia.js';

export interface ResultadoIngesta {
  documento: Documento;
  plan: Plan;
  unidades: Array<UnidadLeida & { id: string; imagen?: string; miniatura?: string }>;
  secciones: Seccion[];
  fragmentos: FragmentoPlano[];
  figuras: FiguraConAncla[];
  procedencia: Procedencia[];
  avisos: string[];
  /** Milisegundos: hitos (primera unidad legible, primera buscable, todo buscable) y total. */
  tiempos: Record<string, number>;
  vectores: Record<string, number>;
  /** Medios: frases corregidas por la segunda escucha. */
  cambiosTranscripcion?: import('./pasos/revision.js').CambioTranscripcion[];
}

const PESOS: Partial<Record<FaseIngesta, number>> = { lectura: 0.55, indexado: 0.15, metadatos: 0.03, folios: 0.02, estructura: 0.02, contexto: 0.1, vectores: 0.1, figuras: 0.03 };

export interface OpcionesOrquestador extends OpcionesIngesta {
  documentoId?: string;
  pista?: string;
  /** Deductor de folios externo (sin uso en la tubería: se usa `@scholaris/folios` con el juez). */
  deducirFolios?: OpcionesFolios['deducir'];
  foliosPropios?: boolean;
  describirFiguras?: boolean;
  atribuirHablantes?: boolean;
  revisarTranscripcion?: boolean;
  tramosMedio?: { minimo?: number; objetivo?: number; maximo?: number };
  troceado?: { minimo?: number; objetivo?: number; maximo?: number };
  bibliotecas?: string[];
  espacioNombres?: string;
  /** Unidades nuevas: legibles (`buscables` false) o ya en el índice léxico (`buscables` true). Orden base 0. */
  alUnidades?: (desde: number, hasta: number, buscables: boolean) => void;
  /** Modo económico: cada cuánto se pregunta por el lote y cuánto se espera como mucho. */
  esperaLote?: { cadaMs?: number; maximoMs?: number };
}

export type ProgresoIngesta = Progreso;

export async function ejecutarIngesta(paquete: PaqueteConversion, puertos: PuertosIngesta, opciones: OpcionesOrquestador = {}): Promise<ResultadoIngesta> {
  if (!puertos.sql) throw new Error('La ingesta necesita un puerto SQL (la estantería o un .spdf) donde escribir.');
  const reloj = puertos.reloj ?? Date.now;
  const inicio = reloj();
  const documento = opciones.documentoId ?? nuevoId('doc');
  const tarea = opciones.tarea ?? documento;
  const plan = planificar(paquete, opciones);
  const opcionesTuberia: OpcionesTuberia = {
    reloj,
    ...(opciones.pista ? { pista: opciones.pista } : {}),
    ...(opciones.troceado ? { troceado: opciones.troceado } : {}),
    ...(opciones.tramosMedio ? { tramosMedio: opciones.tramosMedio } : {}),
    ...(opciones.describirFiguras === false ? { describirFiguras: false } : {}),
    ...(opciones.atribuirHablantes === false ? { atribuirHablantes: false } : {}),
    ...(opciones.revisarTranscripcion === false ? { revisarTranscripcion: false } : {}),
    ...(opciones.sinVerificacion ? { sinVerificacion: true } : {}),
    ...(opciones.sinContexto ? { sinContexto: true } : {}),
    ...(opciones.metadatosUsuario ? { metadatosUsuario: opciones.metadatosUsuario } : {}),
    ...(opciones.bibliotecas ? { bibliotecas: opciones.bibliotecas } : {}),
    ...(opciones.foliosPropios ? { foliosPropios: true } : {}),
  };
  const ctx: ContextoTuberia = { paquete, plan, puertos: puertos as ContextoTuberia['puertos'], documento, opciones: opcionesTuberia };
  const tiempos: Record<string, number> = {};
  const hito = (k: string) => { tiempos[k] ??= reloj() - inicio; };

  // --- progreso -----------------------------------------------------------
  const avance: Partial<Record<FaseIngesta, number>> = {};
  let legibles = 0, buscables = 0;
  const emitir = (fase: FaseIngesta, a: number, mensaje?: string) => {
    avance[fase] = Math.max(avance[fase] ?? 0, Math.min(1, a));
    let total = 0;
    for (const [f, p] of Object.entries(PESOS)) total += (p as number) * (avance[f as FaseIngesta] ?? 0);
    opciones.onProgreso?.({ tarea, documento, fase, avance: avance[fase] ?? 0, total: Math.min(0.999, total), unidadesListas: legibles, unidadesBuscables: buscables, transcurrido: reloj() - inicio, ...(mensaje ? { mensaje } : {}) });
  };

  await prepararDocumento(ctx);
  emitir('lectura', 0, `${plan.unidades} unidades en ${plan.tandas.length} tandas (${plan.pliegos.length} pliegos de visión)`);

  // --- metadatos, en cuanto están las primeras páginas -------------------
  const nPrimeras = Math.min(5, plan.unidades || 1);
  const primeras = new Map<number, UnidadLeida>();
  let resolver: (u: UnidadLeida[]) => void = () => {};
  const primerasListas = new Promise<UnidadLeida[]>((r) => { resolver = r; });
  const metadatosP: Promise<MetadatosDocumento | null> = plan.modo === 'medio'
    ? Promise.resolve(null) // en los medios, con toda la transcripción, al consolidar
    : primerasListas.then(async (us) => {
      const t = reloj();
      try {
        const r = await metadatosTempranos(ctx, us);
        tiempos.metadatos = reloj() - t;
        emitir('metadatos', 1, r.metadatos.titulo);
        return r.metadatos;
      } catch { return null; }
    });
  metadatosP.catch(() => undefined);

  // --- las tandas: leer (con su límite de concurrencia) e indexar (sin bloquear la lectura)
  const cobertura = new Cobertura(15_000, 2.2, reloj);
  const indexaciones: Array<Promise<ResumenTanda>> = [];
  /** Una por tanda: se cumple cuando su texto ya es buscable y su estado está guardado. */
  const yaBuscables: Array<Promise<void>> = [];
  let vectorizadas = 0;
  // --- modo económico: lo difícil, a la API por lotes ---------------------
  // Mientras el lote se procesa (horas), las tandas de capa de texto ya se leen e indexan.
  let resultadosLote: Awaited<ReturnType<typeof recogerLote>>['resultados'];
  const esperarLote = async () => {
  if (opciones.modo === 'economico' && puertos.lotes) {
    const t = reloj();
    const id = await enviarLote(ctx);
    if (id) {
      const cada = opciones.esperaLote?.cadaMs ?? 60_000, maximo = opciones.esperaLote?.maximoMs ?? 26 * 3600_000;
      for (;;) {
        const r = await recogerLote(ctx, id);
        if (r.listo) { resultadosLote = r.resultados; break; }
        if (reloj() - t > maximo) break; // lo que no llegó se lee en línea
        emitir('lectura', 0, 'Esperando a la API por lotes');
        await new Promise((res) => setTimeout(res, cada));
      }
    }
    tiempos.lote = reloj() - t;
  }
  };

  const procesar = async (t: (typeof plan.tandas)[number]) => {
    const lectura = await leerTanda(t, ctx, { cobertura, ...(resultadosLote ? { resultadosLote } : {}) });
    legibles += lectura.unidades.length;
    hito('primeraLegible');
    for (const u of lectura.unidades) if (u.fisica <= nPrimeras) primeras.set(u.fisica, u);
    if (plan.modo !== 'paginas' || primeras.size >= nPrimeras) resolver(plan.modo === 'paginas' ? [...primeras.values()].sort((a, b) => a.fisica - b.fisica) : lectura.unidades.slice(0, nPrimeras));
    if (lectura.unidades.length) {
      const ordenes = lectura.unidades.map((u) => u.orden);
      opciones.alUnidades?.(Math.min(...ordenes), Math.max(...ordenes), false);
    }
    emitir('lectura', legibles / Math.max(1, plan.unidades));
    let marcarBuscable: () => void = () => {};
    yaBuscables.push(new Promise<void>((res) => { marcarBuscable = res; }));
    const p = indexarTanda(t, lectura, ctx, {
      metadatos: metadatosP,
      alBuscables: (r) => {
        marcarBuscable();
        buscables += r.buscables;
        hito('primeraBuscable');
        if (r.legibles) opciones.alUnidades?.(r.legibles[0], r.legibles[1], true);
        emitir('indexado', buscables / Math.max(1, plan.unidades));
      },
    }).then((r) => { vectorizadas += r.vectores; return r; });
    p.catch(() => undefined).finally(() => marcarBuscable());
    indexaciones.push(p);
  };
  const deCapa = plan.tandas.filter((t) => t.clase === 'capa');
  const resto = plan.tandas.filter((t) => t.clase !== 'capa');
  if (opciones.modo === 'economico' && puertos.lotes) {
    await Promise.all([enParalelo(deCapa, plan.concurrencia, procesar), esperarLote()]);
    await enParalelo(resto, plan.concurrencia, procesar);
  } else await enParalelo(plan.tandas, plan.concurrencia, procesar);
  hito('lecturaCompleta');
  resolver([...primeras.values()].sort((a, b) => a.fisica - b.fisica));
  // La consolidación empieza ya (folios, secciones, troceado, figuras) y espera a las tandas solo para reaprovechar.
  const todas = Promise.all(indexaciones).then((rs) => { hito('todoBuscable'); emitir('vectores', 0.5, `${vectorizadas} vectores durante la lectura`); return rs; });
  await Promise.all(yaBuscables);
  const tc = reloj();
  emitir('estructura', 0.5);
  const r = await consolidar(ctx, { metadatos: metadatosP, esperarTandas: todas });
  await todas;
  tiempos.consolidacion = reloj() - tc;
  for (const [k, v] of Object.entries(r.tiempos)) tiempos[`consolidacion:${k}`] = v;
  tiempos.total = reloj() - inicio;
  opciones.alUnidades?.(0, Math.max(0, r.unidades.length - 1), true);
  opciones.onProgreso?.({ tarea, documento, fase: 'listo', avance: 1, total: 1, unidadesListas: r.unidades.length, unidadesBuscables: r.unidades.length, transcurrido: tiempos.total });

  const c = paquete.contenido;
  const unidades = r.unidades.map((u) => {
    const pag = c.clase === 'pdf' ? c.paginas[u.fisica - 1] : c.clase === 'imagenes' ? c.paginas[u.fisica - 1] : undefined;
    const diapo = c.clase === 'presentacion' ? c.diapositivas[u.orden] : undefined;
    const imagen = pag?.imagen ?? diapo?.imagen;
    const miniatura = pag?.miniatura ?? (diapo ? paquete.partes.find((x) => x.clase === 'miniatura' && x.unidad === diapo.n)?.id : undefined);
    return { ...u, ...(imagen ? { imagen } : {}), ...(miniatura ? { miniatura } : {}) };
  });
  return {
    documento: r.documento, plan, unidades, secciones: r.secciones, fragmentos: r.fragmentos, figuras: r.figuras,
    procedencia: r.procedencia, avisos: r.avisos, tiempos, vectores: r.vectores,
    ...(r.cambiosTranscripcion.length ? { cambiosTranscripcion: r.cambiosTranscripcion } : {}),
  };
}

export type { MetadatosDocumento };
