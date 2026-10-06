import type { PuertosFunciones } from '@scholaris/funciones';
import type { PuertosUsuario, UsuarioSesion } from './puertos.js';

/** Variables del contexto Hono dentro de la app de usuario. */
export interface Entorno {
  Variables: {
    puertos: PuertosUsuario;
    usuario: UsuarioSesion;
    /** Lo que leen las rutas de `@scholaris/funciones`. */
    funciones: PuertosFunciones;
  };
}
