/**
 * Las bibliotecas como objetos sociales: invitar, aceptar, seguir, copiar,
 * enlaces de solo lectura, búsqueda conjunta, paquetes `.scholaris` y el
 * llenado por lotes.
 *
 * Invitaciones y miembros (los atiende la puerta: viven en las cuentas):
 *   POST   /bibliotecas/:id/compartir   Invitar → Invitacion     (propietario o administrador)
 *   GET    /bibliotecas/:id/miembros             → Miembro[]
 *   PATCH  /bibliotecas/:id/miembros/:quien  { permiso } → Miembro   (:quien = usuario o correo)
 *   DELETE /bibliotecas/:id/miembros/:quien      → Ok         (revoca el acceso o la invitación)
 *   GET    /invitaciones                         → InvitacionRecibida[]   (pendientes)
 *   GET    /invitaciones/token/:token            → InvitacionRecibida     (el enlace del correo)
 *   POST   /invitaciones/:id/aceptar             → BibliotecaSeguida      (:id o el token del correo)
 *   POST   /invitaciones/:id/rechazar            → Ok
 *   GET    /seguidas                             → BibliotecaSeguida[]
 *   POST   /seguidas  { enlace, pase? }          → BibliotecaSeguida   (seguir desde un enlace, mientras viva)
 *   DELETE /seguidas/:biblioteca                 → Ok   (dejar de seguir)
 *   GET    /notificaciones?pendientes=1          → Notificacion[]
 *   POST   /notificaciones/leidas  { ids? }      → Ok   (sin ids, todas)
 *
 * Copiar a mi biblioteca (al instante: ni se vuelve a leer ni se duplican los binarios):
 *   POST   /copias   Copiar → ResultadoCopia   (por tandas: se repite con `destino` mientras queden `pendientes`)
 *
 * Enlaces de solo lectura (sin cuenta):
 *   GET    /bibliotecas/:id/enlaces              → Enlace[]
 *   POST   /enlaces   NuevoEnlace                → Enlace
 *   DELETE /enlaces/:id                          → Ok   (deja de funcionar al momento)
 *   GET    /publico/:token                       → VistaPublica
 *   POST   /publico/:token/acceso  { clave }     → { pase }   (si el enlace tiene contraseña)
 *   /publico/:token/…  las rutas de lectura (documentos, unidades, búsqueda), con la
 *                      cabecera `x-scholaris-pase` si hace falta. El cliente: `crearCliente({ publico })`.
 *
 * Búsqueda en lo mío y en lo que sigo:
 *   POST   /busqueda/conjunta   BuscarConjunta → RespuestaConjunta
 *
 * Paquetes `.scholaris` (un zip: manifest.json, LEEME.txt, portada y los .spdf):
 *   GET    /bibliotecas/:id/paquete?originales=0&vectores=0&documentos=a,b → application/x-scholaris (en flujo)
 *   Importar: `importarPaquete(api, fichero)` abre el zip donde esté (navegador, Worker, Node) y
 *   manda cada .spdf a /documentos/importar: no se vuelve a leer nada; solo se calculan los vectores que falten.
 *
 * Lotes (llenar una biblioteca de golpe):
 *   POST   /lotes/estimar   EstimarLote → EstimacionLote   (cuenta, páginas, minutos, tiempo, coste, repetidos)
 *   POST   /lotes           NuevoLote   → DetalleLote
 *   GET    /lotes                       → Lote[]
 *   GET    /lotes/:id                   → DetalleLote
 *   POST   /lotes/:id/pausar | /reanudar | /cancelar → DetalleLote
 *   POST   /lotes/:id/siguientes  { max } → ElementoLote[]   (el conductor reserva archivos que subir; vacío si está en pausa)
 *   PATCH  /lotes/:id/elementos/:n  ParcheElemento → ElementoLote
 *   POST   /lotes/:id/elementos/:n/reintentar | /omitir → DetalleLote
 * Los enlaces los lanza el servidor; los archivos los sube el navegador (con su imprenta) o el SDK.
 */

