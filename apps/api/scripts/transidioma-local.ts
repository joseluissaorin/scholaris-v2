/**
 * Prueba transidioma sin conexión: un original y su traducción de dominio público
 * (preparados en JSON: `{ es: { paginas: [...] }, en: { paginas: [...] } }`) en una
 * estantería en memoria; detección de la relación, alineación párrafo a párrafo
 * con Gemini y una medición de la búsqueda entre lenguas: preguntas en inglés,
 * francés e italiano sobre el original español, por vectores (gemini-embedding)
 * frente a la búsqueda léxica, y la cita del original con su traducción al lado
 * sacada de la alineación.
 *
 *   npx tsx apps/api/scripts/transidioma-local.ts --obras marianela.json --salida DIR [--calidad rapida|alta] [--preguntas 30]
 *
 * Claves: GEMINI_API_KEY en el entorno.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Documento } from '@scholaris/nucleo';
import { aplicarEsquemaFunciones } from '@scholaris/funciones';
import {
  alinearRelacion, correspondencias, detectarRelaciones, materialObra, parrafosDe, relacionesPorAlinear, type ContextoComprension, type ModeloComprension,
} from '@scholaris/ingesta';
import { crearComprensorGemini, crearGemini } from '@scholaris/proveedores';
import { crearSpdf, escribirDocumento, escribirUnidades, leerAlineaciones, leerFichas, leerRelaciones } from '@scholaris/spdf';

const args = process.argv.slice(2);
const valor = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const salida = valor('salida') ?? 'transidioma';
mkdirSync(salida, { recursive: true });
const clave = process.env.GEMINI_API_KEY;
if (!clave) throw new Error('Falta GEMINI_API_KEY');
const obras = JSON.parse(readFileSync(valor('obras')!, 'utf8')) as { es: { paginas: string[] }; en: { paginas: string[] } };

const gemini = crearGemini({ clave, concurrencia: 8, timeoutMs: 600_000 });
const modelo = crearComprensorGemini(gemini) as unknown as ModeloComprension;
const emb = gemini.embebedor();
const archivo = await crearSpdf({ generador: 'transidioma-local' });
const sql = archivo.sql;
await aplicarEsquemaFunciones(sql);
const ahora = new Date().toISOString();

function documento(id: string, m: Partial<Documento['metadatos']>, n: number): Documento {
  return {
    id, tipo: 'documento', metadatos: { titulo: 'Marianela', autores: [{ nombre: 'Benito', apellidos: 'Pérez Galdós' }], tipoCSL: 'book', ...m },
    estado: 'listo', huella: id.padEnd(64, '0'), original: '', mime: 'text/plain', bytes: 1, unidades: n, creado: ahora, actualizado: ahora, bibliotecas: [],
  };
}
const fichas: Array<[string, 'es' | 'en', Partial<Documento['metadatos']>]> = [
  ['marianela-es', 'es', { anio: 1878, idioma: 'es', editorial: 'Imprenta de La Guirnalda' }],
  ['marianela-en', 'en', { anio: 1893, idioma: 'en', tituloOriginal: 'Marianela', idiomaOriginal: 'es', traductores: [{ nombre: 'Clara', apellidos: 'Bell' }], editorial: 'William S. Gottsberger' }],
];
for (const [id, l, m] of fichas) {
  const paginas = obras[l].paginas;
  await escribirDocumento(sql, documento(id, m, paginas.length));
  await escribirUnidades(sql, paginas.map((texto, i) => ({
    id: `${id}:u${i}`, documento: id, orden: i, texto, lector: 'gutenberg', confianza: 1,
    ancla: { tipo: 'pagina' as const, fisica: i + 1, impresa: null, romana: false, origen: 'ninguno' as const, confianza: 1 },
  })));
}
const ctx: ContextoComprension = { sql, modelo, embebedor: emb, fetch: globalThis.fetch.bind(globalThis) };

console.log('== Detección');
const d = await detectarRelaciones(ctx, null);
for (const c of d.candidatas) console.log(`  ${c.origen} ${c.tipo} ${c.destino} · ${c.confianza} · ${c.fuente}\n${c.senales.map((s) => `    [${s.origen} ${s.tipo ?? ''} ${s.peso}] ${s.descripcion}`).join('\n')}`);
const [id] = await relacionesPorAlinear(ctx);
if (!id) throw new Error('No hay relación que alinear');
console.log('\n== Alineación por párrafos');
const t0 = Date.now();
const r = await alinearRelacion(ctx, id, { calidad: (valor('calidad') as 'alta' | 'rapida' | undefined) ?? 'rapida', concurrencia: 6, presupuestoUsd: 3 });
console.log(`  ${r.estado}: ${r.alineaciones} alineaciones, ficha ${r.ficha ? 'sí' : 'no'}, ${r.usd.toFixed(3)} USD, ${Math.round((Date.now() - t0) / 1000)} s; ${r.avisos.join(' | ')}`);
const als = await leerAlineaciones(sql, { relacion: id });
const conteo: Record<string, number> = {};
for (const x of als) conteo[x.tipo] = (conteo[x.tipo] ?? 0) + 1;
console.log(`  tipos: ${JSON.stringify(conteo)}`);
writeFileSync(join(salida, 'relaciones.json'), JSON.stringify(await leerRelaciones(sql), null, 2));
writeFileSync(join(salida, 'alineaciones.json'), JSON.stringify(als, null, 2));
writeFileSync(join(salida, 'ficha.json'), JSON.stringify((await leerFichas(sql, { objetivo: 'relacion' }))[0] ?? null, null, 2));

// ---------------------------------------------------------------------------
// Búsqueda entre lenguas
// ---------------------------------------------------------------------------
console.log('\n== Búsqueda entre lenguas');
const es = parrafosDe(await materialObra(ctx, 'marianela-es', 'B'));
const en = parrafosDe(await materialObra(ctx, 'marianela-en', 'A'));
// Pares 1-1 traducidos, con párrafos largos: la verdad de cada pregunta.
const pares = als.filter((x) => x.tipo === 'traducido' && x.a && x.b && !x.a.anclaFin && !x.b.anclaFin).map((x) => ({
  en: en.find((p) => p.unidad === `marianela-en:u${(x.a!.ancla as { fisica: number }).fisica - 1}` && p.caracteres[0] === x.a!.ancla.caracteres?.[0]),
  es: es.find((p) => p.unidad === `marianela-es:u${(x.b!.ancla as { fisica: number }).fisica - 1}` && p.caracteres[0] === x.b!.ancla.caracteres?.[0]),
})).filter((p) => p.en && p.es && p.es.texto.length > 300);
const n = Math.min(Number(valor('preguntas') ?? 30), pares.length);
const elegidos = Array.from({ length: n }, (_, i) => pares[Math.floor((i * pares.length) / n)]!);
const preguntas: Array<{ lengua: string; pregunta: string; verdad: string }> = [];
for (const p of elegidos) {
  const g = await gemini.redactor().generar<{ en: string; fr: string; it: string }>({
    sistema: 'You write one specific question per language whose answer is contained in the given passage of a novel. Do not quote the passage; paraphrase. Each question must be answerable only from this passage (mention a concrete detail).',
    mensajes: [{ rol: 'usuario', partes: [{ texto: `Passage (English translation):\n${p.en!.texto}\n\nOne question in English (en), one in French (fr), one in Italian (it).` }] }],
    esquema: { type: 'object', properties: { en: { type: 'string' }, fr: { type: 'string' }, it: { type: 'string' } }, required: ['en', 'fr', 'it'] }, calidad: 'rapida',
  });
  const j = g.json ?? (JSON.parse(g.texto) as { en: string; fr: string; it: string });
  for (const l of ['en', 'fr', 'it'] as const) preguntas.push({ lengua: l, pregunta: j[l], verdad: p.es!.id });
}
const vectores = await emb.vectorizar(es.map((p) => ({ modalidad: 'texto' as const, texto: p.texto })), 'documento');
const consultas = await emb.vectorizar(preguntas.map((q) => ({ modalidad: 'texto' as const, texto: q.pregunta })), 'consulta');
const coseno = (a: Float32Array, b: Float32Array) => { let p = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { p += a[i]! * b[i]!; x += a[i]! ** 2; y += b[i]! ** 2; } return p / Math.sqrt(x * y); };
const palabras = (s: string) => new Set(s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/\p{L}{3,}/gu) ?? []);
const df = new Map<string, number>();
for (const p of es) for (const w of palabras(p.texto)) df.set(w, (df.get(w) ?? 0) + 1);
const lexico = (q: string, p: string) => { const pw = palabras(p); return [...palabras(q)].filter((w) => pw.has(w)).reduce((t, w) => t + Math.log(1 + es.length / (df.get(w) ?? 1)), 0); };
const resultado: Record<string, { n: number; densa1: number; densa5: number; lexica5: number }> = {};
const ejemplos: unknown[] = [];
for (const [i, q] of preguntas.entries()) {
  const densa = es.map((p, k) => ({ id: p.id, s: coseno(consultas[i]!, vectores[k]!) })).sort((x, y) => y.s - x.s);
  const lex = es.map((p) => ({ id: p.id, s: lexico(q.pregunta, p.texto) })).sort((x, y) => y.s - x.s);
  const r0 = resultado[q.lengua] ?? { n: 0, densa1: 0, densa5: 0, lexica5: 0 };
  r0.n++;
  if (densa[0]!.id === q.verdad) r0.densa1++;
  if (densa.slice(0, 5).some((x) => x.id === q.verdad)) r0.densa5++;
  if (lex.slice(0, 5).some((x) => x.id === q.verdad) && lex[0]!.s > 0) r0.lexica5++;
  resultado[q.lengua] = r0;
  // La cita: el original que sale primero, con su traducción al lado (de la alineación).
  if (ejemplos.length < 6 && densa[0]!.id === q.verdad) {
    const p = es.find((x) => x.id === densa[0]!.id)!;
    const ancla = { tipo: 'pagina' as const, fisica: Number(p.unidad.split(':u')[1]) + 1, impresa: null, romana: false, origen: 'ninguno' as const, confianza: 1, caracteres: p.caracteres };
    const [c] = await correspondencias(sql, 'marianela-es', ancla, { limite: 1 });
    ejemplos.push({ lengua: q.lengua, pregunta: q.pregunta, original: p.texto.slice(0, 400), traduccion: (c?.textoOtro ?? '').slice(0, 400), tipo: c?.alineacion.tipo, nota: c?.alineacion.nota });
  }
}
console.log(JSON.stringify(resultado, null, 1));
writeFileSync(join(salida, 'busqueda-entre-lenguas.json'), JSON.stringify({ resultado, preguntas, ejemplos, parrafos: { es: es.length, en: en.length } }, null, 2));
writeFileSync(join(salida, 'resumen.json'), JSON.stringify({ alineacion: r, conteo, busqueda: resultado, gemini: gemini.contador.total() }, null, 2));
console.log(`\nGasto total: ${gemini.contador.total().usd.toFixed(3)} USD en ${gemini.contador.total().llamadas} llamadas`);
archivo.cerrar();
