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
import { cuerpoDominante, leerCapaPagina, ejecutarIngesta, leerPliego, planificar, transcribirTramo, vectorizar, textoVectorizable, escribirVectores as escribirVectoresIngesta, entradasIndice } from '@scholaris/ingesta';
import type { PaqueteConversion } from '@scholaris/imprenta';
import { abrirCortador, type CortadorPdf } from '@scholaris/imprenta';
import type { Documento, IndiceVectorial, Inteligencia, Lector, PaginaLeida, Progreso, SQL, Transcripcion, Transcriptor, Vector } from '@scholaris/nucleo';
import { bytesAVector, sha256 } from '@scholaris/nucleo';
import { leerDocumento } from '@scholaris/spdf';
import type { AlmacenAmpliado, ParamsIngesta } from '../puertos.js';
import { convertirEnServidor, ErrorReserva } from './reserva.js';
import { encontrarMedio, esVimeo, idYoutube, MIME_YOUTUBE, transcriptorConYoutube } from './medios-url.js';
import type { ConfigGemini } from '@scholaris/proveedores';

export interface ContextoMotor {
  almacen: AlmacenAmpliado;
  inteligencia: Inteligencia;
  /** La estantería del usuario (remota por RPC en el Workflow). */
  sql: SQL;
  indice: IndiceVectorial | null;
  espacioNombres: string;
  correoContacto?: string;
  /** Sin Crossref/OpenAlex (pruebas, sin red). */
  sinVerificacion?: boolean;
  alProgreso?(p: Progreso): Promise<void> | void;
  fetch?: typeof fetch;
  /**
   * Imprenta del servidor (local: `@scholaris/imprenta/node`). Si está, se usa
   * para los ficheros que llegan sin paquete en vez de la reserva mínima.
   */
  convertir?(archivo: ArchivoConvertir, guardar: (id: string, datos: Uint8Array, mime: string) => Promise<void>): Promise<PaqueteConversion>;
  /** Unidades nuevas ya legibles (orden base 0, ambos incluidos): la interfaz las enseña al momento. */
  alUnidades?(desde: number, hasta: number): Promise<void> | void;
  /** Clave (y gateway) de Gemini para transcribir YouTube por URL. */
  gemini?: ConfigGemini;
}

export interface ArchivoConvertir {
  nombre: string;
  mime: string;
  tipo?: string;
  bytes: number;
  /** El original, leído del almacén cuando haga falta (entero o como flujo). */
  leer(): Promise<Uint8Array>;
  flujo(): Promise<ReadableStream<Uint8Array>>;
}

export interface InfoPlan {
  paquete: string;
  modo: 'paginas' | 'medio' | 'bloques';
  unidades: number;
  pliegos: number[];
  tramos: number[];
  /** Para la cuota: páginas o minutos. */
  coste: number;
  /** Original descargado en el servidor (pódcast, Vimeo, enlace directo). */
  original?: string;
  mime?: string;
  bytes?: number;
}

/** Las mismas opciones de plan en todos los pasos: el plan debe salir idéntico. */
const OPCIONES_PLAN = {} as const;

export { ErrorReserva };

/** Por documento: un reintento (tarea nueva) reaprovecha las lecturas ya pagadas. */
const trabajo = (p: ParamsIngesta) => `${p.prefijo}trabajo/`;

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
      if (id.startsWith('youtube:')) {
        const [t0, t1] = id.slice(8).split('-').map(Number);
        const url = paquete.metadatos.url ?? params.url ?? '';
        return { bytes: new TextEncoder().encode(JSON.stringify({ url, t0, t1 })), mime: MIME_YOUTUBE };
      }
      const rango = /^(.*)#bytes=(\d+)-(\d+)$/.exec(id);
      if (rango) {
        const c = rango[1]!.startsWith(params.prefijo) ? rango[1]! : `${params.prefijo}${rango[1]}`;
        const bytes = await almacen.rango(c, Number(rango[2]), Number(rango[3]));
        return bytes ? { bytes, mime: mimes.get(id) ?? 'audio/mpeg' } : null;
      }
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

function inteligenciaConMemoria(ia: Inteligencia, almacen: AlmacenAmpliado, raiz: string, gemini?: ConfigGemini): Inteligencia {
  return {
    ...ia,
    lector: lectorConMemoria(ia.lector, almacen, raiz),
    ...(ia.lectoresReserva ? { lectoresReserva: ia.lectoresReserva.map((l) => lectorConMemoria(l, almacen, raiz)) } : {}),
    transcriptor: transcriptorConMemoria(transcriptorConYoutube(ia.transcriptor, gemini), almacen, raiz),
  };
}

