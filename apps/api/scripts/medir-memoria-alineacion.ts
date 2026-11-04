/**
 * Memoria de la alineación de una relación sobre una estantería local de verdad (la
 * película y el cuento de ~/tmp/scholaris-fresa), sin gastar en Gemini: un modelo falso
 * devuelve la alineación gruesa y la fina de una pasada real (con citas literales del
 * material, para que el anclaje trabaje como en producción) y una ficha corta.
 *
 *   node --expose-gc --import tsx apps/api/scripts/medir-memoria-alineacion.ts \
 *     --estanteria est.sqlite --percepcion DOC=ruta.json --gruesas gruesas.json --alineaciones alineaciones.json [--presupuesto-mb 128]
 *
 * Mide, cada 5 ms, el montón de V8 (heapUsed), la memoria externa y el RSS por encima
 * de la línea base, y cuánto devuelve cada consulta SQL (lo que la estantería tiene que
 * serializar por RPC en la nube). Sale con código 1 si el pico del montón pasa del presupuesto.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { Alineacion, PercepcionMedio, SQL, ValorSQL } from '@scholaris/nucleo';
import { aplicarEsquemaFunciones } from '@scholaris/funciones';
import { alinearRelacion, type ContextoComprension, type ModeloComprension, type PeticionComprension } from '@scholaris/ingesta';
import { abrirSpdf, leerRelaciones, leerUnidades } from '@scholaris/spdf';

const args = process.argv.slice(2);
const valor = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const pares = (k: string) => new Map(args.flatMap((a, i) => (a === `--${k}` && args[i + 1] ? [args[i + 1]!] : [])).map((v) => { const i = v.indexOf('='); return [v.slice(0, i), v.slice(i + 1)] as const; }));
const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error('Lánzalo con node --expose-gc');

const archivo = await abrirSpdf(new Uint8Array(readFileSync(valor('estanteria')!)));
await aplicarEsquemaFunciones(archivo.sql);
const percepciones = pares('percepcion');
const gruesasReales = JSON.parse(readFileSync(valor('gruesas')!, 'utf8')) as Record<string, unknown>;
const finasReales = JSON.parse(readFileSync(valor('alineaciones')!, 'utf8')) as Alineacion[];
const [rel] = (await leerRelaciones(archivo.sql)).filter((r) => r.tipo === 'adaptacion_de');
if (!rel) throw new Error('Sin relación');

// Lo que devuelve cada consulta (lo que la estantería serializa por RPC).
const consultas: Array<{ q: string; filas: number; bytes: number }> = [];
const sql: SQL = {
  async ejecutar<T = Record<string, ValorSQL>>(q: string, ...p: ValorSQL[]): Promise<T[]> {
    const r = await archivo.sql.ejecutar<T>(q, ...p);
    if (/^\s*(SELECT|WITH)/i.test(q)) {
      let bytes = 0;
      for (const f of r as Array<Record<string, unknown>>) for (const v of Object.values(f)) bytes += typeof v === 'string' ? v.length : v instanceof Uint8Array ? v.byteLength : 8;
      consultas.push({ q: q.replace(/\s+/g, ' ').slice(0, 90), filas: r.length, bytes });
    }
    return r;
  },
  transaccion: (fn) => archivo.sql.transaccion(fn),
};

// Las citas literales de la pasada real, por unidad (el modelo falso cita como el de verdad).
const unidades = new Map<string, Map<string, { orden: number; texto: string }>>();
for (const d of [rel.origen, rel.destino]) unidades.set(d, new Map((await leerUnidades(archivo.sql, d)).map((u) => [JSON.stringify(u.ancla.tipo === 'pagina' ? u.ancla.fisica : [u.ancla.tipo === 'tiempo' ? u.ancla.t0 : 0]), { orden: u.orden, texto: u.texto ?? '' }])));
function ladoModelo(l: Alineacion['a']): Record<string, unknown> | undefined {
  if (!l) return undefined;
  const a = l.ancla;
  if (a.tipo === 'tiempo' && !a.caracteres) return { t0: a.t0, t1: a.t1, ...(a.instante !== undefined ? { t: a.instante } : {}), que: 'plano de Diego' };
  const us = [...unidades.get(l.documento)!.values()];
  const u = a.tipo === 'pagina' ? unidades.get(l.documento)!.get(JSON.stringify(a.fisica)) : us.find((x) => x.texto && a.caracteres && Array.from(x.texto).length >= a.caracteres[1]);
  if (!u || !a.caracteres) return undefined;
  return { u: u.orden, cita: Array.from(u.texto).slice(a.caracteres[0], a.caracteres[1]).join('').split(/\s+/).slice(0, 25).join(' ') };
}
const finasModelo = finasReales.filter((x) => x.id.includes(':f')).map((x) => ({ tipo: x.tipo, ...(ladoModelo(x.a) ? { a: ladoModelo(x.a) } : {}), ...(ladoModelo(x.b) ? { b: ladoModelo(x.b) } : {}), nota: x.nota, confianza: x.confianza }));

const modelo: ModeloComprension = {
  nombre: 'falso', modelo: (c) => `falso-${c}`,
  async generar<T>(p: PeticionComprension) {
    const texto = p.partes.map((x) => ('texto' in x ? x.texto : '')).join('\n');
    let json: unknown = {};
    if (p.operacion === 'transmedia:gruesa') json = gruesasReales['gemini-4-argon'] ? { correspondencias: gruesasReales['gemini-4-argon'] } : gruesasReales;
    else if (p.operacion === 'transmedia:fina') json = { alineaciones: finasModelo.filter((_, i) => texto.length % 7 === i % 7).slice(0, 30) };
    else if (p.operacion === 'transmedia:ficha') json = { texto: 'Ficha de prueba.', resumen_es: 'Prueba.', resumen_en: 'Test.', modo: 'Prueba.', cambios: [{ aspecto: 'final', afirmacion: 'Prueba.', a: finasModelo.slice(0, 3).map((x) => x.a).filter(Boolean), b: finasModelo.slice(0, 3).map((x) => x.b).filter(Boolean) }], personajes: [], evidencias: [] };
    await new Promise((r) => setTimeout(r, 30));
    return { json: json as T, uso: { modelo: `falso-${p.calidad}`, tokensEntrada: Math.round(texto.length / 3.6), tokensSalida: 8000, usd: 0.01, ms: 30, llamadas: 1 } };
  },
};

const leerPercepcion = async (doc: string): Promise<PercepcionMedio | null> => {
  const r = percepciones.get(doc);
  return r && existsSync(r) ? { ...(JSON.parse(readFileSync(r, 'utf8')) as PercepcionMedio), documento: doc } : null;
};
const ctx: ContextoComprension = { sql, modelo, percepcion: leerPercepcion };

gc(); gc();
const base = process.memoryUsage();
const pico = { heap: 0, externo: 0, rss: 0, buffers: 0, total: 0 };
const muestra = setInterval(() => {
  const m = process.memoryUsage();
  pico.heap = Math.max(pico.heap, m.heapUsed - base.heapUsed);
  pico.total = Math.max(pico.total, m.heapUsed);
  pico.externo = Math.max(pico.externo, m.external - base.external);
  pico.buffers = Math.max(pico.buffers, m.arrayBuffers - base.arrayBuffers);
  pico.rss = Math.max(pico.rss, m.rss - base.rss);
}, 5);
const t0 = Date.now();
const r = await alinearRelacion(ctx, rel.id, { forzar: true, concurrencia: 4 });
clearInterval(muestra);
const mb = (x: number) => Math.round((x / 1048576) * 10) / 10;
const grandes = [...consultas].sort((a, b) => b.bytes - a.bytes).slice(0, 8);
console.log(JSON.stringify({
  resultado: { estado: r.estado, alineaciones: r.alineaciones, gruesas: r.gruesas, ficha: r.ficha, avisos: r.avisos }, ms: Date.now() - t0,
  picoMB: { montonV8: mb(pico.heap), montonTotal: mb(pico.total), lineaBase: mb(base.heapUsed), externo: mb(pico.externo), arrayBuffers: mb(pico.buffers), rss: mb(pico.rss) },
  sql: { consultas: consultas.length, filas: consultas.reduce((t, c) => t + c.filas, 0), totalMB: mb(consultas.reduce((t, c) => t + c.bytes, 0)), mayoresKB: grandes.map((c) => ({ q: c.q, filas: c.filas, kb: Math.round(c.bytes / 1024) })) },
}, null, 1));
const presupuesto = Number(valor('presupuesto-mb') ?? 0);
archivo.cerrar();
if (presupuesto && mb(pico.heap) > presupuesto) { console.error(`El pico del montón (${mb(pico.heap)} MB) pasa del presupuesto (${presupuesto} MB).`); process.exit(1); }
