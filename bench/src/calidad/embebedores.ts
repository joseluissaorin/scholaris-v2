/**
 * `pnpm bench calidad embebedores`: compara embebedores sobre el banco público.
 *
 * Revectoriza los fragmentos de la estantería con cada embebedor (en un
 * espacio propio, que se borra al terminar) y mide la vía densa sola y la
 * híbrida léxica + densa, con los mismos juicios. Gemini Embedding 2 usa los
 * vectores que ya traen los SPDF (y las consultas en caché).
 *
 *   --modelos ollama:embeddinggemma-2,ollama:embeddinggemma-2@256,ollama:bge-m3,inferbox:qwen3-vl-embed,servidor:embeddinggemma-2
 *   --servidor http://localhost:8812     (INFERENCIA_EMBEBEDOR_URL: EmbeddingGemma 2 multimodal)
 *   --reordenador http://localhost:8812  (un /v1/rerank local, p. ej. bge-reranker-v2-m3: añade «léxica + densa + reordenador»)
 *   --citas                              con el último embebedor de la lista, evalúa también autocita y verificación
 *                                        con el juez y el redactor del entorno sin conexión (INFERENCIA_URL…)
 *   --ollama http://localhost:11434     (OLLAMA_URL)
 *   --inferbox http://192.168.1.102:8811 (INFERBOX_URL, INFERBOX_API_KEY)
 *
 * Sin claves de nube: los vectores de consulta de Gemini salen de la caché.
 */
import { performance } from 'node:perf_hooks';
import { ContadorUso, crearOpenAICompatible, type SaborServidor } from '@scholaris/proveedores';
import type { Embebedor } from '@scholaris/nucleo';
import { IndiceVectorialSQL } from '@scholaris/busqueda';
import { textoVectorizable } from '@scholaris/ingesta';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { abrirEstanteria, DIR_DATOS_CALIDAD } from './estanteria.js';
import { cargarConsultas } from './juego.js';
import { embebedorConCache, reordenadorConCache, type Montaje, type Sistema } from './montaje.js';
import { evaluarSistema } from './ejecutar.js';
import { cargarEntorno } from '../entorno.js';
import { crearInteligencia, crearInteligenciaSinConexion } from '@scholaris/proveedores';
import { evaluarCitas } from './citas.js';

const SISTEMAS_EMB: Sistema[] = [
  { nombre: 'densa', vias: ['densa'], comprender: false },
  { nombre: 'lexica+densa', vias: ['lexica', 'densa'], comprender: false },
];
/** Con --reordenador URL: además, la híbrida con un reordenador local (/v1/rerank). */
const CON_REORDENADOR: Sistema = { nombre: 'lexica+densa+reord', vias: ['lexica', 'densa'], comprender: false, reordenador: 'local' };

