/**
 * Cuenta: quién soy, plan, cuotas, claves de API personales, ajustes (BYOK) y
 * privacidad. Rutas:
 *
 *   GET    /config                       → ConfigPublica          (sin autenticar)
 *   GET    /salud                        → { ok, version }        (sin autenticar)
 *   GET    /auth/yo                      → Yo
 *   POST   /auth/borrar                  → Ok                     (borra la cuenta entera)
 *
 *   GET    /claves                       → ClaveApi[]
 *   POST   /claves        CrearClaveApi  → ClaveApiCreada         (el secreto solo se ve una vez)
 *   DELETE /claves/:id                   → Ok                     (revoca)
 *
 *   GET    /ajustes                      → Ajustes
 *   PATCH  /ajustes       PreferenciasParciales → Ajustes
 *   PUT    /ajustes/claves/:proveedor  { clave } → Ajustes        (se guarda cifrada con AES-GCM)
 *   DELETE /ajustes/claves/:proveedor    → Ajustes
 *
 *   GET    /privacidad/grabacion         → EstadoGrabacion
 *   POST   /privacidad/grabacion  { activa } → EstadoGrabacion
 *   GET    /privacidad/exportar          → ZIP (application/zip) con todo lo del usuario
 *   DELETE /privacidad/historial         → ResultadoPurga
 *   POST   /privacidad/purgar     { confirmar: 'BORRAR' } → ResultadoPurga  (documentos, historial, todo)
 */

export type Plan = 'gratis' | 'pro';

export type ModoInstancia = 'nube' | 'local';

export interface ConfigPublica {
  modo: ModoInstancia;
  version: string;
  /** Clave publicable de Clerk. Ausente en local sin Clerk (un solo usuario). */
  clerkPublishableKey?: string;
  /** La instancia exige token (en local puede no exigirlo). */
  requiereAutenticacion: boolean;
  /** Qué está disponible en esta instancia. */
  funciones: {
    conversionServidor: boolean;
    youtube: boolean;
    mcp: boolean;
    inferbox: boolean;
    subidaPorPartes: boolean;
  };
  /** Límites de subida. */
  limites: { bytesMaximos: number; tamParte: number };
}

export interface Cuota {
  usados: number;
  /** null = ilimitado. */
  limite: number | null;
}

export interface Cuotas {
  documentos: Cuota;
  /** Páginas (o minutos de medio) leídas en el mes en curso. */
  paginasMes: Cuota;
  busquedasDia: Cuota;
  autocitasMes: Cuota;
  bytes: Cuota;
}

export interface Usuario {
  id: string;
  correo: string;
  nombre: string;
  /** Avatar (Clerk), si lo hay. */
  imagen?: string;
}

export interface Yo {
  usuario: Usuario;
  plan: Plan;
  /** Funciones del token («scholaris» = Pro). */
  funciones: string[];
  cuotas: Cuotas;
  /** Cómo se autenticó esta petición. */
  via: 'clerk' | 'clave_api' | 'local' | 'admin';
}

// ---------------------------------------------------------------------------
// Claves de API personales (SDK, MCP)
// ---------------------------------------------------------------------------

export type AlcanceClave = 'lectura' | 'escritura' | 'mcp';

export interface ClaveApi {
  id: string;
  nombre: string;
  /** Primeros caracteres, para reconocerla: «sk_sch_a1b2…». */
  prefijo: string;
  alcances: AlcanceClave[];
  creada: string;
  ultimoUso?: string;
  caduca?: string;
  revocada?: string;
}

export interface CrearClaveApi {
  nombre: string;
  /**
   * Qué puede hacer la clave: «lectura» (consultar y buscar), «escritura»
   * (subir, editar, borrar) y «mcp» (servidor MCP). Si no se indica, solo
   * lectura y MCP: la interfaz debe ofrecerlo explícitamente.
   */
  alcances?: AlcanceClave[];
  /** Días de validez; sin valor, no caduca. */
  dias?: number;
}

export interface ClaveApiCreada extends ClaveApi {
  /** El secreto completo. Solo se devuelve aquí. */
  secreto: string;
}

// ---------------------------------------------------------------------------
// Ajustes y claves propias (BYOK)
// ---------------------------------------------------------------------------

export type ProveedorClave = 'gemini' | 'openrouter' | 'typesafe' | 'mistral' | 'voyage' | 'cohere' | 'jina' | 'zeroentropy';

export interface Preferencias {
  idioma: 'es' | 'en' | 'fr' | 'it' | 'ca' | 'gl' | 'eu' | 'pt' | 'de';
  /** Estilo CSL por defecto («apa», «chicago-author-date», «modern-language-association»…). */
  estiloCita: string;
  /** Idioma de las citas y bibliografías (locale CSL). */
  idiomaCitas: string;
  /** Respuesta con reordenador por defecto. */
  reordenar: boolean;
  /** Usar mis claves en lugar de las de la instancia cuando las haya. */
  usarClavesPropias: boolean;
  tema: 'claro' | 'oscuro' | 'sistema';
}

export type PreferenciasParciales = Partial<Preferencias>;

export interface Ajustes {
  preferencias: Preferencias;
  /** Qué claves propias hay guardadas (nunca el valor; solo los 4 últimos caracteres). */
  claves: Array<{ proveedor: ProveedorClave; final: string; guardada: string }>;
}

export interface GuardarClaveProveedor {
  clave: string;
}

// ---------------------------------------------------------------------------
// Privacidad
// ---------------------------------------------------------------------------

export interface EstadoGrabacion {
  /** Si se guarda el historial de búsquedas. */
  activa: boolean;
  desde?: string;
}

export interface ResultadoPurga {
  borrados: Record<string, number>;
}
