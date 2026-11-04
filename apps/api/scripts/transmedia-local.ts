/**
 * Transmedia sin conexión a la plataforma: abre en memoria una estantería local
 * (la que deja `comprender-local.ts`, con la comprensión de las obras), detecta
 * sus relaciones (metadatos, contenido, Wikidata, citas, entidades y fichas), las
 * alinea con Gemini y deja lo producido en JSON. No toca la producción ni el
 * fichero de la estantería (se trabaja sobre una copia en memoria).
 *
 *   npx tsx apps/api/scripts/transmedia-local.ts --estanteria est.sqlite --salida DIR \
 *     [--percepcion DOC=ruta.json] [--alto MODELO] [--rapido MODELO] [--calidad alta|rapida] [--presupuesto 4]
 *     [--solo-detectar] [--sin-wikidata] [--sin-vectores] [--relacion ID]
 *
 *   npx tsx apps/api/scripts/transmedia-local.ts evaluar --estanteria … --salida DIR --modelos a,b,c [--grupos 0,3]
 *     Hace la detección y la alineación gruesa una vez (con --alto) y después la fina
 *     de los grupos elegidos con cada modelo, para compararlos.
 *
 * Claves: GEMINI_API_KEY en el entorno.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PercepcionMedio, Relacion } from '@scholaris/nucleo';
import { aplicarEsquemaFunciones } from '@scholaris/funciones';
import {
  alinearRelacion, alineacionFina, alineacionGruesa, cargarTramo, detectarRelaciones, gruposFinos, leerEstadoAlineacion, materialObra, ordenesDe, prefijoRelacion, relacionesPorAlinear,
  type ContextoComprension, type ModeloComprension,
} from '@scholaris/ingesta';
import { crearComprensorGemini, crearGemini } from '@scholaris/proveedores';
import { abrirSpdf, leerAlineaciones, leerFichas, leerRelaciones } from '@scholaris/spdf';

const args = process.argv.slice(2);
const modo = args[0] === 'evaluar' ? 'evaluar' : 'alinear';
const valores = (k: string) => args.flatMap((a, i) => (a === `--${k}` && args[i + 1] ? [args[i + 1]!] : []));
const valor = (k: string) => valores(k)[0];
const bandera = (k: string) => args.includes(`--${k}`);
const pares = (k: string) => new Map(valores(k).map((v) => { const i = v.indexOf('='); return [v.slice(0, i), v.slice(i + 1)] as const; }));

const salida = valor('salida') ?? 'transmedia';
mkdirSync(salida, { recursive: true });
const clave = process.env.GEMINI_API_KEY;
if (!clave) throw new Error('Falta GEMINI_API_KEY');
const ruta = valor('estanteria');
if (!ruta) throw new Error('Falta --estanteria');

const gemini = crearGemini({ clave, concurrencia: 8, timeoutMs: 900_000 });
const comprensor = (alto?: string, rapido?: string) => crearComprensorGemini(gemini, { ...(alto ? { modeloAlto: alto } : {}), ...(rapido ? { modeloRapido: rapido } : {}) }) as unknown as ModeloComprension;

const estanteria = await abrirSpdf(new Uint8Array(readFileSync(ruta)));
const sql = estanteria.sql;
await aplicarEsquemaFunciones(sql);
const percepciones = pares('percepcion');
const leerPercepcion = async (doc: string): Promise<PercepcionMedio | null> => {
  const r = percepciones.get(doc);
  if (!r || !existsSync(r)) return null;
  return { ...(JSON.parse(readFileSync(r, 'utf8')) as PercepcionMedio), documento: doc };
};

function contexto(modelo: ModeloComprension): ContextoComprension {
  const emb = bandera('sin-vectores') ? undefined : gemini.embebedor();
  return {
    sql, modelo, ...(emb ? { embebedor: emb } : {}), ...(bandera('sin-wikidata') ? {} : { fetch: globalThis.fetch.bind(globalThis) }),
    percepcion: leerPercepcion,
  };
}

const escribir = (n: string, v: unknown) => writeFileSync(join(salida, n), JSON.stringify(v, null, 2));
const ctx = contexto(comprensor(valor('alto'), valor('rapido')));

console.log('== Detección');
const t0 = Date.now();
const d = await detectarRelaciones(ctx, null, {});
for (const c of d.candidatas) {
  console.log(`  ${c.origen} ${c.tipo} ${c.destino} · confianza ${c.confianza} · fuente ${c.fuente}`);
  for (const s of c.senales) console.log(`    [${s.origen}${s.tipo ? ` ${s.tipo}` : ''} ${s.peso}] ${s.descripcion.slice(0, 200)}`);
}
console.log(`  ${d.relaciones.length} relaciones (${d.nuevas} nuevas) en ${Math.round((Date.now() - t0) / 1000)} s; avisos: ${d.avisos.join(' | ') || 'ninguno'}`);
escribir('deteccion.json', { candidatas: d.candidatas, uso: d.uso, avisos: d.avisos });

if (modo === 'alinear') {
  if (!bandera('solo-detectar')) {
    const ids = valor('relacion') ? [valor('relacion')!] : await relacionesPorAlinear(ctx, undefined, { forzar: true });
    for (const id of ids) {
      console.log(`\n== Alineando ${id}`);
      const t = Date.now();
      const r = await alinearRelacion(ctx, id, { forzar: true, calidad: (valor('calidad') as 'alta' | 'rapida' | undefined) ?? 'alta', presupuestoUsd: Number(valor('presupuesto') ?? 4), concurrencia: Number(valor('concurrencia') ?? 3) })
        .catch((e: Error) => ({ estado: 'error', alineaciones: 0, gruesas: 0, ficha: false, usd: 0, avisos: [e.message] }));
      console.log(`  ${r.estado}: ${r.alineaciones} alineaciones (${r.gruesas} gruesas), ficha ${r.ficha ? 'sí' : 'no'}, ${r.usd.toFixed(3)} USD, ${Math.round((Date.now() - t) / 1000)} s; avisos: ${r.avisos.join(' | ') || 'ninguno'}`);
    }
  }
  const relaciones = await leerRelaciones(sql);
  escribir('relaciones.json', relaciones);
  const todas: Record<string, unknown> = {};
  for (const r of relaciones) {
    const als = await leerAlineaciones(sql, { relacion: r.id });
    const conteo: Record<string, number> = {};
    for (const x of als) conteo[x.tipo] = (conteo[x.tipo] ?? 0) + 1;
    todas[r.id] = { relacion: r, estado: await leerEstadoAlineacion(ctx, r), conteo, alineaciones: als, ficha: (await leerFichas(sql, { objetivo: 'relacion', objetivoId: r.id }))[0] ?? null };
    writeFileSync(join(salida, `alineaciones-${r.id}.json`), JSON.stringify(als, null, 2));
    const f = (await leerFichas(sql, { objetivo: 'relacion', objetivoId: r.id }))[0];
    if (f) writeFileSync(join(salida, `ficha-${r.id}.json`), JSON.stringify(f, null, 2));
    console.log(`  ${r.id}: ${als.length} alineaciones ${JSON.stringify(conteo)}`);
  }
  escribir('resumen.json', { relaciones: Object.values(todas).map((x) => { const y = x as { relacion: Relacion; estado: unknown; conteo: unknown }; return { relacion: y.relacion, estado: y.estado, conteo: y.conteo }; }), gemini: gemini.contador.total(), fecha: new Date().toISOString() });
  writeFileSync(join(salida, 'estanteria.sqlite'), estanteria.exportarSqlite());
} else {
  // Evaluación de modelos: la misma gruesa (con --alto) y la fina de unos grupos con cada uno.
  const modelos = (valor('modelos') ?? '').split(',').filter(Boolean);
  const [rel] = (await leerRelaciones(sql)).filter((r) => r.tipo !== 'cita_a' && r.tipo !== 'relacionado');
  if (!rel) throw new Error('No hay relación que alinear');
  const a = await materialObra(ctx, rel.origen, 'A'), b = await materialObra(ctx, rel.destino, 'B');
  const prefijo = prefijoRelacion(rel, a, b, { global: true });
  const informe: Record<string, unknown>[] = [];
  const gruesasPor: Record<string, unknown> = {};
  let gruesasBase = null as Awaited<ReturnType<typeof alineacionGruesa>> | null;
  for (const id of bandera('gruesa-todos') ? modelos : [valor('alto') ?? modelos[0]!]) {
    const acumulado = { uso: { modelo: '', tokensEntrada: 0, tokensSalida: 0, usd: 0, ms: 0, llamadas: 0 } };
    const t = Date.now();
    const g = await alineacionGruesa(rel, a, b, comprensor(id, id), acumulado, { prefijo: prefijo.texto, calidad: 'alta' });
    gruesasPor[id] = g;
    gruesasBase ??= g;
    const cubiertasA = new Set(g.flatMap((x) => x.a)), cubiertasB = new Set(g.flatMap((x) => x.b));
    const fila = { fase: 'gruesa', modelo: id, segundos: Math.round((Date.now() - t) / 1000), usd: Math.round(acumulado.uso.usd * 1e4) / 1e4, correspondencias: g.length, cubreA: `${cubiertasA.size}/${a.hojas.length}`, cubreB: `${cubiertasB.size}/${b.hojas.length}` };
    informe.push(fila);
    console.log(JSON.stringify(fila));
  }
  escribir('evaluacion-gruesas.json', gruesasPor);
  const grupos = gruposFinos(a, b, gruesasBase!);
  const elegidos = (valor('grupos') ?? '0,1').split(',').map(Number).filter((i) => grupos[i]);
  for (const id of modelos) {
    for (const gi of elegidos) {
      const acumulado = { uso: { modelo: '', tokensEntrada: 0, tokensSalida: 0, usd: 0, ms: 0, llamadas: 0 } };
      const t = Date.now();
      try {
        const g = grupos[gi]!;
        const ta = await cargarTramo(ctx, a, ordenesDe(a, g.a)), tb = await cargarTramo(ctx, b, ordenesDe(b, g.b));
        const r = await alineacionFina(rel, a, b, g, ta, tb, comprensor(id, id), acumulado, { prefijo: prefijo.texto, calidad: 'alta' });
        const ambos = r.alineaciones.filter((x) => x.a && x.b).length;
        const visuales = r.alineaciones.filter((x) => x.a?.ancla.tipo === 'tiempo' && !x.a.ancla.caracteres).length;
        const fila = {
          fase: 'fina', modelo: id, grupo: gi, b: grupos[gi]!.b.map((s) => s.titulo).join(' + '), segundos: Math.round((Date.now() - t) / 1000), usd: Math.round(acumulado.uso.usd * 1e4) / 1e4,
          alineaciones: r.alineaciones.length, dosLados: ambos, exactas: r.exactas, citasDescartadas: r.descartadas, visuales, conRegion: r.alineaciones.filter((x) => x.a?.ancla.region).length,
          palabrasNota: Math.round(r.alineaciones.reduce((s, x) => s + x.nota.split(/\s+/).length, 0) / Math.max(1, r.alineaciones.length)),
        };
        informe.push(fila);
        writeFileSync(join(salida, `evaluacion-fina-${id}-g${gi}.json`), JSON.stringify(r.alineaciones, null, 2));
        console.log(JSON.stringify(fila));
      } catch (e) {
        informe.push({ fase: 'fina', modelo: id, grupo: gi, error: (e as Error).message.slice(0, 300) });
        console.log(`  ${id} g${gi}: ${(e as Error).message.slice(0, 300)}`);
      }
    }
  }
  escribir('evaluacion.json', { informe, gemini: gemini.contador.total() });
}
console.log(`\nGasto total medido por el cliente de Gemini: ${gemini.contador.total().usd.toFixed(3)} USD en ${gemini.contador.total().llamadas} llamadas`);
estanteria.cerrar();