import type { MetadatosDocumento, TipoEntrada } from '@scholaris/nucleo';
import type { ResultadoVista, Buscar, IntencionConsulta } from './busqueda.js';
import type { Permiso } from './bibliotecas.js';
import type { ModoIngesta } from './subidas.js';

// ---------------------------------------------------------------------------
// Derechos
// ---------------------------------------------------------------------------

/** Qué se puede hacer con lo que hay en la biblioteca. */
export type Derechos =
  | 'sin_indicar'
  | 'dominio_publico'
  | 'cc0'
  | 'cc_by'
  | 'cc_by_sa'
  | 'cc_by_nc'
  | 'cc_by_nc_sa'
  | 'uso_privado'
  | 'con_permiso';

export const DERECHOS: Record<Derechos, { nombre: string; abierto: boolean }> = {
  sin_indicar: { nombre: 'Sin indicar', abierto: false },
  dominio_publico: { nombre: 'Dominio público', abierto: true },
  cc0: { nombre: 'CC0 (sin derechos reservados)', abierto: true },
  cc_by: { nombre: 'CC BY', abierto: true },
  cc_by_sa: { nombre: 'CC BY-SA', abierto: true },
  cc_by_nc: { nombre: 'CC BY-NC', abierto: true },
  cc_by_nc_sa: { nombre: 'CC BY-NC-SA', abierto: true },
  uso_privado: { nombre: 'Uso privado (obras con derechos)', abierto: false },
  con_permiso: { nombre: 'Con permiso de los titulares', abierto: false },
};

// ---------------------------------------------------------------------------
// Invitaciones, miembros y bibliotecas que sigo
// ---------------------------------------------------------------------------

export type PermisoInvitado = Exclude<Permiso, 'propietario'>;

export interface Invitar {
  correo: string;
  permiso: PermisoInvitado;
  /** Unas líneas para quien recibe la invitación. */
  mensaje?: string;
  /** El acceso caduca a los N días (sin valor, no caduca). */
  caducaDias?: number;
}

export type EstadoInvitacion = 'pendiente' | 'aceptada' | 'rechazada';

export interface Invitacion {
  id: string;
  biblioteca: string;
  correo: string;
  permiso: PermisoInvitado;
  estado: EstadoInvitacion;
  mensaje?: string;
  caduca?: string;
  creada: string;
  /** Enlace para aceptarla (se puede copiar y mandar por otro medio). */
  enlace: string;
  /** Si se mandó un correo con el enlace (si la instancia sabe mandar correo). */
  correoEnviado: boolean;
}

export interface InvitacionRecibida {
  id: string;
  biblioteca: string;
  nombre: string;
  descripcion?: string;
  derechos?: Derechos;
  permiso: PermisoInvitado;
  mensaje?: string;
  de: { id: string; nombre: string; correo: string };
  caduca?: string;
  creada: string;
  estado: EstadoInvitacion;
}

export interface BibliotecaSeguida {
  biblioteca: string;
  nombre: string;
  descripcion?: string;
  derechos?: Derechos;
  permiso: PermisoInvitado;
  propietario: { id: string; nombre: string; correo: string };
  desde: string;
  caduca?: string;
  /** Llegó por un enlace (no por una invitación con nombre). */
  porEnlace?: boolean;
}

export type TipoNotificacion = 'invitacion' | 'invitacion_aceptada' | 'invitacion_rechazada' | 'acceso_retirado' | 'biblioteca_copiada' | 'lote_terminado';

export interface Notificacion {
  id: string;
  tipo: TipoNotificacion;
  /** Frase lista para enseñar: «Ana te invita a leer “Seminario de Foucault”». */
  texto: string;
  biblioteca?: string;
  /** Adónde lleva («/invitaciones», «/compartida/b…»). */
  destino?: string;
  creada: string;
  leida: boolean;
}

// ---------------------------------------------------------------------------
// Copiar
// ---------------------------------------------------------------------------

export interface Copiar {
  /** De dónde: una biblioteca compartida conmigo, o un enlace de solo lectura (con su pase si tiene clave). */
  origen: { biblioteca: string } | { enlace: string; pase?: string };
  /** Solo estos documentos (sin valor, todos los de la biblioteca o el del enlace). */
  documentos?: string[];
  /** Adónde: una biblioteca mía ya creada (las tandas siguientes), o una nueva con este nombre. */
  destino?: { biblioteca: string } | { nombre: string };
  /** Cuántos documentos por tanda (por defecto 10, máximo 25). */
  tanda?: number;
}

