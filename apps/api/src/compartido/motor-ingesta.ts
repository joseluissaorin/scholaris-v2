/**
 * El motor de ingesta de la plataforma, por pasos reanudables. Lo usan el
 * Workflow de Cloudflare (un `step.do` por paso, los pliegos en paralelo) y la
 * cola local (los mismos pasos, con su estado en disco).
 *
 *   preparar          paquete (o conversión de reserva) + plan
 *   leerPliego(i)     un pliego de visión; el resultado del lector queda GRABADO
 *   transcribir(n)    un tramo de audio; ídem con el transcriptor
 *   componer          `ejecutarIngesta` completo con lector y transcriptor que
 *                     REPRODUCEN lo grabado: no se paga dos veces una lectura,
 *                     y si este paso se reintenta tampoco
 *   revectorizar      solo vectores (SPDF importados sin el espacio base)
 *
 * La grabación vive en el almacén, en `<prefijo>trabajo/<tarea>/`.
 */
import type {
  FuentePaquete, Pliego, ResultadoIngesta,
} from '@scholaris/ingesta';
import { ejecutarIngesta, leerPliego, planificar, transcribirTramo, vectorizar, textoVectorizable, escribirVectores as escribirVectoresIngesta, entradasIndice } from '@scholaris/ingesta';
import type { PaqueteConversion } from '@scholaris/imprenta';
import { abrirCortador, type CortadorPdf } from '@scholaris/imprenta';
import type { Documento, IndiceVectorial, Inteligencia, Lector, PaginaLeida, Progreso, SQL, Transcripcion, Transcriptor, Vector } from '@scholaris/nucleo';
import { sha256 } from '@scholaris/nucleo';
import { leerDocumento } from '@scholaris/spdf';
import type { AlmacenAmpliado, ParamsIngesta } from '../puertos.js';
import { convertirEnServidor, ErrorReserva } from './reserva.js';

export interface ContextoMotor {
  almacen: AlmacenAmpliado;
  inteligencia: Inteligencia;
  /** La estantería del usuario (remota por RPC en el Workflow). */
  sql: SQL;
  indice: IndiceVectorial | null;
  espacioNombres: string;
  correoContacto?: string;
  alProgreso?(p: Progreso): Promise<void> | void;
  fetch?: typeof fetch;
}

export interface InfoPlan {
  paquete: string;
  modo: 'paginas' | 'medio' | 'bloques';
  unidades: number;
  pliegos: number[];
  tramos: number[];
  /** Para la cuota: páginas o minutos. */
  coste: number;
}

/** Las mismas opciones de plan en todos los pasos: el plan debe salir idéntico. */
const OPCIONES_PLAN = {} as const;

export { ErrorReserva };

const trabajo = (p: ParamsIngesta) => `${p.prefijo}trabajo/${p.tarea}/`;

// ---------------------------------------------------------------------------
// Paquete y fuente
// ---------------------------------------------------------------------------

const paquetes = new Map<string, Promise<PaqueteConversion>>();

export function leerPaquete(almacen: AlmacenAmpliado, clave: string): Promise<PaqueteConversion> {
  let p = paquetes.get(clave);
  if (!p) {
    p = (async () => {
      const b = await almacen.bytes(clave);
      if (!b) throw new ErrorReserva(`No encuentro el paquete de conversión (${clave}).`);
      return JSON.parse(new TextDecoder().decode(b)) as PaqueteConversion;
    })();
    paquetes.set(clave, p);
    p.catch(() => paquetes.delete(clave));
    if (paquetes.size > 8) paquetes.delete(paquetes.keys().next().value as string);
  }
  return p;
}

