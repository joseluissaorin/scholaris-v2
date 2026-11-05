/**
 * La transcripción completa de los medios en la plataforma (percepcion/NOTAS.md,
 * «La transcripción»), común a la nube y a `apps/local`:
 *
 * - En la ingesta, antes de consolidar: `puertosRevision` monta lo que necesita
 *   `completarTranscripcion` de @scholaris/ingesta con lo que haya del documento:
 *   el proxy en la Files API de Gemini (Flash mira y oye cada hueco), el mapa de
 *   la voz (`proxy.voz.json`), el reparto de la percepción (si la hay, también se
 *   revisan los hablantes con Argon) y la reserva (el transcriptor con el audio
 *   del tramo recortado al hueco: Gemini Transcribe y, si falla, Whisper).
 * - En un documento que ya existe: `aplicarRevisionDocumento` aplica una revisión
 *   (la guardada, una que llega en la petición o una nueva) y reescribe la capa
 *   literal con `reescribirTranscripcion`, que conserva lo que no cambia.
 *
 * La revisión se guarda en `<prefijo>transcripcion.revision.json`, marcada como
 * aplicada: la percepción ya no la vuelve a aplicar sobre las unidades nuevas.
 */
import {
  aplicarCorrecciones, clavesProxy, coberturaTranscripcion, sonidoParaCobertura, completarTranscripcion, comprobarRevision, fuenteGemini, palabrasTranscritas, recortarAudio, reescribirTranscripcion,
  type ActividadAudio, type CoberturaTranscripcion, type ContextoTuberia, type PuertosReescritura, type PuertosRevision, type ResultadoReescritura, type RevisionTranscripcion, type UnidadMedio,
} from '@scholaris/ingesta';
import type { PaqueteConversion } from '@scholaris/imprenta';
import type { Plan } from '@scholaris/contrato';
import type { PersonaPercibida, SQL, Transcriptor } from '@scholaris/nucleo';
import { MODELOS_GEMINI, videnteGemini, type ClienteGemini, type ConfigGemini } from '@scholaris/proveedores';
import { leerDocumento } from '@scholaris/spdf';
import type { AlmacenAmpliado } from '../puertos.js';
import { claveRevision, clienteGemini, leerPercepcion, trabajoEnAlmacen, unidadesDeMedio } from './percepcion.js';
import { transcriptorConYoutube } from './medios-url.js';

/** Lo que se gasta como mucho en completar la transcripción de una hora de medio, según el plan. */
export const PRESUPUESTO_TRANSCRIPCION_HORA: Record<Plan, number> = { gratis: 0.3, pro: 1.5 };

export function presupuestoTranscripcion(plan: Plan, duracion: number): number {
  const porHora = PRESUPUESTO_TRANSCRIPCION_HORA[plan] ?? 0.5;
  return Math.max(0.1, Math.round(porHora * (duracion / 3600) * 100) / 100);
}

/** Los hablantes mirando el vídeo (Argon, unos 0,13 $ por ventana de 8 min) solo en los planes de pago. */
export const revisaHablantes = (plan: Plan) => plan !== 'gratis';

async function json<T>(almacen: Pick<AlmacenAmpliado, 'bytes'>, clave: string): Promise<T | null> {
  try { const b = await almacen.bytes(clave); return b ? (JSON.parse(new TextDecoder().decode(b)) as T) : null; } catch { return null; }
}

export async function leerRevision(almacen: Pick<AlmacenAmpliado, 'bytes'>, prefijo: string): Promise<RevisionTranscripcion | null> {
  const r = await json<RevisionTranscripcion>(almacen, claveRevision(prefijo));
  return r && Array.isArray(r.correcciones) ? r : null;
}

export interface ContextoRevision {
  almacen: AlmacenAmpliado;
  gemini?: ConfigGemini | ClienteGemini;
  /** El transcriptor de reserva (el enrutado de la plataforma: con hablantes, Gemini Transcribe antes que Whisper). */
  transcriptor?: Transcriptor;
}

export interface PuertosRevisionDocumento {
  puertos: PuertosRevision;
  actividad?: Array<[number, number]>;
  reparto?: PersonaPercibida[];
  /** Hay proxy (y Gemini) para mirar. */
  conVideo: boolean;
}

/**
 * Los puertos de la revisión de la transcripción de un documento con lo que haya
 * en el almacén: proxy, mapa de la voz, reparto de la percepción y los tramos de
 * audio del paquete para la reserva.
 */
