/**
 * Las tarjetas para redes (Open Graph, 1200 × 630), con los mismos dibujos de
 * la portada. Se generan a mano cuando cambia el titular y se guardan en
 * public/portada/tarjeta-{es,en}.png:
 *
 *   pnpm exec tsx src/portada/tarjeta.ts
 *
 * (usa el Chrome del sistema en modo sin ventana para hacer la captura).
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { aSvg } from './dibujo/boceto';
import { DIBUJOS } from './dibujo/dibujos';
import { CSS_TINTAS } from './dibujo/tintas';
import { TEXTOS } from './textos';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const publico = (f: string) => fileURLToPath(new URL(`../../public/portada/${f}`, import.meta.url));

for (const lengua of ['es', 'en'] as const) {
  const t = TEXTOS[lengua];
  const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Mano;src:url("${new URL('../../public/portada/mano.woff2', import.meta.url).href}")}
:root{${CSS_TINTAS}}
*{margin:0;box-sizing:border-box}
html,body{width:1200px;height:630px;overflow:hidden}
body{background:#F5F0E8;color:#2C1810;font-family:Georgia,serif;position:relative}
.sol{position:absolute;width:640px;height:640px;right:-190px;top:-60px}
.mano{position:absolute;left:-30px;top:330px;width:760px}
.mano svg,.sol svg{width:100%;height:auto;display:block}
.nt{font-family:Mano,cursive}.c-pl,.c-co,.c-en{mix-blend-mode:multiply}
h1{position:absolute;left:64px;top:96px;width:720px;font-weight:normal;font-size:84px;line-height:.92;letter-spacing:-.035em}
.marca{position:absolute;left:64px;top:36px;display:flex;align-items:center;gap:12px;font-size:26px}
.marca img{width:46px;height:46px}
.dato{position:absolute;right:56px;bottom:40px;font:500 15px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#7a5f4e}
</style>
<div class="sol">${aSvg(DIBUJOS.sol, { decorativo: true })}</div>
<div class="marca"><img src="${new URL('../../public/portada/logo-96.webp', import.meta.url).href}"><span>Scholaris</span></div>
<h1>${t.heroe.titular}</h1>
<div class="mano">${aSvg(DIBUJOS.manicula, { lengua, decorativo: true })}</div>
<p class="dato">${lengua === 'es' ? 'sin inventar ni una cita' : 'never an invented citation'}</p>`;
  const fuente = `/tmp/tarjeta-${lengua}.html`;
  writeFileSync(fuente, html);
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=3000', '--window-size=1200,630', `--screenshot=${publico(`tarjeta-${lengua}.png`)}`, `file://${fuente}`], { stdio: 'ignore' });
  console.log(publico(`tarjeta-${lengua}.png`));
}
