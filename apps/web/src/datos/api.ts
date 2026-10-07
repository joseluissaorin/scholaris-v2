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
  if (fn) { sesionLista?.(); sesionLista = null; }
}

/*
 * Con Clerk, las peticiones que salen antes de que haya sesión (la precarga del
 * lector desde un enlace directo) esperan aquí al token en vez de salir sin él:
 * así se piden en cuanto Clerk responde, sin esperar a que se monte la pantalla.
 */
let esperaSesion: Promise<void> | null = null;
let sesionLista: (() => void) | null = null;
export function esperarSesion() {
  if (proveedorToken || esperaSesion) return;
  esperaSesion = new Promise<void>((r) => { sesionLista = r; });
}

async function tokenActual(): Promise<string | null> {
  if (!proveedorToken && esperaSesion) await esperaSesion;
  return (await proveedorToken?.()) ?? tokenLocal();
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

/**
 * Local con varias personas (SCHOLARIS_USUARIOS): cada una entra con su token,
 * que llega una vez por `?token=` y se queda en este navegador.
 */
function tokenLocal(): string | null {
  try {
    const u = new URL(location.href);
    const t = u.searchParams.get('token');
    if (t && !u.pathname.startsWith('/invitaciones')) {
      localStorage.setItem('scholaris.token', t);
      u.searchParams.delete('token');
      history.replaceState(history.state, '', u.toString());
    }
    return localStorage.getItem('scholaris.token');
  } catch { return null; }
}

let arranque: Promise<ConfigPublica> | null = null;

const CLAVE_CONFIG = 'scholaris.config';
const VIDA_CONFIG = 7 * 24 * 3600_000;

/** La configuración de la última visita a esta misma API (y de esta misma web), si es reciente. */
function configGuardada(base: string): ConfigPublica | null {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE_CONFIG) ?? 'null') as { base: string; web: string; t: number; config: ConfigPublica } | null;
    if (!g || g.base !== base || g.web !== import.meta.env.MODE || Date.now() - g.t > VIDA_CONFIG) return null;
    return g.config?.modo ? g.config : null;
  } catch { return null; }
}

function guardarConfig(base: string, config: ConfigPublica): void {
  try { localStorage.setItem(CLAVE_CONFIG, JSON.stringify({ base, web: import.meta.env.MODE, t: Date.now(), config })); } catch { /* sin almacenamiento */ }
}

/** Lee `/config` (sin autenticar) y deja el cliente listo. */
export function arrancar(): Promise<ConfigPublica> {
  arranque ??= (async () => {
    const base = (import.meta.env.VITE_API as string | undefined) ?? '';
    if (!quiereSimulado()) {
      const real = crearCliente({ base, token: tokenActual });
      // La configuración no cambia entre despliegues: la de la última visita deja arrancar a Clerk
      // y a la primera sección ya (un viaje menos, ~100 ms), y se renueva por detrás para la próxima.
      const guardada = configGuardada(base);
      if (guardada) {
        cliente = real;
        void real.config().then((c) => guardarConfig(base, c)).catch(() => undefined);
        return guardada;
      }
      try {
        const config = await real.config();
        cliente = real;
        guardarConfig(base, config);
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