export function fuenteDesdeAlmacen(almacen: AlmacenAmpliado, params: ParamsIngesta, paquete: PaqueteConversion): FuentePaquete {
  const mimes = new Map(paquete.partes.map((x) => [x.id, x.mime]));
  let cortador: Promise<CortadorPdf> | null = null;
  const esPdf = paquete.contenido.clase === 'pdf' && /pdf/i.test(params.mime || paquete.origen.mime);
  return {
    async parte(id) {
      const clave = id.startsWith(params.prefijo) ? id : `${params.prefijo}${id}`;
      const bytes = await almacen.bytes(clave);
      if (!bytes) return null;
      return { bytes, mime: mimes.get(id) ?? (await almacen.cabecera(clave))?.tipo ?? 'application/octet-stream' };
    },
    ...(esPdf && params.original ? {
      async subPdf(desde: number, hasta: number) {
        cortador ??= (async () => {
          const b = await almacen.bytes(params.original);
          if (!b) throw new Error('No encuentro el PDF original');
          return abrirCortador(b);
        })();
        return (await cortador).cortar(desde, hasta);
      },
    } : {}),
  };
}

// ---------------------------------------------------------------------------
// Grabar y reproducir lecturas y transcripciones
// ---------------------------------------------------------------------------

async function huellaEntrada(e: { pdf?: Uint8Array; imagenes?: Array<{ bytes: Uint8Array }>; primeraFisica: number }): Promise<string> {
  const tam = e.pdf ? e.pdf.byteLength : (e.imagenes ?? []).reduce((s, i) => s + i.bytes.byteLength, 0);
  const n = e.imagenes?.length ?? 0;
  return `${e.primeraFisica}-${n}-${tam}`;
}

function claveLector(raiz: string, nombre: string, h: string) {
  return `${raiz}lector/${nombre.replace(/[^\w.-]+/g, '_')}/${h}.json`;
}

/** Envuelve un lector: guarda lo que lee (modo 'grabar') o lo devuelve si ya estaba (modo 'reproducir'). */
export function lectorConMemoria(lector: Lector, almacen: AlmacenAmpliado, raiz: string): Lector {
  return {
    nombre: lector.nombre,
    async leerPliego(entrada) {
      const clave = claveLector(raiz, lector.nombre, await huellaEntrada(entrada));
      const guardado = await almacen.bytes(clave);
      if (guardado) return JSON.parse(new TextDecoder().decode(guardado)) as PaginaLeida[];
      const r = await lector.leerPliego(entrada);
      await almacen.poner(clave, JSON.stringify(r), 'application/json');
      return r;
    },
  };
}

export function transcriptorConMemoria(t: Transcriptor, almacen: AlmacenAmpliado, raiz: string): Transcriptor {
  return {
    nombre: t.nombre,
    async transcribir(audio, opciones) {
      const h = (await sha256(audio.bytes.subarray(0, Math.min(audio.bytes.byteLength, 1 << 20)))).slice(0, 16);
      const clave = `${raiz}transcriptor/${audio.desplazamiento ?? 0}-${audio.bytes.byteLength}-${h}.json`;
      const guardado = await almacen.bytes(clave);
      if (guardado) return JSON.parse(new TextDecoder().decode(guardado)) as Transcripcion;
      const r = await t.transcribir(audio, opciones);
      await almacen.poner(clave, JSON.stringify(r), 'application/json');
      return r;
    },
  };
}

function inteligenciaConMemoria(ia: Inteligencia, almacen: AlmacenAmpliado, raiz: string): Inteligencia {
  return {
    ...ia,
    lector: lectorConMemoria(ia.lector, almacen, raiz),
    ...(ia.lectoresReserva ? { lectoresReserva: ia.lectoresReserva.map((l) => lectorConMemoria(l, almacen, raiz)) } : {}),
    transcriptor: transcriptorConMemoria(ia.transcriptor, almacen, raiz),
  };
}

// ---------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------

