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
