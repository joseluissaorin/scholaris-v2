/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** «simulada» fuerza la demostración; «remota» la prohíbe. Sin valor: API si responde, si no, demostración (solo en desarrollo). */
  readonly VITE_FUENTE?: 'simulada' | 'remota';
  /** Origen de la API. Vacío = mismo origen. */
  readonly VITE_API?: string;
  /** Clave publicable de Clerk si /config no la trae. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
