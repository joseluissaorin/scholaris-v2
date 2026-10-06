/**
 * Bibliotecas compartidas: lo que puede hacer un invitado dentro de la
 * estantería del propietario. La puerta reescribe `/compartidas/<b>/…` a la
 * ruta normal y fija `usuario.ambito`; aquí se deja pasar solo lo permitido y
 * solo sobre documentos de esa biblioteca.
 */
import type { Context, Next } from 'hono';
import type { Filtros, SQL } from '@scholaris/nucleo';
import type { Entorno } from '../entorno.js';
import { fallo, noEncontrado } from '../compartido/errores.js';

type Regla = { metodo: string; ruta: RegExp; edicion?: boolean; documento?: number; biblioteca?: number };

const P = '/api/v2';
const R = (s: string) => new RegExp(`^${P}${s}$`);
const REGLAS: Regla[] = [
  { metodo: 'GET', ruta: R('/bibliotecas/([^/]+)'), biblioteca: 1 },
  { metodo: 'GET', ruta: R('/documentos') },
  { metodo: 'GET', ruta: R('/documentos/([^/]+)(?:/.*)?'), documento: 1 },
  { metodo: 'POST', ruta: R('/busqueda(?:/responder|/similares|/multilingue)?') },
  { metodo: 'POST', ruta: R('/citas/(?:verificar|exportar|bibliografia)') },
  { metodo: 'PATCH', ruta: R('/documentos/([^/]+)/metadatos'), documento: 1, edicion: true },
  { metodo: 'POST', ruta: R('/subidas(?:/[^/]+(?:/(?:partes|completar|recursos|ingestar))?)?'), edicion: true },
  { metodo: 'DELETE', ruta: R('/subidas/[^/]+'), edicion: true },
  { metodo: 'GET', ruta: R('/tareas/[^/]+'), edicion: true },
  { metodo: 'POST', ruta: R('/bibliotecas/([^/]+)/documentos'), biblioteca: 1, edicion: true },
  { metodo: 'DELETE', ruta: R('/bibliotecas/([^/]+)/documentos/([^/]+)'), biblioteca: 1, edicion: true },
];

export async function perteneceABiblioteca(sql: SQL, documento: string, biblioteca: string): Promise<boolean> {
  const f = await sql.ejecutar('SELECT 1 FROM documentos d, json_each(d.bibliotecas) je WHERE d.id = ? AND je.value = ?', documento, biblioteca);
  return f.length > 0;
}

export async function restringirAmbito(c: Context<Entorno>, next: Next): Promise<void | Response> {
  const a = c.get('usuario').ambito;
  if (!a) return next();
  const ruta = c.req.path;
  const regla = REGLAS.find((r) => r.metodo === c.req.method && r.ruta.test(ruta));
  if (!regla) fallo('prohibido', 'En una biblioteca compartida no se puede hacer esto.');
  if (regla.edicion && a.permiso !== 'edicion') fallo('prohibido', 'Tu permiso en esta biblioteca es de lectura.');
  const m = regla.ruta.exec(ruta)!;
  if (regla.biblioteca && m[regla.biblioteca] !== a.biblioteca) noEncontrado('La biblioteca');
  if (regla.documento && !(await perteneceABiblioteca(c.get('puertos').sql, decodeURIComponent(m[regla.documento]!), a.biblioteca))) noEncontrado('El documento');
  return next();
}

/** Los filtros de una búsqueda, encerrados en la biblioteca compartida si la hay. */
export function filtrosEnAmbito(c: Context<Entorno>, f?: Filtros): Filtros | undefined {
  const a = c.get('usuario').ambito;
  if (!a) return f;
  return { ...(f ?? {}), bibliotecas: [a.biblioteca] };
}
