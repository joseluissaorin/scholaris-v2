/** Ajustes por usuario de las funciones (clave/valor) y la grabación del historial. */

import type { SQL } from '@scholaris/nucleo';
import { ahora, una } from './util.js';

export async function leerAjuste(sql: SQL, clave: string): Promise<string | null> {
  const f = await una<{ valor: string | null }>(sql, 'SELECT valor FROM funciones_ajustes WHERE clave = ?', clave);
  return f?.valor ?? null;
}

export async function fijarAjuste(sql: SQL, clave: string, valor: string | null): Promise<void> {
  if (valor === null) {
    await sql.ejecutar('DELETE FROM funciones_ajustes WHERE clave = ?', clave);
    return;
  }
  await sql.ejecutar(
    `INSERT INTO funciones_ajustes (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
    clave,
    valor,
  );
}

const GRABACION = 'grabacion';
const GRABACION_DESDE = 'grabacion_desde';

/** Lo que devuelve /privacidad/grabacion (contrato `EstadoGrabacion`). */
export interface EstadoGrabacion {
  activa: boolean;
  /** Desde cuándo está en el estado actual (ausente si nunca se ha tocado). */
  desde?: string;
}

/** Por defecto la grabación está activa: el usuario la puede apagar en Privacidad. */
export async function grabacionActiva(sql: SQL): Promise<boolean> {
  return (await leerAjuste(sql, GRABACION)) !== '0';
}

export async function estadoGrabacion(sql: SQL): Promise<EstadoGrabacion> {
  const desde = await leerAjuste(sql, GRABACION_DESDE);
  return desde ? { activa: await grabacionActiva(sql), desde } : { activa: await grabacionActiva(sql) };
}

export async function fijarGrabacion(sql: SQL, activa: boolean): Promise<EstadoGrabacion> {
  const antes = await grabacionActiva(sql);
  await fijarAjuste(sql, GRABACION, activa ? '1' : '0');
  if (antes !== activa || !(await leerAjuste(sql, GRABACION_DESDE))) await fijarAjuste(sql, GRABACION_DESDE, ahora());
  return estadoGrabacion(sql);
}
