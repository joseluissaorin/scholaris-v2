/**
 * Banco en vivo de los proveedores. Llama a las APIs de verdad (cuesta dinero,
 * poco). Se ejecuta a mano:
 *
 *   npx tsx packages/proveedores/vivo/probar.ts [seccion…]
 *
 * Secciones: lector, imagenes, embebedor, redactor, transcriptor, workers,
 * openrouter, jev, cascada, inteligencia (sin argumentos: todas). Las claves
 * se leen de ~/.claude/.secrets/{gemini,openrouter,typesafe}.env y el token
 * de Workers AI del login OAuth de wrangler (o CLOUDFLARE_API_TOKEN).
 * Los resultados quedan en vivo/resultados/*.{json,md}.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Lector, PaginaLeida } from '@scholaris/nucleo';
import { coseno, enParalelo } from '@scholaris/nucleo';
import {
  crearGemini, crearWorkersAI, crearOpenRouter, crearJev, cascadaLectores, crearInteligencia,
  ContadorUso, pliegosPdf, cortarPdf, type UsoProveedor,
} from '../src/index.js';
import { AQUI, ORIGINALES, SALIDA, secreto, tokenWrangler, leerBytes, guardar, cer, f1Palabras, tabla } from './comun-vivo.js';

const CUENTA_CF = 'f22c7a728ddc8e41cefd2644f8fb7632';
const claves = {
  gemini: secreto('gemini', 'GEMINI_API_KEY'),
  openrouter: secreto('openrouter', 'OPENROUTER_API_KEY'),
  typesafe: secreto('typesafe', 'TYPESAFE_API_KEY'),
  cloudflare: process.env.CLOUDFLARE_API_TOKEN ?? tokenWrangler(),
};

const informe: string[] = [];
const decir = (s: string) => { console.log(s); informe.push(s); };

// ---------------------------------------------------------------------------
// Documentos del banco
// ---------------------------------------------------------------------------

interface DocBanco {
  id: string;
  fichero: string;
  /** Páginas físicas (desde 1) que se leen. */
  desde: number;
  hasta: number;
  pista?: string;
  /** Referencia por página: capa de texto (digitales). */
  capa?: Record<string, string>;
  /** Transcripción de oro de una página. */
  oro?: { fisica: number; texto: string };
  /** Folio impreso esperado = fisica + desfase (solo para comprobar). */
  desfaseFolio?: number;
}

function documentos(): DocBanco[] {
  const ref = (n: string) => {
    const r = join(tmpdir(), 'provwork', 'ref', `${n}.json`);
    return existsSync(r) ? (JSON.parse(readFileSync(r, 'utf8')) as Record<string, string>) : capaDeTexto(join(ORIGINALES, n));
  };
  return [
    {
      id: 'casamiento', fichero: 'el-casamiento-en-la-muerte-y-hechos-de-b.pdf', desde: 9, hasta: 24,
      pista: 'Comedia famosa española del siglo XVII (Lope de Vega, «El casamiento en la muerte»), impresión antigua a dos columnas, en verso.',
      oro: { fisica: 10, texto: readFileSync(join(AQUI, 'oro', 'casamiento-p10.txt'), 'utf8') },
      desfaseFolio: -6,
    },
    { id: 'discarded', fichero: 'the_discarded_image_an_introduction_t_z.pdf', desde: 21, hasta: 36, capa: ref('the_discarded_image_an_introduction_t_z.pdf') },
    { id: 'attention', fichero: 'attention_2017.pdf', desde: 1, hasta: 15, capa: ref('attention_2017.pdf') },
    { id: 'fax', fichero: 'scanned_ocr_test.pdf', desde: 1, hasta: 1 },
  ];
}

/** Capa de texto con PyMuPDF (si está), para los PDF digitales. */
function capaDeTexto(ruta: string): Record<string, string> | undefined {
  try {
    const salida = execFileSync('python3', ['-I', '-c', 'import fitz,json,sys; d=fitz.open(sys.argv[1]); print(json.dumps({str(i+1):d[i].get_text() for i in range(d.page_count)}))', ruta], { maxBuffer: 1 << 28 });
    return JSON.parse(salida.toString()) as Record<string, string>;
  } catch { return undefined; }
}

