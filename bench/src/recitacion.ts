/**
 * `tsx src/recitacion.ts <pdf> [desde hasta]`: lee las páginas con la cascada real y anota qué
 * lector acabó leyendo las que Gemini bloquea por recitación (texto con derechos).
 */
import { Agent, setGlobalDispatcher } from 'undici';
setGlobalDispatcher(new Agent({ connections: 128, keepAliveTimeout: 4_000, keepAliveMaxTimeout: 10_000, allowH2: true }));
import { readFile } from 'node:fs/promises';
import { abrirCortador } from '@scholaris/imprenta';
import { crearInteligencia } from '@scholaris/proveedores';
import { enParalelo, type PaginaLeida } from '@scholaris/nucleo';
import { cargarEntorno } from './entorno.js';

const [ruta, d = '1', h] = process.argv.slice(2);
const bytes = new Uint8Array(await readFile(ruta as string));
const cortador = await abrirCortador(bytes);
const desde = Number(d), hasta = Number(h ?? cortador.paginas);
const pasos: Array<{ lector: string; paginas: number[]; motivo: string }> = [];
const ia = crearInteligencia(cargarEntorno(), { calidadLector: 'rapida', concurrencia: 48, alPasarLector: (i) => pasos.push({ lector: i.lector, paginas: i.paginas, motivo: i.motivo.slice(0, 120) }) });
const cortes: Array<[number, number]> = [];
for (let a = desde; a <= hasta; a += 4) cortes.push([a, Math.min(hasta, a + 3)]);
const t0 = Date.now();
const leidas = (await enParalelo(cortes, 24, async ([a, b]) => {
  try { return await ia.lector.leerPliego({ pdf: await cortador.cortar(a, b), primeraFisica: a }); } catch (e) { console.error(a, b, String(e).slice(0, 200)); return [] as PaginaLeida[]; }
})).flat() as Array<PaginaLeida & { lector?: string; intentos?: string[] }>;
const recitadas = new Set(pasos.filter((p) => /recitaci/.test(p.motivo)).flatMap((p) => p.paginas));
console.log(JSON.stringify({ ms: Date.now() - t0, paginas: leidas.length, recitadas: [...recitadas].sort((a, b) => a - b), pasos: pasos.filter((p) => !/bucle/.test(p.motivo)) }, null, 1));
for (const f of [...recitadas].sort((a, b) => a - b)) {
  const p = leidas.find((x) => x.fisica === f);
  console.log(`--- p. ${f}: lector=${p?.lector} intentos=${p?.intentos?.join(' → ')} folio=${p?.folio} chars=${p?.texto.length}\n${p?.texto.slice(0, 300)}`);
}
console.log(JSON.stringify(ia.contador.detalle(), null, 1));