function archivoDe(almacen: AlmacenAmpliado, clave: string, nombre: string, mime: string, tipo?: string): ArchivoConvertir {
  return {
    nombre, mime, ...(tipo ? { tipo } : {}), bytes: 0,
    async leer() { const b = await almacen.bytes(clave); if (!b) throw new ErrorReserva('No encuentro el original en el almacén.'); return b; },
    async flujo() { const o = await almacen.obtener(clave); if (!o) throw new ErrorReserva('No encuentro el original en el almacén.'); return o.cuerpo as ReadableStream<Uint8Array>; },
  };
}

const EXT_MIME: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };

/** Baja un medio al almacén en partes de 16 MB (R2 o disco), sin cargarlo entero en memoria. */
async function descargarAlAlmacen(almacen: AlmacenAmpliado, url: string, clave: string, f: typeof fetch): Promise<{ mime: string; bytes: number }> {
  const r = await f(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Scholaris/2)' }, redirect: 'follow' });
  if (!r.ok || !r.body) throw new ErrorReserva(`No he podido descargar el medio (${r.status}).`);
  const ext = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(new URL(r.url).pathname)?.[1]?.toLowerCase() ?? '';
  const mime = (r.headers.get('content-type') ?? '').split(';')[0]!.trim().replace(/^application\/octet-stream$/, '') || EXT_MIME[ext] || 'audio/mpeg';
  const sub = await almacen.subidaDirecta(clave, { tipo: mime, partes: true });
  const TAM = 16 * 1024 * 1024;
  const partes: Array<{ numero: number; etag: string }> = [];
  const lector = r.body.getReader();
  let buf = new Uint8Array(TAM), lleno = 0, total = 0;
  const vaciar = async () => {
    if (!lleno) return;
    partes.push({ numero: partes.length + 1, etag: await almacen.ponerParte(clave, sub.idSubida!, partes.length + 1, buf.slice(0, lleno)) });
    total += lleno; lleno = 0;
  };
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    let v = value;
    while (v.length) {
      const n = Math.min(v.length, TAM - lleno);
      buf.set(v.subarray(0, n), lleno); lleno += n; v = v.subarray(n);
      if (lleno === TAM) await vaciar();
    }
    if (total + lleno > 4 * 1024 * 1024 * 1024) throw new ErrorReserva('El medio pasa de 4 GB.');
  }
  await vaciar();
  if (!partes.length) throw new ErrorReserva('El medio está vacío.');
  await almacen.completarPartes(clave, sub.idSubida!, partes);
  return { mime, bytes: total };
}

// ---------------------------------------------------------------------------
// Unidades provisionales: se ven mientras se procesa; las definitivas las sustituyen
// ---------------------------------------------------------------------------

interface Provisional {
  orden: number; ancla: Record<string, unknown>; texto: string; notas?: string[]; cabecera?: string; pie?: string;
  imagen?: string; miniatura?: string; lector: string; confianza: number; impresa?: string | null; t0?: number; t1?: number;
}