export async function puertosRevision(
  ctx: ContextoRevision,
  doc: { prefijo: string; paquete?: PaqueteConversion | null; /** Lee una parte del paquete (la fuente de la ingesta: rangos de bytes, YouTube). */ parte?: (id: string) => Promise<{ bytes: Uint8Array; mime: string } | null> },
): Promise<PuertosRevisionDocumento> {
  const claves = clavesProxy(doc.prefijo);
  const [cabProxy, voz, percepcion] = await Promise.all([
    ctx.almacen.cabecera(claves.proxy).catch(() => null),
    json<ActividadAudio>(ctx.almacen, claves.voz),
    leerPercepcion(ctx.almacen, doc.prefijo).catch(() => null),
  ]);
  const g = ctx.gemini && ('generar' in ctx.gemini || ctx.gemini.clave) ? clienteGemini(ctx.gemini) : null;
  const conVideo = !!(g && cabProxy && cabProxy.bytes > 0);
  const paquete = doc.paquete ?? await json<PaqueteConversion>(ctx.almacen, `${doc.prefijo}paquete.json`);
  const audio = paquete?.contenido.clase === 'medio' ? paquete.contenido.audio : null;
  const tramos = audio?.tramos ?? [];
  // Los bytes de cada tramo, una vez (las subventanas de un mismo tramo los comparten).
  const leidos = new Map<string, Promise<Uint8Array | null>>();
  const bytesDe = (parte: string) => {
    if (!leidos.has(parte)) leidos.set(parte, ctx.almacen.bytes(parte.startsWith(doc.prefijo) || parte.startsWith('youtube:') ? parte : `${doc.prefijo}${parte}`).catch(() => null));
    return leidos.get(parte)!;
  };
  const reserva: PuertosRevision['reserva'] | undefined = ctx.transcriptor && tramos.length ? {
    transcriptor: ctx.transcriptor,
    hablantes: true,
    async audio(t0, t1) {
      const solape = (x: { t0: number; t1: number }) => Math.max(0, Math.min(t1, x.t1) - Math.max(t0, x.t0));
      const tramo = [...tramos].sort((a, b) => solape(b) - solape(a))[0];
      if (!tramo || !solape(tramo)) return null;
      let mime = paquete?.partes.find((x) => x.id === tramo.parte)?.mime ?? audio?.mime ?? 'audio/ogg';
      let b: Uint8Array | null;
      if (doc.parte) {
        const x = await doc.parte(tramo.parte);
        b = x?.bytes ?? null;
        if (x) mime = x.mime;
      } else b = await bytesDe(tramo.parte);
      if (!b) return null;
      // Recortado al hueco: un trozo largo es justo lo que el transcriptor oye a medias.
      return recortarAudio({ bytes: b, mime }, tramo.t0, Math.max(t0, tramo.t0), Math.min(t1, tramo.t1)) ?? { bytes: b, mime, desplazamiento: tramo.t0 };
    },
  } : undefined;
  const puertos: PuertosRevision = {
    ...(conVideo && g ? {
      vidente: videnteGemini(g, { modelo: MODELOS_GEMINI.percepcionRapida }),
      fuente: (o?: { renovar?: boolean }) => fuenteGemini({ almacen: ctx.almacen, ficheros: g }, { prefijo: doc.prefijo, ...(o?.renovar ? { renovar: true } : {}) }),
    } : {}),
    trabajo: trabajoEnAlmacen(ctx.almacen, `${doc.prefijo}percepcion/`),
    ...(reserva ? { reserva } : {}),
  };
  return { puertos, conVideo, ...(voz?.tramos?.length ? { actividad: voz.tramos } : {}), ...(percepcion?.reparto?.length ? { reparto: percepcion.reparto } : {}) };
}

/** «Fresa y chocolate» (1993), de Tomás Gutiérrez Alea y Juan Carlos Tabío. */
export function fichaDe(m: { titulo: string; anio?: number | null; autores?: Array<{ nombre: string; apellidos: string }> }): string {
  const autores = (m.autores ?? []).map((x) => `${x.nombre} ${x.apellidos}`.trim()).filter(Boolean);
  return `«${m.titulo}»${m.anio ? ` (${m.anio})` : ''}${autores.length ? `, de ${autores.join(' y ')}` : ''}`;
}

// ---------------------------------------------------------------------------
// En la ingesta
// ---------------------------------------------------------------------------

