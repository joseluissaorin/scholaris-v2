/**
 * La percepción y el anclaje material sobre la plataforma (almacén, estantería y
 * Gemini). Lo usan el Workflow de comprensión y la herramienta «ver» de
 * Investigar. Claves en el almacén, bajo el prefijo del documento
 * (`u/<usuario>/d/<documento>/`):
 *
 *   proxy.mp4, proxy.cortes.json, proxy.gemini.json   (ver compartido/proxy.ts)
 *   percepcion.json          el PercepcionMedio de la obra (lo lee la comprensión)
 *   percepcion/<huella>/…    lo que devolvió cada ventana (no se paga dos veces)
 *   percepcion/anclaje/…     las localizaciones de citas en imágenes de página
 *   transcripcion.revision.json   la revisión de la transcripción (huecos, hablantes, desfases)
 *   percepcion/revision/…    lo que devolvió cada llamada de la revisión
 */
import {
  anclarMaterial, clavesProxy, fuenteGemini, percibirMedio, revisarTranscripcionConVideo,
  type ActividadAudio, type AlmacenTrabajo, type AnclajeResultado, type CortesProxy, type LineaPagina, type PercepcionConCoste, type ProgresoPercepcion, type RevisionTranscripcion, type UnidadAnclable, type UnidadMedio,
} from '@scholaris/ingesta';
import type { PaqueteConversion } from '@scholaris/imprenta';
import type { Ancla, Lente, PersonaPercibida, Redactor, SQL, Transcriptor } from '@scholaris/nucleo';
import { crearGemini, MODELOS_GEMINI, videnteGemini, type ClienteGemini, type ConfigGemini, type ContadorUso } from '@scholaris/proveedores';
import { leerDocumento } from '@scholaris/spdf';
import type { AlmacenAmpliado } from '../puertos.js';
import { asegurarProxy, type HacerProxy } from './proxy.js';

export const clavePercepcion = (prefijo: string) => `${prefijo}percepcion.json`;

/** Un trozo del almacén como almacén de trabajo (texto JSON por clave). */
export function trabajoEnAlmacen(almacen: AlmacenAmpliado, prefijo: string): AlmacenTrabajo {
  return {
    async leer(c) { const b = await almacen.bytes(`${prefijo}${c}`); return b ? new TextDecoder().decode(b) : null; },
    async escribir(c, t) { await almacen.poner(`${prefijo}${c}`, t, 'application/json'); },
  };
}

/** El PercepcionMedio guardado de un documento, o null. */
export async function leerPercepcion(almacen: AlmacenAmpliado, prefijo: string): Promise<PercepcionConCoste | null> {
  const b = await almacen.bytes(clavePercepcion(prefijo));
  if (!b) return null;
  try { return JSON.parse(new TextDecoder().decode(b)) as PercepcionConCoste; } catch { return null; }
}

function cliente(gemini: ConfigGemini | ClienteGemini, contador?: ContadorUso): ClienteGemini {
  return 'generar' in gemini ? gemini : crearGemini({ ...gemini, timeoutMs: Math.max(gemini.timeoutMs ?? 0, 900_000), ...(contador ? { contador } : {}) });
}

/**
 * El proxy del documento en la Files API de Gemini, listo para `fileData`
 * (`{ fileUri: uri, mimeType: mime }`, con `videoMetadata` para un tramo). Lo
 * sube si hace falta y reaprovecha la subida mientras viva.
 */
export function fuenteGeminiDocumento(almacen: AlmacenAmpliado, gemini: ConfigGemini | ClienteGemini, prefijo: string, opciones: { renovar?: boolean } = {}) {
  return fuenteGemini({ almacen, ficheros: cliente(gemini) }, { prefijo, ...(opciones.renovar ? { renovar: true } : {}) });
}

interface FilaUnidad { orden: number; ancla: string; texto: string; t0: number | null; t1: number | null; palabras: string | null; imagen: string | null }

export interface ContextoPercepcion {
  almacen: AlmacenAmpliado;
  sql: SQL;
  gemini: ConfigGemini | ClienteGemini;
  /** Si no hay proxy y hay quien lo haga (el contenedor), se hace antes de mirar. */
  hacerProxy?: HacerProxy;
  contador?: ContadorUso;
  alProgreso?(p: ProgresoPercepcion): void | Promise<void>;
}

