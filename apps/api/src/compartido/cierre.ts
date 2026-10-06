/**
 * Cierre de una ingesta, común a la nube (Durable Object) y a la versión
 * local: deja el documento listo, apunta la tarea, cuotas y totales, avisa a
 * las funciones (vigilantes, grafo, corpus) y emite el fin.
 */
import { alIngerirDocumento } from '@scholaris/funciones';
import type { PuertosUsuario } from '../puertos.js';
import { ahora, terminarTarea, totalesEstanteria } from './estanteria.js';
import { invalidarBuscador, puertosFunciones } from './servicios.js';

export interface DatosCierre {
  tarea: string;
  documento: string;
  ok: boolean;
  error?: string;
  /** Clave del original en el almacén (la ingesta no la conoce). */
  original?: string;
  mime?: string;
  bytes?: number;
  bibliotecas?: string[];
  /** Unidades leídas (para la cuota de páginas). */
  unidades?: number;
  /** Metadatos que dio el usuario: mandan sobre los leídos. */
  metadatosUsuario?: Record<string, unknown>;
}

export async function cerrarIngesta(p: PuertosUsuario, d: DatosCierre): Promise<void> {
  const canal = `usuario:${p.usuario.id}`;
  if (!d.ok) {
    await terminarTarea(p.sql, d.tarea, 'error', d.error);
    await p.emisor.emitir(canal, { tipo: 'fin', tarea: d.tarea, documento: d.documento, estado: 'error', error: d.error ?? 'La ingesta ha fallado.' });
    return;
  }
  const [doc] = await p.sql.ejecutar<{ metadatos: string; bibliotecas: string }>('SELECT metadatos, bibliotecas FROM documentos WHERE id = ?', d.documento);
  if (doc) {
    const m = { ...(JSON.parse(doc.metadatos) as Record<string, unknown>), ...(d.metadatosUsuario ?? {}) };
    const bibs = [...new Set([...(JSON.parse(doc.bibliotecas) as string[]), ...(d.bibliotecas ?? [])])];
    await p.sql.ejecutar(
      `UPDATE documentos SET estado = 'listo', actualizado = ?, metadatos = ?, bibliotecas = ?,
         original = CASE WHEN ? <> '' THEN ? ELSE original END, mime = COALESCE(?, mime), bytes = COALESCE(?, bytes),
         titulo = COALESCE(?, titulo), anio = COALESCE(?, anio) WHERE id = ?`,
      ahora(), JSON.stringify(m), JSON.stringify(bibs), d.original ?? '', d.original ?? '', d.mime ?? null, d.bytes ?? null,
      typeof m.titulo === 'string' ? m.titulo : null, typeof m.anio === 'number' ? m.anio : null, d.documento,
    );
  }
  await p.sql.ejecutar("UPDATE pl_subidas SET estado = 'hecha' WHERE documento = ?", d.documento);
  await terminarTarea(p.sql, d.tarea, 'listo');
  invalidarBuscador(p.sql);
  const t = await totalesEstanteria(p.sql);
  await p.cuentas.totales(p.usuario.id, t.documentos, t.bytes).catch((e) => console.error('totales', e));
  await p.emisor.emitir(canal, { tipo: 'fin', tarea: d.tarea, documento: d.documento, estado: 'listo' });
  // Vigilantes «al ingerir», grafo de citas y corpus: después, sin bloquear el cierre.
  p.segundoPlano((async () => alIngerirDocumento(await puertosFunciones(p), d.documento))().catch((e) => console.error('alIngerirDocumento', e)));
}
