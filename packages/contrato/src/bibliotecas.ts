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
 *   POST   /bibliotecas/:id/compartir  Invitar → Invitacion   (invitaciones, enlaces, copias, paquetes y lotes: ver comunidad.ts)
 *   DELETE /bibliotecas/:id/miembros/:usuario   → Ok
 *   GET    /bibliotecas/:id/paquete             → .scholaris (zip con el manifiesto y los .spdf)
 *
 * Bibliotecas que otros comparten conmigo: las mismas rutas con el prefijo
 * `/compartidas/:biblioteca`, que trabajan sobre la estantería del propietario
 * y solo con los documentos de esa biblioteca (el cliente: `api.compartida(id)`).
 *   lectura: GET /bibliotecas/:id, GET /documentos[...], POST /busqueda[/responder|/similares|/multilingue],
 *            POST /citas/verificar | /citas/exportar | /citas/bibliografia, GET /bibliotecas/:id/paquete
 *   edicion: además PATCH /documentos/:id/metadatos, subidas (el documento entra en la biblioteca),
 *            GET /tareas/:id, añadir y quitar documentos de la biblioteca
 *   administrador: además invitar, cambiar permisos, retirar miembros y crear enlaces
 * Lo demás responde 403; un documento de fuera de la biblioteca, 404. Una invitación
 * no da acceso hasta que se acepta.
 */
import type { Derechos } from './comunidad.js';

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
  /** Nombre de quien la comparte conmigo. */
  propietarioNombre?: string;
  derechos?: Derechos;
  /** Aclaración libre sobre los derechos («con permiso de la editorial para el seminario»). */
  notaDerechos?: string;
  /** Si es una copia: de dónde salió. */
  copiadaDe?: { biblioteca: string; nombre: string; de: string; cuando: string };
}

export type Permiso = 'propietario' | 'administrador' | 'edicion' | 'lectura';

export interface NuevaBiblioteca {
  nombre: string;
  descripcion?: string;
  color?: string;
  derechos?: Derechos;
  notaDerechos?: string;
  copiadaDe?: Biblioteca['copiadaDe'];
}

export interface AnadirDocumentos {
  documentos: string[];
}

/** Lo mínimo para invitar (el completo es `Invitar`, con mensaje y caducidad). */
export interface Compartir {
  correo: string;
  permiso: Exclude<Permiso, 'propietario'>;
  mensaje?: string;
  caducaDias?: number;
}

export interface Miembro {
  usuario?: string;
  correo: string;
  nombre?: string;
  permiso: Permiso;
  /** Invitación pendiente de aceptar. */
  pendiente: boolean;
  estado?: 'pendiente' | 'aceptada' | 'rechazada';
  /** Id de la invitación (para volver a copiar su enlace). */
  invitacion?: string;
  enlace?: string;
  caduca?: string;
  desde: string;
}
