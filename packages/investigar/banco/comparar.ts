/**
 * Resume las corridas del banco por modelo: pasos, llamadas con error, herramientas
 * distintas, pruebas citadas, frases respaldadas, anclas clave encontradas, coste y tiempo.
 *
 *   npx tsx packages/investigar/banco/comparar.ts [prefijo]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvidenciaInvestigacion } from '@scholaris/contrato';
import { RESULTADOS } from './comun.js';
import type { Corrida } from './correr.js';

/** Anclas que una buena respuesta tiene que encontrar (comprobadas a mano contra las fuentes). */
const CLAVE: Record<number, Array<{ nombre: string; doc: string; pagina?: number; t?: [number, number] }>> = {
  1: [
    { nombre: 'cuento p. 4 (Coppelia, «había pedido fresa»)', doc: 'dmw21xdj01a6v8dkc', pagina: 2 },
    { nombre: 'cuento final en Coppelia («pedí fresa»)', doc: 'dmw21xdj01a6v8dkc', pagina: 15 },
    { nombre: 'película 9:30-10:45 (Diego llega con el helado de fresa)', doc: 'dmw21xnomjseg07mi', t: [560, 645] },
    { nombre: 'película 1:45:32 (David trae «una fresa»)', doc: 'dmw21xnomjseg07mi', t: [6330, 6375] },
  ],
  3: [
    { nombre: 'cuento p. 4 (Diego llega a la mesa)', doc: 'dmw21xdj01a6v8dkc', pagina: 2 },
    { nombre: 'película 9:30-10:45 (Diego aparece en Coppelia)', doc: 'dmw21xnomjseg07mi', t: [560, 645] },
  ],
};

function encuentra(e: EvidenciaInvestigacion, k: { doc: string; pagina?: number; t?: [number, number] }): boolean {
  if (e.documento !== k.doc) return false;
  const a = e.ancla;
  if (k.pagina !== undefined) return a.tipo === 'pagina' && a.fisica === k.pagina;
  if (k.t && a.tipo === 'tiempo') return a.t0 < k.t[1] && a.t1 > k.t[0];
  return false;
}

const prefijo = process.argv[2] ?? '';
const filas: string[] = ['| etiqueta | P | pasos | errores | herramientas | ver | pruebas citadas | respaldadas | anclas clave | $ | s |', '|---|---|---|---|---|---|---|---|---|---|---|'];
for (const f of readdirSync(RESULTADOS).filter((x) => x.endsWith('.json') && x.includes(prefijo)).sort()) {
  const c = JSON.parse(readFileSync(join(RESULTADOS, f), 'utf8')) as Corrida;
  const n = Number(/-p(\d+)\.json$/.exec(f)?.[1] ?? 0);
  const etiqueta = f.replace(/^[\d-T]+-/, '').replace(/-p\d+\.json$/, '');
  if (!c.fin) { filas.push(`| ${etiqueta} | ${n} | fallo: ${c.error?.slice(0, 60)} |||||||||`); continue; }
  const pasos = c.fin.pasos;
  const errores = pasos.filter((x) => x.error).length;
  const herramientas = new Set(pasos.map((x) => x.herramienta)).size;
  const ver = pasos.filter((x) => x.herramienta === 'ver' || x.herramienta === 'escuchar').length;
  const v = c.verificacion;
  const claves = CLAVE[n] ?? [];
  const halladas = claves.filter((k) => c.fin!.evidencias.some((e) => encuentra(e, k)));
  filas.push(`| ${etiqueta} | ${n} | ${pasos.length} | ${errores} | ${herramientas} | ${ver} | ${c.fin.evidencias.length} | ${v ? `${v.respaldadas}/${v.total}` : '-'} | ${halladas.length}/${claves.length} | ${c.fin.coste.usd.toFixed(3)} | ${Math.round(c.fin.ms / 1000)} |`);
}
console.log(filas.join('\n'));
