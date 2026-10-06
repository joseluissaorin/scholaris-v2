/**
 * Monta una `Inteligencia` (nucleo) a partir de una configuración estilo
 * entorno (`env` de un Worker o `process.env`). Lo que no tiene clave no se
 * monta; lo que falta se sustituye por la siguiente opción razonable.
 *
 * Por defecto:
 * - lector: cascada Gemini 3.8 Flash → Gemini Flash-Lite → OpenRouter (Mistral OCR) → Workers AI (Llama 4 Scout),
 *   una página por llamada y muchas a la vez (`calidadLector: 'rapida'` pone Flash-Lite delante)
 * - embebedor: Gemini Embedding 2 @1536 (+ Qwen3-VL de InferBox como espacio extra si hay INFERBOX_URL)
 * - transcriptor: Whisper large-v3-turbo de Workers AI; Gemini 3.5 Transcribe si se piden hablantes o si Whisper falla
 * - reordenador y juez: Jev
 * - redactor: Gemini (Flash-Lite / Flash), con OpenRouter de reserva
 *
 * Con SCHOLARIS_SIN_CONEXION=1 nada de lo anterior: todo va al servidor de
 * inferencia propio de INFERENCIA_URL (ver sin-conexion.ts) y las claves de
 * nube se ignoran aunque estén puestas.
 */

import type { Inteligencia, Juez, Lector, Redactor, Reordenador, Transcriptor } from '@scholaris/nucleo';
import { ContadorUso, type UsoProveedor } from './comun.js';
import { crearGemini, MODELOS_GEMINI, type LotesLectura } from './gemini.js';
import { crearWorkersAI, type BindingAI } from './workersai.js';
import { crearOpenRouter } from './openrouter.js';
import { crearJev } from './jev.js';
import { crearInferBox } from './inferbox.js';
import { cascadaLectores, type OpcionesCascada } from './cascada.js';
import { crearInteligenciaSinConexion, modoSinConexion } from './sin-conexion.js';
import type { ConfigCompatible } from './compatible.js';

/** Variables que se leen. Todas opcionales. */
export interface EntornoInteligencia {
  GEMINI_API_KEY?: string;
  /** Base de Gemini (AI Gateway: https://gateway.ai.cloudflare.com/v1/<cuenta>/<gateway>/google-ai-studio). */
  GEMINI_BASE_URL?: string;
  /** Modelo del lector principal (por defecto el elegido con el banco). */
  GEMINI_LECTOR_MODELO?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  TYPESAFE_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  /** Binding `env.AI` dentro de un Worker. */
  AI?: BindingAI;
  INFERBOX_URL?: string;
  INFERBOX_API_KEY?: string;
  INFERBOX_KEY?: string;
  [otra: string]: unknown;
}

export interface OpcionesInteligencia {
  /** Se llama con el coste de cada petición, de cualquier proveedor. */
  onUso?: (u: UsoProveedor) => void;
  /** Contador compartido (si no, se crea uno y se devuelve). */
  contador?: ContadorUso;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Peticiones simultáneas por proveedor. */
  concurrencia?: number;
  /** Aviso cuando la cascada de lectores pasa páginas al siguiente. */
  alPasarLector?: OpcionesCascada['alPasar'];
  /**
   * «alta» (por defecto): Gemini 3.8 Flash primero (el más fiel). «rapida»: Flash-Lite primero
   * (casi 3 veces más rápido, mismo resultado en PDF digitales). La otra queda de reserva.
   */
  calidadLector?: 'alta' | 'rapida';
  /** Modo económico: añade `lotes` (Batch API de Gemini, 50 %) y `lectorEconomico` (Workers AI). */
  lotes?: boolean;
  /** Usar InferBox para el embebedor extra (por defecto, sí si hay URL). */
  inferboxExtra?: boolean;
  /** Sin conexión: PDF → imágenes de página para el lector de visión local. */
  rasterizar?: ConfigCompatible['rasterizar'];
}

