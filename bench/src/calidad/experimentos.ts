/**
 * `pnpm bench calidad experimentos [grupo]`: barridos de ajustes sobre el juego
 * de consultas, sin tocar el historial. Imprime una tabla por grupo y guarda el
 * detalle en bench/datos/calidad/experimentos-<grupo>.json.
 *
 * Grupos: vias, rrf, pesos, reordenadores, expansiones, contiguos, vista (todos si no se dice).
 */
import { writeFileSync } from 'node:fs';
import type { AjustesBusqueda } from '@scholaris/busqueda';
import { join } from 'node:path';
import { DIR_DATOS_CALIDAD } from './estanteria.js';
import { evaluarSistema, PRODUCCION } from './ejecutar.js';
import { cargarConsultas, type Consulta } from './juego.js';
import { montar, type Sistema } from './montaje.js';

const H: Sistema = { nombre: 'hibrida', vias: ['lexica', 'densa', 'visual'], comprender: false };
const C: Sistema = { ...H, comprender: true };
const MEJOR: AjustesBusqueda = { fundirContiguos: false, penalizacionUnidad: 1, kRrf: 10, pesos: { conceptual: { visual: 0, lexica: 0.35 }, temporal: { visual: 0, lexica: 0.35 }, visual: { lexica: 0.35 }, cita: { visual: 0 } } };
const SIN_VIS = { conceptual: { visual: 0 }, temporal: { visual: 0 }, cita: { visual: 0 } };
const SIN_VIS_LEX = { conceptual: { visual: 0, lexica: 0.5 }, temporal: { visual: 0, lexica: 0.5 }, cita: { visual: 0 } };

function grupos(m: ReturnType<typeof montar>): Record<string, Sistema[]> {
  const reord = Object.keys(m.reordenadores);
  return {
    vias: [
      { ...H, nombre: 'L', vias: ['lexica'] }, { ...H, nombre: 'D', vias: ['densa'] }, { ...H, nombre: 'V', vias: ['visual'] },
      { ...H, nombre: 'L+D', vias: ['lexica', 'densa'] }, { ...H, nombre: 'L+D+V', vias: ['lexica', 'densa', 'visual'] },
      { ...C, nombre: 'L+D+comp', vias: ['lexica', 'densa'] }, { ...C, nombre: 'L+D+V+comp' },
    ],
    rrf: [10, 20, 30, 60, 100].map((k) => ({ ...C, nombre: `k=${k}`, ajustes: { kRrf: k } })),
    pesos: [
      { ...C, nombre: 'pesos actuales' },
      { ...C, nombre: 'lex=den', ajustes: { pesos: { conceptual: { lexica: 1, densa: 1 }, temporal: { lexica: 1, densa: 1 } } } },
      { ...C, nombre: 'lex 0,5', ajustes: { pesos: { conceptual: { lexica: 0.5 }, temporal: { lexica: 0.5 } } } },
      { ...C, nombre: 'vis 0', ajustes: { pesos: { conceptual: { visual: 0 }, temporal: { visual: 0 }, cita: { visual: 0 }, visual: { visual: 0.3 } } } },
      { ...C, nombre: 'vis 0,6', ajustes: { pesos: { conceptual: { visual: 0.6 }, temporal: { visual: 0.6 } } } },
      { ...C, nombre: 'cita: den 1', ajustes: { pesos: { cita: { densa: 1 } } } },
    ],
    reordenadores: [
      { ...C, nombre: 'sin reordenar' },
      ...reord.map((r) => ({ ...C, nombre: `${r} 0,7`, reordenador: r })),
      ...reord.map((r) => ({ ...C, nombre: `${r} 0,5`, reordenador: r, ajustes: { pesoReordenador: 0.5 } })),
      ...reord.map((r) => ({ ...C, nombre: `${r} 0,9`, reordenador: r, ajustes: { pesoReordenador: 0.9 } })),
    ],
    expansiones: [
      { ...C, nombre: 'ninguna', comprender: false },
      { ...C, nombre: 'todas' },
      { ...C, nombre: 'sin hyde', ajustes: { expansiones: ['parafrasis', 'enunciado', 'traduccion'] } },
      { ...C, nombre: 'sin parafrasis', ajustes: { expansiones: ['enunciado', 'hyde', 'traduccion'] } },
      { ...C, nombre: 'sin traduccion', ajustes: { expansiones: ['parafrasis', 'enunciado', 'hyde'] } },
      { ...C, nombre: 'solo traduccion', ajustes: { expansiones: ['traduccion'] } },
      { ...C, nombre: 'solo trad+hyde', ajustes: { expansiones: ['traduccion', 'hyde'] } },
    ],
    contiguos: [
      { ...C, nombre: 'fundir contiguos' },
      { ...C, nombre: 'sin fundir', opciones: { fundirContiguos: false } },
    ],
    unidad: [1, 0.95, 0.85, 0.7].map((x) => ({ ...C, nombre: `pen ${x}`, ajustes: { fundirContiguos: false, penalizacionUnidad: x } })),
    combinado: [
      { ...C, nombre: 'base sin fundir', ajustes: { fundirContiguos: false } },
      { ...C, nombre: 'k10', ajustes: { fundirContiguos: false, kRrf: 10 } },
      { ...C, nombre: 'k10 vis0', ajustes: { fundirContiguos: false, kRrf: 10, pesos: SIN_VIS } },
      { ...C, nombre: 'k10 vis0 lex.5', ajustes: { fundirContiguos: false, kRrf: 10, pesos: SIN_VIS_LEX } },
      { ...C, nombre: 'D sola', vias: ['densa'], ajustes: { fundirContiguos: false } },
      { ...C, nombre: 'D+comp k10', vias: ['densa'], ajustes: { fundirContiguos: false, kRrf: 10 } },
    ],
    lexica: [0.5, 0.35, 0.25, 0.15].flatMap((l) => [10, 20].map((k) => ({ ...C, nombre: `lex ${l} k${k}`, ajustes: { fundirContiguos: false, penalizacionUnidad: 1, kRrf: k, pesos: { conceptual: { visual: 0, lexica: l }, temporal: { visual: 0, lexica: l }, visual: { lexica: l }, cita: { visual: 0 } } } }))),
    lexexp: [
      { ...C, nombre: 'mejor', ajustes: MEJOR },
      { ...C, nombre: 'lex: solo original', ajustes: { ...MEJOR, expansionesLexicas: [] } },
      { ...C, nombre: 'lex: original+trad', ajustes: { ...MEJOR, expansionesLexicas: ['traduccion'] } },
      { ...C, nombre: 'lex: original+trad+enunc', ajustes: { ...MEJOR, expansionesLexicas: ['traduccion', 'enunciado'] } },
    ],
    reordenar: [
      { ...C, nombre: 'mejor sin reord.', ajustes: MEJOR },
      ...reord.flatMap((r) => [0.5, 0.7, 0.9].map((w) => ({ ...C, nombre: `${r} ${w}`, reordenador: r, ajustes: { ...MEJOR, pesoReordenador: w } }))),
    ],
    produccion: [{ ...PRODUCCION }],
  };
}

