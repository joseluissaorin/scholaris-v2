/**
 * Montaje de los puertos de Cloudflare a partir de los bindings. Lo usan el
 * Worker (la puerta), el Durable Object de cada usuario y el Workflow.
 */
import type { Emisor, IndiceVectorial, Inteligencia, SQL } from '@scholaris/nucleo';
import { IndiceVectorialSQL } from '@scholaris/busqueda';
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
    youtube: !!env.GEMINI_API_KEY,
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

type FabricaIA = (env: Env, propias: Partial<Record<string, string>>, o?: { economico?: boolean }) => Inteligencia;
let fabrica: FabricaIA = (env, propias, o = {}) => crearInteligencia(entornoInteligencia(env, propias), {
  concurrencia: 16,
  // Modo económico: Batch API de Gemini para lo difícil y Workers AI (env.AI) para lo fácil.
  ...(o.economico ? { lotes: true } : {}),
  alPasarLector: (i) => console.log(JSON.stringify({ que: 'cascada', ...i })),
});

/** Sustituye cómo se crea la inteligencia (pruebas con puertos falsos). */
export function establecerFabricaInteligencia(f: FabricaIA): void {
  fabrica = f;
  cacheIA.clear();
}

/** Clave y base de Gemini del usuario (para YouTube por URL). */
export async function geminiPara(env: Env, cuentas: Cuentas, usuario: string): Promise<{ clave: string; baseUrl?: string } | undefined> {
  const propias = await cuentas.clavesPropias(usuario).catch(() => ({} as Record<string, string>));
  const e = entornoInteligencia(env, propias);
  const clave = typeof e.GEMINI_API_KEY === 'string' ? e.GEMINI_API_KEY : undefined;
  return clave ? { clave, ...(typeof e.GEMINI_BASE_URL === 'string' ? { baseUrl: e.GEMINI_BASE_URL } : {}) } : undefined;
}

/** Inteligencia del usuario, cacheada 10 minutos por aislamiento. */
export async function inteligenciaPara(env: Env, cuentas: Cuentas, usuario: string, o: { sinCache?: boolean; economico?: boolean } = {}): Promise<Inteligencia> {
  if (o.economico) return fabrica(env, await cuentas.clavesPropias(usuario).catch(() => ({})), { economico: true });
  const hay = o.sinCache ? undefined : cacheIA.get(usuario);
  if (hay && hay.hasta > Date.now()) return hay.ia;
  if (o.sinCache) return fabrica(env, await cuentas.clavesPropias(usuario).catch(() => ({})));
  const propias = await cuentas.clavesPropias(usuario).catch(() => ({}));
  const ia = fabrica(env, propias);
  cacheIA.set(usuario, { ia, hasta: Date.now() + 600_000 });
  if (cacheIA.size > 200) cacheIA.delete(cacheIA.keys().next().value as string);
  return ia;
}

export function indiceDesdeEnv(env: Env, ia: Inteligencia, sql?: SQL): IndiceVectorial | null {
  // Sin Vectorize (pruebas, cuentas sin el producto): búsqueda densa sobre la propia estantería.
  if (!env.VECTORES) return sql ? new IndiceVectorialSQL(sql, ia.embebedor.espacio) : null;
  const e = ia.embebedor.espacio;
  // Vectorize tiene un índice de dimensiones fijas: solo el espacio base va allí.
  const cupo = env.LIMITADOR.getByName('cupo:vectorize');
  return crearIndiceVectorize(env.VECTORES, e, {
    turno: async (n) => { const ms = await cupo.turnoVectorial(n); if (ms > 0) await new Promise((r) => setTimeout(r, Math.min(ms, 120_000))); },
    frenar: () => cupo.frenarVectorial(),
  });
}

/** Emisor: cada evento va al canal del usuario y, si es de una tarea, al de la tarea. */
export function emisorDesdeEnv(env: Env, usuario: string): Emisor<EventoTiempoReal> {
  return {
    async emitir(_canal, evento) {
      await Promise.all(nombresCanal(usuario, evento).map((n) => env.TAREA.getByName(n).emitir(evento).catch((e: unknown) => console.error('emitir', n, e))));
    },
  };
}
