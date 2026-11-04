/**
 * El montaje del agente de Investigar sobre los puertos del usuario: su buscador,
 * Gemini con su clave (o la de la instancia) y sus medios en el almacén.
 *
 * El vídeo o el audio que el agente mira es el proxy ligero de la percepción
 * (`<prefijo>proxy.mp4`) si existe; si no, el original (hasta 2 GB). Se sube una
 * vez a Gemini Files y su URI se guarda junto a él (`<prefijo>proxy.gemini.json`,
 * la misma clave y la misma forma que usa la percepción, para que los dos se
 * aprovechen): se vuelve a subir si falta, si quedan menos de 6 h o si Gemini ya no
 * lo tiene activo.
 */
import { crearModeloGemini, esperarArchivoActivo, estadoArchivoGemini, subirArchivoGemini, type ConfigGeminiAgente, type MediosInvestigar, type PuertosInvestigar } from '@scholaris/investigar';
import type { PuertosUsuario } from '../puertos.js';
import { claveDe } from '../rutas/util.js';
import { prefijoDocumento } from '../rutas/subidas.js';
import { fallo } from './errores.js';
import { obtenerBuscador } from './servicios.js';

/**
 * Modelos del agente, elegidos con el banco de Investigar (packages/investigar/banco,
 * 4-11-2026; mismas dos preguntas difíciles sobre Fresa y chocolate y su cuento, con
 * 3.8 Flash para mirar y verificar):
 *
 *   agente                              pasos   llamadas a «ver»   anclas clave   $/pregunta
 *   gemini-4-argon                      17, 15        4, 3             6/6          0,21-0,24
 *   gemini-3.8-flash                    14, 15        2, 4             6/6          0,09-0,10
 *   gemini-3.1-pro-preview               6, 13        1, 3             5/6          0,14-0,17
 *   gemini-3.1-pro-preview-customtools   8, 10        2, 1             4/6          0,14-0,19
 *
 * Ninguno hizo llamadas inválidas. Los 3.1 Pro paran pronto (no buscan la segunda
 * escena de Coppelia, la que resignifica el helado); Argon es el más concienzudo:
 * localiza las escenas, las mira enteras y lee alrededor. Flash usa bien las
 * herramientas a menos de la mitad del precio: va en la profundidad «rápida» y mira y
 * verifica en todas.
 */
export const MODELOS_INVESTIGAR = {
  agente: 'gemini-4-argon',
  rapido: 'gemini-3.8-flash',
  vision: 'gemini-3.8-flash',
  verificador: 'gemini-3.8-flash',
} as const;

/** Modelos que una petición puede pedir para el agente (el banco compara con ellos). */
export const CANDIDATOS_AGENTE = ['gemini-4-argon', 'gemini-3.1-pro-preview', 'gemini-3.1-pro-preview-customtools', 'gemini-pro-latest', 'gemini-3.8-flash'];

const MAX_GEMINI = 2 * 1024 * 1024 * 1024;
const SEIS_HORAS = 6 * 3600_000;

interface CacheFuente { uri: string; nombre: string; mime: string; bytes: number; subido: string; expira?: string; etag?: string; clave?: string }

const subiendo = new Map<string, Promise<{ uri: string; mime: string } | null>>();

