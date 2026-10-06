/**
 * Pooling: cada sistema (vías solas, fusión, con y sin comprensión, con y sin
 * reordenador) busca cada consulta y se juntan sus primeros resultados. Esa
 * unión, más los fragmentos «semilla» de la propuesta, es lo que se juzga.
 *
 *   pnpm bench calidad pool [--profundidad 15]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { enParalelo } from '@scholaris/nucleo';
import { DIR_CALIDAD, DIR_DATOS_CALIDAD } from './estanteria.js';
import { buscadorPara, montar, opcionesPara, SISTEMAS } from './montaje.js';
import { cargarConsultas } from './juego.js';

export const RUTA_POOL = join(DIR_DATOS_CALIDAD, 'pool.json');

export type Pool = Record<string, { fragmentos: string[]; porSistema: Record<string, string[]> }>;

export async function pool(args: string[]): Promise<void> {
  const i = args.indexOf('--profundidad');
  const profundidad = i >= 0 ? Number(args[i + 1]) : 15;
  const m = montar();
  const consultas = cargarConsultas().filter((c) => !c.pagina);
  const previo: Pool = existsSync(RUTA_POOL) ? JSON.parse(readFileSync(RUTA_POOL, 'utf8')) as Pool : {};
  const { ANTES, PRODUCCION } = await import('./ejecutar.js');
  for (const s of [ANTES, ...SISTEMAS, PRODUCCION]) {
    const b = buscadorPara(m, s);
    let hechas = 0;
    await enParalelo(consultas, 8, async (c) => {
      const r = await b.buscar(c.consulta, opcionesPara(s, profundidad));
      const e = (previo[c.id] ??= { fragmentos: [], porSistema: {} });
      e.porSistema[s.nombre] = r.resultados.map((x) => x.fragmento.id);
      if (++hechas % 40 === 0) console.error(`  ${s.nombre}: ${hechas}/${consultas.length}`);
    });
    console.error(`${s.nombre} listo; coste acumulado ${m.contador.total().usd.toFixed(3)} $`);
  }
  for (const c of consultas) {
    const e = previo[c.id]!;
    e.fragmentos = [...new Set([...c.semilla, ...Object.values(e.porSistema).flat()])];
  }
  writeFileSync(RUTA_POOL, JSON.stringify(previo));
  const n = consultas.map((c) => previo[c.id]!.fragmentos.length);
  console.error(`Pool: ${n.reduce((a, b) => a + b, 0)} pares consulta-pasaje (media ${(n.reduce((a, b) => a + b, 0) / n.length).toFixed(1)} por consulta) → ${RUTA_POOL}`);
  void DIR_CALIDAD;
}
