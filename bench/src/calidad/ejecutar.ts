/**
 * `pnpm bench calidad`: ejecuta el banco y anota el resultado.
 *
 *   --sistemas a,b         sistemas a evaluar (por defecto, todos los de SISTEMAS y «produccion»)
 *   --latencia             mide latencia real (sin cachés de disco, consultas en serie) del sistema principal
 *   --citas                evalúa también autocita y verificación (cuesta unos 0,3 $)
 *   --minimo ndcg=0.6,recall=0.8,inventadas=0,latencia=600   falla (código 1) si el sistema principal no llega
 *   --principal nombre     sistema que cuenta para --minimo y para el resumen (por defecto «produccion»)
 *   --no-anotar            no toca RESULTADOS.md ni el historial
 *   --etiqueta texto       nota libre para el historial
 */
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { enParalelo } from '@scholaris/nucleo';
import { DIR_CALIDAD, mapaDocumentos } from './estanteria.js';
import { cargarConsultas, cargarJuicios, RUTA_FOLIOS, type Consulta } from './juego.js';
import { media, medir, percentil, type MetricasConsulta } from './metricas.js';
import { buscadorPara, montar, opcionesPara, SISTEMAS, type Montaje, type Sistema } from './montaje.js';
import { evaluarCitas, type MetricasCitas } from './citas.js';

const RUTA_HISTORIAL = join(DIR_CALIDAD, 'historial.jsonl');
const RUTA_ULTIMO = join(DIR_CALIDAD, 'ultimo.json');
const RUTA_RESULTADOS = join(DIR_CALIDAD, 'RESULTADOS.md');

export interface ResumenSistema {
  ndcg10: number;
  recall20: number;
  mrr: number;
  juzgados10: number;
  repetidos: number;
  porClase: Record<string, { n: number; ndcg10: number; recall20: number; mrr: number }>;
  /** Latencia con cachés de disco (orientativa) y coste por consulta. */
  msP50: number;
  msP95: number;
  usdPorConsulta: number;
}

export interface Ejecucion {
  fecha: string;
  sha: string;
  etiqueta?: string;
  estanteria: string;
  consultas: number;
  pares: number;
  sistemas: Record<string, ResumenSistema>;
  latencia?: { sistema: string; p50: number; p95: number; media: number; porFase: Record<string, number>; usdPorConsulta: number };
  folios?: { total: number; exactos: number; visibles: number; exactosVisibles: number; fallos: string[] };
  citas?: MetricasCitas;
}

function sha(): string {
  try {
    const s = execSync('git rev-parse --short HEAD', { cwd: DIR_CALIDAD }).toString().trim();
    const sucio = execSync('git status --porcelain -- ../../packages/busqueda', { cwd: DIR_CALIDAD }).toString().trim();
    return sucio ? `${s}+cambios` : s;
  } catch { return '?'; }
}

/** El sistema de producción: lo que monta la API con los valores por defecto del buscador (sin comprensión, Jev). */
export const PRODUCCION: Sistema = { nombre: 'produccion', vias: ['lexica', 'densa', 'visual'], comprender: false, reordenador: 'jev' };

/**
 * El buscador tal como estaba antes del banco (commit 2dc34b7), para medir la
 * mejora con los mismos juicios: comprensión con plazo de 350 ms, k=60, pesos
 * antiguos, fundir contiguos, 0,85 por unidad, léxica con todas las expansiones,
 * Jev con 0,7 y la cita literal sola.
 */
export const ANTES: Sistema = {
  nombre: 'antes', vias: ['lexica', 'densa', 'visual'], comprender: true, reordenador: 'jev',
  ajustes: {
    kRrf: 60, fundirContiguos: true, penalizacionUnidad: 0.85, pesoReordenador: 0.7, literalConAfines: false,
    expansionesLexicas: ['parafrasis', 'enunciado', 'traduccion'],
    pesos: {
      conceptual: { lexica: 0.8, densa: 1.0, visual: 0.3 }, visual: { lexica: 0.4, densa: 0.6, visual: 1.0 },
      cita: { lexica: 1.0, densa: 0.45, visual: 0.1 }, temporal: { lexica: 0.8, densa: 1.0, visual: 0.2 },
    },
  },
};

