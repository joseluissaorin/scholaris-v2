/**
 * Modo sin conexión: toda la inteligencia en un servidor propio de la red de
 * casa (InferBox, Ollama, llama.cpp, vLLM, LM Studio), sin ninguna clave de
 * nube y sin una sola petición a internet.
 *
 *   SCHOLARIS_SIN_CONEXION=1
 *   INFERENCIA_URL=http://localhost:11434        (o INFERBOX_URL)
 *   INFERENCIA_SABOR=ollama|inferbox|llamacpp|vllm|lmstudio|generico   (se deduce si falta)
 *   INFERENCIA_CLAVE=…                           (o INFERBOX_API_KEY; opcional)
 *   INFERENCIA_MODELO_LECTOR=qwen2.5vl:7b
 *   INFERENCIA_MODELO_REDACTOR=…                 (por defecto, el del lector)
 *   INFERENCIA_MODELO_JUEZ=…                     (por defecto, el del redactor)
 *   INFERENCIA_MODELO_EMBEBEDOR=embeddinggemma-2 (por defecto; o bge-m3, qwen3-vl-embed…)
 *   INFERENCIA_EMBEBEDOR_URL=http://localhost:8812 (EmbeddingGemma 2 multimodal: deploy/inferencia/embeddinggemma2)
 *   INFERENCIA_DIMS=768                          (Matryoshka 768/512/256/128; o las del embebedor si no está en la tabla)
 *   INFERENCIA_MODELO_REORDENADOR=…
 *   INFERENCIA_TRANSCRIPCION_URL=http://localhost:8000   (whisper aparte, opcional)
 *   INFERENCIA_MODELO_TRANSCRIPTOR=…
 *   INFERENCIA_REORDENADOR_URL=…                 (llama.cpp --reranking, Infinity…, opcional)
 *   INFERENCIA_CONCURRENCIA=4
 *
 * Toda URL tiene que ser local (localhost, red privada, Tailscale, nombre de
 * servicio de Docker o «.local»): si no, se niega a arrancar. Para permitir
 * otro anfitrión a sabiendas: SCHOLARIS_SIN_CONEXION_PERMITIR=host1,host2.
 */

import type { Inteligencia } from '@scholaris/nucleo';
import { ContadorUso } from './comun.js';
import { crearOpenAICompatible, type ClienteCompatible, type ConfigCompatible, type SaborServidor } from './compatible.js';

export interface EntornoSinConexion {
  SCHOLARIS_SIN_CONEXION?: string;
  SCHOLARIS_SIN_CONEXION_PERMITIR?: string;
  INFERENCIA_URL?: string;
  INFERENCIA_SABOR?: string;
  INFERENCIA_CLAVE?: string;
  INFERENCIA_MODELO_LECTOR?: string;
  INFERENCIA_MODELO_REDACTOR?: string;
  INFERENCIA_MODELO_JUEZ?: string;
  INFERENCIA_MODELO_EMBEBEDOR?: string;
  INFERENCIA_MODELO_REORDENADOR?: string;
  INFERENCIA_MODELO_TRANSCRIPTOR?: string;
  INFERENCIA_DIMS?: string;
  INFERENCIA_TRANSCRIPCION_URL?: string;
  INFERENCIA_REORDENADOR_URL?: string;
  INFERENCIA_EMBEBEDOR_URL?: string;
  INFERENCIA_CONCURRENCIA?: string;
  INFERBOX_URL?: string;
  INFERBOX_API_KEY?: string;
  INFERBOX_KEY?: string;
  [otra: string]: unknown;
}

const verdad = (v: unknown) => typeof v === 'string' && /^(1|true|si|sí|yes|on)$/i.test(v.trim());

/** ¿Está pedido el modo sin conexión? */
export function modoSinConexion(env: { SCHOLARIS_SIN_CONEXION?: unknown; [otra: string]: unknown }): boolean {
  return verdad(env.SCHOLARIS_SIN_CONEXION);
}

/**
 * ¿Es este anfitrión de la red local? localhost, 127/8, ::1, 10/8, 172.16/12,
 * 192.168/16, 169.254/16, 100.64/10 (Tailscale), fc00::/7, fe80::/10, nombres
 * sin punto (servicios de Docker: «ollama», «inferbox») y «.local»/«.lan»/«.internal»/«.home.arpa».
 */
export function esAnfitrionLocal(anfitrion: string, permitidos: string[] = []): boolean {
  const h = anfitrion.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return false;
  // Permitidos: anfitrión exacto o, empezando por punto, todo un dominio («.wikipedia.org»).
  for (const p of permitidos.map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (p === h || (p.startsWith('.') && (h.endsWith(p) || h === p.slice(1)))) return true;
  }
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (/^(local|lan|internal|home\.arpa)$/.test(h) || /\.(local|lan|internal|home\.arpa)$/.test(h)) return true;
  if (h === 'host.docker.internal') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || h === '0.0.0.0';
  }
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapeada) return esAnfitrionLocal(mapeada[1] as string);
    return /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  }
  // Un nombre sin punto solo lo resuelve la red local (Docker, /etc/hosts, mDNS).
  return !h.includes('.');
}

/**
 * Los catálogos abiertos que consulta el enriquecimiento de metadatos y el
 * enlace con Wikidata. Solo se abren con SCHOLARIS_CATALOGOS=1 (a sabiendas:
 * entonces salen a internet el título, los autores y el ISBN, nunca el texto).
 */
export const ANFITRIONES_CATALOGOS = [
  'api.openalex.org', 'api.crossref.org', 'api.datacite.org', 'openlibrary.org', 'covers.openlibrary.org', 'www.wikidata.org', 'query.wikidata.org',
  '.wikipedia.org', 'www.googleapis.com', 'books.google.com', 'export.arxiv.org', 'arxiv.org', 'doi.org',
];

