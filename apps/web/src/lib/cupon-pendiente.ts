/**
 * Un cupón que espera a la cuenta: llega en un enlace «/?cupon=SCHO-XXXX-XXXX»,
 * se guarda en el navegador (y se quita de la URL), se pide entrar o
 * registrarse, y al volver con sesión se canjea solo.
 */
const CLAVE = 'scholaris:cupon-pendiente';

/** Forma canónica, o null si no puede ser un cupón (mismo alfabeto que el servidor). */
export function normalizarCupon(bruto: string): string | null {
  let s = String(bruto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('SCHO')) s = s.slice(4);
  if (!/^[ACDEFGHJKMNPQRTUVWXY2346789]{8}$/.test(s)) return null;
  return `SCHO-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Lee «?cupon=» de la URL una vez al arrancar, lo guarda y limpia la dirección. */
export function capturarCuponDeLaUrl(): void {
  try {
    const url = new URL(window.location.href);
    const bruto = url.searchParams.get('cupon');
    if (bruto === null) return;
    const c = normalizarCupon(bruto);
    if (c) localStorage.setItem(CLAVE, c);
    url.searchParams.delete('cupon');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch { /* sin almacenamiento: el enlace simplemente no se recuerda */ }
}

export function cuponPendiente(): string | null {
  try { return localStorage.getItem(CLAVE); } catch { return null; }
}

export function olvidarCuponPendiente(): void {
  try { localStorage.removeItem(CLAVE); } catch { /* nada */ }
}