/** La fuente en Gemini Files del medio de un documento (o null si no es un medio o no hay archivo). */
export async function fuenteMedio(p: PuertosUsuario, cfg: ConfigGeminiAgente, documento: string): Promise<{ uri: string; mime: string } | null> {
  const prefijo = prefijoDocumento(p.usuario.id, documento);
  let tarea = subiendo.get(prefijo);
  if (!tarea) {
    tarea = (async () => {
      const [d] = await p.sql.ejecutar<{ tipo: string; original: string; mime: string }>('SELECT tipo, original, mime FROM documentos WHERE id = ?', documento);
      if (!d || (d.tipo !== 'video' && d.tipo !== 'audio')) return null;
      const claveCache = `${prefijo}proxy.gemini.json`;
      const proxy = `${prefijo}proxy.mp4`;
      const cabProxy = await p.almacen.cabecera(proxy).catch(() => null);
      const original = d.original ? claveDe(p.usuario.id, documento, d.original) : '';
      const cabOriginal = !cabProxy && original ? await p.almacen.cabecera(original).catch(() => null) : null;
      const fuente = cabProxy ? { clave: proxy, cab: cabProxy, mime: d.tipo === 'audio' ? 'audio/mp4' : 'video/mp4' } : cabOriginal ? { clave: original, cab: cabOriginal, mime: d.mime } : null;
      // La caché vale si es de este mismo archivo, le quedan más de 6 h y Gemini la tiene activa.
      const guardada = await p.almacen.bytes(claveCache).then((b) => (b ? (JSON.parse(new TextDecoder().decode(b)) as CacheFuente) : null)).catch(() => null);
      if (guardada && (!fuente || ((!guardada.etag || guardada.etag === fuente.cab.etag) && guardada.bytes === fuente.cab.bytes))) {
        const quedan = guardada.expira ? Date.parse(guardada.expira) - Date.now() : 0;
        if (quedan > SEIS_HORAS) {
          const e = await estadoArchivoGemini(cfg, guardada.nombre).catch(() => null);
          if (e?.estado === 'ACTIVE') return { uri: guardada.uri, mime: guardada.mime };
        }
      }
      if (!fuente) return null;
      if (fuente.cab.bytes > MAX_GEMINI) fallo('demasiado_grande', 'El vídeo pesa más de 2 GB y aún no tiene versión ligera: no lo puedo mirar.');
      if (!p.almacen.flujoRango) return null;
      const flujo = await p.almacen.flujoRango(fuente.clave, 0, fuente.cab.bytes - 1);
      if (!flujo) return null;
      // En Workers, un cuerpo en flujo tiene que ser de longitud fija.
      const Fijo = (globalThis as { FixedLengthStream?: new (n: number) => TransformStream<Uint8Array, Uint8Array> }).FixedLengthStream;
      let cuerpo: ReadableStream<Uint8Array> = flujo as ReadableStream<Uint8Array>;
      if (Fijo) { const t = new Fijo(fuente.cab.bytes); void cuerpo.pipeTo(t.writable); cuerpo = t.readable; }
      const subido = await subirArchivoGemini(cfg, cuerpo, fuente.cab.bytes, fuente.mime, `scholaris-${documento}`);
      const activo = await esperarArchivoActivo(cfg, subido.nombre, 600_000);
      const cache: CacheFuente = { uri: activo.uri, nombre: activo.nombre, mime: fuente.mime, bytes: fuente.cab.bytes, subido: new Date().toISOString(), ...(activo.expira ? { expira: activo.expira } : {}), ...(fuente.cab.etag ? { etag: fuente.cab.etag } : {}), clave: fuente.clave };
      await p.almacen.poner(claveCache, JSON.stringify(cache), 'application/json').catch(() => undefined);
      return { uri: activo.uri, mime: fuente.mime };
    })().finally(() => subiendo.delete(prefijo));
    subiendo.set(prefijo, tarea);
  }
  return tarea;
}

function mimeDe(clave: string): string {
  return /\.png$/i.test(clave) ? 'image/png' : /\.webp$/i.test(clave) ? 'image/webp' : 'image/jpeg';
}

export function mediosInvestigar(p: PuertosUsuario, cfg: ConfigGeminiAgente): MediosInvestigar {
  return {
    fuente: (documento) => fuenteMedio(p, cfg, documento),
    async imagen(documento, clave) {
      const b = await p.almacen.bytes(claveDe(p.usuario.id, documento, clave));
      return b ? { bytes: b, mime: mimeDe(clave) } : null;
    },
    url: (documento, clave) => p.almacen.urlLectura(claveDe(p.usuario.id, documento, clave), { segundos: 3600 * 6 }),
  };
}

/** Los puertos del agente para este usuario. Sin clave de Gemini no hay Investigar. */
export async function puertosInvestigar(p: PuertosUsuario, modelo?: string, profundidad: 'rapida' | 'normal' | 'exhaustiva' = 'normal'): Promise<PuertosInvestigar> {
  const g = p.gemini ? await p.gemini() : undefined;
  if (!g) fallo('no_disponible', 'Investigar necesita una clave de Gemini (la de la instancia o la tuya, en Ajustes → Claves).', { proveedor: 'gemini' });
  const cfg: ConfigGeminiAgente = { clave: g!.clave, ...(g!.baseUrl ? { baseUrl: g!.baseUrl } : {}) };
  // En la búsqueda rápida, el agente rápido (3.8 Flash usa bien las herramientas a un tercio del precio).
  const agente = modelo && CANDIDATOS_AGENTE.includes(modelo) ? modelo : profundidad === 'rapida' ? MODELOS_INVESTIGAR.rapido : MODELOS_INVESTIGAR.agente;
  return {
    sql: p.sql,
    buscador: await obtenerBuscador(p),
    modelos: {
      agente: crearModeloGemini(cfg, agente),
      vision: crearModeloGemini(cfg, MODELOS_INVESTIGAR.vision),
      verificador: crearModeloGemini(cfg, MODELOS_INVESTIGAR.verificador),
    },
    medios: mediosInvestigar(p, cfg),
    usuario: { id: p.usuario.id, pro: p.usuario.plan === 'pro' },
  };
}
