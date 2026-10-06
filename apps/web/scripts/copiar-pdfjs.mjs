// Copia los recursos estáticos de pdf.js (fuentes estándar, cmaps CJK, wasm de
// JPEG 2000) a public/pdfjs/: la imprenta los pide en tiempo de ejecución.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const requerir = createRequire(join(aqui, '../../../packages/imprenta/package.json'));
const raiz = dirname(requerir.resolve('pdfjs-dist/package.json'));
const destino = join(aqui, '../public/pdfjs');
mkdirSync(destino, { recursive: true });
for (const d of ['standard_fonts', 'cmaps', 'wasm']) {
  const origen = join(raiz, d);
  if (existsSync(origen)) cpSync(origen, join(destino, d), { recursive: true });
}
console.log('pdf.js: recursos copiados a public/pdfjs/');