export interface ResultadoCopia {
  /** La biblioteca de destino (mía). */
  biblioteca: string;
  copiados: Array<{ origen: string; documento: string }>;
  /** Ya estaban en mi estantería (misma huella): se añaden a la biblioteca sin copiar nada. */
  repetidos: Array<{ origen: string; documento: string }>;
  fallidos: Array<{ origen: string; error: string }>;
  /** Lo que queda por copiar: repetir la llamada con `destino: { biblioteca }` y `documentos: pendientes`. */
  pendientes: string[];
  total: number;
}

// ---------------------------------------------------------------------------
// Enlaces de solo lectura
// ---------------------------------------------------------------------------

export interface NuevoEnlace {
  /** Una biblioteca entera… */
  biblioteca?: string;
  /** …o un solo documento. */
  documento?: string;
  /** Contraseña opcional (se guarda solo su huella). */
  clave?: string;
  caducaDias?: number;
  /**
   * Las obras con derechos solo se comparten para uso privado con quien recibe
   * el enlace: hay que confirmarlo si los derechos no son abiertos.
   */
  confirmarDerechos?: boolean;
}

export interface Enlace {
  id: string;
  /** La URL que se manda («https://…/p/<token>»). */
  url: string;
  token: string;
  biblioteca?: string;
  documento?: string;
  titulo: string;
  conClave: boolean;
  caduca?: string;
  creado: string;
  visitas: number;
}

export interface VistaPublica {
  tipo: 'biblioteca' | 'documento';
  titulo: string;
  descripcion?: string;
  derechos: Derechos;
  /** Quién la comparte (el nombre, nunca el correo). */
  de: string;
  documentos: number;
  /** Si hace falta la contraseña: hasta tenerla, solo esto. */
  conClave: boolean;
  biblioteca?: string;
  documento?: string;
  caduca?: string;
}

// ---------------------------------------------------------------------------
// Búsqueda conjunta
// ---------------------------------------------------------------------------

/** Dónde buscar: lo mío, lo que sigo, todo, o unas bibliotecas concretas. */
export type AlcanceBusqueda = 'todo' | 'mias' | 'seguidas' | { bibliotecas: string[] };

export interface BuscarConjunta extends Buscar {
  alcance?: AlcanceBusqueda;
}

/** De dónde sale un pasaje: mi estantería o una biblioteca que sigo. */
export interface OrigenPasaje {
  propia: boolean;
  biblioteca?: string;
  nombre?: string;
  /** Nombre de quien la comparte. */
  de?: string;
}

export interface ResultadoConjunto extends ResultadoVista {
  origen: OrigenPasaje;
}

export interface RespuestaConjunta {
  resultados: ResultadoConjunto[];
  intencion?: IntencionConsulta;
  /** Dónde se buscó, con lo que salió de cada sitio. */
  fuentes: Array<OrigenPasaje & { resultados: number; error?: string }>;
  ms: number;
}

// ---------------------------------------------------------------------------
// Paquetes .scholaris
// ---------------------------------------------------------------------------

export interface ManifiestoPaquete {
  formato: 'scholaris-biblioteca';
  version: 1;
  generador: string;
  exportado: string;
  biblioteca: {
    id: string;
    nombre: string;
    descripcion?: string;
    color?: string;
    derechos: Derechos;
    notaDerechos?: string;
    creada: string;
    /** Nombre del fichero de la portada dentro del zip, si la hay. */
    portada?: string;
  };
  opciones: { originales: boolean; vectores: boolean };
  documentos: Array<{
    /** Ruta dentro del zip: «documentos/<id>.spdf». */
    archivo: string;
    id: string;
    titulo: string;
    autores: string;
    anio?: number;
    tipo: TipoEntrada;
    huella?: string;
    bytes: number;
    /** El original no cabía (o se pidió sin originales). */
    sinOriginal?: boolean;
  }>;
  /** Documentos que no se pudieron empaquetar (no estaban listos…). */
  omitidos: Array<{ id: string; titulo: string; motivo: string }>;
}