/** Consultas sobre páginas de texto digital sin figuras (para la pregunta de la ingesta sobre los vectores de página). */
export function consultasDeTexto(cs: Consulta[]): Consulta[] {
  return cs.filter((c) => !c.pagina && c.documentos.every((d) => ['Attention', 'Perseguidor', 'Lewis'].includes(d)));
}

export async function experimentos(args: string[]): Promise<void> {
  const m = montar();
  const todas = cargarConsultas();
  const gs = grupos(m);
  const elegidos = args.filter((a) => !a.startsWith('--'));
  const nombres = elegidos.length ? elegidos : Object.keys(gs).filter((g) => g !== 'produccion');
  for (const g of nombres) {
    const lista = g === 'vista'
      ? [{ ...C, nombre: 'L+D+V (texto)' }, { ...C, nombre: 'L+D (texto)', vias: ['lexica', 'densa'] } as Sistema]
      : gs[g];
    if (!lista) { console.error(`Grupo desconocido: ${g}`); continue; }
    const consultas = g === 'vista' ? consultasDeTexto(todas) : todas;
    const filas: string[] = [];
    const detalle: Record<string, unknown> = {};
    for (const s of lista) {
      const r = await evaluarSistema(m, s, consultas);
      detalle[s.nombre] = r;
      const cl = r.resumen.porClase;
      const c = (k: string) => (cl[k]?.ndcg10 ?? 0).toFixed(3);
      filas.push(`| ${s.nombre} | ${r.resumen.ndcg10.toFixed(3)} | ${r.resumen.recall20.toFixed(3)} | ${r.resumen.mrr.toFixed(3)} | ${c('es')} | ${c('en')} | ${c('interlingue')} | ${c('literal')} | ${c('conceptual')} | ${c('medio')} | ${c('cruzada')} | ${c('grafia')} | ${c('filtro')} | ${r.resumen.msP50} | ${(r.resumen.usdPorConsulta * 1000).toFixed(3)} |`);
      console.error(`  ${g} · ${s.nombre}: ${r.resumen.ndcg10.toFixed(3)}`);
    }
    console.log(`\n### ${g} (${consultas.length} consultas)\n\n| Sistema | nDCG@10 | R@20 | MRR | es | en | interl. | literal | concept. | medio | cruzada | grafía | filtro | ms p50 | m$ |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n${filas.join('\n')}`);
    writeFileSync(join(DIR_DATOS_CALIDAD, `experimentos-${g}.json`), JSON.stringify(detalle));
  }
  console.error(`coste total ${m.contador.total().usd.toFixed(3)} $`);
}