export async function evaluarSistema(m: Montaje, s: Sistema, consultas: Consulta[], plazo?: number): Promise<{ resumen: ResumenSistema; porConsulta: Record<string, MetricasConsulta & { ids: string[] }> }> {
  const juicios = cargarJuicios();
  const b = buscadorPara(m, s, plazo !== undefined ? { plazoComprensionMs: plazo } : {});
  const porConsulta: Record<string, MetricasConsulta & { ids: string[] }> = {};
  const ms: number[] = [];
  const usd0 = m.contador.total().usd;
  await enParalelo(consultas, 6, async (c) => {
    const t = performance.now();
    const r = await b.buscar(c.consulta, opcionesPara(s, 20));
    ms.push(performance.now() - t);
    const ids = r.resultados.map((x) => x.fragmento.id);
    // Repetidos también por documento + ancla + texto (versiones duplicadas del mismo pasaje).
    const claves = r.resultados.map((x) => `${x.documento.id}|${JSON.stringify(x.fragmento.ancla)}|${x.fragmento.texto.slice(0, 120)}`);
    const met = medir(ids, juicios[c.id] ?? {});
    met.repetidos = Math.max(met.repetidos, claves.length - new Set(claves).size);
    porConsulta[c.id] = { ...met, ids };
  });
  const clases = new Map<string, MetricasConsulta[]>();
  for (const c of consultas) for (const cl of ['todas', ...c.clases]) {
    const l = clases.get(cl) ?? [];
    l.push(porConsulta[c.id]!);
    clases.set(cl, l);
  }
  const porClase = Object.fromEntries([...clases].map(([k, l]) => [k, { n: l.length, ndcg10: media(l.map((x) => x.ndcg10)), recall20: media(l.map((x) => x.recall20)), mrr: media(l.map((x) => x.mrr)) }]));
  const todas = Object.values(porConsulta);
  return {
    resumen: {
      ndcg10: media(todas.map((x) => x.ndcg10)), recall20: media(todas.map((x) => x.recall20)), mrr: media(todas.map((x) => x.mrr)),
      juzgados10: media(todas.map((x) => x.juzgados10)), repetidos: todas.reduce((a, x) => a + x.repetidos, 0),
      porClase, msP50: Math.round(percentil(ms, 50)), msP95: Math.round(percentil(ms, 95)),
      usdPorConsulta: (m.contador.total().usd - usd0) / consultas.length,
    },
    porConsulta,
  };
}

/** Latencia real: sin cachés de disco, una consulta detrás de otra (como un usuario). */
export async function medirLatencia(s: Sistema, consultas: Consulta[], plazo = 350): Promise<NonNullable<Ejecucion['latencia']>> {
  const m = montar({ cache: false });
  const b = buscadorPara(m, s, { plazoComprensionMs: plazo });
  // Calentar: la primera carga del índice vectorial y de la tabla de documentos no cuenta.
  await b.buscar('calentamiento', { limite: 5, comprender: false, reordenar: false });
  const ms: number[] = [];
  const fases: Record<string, number[]> = {};
  const usd0 = m.contador.total().usd;
  for (const c of consultas) {
    const r = await b.buscar(c.consulta, opcionesPara(s, 10));
    ms.push(r.tiempos.total ?? 0);
    for (const [k, v] of Object.entries(r.tiempos)) (fases[k] ??= []).push(v);
  }
  return {
    sistema: s.nombre, p50: Math.round(percentil(ms, 50)), p95: Math.round(percentil(ms, 95)), media: Math.round(media(ms)),
    porFase: Object.fromEntries(Object.entries(fases).map(([k, v]) => [k, Math.round(percentil(v, 50))])),
    usdPorConsulta: (m.contador.total().usd - usd0) / consultas.length,
  };
}

export function evaluarFolios(m: Montaje): NonNullable<Ejecucion['folios']> {
  const juego = JSON.parse(readFileSync(RUTA_FOLIOS, 'utf8')) as { paginas: Array<{ documento: string; fisica: number; esperado: string | null; visible: boolean; aceptables?: Array<string | null> }> };
  const docs = mapaDocumentos(m.sql.bd);
  const porCorto = new Map([...docs].map(([id, d]) => [d.corto, id]));
  const q = m.sql.bd.prepare(`SELECT ancla FROM unidades WHERE documento = ? AND json_extract(ancla, '$.fisica') = ?`);
  let exactos = 0, visibles = 0, exactosVisibles = 0;
  const fallos: string[] = [];
  for (const p of juego.paginas) {
    const f = q.get(porCorto.get(p.documento)!, p.fisica) as { ancla: string } | undefined;
    const leido = f ? ((JSON.parse(f.ancla) as { impresa?: string | null }).impresa ?? null) : undefined;
    const ok = leido !== undefined && [p.esperado, ...(p.aceptables ?? [])].some((e) => (e ?? null) === (leido === null ? null : String(leido).toLowerCase()));
    if (ok) exactos++; else fallos.push(`${p.documento} p${p.fisica}: «${leido}» (esperado «${p.esperado}»)`);
    if (p.visible) { visibles++; if (ok) exactosVisibles++; }
  }
  return { total: juego.paginas.length, exactos, visibles, exactosVisibles, fallos };
}