export interface DocumentoPercibible {
  documento: string;
  prefijo: string;
  tipo: string;
  original?: string;
  mime?: string;
  nombre?: string;
}

/** Las unidades de un medio con su transcripción, su orden y el instante de cada palabra. */
export async function unidadesDeMedio(sql: SQL, documento: string): Promise<UnidadMedio[]> {
  const filas = await sql.ejecutar<FilaUnidad>('SELECT orden, ancla, texto, t0, t1, palabras, imagen FROM unidades WHERE documento = ? ORDER BY orden', documento);
  return filas.flatMap((f) => {
    const a = JSON.parse(f.ancla) as Ancla;
    const t0 = f.t0 ?? (a.tipo === 'tiempo' ? a.t0 : null), t1 = f.t1 ?? (a.tipo === 'tiempo' ? a.t1 : null);
    if (t0 === null || t1 === null) return [];
    return [{ orden: Number(f.orden), texto: f.texto, t0, t1, ...(a.tipo === 'tiempo' && a.hablante ? { hablante: a.hablante } : {}), ...(f.palabras ? { palabras: JSON.parse(f.palabras) } : {}) }];
  });
}

/** La lente por defecto si no la da quien llama (la comprensión elige la suya). */
function lentePorDefecto(tipo: string, tipoCSL?: string): Lente {
  if (tipo === 'audio') return tipoCSL === 'interview' ? 'entrevista' : 'podcast';
  if (tipoCSL === 'motion_picture') return 'cine';
  if (tipoCSL === 'broadcast') return 'documental';
  return 'cine';
}

/**
 * Percibe un documento de audio o vídeo entero y guarda el resultado en
 * `percepcion.json`. Idempotente: lo que ya vio cada ventana está grabado; con
 * `reutilizar`, si ya hay un `percepcion.json` del mismo modelo, se devuelve tal cual.
 */
export async function percibirDocumento(
  ctx: ContextoPercepcion,
  doc: DocumentoPercibible,
  opciones: { lente?: Lente; modelo?: string; reparto?: PersonaPercibida[]; presupuestoUsd?: number; reutilizar?: boolean; concurrencia?: number } = {},
): Promise<PercepcionConCoste> {
  const modelo = opciones.modelo ?? MODELOS_GEMINI.percepcion;
  if (opciones.reutilizar) {
    const previa = await leerPercepcion(ctx.almacen, doc.prefijo);
    if (previa && previa.modelo.split('+').includes(modelo)) return previa;
  }
  const d = await leerDocumento(ctx.sql, doc.documento);
  if (!d) throw new Error(`No encuentro el documento ${doc.documento}`);
  await asegurarProxy({ almacen: ctx.almacen, ...(ctx.hacerProxy ? { hacerProxy: ctx.hacerProxy } : {}) }, {
    prefijo: doc.prefijo, original: doc.original ?? d.original ?? '', mime: doc.mime ?? d.mime, tipo: doc.tipo, ...(doc.nombre ? { nombre: doc.nombre } : {}),
  });
  const unidades = await unidadesDeMedio(ctx.sql, doc.documento);
  const cortes = await ctx.almacen.bytes(clavesProxy(doc.prefijo).cortes).then((b) => (b ? (JSON.parse(new TextDecoder().decode(b)) as CortesProxy).cortes : undefined)).catch(() => undefined);
  const m = d.metadatos;
  const autores = (m.autores ?? []).map((x) => `${x.nombre} ${x.apellidos}`.trim()).filter(Boolean);
  const ficha = `«${m.titulo}»${m.anio ? ` (${m.anio})` : ''}${autores.length ? `, de ${autores.join(' y ')}` : ''}`;
  const duracion = (d as { duracion?: number }).duracion ?? Math.max(0, ...unidades.map((u) => u.t1));
  const g = cliente(ctx.gemini, ctx.contador);
  const r = await percibirMedio({
    vidente: videnteGemini(g, { modelo }),
    fuente: (o) => fuenteGemini({ almacen: ctx.almacen, ficheros: g }, { prefijo: doc.prefijo, ...(o?.renovar ? { renovar: true } : {}) }),
    trabajo: trabajoEnAlmacen(ctx.almacen, `${doc.prefijo}percepcion/`),
    ...(ctx.alProgreso ? { alProgreso: ctx.alProgreso } : {}),
  }, {
    documento: doc.documento, duracion, medio: doc.tipo === 'audio' ? 'audio' : 'video',
    lente: opciones.lente ?? lentePorDefecto(doc.tipo, m.tipoCSL), unidades, ficha, idioma: m.idioma ?? 'es', modelo, prefijoTrabajo: '',
    ...(opciones.reparto ? { reparto: opciones.reparto } : {}), ...(cortes ? { cortes } : {}),
    ...(opciones.presupuestoUsd !== undefined ? { presupuestoUsd: opciones.presupuestoUsd } : {}),
    ...(opciones.concurrencia ? { concurrencia: opciones.concurrencia } : {}),
  });
  await ctx.almacen.poner(clavePercepcion(doc.prefijo), JSON.stringify(r), 'application/json');
  return r;
}

