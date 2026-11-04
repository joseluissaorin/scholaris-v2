/**
 * Conversor del servidor en un Cloudflare Container: la imprenta de Node con
 * ffmpeg, canvas y LibreOffice (apps/local/src/conversor.ts, imagen en
 * deploy/contenedor/Dockerfile). Lo usa el Workflow cuando un fichero llega
 * sin paquete del navegador. Si no está activo, la conversión de reserva
 * mínima (compartido/reserva.ts) sigue funcionando.
 */
import { Container, getContainer } from '@cloudflare/containers';
import { conversorRemoto, recortadorRemoto } from '../compartido/conversor-remoto.js';
import { proxyRemoto } from '../compartido/proxy.js';
import type { Env } from './env.js';

/** Más que el plazo del paso más largo que espera al conversor: el «proxy» del Workflow (60 minutos). */
const MAX_SIN_PETICIONES_MS = 75 * 60_000;

export class Conversor extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '3m';
  private ultimaPeticion = Date.now();

  override fetch(peticion: Request): Promise<Response> {
    this.ultimaPeticion = Date.now();
    return super.fetch(peticion);
  }

  /**
   * `stop()` manda SIGTERM, y Node como proceso principal del contenedor lo
   * ignora si no tiene manejador: la instancia seguía encendida y facturando.
   * Aquí ya no hay peticiones en curso, así que se puede matar sin más.
   */
  override async onActivityExpired(): Promise<void> {
    await this.destroy();
  }

  /** Sin peticiones en curso. El contador es privado en la librería y no da otra forma de leerlo. */
  libre(): boolean {
    return !(this as unknown as { inflightRequests?: number }).inflightRequests;
  }

  /**
   * Red de seguridad: la librería no duerme la instancia mientras cuente una
   * petición en curso, y una respuesta sin cerrar la mantuvo encendida días
   * enteros. Pasado el plazo se para y se reinicia el objeto, que pone el
   * contador a cero.
   */
  override async alarm(props?: AlarmInvocationInfo): Promise<void> {
    if (this.ctx.container?.running && Date.now() - this.ultimaPeticion > MAX_SIN_PETICIONES_MS) {
      console.warn('Conversor: sin peticiones nuevas y aún «en curso»; se para la instancia');
      await this.destroy();
      this.ctx.abort('Conversor: contador de peticiones atascado');
    }
    return super.alarm(props);
  }
}

/**
 * La primera instancia sin peticiones en curso, para no despertar las demás:
 * cada una reserva 12 GiB mientras está encendida. Si todas trabajan, una al azar.
 */
export async function instanciaLibre(ns: DurableObjectNamespace<Conversor>, total: number) {
  for (let i = 0; i < total; i++) {
    const instancia = getContainer(ns, `instance-${i}`);
    if (await instancia.libre()) return instancia;
  }
  return getContainer(ns, `instance-${Math.floor(Math.random() * total)}`);
}

/** El conversor del contenedor, si está desplegado y activo. */
export function conversorCF(env: Env) {
  if (!env.CONVERSOR || env.CONVERSOR_ACTIVO !== '1') return undefined;
  const ns = env.CONVERSOR;
  return conversorRemoto(async (r) => (await instanciaLibre(ns, Number(env.CONVERSOR_INSTANCIAS ?? 3))).fetch(r));
}

/** El recortador del contenedor (la misma imagen): recortes de figuras para sus vectores. */
export function recortadorCF(env: Env) {
  if (!env.CONVERSOR || env.CONVERSOR_ACTIVO !== '1') return undefined;
  const ns = env.CONVERSOR;
  // Los recortes son pequeños y llegan en ráfagas: siempre a la misma instancia.
  return recortadorRemoto((r) => getContainer(ns, 'instance-0').fetch(r));
}

/** El proxy de un medio en el contenedor (lo que ven los modelos): `POST /proxy`. */
export function proxyCF(env: Env) {
  if (!env.CONVERSOR || env.CONVERSOR_ACTIVO !== '1') return undefined;
  const ns = env.CONVERSOR;
  return proxyRemoto(async (r) => (await instanciaLibre(ns, Number(env.CONVERSOR_INSTANCIAS ?? 3))).fetch(r));
}