/**
 * Completa la transcripción de un medio en una ingesta en marcha (antes de
 * consolidar): la usa el Workflow (paso «transcripcion») y la cola local (antes
 * de la consolidación de `ejecutarIngesta`). Guarda la revisión, ya aplicada.
 */
function reservaDe(ctx: { gemini?: ConfigGemini | ClienteGemini; inteligencia?: { transcriptor: Transcriptor } }, ctxT: ContextoTuberia): Transcriptor {
  const t = ctx.inteligencia?.transcriptor ?? ctxT.puertos.inteligencia.transcriptor;
  return ctx.gemini && !('generar' in ctx.gemini) ? transcriptorConYoutube(t, ctx.gemini) : t;
}

export async function completarTranscripcionEn(
  ctx: { almacen: AlmacenAmpliado; sql: SQL; gemini?: ConfigGemini | ClienteGemini; inteligencia?: { transcriptor: Transcriptor } },
  ctxT: ContextoTuberia,
  params: { prefijo: string; documento: string },
  o: { plan: Plan; alProgreso?: PuertosRevision['alProgreso'] },
): Promise<Record<string, unknown>> {
  const paquete = ctxT.paquete;
  const pr = await puertosRevision(
    // La reserva, sin la grabación de la ingesta (que devolvería lo ya oído para el mismo audio): la revisión graba lo suyo.
    { almacen: ctx.almacen, ...(ctx.gemini ? { gemini: ctx.gemini } : {}), transcriptor: reservaDe(ctx, ctxT) },
    { prefijo: params.prefijo, paquete, parte: (id) => ctxT.puertos.fuente.parte(id) },
  );
  const duracion = paquete.duracion ?? Math.max(0, ...ctxT.plan.tramos.map((t) => t.t1));
  const d = await leerDocumento(ctx.sql, params.documento).catch(() => null);
  const hablantes = revisaHablantes(o.plan) && !!pr.reparto?.length && pr.conVideo;
  const r = await completarTranscripcion(ctxT, { ...pr.puertos, ...(o.alProgreso ? { alProgreso: o.alProgreso } : {}) }, {
    duracion, ...(pr.actividad ? { actividad: pr.actividad } : {}), ...(hablantes && pr.reparto ? { reparto: pr.reparto } : {}), hablantes,
    ...(d ? { ficha: fichaDe(d.metadatos), ...(d.metadatos.idioma ? { idioma: d.metadatos.idioma } : {}) } : {}),
    modelo: MODELOS_GEMINI.percepcionRapida, modeloHablantes: MODELOS_GEMINI.percepcion,
    presupuestoUsd: presupuestoTranscripcion(o.plan, duracion) + (hablantes ? (duracion / 480) * 0.15 : 0),
    // Como mucho una subventana por minuto de medio: lo que pase de ahí no es un hueco, es otra cosa (música, ruido).
    maxSubventanas: Math.ceil(duracion / 60) + 4,
  });
  await ctx.almacen.poner(claveRevision(params.prefijo), JSON.stringify(r.revision), 'application/json');
  return r.resumen;
}

// ---------------------------------------------------------------------------
// Documentos que ya existen
// ---------------------------------------------------------------------------

export interface OpcionesAplicarRevision {
  /** Una revisión hecha fuera (la de la percepción, en un JSON): se guarda y se aplica. */
  revision?: RevisionTranscripcion;
  /** Aplicar aunque ya conste como aplicada o aunque no case del todo con las unidades actuales. */
  forzar?: boolean;
  minConfianza?: number;
}

export interface ResultadoAplicarRevision {
  documento: string;
  aplicada: boolean;
  /** Por qué no se aplicó. */
  motivo?: string;
  comprobacion: { comprobadas: number; coinciden: number; fraccion: number };
  correcciones: { huecos: number; tiemposRotos: number; hablantes: number; desfases: number };
  cobertura?: { antes: { huecos: number; sinTexto: number }; despues: { huecos: number; sinTexto: number } };
  reescritura?: ResultadoReescritura;
}

const sinTexto = (c: RevisionTranscripcion['cobertura']) => ({ huecos: c.huecos.length, sinTexto: Math.round(c.huecos.filter((h) => h.motivo === 'sin_texto').reduce((s, h) => s + h.activo, 0)) });