export type InteligenciaConUso = Inteligencia & { contador: ContadorUso; lotes?: LotesLectura; lectorEconomico?: Lector };

export function crearInteligencia(env: EntornoInteligencia, opciones: OpcionesInteligencia = {}): InteligenciaConUso {
  if (modoSinConexion(env)) {
    return crearInteligenciaSinConexion(env, {
      ...(opciones.contador ? { contador: opciones.contador } : {}), ...(opciones.onUso ? { onUso: opciones.onUso } : {}),
      ...(opciones.fetch ? { fetch: opciones.fetch } : {}), ...(opciones.signal ? { signal: opciones.signal } : {}),
      ...(opciones.rasterizar ? { rasterizar: opciones.rasterizar } : {}),
    });
  }
  const contador = opciones.contador ?? new ContadorUso();
  if (opciones.onUso) contador.escuchar(opciones.onUso);
  const comunes = { contador, ...(opciones.fetch ? { fetch: opciones.fetch } : {}), ...(opciones.signal ? { signal: opciones.signal } : {}), ...(opciones.concurrencia ? { concurrencia: opciones.concurrencia } : {}) };
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  const gemini = s(env.GEMINI_API_KEY) ? crearGemini({ clave: s(env.GEMINI_API_KEY) as string, ...(s(env.GEMINI_BASE_URL) ? { baseUrl: s(env.GEMINI_BASE_URL) } : {}), ...comunes }) : undefined;
  const openrouter = s(env.OPENROUTER_API_KEY) ? crearOpenRouter({ clave: s(env.OPENROUTER_API_KEY) as string, ...(s(env.OPENROUTER_BASE_URL) ? { baseUrl: s(env.OPENROUTER_BASE_URL) } : {}), ...comunes }) : undefined;
  const workers = env.AI
    ? crearWorkersAI({ binding: env.AI, ...comunes })
    : s(env.CLOUDFLARE_ACCOUNT_ID) && s(env.CLOUDFLARE_API_TOKEN)
      ? crearWorkersAI({ cuenta: s(env.CLOUDFLARE_ACCOUNT_ID) as string, token: s(env.CLOUDFLARE_API_TOKEN) as string, ...comunes })
      : undefined;
  const jev = s(env.TYPESAFE_API_KEY) ? crearJev({ clave: s(env.TYPESAFE_API_KEY) as string, ...comunes }) : undefined;
  const claveIB = s(env.INFERBOX_API_KEY) ?? s(env.INFERBOX_KEY);
  const inferbox = s(env.INFERBOX_URL) && claveIB ? crearInferBox({ url: s(env.INFERBOX_URL) as string, clave: claveIB, ...comunes }) : undefined;

  // Lector: cascada.
  const lectores: Lector[] = [];
  if (gemini) {
    const rapida = opciones.calidadLector === 'rapida';
    const principal = s(env.GEMINI_LECTOR_MODELO) ?? (rapida ? MODELOS_GEMINI.lectorRapido : MODELOS_GEMINI.lector);
    const reserva = principal === MODELOS_GEMINI.lector ? MODELOS_GEMINI.lectorRapido : MODELOS_GEMINI.lector;
    lectores.push(gemini.lector({ modelo: principal }), gemini.lector({ modelo: reserva }));
  }
  if (openrouter) lectores.push(openrouter.lector({ motor: 'mistral-ocr' }));
  if (workers) lectores.push(workers.lector());
  if (!lectores.length) throw new Error('crearInteligencia: no hay ningún lector (hace falta GEMINI_API_KEY, OPENROUTER_API_KEY o Workers AI; o SCHOLARIS_SIN_CONEXION=1 con INFERENCIA_URL)');
  const lector = lectores.length === 1 ? (lectores[0] as Lector) : cascadaLectores(lectores, opciones.alPasarLector ? { alPasar: opciones.alPasarLector } : {});

  // Embebedor.
  const embebedorIB = inferbox && opciones.inferboxExtra !== false ? inferbox.embebedor() : undefined;
  const embebedor = gemini?.embebedor() ?? embebedorIB ?? workers?.embebedor();
  if (!embebedor) throw new Error('crearInteligencia: no hay embebedor (hace falta GEMINI_API_KEY, Workers AI o InferBox)');
  const embebedoresExtra = embebedorIB && embebedor !== embebedorIB ? [embebedorIB] : undefined;

  // Transcriptor.
  const transcriptores = { whisper: workers?.transcriptor(), gemini: gemini?.transcriptor(), inferbox: inferbox?.transcriptor() };
  const transcriptor = transcriptorEnrutado(transcriptores);

  // Reordenador y juez.
  const reordenador: Reordenador = jev?.reordenador() ?? workers?.reordenador({ modelo: '@cf/baai/bge-m3' }) ?? inferbox?.reordenador() ?? faltante<Reordenador>('reordenador', 'TYPESAFE_API_KEY');
  const juez: Juez = jev?.juez() ?? faltante<Juez>('juez', 'TYPESAFE_API_KEY');

  // Redactor.
  // La reserva del redactor tiene un plazo corto: está en el camino crítico de la ingesta.
  const openrouterRedactor = s(env.OPENROUTER_API_KEY)
    ? crearOpenRouter({ clave: s(env.OPENROUTER_API_KEY) as string, ...(s(env.OPENROUTER_BASE_URL) ? { baseUrl: s(env.OPENROUTER_BASE_URL) } : {}), ...comunes, timeoutMs: 15_000, intentos: 2 })
    : undefined;
  const redactores = [gemini?.redactor(), openrouterRedactor?.redactor(), inferbox?.redactor()].filter(Boolean) as Redactor[];
  const redactor: Redactor = redactores.length > 1 ? redactorConReserva(redactores) : redactores[0] ?? faltante<Redactor>('redactor', 'GEMINI_API_KEY');

  return {
    lector, embebedor, transcriptor, reordenador, juez, redactor, contador,
    ...(opciones.lotes && gemini ? { lotes: gemini.lotes() } : {}),
    ...(opciones.lotes && workers ? { lectorEconomico: workers.lector() } : {}),
    ...(embebedoresExtra ? { embebedoresExtra } : {}),
  };
}