export function esUrlLocal(url: string, permitidos: string[] = []): boolean {
  try { return esAnfitrionLocal(new URL(url).hostname, permitidos); } catch { return false; }
}

/** Deduce el dialecto por la URL cuando no se dice. */
export function deducirSabor(url: string): SaborServidor {
  try {
    const u = new URL(url);
    if (u.port === '11434' || /ollama/i.test(u.hostname)) return 'ollama';
    if (u.port === '8811' || /inferbox/i.test(u.hostname)) return 'inferbox';
    if (u.port === '1234' || /lmstudio/i.test(u.hostname)) return 'lmstudio';
    if (/vllm/i.test(u.hostname)) return 'vllm';
    if (u.port === '8080' || /llama/i.test(u.hostname)) return 'llamacpp';
  } catch { /* URL rara: genérico */ }
  return 'generico';
}

export interface ConfiguracionSinConexion extends ConfigCompatible {
  permitidos: string[];
}

/** Lee el entorno y comprueba que todas las URLs son locales. Lanza si algo saldría a internet. */
export function configuracionSinConexion(env: EntornoSinConexion): ConfiguracionSinConexion {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const url = s(env.INFERENCIA_URL) ?? s(env.INFERBOX_URL);
  if (!url) throw new Error('Modo sin conexión: falta INFERENCIA_URL (el servidor de inferencia propio: Ollama, InferBox, llama.cpp, vLLM…)');
  const permitidos = (s(env.SCHOLARIS_SIN_CONEXION_PERMITIR) ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const sabor = (s(env.INFERENCIA_SABOR) as SaborServidor | undefined) ?? (s(env.INFERENCIA_URL) ? deducirSabor(url) : 'inferbox');
  const urlTranscripcion = s(env.INFERENCIA_TRANSCRIPCION_URL);
  const urlReordenador = s(env.INFERENCIA_REORDENADOR_URL);
  const urlEmbebedor = s(env.INFERENCIA_EMBEBEDOR_URL);
  for (const [nombre, u] of [['INFERENCIA_URL', url], ['INFERENCIA_TRANSCRIPCION_URL', urlTranscripcion], ['INFERENCIA_REORDENADOR_URL', urlReordenador], ['INFERENCIA_EMBEBEDOR_URL', urlEmbebedor]] as const) {
    if (u && !esUrlLocal(u, permitidos)) {
      throw new Error(`Modo sin conexión: ${nombre}=${u} no es una dirección local. Usa localhost, una IP privada o un nombre de la red de casa (o añádelo a SCHOLARIS_SIN_CONEXION_PERMITIR si sabes lo que haces).`);
    }
  }
  const dims = Number(s(env.INFERENCIA_DIMS));
  const concurrencia = Number(s(env.INFERENCIA_CONCURRENCIA));
  const clave = s(env.INFERENCIA_CLAVE) ?? s(env.INFERBOX_API_KEY) ?? s(env.INFERBOX_KEY);
  return {
    url, sabor, permitidos,
    ...(clave ? { clave } : {}),
    ...(urlTranscripcion ? { urlTranscripcion } : {}),
    ...(urlReordenador ? { urlReordenador } : {}),
    ...(urlEmbebedor ? { urlEmbebedor } : {}),
    ...(Number.isFinite(dims) && dims > 0 ? { dims } : {}),
    ...(Number.isFinite(concurrencia) && concurrencia > 0 ? { concurrencia } : {}),
    modelos: {
      ...(s(env.INFERENCIA_MODELO_LECTOR) ? { lector: s(env.INFERENCIA_MODELO_LECTOR) } : {}),
      ...(s(env.INFERENCIA_MODELO_REDACTOR) ? { redactor: s(env.INFERENCIA_MODELO_REDACTOR) } : {}),
      ...(s(env.INFERENCIA_MODELO_JUEZ) ? { juez: s(env.INFERENCIA_MODELO_JUEZ) } : {}),
      ...(s(env.INFERENCIA_MODELO_EMBEBEDOR) ? { embebedor: s(env.INFERENCIA_MODELO_EMBEBEDOR) } : {}),
      ...(s(env.INFERENCIA_MODELO_REORDENADOR) ? { reordenador: s(env.INFERENCIA_MODELO_REORDENADOR) } : {}),
      ...(s(env.INFERENCIA_MODELO_TRANSCRIPTOR) ? { transcriptor: s(env.INFERENCIA_MODELO_TRANSCRIPTOR) } : {}),
    },
  };
}

export interface OpcionesSinConexion {
  contador?: ContadorUso;
  onUso?: ConfigCompatible['onUso'];
  fetch?: typeof fetch;
  signal?: AbortSignal;
  rasterizar?: ConfigCompatible['rasterizar'];
}

/** La `Inteligencia` entera sobre el servidor propio. Nada de nube. */
export function crearInteligenciaSinConexion(env: EntornoSinConexion, o: OpcionesSinConexion = {}): Inteligencia & { contador: ContadorUso; cliente: ClienteCompatible } {
  const cfg = configuracionSinConexion(env);
  const contador = o.contador ?? new ContadorUso();
  if (o.onUso) contador.escuchar(o.onUso);
  const cliente = crearOpenAICompatible({
    ...cfg, contador,
    ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.signal ? { signal: o.signal } : {}), ...(o.rasterizar ? { rasterizar: o.rasterizar } : {}),
  });
  const embebedor = cliente.embebedor();
  return {
    lector: cliente.lector(),
    embebedor,
    transcriptor: cliente.transcriptor(),
    reordenador: cliente.reordenador({ embebedor }),
    juez: cliente.juez(),
    redactor: cliente.redactor(),
    contador,
    cliente,
  };
}