export interface OpcionesPaquete {
  /** Incluir los originales (PDF, audio…). Sin ellos pesa mucho menos; el texto, las páginas y las citas quedan. */
  originales?: boolean;
  /** Incluir los vectores. Sin ellos, quien importa los recalcula (cuesta poco: no se vuelve a leer). */
  vectores?: boolean;
  documentos?: string[];
}

export interface ImportacionPaquete {
  biblioteca: string;
  importados: Array<{ origen: string; documento: string; tarea?: string }>;
  repetidos: Array<{ origen: string; documento: string }>;
  fallidos: Array<{ origen: string; error: string }>;
  avisos: string[];
}

// ---------------------------------------------------------------------------
// Lotes
// ---------------------------------------------------------------------------

export type ClaseElemento = 'archivo' | 'url' | 'spdf';

export interface ElementoNuevo {
  clase: ClaseElemento;
  /** Nombre del fichero o la URL. */
  nombre: string;
  /** Ruta relativa dentro de la carpeta o del zip («capitulos/03.pdf»). */
  ruta?: string;
  mime?: string;
  bytes?: number;
  /** SHA-256 del fichero: detecta lo que ya está en cualquiera de tus bibliotecas. */
  huella?: string;
  url?: string;
  tipo?: TipoEntrada;
  /** Páginas medidas en el navegador (si no, se estiman por el tamaño). */
  paginas?: number;
  /** Minutos de audio o vídeo medidos en el navegador. */
  minutos?: number;
  /** Metadatos que ya se saben (de un BibTeX, RIS o Zotero). */
  metadatos?: Partial<MetadatosDocumento>;
}

export interface EstimarLote {
  elementos: ElementoNuevo[];
  modo?: ModoIngesta;
}

export interface CifrasModo {
  /** Segundos hasta tenerlo todo buscable (aproximado). */
  segundos: number;
  /** Coste aproximado en euros (lo que cuesta leerlo con IA). */
  euros: number;
}

export interface EstimacionLote {
  elementos: number;
  /** Los que hay que leer de verdad (sin repetidos ni .spdf). */
  nuevos: number;
  paginas: number;
  minutos: number;
  porTipo: Partial<Record<TipoEntrada | 'spdf', number>>;
  duplicados: Array<{ indice: number; documento: string; titulo: string; bibliotecas: string[] }>;
  modos: Record<ModoIngesta, CifrasModo>;
  /** Económico por defecto en lotes grandes. */
  recomendado: ModoIngesta;
  avisos: string[];
}

export interface NuevoLote extends EstimarLote {
  nombre?: string;
  /** Biblioteca a la que va todo (sin valor, a la estantería sin colección). */
  biblioteca?: string;
  /** Cuántos a la vez (por defecto 3, máximo 8). */
  concurrencia?: number;
}

export type EstadoElemento = 'pendiente' | 'subiendo' | 'procesando' | 'listo' | 'error' | 'omitido' | 'duplicado' | 'cancelado';
export type EstadoLote = 'en_marcha' | 'pausado' | 'terminado' | 'cancelado';

export interface ElementoLote extends ElementoNuevo {
  n: number;
  estado: EstadoElemento;
  documento?: string;
  tarea?: string;
  error?: string;
  intentos: number;
  /** 0-1 mientras se procesa (de la tarea). */
  avance?: number;
  actualizado: string;
}

export interface Lote {
  id: string;
  nombre: string;
  biblioteca?: string;
  modo: ModoIngesta;
  concurrencia: number;
  estado: EstadoLote;
  total: number;
  cuentas: Partial<Record<EstadoElemento, number>>;
  estimacion?: Pick<EstimacionLote, 'paginas' | 'minutos' | 'modos'>;
  creado: string;
  actualizado: string;
}

export interface DetalleLote extends Lote {
  elementos: ElementoLote[];
}

export interface ParcheElemento {
  estado?: EstadoElemento;
  documento?: string;
  tarea?: string;
  error?: string;
}
