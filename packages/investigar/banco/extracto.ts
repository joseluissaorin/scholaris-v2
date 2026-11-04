/**
 * Un extracto de cada corrida para el informe: el principio de la respuesta y sus
 * primeras pruebas con el ancla exacta.
 *
 *   npx tsx packages/investigar/banco/extracto.ts [prefijo] [caracteres]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tiempoACadena } from '@scholaris/nucleo';
import { RESULTADOS } from './comun.js';
import type { Corrida } from './correr.js';

const prefijo = process.argv[2] ?? '';
const largo = Number(process.argv[3] ?? 700);
for (const f of readdirSync(RESULTADOS).filter((x) => x.endsWith('.json') && x.includes(prefijo)).sort()) {
  const c = JSON.parse(readFileSync(join(RESULTADOS, f), 'utf8')) as Corrida;
  if (!c.fin) continue;
  const cuerpo = c.fin.markdown.replace(/\n## (Pruebas|Evidence)[\s\S]*$/, '').replace(/\n{2,}/g, '\n');
  console.log(`\n### ${f}\n${c.pregunta}\n${c.fin.coste.usd.toFixed(3)} $ · ${Math.round(c.fin.ms / 1000)} s · ${c.fin.coste.pasos} pasos · ${c.fin.evidencias.length} pruebas · ${c.verificacion?.respaldadas}/${c.verificacion?.total} respaldadas\n`);
  console.log(cuerpo.slice(0, largo));
  for (const e of c.fin.evidencias.slice(0, 8)) {
    const a = e.ancla;
    const fino = [a.caracteres ? `car. ${a.caracteres.join('-')}` : '', a.region ? `región ${[a.region.x, a.region.y, a.region.w, a.region.h].map((x) => x.toFixed(2)).join(',')}` : '', a.instante !== undefined ? `instante ${tiempoACadena(a.instante)}` : '', a.tipo === 'tiempo' && a.hablante ? `habla ${a.hablante}` : ''].filter(Boolean).join(', ');
    console.log(`  [${e.id}] ${e.citaCorta}${fino ? ` (${fino})` : ''} ${e.capa}/${e.modo}/${e.herramienta}: «${(e.cita ?? '').slice(0, 110)}»`);
  }
}
