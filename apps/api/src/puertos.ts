/**
 * Los puertos que reciben las rutas. Las rutas no tocan Cloudflare ni Node:
 * el Worker (dentro del Durable Object de cada usuario) y `apps/local` montan
 * estas mismas interfaces con sus implementaciones.
 */
import type { Almacen, Emisor, IndiceVectorial, Inteligencia, SQL } from '@scholaris/nucleo';
import type { EventoTiempoReal, ModoInstancia, Plan } from '@scholaris/contrato';
import type { Cuentas } from './compartido/cuentas.js';

/** El almacén con lo que hace falta para las subidas por partes y las URLs firmadas. */
export interface AlmacenAmpliado extends Almacen {
  /** URL firmada para subir una parte (PUT) de una subida por partes. */
  urlParte(clave: string, idSubida: string, numero: number): Promise<{ url: string; cabeceras?: Record<string, string> }>;
  completarPartes(clave: string, idSubida: string, partes: Array<{ numero: number; etag: string }>): Promise<void>;
  abortarPartes(clave: string, idSubida: string): Promise<void>;
  /** Escribe una parte recibida por la propia API (modo pass-through). Devuelve el ETag. */
  ponerParte(clave: string, idSubida: string, numero: number, cuerpo: ReadableStream | Uint8Array): Promise<string>;
  /** URL de lectura firmada y temporal. */
  urlLectura(clave: string, opciones?: { segundos?: number; descarga?: string; tipo?: string }): Promise<string>;
  /** Metadatos sin leer el cuerpo. */
  cabecera(clave: string): Promise<{ bytes: number; tipo?: string; etag?: string } | null>;
  listar(prefijo: string): Promise<Array<{ clave: string; bytes: number }>>;
  /**
   * Un rango [desde, hasta] como flujo, sin cargarlo en memoria. Los medios lo
   * necesitan: el navegador pide «bytes=0-» de un vídeo de 357 MB y un Worker
   * no puede tenerlo entero en memoria (128 MB).
   */
  flujoRango?(clave: string, desde: number, hasta: number): Promise<ReadableStream | null>;
}

export interface UsuarioSesion {
  id: string;
  correo: string;
  nombre: string;
  imagen?: string;
  plan: Plan;
  funciones: string[];
  via: 'clerk' | 'clave_api' | 'local' | 'admin';
  /** Alcances si entró con clave de API. */
  alcances?: string[];
  /**
   * Acceso a una biblioteca compartida: la sesión es la del PROPIETARIO (su
   * estantería, su almacén, sus cuotas), restringida a esa biblioteca y con el
   * permiso del invitado, que queda apuntado aquí.
   */
  ambito?: {
    /** La biblioteca compartida ('' si el enlace es de un solo documento). */
    biblioteca: string;
    permiso: 'lectura' | 'edicion' | 'administrador';
    invitado: { id: string; correo: string; nombre: string };
    /** Enlace de un solo documento: solo ese. */
    documento?: string;
    /** Por un enlace de solo lectura, sin cuenta: solo leer y buscar. */
    publico?: boolean;
  };
  /**
   * Lo pone solo la puerta al copiar una biblioteca ajena: la importación acepta
   * las claves de binarios de otros usuarios (por referencia, sin copiar bytes).
   */
  importarDe?: { propietario: string; biblioteca?: string; nombre?: string; de?: string };
}

/** Datos con los que se lanza la ingesta de un documento (serializables). */
export interface ParamsIngesta {
  usuario: string;
  plan: Plan;
  tarea: string;
  documento: string;
  /** Prefijo de los recursos en el almacén. */
  prefijo: string;
  /** Clave del original. */
  original: string;
  /** Clave del paquete JSON de la imprenta, si lo hay. */
  paquete?: string;
  /** Sin paquete: el servidor convierte (o descarga la URL). */
  url?: string;
  tipo: string;
  mime: string;
  nombre: string;
  forzarVision?: boolean;
  pista?: string;
  /** 'rapido' (por defecto) o 'economico' (API por lotes y lector barato). */
  modo?: 'rapido' | 'economico';
  /** Fases a rehacer (reproceso); sin valor, todas. */
  fases?: string[];
  bibliotecas?: string[];
}

export interface Orquestador {
  /** Lanza la ingesta (Workflow en la nube, cola local en casa). */
  lanzarIngesta(p: ParamsIngesta): Promise<void>;
  cancelar(tarea: string): Promise<void>;
  /** Estado del motor (para depurar), si se sabe. */
  estado?(tarea: string): Promise<string | null>;
}

export interface ConfigInstancia {
  modo: ModoInstancia;
  version: string;
  /** Origen público («https://scholaris-v2.jlsf2005.workers.dev»). */
  origen: string;
  clerkPublishableKey?: string;
  requiereAutenticacion: boolean;
  conversionServidor: boolean;
  /** YouTube por URL (hace falta una clave de Gemini). */
  youtube: boolean;
  mcp: boolean;
  inferbox: boolean;
  bytesMaximos: number;
  tamParte: number;
  /** Espacio de nombres del índice vectorial de un usuario. */
  espacioNombres(usuario: string): string;
}

export interface PuertosUsuario {
  usuario: UsuarioSesion;
  /** La estantería del usuario (SQLite del Durable Object o fichero local). */
  sql: SQL;
  almacen: AlmacenAmpliado;
  indice: IndiceVectorial | null;
  /** La inteligencia con las claves del usuario (BYOK) o las de la instancia. Perezosa. */
  inteligencia(): Promise<Inteligencia>;
  emisor: Emisor<EventoTiempoReal>;
  orquestador: Orquestador;
  cuentas: Cuentas;
  config: ConfigInstancia;
  /** Deja trabajo en marcha tras responder (waitUntil). */
  segundoPlano(p: Promise<unknown>): void;
  /** Borra la estantería entera (baja de la cuenta). */
  vaciarEstanteria(): Promise<void>;
}