/** Whisper (barato) para lo normal; Gemini Transcribe cuando se piden hablantes o si Whisper falla. */
export function transcriptorEnrutado(t: { whisper?: Transcriptor; gemini?: Transcriptor; inferbox?: Transcriptor }): Transcriptor {
  const orden = [t.whisper, t.gemini, t.inferbox].filter(Boolean) as Transcriptor[];
  if (!orden.length) return faltante<Transcriptor>('transcriptor', 'CLOUDFLARE_API_TOKEN o GEMINI_API_KEY');
  return {
    nombre: orden.map((x) => x.nombre).join(' | '),
    async transcribir(audio, opciones = {}) {
      const lista = opciones.hablantes && t.gemini ? [t.gemini, ...orden.filter((x) => x !== t.gemini)] : orden;
      let ultimo: unknown;
      for (const tr of lista) {
        try { return await tr.transcribir(audio, opciones); } catch (e) { ultimo = e; }
      }
      throw ultimo;
    },
  };
}

export function redactorConReserva(redactores: Redactor[]): Redactor {
  return {
    nombre: redactores.map((r) => r.nombre).join(' | '),
    async generar(pet) {
      let ultimo: unknown;
      for (const r of redactores) {
        try { return await r.generar(pet); } catch (e) { ultimo = e; }
      }
      throw ultimo;
    },
  };
}

function faltante<T>(pieza: string, variable: string): T {
  const fallo = () => { throw new Error(`crearInteligencia: no hay ${pieza} (falta ${variable})`); };
  return new Proxy({ nombre: `sin-${pieza}` }, {
    get: (obj, prop) => (prop === 'nombre' ? obj.nombre : prop === 'then' ? undefined : fallo),
  }) as unknown as T;
}