function textoCompleto(p: PaginaLeida): string {
  return [p.cabecera, p.folio ?? '', p.texto, ...p.notas, p.pie].join('\n');
}

interface MedidaLector {
  doc: string; lector: string; pliego: number; llamadas: number; paginas: number;
  muroS: number; latMediaS: number; latMaxS: number; sPorPagina: number; proy300S: number;
  usd: number; usdPor1000: number; tokSalidaPorPagina: number;
  cerOro?: number; f1?: number; folios?: string; errores: number; vacias: number;
}

async function medirLector(nombre: string, lector: Lector, doc: DocBanco, tamPliego: number, contador: ContadorUso, concurrencia = 16): Promise<{ medida: MedidaLector; paginas: PaginaLeida[] }> {
  const pdf = leerBytes(join(ORIGINALES, doc.fichero));
  const trozo = await cortarPdf(pdf, doc.desde - 1, doc.hasta);
  const pliegos = (await pliegosPdf(trozo, tamPliego)).map((p) => ({ ...p, primeraFisica: p.primeraFisica + doc.desde - 1 }));
  contador.reiniciar();
  const lat: number[] = [];
  let errores = 0;
  const t0 = performance.now();
  const resultados = await enParalelo(pliegos, concurrencia, async (p) => {
    const t = performance.now();
    try {
      const r = await lector.leerPliego({ pdf: p.pdf, primeraFisica: p.primeraFisica, ...(doc.pista ? { pista: doc.pista } : {}) });
      lat.push((performance.now() - t) / 1000);
      return r;
    } catch (e) {
      errores++;
      console.error(`  ✗ ${nombre} ${doc.id} pliego ${p.primeraFisica}: ${(e as Error).message.slice(0, 300)}`);
      return [] as PaginaLeida[];
    }
  });
  const muro = (performance.now() - t0) / 1000;
  const paginas = resultados.flat();
  const total = contador.total();
  const n = doc.hasta - doc.desde + 1;
  const latMedia = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : NaN;
  const medida: MedidaLector = {
    doc: doc.id, lector: nombre, pliego: tamPliego, llamadas: pliegos.length, paginas: paginas.length,
    muroS: muro, latMediaS: latMedia, latMaxS: lat.length ? Math.max(...lat) : NaN,
    sPorPagina: latMedia / tamPliego,
    // 300 páginas con 16 llamadas simultáneas: rondas × latencia media.
    proy300S: Math.ceil(300 / (tamPliego * 16)) * latMedia,
    usd: total.usd, usdPor1000: (total.usd / Math.max(1, paginas.length)) * 1000,
    tokSalidaPorPagina: total.tokensSalida / Math.max(1, paginas.length),
    errores, vacias: paginas.filter((p) => !p.texto && !p.vacia).length,
  };
  if (doc.oro) {
    const p = paginas.find((x) => x.fisica === doc.oro?.fisica);
    if (p) medida.cerOro = cer(p.texto, doc.oro.texto);
  }
  if (doc.capa) {
    const f1s = paginas.map((p) => f1Palabras(textoCompleto(p), doc.capa?.[String(p.fisica)] ?? '').f1).filter((x) => Number.isFinite(x));
    medida.f1 = f1s.reduce((a, b) => a + b, 0) / Math.max(1, f1s.length);
  }
  if (doc.desfaseFolio !== undefined) {
    const conFolio = paginas.filter((p) => p.folio);
    const bien = conFolio.filter((p) => p.folio === String(p.fisica + (doc.desfaseFolio as number)));
    medida.folios = `${bien.length}/${conFolio.length} (de ${paginas.length})`;
  } else {
    medida.folios = `${paginas.filter((p) => p.folio).length}/${paginas.length} con folio`;
  }
  return { medida, paginas };
}

function filaLector(m: MedidaLector): Array<string | number> {
  return [m.doc, m.lector, m.pliego, m.llamadas, m.muroS, m.latMediaS, m.sPorPagina, m.proy300S, m.usdPor1000, Math.round(m.tokSalidaPorPagina),
    m.cerOro !== undefined ? m.cerOro : '—', m.f1 !== undefined ? m.f1 : '—', m.folios ?? '—', m.errores, m.vacias];
}
const CABECERA_LECTOR = ['doc', 'lector', 'pliego', 'llamadas', 'muro s', 'lat. media s', 's/página', 'proy. 300 p (s)', '$/1000 p', 'tok sal./p', 'CER oro', 'F1 capa', 'folios', 'errores', 'vacías'];