/**
 * Un anclador para las citas de un documento de páginas: carga una vez las
 * líneas de la capa de texto (del paquete de conversión) y localiza en la imagen
 * lo que no tiene capa. Devuelve `anclarMaterial` atado a ese documento.
 */
export function crearAnclador(ctx: { almacen: AlmacenAmpliado; sql: SQL; redactor?: Redactor }, doc: { documento: string; prefijo: string }) {
  let lineas: Promise<Map<number, LineaPagina[]>> | null = null;
  const cargarLineas = () => {
    lineas ??= (async () => {
      const b = await ctx.almacen.bytes(`${doc.prefijo}paquete.json`).catch(() => null);
      const mapa = new Map<number, LineaPagina[]>();
      if (!b) return mapa;
      const p = JSON.parse(new TextDecoder().decode(b)) as PaqueteConversion;
      if (p.contenido.clase !== 'pdf') return mapa;
      for (const pag of p.contenido.paginas) {
        // Solo la capa nacida digital: en un escaneado con OCR ajeno, las cajas no son fiables.
        if (pag.clase === 'pdf' && pag.texto.origen === 'digital' && pag.lineas.length) mapa.set(pag.fisica, pag.lineas.map((l) => ({ texto: l.texto, x: l.x, y: l.y, w: l.w, h: l.h })));
      }
      return mapa;
    })();
    return lineas;
  };
  const puertos = {
    lineas: async (fisica: number) => (await cargarLineas()).get(fisica) ?? null,
    imagen: async (clave: string) => {
      const o = await ctx.almacen.obtener(`${doc.prefijo}${clave}`);
      if (!o) return null;
      return { bytes: new Uint8Array(await new Response(o.cuerpo).arrayBuffer()), mime: o.meta.tipo ?? 'image/jpeg' };
    },
    ...(ctx.redactor ? { redactor: ctx.redactor } : {}),
    cache: trabajoEnAlmacen(ctx.almacen, `${doc.prefijo}percepcion/`),
  };
  return async (orden: number, o: { cita?: string; caracteres?: [number, number]; vision?: boolean }): Promise<AnclajeResultado> => {
    const [f] = await ctx.sql.ejecutar<FilaUnidad>('SELECT orden, ancla, texto, t0, t1, palabras, imagen FROM unidades WHERE documento = ? AND orden = ?', doc.documento, orden);
    if (!f) throw new Error(`No existe la unidad ${orden} de ${doc.documento}`);
    const unidad: UnidadAnclable = { orden: f.orden, texto: f.texto, ancla: JSON.parse(f.ancla) as Ancla, imagen: f.imagen };
    return anclarMaterial(puertos, unidad, o);
  };
}

export const claveRevision = (prefijo: string) => `${prefijo}transcripcion.revision.json`;

/**
 * Revisa la transcripción de un documento de audio o vídeo con el proxy: los
 * huecos se vuelven a transcribir (Flash, en subventanas cortas; si falla, el
 * transcriptor de reserva con el tramo de audio del paquete) y cada frase se
 * atribuye a quien la dice de verdad (Argon, por ventanas). Guarda el resultado
 * en `transcripcion.revision.json`; la ingesta lo aplica con `aplicarCorrecciones`.
 */
