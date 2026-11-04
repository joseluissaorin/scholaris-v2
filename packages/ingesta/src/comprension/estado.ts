/**
 * Estado y coste de la comprensión de un documento. Viven en la procedencia del
 * propio documento (viajan con él y se borran con él):
 *
 * - una fila «comprension» con el estado vigente (lentes, versión, instancia,
 *   error), que solo escriben el plan y el cierre, uno detrás de otro;
 * - una fila «comprension:<paso>» por cada paso terminado, con su modelo,
 *   tokens y dólares. Los pasos que corren a la vez (las tandas de fichas)
 *   solo insertan su fila: los totales se suman al leer, sin carreras.
 */
import type { Lente, SQL } from '@scholaris/nucleo';
import type { EstadoComprension, EstadoComprensionValor, UsoModelo } from './tipos.js';

const FASE = 'comprension';

type Cabecera = Omit<EstadoComprension, 'pasos' | 'usd' | 'tokensEntrada' | 'tokensSalida' | 'llamadas'> & { avisos: string[] };

async function leerCabecera(sql: SQL, documento: string): Promise<Cabecera | null> {
  const [f] = await sql.ejecutar<{ detalle: string | null }>(
    'SELECT detalle FROM procedencia WHERE documento = ? AND fase = ? ORDER BY rowid DESC LIMIT 1', documento, FASE,
  );
  if (!f?.detalle) return null;
  try { return JSON.parse(String(f.detalle)) as Cabecera; } catch { return null; }
}

async function escribirCabecera(sql: SQL, c: Cabecera): Promise<void> {
  await sql.ejecutar('DELETE FROM procedencia WHERE documento = ? AND fase = ?', c.documento, FASE);
  await sql.ejecutar(
    'INSERT INTO procedencia (documento, fase, proveedor, detalle, ms, cuando) VALUES (?, ?, ?, ?, ?, ?)',
    c.documento, FASE, c.modelo ?? null, JSON.stringify(c), null, c.actualizado,
  );
}

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;

/** El estado completo: la cabecera más la suma de los pasos. */
export async function leerEstadoComprension(sql: SQL, documento: string): Promise<EstadoComprension | null> {
  const c = await leerCabecera(sql, documento);
  if (!c) return null;
  const filas = await sql.ejecutar<{ fase: string; proveedor: string | null; detalle: string | null; ms: number | null; cuando: string }>(
    "SELECT fase, proveedor, detalle, ms, cuando FROM procedencia WHERE documento = ? AND fase LIKE 'comprension:%' ORDER BY rowid", documento,
  );
  const e: EstadoComprension = { ...c, avisos: [...(c.avisos ?? [])], pasos: {}, usd: 0, tokensEntrada: 0, tokensSalida: 0, llamadas: 0 };
  const modelos = new Set<string>(c.modelo ? c.modelo.split('+') : []);
  for (const f of filas) {
    const paso = f.fase.slice(FASE.length + 1);
    if (e.pasos[paso]) continue;
    let d: Record<string, unknown> = {};
    try { d = JSON.parse(String(f.detalle ?? '{}')) as Record<string, unknown>; } catch { /* fila rota: cuenta como cero */ }
    const n = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : 0);
    const detalle: Record<string, number> = {};
    for (const [k, v] of Object.entries(d)) if (typeof v === 'number' && !['tokensEntrada', 'tokensSalida', 'usd', 'llamadas'].includes(k)) detalle[k] = v;
    e.pasos[paso] = { hecho: f.cuando, ms: Number(f.ms ?? 0), usd: r5(n('usd')), ...(Object.keys(detalle).length ? { detalle } : {}) };
    e.usd += n('usd'); e.tokensEntrada += n('tokensEntrada'); e.tokensSalida += n('tokensSalida'); e.llamadas += n('llamadas');
    for (const a of Array.isArray(d.avisos) ? (d.avisos as string[]) : []) if (!e.avisos.includes(a)) e.avisos.push(a);
    for (const m of (f.proveedor ?? '').split('+')) if (m) modelos.add(m);
  }
  e.usd = r5(e.usd);
  if (modelos.size) e.modelo = [...modelos].join('+');
  return e;
}

