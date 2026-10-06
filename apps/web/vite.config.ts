import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { portada } from './src/portada/vite-portada';

// La API (apps/api en wrangler dev o apps/local) escucha en 8787 durante el desarrollo.
const API = process.env.SCHOLARIS_API ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [
    // El enrutador va antes que React: genera el árbol tipado y parte cada ruta en su propio trozo.
    tanstackRouter({ target: 'react', autoCodeSplitting: true, routesDirectory: './src/rutas', generatedRouteTree: './src/arbol-rutas.gen.ts', quoteStyle: 'single' }),
    react(),
    tailwindcss(),
    // La portada pública (/acerca, /en): HTML estático, prerenderizado al construir.
    portada(),
  ],
  server: {
    port: 5180,
    proxy: { '/api': { target: API, changeOrigin: true, ws: true } },
  },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 400 },
  worker: { format: 'es' },
  // pdf.js se carga dentro de los hilos de la imprenta; el preempaquetado lo rompe.
  optimizeDeps: { exclude: ['pdfjs-dist'] },
});
