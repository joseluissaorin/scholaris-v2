/**
 * Memoria retenida (tras recoger la basura) de lo que la alineación tiene en mano:
 * la carga de antes (material entero, todas las fichas, todos los segmentos y la
 * percepción) frente a la de ahora (lo ligero de `materialObra` y un tramo por grupo).
 *
 *   node --expose-gc --import tsx apps/api/scripts/medir-retenido.ts --estanteria est.sqlite --percepcion DOC=ruta.json
 */
import { readFileSync } from 'node:fs';
import type { PercepcionMedio } from '@scholaris/nucleo';
import { aplicarEsquemaFunciones } from '@scholaris/funciones';
import { cargarTramo, leerMaterial, materialObra, ordenesDe, type ContextoComprension } from '@scholaris/ingesta';
import { abrirSpdf, leerFichas, leerRelaciones, leerSegmentos, leerApariciones } from '@scholaris/spdf';

const args = process.argv.slice(2);
const valor = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const [docP, rutaP] = valor('percepcion')!.split('=') as [string, string];
const gc = (globalThis as { gc?: () => void }).gc!;
const archivo = await abrirSpdf(new Uint8Array(readFileSync(valor('estanteria')!)));
await aplicarEsquemaFunciones(archivo.sql);
const [rel] = await leerRelaciones(archivo.sql);
const percepcion = async (d: string) => (d === docP ? { ...(JSON.parse(readFileSync(rutaP, 'utf8')) as PercepcionMedio), documento: d } : null);
const ctx: ContextoComprension = { sql: archivo.sql, modelo: null, percepcion };
const mb = (x: number) => Math.round((x / 1048576) * 10) / 10;
async function retenido<T>(nombre: string, fn: () => Promise<T>): Promise<T> {
  gc(); gc();
  const antes = process.memoryUsage().heapUsed;
  const r = await fn();
  gc(); gc();
  console.log(`${nombre}: ${mb(process.memoryUsage().heapUsed - antes)} MB retenidos`);
  return r;
}
const viejo = await retenido('antes (material entero + todas las fichas + segmentos + apariciones + percepción, las dos obras)', async () => {
  const x = [];
  for (const d of [rel!.origen, rel!.destino]) {
    x.push({ m: await leerMaterial(archivo.sql, d), fichas: await leerFichas(archivo.sql, { documento: d }), segmentos: await leerSegmentos(archivo.sql, d), p: await percepcion(d), aps: await leerApariciones(archivo.sql, { documento: d, limite: 20000 }) });
  }
  return x;
});
void viejo;
const nuevo = await retenido('ahora (lo ligero de las dos obras)', async () => [await materialObra(ctx, rel!.origen, 'A'), await materialObra(ctx, rel!.destino, 'B')]);
const [a, b] = nuevo;
const grandes = [...a!.hojas].sort((x, y) => (y.anclaFin?.tipo === 'tiempo' ? y.anclaFin.t1 : (y.ancla as { t1?: number }).t1 ?? 0) - (y.ancla as { t0?: number }).t0! - ((x.anclaFin?.tipo === 'tiempo' ? x.anclaFin.t1 : (x.ancla as { t1?: number }).t1 ?? 0) - (x.ancla as { t0?: number }).t0!)).slice(0, 4);
await retenido('un tramo (las cuatro escenas más largas de A y el capítulo más largo de B)', async () => [await cargarTramo(ctx, a!, ordenesDe(a!, grandes)), await cargarTramo(ctx, b!, ordenesDe(b!, b!.hojas.slice(3, 4)))]);
archivo.cerrar();
