/**
 * Banco de metadatos: la ficha de los SPDF del banco antes (la que quedó
 * escrita en el SPDF) y después (el paso de metadatos actual con el
 * enriquecimiento consciente de la edición), campo a campo, contra una ficha
 * de referencia hecha a mano.
 *
 *   pnpm --filter @scholaris/bench exec tsx src/metadatos.ts [etiqueta…] [--sin-red] [--sin-redactor]
 *
 * Usa la red de verdad (Gemini para la lectura; OpenAlex, Crossref, Open
 * Library, Wikidata, Wikipedia, arXiv y DataCite para el enriquecimiento) con
 * una caché en disco: la segunda pasada no consulta los catálogos.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, setGlobalDispatcher } from 'undici';
import type { Ancla, MetadatosDocumento } from '@scholaris/nucleo';
import { pasoMetadatos, refinarMetadatos, rehacerFicha, type CacheConsultas, type UnidadLeida } from '@scholaris/ingesta';
import { crearInteligencia } from '@scholaris/proveedores';
import { cargarEntorno } from './entorno.js';

setGlobalDispatcher(new Agent({ connections: 32, keepAliveTimeout: 4_000, keepAliveMaxTimeout: 10_000 }));

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(raiz, 'datos', 'salida');
const RESULTADOS = join(raiz, 'resultados', 'metadatos');

// ---------------------------------------------------------------------------
// Fichas de referencia (comprobadas a mano en las páginas y en los catálogos)
// ---------------------------------------------------------------------------

interface Oro {
  /** SPDF del que se toma el texto (por defecto, la etiqueta). */
  spdf?: string;
  archivo: string;
  tipo: string;
  duracion?: number;
  /** Apellido (primer apellido sin partícula) de cada autor, en orden; basta con que estén. */
  autores: string[];
  /** Comprobaciones por campo: valor esperado o función. `null` = debe faltar. */
  campos: Partial<Record<string, string | number | null | ((m: MetadatosDocumento) => boolean)>>;
}

const contiene = (campo: keyof MetadatosDocumento, ...trozos: string[]) => (m: MetadatosDocumento) => {
  const v = String(m[campo] ?? '').toLowerCase();
  return trozos.some((t) => v.includes(t.toLowerCase()));
};

