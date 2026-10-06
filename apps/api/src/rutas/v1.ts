/**
 * API pública v1 (`/api/v1`): la API sencilla, para personas y agentes.
 * Ver el contrato en `packages/contrato/src/v1.ts`.
 *
 * Vive en la puerta, no en la estantería: autentica con la misma función
 * (claves `sch_…`, Clerk o modo local), y cada verbo se resuelve con una o
 * varias llamadas internas a la v2 a través de `pl.atender`, que es lo mismo
 * que hace la puerta con `/api/v2/*`. Así los alcances de las claves, las
 * cuotas, el límite de ritmo, el historial y las bibliotecas compartidas son
 * exactamente los de la v2, y no hay lógica de dominio duplicada. Lo único que
 * se hace aquí es lo que no puede hacerse dentro de la estantería: recibir el
 * fichero en crudo (directo al almacén, sin pasar por el Durable Object) y
 * esperar sin retener la estantería.
 */
import type { Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { sha256, type MetadatosDocumento } from '@scholaris/nucleo';
import {
  PREFIJO_API, PREFIJO_V1, llmsTxtV1, openapiV1,
  type BuscarV1, type CitarV1, type CodigoError, type CuerpoError, type DetalleAutocita, type DetalleDocumento, type DocumentoV1,
  type FuenteV1, type IngestaIniciada, type ListaDocumentosV1, type MapaFolios, type Pagina, type PreguntarV1, type ResultadoVista,
  type RespuestaBusqueda, type RespuestaBuscarV1, type RespuestaCitarV1, type RespuestaPreguntarV1, type RespuestaVerificarV1,
  type ResumenDocumento, type SubidaCreada, type SubirUrlV1, type Tarea, type TextoV1, type UnidadTextoV1, type UnidadVista,
  type VerificarV1,
} from '@scholaris/contrato';
import type { Verificacion } from '@scholaris/citas';
import type { Plataforma } from '../app.js';
import type { UsuarioSesion } from '../puertos.js';
import { ErrorScholaris } from '../compartido/errores.js';
import {
  autoresDeTexto, citaDePropuesta, docBreve, documentoDeDetalle, documentoDeResumen, enlaceLector, localizador, mdCitar, mdDocumento,
  mdDocumentos, mdPasajes, mdRespuesta, mdTexto, mdVerificar, pasajeDeVista,
} from './v1-forma.js';

type AppPuerta = Hono<{ Variables: { usuario: UsuarioSesion } }>;
type C = Context<{ Variables: { usuario: UsuarioSesion } }>;

const V = PREFIJO_V1;
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Lo que cabe en la memoria de un Worker con holgura (128 MB): lo más grande, por la v2 o el SDK. */
const MAX_CRUDO_NUBE = 95 * 1024 * 1024;
const IDEMPOTENCIA_MS = 24 * 3600_000;

// ---------------------------------------------------------------------------
// Errores en dos lenguas
// ---------------------------------------------------------------------------

const INGLES: Record<string, string> = {
  no_autenticado: 'Missing or invalid API key. Create one in Settings → API keys and send it as «Authorization: Bearer sch_…».',
  prohibido: 'This key is not allowed to do that (check its scopes: lectura, escritura, mcp).',
  no_encontrado: 'Not found, or it is not yours.',
  peticion_invalida: 'The request is not valid. The Spanish message says exactly what is wrong.',
  conflicto: 'Conflict with the current state (for example, the document is still being processed).',
  duplicado: 'It already exists.',
  cuota_superada: 'You have reached a quota of your plan.',
  limite_de_ritmo: 'Too many requests. Wait the seconds in the Retry-After header and try again.',
  requiere_pro: 'This needs the Pro plan (or you reached a limit of the free plan).',
  demasiado_grande: 'The file is too large.',
  no_disponible: 'Not available on this instance.',
  proveedor_fallo: 'An AI provider failed. Try again in a few seconds.',
  interno: 'Something failed on the server. Try again in a few seconds.',
};

/** Error de la v1: mensaje en español y, si se da, en inglés. */
function falla(codigo: CodigoError, mensaje: string, message?: string, detalles?: Record<string, unknown>, estado?: number): never {
  throw new ErrorScholaris(codigo, mensaje, { ...(detalles ?? {}), ...(message ? { _en: message } : {}) }, estado as never);
}

function responderErrorV1(c: C, e: unknown): Response {
  let codigo: string = 'interno';
  let mensaje = 'Algo ha fallado en el servidor. Vuelve a intentarlo en unos segundos.';
  let estado = 500;
  let detalles: Record<string, unknown> | undefined;
  if (e instanceof ErrorScholaris) {
    codigo = e.codigo; mensaje = e.message; estado = e.estado; detalles = e.detalles ? { ...e.detalles } : undefined;
  } else {
    console.error(JSON.stringify({ nivel: 'error', ruta: c.req.path, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), pila: e instanceof Error ? e.stack : undefined }));
  }
  const message = (detalles?._en as string | undefined) ?? INGLES[codigo] ?? INGLES.interno!;
  if (detalles) delete detalles._en;
  const reintentar = detalles?.reintentar;
  if (codigo === 'limite_de_ritmo') c.header('retry-after', String(reintentar ?? 30));
  const origen = new URL(c.req.url).origin;
  return c.json({
    error: { codigo, mensaje, message, estado, documentacion: `${origen}/api#errores`, ...(detalles && Object.keys(detalles).length ? { detalles } : {}) },
  }, estado as 400);
}