const pct = (x: number) => (x * 100).toFixed(1);
const f3 = (x: number) => x.toFixed(3);

function tablaSistemas(e: Ejecucion): string {
  const filas = Object.entries(e.sistemas).map(([n, s]) => `| ${n} | ${f3(s.ndcg10)} | ${f3(s.recall20)} | ${f3(s.mrr)} | ${s.msP50} / ${s.msP95} | ${(s.usdPorConsulta * 1000).toFixed(3)} | ${pct(s.juzgados10)} % | ${s.repetidos} |`);
  return ['| Sistema | nDCG@10 | Recall@20 | MRR | ms p50 / p95 (con caché) | m$ por consulta | top-10 juzgado | repetidos |', '|---|---|---|---|---|---|---|---|', ...filas].join('\n');
}

function tablaClases(e: Ejecucion): string {
  const sistemas = Object.keys(e.sistemas);
  const clases = [...new Set(sistemas.flatMap((s) => Object.keys(e.sistemas[s]!.porClase)))].sort((a, b) => (a === 'todas' ? -1 : b === 'todas' ? 1 : a.localeCompare(b)));
  const cab = `| Clase (n) | ${sistemas.join(' | ')} |`;
  const sep = `|---|${sistemas.map(() => '---').join('|')}|`;
  const filas = clases.map((c) => `| ${c} (${e.sistemas[sistemas[0]!]!.porClase[c]?.n ?? 0}) | ${sistemas.map((s) => f3(e.sistemas[s]!.porClase[c]?.ndcg10 ?? 0)).join(' | ')} |`);
  return [cab, sep, ...filas].join('\n');
}

function escribirResultados(e: Ejecucion): void {
  const historial = existsSync(RUTA_HISTORIAL) ? readFileSync(RUTA_HISTORIAL, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Ejecucion) : [];
  const cabecera = existsSync(RUTA_RESULTADOS) ? readFileSync(RUTA_RESULTADOS, 'utf8').split('<!-- ultimo -->')[0]! : '# Banco de calidad\n\n';
  const p = e.sistemas.produccion ?? Object.values(e.sistemas)[0]!;
  const nd = 'n/d';
  const hist = historial.slice(-30).reverse().map((h) => {
    const s = h.sistemas.produccion ?? Object.values(h.sistemas)[0];
    return `| ${h.fecha.slice(0, 16).replace('T', ' ')} | ${h.sha} | ${s ? f3(s.ndcg10) : nd} | ${s ? f3(s.recall20) : nd} | ${s ? f3(s.mrr) : nd} | ${h.latencia ? `${h.latencia.p50} / ${h.latencia.p95}` : nd} | ${h.citas ? `${pct(h.citas.precision)} / ${pct(h.citas.exhaustividad)} / ${h.citas.inventadas}` : nd} | ${h.folios ? `${h.folios.exactos}/${h.folios.total}` : nd} | ${h.etiqueta ?? ''} |`;
  });
  const cuerpo = `<!-- ultimo -->
## Última ejecución

${e.fecha.slice(0, 16).replace('T', ' ')}, \`${e.sha}\`${e.etiqueta ? `, ${e.etiqueta}` : ''}. Estantería \`${e.estanteria}\`, ${e.consultas} consultas, ${e.pares} juicios.
Sistema principal: nDCG@10 **${f3(p.ndcg10)}**, Recall@20 **${f3(p.recall20)}**, MRR **${f3(p.mrr)}**.

${tablaSistemas(e)}

### nDCG@10 por clase de consulta

${tablaClases(e)}
${e.latencia ? `
### Latencia real (sin cachés, en serie, ${e.latencia.sistema})

p50 **${e.latencia.p50} ms**, p95 ${e.latencia.p95} ms, media ${e.latencia.media} ms; ${(e.latencia.usdPorConsulta * 1000).toFixed(3)} m$ por consulta. Mediana por fase: ${Object.entries(e.latencia.porFase).map(([k, v]) => `${k} ${v}`).join(', ')}.
` : ''}${e.folios ? `
### Folios

${e.folios.exactos} de ${e.folios.total} exactos (${e.folios.exactosVisibles} de ${e.folios.visibles} con el número impreso a la vista).${e.folios.fallos.length ? `\nFallos: ${e.folios.fallos.join('; ')}.` : ''}
` : ''}${e.citas ? `
### Citas

${e.citas.afirmaciones} afirmaciones. Precisión **${pct(e.citas.precision)} %**, exhaustividad **${pct(e.citas.exhaustividad)} %**, citas inventadas **${e.citas.inventadas}**, citas en afirmaciones sin respaldo ${e.citas.indebidas}, veredicto de verificación correcto ${pct(e.citas.verificacion)} %. ${e.citas.ms} ms y ${(e.citas.usd / e.citas.afirmaciones * 1000).toFixed(2)} m$ por afirmación.
` : ''}
## Historial (sistema principal)

| Fecha | Commit | nDCG@10 | Recall@20 | MRR | Latencia p50 / p95 | Citas P / R / inventadas | Folios | Nota |
|---|---|---|---|---|---|---|---|---|
${hist.join('\n')}
`;
  writeFileSync(RUTA_RESULTADOS, cabecera + cuerpo);
}