/**
 * Aplica a un documento que ya existe una revisión de su transcripción y
 * reescribe su capa literal. Comprueba antes que la revisión es de estas
 * unidades (sus frases citan el texto que tocan): si el documento se volvió a
 * ingerir, aplicarla lo estropearía y no se aplica (salvo `forzar`).
 */
export async function aplicarRevisionDocumento(
  ctx: { almacen: AlmacenAmpliado; sql: SQL; reescritura: Omit<PuertosReescritura, 'sql'> },
  doc: { documento: string; prefijo: string },
  o: OpcionesAplicarRevision = {},
): Promise<ResultadoAplicarRevision> {
  const d = await leerDocumento(ctx.sql, doc.documento);
  if (!d) throw new Error(`No encuentro el documento ${doc.documento}`);
  if (o.revision) await ctx.almacen.poner(claveRevision(doc.prefijo), JSON.stringify({ ...o.revision, aplicada: undefined }), 'application/json');
  const revision = o.revision ?? await leerRevision(ctx.almacen, doc.prefijo);
  const vacio = { comprobadas: 0, coinciden: 0, fraccion: 0 };
  const cuenta = (cs: RevisionTranscripcion['correcciones']) => ({
    huecos: cs.filter((c) => c.tipo === 'hueco' && !c.reemplaza?.length).length, tiemposRotos: cs.filter((c) => c.tipo === 'hueco' && !!c.reemplaza?.length).length,
    hablantes: cs.filter((c) => c.tipo === 'hablante').length, desfases: cs.filter((c) => c.tipo === 'desfase').length,
  });
  if (!revision) return { documento: doc.documento, aplicada: false, motivo: 'No hay ninguna revisión de la transcripción de este documento.', comprobacion: vacio, correcciones: cuenta([]) };
  if (revision.documento && revision.documento !== doc.documento && !o.forzar) {
    return { documento: doc.documento, aplicada: false, motivo: `La revisión es de otro documento (${revision.documento}).`, comprobacion: vacio, correcciones: cuenta(revision.correcciones) };
  }
  if (revision.aplicada && !o.forzar) return { documento: doc.documento, aplicada: false, motivo: `La revisión ya se aplicó el ${revision.aplicada.slice(0, 10)}.`, comprobacion: vacio, correcciones: cuenta(revision.correcciones) };
  const unidades: UnidadMedio[] = await unidadesDeMedio(ctx.sql, doc.documento);
  const comprobacion = comprobarRevision(unidades, revision);
  if (comprobacion.fraccion < 0.9 && !o.forzar) {
    return {
      documento: doc.documento, aplicada: false, comprobacion, correcciones: cuenta(revision.correcciones),
      motivo: `La revisión no corresponde a la transcripción actual: solo ${comprobacion.coinciden} de ${comprobacion.comprobadas} frases coinciden. Vuelve a revisarla.`,
    };
  }
  const corregidas = aplicarCorrecciones(unidades, revision.correcciones, { minConfianza: o.minConfianza ?? 0.7 });
  const palabras = palabrasTranscritas(corregidas);
  const voz = await json<ActividadAudio>(ctx.almacen, clavesProxy(doc.prefijo).voz);
  const duracion = (d as { duracion?: number }).duracion ?? Math.max(0, ...unidades.map((u) => u.t1));
  // Con la percepción, los tramos sin palabras que son música no cuentan como habla perdida.
  const sonido = sonidoParaCobertura(await leerPercepcion(ctx.almacen, doc.prefijo).catch(() => null));
  const coberturaFinal = coberturaTranscripcion(corregidas, { duracion, ...(voz?.tramos?.length ? { actividad: voz.tramos } : {}), ...(sonido.musica.length ? sonido : {}) });
  const reescritura = await reescribirTranscripcion({ ...ctx.reescritura, sql: ctx.sql }, doc.documento, palabras, {
    detalle: { revision: { version: revision.version, modelo: revision.modelo, correcciones: cuenta(revision.correcciones), usd: revision.coste?.usd ?? 0, comprobacion } },
  });
  const aplicada = new Date().toISOString();
  await ctx.almacen.poner(claveRevision(doc.prefijo), JSON.stringify({ ...revision, aplicada, coberturaFinal }), 'application/json');
  return {
    documento: doc.documento, aplicada: true, comprobacion, correcciones: cuenta(revision.correcciones),
    cobertura: { antes: sinTexto(revision.cobertura), despues: sinTexto(coberturaFinal) }, reescritura,
  };
}

