/**
 * Bibliotecas compartidas: lo que puede hacer un invitado dentro de la
 * estantería del propietario. La puerta reescribe `/compartidas/<b>/…` (y
 * `/publico/<token>/…`) a la ruta normal y fija `usuario.ambito`; aquí se deja
 * pasar solo lo permitido y solo sobre documentos de esa biblioteca (o del
 * documento del enlace).
 */
import type { Context, Next } from 'hono';
import type { Filtros, SQL } from '@scholaris/nucleo';
import type { Entorno } from '../entorno.js';
import { fallo, noEncontrado } from '../compartido/errores.js';

/** edicion: hace falta poder editar. publico: también por un enlace sin cuenta. */
type Regla = { metodo: string; ruta: RegExp; edicion?: boolean; publico?: boolean; documento?: number; biblioteca?: number };

const P = '/api/v2';
const R = (s: string) => new RegExp(`^${P}${s}$`);
const REGLAS: Regla[] = [
  { metodo: 'GET', ruta: R('/bibliotecas/([^/]+)'), biblioteca: 1, publico: true },
  { metodo: 'GET', ruta: R('/bibliotecas/([^/]+)/paquete'), biblioteca: 1 },
  { metodo: 'GET', ruta: R('/documentos'), publico: true },
  { metodo: 'GET', ruta: R('/documentos/([^/]+)(?:/.*)?'), documento: 1, publico: true },
  { metodo: 'POST', ruta: R('/busqueda(?:/similares)?'), publico: true },
  { metodo: 'POST', ruta: R('/busqueda/(?:responder|multilingue)') },
  { metodo: 'POST', ruta: R('/citas/(?:verificar|exportar|bibliografia)') },
  { metodo: 'PATCH', ruta: R('/documentos/([^/]+)/metadatos'), documento: 1, edicion: true },
  { metodo: 'POST', ruta: R('/subidas(?:/[^/]+(?:/(?:partes|completar|recursos|ingestar))?)?'), edicion: true },
  { metodo: 'DELETE', ruta: R('/subidas/[^/]+'), edicion: true },
  { metodo: 'GET', ruta: R('/tareas/[^/]+'), edicion: true },
  { metodo: 'POST', ruta: R('/documentos/importar'), edicion: true },
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
  if (!regla) fallo('prohibido', a.publico ? 'Con un enlace de solo lectura no se puede hacer esto.' : 'En una biblioteca compartida no se puede hacer esto.');
  if (a.publico && !regla.publico) fallo('prohibido', 'Con un enlace de solo lectura no se puede hacer esto.');
  if (regla.edicion && a.permiso !== 'edicion' && a.permiso !== 'administrador') fallo('prohibido', 'Tu permiso en esta biblioteca es de lectura.');
  const m = regla.ruta.exec(ruta)!;
  if (regla.biblioteca && (!a.biblioteca || m[regla.biblioteca] !== a.biblioteca)) noEncontrado('La biblioteca');
  if (regla.documento) {
    const doc = decodeURIComponent(m[regla.documento]!);
    // «/documentos/importar» no es un documento.
    if (!(regla.metodo === 'POST' && doc === 'importar')) {
      const dentro = a.documento ? doc === a.documento : await perteneceABiblioteca(c.get('puertos').sql, doc, a.biblioteca);
      if (!dentro) noEncontrado('El documento');
    }
  }
  return next();
}

/** Los filtros de una búsqueda, encerrados en la biblioteca compartida (o en el documento del enlace). */
export function filtrosEnAmbito(c: Context<Entorno>, f?: Filtros): Filtros | undefined {
  const a = c.get('usuario').ambito;
  if (!a) return f;
  if (a.documento) return { ...(f ?? {}), documentos: [a.documento] };
  return { ...(f ?? {}), bibliotecas: [a.biblioteca] };
}

/** Los ids de documento que se pueden ver dentro del ámbito (para filtrar resultados por si acaso). */
export async function documentosDelAmbito(c: Context<Entorno>): Promise<Set<string> | null> {
  const a = c.get('usuario').ambito;
  if (!a) return null;
  if (a.documento) return new Set([a.documento]);
  return new Set((await c.get('puertos').sql.ejecutar<{ id: string }>('SELECT d.id FROM documentos d, json_each(d.bibliotecas) je WHERE je.value = ?', a.biblioteca)).map((f) => f.id));
}
