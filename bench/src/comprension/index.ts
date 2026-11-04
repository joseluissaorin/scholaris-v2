/**
 * `pnpm bench comprension [orden]`: el banco de comprensión (docs/COMPRENSION.md, «Banco»).
 *
 *   (sin orden) | ejecutar   pregunta todo el banco al sistema y lo juzga
 *       --modo responder|investigar   modo del sistema (por defecto, responder)
 *       --solo q01,q02                solo esas preguntas
 *       --juez <modelo>               juez de la rúbrica y de las citas (por defecto gemini-4-argon)
 *       --repetir                     vuelve a preguntar aunque haya respuesta guardada
 *       --sin-citas                   no juzga las citas
 *       --video <doc>=<ruta>          copia local del vídeo para comprobar citas visuales (también bench/datos/comprension/videos.json)
 *       --concurrencia N              preguntas a la vez (por defecto 2)
 *       --etiqueta texto              nota libre para el informe
 *   validar                    forma del banco y citas literales contra las fuentes
 *   calibrar                   acuerdo de los jueces con la calificación manual (calibracion.json del banco privado)
 *   transmedia --dir <carpeta> cobertura de las alineaciones y la ficha de una relación frente a la rúbrica
 *       --juez <modelo> | --sin-juez   (por defecto gemini-3.8-flash)
 *       --jueces a,b                  modelos que se comparan
 *
 * Necesita SCHOLARIS_URL y SCHOLARIS_CLAVE (y GEMINI_API_KEY) en el entorno o en
 * ~/.claude/.secrets/{scholaris,gemini}.env. Las respuestas, las fuentes y la caché
 * del juez se guardan en bench/datos/comprension (fuera del repositorio) y el informe
 * en bench/resultados/comprension-<fecha>-<modo>.{json,md}.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearCliente } from '@scholaris/contrato';
import { enParalelo } from '@scholaris/nucleo';
import { cargarEntorno } from '../entorno.js';
import { clientePara } from './clientes.js';
import { cargarFuentes, completarFuentes, type Fuentes, type LectorApi } from './fuentes.js';
import { informeMarkdown, resumir } from './informe.js';
import { juzgarPregunta, juzgarRubrica } from './juez.js';
import { crearMirador } from './mirador.js';
import { juezConCache, juezGemini, type ModeloJuez } from './modelo.js';
import { cargarBanco, comprobarCitas, erroresDeForma, filtrar } from './preguntas.js';
import { acuerdo } from './puntuar.js';
import type { JuicioPregunta, ModoRespuesta, RespuestaNormalizada, VeredictoPunto } from './tipos.js';

const DIR_BENCH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// El banco cita obras con derechos (el cuento de Senel Paz, los diálogos de la película): no va
// al repositorio público. Vive en bench/datos/comprension/banco (ignorado por git) o donde diga
// SCHOLARIS_BANCO_COMPRENSION; la copia de José Luis está en Dropbox, Dev/scholaris-banco-comprension.
export const DIR_BANCO = process.env.SCHOLARIS_BANCO_COMPRENSION || join(DIR_BENCH, 'datos', 'comprension', 'banco');
export const RUTA_BANCO = join(DIR_BANCO, 'preguntas.json');
const RUTA_CALIBRACION = join(DIR_BANCO, 'calibracion.json');
const DIR_DATOS = join(DIR_BENCH, 'datos', 'comprension');
const DIR_RESULTADOS = join(DIR_BENCH, 'resultados');
// Elegido por calibración (calibracion.json del banco privado): acuerdo exacto con la nota manual del 89 % frente al 78 % de gemini-3.1-pro-preview.
const JUEZ_POR_DEFECTO = 'gemini-4-argon';

function opcion(args: string[], k: string): string | undefined {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
}

function entorno(): { base: string; clave: string; gemini: string } {
  const env = { ...cargarEntorno(['scholaris', 'gemini']) };
  for (const k of ['SCHOLARIS_URL', 'SCHOLARIS_CLAVE', 'GEMINI_API_KEY']) if (process.env[k]) env[k] = process.env[k] as string;
  if (!env.SCHOLARIS_URL || !env.SCHOLARIS_CLAVE) throw new Error('Faltan SCHOLARIS_URL y SCHOLARIS_CLAVE.');
  if (!env.GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY.');
  return { base: env.SCHOLARIS_URL, clave: env.SCHOLARIS_CLAVE, gemini: env.GEMINI_API_KEY };
}

function sha(): string {
  try { return execSync('git rev-parse --short HEAD', { cwd: DIR_BENCH }).toString().trim(); } catch { return '?'; }
}

function lectorApi(base: string, clave: string): LectorApi {
  const api = crearCliente({ base, token: clave });
  return {
    documento: async (id) => await api.documentos.obtener(id) as unknown as { id: string; titulo?: string; tipo: string; unidades?: number; duracion?: number },
    unidades: (id, desde, hasta) => api.documentos.unidades(id, desde, hasta),
  };
}

async function fuentesDelBanco(base: string, clave: string, ids: string[], refrescar = false): Promise<Fuentes> {
  return cargarFuentes(lectorApi(base, clave), ids, join(DIR_DATOS, 'fuentes'), refrescar);
}

function juez(clave: string, modelo: string): ModeloJuez {
  return juezConCache(juezGemini({ clave, modelo }), join(DIR_DATOS, 'cache-juez', modelo));
}

function videos(args: string[]): Record<string, string> {
  const ruta = join(DIR_DATOS, 'videos.json');
  const v: Record<string, string> = existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) as Record<string, string> : {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--video') continue;
    const [doc, r] = String(args[i + 1]).split('=');
    if (doc && r) v[doc] = r;
  }
  return v;
}

async function ejecutar(args: string[]): Promise<void> {
  const env = entorno();
  const modo = (opcion(args, '--modo') ?? 'responder') as ModoRespuesta;
  if (modo !== 'responder' && modo !== 'investigar') throw new Error(`Modo desconocido: ${modo}`);
  const banco = cargarBanco(RUTA_BANCO);
  const preguntas = filtrar(banco.preguntas, opcion(args, '--solo')?.split(','));
  const modeloJuez = opcion(args, '--juez') ?? JUEZ_POR_DEFECTO;
  const j = juez(env.gemini, modeloJuez);
  const titulos = Object.fromEntries(Object.entries(banco.documentos).map(([k, v]) => [k, v.titulo]));
  const fuentes = await fuentesDelBanco(env.base, env.clave, Object.keys(banco.documentos));
  const vs = videos(args);
  const mirador = Object.keys(vs).length ? crearMirador({ videos: vs, juez: juez(env.gemini, modeloJuez), dirRecortes: join(DIR_DATOS, 'recortes') }) : undefined;
  const preguntar = clientePara(modo, { base: env.base, clave: env.clave });
  const dirRespuestas = join(DIR_DATOS, 'respuestas', modo);
  mkdirSync(dirRespuestas, { recursive: true });
  const repetir = args.includes('--repetir');
  const detalle: Array<{ pregunta: (typeof preguntas)[number]; respuesta: RespuestaNormalizada; juicio: JuicioPregunta }> = [];
  let hechas = 0;
  await enParalelo(preguntas, Number(opcion(args, '--concurrencia') ?? 2), async (p) => {
    const ruta = join(dirRespuestas, `${p.id}.json`);
    let r: RespuestaNormalizada;
    if (!repetir && existsSync(ruta)) r = JSON.parse(readFileSync(ruta, 'utf8')) as RespuestaNormalizada;
    else {
      r = await preguntar(p);
      // Una respuesta con error no se guarda: la próxima vez se vuelve a pedir.
      if (!r.error) writeFileSync(ruta, JSON.stringify(r, null, 1));
    }
    // Las citas a otros documentos de la biblioteca se comprueban contra su texto, no se dan por inventadas.
    await completarFuentes(fuentes, lectorApi(env.base, env.clave), r.citas.map((c) => c.documento), join(DIR_DATOS, 'fuentes'));
    let juicio: JuicioPregunta;
    try {
      juicio = await juzgarPregunta(p, r, { juez: j, fuentes, titulos, ...(mirador ? { mirador } : {}), sinCitas: args.includes('--sin-citas') });
    } catch (e) {
      // Una pregunta que no se puede juzgar no tumba el banco: queda fuera del informe y se avisa.
      console.error(`  ${p.id}: el juez falló (${(e as Error).message.slice(0, 160)}); se omite`);
      return;
    }
    detalle.push({ pregunta: p, respuesta: r, juicio });
    console.error(`  ${p.id} (${++hechas}/${preguntas.length}) nota ${juicio.puntuacion.nota.toFixed(1)}, acierto ${(juicio.puntuacion.acierto * 100).toFixed(0)} %, citas ${juicio.puntuacion.citasSostienen}/${juicio.puntuacion.citas}${r.error ? `, ERROR ${r.error.slice(0, 80)}` : ''}`);
  });
  detalle.sort((a, b) => a.pregunta.id.localeCompare(b.pregunta.id));
  const etiqueta = opcion(args, '--etiqueta');
  const e = resumir({ fecha: new Date().toISOString(), modo, juez: modeloJuez, base: env.base, sha: sha(), ...(etiqueta ? { etiqueta } : {}), detalle });
  mkdirSync(DIR_RESULTADOS, { recursive: true });
  const nombre = `comprension-${e.fecha.slice(0, 10)}-${modo}`;
  writeFileSync(join(DIR_RESULTADOS, `${nombre}.json`), JSON.stringify(e, null, 1));
  writeFileSync(join(DIR_RESULTADOS, `${nombre}.md`), informeMarkdown(e));
  console.error(`\nNota ${e.total.nota.toFixed(1)}; acierto ${(e.total.acierto * 100).toFixed(1)} %; precisión de citas ${(e.total.precisionCitas * 100).toFixed(1)} % (${e.total.citas}); inventadas ${e.total.citasInventadas}; trampas ${e.total.trampas}; juez ${e.coste.usdJuez.toFixed(3)} $`);
  console.error(`Informe: ${join(DIR_RESULTADOS, `${nombre}.md`)}`);
}

async function validar(): Promise<void> {
  const banco = cargarBanco(RUTA_BANCO);
  const forma = erroresDeForma(banco);
  for (const x of forma) console.error(`FORMA ${x}`);
  const env = entorno();
  const fuentes = await fuentesDelBanco(env.base, env.clave, Object.keys(banco.documentos));
  const citas = comprobarCitas(banco, fuentes);
  for (const c of citas) console.error(`CITA ${c.punto}: ${c.problema}: «${c.ancla.cita}» (${c.ancla.fisica !== undefined ? `unidad ${c.ancla.fisica}` : `${c.ancla.t0}-${c.ancla.t1} s`})`);
  const n = banco.preguntas.length, puntos = banco.preguntas.reduce((a, p) => a + p.rubrica.puntos.length, 0);
  console.error(`${n} preguntas, ${puntos} puntos: ${forma.length} errores de forma, ${citas.length} citas que no aparecen en su sitio.`);
  if (forma.length || citas.length) process.exitCode = 1;
}

/**
 * Calibración: calificaciones manuales de algunos puntos ({ "q01": { "q01.1": "cubierto", … } })
 * frente a lo que dicen los jueces sobre las respuestas guardadas.
 */