export async function preparar(ctx: ContextoMotor, params: ParamsIngesta): Promise<InfoPlan> {
  let clave = params.paquete;
  if (!clave) {
    const original = params.original ? await ctx.almacen.bytes(params.original) : null;
    const paquete = await convertirEnServidor({
      tipo: params.tipo, nombre: params.nombre, mime: params.mime,
      ...(params.url ? { url: params.url } : {}),
      ...(original ? { original, rutaOriginal: params.original.slice(params.prefijo.length) } : {}),
      guardarCopia: async (html) => {
        const ruta = `copias/${new Date().toISOString().slice(0, 10)}.html`;
        await ctx.almacen.poner(`${params.prefijo}${ruta}`, html, 'text/html; charset=utf-8');
        return ruta;
      },
      ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
    });
    clave = `${params.prefijo}paquete.json`;
    await ctx.almacen.poner(clave, JSON.stringify(paquete), 'application/json');
  }
  const paquete = await leerPaquete(ctx.almacen, clave);
  const plan = planificar(paquete, OPCIONES_PLAN);
  const coste = plan.modo === 'medio' ? Math.ceil((paquete.duracion ?? plan.tramos.length * 600) / 60) : plan.unidades;
  return { paquete: clave, modo: plan.modo, unidades: plan.unidades, pliegos: plan.pliegos.map((p) => p.id), tramos: plan.tramos.map((t) => t.n), coste };
}

export async function leerUnPliego(ctx: ContextoMotor, params: ParamsIngesta, info: InfoPlan, id: number): Promise<number> {
  const paquete = await leerPaquete(ctx.almacen, info.paquete);
  const plan = planificar(paquete, OPCIONES_PLAN);
  const pliego = plan.pliegos.find((p) => p.id === id) as Pliego | undefined;
  if (!pliego) return 0;
  const ia = inteligenciaConMemoria(ctx.inteligencia, ctx.almacen, trabajo(params));
  const r = await leerPliego(pliego, paquete, fuenteDesdeAlmacen(ctx.almacen, params, paquete), [ia.lector, ...(ia.lectoresReserva ?? [])], { ...(params.pista ? { pista: params.pista } : {}) });
  return r.paginas.length;
}

export async function transcribirUnTramo(ctx: ContextoMotor, params: ParamsIngesta, info: InfoPlan, n: number): Promise<number> {
  const paquete = await leerPaquete(ctx.almacen, info.paquete);
  const plan = planificar(paquete, OPCIONES_PLAN);
  const tramo = plan.tramos.find((t) => t.n === n);
  if (!tramo) return 0;
  const ia = inteligenciaConMemoria(ctx.inteligencia, ctx.almacen, trabajo(params));
  const r = await transcribirTramo(tramo, fuenteDesdeAlmacen(ctx.almacen, params, paquete), ia.transcriptor, { ...(params.pista ? { pista: params.pista } : {}) });
  return r.palabras.length;
}

export interface ResumenComposicion {
  documento: string;
  unidades: number;
  fragmentos: number;
  secciones: number;
  figuras: number;
  vectores: Record<string, number>;
  tiempos: Record<string, number>;
  avisos: string[];
}