export async function ejecutar(args: string[]): Promise<void> {
  const valor = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const nombres = valor('--sistemas')?.split(',');
  const todos = [ANTES, ...SISTEMAS, PRODUCCION];
  const sistemas = nombres ? todos.filter((s) => nombres.includes(s.nombre)) : todos;
  const principal = valor('--principal') ?? 'produccion';
  const m = montar();
  const consultas = cargarConsultas();
  const juicios = cargarJuicios();
  const etiqueta = valor('--etiqueta');
  const e: Ejecucion = {
    fecha: new Date().toISOString(), sha: sha(), ...(etiqueta ? { etiqueta } : {}),
    estanteria: m.sql.huella, consultas: consultas.length,
    pares: Object.values(juicios).reduce((a, q) => a + Object.keys(q).length, 0), sistemas: {},
  };
  const detalle: Record<string, unknown> = {};
  for (const s of sistemas) {
    // Producción: comprensión con su plazo real (350 ms), con la caché de disco del redactor.
    const r = await evaluarSistema(m, s, consultas, s.nombre === 'produccion' || s.nombre === 'antes' ? 350 : undefined);
    e.sistemas[s.nombre] = r.resumen;
    detalle[s.nombre] = r.porConsulta;
    console.error(`${s.nombre.padEnd(14)} nDCG@10 ${f3(r.resumen.ndcg10)}  R@20 ${f3(r.resumen.recall20)}  MRR ${f3(r.resumen.mrr)}  p50 ${r.resumen.msP50} ms  top10 juzgado ${pct(r.resumen.juzgados10)} %  repetidos ${r.resumen.repetidos}`);
  }
  if (args.includes('--latencia')) {
    e.latencia = await medirLatencia(todos.find((s) => s.nombre === principal) ?? PRODUCCION, consultas.filter((c) => !c.pagina).slice(0, 80));
    console.error(`latencia ${e.latencia.sistema}: p50 ${e.latencia.p50} ms, p95 ${e.latencia.p95} ms`, e.latencia.porFase);
  }
  e.folios = evaluarFolios(m);
  console.error(`folios: ${e.folios.exactos}/${e.folios.total}`);
  if (args.includes('--citas')) {
    const { detalle: d, ...c } = await evaluarCitas(m);
    e.citas = c;
    detalle.citas = d;
    console.error(`citas: P ${pct(c.precision)} %, R ${pct(c.exhaustividad)} %, inventadas ${c.inventadas}, indebidas ${c.indebidas}, verificación ${pct(c.verificacion)} %`);
  }
  writeFileSync(RUTA_ULTIMO, JSON.stringify({ ...e, detalle }, null, 1));
  if (!args.includes('--no-anotar')) {
    appendFileSync(RUTA_HISTORIAL, JSON.stringify(e) + '\n');
    escribirResultados(e);
  }
  const minimo = valor('--minimo');
  if (minimo) {
    const s = e.sistemas[principal] as unknown as Record<string, number> | undefined;
    const fallos: string[] = [];
    for (const par of minimo.split(',')) {
      const [k, v] = par.split('=') as [string, string];
      const umbral = Number(v);
      const actual = k === 'inventadas' ? e.citas?.inventadas : k === 'latencia' ? e.latencia?.p50 : s?.[k === 'ndcg' ? 'ndcg10' : k === 'recall' ? 'recall20' : k];
      if (actual === undefined) continue;
      const malo = k === 'inventadas' || k === 'latencia' ? actual > umbral : actual < umbral;
      if (malo) fallos.push(`${k} = ${actual} (umbral ${umbral})`);
    }
    if (fallos.length) { console.error(`REGRESIÓN: ${fallos.join('; ')}`); process.exitCode = 1; }
  }
}
