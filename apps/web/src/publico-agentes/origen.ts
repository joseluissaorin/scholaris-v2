/** El origen de ESTE despliegue (SCHOLARIS_ORIGEN al construir), nunca uno fijo. */
export const ORIGEN = (typeof process !== 'undefined' && process.env.SCHOLARIS_ORIGEN) || 'https://scholaris.joseluissaorin.com';