async function calibrar(args: string[]): Promise<void> {
  const env = entorno();
  const banco = cargarBanco(RUTA_BANCO);
  const manual = JSON.parse(readFileSync(opcion(args, '--manual') ?? RUTA_CALIBRACION, 'utf8')) as { modo?: ModoRespuesta; notas: Record<string, Record<string, VeredictoPunto>> };
  const modo = manual.modo ?? 'responder';
  const titulos = Object.fromEntries(Object.entries(banco.documentos).map(([k, v]) => [k, v.titulo]));
  const modelos = (opcion(args, '--jueces') ?? 'gemini-3.1-pro-preview,gemini-4-argon').split(',');
  for (const m of modelos) {
    const j = juez(env.gemini, m);
    const suyo: Record<string, VeredictoPunto> = {}, mio: Record<string, VeredictoPunto> = {};
    let usd = 0;
    for (const [qid, notas] of Object.entries(manual.notas)) {
      const p = banco.preguntas.find((x) => x.id === qid);
      const ruta = join(DIR_DATOS, 'respuestas', modo, `${qid}.json`);
      if (!p || !existsSync(ruta)) continue;
      const r = JSON.parse(readFileSync(ruta, 'utf8')) as RespuestaNormalizada;
      const res = await juzgarRubrica(p, r, j, titulos);
      usd += res.usd;
      for (const x of res.puntos) if (notas[x.id]) { suyo[x.id] = x.veredicto; mio[x.id] = notas[x.id] as VeredictoPunto; }
    }
    const a = acuerdo(mio, suyo);
    const discrepancias = Object.keys(mio).filter((k) => mio[k] !== suyo[k]).map((k) => `${k}: manual ${mio[k]}, juez ${suyo[k] ?? '—'}`);
    console.log(JSON.stringify({ juez: m, ...a, usd: Number(usd.toFixed(4)), discrepancias }, null, 1));
  }
}