export function estadoNuevo(documento: string, lentes: Lente[], version: string, ahora: string, estado: EstadoComprensionValor = 'pendiente'): EstadoComprension {
  return { documento, estado, lentes, version, pasos: {}, usd: 0, tokensEntrada: 0, tokensSalida: 0, llamadas: 0, avisos: [], iniciado: ahora, actualizado: ahora };
}

/** Cambia la cabecera (estado, lentes, instancia, error…) conservando lo demás. */
export async function actualizarEstado(sql: SQL, documento: string, cambios: Partial<Cabecera>, ahora: string): Promise<EstadoComprension> {
  const previa = (await leerCabecera(sql, documento)) ?? (() => {
    const { pasos: _p, usd: _u, tokensEntrada: _te, tokensSalida: _ts, llamadas: _l, ...c } = estadoNuevo(documento, cambios.lentes ?? [], cambios.version ?? '', ahora);
    return c;
  })();
  const c: Cabecera = { ...previa, ...cambios, documento, actualizado: ahora };
  if (cambios.error === undefined && 'error' in cambios) delete c.error;
  await escribirCabecera(sql, c);
  return (await leerEstadoComprension(sql, documento))!;
}

/** Suma de usos. */
export function sumarUso(a: UsoModelo | null, b: UsoModelo): UsoModelo {
  if (!a) return { ...b };
  return {
    modelo: [...new Set([...a.modelo.split('+'), ...b.modelo.split('+')])].filter(Boolean).join('+'),
    tokensEntrada: a.tokensEntrada + b.tokensEntrada, tokensSalida: a.tokensSalida + b.tokensSalida,
    usd: a.usd + b.usd, ms: a.ms + b.ms, llamadas: a.llamadas + b.llamadas,
  };
}

export const usoVacio = (modelo = ''): UsoModelo => ({ modelo, tokensEntrada: 0, tokensSalida: 0, usd: 0, ms: 0, llamadas: 0 });

/**
 * Apunta un paso terminado con su coste. Si ya estaba apuntado (un reintento
 * que llega tarde) no se cuenta dos veces.
 */
export async function apuntarPaso(
  sql: SQL, documento: string, paso: string, uso: UsoModelo, ms: number, ahora: string, detalle: Record<string, number> = {}, avisos: string[] = [],
): Promise<void> {
  const [ya] = await sql.ejecutar<{ n: number }>('SELECT COUNT(*) AS n FROM procedencia WHERE documento = ? AND fase = ?', documento, `${FASE}:${paso}`);
  if (Number(ya?.n ?? 0) > 0) return;
  await sql.ejecutar(
    'INSERT INTO procedencia (documento, fase, proveedor, detalle, ms, cuando) VALUES (?, ?, ?, ?, ?, ?)',
    documento, `${FASE}:${paso}`, uso.modelo || null,
    JSON.stringify({ tokensEntrada: uso.tokensEntrada, tokensSalida: uso.tokensSalida, usd: r5(uso.usd), llamadas: uso.llamadas, ...detalle, ...(avisos.length ? { avisos } : {}) }),
    Math.round(ms), ahora,
  );
}

/** Borra la procedencia de los pasos (al rehacer de cero). */
export async function borrarPasos(sql: SQL, documento: string): Promise<void> {
  await sql.ejecutar("DELETE FROM procedencia WHERE documento = ? AND fase LIKE 'comprension:%'", documento);
}

/** ¿Está hecho este paso en la ejecución vigente? */
export async function pasoHecho(sql: SQL, documento: string, paso: string): Promise<boolean> {
  const [f] = await sql.ejecutar<{ n: number }>('SELECT COUNT(*) AS n FROM procedencia WHERE documento = ? AND fase = ?', documento, `${FASE}:${paso}`);
  return Number(f?.n ?? 0) > 0;
}

/** Gasto acumulado de la ejecución vigente (para el presupuesto). */
export async function gastado(sql: SQL, documento: string): Promise<number> {
  const [f] = await sql.ejecutar<{ u: number | null }>(
    "SELECT SUM(json_extract(detalle, '$.usd')) AS u FROM procedencia WHERE documento = ? AND fase LIKE 'comprension:%'", documento,
  );
  return Number(f?.u ?? 0);
}