// ---------------------------------------------------------------------------
// Llamadas internas a la v2
// ---------------------------------------------------------------------------

class Interno {
  constructor(private pl: Plataforma, private u: UsuarioSesion, private origen: string) {}

  async llamar(metodo: string, ruta: string, o: { json?: unknown; cuerpo?: BodyInit; tipo?: string; acepta?: string } = {}): Promise<Response> {
    const h = new Headers({ 'x-scholaris-cliente': 'api-v1' });
    if (o.json !== undefined) h.set('content-type', 'application/json');
    else if (o.tipo) h.set('content-type', o.tipo);
    if (o.acepta) h.set('accept', o.acepta);
    const body = o.json !== undefined ? JSON.stringify(o.json) : o.cuerpo;
    return this.pl.atender(this.u, new Request(`${this.origen}${PREFIJO_API}${ruta}`, { method: metodo, headers: h, ...(body !== undefined ? { body } : {}) }));
  }

  async pedir<T>(metodo: string, ruta: string, o: { json?: unknown; cuerpo?: BodyInit; tipo?: string } = {}): Promise<T> {
    const r = await this.llamar(metodo, ruta, o);
    if (!r.ok) throw await errorDe(r);
    return (await r.json()) as T;
  }
}

async function errorDe(r: Response): Promise<ErrorScholaris> {
  try {
    const b = (await r.json()) as CuerpoError;
    return new ErrorScholaris(b.error.codigo, b.error.mensaje, b.error.detalles, r.status as never);
  } catch {
    return new ErrorScholaris('interno', `El servidor respondió ${r.status}.`, undefined, (r.status >= 400 ? r.status : 500) as never);
  }
}

const dormir = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Espera hasta `segundos` a que `listo()` diga que sí, con intervalos crecientes (cada sondeo cuenta en el ritmo). */
async function esperarA<T>(segundos: number, leer: () => Promise<T>, listo: (x: T) => boolean): Promise<T> {
  const fin = Date.now() + segundos * 1000;
  let x = await leer();
  let paso = 700;
  while (!listo(x) && Date.now() < fin) {
    await dormir(Math.min(paso, Math.max(0, fin - Date.now())));
    paso = Math.min(4000, Math.round(paso * 1.4));
    try { x = await leer(); } catch (e) {
      // Un 429 al sondear no es un fallo de la petición: se espera y se sigue.
      if (!(e instanceof ErrorScholaris && e.codigo === 'limite_de_ritmo')) throw e;
      await dormir(Math.min(5000, Math.max(0, fin - Date.now())));
    }
  }
  return x;
}

// ---------------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------------

function quiereMarkdown(c: C, cuerpo?: { formato?: unknown }): boolean {
  const f = c.req.query('formato') ?? (typeof cuerpo?.formato === 'string' ? cuerpo.formato : undefined);
  if (f) return f === 'markdown' || f === 'md';
  const a = c.req.header('accept') ?? '';
  return a.includes('text/markdown') && !a.includes('application/json');
}

function markdown(c: C, texto: string, estado = 200): Response {
  return c.body(texto, estado as 200, { 'content-type': 'text/markdown; charset=utf-8' });
}

function numero(v: string | number | undefined | null, def: number, min: number, max: number, nombre: string): number {
  if (v === undefined || v === null || v === '') return def;
  const x = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(x)) falla('peticion_invalida', `«${nombre}» debe ser un número.`, `«${nombre}» must be a number.`);
  return Math.min(max, Math.max(min, x));
}

/** Segundos de espera: `?esperar=N`; `Prefer: respond-async` o `esperar=0` = asíncrono. */
function segundosDeEspera(c: C, def: number): number {
  if (/respond-async/i.test(c.req.header('prefer') ?? '')) return 0;
  return numero(c.req.query('esperar'), def, 0, 600, 'esperar');
}

function listaDocs(c: C, cuerpo?: string[] | string): string[] | undefined {
  const deQuery = [...(c.req.queries('documento') ?? []), ...(c.req.queries('documentos') ?? [])].flatMap((x) => x.split(','));
  const deCuerpo = Array.isArray(cuerpo) ? cuerpo : typeof cuerpo === 'string' ? cuerpo.split(',') : [];
  const todos = [...deQuery, ...deCuerpo].map((x) => x.trim()).filter(Boolean);
  return todos.length ? todos : undefined;
}

async function cuerpoJsonV1<T>(c: C): Promise<T> {
  const t = await c.req.text();
  if (!t.trim()) return {} as T;
  try { return JSON.parse(t) as T; } catch {
    return falla('peticion_invalida', 'El cuerpo no es JSON válido.', 'The body is not valid JSON.');
  }
}

// ---------------------------------------------------------------------------
// Idempotencia: Idempotency-Key → recurso creado (24 h), guardado en el almacén
// ---------------------------------------------------------------------------

async function claveIdempotencia(c: C, u: UsuarioSesion, verbo: string): Promise<string | null> {
  const k = c.req.header('idempotency-key');
  if (!k) return null;
  if (k.length > 255) falla('peticion_invalida', 'La Idempotency-Key no puede pasar de 255 caracteres.', 'Idempotency-Key must be at most 255 characters.');
  return `u/${u.id}/api-v1/idempotencia/${verbo}-${await sha256(k)}.json`;
}

