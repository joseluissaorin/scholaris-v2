/**
 * Comprensión sin conexión a la plataforma: copia documentos (.spdf 4.2
 * descargados con la API o el SDK) a una estantería local en memoria (SPDF +
 * funciones), les pasa la comprensión entera con Gemini y deja lo producido en
 * JSON para revisarlo. Solo lee los .spdf: no toca la producción.
 *
 *   npx tsx apps/api/scripts/comprender-local.ts --salida DIR --spdf a.spdf --spdf b.spdf \
 *     [--percepcion DOC=ruta.json] [--lentes DOC=cine,documental] [--alto MODELO] [--rapido MODELO] \
 *     [--presupuesto 6] [--solo DOC] [--sin-vectores] [--sin-wikidata] [--forzar] [--estanteria pasada-anterior.sqlite]
 *     [--unidades DOC=transcripcion-revisada.json]
 *
 *   npx tsx apps/api/scripts/comprender-local.ts evaluar --salida DIR --spdf … --modelos a,b,c [--segmentos 3]
 *     Hace la estructura una vez (con --alto) y después las fichas de los primeros
 *     segmentos de cada documento con cada modelo, para compararlas.
 *
 * Claves: GEMINI_API_KEY en el entorno.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Lente, PercepcionMedio } from '@scholaris/nucleo';
import { aplicarEsquemaFunciones } from '@scholaris/funciones';
import {
  comprenderDocumento, fichasDeLote, leerEstadoComprension, leerMaterial, lente, lotesDeFichas, pasoSegmentos, planificarComprension,
  type ContextoComprension, type ModeloComprension,
} from '@scholaris/ingesta';
import { crearComprensorGemini, crearGemini } from '@scholaris/proveedores';
import {
  abrirSpdf, crearSpdf, escribirDocumento, escribirFiguras, escribirSecciones, escribirUnidades, leerApariciones, leerDocumento, leerFichas, leerFiguras,
  leerSecciones, leerSegmentos, leerUnidades,
} from '@scholaris/spdf';

const args = process.argv.slice(2);
const modo = args[0] === 'evaluar' ? 'evaluar' : 'comprender';
const valores = (k: string) => args.flatMap((a, i) => (a === `--${k}` && args[i + 1] ? [args[i + 1]!] : []));
const valor = (k: string) => valores(k)[0];
const bandera = (k: string) => args.includes(`--${k}`);
const pares = (k: string) => new Map(valores(k).map((v) => { const i = v.indexOf('='); return [v.slice(0, i), v.slice(i + 1)] as const; }));

const salida = valor('salida') ?? 'comprension';
mkdirSync(salida, { recursive: true });
const clave = process.env.GEMINI_API_KEY;
if (!clave) throw new Error('Falta GEMINI_API_KEY');

const gemini = crearGemini({ clave, concurrencia: 8, timeoutMs: 600_000 });
const comprensor = (alto?: string, rapido?: string) => crearComprensorGemini(gemini, { ...(alto ? { modeloAlto: alto } : {}), ...(rapido ? { modeloRapido: rapido } : {}) }) as unknown as ModeloComprension;

// Estantería local: SPDF 4.2 más el esquema de las funciones (grafo de entidades).
// Con --estanteria se sigue sobre una estantería de una pasada anterior (para ver la biblioteca entera).
const previa = valor('estanteria');
const estanteria = previa ? await abrirSpdf(readFileSync(previa)) : await crearSpdf({ generador: 'comprender-local' });
const sql = estanteria.sql;
await aplicarEsquemaFunciones(sql);
const documentos: string[] = previa ? (await sql.ejecutar<{ id: string }>('SELECT id FROM documentos ORDER BY creado')).map((f) => String(f.id)) : [];
for (const ruta of valores('spdf')) {
  const a = await abrirSpdf(readFileSync(ruta));
  const d = await leerDocumento(a.sql);
  if (!d) throw new Error(`${ruta}: sin documento`);
  await escribirDocumento(sql, d);
  await escribirUnidades(sql, await leerUnidades(a.sql, d.id));
  await escribirSecciones(sql, await leerSecciones(a.sql, d.id));
  await escribirFiguras(sql, await leerFiguras(a.sql, d.id));
  a.cerrar();
  documentos.push(d.id);
  console.log(`· ${d.id}: «${d.metadatos.titulo}» (${d.tipo}, ${d.unidades} unidades)`);
}
// --unidades DOC=ruta.json: sustituye las unidades del medio por otras (la transcripción revisada por la
// percepción: `unidadesRevisadas`, o una lista de unidades con orden, texto, t0, t1, hablante y palabras).
for (const [doc, ruta] of pares('unidades')) {
  const crudo = JSON.parse(readFileSync(ruta, 'utf8')) as { unidadesRevisadas?: unknown[] } | unknown[];
  const lista = (Array.isArray(crudo) ? crudo : crudo.unidadesRevisadas ?? []) as Array<{ orden: number; texto: string; t0: number; t1: number; hablante?: string; palabras?: { v: 1; t0: number; cs: number[] } }>;
  await sql.ejecutar('DELETE FROM unidades WHERE documento = ?', doc);
  await escribirUnidades(sql, lista.map((u) => ({
    id: `${doc}:u${u.orden}`, documento: doc, orden: u.orden, texto: u.texto, lector: 'revision', confianza: 1,
    ancla: { tipo: 'tiempo' as const, t0: u.t0, t1: u.t1, ...(u.hablante ? { hablante: u.hablante } : {}) }, ...(u.palabras ? { palabras: u.palabras } : {}),
  })));
  console.log(`· ${doc}: ${lista.length} unidades revisadas en lugar de las de la ingesta`);
}
const solo = valor('solo');
const percepciones = pares('percepcion');
const lentesFijas = pares('lentes');
const leerPercepcion = async (doc: string): Promise<PercepcionMedio | null> => {
  const ruta = percepciones.get(doc);
  if (!ruta || !existsSync(ruta)) return null;
  const p = JSON.parse(readFileSync(ruta, 'utf8')) as PercepcionMedio;
  return { ...p, documento: doc };
};

function contexto(modelo: ModeloComprension): ContextoComprension {
  const emb = bandera('sin-vectores') ? undefined : gemini.embebedor();
  return {
    sql, modelo, ...(emb ? { embebedor: emb } : {}), ...(bandera('sin-wikidata') ? {} : { fetch: globalThis.fetch.bind(globalThis) }),
    percepcion: leerPercepcion,
    alProgreso: (p) => console.log(`  [${p.documento}] ${p.paso} ${Math.round(p.avance * 100)} % · ${p.mensaje}`),
  };
}

async function volcar(doc: string, carpeta: string): Promise<Record<string, unknown>> {
  mkdirSync(carpeta, { recursive: true });
  const segmentos = await leerSegmentos(sql, doc);
  const fichas = await leerFichas(sql, { documento: doc });
  const apariciones = await leerApariciones(sql, { documento: doc, limite: 100_000 });
  const ids = [...new Set(apariciones.map((a) => a.entidad))];
  const entidades = ids.length ? await sql.ejecutar<Record<string, unknown>>(`SELECT id, tipo, nombre, alias, wikidata, descripcion, ficticia FROM entidades WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(ids)) : [];
  const nombre = new Map(entidades.map((e) => [String(e.id), String(e.nombre)]));
  const relaciones = await sql.ejecutar<Record<string, unknown>>('SELECT a, b, etiqueta, documento FROM entidades_relaciones WHERE documento = ?', doc);
  const estado = await leerEstadoComprension(sql, doc);
  const escribir = (n: string, v: unknown) => writeFileSync(join(carpeta, n), JSON.stringify(v, null, 2));
  escribir('segmentos.json', segmentos);
  escribir('fichas.json', fichas);
  escribir('apariciones.json', apariciones.map((a) => ({ ...a, nombre: nombre.get(a.entidad) })));
  escribir('entidades.json', entidades.map((e) => ({ ...e, alias: JSON.parse(String(e.alias ?? '[]')), apariciones: apariciones.filter((a) => a.entidad === e.id).length })));
  escribir('relaciones.json', relaciones);
  escribir('estado.json', estado);
  escribir('secciones.json', await leerSecciones(sql, doc));
  const porClase: Record<string, number> = {};
  for (const f of fichas) porClase[f.clase] = (porClase[f.clase] ?? 0) + 1;
  const porRol: Record<string, number> = {};
  for (const a of apariciones) porRol[a.rol] = (porRol[a.rol] ?? 0) + 1;
  return { documento: doc, estado: estado?.estado, lentes: estado?.lentes, usd: estado?.usd, segmentos: segmentos.length, fichas: porClase, entidades: entidades.length, apariciones: porRol, relaciones: relaciones.length };
}

if (modo === 'comprender') {
  const modelo = comprensor(valor('alto'), valor('rapido'));
  const resumen: Record<string, unknown>[] = [];
  for (const doc of documentos) {
    if (solo && doc !== solo) continue;
    const t0 = Date.now();
    console.log(`\n== Comprendiendo ${doc}`);
    const lentes = lentesFijas.get(doc)?.split(',') as Lente[] | undefined;
    const e = await comprenderDocumento(contexto(modelo), doc, {
      ...(lentes ? { lentes } : {}), presupuestoUsd: Number(valor('presupuesto') ?? 6), forzar: bandera('forzar'), concurrencia: 4,
    });
    console.log(`  ${e.estado} en ${Math.round((Date.now() - t0) / 1000)} s · ${e.usd.toFixed(3)} USD · ${e.llamadas} llamadas · avisos: ${e.avisos.join(' | ') || 'ninguno'}`);
    resumen.push({ ...(await volcar(doc, join(salida, doc))), segundos: Math.round((Date.now() - t0) / 1000) });
  }
  const total = gemini.contador.total();
  writeFileSync(join(salida, 'resumen.json'), JSON.stringify({ documentos: resumen, gemini: total, fecha: new Date().toISOString() }, null, 2));
  writeFileSync(join(salida, 'estanteria.sqlite'), estanteria.exportarSqlite());
  console.log(`\nGasto total medido por el cliente de Gemini: ${total.usd.toFixed(3)} USD en ${total.llamadas} llamadas`);
} else {
  // Evaluación: misma estructura para todos, fichas de los primeros segmentos con cada modelo.
  const modelos = (valor('modelos') ?? '').split(',').filter(Boolean);
  const n = Number(valor('segmentos') ?? 3);
  const informe: Record<string, unknown>[] = [];
  for (const doc of documentos) {
    if (solo && doc !== solo) continue;
    const ctx = contexto(comprensor(valor('alto'), valor('rapido')));
    const lentes = lentesFijas.get(doc)?.split(',') as Lente[] | undefined;
    const plan = await planificarComprension(ctx, doc, { ...(lentes ? { lentes } : {}), forzar: true });
    await pasoSegmentos(ctx, plan);
    const segmentos = await leerSegmentos(sql, doc);
    const m = await leerMaterial(sql, doc);
    const percepcion = await leerPercepcion(doc);
    const def = lente(plan.lentes[0]!);
    const elegidos = lotesDeFichas(segmentos, def, 100)[0]?.slice(Number(valor('desde') ?? 0), Number(valor('desde') ?? 0) + n) ?? [];
    writeFileSync(join(salida, `${doc}-estructura.json`), JSON.stringify(segmentos, null, 2));
    for (const id of modelos) {
      const modelo = comprensor(id, id);
      const acumulado = { uso: { modelo: '', tokensEntrada: 0, tokensSalida: 0, usd: 0, ms: 0, llamadas: 0 } };
      const t0 = Date.now();
      try {
        const r = await fichasDeLote(m, plan.lentes[0]!, segmentos, elegidos, modelo, acumulado, {
          largo: plan.largo, calidad: 'alta', maxCaracteres: 2_400_000, percepcion, idioma: m.documento.metadatos.idioma ?? 'es', creada: new Date().toISOString(),
        });
        const fila = { documento: doc, modelo: id, segundos: Math.round((Date.now() - t0) / 1000), usd: Math.round(acumulado.uso.usd * 1e4) / 1e4, tokensEntrada: acumulado.uso.tokensEntrada, tokensSalida: acumulado.uso.tokensSalida, fichas: r.fichas.length, evidencias: r.fichas.reduce((t, f) => t + f.evidencias.length, 0), citasDescartadas: r.descartadas, palabras: r.fichas.reduce((t, f) => t + f.texto.split(/\s+/).length, 0) };
        informe.push(fila);
        writeFileSync(join(salida, `${doc}-${id}.json`), JSON.stringify(r.fichas, null, 2));
        console.log(JSON.stringify(fila));
      } catch (e) {
        informe.push({ documento: doc, modelo: id, error: (e as Error).message.slice(0, 300) });
        console.log(`  ${id}: ${(e as Error).message.slice(0, 300)}`);
      }
    }
  }
  writeFileSync(join(salida, 'evaluacion.json'), JSON.stringify({ informe, gemini: gemini.contador.total() }, null, 2));
}
estanteria.cerrar();