async function escribirProvisionales(ctx: ContextoMotor, params: ParamsIngesta, us: Provisional[]): Promise<void> {
  if (!us.length) return;
  await ctx.sql.transaccion(async (tx) => {
    for (const u of us) {
      await tx.ejecutar(
        `INSERT OR REPLACE INTO unidades (id, documento, orden, ancla, texto, notas, cabecera, pie, imagen, miniatura, lector, confianza, impresa, t0, t1)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `prov:${params.documento}:${u.orden}`, params.documento, u.orden, JSON.stringify(u.ancla), u.texto, u.notas?.length ? JSON.stringify(u.notas) : null,
        u.cabecera || null, u.pie || null, u.imagen ?? null, u.miniatura ?? null, u.lector, u.confianza, u.impresa ?? null, u.t0 ?? null, u.t1 ?? null,
      );
    }
  });
  await (ctx.sql as { vaciarPendientes?: () => Promise<void> }).vaciarPendientes?.();
  const ordenes = us.map((u) => u.orden);
  await ctx.alUnidades?.(Math.min(...ordenes), Math.max(...ordenes));
}

function provisionalDePagina(u: { orden: number; fisica: number; texto: string; notas: string[]; cabecera: string; pie: string; folioVisto: string | null; lector: string; confianza: number }, paquete: PaqueteConversion): Provisional {
  const pag = paquete.contenido.clase === 'pdf' ? paquete.contenido.paginas[u.fisica - 1] : paquete.contenido.clase === 'imagenes' ? paquete.contenido.paginas[u.fisica - 1] : undefined;
  return {
    orden: u.orden, texto: u.texto, notas: u.notas, cabecera: u.cabecera, pie: u.pie, lector: u.lector, confianza: u.confianza, impresa: u.folioVisto,
    ancla: { tipo: 'pagina', fisica: u.fisica, impresa: u.folioVisto, romana: false, origen: u.folioVisto ? 'leido' : 'ninguno', confianza: u.folioVisto ? 0.5 : 0 },
    ...(pag?.imagen ? { imagen: pag.imagen } : {}), ...(pag?.miniatura ? { miniatura: pag.miniatura } : {}),
  };
}

// ---------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------

export async function preparar(ctx: ContextoMotor, params: ParamsIngesta): Promise<InfoPlan> {
  let clave = params.paquete;
  let descargado: { original: string; mime: string; bytes: number } | undefined;
  // Pódcast, Vimeo o enlace directo: se baja el medio y se trata como si se hubiera subido.
  if (!clave && params.url && !idYoutube(params.url) && (params.tipo === 'audio' || params.tipo === 'video' || esVimeo(params.url) || /\.(mp3|m4a|aac|ogg|opus|wav|flac|mp4|webm|mov)(\?|$)/i.test(params.url))) {
    const m = await encontrarMedio(params.url, ctx.fetch ?? fetch);
    if (!m) throw new ErrorReserva(esVimeo(params.url) ? 'Este vídeo de Vimeo no tiene un fichero descargable: bájalo y súbelo.' : 'No encuentro el audio o el vídeo en esa dirección.');
    const ext = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(new URL(m.url).pathname)?.[1]?.toLowerCase() ?? 'mp3';
    const original = `${params.prefijo}original.${ext}`;
    const d = await descargarAlAlmacen(ctx.almacen, m.url, original, ctx.fetch ?? fetch);
    descargado = { original, mime: m.mime ?? d.mime, bytes: d.bytes };
    const tipo = descargado.mime.startsWith('video/') ? 'video' : 'audio';
    if (ctx.convertir) {
      const paquete = await ctx.convertir(archivoDe(ctx.almacen, original, m.titulo ?? params.nombre, descargado.mime, tipo), (id, datos, mime) => ctx.almacen.poner(`${params.prefijo}${id}`, datos, mime));
      paquete.metadatos = { ...paquete.metadatos, url: params.url, ...(m.titulo ? { titulo: m.titulo } : {}) };
      clave = `${params.prefijo}paquete.json`;
      await ctx.almacen.poner(clave, JSON.stringify(paquete), 'application/json');
    } else {
      const paquete = await convertirEnServidor({
        tipo, nombre: m.titulo ?? params.nombre, mime: descargado.mime, rutaOriginal: original.slice(params.prefijo.length),
        cabeza: (await ctx.almacen.rango(original, 0, 65535)) ?? new Uint8Array(), bytesOriginal: d.bytes, ...(m.duracion ? { duracion: m.duracion } : {}),
      });
      paquete.metadatos = { ...paquete.metadatos, url: params.url, ...(m.titulo ? { titulo: m.titulo } : {}), ...(m.autor ? { autores: [{ nombre: '', apellidos: m.autor }] } : {}) };
      clave = `${params.prefijo}paquete.json`;
      await ctx.almacen.poner(clave, JSON.stringify(paquete), 'application/json');
    }
  }
  if (!clave && !params.url && params.original && ctx.convertir) {
    const paquete = await ctx.convertir(archivoDe(ctx.almacen, params.original, params.nombre, params.mime, params.tipo), (id, datos, mime) => ctx.almacen.poner(`${params.prefijo}${id}`, datos, mime));
    clave = `${params.prefijo}paquete.json`;
    await ctx.almacen.poner(clave, JSON.stringify(paquete), 'application/json');
  }
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
      youtube: !!ctx.gemini,
    });
    clave = `${params.prefijo}paquete.json`;
    await ctx.almacen.poner(clave, JSON.stringify(paquete), 'application/json');
  }
  const paquete = await leerPaquete(ctx.almacen, clave);
  const plan = planificar(paquete, OPCIONES_PLAN);
  // El total se conoce ya; las páginas con capa de texto se pueden enseñar desde ahora.
  await ctx.sql.ejecutar('UPDATE documentos SET unidades = ? WHERE id = ?', plan.unidades, params.documento);
  if (paquete.contenido.clase === 'pdf') {
    const paginas = paquete.contenido.paginas;
    const base = cuerpoDominante(paginas);
    const capa = paginas.map((p, i) => (plan.vias[i] === 'capa' ? provisionalDePagina(leerCapaPagina(p, i, base), paquete) : null)).filter((x): x is Provisional => !!x);
    for (let i = 0; i < capa.length; i += 50) await escribirProvisionales(ctx, params, capa.slice(i, i + 50));
  }
  await (ctx.sql as { vaciarPendientes?: () => Promise<void> }).vaciarPendientes?.();
  const coste = plan.modo === 'medio' ? Math.ceil((paquete.duracion ?? plan.tramos.length * 600) / 60) : plan.unidades;
  return { paquete: clave, modo: plan.modo, unidades: plan.unidades, pliegos: plan.pliegos.map((p) => p.id), tramos: plan.tramos.map((t) => t.n), coste, ...(descargado ?? {}) };
}

export async function leerUnPliego(ctx: ContextoMotor, params: ParamsIngesta, info: InfoPlan, id: number): Promise<number> {
  const paquete = await leerPaquete(ctx.almacen, info.paquete);
  const plan = planificar(paquete, OPCIONES_PLAN);
  const pliego = plan.pliegos.find((p) => p.id === id) as Pliego | undefined;
  if (!pliego) return 0;
  const ia = inteligenciaConMemoria(ctx.inteligencia, ctx.almacen, trabajo(params), ctx.gemini);
  const r = await leerPliego(pliego, paquete, fuenteDesdeAlmacen(ctx.almacen, params, paquete), [ia.lector, ...(ia.lectoresReserva ?? [])], { ...(params.pista ? { pista: params.pista } : {}) });
  await escribirProvisionales(ctx, params, r.paginas.map((u) => provisionalDePagina(u, paquete)));
  return r.paginas.length;
}

export async function transcribirUnTramo(ctx: ContextoMotor, params: ParamsIngesta, info: InfoPlan, n: number): Promise<number> {
  const paquete = await leerPaquete(ctx.almacen, info.paquete);
  const plan = planificar(paquete, OPCIONES_PLAN);
  const tramo = plan.tramos.find((t) => t.n === n);
  if (!tramo) return 0;
  const ia = inteligenciaConMemoria(ctx.inteligencia, ctx.almacen, trabajo(params), ctx.gemini);
  const r = await transcribirTramo(tramo, fuenteDesdeAlmacen(ctx.almacen, params, paquete), ia.transcriptor, { ...(params.pista ? { pista: params.pista } : {}) });
  const texto = r.palabras.map((w) => w.texto).join(' ').trim();
  if (texto) {
    await escribirProvisionales(ctx, params, [{
      orden: tramo.n - 1, texto, lector: ctx.inteligencia.transcriptor.nombre, confianza: 0.8, t0: tramo.t0, t1: tramo.t1,
      ancla: { tipo: 'tiempo', t0: tramo.t0, t1: tramo.t1 },
    }]);
  }
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
  /** El índice vectorial falló: el documento sirve (texto y FTS) y los vectores se reintentan después. */
  vectoresPendientes?: boolean;
}

/** El índice del motor: nunca tira la ingesta; si falla, lo apunta para reintentarlo. */
function indiceSeguro(ctx: ContextoMotor, base: string, estado: { pendientes: boolean }) {
  return {
    insertar: async (espacio: { id: string }, entradas: Parameters<IndiceVectorial['insertar']>[1]) => {
      if (espacio.id !== base || !ctx.indice || estado.pendientes) return;
      try {
        await ctx.indice.insertar(ctx.espacioNombres, entradas);
      } catch (e) {
        estado.pendientes = true;
        console.error(JSON.stringify({ nivel: 'aviso', que: 'indice_vectorial', error: (e as Error).message }));
      }
    },
  };
}

export async function componer(ctx: ContextoMotor, params: ParamsIngesta, info: InfoPlan, metadatosUsuario?: Record<string, unknown> | null): Promise<ResumenComposicion> {
  const paquete = await leerPaquete(ctx.almacen, info.paquete);
  const ia = inteligenciaConMemoria(ctx.inteligencia, ctx.almacen, trabajo(params), ctx.gemini);
  const base = ia.embebedor.espacio.id;
  let ultimo = 0;
  let faseAnterior = '';
  const estadoIndice = { pendientes: false };
  const r: ResultadoIngesta = await ejecutarIngesta(paquete, {
    inteligencia: ia,
    fuente: fuenteDesdeAlmacen(ctx.almacen, params, paquete),
    sql: ctx.sql,
    ...(ctx.indice ? { indice: indiceSeguro(ctx, base, estadoIndice) } : {}),
    guardarBlob: async (clave, datos) => { await ctx.almacen.poner(`${params.prefijo}${clave}`, datos.bytes, datos.mime); },
    ...(ctx.correoContacto ? { correoContacto: ctx.correoContacto } : {}),
  }, {
    documentoId: params.documento,
    tarea: params.tarea,
    ...(ctx.sinVerificacion ? { sinVerificacion: true } : {}),
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
  // Fuera las provisionales: ya están las definitivas.
  await ctx.sql.ejecutar("DELETE FROM unidades WHERE documento = ? AND id LIKE 'prov:%'", params.documento);
  // Por si el puerto SQL acumula escrituras (Workflow): que lleguen todas antes de cerrar.
  await (ctx.sql as { vaciarPendientes?: () => Promise<void> }).vaciarPendientes?.();
  await ctx.alUnidades?.(0, Math.max(0, r.unidades.length - 1));
  return {
    documento: r.documento.id, unidades: r.unidades.length, fragmentos: r.fragmentos.length, secciones: r.secciones.length,
    figuras: r.figuras.length, vectores: r.vectores, tiempos: r.tiempos, avisos: r.avisos,
    ...(estadoIndice.pendientes ? { vectoresPendientes: true } : {}),
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
  const estadoIndice = { pendientes: false };
  const indice = indiceSeguro(ctx, emb.espacio.id, estadoIndice);
  for (let i = 0; i < vectores.length; i += 200) {
    const lote = vectores.slice(i, i + 200);
    await escribirVectoresIngesta(ctx.sql, d.id, lote);
    await indice.insertar(emb.espacio, entradasIndice(d, lote));
  }
  await (ctx.sql as { vaciarPendientes?: () => Promise<void> }).vaciarPendientes?.();
  return { documento: d.id, unidades: d.unidades, fragmentos: filas.length, secciones: 0, figuras: 0, vectores: { [emb.espacio.id]: vectores.length }, tiempos: {}, avisos: [], ...(estadoIndice.pendientes ? { vectoresPendientes: true } : {}) };
}

/**
 * Vuelve a mandar al índice los vectores del espacio base de un documento,
 * desde la estantería (donde siempre se guardan). Lo usa la cola cuando una
 * ingesta terminó con «vectores pendientes».
 */
export async function reindexar(sql: SQL, indice: IndiceVectorial, espacioNombres: string, documento: string): Promise<number> {
  const d = (await leerDocumento(sql, documento)) as Documento | null;
  if (!d) return 0;
  const base = indice.espacio.id;
  let n = 0;
  for (let desde = 0; ; desde += 1000) {
    const filas = await sql.ejecutar<{ objetivo: string; id: string; valores: Uint8Array }>(
      'SELECT objetivo, id, valores FROM vectores WHERE documento = ? AND espacio = ? ORDER BY objetivo, id LIMIT 1000 OFFSET ?', documento, base, desde);
    if (!filas.length) break;
    const vs: Vector[] = filas.map((f) => ({ objetivo: f.objetivo as Vector['objetivo'], id: f.id, espacio: base, valores: bytesAVector(f.valores) }));
    await indice.insertar(espacioNombres, entradasIndice(d, vs));
    n += vs.length;
  }
  return n;
}

/** Borra la grabación de lecturas de una tarea (al terminar bien). */
export async function limpiarTrabajo(almacen: AlmacenAmpliado, params: ParamsIngesta): Promise<void> {
  await almacen.borrarPrefijo(trabajo(params));
}

export function soloVectores(params: ParamsIngesta): boolean {
  return !!params.fases?.length && params.fases.every((f) => f === 'vectores' || f === 'contexto' || f === 'indexado');
}