export async function revisarTranscripcionDocumento(
  ctx: ContextoPercepcion & { transcriptor?: Transcriptor },
  doc: DocumentoPercibible,
  opciones: { reparto?: PersonaPercibida[]; modelo?: string; modeloHablantes?: string; hablantes?: boolean; huecos?: boolean } = {},
): Promise<RevisionTranscripcion> {
  const d = await leerDocumento(ctx.sql, doc.documento);
  if (!d) throw new Error(`No encuentro el documento ${doc.documento}`);
  const unidades = await unidadesDeMedio(ctx.sql, doc.documento);
  const claves = clavesProxy(doc.prefijo);
  const voz = await ctx.almacen.bytes(claves.voz).then((b) => (b ? (JSON.parse(new TextDecoder().decode(b)) as ActividadAudio) : null)).catch(() => null);
  // El reparto que ya vio la percepción, si la hay: con descripciones de cara y de voz.
  const percepcion = await leerPercepcion(ctx.almacen, doc.prefijo);
  const reparto = opciones.reparto ?? percepcion?.reparto;
  const m = d.metadatos;
  const autores = (m.autores ?? []).map((x) => `${x.nombre} ${x.apellidos}`.trim()).filter(Boolean);
  const g = cliente(ctx.gemini, ctx.contador);
  // Reserva: el tramo de audio del paquete que contiene el hueco (el transcriptor se queda con lo del hueco).
  const paquete = await ctx.almacen.bytes(`${doc.prefijo}paquete.json`).then((b) => (b ? (JSON.parse(new TextDecoder().decode(b)) as PaqueteConversion) : null)).catch(() => null);
  const tramos = paquete?.contenido.clase === 'medio' ? paquete.contenido.audio?.tramos ?? [] : [];
  const transcriptor = ctx.transcriptor;
  const reserva = transcriptor && tramos.length ? {
    transcriptor,
    async audio(t0: number, t1: number) {
      const solape = (x: { t0: number; t1: number }) => Math.max(0, Math.min(t1, x.t1) - Math.max(t0, x.t0));
      const tramo = [...tramos].sort((a, b) => solape(b) - solape(a))[0];
      if (!tramo || !solape(tramo)) return null;
      const b = await ctx.almacen.bytes(`${doc.prefijo}${tramo.parte}`);
      return b ? { bytes: b, mime: paquete!.contenido.clase === 'medio' ? paquete!.contenido.audio?.mime ?? 'audio/ogg' : 'audio/ogg', desplazamiento: tramo.t0 } : null;
    },
  } : undefined;
  const r = await revisarTranscripcionConVideo({
    vidente: videnteGemini(g, { modelo: opciones.modelo ?? MODELOS_GEMINI.percepcionRapida }),
    fuente: (o) => fuenteGemini({ almacen: ctx.almacen, ficheros: g }, { prefijo: doc.prefijo, ...(o?.renovar ? { renovar: true } : {}) }),
    trabajo: trabajoEnAlmacen(ctx.almacen, `${doc.prefijo}percepcion/`),
    ...(reserva ? { reserva } : {}),
  }, {
    documento: doc.documento, duracion: (d as { duracion?: number }).duracion ?? Math.max(0, ...unidades.map((u) => u.t1)), unidades,
    ...(voz ? { actividad: voz.tramos } : {}), ...(reparto ? { reparto } : {}),
    ficha: `«${m.titulo}»${m.anio ? ` (${m.anio})` : ''}${autores.length ? `, de ${autores.join(' y ')}` : ''}`, idioma: m.idioma ?? 'es',
    modelo: opciones.modelo ?? MODELOS_GEMINI.percepcionRapida, modeloHablantes: opciones.modeloHablantes ?? MODELOS_GEMINI.percepcion,
    ...(opciones.hablantes === false ? { hablantes: false } : {}), ...(opciones.huecos === false ? { huecos: false } : {}), prefijoTrabajo: 'revision/',
  });
  await ctx.almacen.poner(claveRevision(doc.prefijo), JSON.stringify(r), 'application/json');
  return r;
}