function arg(args: string[], nombre: string): string | undefined {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function embebedores(args: string[]): Promise<void> {
  const lista = (arg(args, 'modelos') ?? 'gemini,ollama:embeddinggemma-2,ollama:embeddinggemma-2@256,ollama:bge-m3').split(',').map((x) => x.trim()).filter(Boolean);
  const urlOllama = arg(args, 'ollama') ?? process.env.OLLAMA_URL ?? 'http://localhost:11434';
  const urlInferbox = arg(args, 'inferbox') ?? process.env.INFERBOX_URL ?? 'http://192.168.1.102:8811';
  // «servidor:embeddinggemma-2»: el servidor multimodal de deploy/inferencia/embeddinggemma2.
  const urlServidor = arg(args, 'servidor') ?? process.env.INFERENCIA_EMBEBEDOR_URL ?? 'http://localhost:8812';
  const copia = join(DIR_DATOS_CALIDAD, 'estanteria-embebedores.sqlite');
  const sql = abrirEstanteria(copia);
  const consultas = cargarConsultas();
  const fragmentos = await sql.ejecutar<{ id: string; documento: string; texto: string; contexto: string; seccion: string | null }>('SELECT id, documento, texto, contexto, seccion FROM fragmentos ORDER BY n');
  const textos = fragmentos.map((f) => textoVectorizable({ texto: f.texto, contexto: f.contexto, seccion: f.seccion ? (JSON.parse(f.seccion) as string[]) : [] }));
  const filas: string[] = [];
  const urlReord = arg(args, 'reordenador');
  const reordenadorLocal = urlReord ? reordenadorConCache(crearOpenAICompatible({ url: urlReord, sabor: 'generico', urlReordenador: urlReord, concurrencia: 2 }).reordenador()) : undefined;
  const sistemas = reordenadorLocal ? [...SISTEMAS_EMB, CON_REORDENADOR] : SISTEMAS_EMB;

  for (const nombre of lista) {
    let embebedor: Embebedor;
    let msDocs = 0;
    let propio = false;
    if (nombre === 'gemini') {
      const env = cargarEntorno(['gemini']);
      const ia = crearInteligencia({ GEMINI_API_KEY: env.GEMINI_API_KEY ?? 'sin-clave' }, {});
      embebedor = embebedorConCache(ia.embebedor);
    } else {
      const [saborDado, resto] = nombre.split(':') as [SaborServidor | 'servidor', string];
      const sabor: SaborServidor = saborDado === 'servidor' ? 'generico' : saborDado;
      const [modelo, dimsTxt] = resto.split('@') as [string, string | undefined];
      const c = crearOpenAICompatible({
        url: sabor === 'inferbox' ? urlInferbox : urlOllama, sabor,
        ...(saborDado === 'servidor' ? { urlEmbebedor: urlServidor } : {}),
        ...(sabor === 'inferbox' ? { clave: process.env.INFERBOX_API_KEY ?? cargarEntorno([]).INFERBOX_API_KEY ?? '' } : {}),
        modelos: { embebedor: modelo }, ...(dimsTxt ? { dims: Number(dimsTxt) } : {}), concurrencia: 4,
      });
      embebedor = c.embebedor({ modelo });
      propio = true;
      // Revectorizar los fragmentos en un espacio propio.
      await sql.ejecutar('DELETE FROM vectores WHERE espacio = ?', embebedor.espacio.id);
      await sql.ejecutar('INSERT OR REPLACE INTO espacios (id, proveedor, modelo, dims, normalizado, modalidades) VALUES (?, ?, ?, ?, 1, ?)',
        embebedor.espacio.id, embebedor.espacio.proveedor, embebedor.espacio.modelo, embebedor.espacio.dims, JSON.stringify(embebedor.espacio.modalidades));
      // Calentar (carga del modelo) antes de medir.
      await embebedor.vectorizar([{ modalidad: 'texto', texto: 'calentamiento' }], 'documento');
      const t0 = performance.now();
      const vs = await embebedor.vectorizar(textos.map((texto) => ({ modalidad: 'texto' as const, texto })), 'documento');
      msDocs = performance.now() - t0;
      const indice = new IndiceVectorialSQL(sql, embebedor.espacio);
      await indice.insertar('banco', fragmentos.map((f, i) => ({ id: f.id, valores: vs[i] as Float32Array, metadatos: { objetivo: 'fragmento', documento: f.documento } })));
    }
    // Consultas: tiempo de vectorizar las 66 (en serie, como en la búsqueda).
    let msConsulta = 0;
    if (propio) {
      const t0 = performance.now();
      for (const c of consultas.slice(0, 20)) await embebedor.vectorizar([{ modalidad: 'texto', texto: c.consulta }], 'consulta');
      msConsulta = (performance.now() - t0) / 20;
    }
    const m = {
      sql, embebedor, indice: new IndiceVectorialSQL(sql, embebedor.espacio), contador: new ContadorUso(),
      ia: undefined as never, redactor: undefined as never, reordenadores: reordenadorLocal ? { local: reordenadorLocal } : {}, env: {},
    } as unknown as Montaje;
    const res: Record<string, number[]> = {};
    for (const s of sistemas) {
      const { resumen } = await evaluarSistema(m, s, consultas);
      res[s.nombre] = [resumen.ndcg10, resumen.recall20, resumen.mrr];
    }
    const f = (x: number[] | undefined) => (x ? x.map((v) => v.toFixed(3)).join(' / ') : '—');
    const linea = `| ${embebedor.espacio.id} | ${f(res.densa)} | ${f(res['lexica+densa'])} | ${f(res['lexica+densa+reord'])} | ${propio ? `${(msDocs / textos.length).toFixed(1)} ms` : '—'} | ${propio ? `${msConsulta.toFixed(0)} ms` : '—'} |`;
    console.log(linea);
    filas.push(linea);
    if (args.includes('--citas') && nombre === lista[lista.length - 1]) {
      // Todo sin conexión: juez y redactor del servidor propio; el reordenador local hace de «jev» en el sistema «completa».
      const ia = crearInteligenciaSinConexion({ ...process.env, SCHOLARIS_SIN_CONEXION: '1' });
      const mc = { ...m, ia: { ...ia, embebedor }, redactor: ia.redactor, reordenadores: { jev: reordenadorLocal ?? ia.reordenador } } as unknown as Montaje;
      const r = await evaluarCitas(mc, 'completa');
      console.log(`Citas sin conexión (${ia.juez.nombre}): precisión ${(r.precision * 100).toFixed(1)} %, exhaustividad ${(r.exhaustividad * 100).toFixed(1)} %, inventadas ${r.inventadas}, indebidas ${r.indebidas}, verificación ${(r.verificacion * 100).toFixed(1)} %, ${r.ms.toFixed(0)} ms por afirmación`);
    }
  }
  sql.bd.close();
  if (!args.includes('--conservar')) rmSync(copia, { force: true });
  console.log(`\n${fragmentos.length} fragmentos, ${consultas.length} consultas. Columnas: nDCG@10 / Recall@20 / MRR.\n`);
  console.log('| Espacio | densa | léxica + densa | léxica + densa + reordenador local | ms por fragmento (lote) | ms por consulta |\n|---|---|---|---|---|---|');
  for (const l of filas) console.log(l);
}
