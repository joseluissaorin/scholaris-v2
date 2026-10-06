// Empaqueta el arnés y el trabajador de páginas con esbuild en una carpeta servible.
import { createRequire } from 'node:module';
const requerir = createRequire(import.meta.url);
const ruta = requerir.resolve('esbuild', { paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname] });
const esbuild = await import(ruta);
const salida = process.argv[2] ?? '/tmp/imprenta-web';
await esbuild.build({
  entryPoints: { arnes: new URL('./arnes.worker.ts', import.meta.url).pathname, 'trabajador-pdf': new URL('../../src/navegador/trabajador-pdf.ts', import.meta.url).pathname },
  bundle: true, format: 'esm', splitting: true, platform: 'browser', target: 'es2022', outdir: salida, logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
});
console.log('Construido en', salida);