async function transmedia(args: string[]): Promise<void> {
  const dir = opcion(args, '--dir');
  if (!dir) throw new Error('Falta --dir (la carpeta con relaciones.json y alineaciones-*.json).');
  const { informeTransmedia } = await import('./transmedia.js');
  const banco = cargarBanco(RUTA_BANCO);
  let j: ModeloJuez | null = null;
  if (!args.includes('--sin-juez')) {
    const env = { ...cargarEntorno(['gemini']) };
    const clave = process.env.GEMINI_API_KEY ?? env.GEMINI_API_KEY;
    if (!clave) throw new Error('Falta GEMINI_API_KEY.');
    j = juezConCache(juezGemini({ clave, modelo: opcion(args, '--juez') ?? 'gemini-3.8-flash' }), join(DIR_DATOS, 'cache-juez-transmedia'));
  }
  for (const i of await informeTransmedia(dir, banco, j)) {
    console.log(`${i.relacion}: ${i.cubiertos}/${i.puntos} puntos con alineación en sus anclas${i.juez ? `; juez: ${i.juez.si} sí, ${i.juez.parcial} parcial, ${i.juez.no} no (${i.juez.usd.toFixed(3)} USD)` : ''}`);
    for (const [q, x] of Object.entries(i.porPregunta)) console.log(`  ${q}: ${x.cubiertos}/${x.puntos}${x.si !== undefined ? ` (sí ${x.si})` : ''}`);
  }
}

export async function comprension(args: string[]): Promise<void> {
  const [orden, ...resto] = args;
  if (orden === 'validar') return validar();
  if (orden === 'calibrar') return calibrar(resto);
  if (orden === 'ejecutar') return ejecutar(resto);
  if (orden === 'transmedia') return transmedia(resto);
  if (orden === undefined || orden.startsWith('--')) return ejecutar(args);
  throw new Error(`Orden desconocida: ${orden}`);
}
