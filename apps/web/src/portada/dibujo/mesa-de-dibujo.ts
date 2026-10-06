/**
 * La mesa de dibujo: pinta un dibujo suelto en una hoja HTML para mirarlo
 * mientras se corrige (con una cuadrícula de coordenadas opcional, como el
 * papel milimetrado sobre el que se calca).
 *
 *   pnpm exec tsx src/portada/dibujo/mesa-de-dibujo.ts manicula /tmp/lamina.html [--cuadricula]
 */
import { writeFileSync } from 'node:fs';
import { aSvg } from './boceto';
import { DIBUJOS } from './dibujos';
import { CSS_TINTAS } from './tintas';

const [nombre = 'manicula', salida = '/tmp/lamina.html', ...resto] = process.argv.slice(2);
const dibujo = DIBUJOS[nombre as keyof typeof DIBUJOS];
if (!dibujo) {
  console.error(`No hay ningún dibujo llamado «${nombre}». Hay: ${Object.keys(DIBUJOS).join(', ')}`);
  process.exit(1);
}
const cuadricula = resto.includes('--cuadricula');
const rejilla = cuadricula
  ? `<svg viewBox="0 0 ${dibujo.ancho} ${dibujo.alto}" style="position:absolute;inset:0;width:100%;height:100%">${Array.from({ length: Math.ceil(dibujo.ancho / 20) + 1 }, (_, i) => `<line x1="${i * 20}" y1="0" x2="${i * 20}" y2="${dibujo.alto}" stroke="${i % 5 ? '#0001' : '#00f3'}" stroke-width=".5"/>${i % 5 ? '' : `<text x="${i * 20 + 1}" y="9" font-size="8" fill="#00f8">${i * 20}</text>`}`).join('')}${Array.from({ length: Math.ceil(dibujo.alto / 20) + 1 }, (_, i) => `<line y1="${i * 20}" x1="0" y2="${i * 20}" x2="${dibujo.ancho}" stroke="${i % 5 ? '#0001' : '#00f3'}" stroke-width=".5"/>${i % 5 ? '' : `<text y="${i * 20 - 1}" x="1" font-size="8" fill="#00f8">${i * 20}</text>`}`).join('')}</svg>`
  : '';
writeFileSync(
  salida,
  `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Mano;src:url("${new URL('../../../public/portada/mano.woff2', import.meta.url).href}")}
html{background:#F3EEE3}body{margin:0;padding:24px}
:root{${CSS_TINTAS}}
.lam{position:relative;width:100%;max-width:${dibujo.ancho * 2}px}
.lam>svg.dibujo{width:100%;height:auto;display:block}
.c-pl{mix-blend-mode:multiply}
.nt{font-family:Mano,cursive}
.c-co,.c-en{mix-blend-mode:multiply}
</style><div class="lam">${aSvg(dibujo)}${rejilla}</div>`,
);
console.log(salida);
