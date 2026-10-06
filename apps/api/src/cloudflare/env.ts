/**
 * Bindings del Worker (ver deploy/cloudflare/wrangler.jsonc). Se mantiene a
 * mano porque los tipos de las clases propias (DO, Workflow) vienen de aquí;
 * `pnpm --filter @scholaris/api tipos` genera la versión de wrangler para
 * comprobar que no se desvían.
 */
import type { Estanteria } from './estanteria-do.js';
import type { Tarea } from './tarea-do.js';
import type { Limitador } from './limitador-do.js';
import type { ParamsIngesta } from '../puertos.js';
import type { MensajeCola } from './cola.js';

export interface Env {
  ESTANTERIA: DurableObjectNamespace<Estanteria>;
  TAREA: DurableObjectNamespace<Tarea>;
  LIMITADOR: DurableObjectNamespace<Limitador>;
  INGESTA: Workflow<ParamsIngesta>;
  DB: D1Database;
  BUCKET: R2Bucket;
  VECTORES?: VectorizeIndex;
  COLA: Queue<MensajeCola>;
  AI?: Ai;
  ASSETS?: Fetcher;

  // Variables
  ORIGEN_PUBLICO?: string;
  ESPACIO_VECTORIAL?: string;
  DIMENSIONES?: string;
  AI_GATEWAY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_EMISOR?: string;
  CLERK_ORIGENES?: string;
  CLERK_JWKS?: string;
  /** Pruebas: sin consultas a Crossref/OpenAlex. */
  SIN_VERIFICACION?: string;
  ORIGENES_CORS?: string;
  R2_BUCKET_NAME?: string;

  // Secretos
  SECRETO: string;
  CLAVE_MAESTRA: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  TYPESAFE_API_KEY?: string;
  AI_GATEWAY_TOKEN?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  CORREO_CONTACTO?: string;
}
