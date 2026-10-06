/**
 * Conversor del servidor en un Cloudflare Container: la imprenta de Node con
 * ffmpeg, canvas y LibreOffice (apps/local/src/conversor.ts, imagen en
 * deploy/contenedor/Dockerfile). Lo usa el Workflow cuando un fichero llega
 * sin paquete del navegador. Si no está activo, la conversión de reserva
 * mínima (compartido/reserva.ts) sigue funcionando.
 */
import { Container, getRandom } from '@cloudflare/containers';
import { conversorRemoto, recortadorRemoto } from '../compartido/conversor-remoto.js';
import type { Env } from './env.js';

export class Conversor extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '10m';
}

/** El conversor del contenedor, si está desplegado y activo. */
export function conversorCF(env: Env) {
  if (!env.CONVERSOR || env.CONVERSOR_ACTIVO !== '1') return undefined;
  const ns = env.CONVERSOR;
  return conversorRemoto(async (r) => (await getRandom(ns, Number(env.CONVERSOR_INSTANCIAS ?? 3))).fetch(r));
}

/** El recortador del contenedor (la misma imagen): recortes de figuras para sus vectores. */
export function recortadorCF(env: Env) {
  if (!env.CONVERSOR || env.CONVERSOR_ACTIVO !== '1') return undefined;
  const ns = env.CONVERSOR;
  return recortadorRemoto(async (r) => (await getRandom(ns, Number(env.CONVERSOR_INSTANCIAS ?? 3))).fetch(r));
}