// ---------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------

async function seccionLector(): Promise<void> {
  if (!claves.gemini) { decir('Sin GEMINI_API_KEY: se salta el lector.'); return; }
  const contador = new ContadorUso();
  const g = crearGemini({ clave: claves.gemini, contador, concurrencia: 32 });
  const modelos = (process.env.MODELOS ?? 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash').split(',');
  const tams = (process.env.PLIEGOS ?? '1,4,8,16').split(',').map(Number);
  const docs = documentos().filter((d) => !process.env.DOCS || process.env.DOCS.split(',').includes(d.id));
  const medidas: MedidaLector[] = [];
  const muestras: Record<string, PaginaLeida[]> = {};
  for (const doc of docs) {
    for (const modelo of modelos) {
      for (const tam of tams) {
        if (tam > doc.hasta - doc.desde + 1 && tam !== tams[0]) continue;
        const { medida, paginas } = await medirLector(modelo, g.lector({ modelo }), doc, tam, contador);
        medidas.push(medida);
        muestras[`${doc.id}|${modelo}|${tam}`] = paginas;
        console.log(tabla(CABECERA_LECTOR, [filaLector(medida)]).split('\n')[2]);
      }
    }
  }
  guardar('lector.json', medidas);
  guardar('lector-muestras.json', muestras);
  decir('\n### Lector Gemini: modelo × tamaño de pliego\n');
  decir(tabla(CABECERA_LECTOR, medidas.map(filaLector)));
  // Referencia: la tubería antigua (Gemma 3 27B) en la página de oro.
  const viejo = join(tmpdir(), 'provwork', 'ref', 'viejo-casamiento-p10.txt');
  const oro = documentos()[0]?.oro;
  if (existsSync(viejo) && oro) decir(`\nCER de la tubería antigua (Gemma-3-27B, SPDF v3) en la página de oro: ${cer(readFileSync(viejo, 'utf8'), oro.texto).toFixed(3)}`);
}

/** El mismo pliego como imágenes JPEG (lo que manda el navegador) en vez de PDF. */
async function seccionImagenes(): Promise<void> {
  if (!claves.gemini) return;
  const doc = documentos()[0] as DocBanco;
  const dir = join(tmpdir(), 'provwork', 'jpg');
  execFileSync('mkdir', ['-p', dir]);
  if (!existsSync(join(dir, `p-${doc.desde}.jpg`))) {
    execFileSync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=82', '-r', '150', '-f', String(doc.desde), '-l', String(doc.hasta), join(ORIGINALES, doc.fichero), join(dir, 'p')]);
  }
  const ficheros = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
  const imagenes = ficheros.map((f) => ({ bytes: leerBytes(join(dir, f)), mime: 'image/jpeg' }));
  const contador = new ContadorUso();
  const g = crearGemini({ clave: claves.gemini, contador });
  const filas: Array<Array<string | number>> = [];
  for (const modelo of (process.env.MODELOS ?? 'gemini-3.5-flash-lite,gemini-3.8-flash').split(',')) {
    for (const tam of [4, 8]) {
      contador.reiniciar();
      const lector = g.lector({ modelo });
      const grupos: Array<{ imagenes: typeof imagenes; primeraFisica: number }> = [];
      for (let i = 0; i < imagenes.length; i += tam) grupos.push({ imagenes: imagenes.slice(i, i + tam), primeraFisica: doc.desde + i });
      const lat: number[] = [];
      const t0 = performance.now();
      const res = (await enParalelo(grupos, 16, async (gr) => { const t = performance.now(); const r = await lector.leerPliego({ ...gr, pista: doc.pista }); lat.push((performance.now() - t) / 1000); return r; })).flat();
      const muro = (performance.now() - t0) / 1000;
      const p10 = res.find((p) => p.fisica === doc.oro?.fisica);
      const latMedia = lat.reduce((a, b) => a + b, 0) / lat.length;
      filas.push([modelo, tam, muro, latMedia, latMedia / tam, (contador.total().usd / res.length) * 1000, p10 && doc.oro ? cer(p10.texto, doc.oro.texto) : '—']);
      console.log(filas[filas.length - 1]?.join(' | '));
    }
  }
  decir('\n### Lector Gemini con imágenes JPEG (150 ppp) en vez de PDF\n');
  decir(tabla(['modelo', 'pliego', 'muro s', 'lat. media s', 's/página', '$/1000 p', 'CER oro'], filas));
}

async function seccionEmbebedor(): Promise<void> {
  if (!claves.gemini) return;
  const contador = new ContadorUso();
  const g = crearGemini({ clave: claves.gemini, contador });
  const e = g.embebedor();
  const docs = [
    'El Instituto de Reforma Agraria apenas logró asentar a unos 12.000 campesinos en 1933.',
    'La desamortización de Mendizábal de 1836 expropió bienes eclesiásticos.',
    'Attention is all you need: the Transformer relies entirely on self-attention.',
    'Quiero que mi amor se vea, pues es esta la librea de la color de los Cielos.',
  ];
  const consultas = ['¿Cuántos campesinos asentó el IRA?', 'transformer architecture without recurrence', 'versos de amor y celos en una comedia del Siglo de Oro'];
  const t0 = performance.now();
  const vd = await e.vectorizar(docs.map((texto) => ({ modalidad: 'texto' as const, texto })), 'documento');
  const vq = await e.vectorizar(consultas.map((texto) => ({ modalidad: 'texto' as const, texto })), 'consulta');
  const msTexto = performance.now() - t0;
  const aciertos = vq.map((q, i) => {
    const s = vd.map((d) => coseno(q, d));
    return { consulta: consultas[i], mejor: s.indexOf(Math.max(...s)), puntuaciones: s.map((x) => +x.toFixed(3)) };
  });
  // Multimodal: imagen de página y PDF de una página.
  const jpg = join(tmpdir(), 'provwork', 'jpg', 'p-10.jpg');
  const filas: Array<Array<string | number>> = [['texto (4 doc + 3 consultas)', vd[0]?.length ?? 0, msTexto, aciertos.map((a) => a.mejor).join(',')]];
  if (existsSync(jpg)) {
    const t1 = performance.now();
    const [vi] = await e.vectorizar([{ modalidad: 'imagen', bytes: leerBytes(jpg), mime: 'image/jpeg' }], 'documento');
    const ms = performance.now() - t1;
    const s = vq.map((q) => coseno(q, vi as Float32Array));
    filas.push(['imagen de la p. 10 del Casamiento', vi?.length ?? 0, ms, `coseno con consultas: ${s.map((x) => x.toFixed(3)).join(', ')} (la 3.ª es la suya)`]);
  }
  const pdf = await cortarPdf(leerBytes(join(ORIGINALES, 'attention_2017.pdf')), 2, 3);
  const t2 = performance.now();
  const [vp] = await e.vectorizar([{ modalidad: 'pdf', bytes: pdf }], 'documento');
  filas.push(['PDF de 1 página (Attention, p. 3)', vp?.length ?? 0, performance.now() - t2, `coseno con «transformer…»: ${coseno(vq[1] as Float32Array, vp as Float32Array).toFixed(3)}, con «IRA»: ${coseno(vq[0] as Float32Array, vp as Float32Array).toFixed(3)}`]);
  const audio = join(ORIGINALES, 'audio_conference.mp3');
  if (existsSync(audio)) {
    const t3 = performance.now();
    try {
      const [va] = await e.vectorizar([{ modalidad: 'audio', bytes: leerBytes(audio), mime: 'audio/mpeg' }], 'documento');
      const vqa = await e.vectorizar([{ modalidad: 'texto', texto: 'what is a vector in linear algebra' }], 'consulta');
      filas.push(['audio 60 s (3b1b, vectores)', va?.length ?? 0, performance.now() - t3, `coseno con «what is a vector»: ${coseno(vqa[0] as Float32Array, va as Float32Array).toFixed(3)}, con «IRA»: ${coseno(vq[0] as Float32Array, va as Float32Array).toFixed(3)}`]);
    } catch (err) { filas.push(['audio 60 s', 0, 0, `ERROR ${(err as Error).message.slice(0, 160)}`]); }
  }
  // Lote grande: 300 fragmentos en una tanda.
  const muchos = Array.from({ length: 300 }, (_, i) => ({ modalidad: 'texto' as const, texto: `Fragmento ${i}: ${docs[i % docs.length]} ${'lorem ipsum '.repeat(40)}` }));
  const t4 = performance.now();
  await e.vectorizar(muchos, 'documento');
  filas.push(['lote de 300 fragmentos (~150 tokens)', 1536, performance.now() - t4, `${(300 / ((performance.now() - t4) / 1000)).toFixed(0)} fragmentos/s`]);
  decir('\n### Embebedor Gemini Embedding 2 @1536\n');
  decir(tabla(['prueba', 'dims', 'ms', 'resultado'], filas));
  decir(`\nRecuperación de texto (mejor documento por consulta; esperado 0,2,3): ${JSON.stringify(aciertos)}`);
  decir(`\nCoste total de la sección: $${contador.total().usd.toFixed(5)} (${contador.total().tokensEntrada} tokens)`);
}

async function seccionRedactor(): Promise<void> {
  if (!claves.gemini) return;
  const contador = new ContadorUso();
  const g = crearGemini({ clave: claves.gemini, contador });
  const r = g.redactor({ umbralCache: 8_000 });
  const esquema = { type: 'object', properties: { contexto: { type: 'string' } }, required: ['contexto'] };
  const sistema = `Eres un bibliotecario. Este es el libro completo del que salen los fragmentos:\n\n${readFileSync(join(AQUI, 'oro', 'casamiento-p10.txt'), 'utf8').repeat(12)}`;
  const filas: Array<Array<string | number>> = [];
  for (const calidad of ['rapida', 'alta'] as const) {
    for (let i = 0; i < 2; i++) {
      contador.reiniciar();
      const t0 = performance.now();
      const res = await r.generar<{ contexto: string }>({
        sistema, calidad, esquema,
        mensajes: [{ rol: 'usuario', partes: [{ texto: 'Escribe UNA línea que sitúe este fragmento dentro de la obra: «Los zelos de quien me quexo han este amor aumentado».' }] }],
      });
      const t = contador.total();
      filas.push([calidad, i + 1, performance.now() - t0, t.tokensEntrada, t.tokensCache, t.tokensSalida, t.usd, (res.json?.contexto ?? res.texto).slice(0, 120)]);
    }
  }
  decir('\n### Redactor Gemini (JSON por esquema, caché explícita del sistema)\n');
  decir(tabla(['calidad', 'llamada', 'ms', 'tok entrada', 'tok caché', 'tok salida', 'usd', 'respuesta'], filas));
}

async function seccionTranscriptor(): Promise<void> {
  const audio = { bytes: leerBytes(join(ORIGINALES, 'audio_conference.mp3')), mime: 'audio/mpeg' };
  const filas: Array<Array<string | number>> = [];
  const probar = async (nombre: string, fn: () => Promise<{ texto: string; palabras: Array<{ t0: number; t1: number; hablante?: string }> }>, contador: ContadorUso) => {
    contador.reiniciar();
    const t0 = performance.now();
    try {
      const t = await fn();
      const hablantes = new Set(t.palabras.map((p) => p.hablante).filter(Boolean)).size;
      filas.push([nombre, performance.now() - t0, t.palabras.length, hablantes, t.palabras[0] ? `${t.palabras[0].t0.toFixed(2)}–${t.palabras.at(-1)?.t1.toFixed(2)}` : '—', contador.total().usd, t.texto.slice(0, 90)]);
    } catch (e) { filas.push([nombre, performance.now() - t0, 0, 0, '—', 0, `ERROR ${(e as Error).message.slice(0, 160)}`]); }
  };
  if (claves.gemini) {
    const c = new ContadorUso();
    const tr = crearGemini({ clave: claves.gemini, contador: c }).transcriptor();
    await probar('gemini-3.5-transcribe', () => tr.transcribir(audio, { hablantes: true }), c);
  }
  if (claves.cloudflare) {
    const c = new ContadorUso();
    const tr = crearWorkersAI({ cuenta: CUENTA_CF, token: claves.cloudflare, contador: c }).transcriptor();
    await probar('@cf/openai/whisper-large-v3-turbo', () => tr.transcribir(audio, {}), c);
  }
  decir('\n### Transcriptores (audio de 60 s, mp3)\n');
  decir(tabla(['transcriptor', 'ms', 'palabras', 'hablantes', 'tramo s', 'usd', 'texto'], filas));
}

async function seccionWorkers(): Promise<void> {
  if (!claves.cloudflare) { decir('\nSin token de Cloudflare: Workers AI sin probar en vivo.'); return; }
  const contador = new ContadorUso();
  const w = crearWorkersAI({ cuenta: CUENTA_CF, token: claves.cloudflare, contador });
  const filas: Array<Array<string | number>> = [];
  const doc = documentos()[0] as DocBanco;
  const jpgDir = join(tmpdir(), 'provwork', 'jpg');
  if (existsSync(join(jpgDir, 'p-10.jpg'))) {
    for (const modelo of (process.env.MODELOS_CF ?? '@cf/google/gemma-4-26b-a4b-it,@cf/zai-org/glm-5.3-flash,@cf/meta/llama-4-scout-17b-16e-instruct,@cf/mistralai/mistral-small-3.1-24b-instruct').split(',')) {
      contador.reiniciar();
      const t0 = performance.now();
      try {
        const [p] = await w.lector({ modelo }).leerPliego({ imagenes: [{ bytes: leerBytes(join(jpgDir, 'p-10.jpg')), mime: 'image/jpeg' }], primeraFisica: 10, pista: doc.pista });
        filas.push(['lector', modelo, performance.now() - t0, p ? cer(p.texto, doc.oro?.texto ?? '') : '—', p?.folio ?? '∅', contador.total().usd * 1000, (p?.texto ?? '').slice(0, 60).replace(/\n/g, ' ')]);
      } catch (e) { filas.push(['lector', modelo, performance.now() - t0, '—', '—', 0, `ERROR ${(e as Error).message.slice(0, 160)}`]); }
    }
  }
  // Reordenador y embebedor
  const consulta = '¿Cuántos campesinos asentó el Instituto de Reforma Agraria?';
  const pasajes = [
    'La desamortización de Mendizábal de 1836 expropió bienes eclesiásticos.',
    'El Instituto de Reforma Agraria apenas logró asentar a unos 12.000 campesinos en 1933.',
    'En 1932 se aprobó el Estatuto de Autonomía de Cataluña.',
  ];
  for (const [nombre, fn] of [
    ['reordenador bge-reranker-base', () => w.reordenador().reordenar(consulta, pasajes)],
    ['embebedor qwen3-embedding-0.6b', async () => { const v = await w.embebedor().vectorizar([{ modalidad: 'texto', texto: consulta }, ...pasajes.map((texto) => ({ modalidad: 'texto' as const, texto }))], 'documento'); return pasajes.map((_, i) => coseno(v[0] as Float32Array, v[i + 1] as Float32Array)); }],
  ] as const) {
    contador.reiniciar();
    const t0 = performance.now();
    try {
      const s = await fn();
      filas.push([nombre.split(' ')[0] as string, nombre.split(' ')[1] as string, performance.now() - t0, '—', '—', contador.total().usd * 1000, `puntuaciones ${s.map((x) => x.toFixed(3)).join(', ')} (la buena es la 2.ª)`]);
    } catch (e) { filas.push([nombre, '', performance.now() - t0, '—', '—', 0, `ERROR ${(e as Error).message.slice(0, 160)}`]); }
  }
  decir('\n### Workers AI (REST con el token OAuth de wrangler)\n');
  decir(tabla(['puerto', 'modelo', 'ms', 'CER oro p.10', 'folio', 'm$', 'resultado'], filas));
}

async function seccionOpenRouter(): Promise<void> {
  if (!claves.openrouter) return;
  const contador = new ContadorUso();
  const o = crearOpenRouter({ clave: claves.openrouter, contador });
  const doc = documentos()[0] as DocBanco;
  const filas: Array<Array<string | number>> = [];
  const pdf = await cortarPdf(leerBytes(join(ORIGINALES, doc.fichero)), 8, 12); // físicas 9-12
  for (const [nombre, lector] of [
    ['mistral-ocr + flash-lite', o.lector({ motor: 'mistral-ocr' })],
    ['nativo gemini-3.5-flash-lite', o.lector({ motor: 'native', modelo: 'google/gemini-3.5-flash-lite' })],
  ] as const) {
    contador.reiniciar();
    const t0 = performance.now();
    try {
      const pags = await lector.leerPliego({ pdf, primeraFisica: 9, pista: doc.pista });
      const p10 = pags.find((p) => p.fisica === 10);
      filas.push([nombre, performance.now() - t0, pags.length, p10 && doc.oro ? cer(p10.texto, doc.oro.texto) : '—', pags.map((p) => p.folio ?? '∅').join(' '), contador.total().usd]);
    } catch (e) { filas.push([nombre, performance.now() - t0, 0, '—', `ERROR ${(e as Error).message.slice(0, 200)}`, 0]); }
  }
  // Redactor genérico
  contador.reiniciar();
  const t0 = performance.now();
  const r = await o.redactor().generar<{ capital: string }>({ mensajes: [{ rol: 'usuario', partes: [{ texto: 'Capital de Francia.' }] }], esquema: { type: 'object', properties: { capital: { type: 'string' } }, required: ['capital'], additionalProperties: false } });
  filas.push(['redactor (por defecto)', performance.now() - t0, 0, '—', JSON.stringify(r.json), contador.total().usd]);
  decir('\n### OpenRouter (4 páginas del Casamiento, físicas 9-12)\n');
  decir(tabla(['lector', 'ms', 'páginas', 'CER oro p.10', 'folios', 'usd'], filas));
}

async function seccionJev(): Promise<void> {
  if (!claves.typesafe) return;
  const contador = new ContadorUso();
  const j = crearJev({ clave: claves.typesafe, contador });
  const afirmacion = 'La reforma agraria de 1932 fracasó en parte por la lentitud del Instituto de Reforma Agraria en asentar campesinos.';
  const pasajes = [
    'La desamortización de Mendizábal de 1836 expropió bienes eclesiásticos que pasaron a manos de la burguesía.',
    'El Instituto de Reforma Agraria, creado por la ley de septiembre de 1932, apenas logró asentar a unos 12.000 campesinos en 1933, un ritmo que frustró las expectativas de los jornaleros.',
    'Contra la idea de lentitud, el IRA asentó con rapidez a más de 100.000 familias durante 1933.',
    'En 1932 la Segunda República aprobó el Estatuto de Autonomía de Cataluña.',
  ];
  const t0 = performance.now();
  const puntos = await j.reordenador().reordenar(afirmacion, pasajes);
  const msR = performance.now() - t0;
  const usdR = contador.total().usd;
  contador.reiniciar();
  const t1 = performance.now();
  const resp = await j.juez().juzgar({ afirmacion, pasaje: pasajes[1], folios: ['142', 'HISTORIA AGRARIA', '57'] }, {
    respalda: { tipo: 'si_no', instrucciones: '¿Respalda `pasaje` la afirmación concreta de `afirmacion`?', criterios: { si: 'El pasaje da hechos que respaldan directamente la afirmación.', no: 'El pasaje solo trata un tema cercano o la contradice.' } },
    relacion: { tipo: 'eleccion', instrucciones: '¿Qué relación tiene `pasaje` con `afirmacion` si se cita como fuente?', opciones: { APOYO_DIRECTO: 'El pasaje afirma lo mismo con datos.', CONTEXTO: 'Solo da contexto.', CONTRADICCION: 'Dice lo contrario.' } },
    folio: { tipo: 'eleccion', instrucciones: '¿Cuál de `folios` es el número de página impreso?', opciones: { '142': null, 'HISTORIA AGRARIA': null, '57': 'número de la revista' } },
    grado: { tipo: 'escala', instrucciones: '¿Cuánto respalda `pasaje` la afirmación?', niveles: ['Nada', 'Tema cercano', 'Parcialmente', 'Directamente'] },
  });
  const msJ = performance.now() - t1;
  decir('\n### Jev (TypeSafe)\n');
  decir(tabla(['prueba', 'ms', 'usd', 'resultado'], [
    ['reordenar 4 pasajes (1 petición)', msR, usdR, puntos.map((x) => x.toFixed(3)).join(', ') + ' (la buena es la 2.ª; la 3.ª contradice)'],
    ['juez: 4 preguntas (si_no, eleccion×2, escala)', msJ, contador.total().usd, JSON.stringify(resp)],
  ]));
}

async function seccionCascada(): Promise<void> {
  if (!claves.gemini) return;
  const contador = new ContadorUso();
  const g = crearGemini({ clave: claves.gemini, contador });
  const lectores: Lector[] = [g.lector()];
  if (claves.cloudflare) lectores.unshift(crearWorkersAI({ cuenta: CUENTA_CF, token: claves.cloudflare, contador }).lector());
  const casc = cascadaLectores(lectores, { alPasar: (i) => decir(`  · cascada: ${i.lector} → siguiente en físicas ${i.paginas.join(',')} (${i.motivo})`) });
  const doc = documentos()[3] as DocBanco; // el fax escaneado, una página
  const t0 = performance.now();
  const pags = await casc.leerPliego({ pdf: leerBytes(join(ORIGINALES, doc.fichero)), primeraFisica: 1 });
  decir('\n### Cascada (fax escaneado de 1 página)\n');
  decir(tabla(['ms', 'lector final', 'caracteres', 'usd'], [[performance.now() - t0, (pags[0] as PaginaLeida & { lector?: string }).lector ?? '¿?', pags[0]?.texto.length ?? 0, contador.total().usd]]));
}

async function seccionInteligencia(): Promise<void> {
  const usos: UsoProveedor[] = [];
  const intel = crearInteligencia({
    GEMINI_API_KEY: claves.gemini, OPENROUTER_API_KEY: claves.openrouter, TYPESAFE_API_KEY: claves.typesafe,
    CLOUDFLARE_ACCOUNT_ID: CUENTA_CF, CLOUDFLARE_API_TOKEN: claves.cloudflare,
  }, { onUso: (u) => usos.push(u) });
  const v = await intel.embebedor.vectorizar([{ modalidad: 'texto', texto: 'hola' }], 'consulta');
  const s = await intel.reordenador.reordenar('capital de Francia', ['París es la capital de Francia.', 'Madrid es la capital de España.']);
  decir('\n### crearInteligencia (configuración por defecto)\n');
  decir(tabla(['pieza', 'nombre'], [
    ['lector', intel.lector.nombre], ['reserva', (intel.lectoresReserva ?? []).map((l) => l.nombre).join(', ') || '—'],
    ['embebedor', intel.embebedor.espacio.id], ['transcriptor', intel.transcriptor.nombre], ['reordenador', intel.reordenador.nombre],
    ['juez', intel.juez.nombre], ['redactor', intel.redactor.nombre],
  ]));
  decir(`\nPrueba: vector de ${v[0]?.length} dims; reordenar → ${s.map((x) => x.toFixed(3)).join(', ')}; ${usos.length} usos registrados por onUso.`);
}

const SECCIONES: Record<string, () => Promise<void>> = {
  lector: seccionLector, imagenes: seccionImagenes, embebedor: seccionEmbebedor, redactor: seccionRedactor,
  transcriptor: seccionTranscriptor, workers: seccionWorkers, openrouter: seccionOpenRouter, jev: seccionJev,
  cascada: seccionCascada, inteligencia: seccionInteligencia,
};

const pedidas = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SECCIONES);
for (const s of pedidas) {
  const fn = SECCIONES[s];
  if (!fn) { console.error(`Sección desconocida: ${s}`); continue; }
  console.log(`\n=== ${s} ===`);
  try { await fn(); } catch (e) { decir(`\n**${s}: ERROR** ${(e as Error).stack?.slice(0, 600)}`); }
  guardar(`${s}.md`, informe.join('\n'));
  informe.length = 0;
}
console.log(`\nResultados en ${SALIDA}`);