/**
 * Revisa la transcripción de un documento de audio o vídeo que ya existe: los
 * huecos se vuelven a transcribir (Flash mirando el proxy en subventanas cortas;
 * si falla, la reserva con el audio recortado) y, con el reparto de la
 * percepción, cada frase se atribuye a quien la dice de verdad (Argon, por
 * ventanas). Guarda el resultado en `transcripcion.revision.json`, sin aplicar:
 * lo aplica `aplicarRevisionDocumento`.
 */
export async function revisarTranscripcionDocumento(
  ctx: ContextoRevision & { sql: SQL; hacerProxy?: import('./proxy.js').HacerProxy },
  doc: { documento: string; prefijo: string; tipo?: string; original?: string; mime?: string; nombre?: string },
  opciones: { reparto?: PersonaPercibida[]; modelo?: string; modeloHablantes?: string; hablantes?: boolean; huecos?: boolean; presupuestoUsd?: number; maxSubventanas?: number; alProgreso?: PuertosRevision['alProgreso'] } = {},
): Promise<RevisionTranscripcion> {
  const d = await leerDocumento(ctx.sql, doc.documento);
  if (!d) throw new Error(`No encuentro el documento ${doc.documento}`);
  if (ctx.hacerProxy) {
    const { asegurarProxy } = await import('./proxy.js');
    await asegurarProxy({ almacen: ctx.almacen, hacerProxy: ctx.hacerProxy }, {
      prefijo: doc.prefijo, original: doc.original ?? d.original ?? '', mime: doc.mime ?? d.mime, tipo: doc.tipo ?? d.tipo, ...(doc.nombre ? { nombre: doc.nombre } : {}),
    }).catch(() => null);
  }
  const unidades = await unidadesDeMedio(ctx.sql, doc.documento);
  const pr = await puertosRevision(ctx, { prefijo: doc.prefijo });
  const reparto = opciones.reparto ?? pr.reparto;
  const { revisarTranscripcionConVideo } = await import('@scholaris/ingesta');
  const r = await revisarTranscripcionConVideo({ ...pr.puertos, ...(opciones.alProgreso ? { alProgreso: opciones.alProgreso } : {}) }, {
    documento: doc.documento, duracion: (d as { duracion?: number }).duracion ?? Math.max(0, ...unidades.map((u) => u.t1)), unidades,
    ...(pr.actividad ? { actividad: pr.actividad } : {}), ...(reparto ? { reparto } : {}),
    ficha: fichaDe(d.metadatos), idioma: d.metadatos.idioma ?? 'es',
    modelo: opciones.modelo ?? MODELOS_GEMINI.percepcionRapida, modeloHablantes: opciones.modeloHablantes ?? MODELOS_GEMINI.percepcion,
    hablantes: opciones.hablantes ?? !!reparto?.length, ...(opciones.huecos === false ? { huecos: false } : {}), prefijoTrabajo: 'revision/',
    ...(opciones.presupuestoUsd !== undefined ? { presupuestoUsd: opciones.presupuestoUsd } : {}),
    ...(opciones.maxSubventanas !== undefined ? { maxSubventanas: opciones.maxSubventanas } : {}),
  });
  await ctx.almacen.poner(claveRevision(doc.prefijo), JSON.stringify(r), 'application/json');
  return r;
}

/**
 * La cobertura de la transcripción tal como está ahora, con la música apartada (sin modelos: la
 * transcripción actual, el mapa de voz y la música de la percepción). Para las revisiones guardadas
 * antes de que la cobertura supiera de música, que contaban las canciones como habla perdida.
 */
export async function coberturaActual(p: { sql: SQL; almacen: AlmacenAmpliado }, documento: string, prefijo: string, duracion: number | undefined): Promise<CoberturaTranscripcion | null> {
  const percepcion = await leerPercepcion(p.almacen, prefijo).catch(() => null);
  const sonido = sonidoParaCobertura(percepcion);
  if (!sonido.musica.length) return null;
  const unidades = await unidadesDeMedio(p.sql, documento);
  if (!unidades.length) return null;
  const voz = await json<ActividadAudio>(p.almacen, clavesProxy(prefijo).voz);
  const d = duracion ?? Math.max(0, ...unidades.map((u) => u.t1));
  return coberturaTranscripcion(unidades, { duracion: d, ...(voz?.tramos?.length ? { actividad: voz.tramos } : {}), ...sonido });
}
