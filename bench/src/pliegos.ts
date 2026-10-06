import { Agent, setGlobalDispatcher } from 'undici';
setGlobalDispatcher(new Agent({ connections: 256 }));
/**
 * `tsx src/pliegos.ts <pdf> <desde> <hasta> <tam,tam,…>`: mide el tamaño de pliego.
 * Lee el mismo tramo de páginas con pliegos de distintos tamaños, todos en
 * paralelo, y anota tiempo de reloj, coste y parecido con la capa de texto.
 */

import { readFile } from 'node:fs/promises';
import { abrirCortador } from '@scholaris/imprenta';
import { crearInteligencia, type UsoProveedor } from '@scholaris/proveedores';
import { enParalelo, type PaginaLeida } from '@scholaris/nucleo';
import { normalizar, similitud } from '../../packages/ingesta/src/texto.js';
import { convertirEnMemoria } from '@scholaris/imprenta/node';
import { cargarEntorno } from './entorno.js';

const [ruta, d, h, tams, modelo] = process.argv.slice(2);
const desde = Number(d), hasta = Number(h);
const bytes = new Uint8Array(await readFile(ruta as string));
const cortador = await abrirCortador(bytes);
const paginas = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
const capa = await convertirEnMemoria(ruta as string, { paginas, ladoDigital: 0 });
const textoCapa = new Map(capa.paquete.contenido.clase === 'pdf' ? capa.paquete.contenido.paginas.map((p) => [p.fisica, p.cuerpo]) : []);

for (const tam of (tams ?? '4').split(',').map(Number)) {
  const usos: UsoProveedor[] = [];
  const env = cargarEntorno();
  if (modelo) env.GEMINI_LECTOR_MODELO = modelo;
  const ia = crearInteligencia(env, { onUso: (u) => usos.push(u), concurrencia: 64 });
  const cortes: Array<[number, number]> = [];
  for (let a = desde; a <= hasta; a += tam) cortes.push([a, Math.min(hasta, a + tam - 1)]);
  const t0 = Date.now();
  const lat: number[] = [];
  const res = await enParalelo(cortes, 64, async ([a, b]) => {
    const t = Date.now();
    const pdf = await cortador.cortar(a, b);
    try { return await ia.lector.leerPliego({ pdf, primeraFisica: a }); }
    catch (e) { console.error(`pliego ${a}-${b}:`, String(e).slice(0, 200)); return [] as PaginaLeida[]; }
    finally { lat.push(Date.now() - t); }
  });
  const ms = Date.now() - t0;
  const leidas = res.flat();
  const sims = leidas.map((p) => { const c = textoCapa.get(p.fisica) ?? ''; return c.length > 200 ? similitud(normalizar(c).slice(0, 3000), normalizar(p.texto + ' ' + p.notas.join(' ')).slice(0, 3000)) : null; }).filter((x): x is number => x !== null);
  const usd = usos.reduce((s, u) => s + (u.usd ?? 0), 0);
  const salida = usos.reduce((s, u) => s + u.tokensSalida, 0);
  const modelos = [...new Set(usos.map((u) => u.modelo))].join(',');
  console.log(JSON.stringify({ tam, pliegos: cortes.length, paginasLeidas: leidas.length, de: paginas.length, msReloj: ms, latMax: Math.max(...lat), latMediana: lat.sort((x, y) => x - y)[Math.floor(lat.length / 2)], usd: Number(usd.toFixed(5)), usdPorPagina: Number((usd / paginas.length).toFixed(6)), tokensSalida: salida, simCapa: Number((sims.reduce((s, x) => s + x, 0) / Math.max(1, sims.length)).toFixed(3)), folios: leidas.filter((p) => p.folio).length, notas: leidas.reduce((s, p) => s + p.notas.length, 0), modelos, llamadas: usos.length }));
}
