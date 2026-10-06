/**
 * Verificación del token de sesión de Clerk con sus claves públicas (JWKS),
 * sin SDK y sin red en cada petición (jose cachea el JWKS). El plan sale SOLO
 * del token: la función «scholaris» (claim `fea`, metadatos públicos o de
 * organización) es el plan Pro, igual que en el backend de Python
 * (`auth_service.py`).
 */
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import type { Plan } from '@scholaris/contrato';

export interface ConfigClerk {
  publishableKey: string;
  /** Emisor explícito (https://clerk.midominio.com); si no, se deduce de la clave publicable. */
  emisor?: string;
  /** Orígenes admitidos en `azp`. Vacío = no se comprueba. */
  origenes?: string[];
  /** JWKS en JSON para verificar sin red (pruebas, o para no depender de Clerk en cada arranque). */
  jwks?: string;
  /** Caché compartida (en Cloudflare, la Cache API de la ubicación): un aislamiento nuevo no va a Clerk por el JWKS. */
  cache?: { leer(clave: string): Promise<string | null>; guardar(clave: string, valor: string, segundos: number): Promise<void> };
}

export interface IdentidadClerk {
  id: string;
  correo: string;
  nombre: string;
  imagen?: string;
  plan: Plan;
  funciones: string[];
  sesion?: string;
}

/** «pk_live_Y2xlcmsuZXhhbXBsZS5jb20k» → «https://clerk.example.com». */
export function emisorDesdeClave(publishableKey: string): string {
  const partes = publishableKey.split('_');
  const cod = partes.slice(2).join('_');
  if (!cod) throw new Error('Clave publicable de Clerk no válida');
  const dominio = atob(cod.replace(/-/g, '+').replace(/_/g, '/')).replace(/\$$/, '');
  return `https://${dominio}`;
}

const SUSCRIPCION_ACTIVA = new Set(['active', 'trialing', 'paid', 'scholaris']);

/** Extrae las funciones (features) de los claims, como el backend antiguo. */
export function funcionesDesdeClaims(p: Record<string, unknown>): string[] {
  const f = new Set<string>();
  const fea = p.fea;
  if (Array.isArray(fea)) for (const x of fea) f.add(String(x));
  else if (typeof fea === 'string') {
    // Formato de Clerk Billing: «u:scholaris,o:otra» o «u:scholaris»
    for (const trozo of fea.split(',')) {
      const nombre = trozo.trim().replace(/^[uo]:/, '');
      if (nombre) f.add(nombre);
    }
  }
  const leerLista = (o: unknown) => {
    if (o && typeof o === 'object' && Array.isArray((o as { features?: unknown }).features)) {
      for (const x of (o as { features: unknown[] }).features) f.add(String(x));
    }
  };
  leerLista(p.metadata);
  leerLista(p.public_metadata);
  const pub = p.public_metadata as Record<string, unknown> | undefined;
  if (pub && SUSCRIPCION_ACTIVA.has(String(pub.subscription))) f.add('scholaris');
  const orgs = p.o;
  if (orgs && typeof orgs === 'object') for (const v of Object.values(orgs as Record<string, unknown>)) leerLista(v);
  if (p.plan === 'paid' || p.plan === 'scholaris') f.add('scholaris');
  if (typeof p.pla === 'string' && /(^|:)scholaris/.test(p.pla)) f.add('scholaris');
  if (SUSCRIPCION_ACTIVA.has(String(p.subscription))) f.add('scholaris');
  return [...f];
}

export function planDesdeFunciones(funciones: string[]): Plan {
  return funciones.some((x) => x.toLowerCase().includes('scholaris')) ? 'pro' : 'gratis';
}

export function crearVerificadorClerk(cfg: ConfigClerk) {
  const emisor = (cfg.emisor ?? emisorDesdeClave(cfg.publishableKey)).replace(/\/$/, '');
  // Las claves se guardan ya resueltas (no una promesa compartida entre peticiones,
  // que en Workers puede quedarse colgada); se vuelven a pedir cada hora o si llega un kid nuevo.
  let local = cfg.jwks ? createLocalJWKSet(JSON.parse(cfg.jwks) as JSONWebKeySet) : null;
  let pedidas = 0;
  const claveCache = `jwks:${emisor}`;
  const refrescar = async (desdeCache = true) => {
    const enCache = desdeCache && cfg.cache ? await cfg.cache.leer(claveCache).catch(() => null) : null;
    if (enCache) {
      local = createLocalJWKSet(JSON.parse(enCache) as JSONWebKeySet);
      pedidas = Date.now();
      return;
    }
    const r = await fetch(`${emisor}/.well-known/jwks.json`);
    if (!r.ok) throw new Error(`JWKS de Clerk: ${r.status}`);
    const texto = await r.text();
    local = createLocalJWKSet(JSON.parse(texto) as JSONWebKeySet);
    pedidas = Date.now();
    if (cfg.cache) await cfg.cache.guardar(claveCache, texto, 3600).catch(() => undefined);
  };
  const jwks: Parameters<typeof jwtVerify>[1] = async (cabecera, token) => {
    if (!cfg.jwks && (!local || Date.now() - pedidas > 3600_000)) await refrescar();
    try {
      return await (local as ReturnType<typeof createLocalJWKSet>)(cabecera, token);
    } catch (e) {
      if (cfg.jwks || Date.now() - pedidas < 30_000) throw e;
      // Un kid nuevo (rotación): directo a Clerk, sin la caché.
      await refrescar(false);
      return (local as ReturnType<typeof createLocalJWKSet>)(cabecera, token);
    }
  };
  return async function verificar(token: string): Promise<IdentidadClerk | null> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks, { issuer: emisor, algorithms: ['RS256'], clockTolerance: 10 }));
    } catch {
      return null;
    }
    const p = payload as Record<string, unknown>;
    if (typeof p.sub !== 'string' || !p.sub) return null;
    if (cfg.origenes?.length && typeof p.azp === 'string' && !cfg.origenes.includes(p.azp)) return null;
    const funciones = funcionesDesdeClaims(p);
    const correo = String(p.email ?? p.user_email ?? p.correo ?? '');
    const nombre = String(p.name ?? p.user_name ?? p.full_name ?? (correo || p.sub));
    return {
      id: p.sub,
      correo,
      nombre,
      imagen: typeof p.image_url === 'string' ? p.image_url : typeof p.picture === 'string' ? p.picture : undefined,
      plan: planDesdeFunciones(funciones),
      funciones,
      sesion: typeof p.sid === 'string' ? p.sid : undefined,
    };
  };
}
export type VerificadorClerk = ReturnType<typeof crearVerificadorClerk>;
