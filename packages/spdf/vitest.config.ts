import { defineConfig } from 'vitest/config';

// Todas las pruebas con el límite de D1 y de los Durable Objects: 100 parámetros por sentencia.
export default defineConfig({ test: { setupFiles: ['./test/limite-parametros.ts'] } });
