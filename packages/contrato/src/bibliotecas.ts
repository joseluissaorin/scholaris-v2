/**
 * Bibliotecas: colecciones de documentos, compartibles.
 *
 *   GET    /bibliotecas                         → Biblioteca[]        (propias y compartidas conmigo)
 *   POST   /bibliotecas        NuevaBiblioteca  → Biblioteca
 *   GET    /bibliotecas/:id                     → Biblioteca
 *   PATCH  /bibliotecas/:id    Partial<NuevaBiblioteca> → Biblioteca
 *   DELETE /bibliotecas/:id                     → Ok   (los documentos se quedan en la estantería)
 *   POST   /bibliotecas/:id/documentos  { documentos: string[] } → Biblioteca
 *   DELETE /bibliotecas/:id/documentos/:documento → Biblioteca
 *   GET    /bibliotecas/:id/miembros            → Miembro[]
 *   POST   /bibliotecas/:id/compartir  Compartir → Miembro
 *   DELETE /bibliotecas/:id/miembros/:usuario   → Ok
 *   GET    /bibliotecas/:id/exportar            → ZIP con los .spdf de la biblioteca
 *
 * Bibliotecas que otros comparten conmigo: las mismas rutas con el prefijo
 * `/compartidas/:biblioteca`, que trabajan sobre la estantería del propietario
 * y solo con los documentos de esa biblioteca (el cliente: `api.compartida(id)`).
 *   lectura: GET /bibliotecas/:id, GET /documentos[...], POST /busqueda[/responder|/similares|/multilingue],
 *            POST /citas/verificar | /citas/exportar | /citas/bibliografia
 *   edicion: además PATCH /documentos/:id/metadatos, subidas (el documento entra en la biblioteca),
 *            GET /tareas/:id, añadir y quitar documentos de la biblioteca
 * Lo demás responde 403; un documento de fuera de la biblioteca, 404.
 */

export interface Biblioteca {
  id: string;
  nombre: string;
  descripcion?: string;
  color?: string;
  documentos: number;
  creada: string;
  actualizada: string;
  /** Dueño: yo o quien la compartió conmigo. */
  propietario: string;
  /** Mi permiso sobre ella. */
  permiso: Permiso;
  compartida: boolean;
}

export type Permiso = 'propietario' | 'edicion' | 'lectura';

export interface NuevaBiblioteca {
  nombre: string;
  descripcion?: string;
  color?: string;
}

export interface AnadirDocumentos {
  documentos: string[];
}

export interface Compartir {
  correo: string;
  permiso: Exclude<Permiso, 'propietario'>;
}

export interface Miembro {
  usuario?: string;
  correo: string;
  permiso: Permiso;
  /** Invitación pendiente de aceptar (el usuario aún no ha entrado). */
  pendiente: boolean;
  desde: string;
}
