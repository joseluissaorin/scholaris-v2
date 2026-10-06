/**
 * Montaje de los puertos de Cloudflare a partir de los bindings. Lo usan el
 * Worker (la puerta), el Durable Object de cada usuario y el Workflow.
 */
import type { Emisor, IndiceVectorial, Inteligencia } from '@scholaris/nucleo';
import type { EventoTiempoReal } from '@scholaris/contrato';
import { crearInteligencia, type EntornoInteligencia } from '@scholaris/proveedores';
import type { AlmacenAmpliado, ConfigInstancia } from '../puertos.js';
import { Cuentas } from '../compartido/cuentas.js';
import { VERSION } from '../version.js';
import type { Env } from './env.js';
import { crearAlmacenR2, TAM_PARTE } from './almacen-r2.js';
import { crearIndiceVectorize, espacioNombresDe } from './indice-vectorize.js';
import { SqlD1 } from './sql.js';
import { nombresCanal } from './tarea-do.js';

export function origenDe(env: Env, peticion?: Request): string {
  return (env.ORIGEN_PUBLICO || (peticion ? new URL(peticion.url).origin : 'https://localhost')).replace(/\/$/, '');
}

export function configDesdeEnv(env: Env, origen: string): ConfigInstancia {
  return {
    modo: 'nube',
    version: VERSION,
    origen,
    ...(env.CLERK_PUBLISHABLE_KEY ? { clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY } : {}),
    requiereAutenticacion: true,
    conversionServidor: true,
    mcp: true,
    inferbox: false,
    bytesMaximos: 4 * 1024 * 1024 * 1024,
    tamParte: TAM_PARTE,
    espacioNombres: espacioNombresDe,
  };
}

export function almacenDesdeEnv(env: Env, origen: string): AlmacenAmpliado {
  return crearAlmacenR2(env.BUCKET, {
    secreto: env.SECRETO,
    origen,
    ...(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.CLOUDFLARE_ACCOUNT_ID
      ? { s3: { endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`, bucket: env.R2_BUCKET_NAME ?? 'scholaris', accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } }
      : {}),
  });
}

export function cuentasDesdeEnv(env: Env): Cuentas {
  return new Cuentas(new SqlD1(env.DB), env.CLAVE_MAESTRA || env.SECRETO);
}

/** El entorno de la inteligencia: claves de la instancia + las propias del usuario. */
export function entornoInteligencia(env: Env, propias: Partial<Record<string, string>> = {}): EntornoInteligencia {
  const gateway = env.AI_GATEWAY && env.CLOUDFLARE_ACCOUNT_ID
    ? `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AI_GATEWAY}/google-ai-studio`
    : undefined;
  return {
    GEMINI_API_KEY: propias.gemini ?? env.GEMINI_API_KEY,
    // Con clave propia también por el gateway: la caché y los registros son por cuenta.
    ...(gateway ? { GEMINI_BASE_URL: gateway } : {}),
    OPENROUTER_API_KEY: propias.openrouter ?? env.OPENROUTER_API_KEY,
    TYPESAFE_API_KEY: propias.typesafe ?? env.TYPESAFE_API_KEY,
    AI: env.AI as unknown as EntornoInteligencia['AI'],
  };
}

const cacheIA = new Map<string, { ia: Inteligencia; hasta: number }>();

/** Inteligencia del usuario, cacheada 10 minutos por aislamiento. */
export async function inteligenciaPara(env: Env, cuentas: Cuentas, usuario: string): Promise<Inteligencia> {
  const hay = cacheIA.get(usuario);
  if (hay && hay.hasta > Date.now()) return hay.ia;
  const propias = await cuentas.clavesPropias(usuario).catch(() => ({}));
  const ia = crearInteligencia(entornoInteligencia(env, propias), { concurrencia: 16 });
  cacheIA.set(usuario, { ia, hasta: Date.now() + 600_000 });
  if (cacheIA.size > 200) cacheIA.delete(cacheIA.keys().next().value as string);
  return ia;
}

export function indiceDesdeEnv(env: Env, ia: Inteligencia): IndiceVectorial | null {
  if (!env.VECTORES) return null;
  const e = ia.embebedor.espacio;
  // Vectorize tiene un índice de dimensiones fijas: solo el espacio base va allí.
  return crearIndiceVectorize(env.VECTORES, e);
}

/** Emisor: cada evento va al canal del usuario y, si es de una tarea, al de la tarea. */
export function emisorDesdeEnv(env: Env, usuario: string): Emisor<EventoTiempoReal> {
  return {
    async emitir(_canal, evento) {
      await Promise.all(nombresCanal(usuario, evento).map((n) => env.TAREA.getByName(n).emitir(evento).catch((e: unknown) => console.error('emitir', n, e))));
    },
  };
}