const ORO: Record<string, Oro> = {
  discarded: {
    archivo: 'the_discarded_image_an_introduction_t_z.pdf', tipo: 'pdf',
    autores: ['lewis'],
    campos: { titulo: 'The Discarded Image', anio: 1964, anioObra: 1964, editorial: contiene('editorial', 'cambridge'), lugar: contiene('lugar', 'cambridge', 'london'), tipoCSL: 'book' },
  },
  attention_2017: {
    archivo: 'attention_2017.pdf', tipo: 'pdf',
    autores: ['vaswani', 'shazeer', 'parmar', 'uszkoreit', 'jones', 'gomez', 'kaiser', 'polosukhin'],
    campos: { titulo: 'Attention Is All You Need', anio: 2017, anioObra: 2017, tipoCSL: 'paper-conference', contenedor: contiene('contenedor', 'neural information processing'), identificador: (m) => /1706\.03762/.test(`${m.doi ?? ''} ${m.url ?? ''}`) },
  },
  cortazar1959persegui: {
    archivo: 'cortazar1959perseguidor.pdf', tipo: 'pdf',
    autores: ['cortazar'],
    campos: { titulo: 'El perseguidor', anioObra: 1959, tipoCSL: 'chapter', contenedor: contiene('contenedor', 'armas secretas'), editorial: contiene('editorial', 'sudamericana'), idioma: 'es' },
  },
  'el-casamiento-en-la-': {
    archivo: 'el-casamiento-en-la-muerte-y-hechos-de-b.pdf', tipo: 'pdf_escaneado',
    autores: ['vega'],
    campos: {
      titulo: (m) => /casamiento en la muerte/i.test(m.titulo), anio: null, tipoCSL: 'book', lugar: 'Sevilla', editorial: contiene('editorial', 'leefdael'),
      particula: (m) => /^de Vega/.test(m.autores[0]?.apellidos ?? '') && m.autores[0]?.nombre === 'Lope',
      sinFecha: (m) => m.sinFecha?.desde === 1729 && m.sinFecha?.hasta === 1753 && Boolean(m.sinFecha.fundamento),
    },
  },
  // RTVE Play (api/programas/73250): «Facundo Cabral», emitido el 2-7-1978; «Julio Cortázar», el 20-3-1977.
  // El entrevistado es el autor; Soler Serrano, el entrevistador; «A fondo», el contenedor.
  serrano: {
    archivo: 'serrano1977fondo.mp4', tipo: 'video', duracion: 3219,
    autores: ['cabral'],
    campos: {
      titulo: (m) => /cabral/i.test(m.titulo) && !/^a fondo$/i.test(m.titulo), anio: 1978, tipoCSL: (m) => m.tipoCSL === 'broadcast' || m.tipoCSL === 'interview',
      editorial: contiene('editorial', 'rtve', 'tve', 'televisión española'), contenedor: contiene('contenedor', 'a fondo'),
      entrevistador: (m) => Boolean(m.entrevistadores?.some((a) => a.nombre === 'Joaquín' && a.apellidos === 'Soler Serrano')),
    },
  },
  'cortazar-afondo': {
    archivo: 'cortazar1977afondo.mp4', tipo: 'video', duracion: 7328,
    autores: ['cortazar'],
    campos: {
      titulo: (m) => /cort[áa]zar/i.test(m.titulo) && !/^a fondo$/i.test(m.titulo), anio: 1977, tipoCSL: (m) => m.tipoCSL === 'broadcast' || m.tipoCSL === 'interview',
      editorial: contiene('editorial', 'rtve', 'tve', 'televisión española'), contenedor: contiene('contenedor', 'a fondo'),
      entrevistador: (m) => Boolean(m.entrevistadores?.some((a) => a.nombre === 'Joaquín' && a.apellidos === 'Soler Serrano')),
    },
  },
  // La misma entrevista a Cabral, subida con un nombre de archivo que engaña (el defecto del preview: «Entrevista a Alberto Cortez»).
  // Tiene que ganar lo que dice la grabación, o no asignarse nada.
  'serrano-engano': {
    spdf: 'serrano', archivo: 'A fondo - Alberto Cortez.mp4', tipo: 'video', duracion: 3219,
    autores: ['cabral'],
    campos: {
      titulo: (m) => /cabral/i.test(m.titulo) && !/cortez/i.test(m.titulo), sinCortez: (m) => !m.autores.some((a) => /cortez/i.test(a.apellidos)), anio: 1978,
      contenedor: contiene('contenedor', 'a fondo'), entrevistador: (m) => Boolean(m.entrevistadores?.some((a) => a.apellidos === 'Soler Serrano')),
    },
  },
  // El mismo vídeo con la ficha que tenía en el preview: el canal como único autor. Rehacer: persona como autor, una sola vez; canal a editorial.
  '3b1b-canal': {
    spdf: '3b1b_1min_real', archivo: 'vectors.mp4', tipo: 'video', duracion: 60,
    autores: ['sanderson'],
    campos: { sinCanalDeAutor: (m) => !m.autores.some((a) => /3blue1brown/i.test(`${a.nombre} ${a.apellidos}`)), editorial: contiene('editorial', '3blue1brown') },
  },
  // «Vectors | Chapter 1, Essence of linear algebra», 3Blue1Brown (Grant Sanderson): el capítulo dentro de la serie.
  '3b1b_1min_real': {
    archivo: '3b1b_1min_real.mp4', tipo: 'video', duracion: 60,
    autores: ['sanderson'],
    campos: { titulo: (m) => /^vectors\b/i.test(m.titulo), contenedor: contiene('contenedor', 'essence of linear algebra') },
  },
};

// ---------------------------------------------------------------------------
// Puntuación
// ---------------------------------------------------------------------------

