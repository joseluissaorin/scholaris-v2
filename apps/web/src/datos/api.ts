/**
 * El cliente de la API: siempre el de `@scholaris/contrato`. Si no hay API a la
 * vista (desarrollo sin `apps/api`, demostraciones) se le pasa un `fetch`
 * simulado que responde las mismas rutas. Las pantallas no distinguen.
 */
import { crearCliente, type ClienteScholaris, type ConfigPublica, type EventoTiempoReal } from '@scholaris/contrato';

let cliente: ClienteScholaris | null = null;
let simulado = false;
let proveedorToken: (() => Promise<string | null>) | null = null;
let escucharSimulado: ((o: (e: EventoTiempoReal) => void) => () => void) | null = null;

/** La sesión (Clerk) registra aquí cómo obtener el token. */
export function ponerProveedorToken(fn: (() => Promise<string | null>) | null) {
  proveedorToken = fn;
}

export function api(): ClienteScholaris {
  if (!cliente) throw new Error('La API aún no está lista');
  return cliente;
}

export const esSimulado = () => simulado;

function quiereSimulado(): boolean {
  if (import.meta.env.VITE_FUENTE === 'simulada') return true;
  try { return new URLSearchParams(location.search).has('demostracion') || sessionStorage.getItem('scholaris.demostracion') === '1'; } catch { return false; }
}

let arranque: Promise<ConfigPublica> | null = null;

/** Lee `/config` (sin autenticar) y deja el cliente listo. */
export function arrancar(): Promise<ConfigPublica> {
  arranque ??= (async () => {
    const base = (import.meta.env.VITE_API as string | undefined) ?? '';
    if (!quiereSimulado()) {
      const real = crearCliente({ base, token: () => proveedorToken?.() ?? null });
      try {
        const config = await real.config();
        cliente = real;
        return config;
      } catch (e) {
        // En producción, sin API no hay demostración que valga salvo que se pida.
        if (import.meta.env.PROD || import.meta.env.VITE_FUENTE === 'remota') throw e;
      }
    }
    const sim = await import('./simulada/servidor');
    try { sessionStorage.setItem('scholaris.demostracion', '1'); } catch { /* sin almacenamiento */ }
    cliente = crearCliente({ base: '', fetch: sim.fetchSimulado });
    escucharSimulado = sim.escucharSimulado;
    simulado = true;
    return sim.configSimulada;
  })();
  return arranque;
}

/**
 * Un solo canal de tiempo real para toda la app (las tareas del usuario y sus
 * alertas). Se abre con el primer oyente y se cierra con el último.
 */
const oyentes = new Set<(e: EventoTiempoReal) => void>();
let cerrar: (() => void) | null = null;

export function escucharTiempoReal(o: (e: EventoTiempoReal) => void): () => void {
  oyentes.add(o);
  if (!cerrar) {
    const repartir = (e: EventoTiempoReal) => oyentes.forEach((x) => x(e));
    if (simulado && escucharSimulado) cerrar = escucharSimulado(repartir);
    else { const c = api().tiempoReal.conectar(repartir); cerrar = c.cerrar; }
  }
  return () => {
    oyentes.delete(o);
    if (!oyentes.size && cerrar) { cerrar(); cerrar = null; }
  };
}