async function recordado(pl: Plataforma, clave: string | null): Promise<string | null> {
  if (!clave) return null;
  const b = await pl.almacen.bytes(clave).catch(() => null);
  if (!b) return null;
  try {
    const r = JSON.parse(new TextDecoder().decode(b)) as { recurso: string; cuando: number };
    return Date.now() - r.cuando < IDEMPOTENCIA_MS ? r.recurso : null;
  } catch { return null; }
}

async function recordar(pl: Plataforma, clave: string | null, recurso: string): Promise<void> {
  if (clave) await pl.almacen.poner(clave, JSON.stringify({ recurso, cuando: Date.now() }), 'application/json');
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

async function documentoV1(io: Interno, origen: string, id: string): Promise<DocumentoV1> {
  const d = await io.pedir<DetalleDocumento>('GET', `/documentos/${encodeURIComponent(id)}`);
  const extra: { progreso?: number; fase?: string; referencia?: string } = {};
  if (d.estado === 'listo') {
    const r = await io.llamar('GET', `/documentos/${encodeURIComponent(id)}/cita?estilo=apa`);
    if (r.ok) extra.referencia = ((await r.json()) as { texto: string }).texto;
  } else if (d.tarea) {
    const r = await io.llamar('GET', `/tareas/${encodeURIComponent(d.tarea)}`);
    if (r.ok) {
      const t = (await r.json()) as Tarea;
      if (t.progreso) { extra.progreso = t.progreso.total; extra.fase = t.progreso.fase; }
      if (t.estado === 'error' && t.error && !d.error) d.error = t.error;
    }
  }
  return documentoDeDetalle(origen, d, extra);
}

const terminado = (d: DocumentoV1) => d.estado === 'listo' || d.estado === 'error';

function nombreDeCrudo(c: C, mime: string): string {
  const dispo = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(c.req.header('content-disposition') ?? '')?.[1];
  const n = c.req.query('nombre') ?? c.req.header('x-nombre') ?? (dispo ? decodeURIComponent(dispo) : undefined);
  if (n) return n.replace(/[/\\]+/g, '_').slice(0, 300);
  const ext: Record<string, string> = {
    'application/pdf': 'pdf', 'application/epub+zip': 'epub', 'text/markdown': 'md', 'text/plain': 'txt', 'text/html': 'html', [MIME_DOCX]: 'docx',
    'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'image/jpeg': 'jpg', 'image/png': 'png',
  };
  return `documento.${ext[mime] ?? 'bin'}`;
}

/** Sube los bytes directo al almacén y lanza la ingesta (el servidor convierte). */
async function subirBytes(pl: Plataforma, io: Interno, bytes: Uint8Array, nombre: string, mime: string, metadatos: Partial<MetadatosDocumento>): Promise<{ documento: string; duplicado?: boolean }> {
  if (!bytes.byteLength) falla('peticion_invalida', 'El fichero está vacío.', 'The file is empty.');
  const huella = await sha256(bytes);
  const s = await io.pedir<SubidaCreada>('POST', '/subidas', { json: { nombre, mime, bytes: bytes.byteLength, huella, ...(Object.keys(metadatos).length ? { metadatos } : {}) } });
  if (s.duplicado) return { documento: s.duplicado, duplicado: true };
  try {
    if (s.original.modo === 'partes' && s.original.idSubida) {
      const tam = s.original.tamParte ?? 16 * 1024 * 1024;
      const partes: Array<{ numero: number; etag: string }> = [];
      for (let i = 0, n = 1; i < bytes.byteLength; i += tam, n++) {
        partes.push({ numero: n, etag: await pl.almacen.ponerParte(s.original.clave, s.original.idSubida, n, bytes.subarray(i, i + tam)) });
      }
      await io.pedir('POST', `/subidas/${s.subida}/completar`, { json: { partes } });
    } else {
      await pl.almacen.poner(s.original.clave, bytes, mime);
    }
    const ing = await io.pedir<IngestaIniciada>('POST', `/subidas/${s.subida}/ingestar`, { json: {} });
    return { documento: ing.documento };
  } catch (e) {
    // Sin dejar documentos fantasma: la subida a medias se cancela.
    await io.llamar('DELETE', `/subidas/${s.subida}`).catch(() => undefined);
    throw e;
  }
}

function metadatosDe(o: { titulo?: unknown; autores?: unknown; anio?: unknown }): Partial<MetadatosDocumento> {
  const m: Partial<MetadatosDocumento> = {};
  if (typeof o.titulo === 'string' && o.titulo.trim()) m.titulo = o.titulo.trim().slice(0, 500);
  const autores = autoresDeTexto(typeof o.autores === 'string' || Array.isArray(o.autores) ? (o.autores as string | string[]) : undefined);
  if (autores?.length) m.autores = autores;
  if (o.anio !== undefined && o.anio !== '') m.anio = numero(o.anio as string, 0, -3000, 3000, 'anio');
  return m;
}

// ---------------------------------------------------------------------------
// Texto de un documento
// ---------------------------------------------------------------------------

/** «1:06:56», «66:56», «4016», «4016s» → segundos. */
function segundos(v: string): number | null {
  const s = v.trim().replace(/s$/i, '');
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Posición física desde 1 de una entrada del mapa de folios (el `orden` de la v2 empieza en 0). */
const posicion = (f: MapaFolios['folios'][number]) => f.fisica ?? f.orden + 1;

/**
 * Resuelve un límite al índice en el mapa de folios: «[12]» (posición física),
 * «23» o «xiv» (folio impreso) o, en audio y vídeo, un tiempo.
 */
function resolverLimite(v: string, folios: MapaFolios['folios'], medio: boolean): number {
  const fisica = /^\[(\d+)\]$/.exec(v.trim());
  if (fisica) {
    const i = folios.findIndex((f) => posicion(f) === Number(fisica[1]));
    if (i >= 0) return i;
  } else if (medio) {
    const t = segundos(v);
    if (t === null) falla('peticion_invalida', `«${v}» no es un tiempo: usa 1:06:56, 66:56 o segundos.`, `«${v}» is not a time: use 1:06:56, 66:56 or seconds.`);
    let i = 0;
    folios.forEach((f, k) => { if ((f.t0 ?? 0) <= t) i = k; });
    return i;
  } else {
    const limpio = v.trim().replace(/^pp?\.\s*/i, '').toLowerCase();
    const i = folios.findIndex((f) => (f.impresa ?? '').toLowerCase() === limpio);
    if (i >= 0) return i;
    const j = /^\d+$/.test(limpio) ? folios.findIndex((f) => posicion(f) === Number(limpio)) : -1;
    if (j >= 0) return j;
  }
  return falla('no_encontrado', `No encuentro la página «${v}» en este documento. Usa el folio impreso («23», «xiv») o la posición física entre corchetes («[12]»).`,
    `Page «${v}» is not in this document. Use the printed page («23», «xiv») or the physical position in brackets («[12]»).`);
}

// ---------------------------------------------------------------------------
// SSE de la v2
// ---------------------------------------------------------------------------

async function* eventosSse(cuerpo: ReadableStream<Uint8Array>): AsyncGenerator<{ evento: string; datos: unknown }> {
  const lector = cuerpo.pipeThrough(new TextDecoderStream()).getReader();
  let resto = '';
  for (;;) {
    const { value, done } = await lector.read();
    if (value) resto += value;
    let i: number;
    while ((i = resto.search(/\r?\n\r?\n/)) !== -1) {
      const bloque = resto.slice(0, i);
      resto = resto.slice(i).replace(/^\r?\n\r?\n/, '');
      let evento = 'message';
      const datos: string[] = [];
      for (const l of bloque.split(/\r?\n/)) {
        if (l.startsWith('event:')) evento = l.slice(6).trim();
        else if (l.startsWith('data:')) datos.push(l.slice(5).replace(/^ /, ''));
      }
      if (datos.length) {
        try { yield { evento, datos: JSON.parse(datos.join('\n')) }; } catch { /* trozo no JSON */ }
      }
    }
    if (done) break;
  }
}

/** Nota al pie como la del redactor: «Foucault, *Vigilar y castigar* (1975), p. 23.» */
function nota(f: FuenteV1): string {
  const d = f.documento;
  const autor = d.autores.length === 0 ? 's. a.' : d.autores.length === 1 ? d.autores[0]!.split(',')[0]! : d.autores.length === 2
    ? `${d.autores[0]!.split(',')[0]} y ${d.autores[1]!.split(',')[0]}` : `${d.autores[0]!.split(',')[0]} et al.`;
  return `${autor}, *${d.titulo}* (${d.anio ?? 's. f.'}), ${f.localizador}.`;
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export function montarV1(app: AppPuerta, pl: Plataforma, autenticar: (r: Request) => Promise<UsuarioSesion>): void {
  const origenDe = (c: C) => pl.config.origen?.replace(/\/$/, '') || new URL(c.req.url).origin;

  app.use(`${V}/*`, cors({
    origin: '*',
    allowHeaders: ['authorization', 'content-type', 'content-disposition', 'idempotency-key', 'prefer', 'accept', 'x-nombre'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['retry-after', 'location', 'idempotent-replayed'],
    maxAge: 86400,
  }));
  app.use(V, cors({ origin: '*' }));

  // --- Sin autenticar: lo que se describe a sí mismo ------------------------
  const indice = (c: C) => {
    const o = origenDe(c);
    return c.json({
      nombre: 'Scholaris API v1',
      documentacion: `${o}/api`, openapi: `${o}${V}/openapi.json`, llms: `${o}${V}/llms.txt`,
      autenticacion: 'Authorization: Bearer sch_… (Ajustes → Claves de API)',
      verbos: [
        'POST /documentos', 'GET /documentos', 'GET /documentos/{id}', 'DELETE /documentos/{id}', 'GET /documentos/{id}/texto',
        'GET /buscar?q=…', 'POST /preguntar', 'POST /citar', 'GET /citar/{id}', 'POST /verificar',
      ].map((v) => v.replace(' /', ` ${V}/`)),
    });
  };
  app.get(V, indice);
  app.get(`${V}/`, indice);
  app.get(`${V}/openapi.json`, (c) => c.json(openapiV1(origenDe(c))));
  app.get(`${V}/llms.txt`, (c) => c.body(llmsTxtV1(origenDe(c)), 200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' }));

  // --- Con clave -------------------------------------------------------------
  const conClave = (fn: (c: C, io: Interno, u: UsuarioSesion) => Promise<Response>) => async (c: C): Promise<Response> => {
    try {
      const u = await autenticar(c.req.raw);
      if (pl.admitir) {
        const { LIMITES } = await import('../compartido/planes.js');
        const l = LIMITES[pl.config.modo === 'local' ? 'local' : u.plan];
        const r = await pl.admitir(`u:${u.id}`, l.porMinuto);
        if (!r.ok) throw new ErrorScholaris('limite_de_ritmo', 'Vas demasiado deprisa. Espera unos segundos y vuelve a intentarlo.', { reintentar: r.reintentar ?? 30 });
      }
      c.set('usuario', u);
      return await fn(c, new Interno(pl, u, origenDe(c)), u);
    } catch (e) {
      return responderErrorV1(c, e);
    }
  };

  // POST /documentos: un fichero (cuerpo crudo o multipart) o { url }.
  app.post(`${V}/documentos`, conClave(async (c, io) => {
    const o = origenDe(c);
    const espera = segundosDeEspera(c, 60);
    const idem = await claveIdempotencia(c, c.get('usuario'), 'documentos');
    const previo = await recordado(pl, idem);
    let id: string;
    let duplicado = false;
    if (previo) {
      id = previo;
      c.header('idempotent-replayed', 'true');
    } else {
      const tipo = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      const largo = Number(c.req.header('content-length') ?? 0);
      if (pl.config.modo !== 'local' && largo > MAX_CRUDO_NUBE) {
        falla('demasiado_grande', `Por aquí caben ficheros de hasta ${MAX_CRUDO_NUBE / 1048576} MB. Para más, usa la subida por partes de la API v2 o el SDK de Python.`,
          `This endpoint takes files up to ${MAX_CRUDO_NUBE / 1048576} MB. For larger ones use the multipart upload of API v2 or the Python SDK.`);
      }
      if (tipo === 'application/json') {
        const b = await cuerpoJsonV1<SubirUrlV1 & { formato?: string }>(c);
        if (typeof b.url !== 'string' || !b.url) {
          falla('peticion_invalida', 'Manda el fichero como cuerpo (o multipart, campo «archivo») o un JSON con «url».', 'Send the file as the body (or multipart, field «archivo») or a JSON with «url».');
        }
        const m = metadatosDe(b);
        const r = await io.pedir<IngestaIniciada>('POST', '/subidas/url', { json: { url: b.url, ...(b.tipo ? { tipo: b.tipo } : {}), ...(b.modo ? { modo: b.modo } : {}), ...(Object.keys(m).length ? { metadatos: m } : {}) } });
        id = r.documento;
      } else if (tipo === 'multipart/form-data') {
        const f = await c.req.formData();
        const archivo = (f.get('archivo') ?? f.get('file') ?? [...f.values()].find((v) => typeof v !== 'string')) as File | string | null;
        const url = f.get('url');
        const m = metadatosDe({ titulo: f.get('titulo') ?? undefined, autores: f.get('autores') ?? undefined, anio: f.get('anio') ?? undefined });
        if (archivo && typeof archivo !== 'string') {
          const r = await subirBytes(pl, io, new Uint8Array(await archivo.arrayBuffer()), archivo.name || 'documento', archivo.type || 'application/octet-stream', m);
          id = r.documento; duplicado = !!r.duplicado;
        } else if (typeof url === 'string' && url) {
          id = (await io.pedir<IngestaIniciada>('POST', '/subidas/url', { json: { url, ...(Object.keys(m).length ? { metadatos: m } : {}) } })).documento;
        } else {
          return falla('peticion_invalida', 'El formulario no trae ningún fichero (campo «archivo») ni «url».', 'The form has no file (field «archivo») and no «url».');
        }
      } else {
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        let mime = tipo || 'application/octet-stream';
        if (mime === 'application/octet-stream' && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) mime = 'application/pdf';
        const m = metadatosDe({ titulo: c.req.query('titulo'), autores: c.req.query('autores'), anio: c.req.query('anio') });
        const r = await subirBytes(pl, io, bytes, nombreDeCrudo(c, mime), mime, m);
        id = r.documento; duplicado = !!r.duplicado;
      }
      await recordar(pl, idem, id);
    }
    const d = await esperarA(espera, () => documentoV1(io, o, id), terminado);
    if (duplicado) d.duplicado = true;
    const estado = terminado(d) ? (duplicado || previo ? 200 : 201) : 202;
    c.header('location', `${o}${V}/documentos/${id}`);
    return quiereMarkdown(c) ? markdown(c, mdDocumento(d), estado) : c.json(d, estado as 200);
  }));

  app.get(`${V}/documentos`, conClave(async (c, io) => {
    const o = origenDe(c);
    const q = new URLSearchParams();
    for (const k of ['q', 'cursor', 'estado', 'autor', 'tipo', 'biblioteca']) { const v = c.req.query(k); if (v) q.set(k, v); }
    q.set('limite', String(numero(c.req.query('limite'), 50, 1, 200, 'limite')));
    if (q.get('estado')) {
      // Los estados de la v1 a los de la estantería.
      const e = q.get('estado')!;
      q.set('estado', e === 'en_cola' ? 'pendiente' : e);
    }
    const p = await io.pedir<Pagina<ResumenDocumento>>('GET', `/documentos?${q}`);
    const salida: ListaDocumentosV1 = { documentos: p.elementos.map((r) => documentoDeResumen(o, r)), total: p.total ?? p.elementos.length };
    if (p.siguiente) salida.siguiente = p.siguiente;
    return quiereMarkdown(c) ? markdown(c, mdDocumentos(salida.documentos, salida.total, salida.siguiente)) : c.json(salida);
  }));

  app.get(`${V}/documentos/:id`, conClave(async (c, io) => {
    const o = origenDe(c);
    const id = c.req.param('id')!;
    const d = await esperarA(segundosDeEspera(c, 0), () => documentoV1(io, o, id), terminado);
    return quiereMarkdown(c) ? markdown(c, mdDocumento(d)) : c.json(d);
  }));

  app.delete(`${V}/documentos/:id`, conClave(async (c, io) => {
    const id = c.req.param('id')!;
    await io.pedir('DELETE', `/documentos/${encodeURIComponent(id)}`);
    return c.json({ ok: true, id, borrado: true });
  }));

  // GET /documentos/{id}/texto?desde=23&hasta=25 | desde=1:02:00&hasta=1:05:00 | desde=[12]
  app.get(`${V}/documentos/:id/texto`, conClave(async (c, io) => {
    const o = origenDe(c);
    const id = encodeURIComponent(c.req.param('id')!);
    const d = await io.pedir<DetalleDocumento>('GET', `/documentos/${id}`);
    const { folios } = await io.pedir<MapaFolios>('GET', `/documentos/${id}/folios`);
    if (!folios.length) {
      return falla('conflicto', d.estado === 'listo' ? 'Este documento no tiene texto.' : 'El documento todavía no tiene texto: espera a que termine de procesarse.',
        d.estado === 'listo' ? 'This document has no text.' : 'The document has no text yet: wait until it is processed.');
    }
    const medio = d.tipo === 'audio' || d.tipo === 'video';
    const limite = numero(c.req.query('limite'), 20, 1, 100, 'limite');
    const qd = c.req.query('desde');
    const qh = c.req.query('hasta');
    const desde = qd ? resolverLimite(qd, folios, medio) : 0;
    let hasta = qh ? resolverLimite(qh, folios, medio) : Math.min(folios.length - 1, desde + limite - 1);
    if (hasta < desde) falla('peticion_invalida', '«hasta» va antes que «desde».', '«hasta» comes before «desde».');
    if (hasta - desde + 1 > limite) hasta = desde + limite - 1;
    const unidades = await io.pedir<UnidadVista[]>('GET', `/documentos/${id}/unidades?desde=${folios[desde]!.orden}&hasta=${folios[hasta]!.orden}`);
    const doc = { ...docBreve(d.id, d.metadatos), tipo: d.tipo };
    const autor = doc.autores[0]?.split(',')[0] ?? 's. a.';
    const salida: TextoV1 = {
      documento: doc,
      unidades: unidades.map((u): UnidadTextoV1 => {
        const loc = u.etiqueta || localizador(u.ancla);
        const x: UnidadTextoV1 = {
          posicion: u.ancla.tipo === 'pagina' ? u.ancla.fisica : u.orden + 1, localizador: loc,
          cita: `(${[autor, doc.anio ?? 's. f.', loc].filter(Boolean).join(', ')})`,
          enlace: enlaceLector(o, d.id, u.ancla), texto: u.texto,
        };
        if (u.ancla.tipo === 'tiempo') { x.t0 = u.ancla.t0; x.t1 = u.ancla.t1; }
        return x;
      }),
    };
    const pedidoHasta = qh ? resolverLimite(qh, folios, medio) : folios.length - 1;
    if (hasta < pedidoHasta) salida.siguiente = `[${posicion(folios[hasta + 1]!)}]`;
    return quiereMarkdown(c) ? markdown(c, mdTexto(salida)) : c.json(salida);
  }));

  // GET /buscar?q=…&k=10&documento=d_… (o POST con JSON)
  const buscar = conClave(async (c, io) => {
    const o = origenDe(c);
    const b: Partial<BuscarV1> & { consulta?: string; formato?: string } = c.req.method === 'POST' ? await cuerpoJsonV1(c) : {};
    const q = (c.req.query('q') ?? b.q ?? b.consulta ?? '').trim();
    if (!q) falla('peticion_invalida', 'Falta «q»: lo que hay que buscar.', 'Missing «q»: what to search for.');
    const k = numero(c.req.query('k') ?? b.k, 10, 1, 50, 'k');
    const documentos = listaDocs(c, b.documentos);
    const biblioteca = c.req.query('biblioteca') ?? b.biblioteca;
    const filtros = { ...(documentos ? { documentos } : {}), ...(biblioteca ? { bibliotecas: [biblioteca] } : {}) };
    const r = await io.pedir<RespuestaBusqueda>('POST', '/busqueda', { json: { consulta: q, k, ...(Object.keys(filtros).length ? { filtros } : {}) } });
    const salida: RespuestaBuscarV1 = { consulta: q, pasajes: r.resultados.slice(0, k).map((x) => pasajeDeVista(o, x)), ms: r.ms };
    return quiereMarkdown(c, b) ? markdown(c, mdPasajes(salida)) : c.json(salida);
  });
  app.get(`${V}/buscar`, buscar);
  app.post(`${V}/buscar`, buscar);

  // POST /preguntar { pregunta } → respuesta en Markdown con notas [^n] y sus fuentes.
  app.post(`${V}/preguntar`, conClave(async (c, io) => {
    const o = origenDe(c);
    const b = await cuerpoJsonV1<Partial<PreguntarV1> & { q?: string; formato?: string }>(c);
    const pregunta = (b.pregunta ?? b.q ?? c.req.query('q') ?? '').trim();
    if (!pregunta) falla('peticion_invalida', 'Falta «pregunta».', 'Missing «pregunta» (the question).');
    const documentos = listaDocs(c, b.documentos);
    const filtros = { ...(documentos ? { documentos } : {}), ...(b.biblioteca ? { bibliotecas: [b.biblioteca] } : {}) };
    const r = await io.llamar('POST', '/busqueda/responder', {
      json: { consulta: pregunta, k: numero(b.k, 8, 1, 12, 'k'), ...(Object.keys(filtros).length ? { filtros } : {}) }, acepta: 'text/event-stream',
    });
    if (!r.ok || !r.body) throw await errorDe(r);
    const t0 = Date.now();
    const vistas = new Map<string, ResultadoVista>();
    const fuentes: FuenteV1[] = [];
    let texto = '';
    let confianza: RespuestaPreguntarV1['confianza'] = 'baja';
    const fuenteDe = (e: { n: number; fragmento: string; citaCorta: string; etiqueta: string }): FuenteV1 | null => {
      const v = vistas.get(e.fragmento);
      return v ? { n: e.n, ...pasajeDeVista(o, v), cita: e.citaCorta, localizador: e.etiqueta || localizador(v.fragmento.ancla, v.fragmento.anclaFin) } : null;
    };
    const final = (): RespuestaPreguntarV1 => {
      let md = texto.replace(/[ \t]+(\[\^\d+\])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
      if (fuentes.length) md += `\n\n${fuentes.map((f) => `[^${f.n}]: ${nota(f)}`).join('\n')}`;
      return { pregunta, respuesta: md, fuentes, confianza, ms: Date.now() - t0 };
    };
    const procesar = (evento: string, datos: unknown): { tipo: string; datos: unknown } | null => {
      const d = datos as Record<string, unknown>;
      if (evento === 'resultados') {
        for (const v of d.resultados as ResultadoVista[]) vistas.set(v.fragmento.id, v);
        return { tipo: 'pasajes', datos: { pasajes: (d.resultados as ResultadoVista[]).map((v) => pasajeDeVista(o, v)) } };
      }
      if (evento === 'texto') { texto += String(d.delta ?? ''); return { tipo: 'texto', datos: { delta: d.delta } }; }
      if (evento === 'cita') {
        const f = fuenteDe(d as never);
        if (!f) return null;
        fuentes.push(f);
        return { tipo: 'fuente', datos: f };
      }
      if (evento === 'fin') { confianza = (d.confianza as RespuestaPreguntarV1['confianza']) ?? 'baja'; return { tipo: 'fin', datos: final() }; }
      if (evento === 'error') {
        throw new ErrorScholaris('proveedor_fallo', String(d.mensaje ?? 'No he podido terminar la respuesta.'));
      }
      return null;
    };
    if (b.stream || c.req.query('stream') === 'true' || (c.req.header('accept') ?? '').includes('text/event-stream')) {
      return streamSSE(c, async (sse) => {
        try {
          for await (const ev of eventosSse(r.body!)) {
            const x = procesar(ev.evento, ev.datos);
            if (x) await sse.writeSSE({ event: x.tipo, data: JSON.stringify(x.datos) });
          }
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          await sse.writeSSE({ event: 'error', data: JSON.stringify({ codigo: 'proveedor_fallo', mensaje: m, message: INGLES.proveedor_fallo }) });
        }
      });
    }
    for await (const ev of eventosSse(r.body)) procesar(ev.evento, ev.datos);
    const salida = final();
    return quiereMarkdown(c, b) ? markdown(c, mdRespuesta(salida)) : c.json(salida);
  }));

  // POST /citar { texto, estilo } (o un .docx como cuerpo) → el texto con sus citas y la bibliografía.
  const citarRespuesta = async (c: C, io: Interno, id: string, espera: number): Promise<Response> => {
    const o = origenDe(c);
    const a = await esperarA(espera, () => io.pedir<DetalleAutocita>('GET', `/citas/autocita/${encodeURIComponent(id)}`), (x) => x.estado === 'listo' || x.estado === 'error' || x.estado === 'cancelada');
    const salida: RespuestaCitarV1 = { id: a.id, estado: a.estado === 'cancelada' ? 'error' : a.estado, estilo: a.estilo };
    if (a.estado === 'listo') {
      const aceptadas = a.propuestas.filter((p) => p.decision !== 'rechazada');
      const quiereDocx = (c.req.header('accept') ?? '').includes(MIME_DOCX) || c.req.query('formato') === 'docx';
      const ex = await io.llamar('GET', `/citas/autocita/${encodeURIComponent(id)}/exportar?formato=${quiereDocx ? 'docx' : 'md'}`);
      if (!ex.ok) throw await errorDe(ex);
      if (quiereDocx) {
        return new Response(ex.body, { headers: { 'content-type': MIME_DOCX, 'content-disposition': ex.headers.get('content-disposition') ?? 'attachment; filename="citado.docx"' } });
      }
      salida.texto = await ex.text();
      salida.citas = aceptadas.map((p) => citaDePropuesta(o, p));
      salida.bibliografia = a.bibliografia;
    } else if (a.estado === 'error') {
      salida.error = a.error ?? 'No he podido terminar las citas.';
    } else {
      salida.progreso_url = `${o}${V}/citar/${a.id}`;
    }
    const estado = salida.estado === 'listo' || salida.estado === 'error' ? 200 : 202;
    if (estado === 202) c.header('location', salida.progreso_url!);
    return quiereMarkdown(c) ? markdown(c, mdCitar(salida), estado) : c.json(salida, estado as 200);
  };

  app.post(`${V}/citar`, conClave(async (c, io, u) => {
    const espera = segundosDeEspera(c, 120);
    const idem = await claveIdempotencia(c, u, 'citar');
    const previo = await recordado(pl, idem);
    if (previo) { c.header('idempotent-replayed', 'true'); return citarRespuesta(c, io, previo, espera); }
    const tipo = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    let peticion: Record<string, unknown>;
    if (tipo === MIME_DOCX || tipo === 'application/vnd.oasis.opendocument.text') {
      const nombre = c.req.query('nombre') ?? 'texto.docx';
      const s = await io.pedir<{ clave: string }>('POST', `/citas/subir?nombre=${encodeURIComponent(nombre)}`, { cuerpo: await c.req.arrayBuffer(), tipo });
      peticion = { subida: s.clave, titulo: nombre.replace(/\.[^.]+$/, '') };
      for (const k of ['estilo', 'idioma']) { const v = c.req.query(k); if (v) peticion[k] = v; }
    } else {
      const b = await cuerpoJsonV1<Partial<CitarV1> & { formato?: string }>(c);
      if (typeof b.texto !== 'string' || !b.texto.trim()) {
        falla('peticion_invalida', 'Falta «texto»: lo que hay que citar (o manda un .docx como cuerpo).', 'Missing «texto»: the text to cite (or send a .docx as the body).');
      }
      const documentos = listaDocs(c, b.documentos);
      const filtros = { ...(documentos ? { documentos } : {}), ...(b.biblioteca ? { bibliotecas: [b.biblioteca] } : {}) };
      peticion = {
        texto: b.texto, estilo: b.estilo ?? c.req.query('estilo') ?? 'apa', idioma: b.idioma ?? 'es-ES',
        ...(b.umbral !== undefined ? { umbral: numero(b.umbral, 0.7, 0, 1, 'umbral') } : {}), ...(Object.keys(filtros).length ? { filtros } : {}),
      };
    }
    const r = await io.pedir<{ autocita: string }>('POST', '/citas/autocita', { json: peticion });
    await recordar(pl, idem, r.autocita);
    return citarRespuesta(c, io, r.autocita, espera);
  }));

  app.get(`${V}/citar/:id`, conClave(async (c, io) => citarRespuesta(c, io, c.req.param('id')!, segundosDeEspera(c, 0))));

  // POST /verificar { afirmacion } → ¿la respalda la biblioteca?
  app.post(`${V}/verificar`, conClave(async (c, io) => {
    const o = origenDe(c);
    const b = await cuerpoJsonV1<Partial<VerificarV1> & { formato?: string }>(c);
    const afirmacion = (b.afirmacion ?? '').trim();
    if (afirmacion.length < 4) falla('peticion_invalida', 'Falta «afirmacion»: lo que quieres comprobar.', 'Missing «afirmacion»: the claim to check.');
    const documentos = listaDocs(c, b.documentos);
    const v = await io.pedir<Verificacion>('POST', '/citas/verificar', {
      json: { afirmacion, ...(b.anio ? { anioTexto: numero(b.anio, 0, -3000, 3000, 'anio') } : {}), k: numero(b.k, 5, 1, 20, 'k'), ...(documentos ? { filtros: { documentos } } : {}) },
    });
    const ids = [...new Set(v.citas.map((x) => x.documento))];
    const fichas = new Map((await Promise.all(ids.map(async (id) => {
      const r = await io.llamar('GET', `/documentos/${encodeURIComponent(id)}`);
      return r.ok ? [id, (await r.json()) as DetalleDocumento] as const : null;
    }))).filter((x): x is readonly [string, DetalleDocumento] => !!x));
    const salida: RespuestaVerificarV1 = {
      afirmacion, veredicto: v.veredicto, respaldada: v.veredicto === 'respaldada', probabilidad: v.citas[0]?.respaldo ?? 0, ms: v.ms,
      pasajes: v.citas.map((x) => {
        const f = fichas.get(x.documento);
        return {
          id: x.fragmento, documento: f ? docBreve(x.documento, f.metadatos) : { id: x.documento, titulo: x.etiqueta, autores: [] }, texto: x.pasaje,
          cita: x.citaCorta, localizador: localizador(x.ancla, x.anclaFin), ancla: x.ancla, enlace: enlaceLector(o, x.documento, x.ancla, x.fragmento),
          puntuacion: x.respaldo, relacion: x.relacion, respaldo: x.respaldo,
        };
      }),
    };
    return quiereMarkdown(c, b) ? markdown(c, mdVerificar(salida)) : c.json(salida);
  }));

  // Lo demás bajo /api/v1: un 404 que explica qué hay.
  app.all(`${V}/*`, (c) => responderErrorV1(c, new ErrorScholaris('no_encontrado', `La ruta ${c.req.method} ${c.req.path} no existe. Mira ${origenDe(c)}${V} para ver los verbos.`, {
    _en: `Route ${c.req.method} ${c.req.path} does not exist. See ${origenDe(c)}${V} for the verbs.`,
  })));
}