export async function componer(ctx: ContextoMotor, params: ParamsIngesta, info: InfoPlan, metadatosUsuario?: Record<string, unknown> | null): Promise<ResumenComposicion> {
  const paquete = await leerPaquete(ctx.almacen, info.paquete);
  const ia = inteligenciaConMemoria(ctx.inteligencia, ctx.almacen, trabajo(params));
  const base = ia.embebedor.espacio.id;
  let ultimo = 0;
  let faseAnterior = '';
  const r: ResultadoIngesta = await ejecutarIngesta(paquete, {
    inteligencia: ia,
    fuente: fuenteDesdeAlmacen(ctx.almacen, params, paquete),
    sql: ctx.sql,
    ...(ctx.indice ? {
      indice: {
        insertar: async (espacio, entradas) => {
          if (espacio.id === base) await ctx.indice!.insertar(ctx.espacioNombres, entradas);
        },
      },
    } : {}),
    guardarBlob: async (clave, datos) => { await ctx.almacen.poner(`${params.prefijo}${clave}`, datos.bytes, datos.mime); },
    ...(ctx.correoContacto ? { correoContacto: ctx.correoContacto } : {}),
  }, {
    documentoId: params.documento,
    tarea: params.tarea,
    ...(params.pista ? { pista: params.pista } : {}),
    ...(params.bibliotecas?.length ? { bibliotecas: params.bibliotecas } : {}),
    ...(metadatosUsuario ? { metadatosUsuario: metadatosUsuario as never } : {}),
    onProgreso: (p) => {
      const ahora = Date.now();
      // Un aviso por fase y, dentro de cada fase, uno cada segundo y medio como mucho.
      if (p.fase !== faseAnterior || ahora - ultimo > 1500 || p.fase === 'listo') {
        faseAnterior = p.fase;
        ultimo = ahora;
        void Promise.resolve(ctx.alProgreso?.({ ...p, total: 0.25 + p.total * 0.75 })).catch(() => undefined);
      }
    },
  });
  // Por si el puerto SQL acumula escrituras (Workflow): que lleguen todas antes de cerrar.
  await (ctx.sql as { vaciarPendientes?: () => Promise<void> }).vaciarPendientes?.();
  return {
    documento: r.documento.id, unidades: r.unidades.length, fragmentos: r.fragmentos.length, secciones: r.secciones.length,
    figuras: r.figuras.length, vectores: r.vectores, tiempos: r.tiempos, avisos: r.avisos,
  };
}

/** Recalcula los vectores del espacio base desde el texto ya leído (SPDF importados). */
export async function revectorizar(ctx: ContextoMotor, params: ParamsIngesta): Promise<ResumenComposicion> {
  const d = (await leerDocumento(ctx.sql, params.documento)) as Documento | null;
  if (!d) throw new ErrorReserva('El documento ya no existe.');
  const filas = await ctx.sql.ejecutar<{ id: string; texto: string; contexto: string; seccion: string | null; ancla: string }>(
    'SELECT id, texto, contexto, seccion, ancla FROM fragmentos WHERE documento = ? ORDER BY orden', params.documento);
  const emb = ctx.inteligencia.embebedor;
  const vectores: Vector[] = [];
  const fuente: FuentePaquete = { parte: async () => null };
  await vectorizar(
    filas.map((f) => ({ objetivo: 'fragmento' as const, id: f.id, texto: textoVectorizable({ texto: f.texto, contexto: f.contexto, seccion: f.seccion ? (JSON.parse(f.seccion) as string[]) : [] } as never) })),
    emb, fuente, async (vs) => { vectores.push(...vs); }, { concurrencia: 8 },
  );
  const { escribirEspacio } = await import('@scholaris/ingesta');
  await escribirEspacio(ctx.sql, emb.espacio);
  for (let i = 0; i < vectores.length; i += 200) {
    const lote = vectores.slice(i, i + 200);
    await escribirVectoresIngesta(ctx.sql, d.id, lote);
    if (ctx.indice) await ctx.indice.insertar(ctx.espacioNombres, entradasIndice(d, lote));
  }
  await (ctx.sql as { vaciarPendientes?: () => Promise<void> }).vaciarPendientes?.();
  return { documento: d.id, unidades: d.unidades, fragmentos: filas.length, secciones: 0, figuras: 0, vectores: { [emb.espacio.id]: vectores.length }, tiempos: {}, avisos: [] };
}

/** Borra la grabación de lecturas de una tarea (al terminar bien). */
export async function limpiarTrabajo(almacen: AlmacenAmpliado, params: ParamsIngesta): Promise<void> {
  await almacen.borrarPrefijo(trabajo(params));
}

export function soloVectores(params: ParamsIngesta): boolean {
  return !!params.fases?.length && params.fases.every((f) => f === 'vectores' || f === 'contexto' || f === 'indexado');
}
