/**
 * La mesa de dibujo de la aplicación: pinta bocetos del cuaderno en una hoja
 * HTML, en papel claro y en papel oscuro, para mirarlos mientras se corrigen
 * (con cuadrícula de coordenadas si se pide).
 *
 *   pnpm exec tsx src/bocetos/mesa.ts lupa,estante /tmp/lamina.html [--cuadricula]
 */
import { writeFileSync } from 'node:fs';
import { aSvg } from '../dibujo/boceto';
import { BOCETOS, type NombreBoceto } from './registro';

const [lista = Object.keys(BOCETOS).join(','), salida = '/tmp/lamina.html', ...resto] = process.argv.slice(2);
const cuadricula = resto.includes('--cuadricula');
const nombres = (lista === 'todos' ? Object.keys(BOCETOS) : lista.split(',')) as NombreBoceto[];

function rejilla(w: number, h: number, x0: number, y0: number): string {
  const l: string[] = [];
  for (let x = Math.floor(x0 / 20) * 20; x <= x0 + w; x += 20) l.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + h}" stroke="${x % 100 ? '#0001' : '#00f3'}" stroke-width=".5"/>${x % 100 ? '' : `<text x="${x + 1}" y="${y0 + 9}" font-size="8" fill="#00f8">${x}</text>`}`);
  for (let y = Math.floor(y0 / 20) * 20; y <= y0 + h; y += 20) l.push(`<line y1="${y}" x1="${x0}" y2="${y}" x2="${x0 + w}" stroke="${y % 100 ? '#0001' : '#00f3'}" stroke-width=".5"/>${y % 100 ? '' : `<text y="${y - 1}" x="${x0 + 1}" font-size="8" fill="#00f8">${y}</text>`}`);
  return `<svg viewBox="${x0} ${y0} ${w} ${h}" style="position:absolute;inset:0;width:100%;height:100%">${l.join('')}</svg>`;
}

const piezas: string[] = [];
for (const n of nombres) {
  const e = BOCETOS[n];
  if (!e) { console.error(`No hay ningún boceto «${n}». Hay: ${Object.keys(BOCETOS).join(', ')}`); process.exit(1); }
  const d = await e.carga();
  const [x0, y0, w, h] = d.caja ?? [0, 0, d.ancho, d.alto];
  const svg = aSvg(d, { sufijo: n });
  piezas.push(`<figure><figcaption>${n} · ${w}×${h}</figcaption><div class="par"><div class="lam claro">${svg}${cuadricula ? rejilla(w, h, x0, y0) : ''}</div><div class="lam oscuro">${aSvg(d, { sufijo: `${n}-o` })}</div></div><div class="par chico"><div class="lam claro" style="width:96px">${aSvg(d, { sufijo: `${n}-c` })}</div><div class="lam claro" style="width:200px">${aSvg(d, { sufijo: `${n}-m` })}</div></div></figure>`);
}

writeFileSync(salida, `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Mano;src:url("${new URL('../../public/portada/mano.woff2', import.meta.url).href}")}
html{background:#e9e3d6;font:13px system-ui}body{margin:0;padding:20px}
figure{margin:0 0 28px}figcaption{color:#7a5f4f;margin-bottom:6px}
.par{display:flex;gap:16px;align-items:flex-start}.chico{margin-top:10px}
.lam{position:relative;width:min(46vw,${cuadricula ? 900 : 560}px);padding:12px;border-radius:12px}
.lam svg.dibujo{width:100%;height:auto;display:block;overflow:visible}
.claro{background:#f5f0e8;--d-papel:#f5f0e8;--d-tinta:#2c1810;--d-lapiz:#9a8e80;--d-rojo:#b83e33;--d-azul:#2b4c7e;--d-amarillo:#e8a838;--d-oro:#d6a03a;--d-negro:#1a120d}
.oscuro{background:#1f1712;--d-papel:#1f1712;--d-tinta:#f5ece0;--d-lapiz:#8f7a6a;--d-rojo:#e0705f;--d-azul:#8ea8d6;--d-amarillo:#efbd5e;--d-oro:#d9a53a;--d-negro:#f5ece0}
.claro .c-pl,.claro .c-co,.claro .c-en{mix-blend-mode:multiply}
.oscuro .c-pl,.oscuro .c-co,.oscuro .c-en{opacity:.92}
.nt{font-family:Mano,cursive}
</style>${piezas.join('')}`);
console.log(salida);