const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function puntuar(m: MetadatosDocumento, oro: Oro): Record<string, boolean> {
  const r: Record<string, boolean> = {};
  const apellidos = m.autores.map((a) => sinTildes(a.apellidos).replace(/^(de|del|van|von)\s+/, '').split(/\s+/)[0] ?? '');
  r.autores = oro.autores.every((a) => apellidos.includes(a)) && m.autores.length <= oro.autores.length + 1;
  for (const [campo, esperado] of Object.entries(oro.campos)) {
    if (typeof esperado === 'function') { r[campo] = esperado(m); continue; }
    // «anioObra»: el año que usa la lógica temporal de las citas (anioOriginal ?? anio).
    const valor = campo === 'anioObra' ? (m.anioOriginal ?? m.anio) : (m as unknown as Record<string, unknown>)[campo];
    r[campo] = esperado === null ? valor === undefined : typeof esperado === 'string' ? sinTildes(String(valor ?? '')) === sinTildes(esperado) : valor === esperado;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Lectura del SPDF
// ---------------------------------------------------------------------------

function cargar(etiqueta: string): { antes: MetadatosDocumento; unidades: UnidadLeida[] } {
  const db = new Database(join(SALIDA, `${etiqueta}.sqlite`), { readonly: true });
  const doc = db.prepare('SELECT metadatos FROM documentos LIMIT 1').get() as { metadatos: string };
  const filas = db.prepare('SELECT orden, ancla, texto, notas, cabecera, pie, t0, t1 FROM unidades ORDER BY orden').all() as Array<{ orden: number; ancla: string; texto: string; notas: string | null; cabecera: string | null; pie: string | null; t0: number | null; t1: number | null }>;
  db.close();
  const unidades: UnidadLeida[] = filas.map((f) => {
    const ancla = JSON.parse(f.ancla) as Ancla;
    let notas: string[] = [];
    try { notas = f.notas ? (JSON.parse(f.notas) as string[]) : []; } catch { notas = []; }
    return {
      orden: f.orden, fisica: ancla.tipo === 'pagina' ? ancla.fisica : f.orden + 1, texto: f.texto ?? '', notas, cabecera: f.cabecera ?? '', pie: f.pie ?? '',
      folioVisto: null, titulos: [], figuras: [], vacia: !f.texto?.trim(), lector: 'spdf', confianza: 1, ancla,
      ...(f.t0 !== null ? { t0: f.t0 } : {}), ...(f.t1 !== null ? { t1: f.t1 } : {}), ...(ancla.tipo === 'tiempo' && ancla.hablante ? { hablante: ancla.hablante } : {}),
    };
  });
  return { antes: JSON.parse(doc.metadatos) as MetadatosDocumento, unidades };
}

function cacheEnDisco(ruta: string): CacheConsultas & { volcar(): void } {
  const datos: Record<string, string> = existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) : {};
  return {
    async leer(k) { return datos[k]; },
    async guardar(k, v) { datos[k] = v; },
    volcar() { mkdirSync(dirname(ruta), { recursive: true }); writeFileSync(ruta, JSON.stringify(datos)); },
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const sinRed = args.includes('--sin-red');
  const sinRedactor = args.includes('--sin-redactor');
  const etiquetas = args.filter((a) => !a.startsWith('--'));
  const casos = etiquetas.length ? etiquetas : Object.keys(ORO);
  const ia = sinRedactor ? null : crearInteligencia(cargarEntorno(), { concurrencia: 8 });
  const cache = cacheEnDisco(join(RESULTADOS, 'cache-consultas.json'));
  const informe: Record<string, unknown> = {};
  // «Antes»: la ficha congelada del paso anterior (los .sqlite se reescriben al reingerir).
  const congeladas = existsSync(join(RESULTADOS, 'antes.json')) ? (JSON.parse(readFileSync(join(RESULTADOS, 'antes.json'), 'utf8')) as Record<string, MetadatosDocumento>) : {};
  const tabla: Array<{ etiqueta: string; campo: string; antes: boolean; despues: boolean; rehecho: boolean }> = [];
  const empeoran: string[] = [];

  for (const etiqueta of casos) {
    const oro = ORO[etiqueta];
    if (!oro) { console.error(`Sin ficha de referencia: ${etiqueta}`); continue; }
    const { antes: delSpdf, unidades } = cargar(oro.spdf ?? etiqueta);
    const antes = congeladas[etiqueta] ?? delSpdf;
    const medio = oro.tipo === 'video' || oro.tipo === 'audio';
    const t0 = Date.now();
    const entrada = {
      ficha: {}, nombreArchivo: oro.archivo, tipo: oro.tipo, epub: false,
      ...(oro.duracion ? { duracion: oro.duracion } : {}),
      // Como el orquestador: las 5 primeras páginas (o la transcripción entera en un medio)…
      unidades: medio ? unidades : unidades.slice(0, 5),
    };
    const puertos = { ...(ia ? { redactor: ia.redactor } : {}), cache, correo: 'jl@joseluissaorin.com' };
    const opciones = sinRed ? { sinVerificacion: true } : {};
    let r = await pasoMetadatos(entrada, puertos, opciones);
    // …y, con el libro entero ya leído, el refinado con créditos y colofón.
    if (!medio) r = await refinarMetadatos(r, { ...entrada, todas: unidades }, puertos, opciones);
    const ms = Date.now() - t0;
    // «Rehacer» sobre la ficha anterior (sin procedencia, como las migradas de la v1): nunca puede empeorarla.
    const rh = await rehacerFicha(antes, { tipo: oro.tipo, nombreArchivo: oro.archivo, ...(oro.duracion ? { duracion: oro.duracion } : {}), unidades }, puertos, opciones);
    const pa = puntuar(antes, oro), pd = puntuar(r.metadatos, oro), pr = puntuar(rh.metadatos, oro);
    for (const campo of Object.keys(pd)) {
      tabla.push({ etiqueta, campo, antes: Boolean(pa[campo]), despues: Boolean(pd[campo]), rehecho: Boolean(pr[campo]) });
      if (pa[campo] && !pr[campo]) empeoran.push(`${etiqueta}.${campo}`);
    }
    informe[etiqueta] = { ms, antes, despues: r.metadatos, rehecho: rh.metadatos, puntuacion: { antes: pa, despues: pd, rehecho: pr }, procedencia: r.procedencia.filter((p) => p.proveedor === 'enriquecimiento' || (p.detalle as { respondieron?: unknown } | undefined)?.respondieron) };
    const ok = (p: Record<string, boolean>) => `${Object.values(p).filter(Boolean).length}/${Object.keys(p).length}`;
    console.error(`[${etiqueta}] ${(ms / 1000).toFixed(1)} s  antes ${ok(pa)}  después ${ok(pd)}  rehecho ${ok(pr)}  ${Object.entries(pd).filter(([, v]) => !v).map(([k]) => `✗${k}`).join(' ')}`);
    cache.volcar();
  }

  mkdirSync(RESULTADOS, { recursive: true });
  writeFileSync(join(RESULTADOS, 'informe.json'), JSON.stringify(informe, null, 2));
  // Precisión por campo (sobre los documentos donde el campo se comprueba).
  const porCampo = new Map<string, { n: number; antes: number; despues: number; rehecho: number }>();
  for (const f of tabla) {
    const c = porCampo.get(f.campo) ?? { n: 0, antes: 0, despues: 0, rehecho: 0 };
    c.n++; c.antes += Number(f.antes); c.despues += Number(f.despues); c.rehecho += Number(f.rehecho);
    porCampo.set(f.campo, c);
  }
  const lineas = ['| Campo | Documentos | Antes | Después | Rehecho sobre «antes» |', '|---|---|---|---|---|'];
  for (const [campo, c] of porCampo) lineas.push(`| ${campo} | ${c.n} | ${c.antes}/${c.n} | ${c.despues}/${c.n} | ${c.rehecho}/${c.n} |`);
  const total = tabla.reduce((a, f) => ({ antes: a.antes + Number(f.antes), despues: a.despues + Number(f.despues), rehecho: a.rehecho + Number(f.rehecho) }), { antes: 0, despues: 0, rehecho: 0 });
  lineas.push(`| **Total** | ${tabla.length} comprobaciones | **${total.antes}/${tabla.length}** | **${total.despues}/${tabla.length}** | **${total.rehecho}/${tabla.length}** |`);
  lineas.push('', `Campos que «rehacer» empeora respecto de «antes»: ${empeoran.length ? empeoran.join(', ') : 'ninguno'}.`);
  console.log(lineas.join('\n'));
  writeFileSync(join(RESULTADOS, 'tabla.md'), `${lineas.join('\n')}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
