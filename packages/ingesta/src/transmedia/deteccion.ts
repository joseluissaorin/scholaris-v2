/**
 * Detección de relaciones entre las obras de la biblioteca (docs/COMPRENSION.md,
 * paso 7): una película y el cuento que adapta, un original y su traducción, dos
 * ediciones de la misma obra, un ensayo que cita a otro.
 *
 * Cada par de documentos reúne indicios de seis fuentes, cada uno con su peso y
 * su prueba:
 *
 * - metadatos (CSL): mismo título, título original, traductores, autoría, obra contenedora;
 * - contenido: el título de la otra obra en el material, con su contexto («basado en su
 *   cuento…» en los créditos de una película, «traducción de…» en una portadilla);
 * - Wikidata: P144, P4969, P629, P747, P655, P58, P50, P57, P1877;
 * - el grafo de citas de las funciones (qué documento cita a cuál);
 * - las entidades del grafo que comparten (sobre todo personajes de ficción);
 * - el parecido de sus fichas globales.
 *
 * Los indicios con tipo se combinan por tipo (o lógico ruidoso); los que no lo tienen
 * (entidades, fichas) refuerzan al mejor o, si no hay ninguno, sugieren el tipo por
 * medio y lengua. Lo dudoso lo decide el modelo rápido. Las relaciones que puso o
 * confirmó el usuario no se tocan, y las que rechazó no vuelven.
 */
import type { Evidencia, Relacion, TipoRelacion } from '@scholaris/nucleo';
import { leerApariciones, leerFichas, leerRelaciones, leerUnidades } from '@scholaris/spdf';
import { localizarCita } from '../comprension/anclaje.js';
import { llamar } from '../comprension/modelo.js';
import type { ContextoComprension, UsoModelo } from '../comprension/tipos.js';
import { huella } from '../comprension/util.js';
import { claseDeObra, normalizar, obraDe, obrasDeLaBiblioteca, rotulo, type Obra } from './obras.js';
import { leerRechazos, idRelacion, guardarDetectadas } from './relaciones.js';
import type { CandidataRelacion, OpcionesDeteccion, SenalRelacion } from './tipos.js';
import { lenguaDe, NOMBRE_PROPIEDAD, obraWikidata, urlWikidata, type ObraWikidata } from './wikidata.js';

const ahoraDe = (ctx: Pick<ContextoComprension, 'ahora'>) => (ctx.ahora?.() ?? new Date()).toISOString();
const r2 = (x: number) => Math.round(x * 100) / 100;
const oRuidoso = (pesos: number[]) => 1 - pesos.reduce((p, x) => p * (1 - Math.max(0, Math.min(1, x))), 1);

/** Tipos que derivan una obra de otra (frente a citar o comentar). */
const DERIVACION = new Set<TipoRelacion>(['adaptacion_de', 'traduccion_de', 'edicion_de', 'version_de', 'misma_obra', 'parte_de']);

// ---------------------------------------------------------------------------
// Metadatos
// ---------------------------------------------------------------------------

export function senalesMetadatos(a: Obra, b: Obra): SenalRelacion[] {
  const s: SenalRelacion[] = [];
  const ma = a.doc.metadatos, mb = b.doc.metadatos;
  const titulo = (o: Obra) => normalizar(o.titulo);
  const mismoTitulo = !!titulo(a) && titulo(a) === titulo(b);
  const autores = a.apellidos.filter((x) => b.apellidos.includes(x));
  const original = (x: Obra, y: Obra) => !!x.doc.metadatos.tituloOriginal && normalizar(x.doc.metadatos.tituloOriginal) === titulo(y);
  for (const [x, y, sentido] of [[a, b, 'a'], [b, a, 'b']] as const) {
    // Una traducción: título original que es el de la otra, traductores, lengua original que es la de la otra.
    const tit = original(x, y);
    const lenguaOriginal = !!x.idiomaOriginal && x.idiomaOriginal === y.idioma && x.idioma !== y.idioma;
    const conTraductor = x.traductores.length > 0 && x.idioma !== y.idioma;
    if (tit || (lenguaOriginal && autores.length) || (conTraductor && autores.length)) {
      const peso = (tit ? 0.55 : 0) + (lenguaOriginal ? 0.25 : 0) + (conTraductor ? 0.2 : 0) + (autores.length ? 0.15 : 0);
      s.push({
        origen: 'metadatos', tipo: 'traduccion_de', sentido, peso: Math.min(0.95, peso),
        descripcion: [tit ? `el título original de ${rotulo(x)} es el de ${rotulo(y)}` : '', x.traductores.length ? `traducción de ${x.traductores.join(', ')}` : '', lenguaOriginal ? `lengua original ${y.idioma}` : ''].filter(Boolean).join('; '),
      });
    }
    // Parte de una obra contenedora (un cuento dentro de un libro).
    if (x.doc.metadatos.contenedor && normalizar(x.doc.metadatos.contenedor) === titulo(y) && x.medio === y.medio) {
      s.push({ origen: 'metadatos', tipo: 'parte_de', sentido, peso: 0.75, descripcion: `${rotulo(x)} figura dentro de ${rotulo(y)}` });
    }
  }
  if (mismoTitulo) {
    if (a.medio !== b.medio) {
      // Mismo título en otro medio: una adaptación (lo audiovisual adapta al texto).
      const sentido = a.medio === 'texto' ? 'b' : b.medio === 'texto' ? 'a' : (a.anio ?? 0) >= (b.anio ?? 0) ? 'a' : 'b';
      s.push({ origen: 'metadatos', tipo: 'adaptacion_de', sentido, peso: autores.length ? 0.7 : 0.5, descripcion: `mismo título en otro medio («${a.titulo}»)${autores.length ? ' y la misma autoría' : ''}` });
    } else if (a.idioma && b.idioma && a.idioma !== b.idioma) {
      const sentido = a.traductores.length ? 'a' : b.traductores.length ? 'b' : (a.anio ?? 0) >= (b.anio ?? 0) ? 'a' : 'b';
      s.push({ origen: 'metadatos', tipo: 'traduccion_de', sentido, peso: autores.length ? 0.7 : 0.45, descripcion: `mismo título en otra lengua (${a.idioma} y ${b.idioma})` });
    } else if (autores.length) {
      const distinta = (ma.editorial && mb.editorial && normalizar(ma.editorial) !== normalizar(mb.editorial)) || (ma.anio && mb.anio && ma.anio !== mb.anio) || (ma.edicion && ma.edicion !== mb.edicion);
      if (distinta) {
        const sentido = (ma.anio ?? 0) >= (mb.anio ?? 0) ? 'a' : 'b';
        s.push({ origen: 'metadatos', tipo: 'edicion_de', sentido, peso: 0.7, descripcion: `misma obra en otra edición (${[ma.editorial, ma.anio].filter(Boolean).join(', ')} frente a ${[mb.editorial, mb.anio].filter(Boolean).join(', ')})` });
      } else {
        s.push({ origen: 'metadatos', tipo: 'misma_obra', peso: 0.75, descripcion: 'mismo título, autoría, editorial y año: el mismo documento dos veces' });
      }
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Contenido: el título de la otra obra en el material
// ---------------------------------------------------------------------------

const PISTA_ADAPTACION = /\b(basad[oa]s? en|inspirad[oa]s? en|adaptacion de|adaptad[oa]s? de|version (cinematografica|libre|teatral|radiofonica) de|a partir de|sobre (el|la|un|una|su) (cuento|relato|novela|obra)|guion|based on|adapted from|inspired by|from the (novel|story|book|play)|screenplay|d apres|adapte de|tratto da|basato su|ispirato a)\b/;
const PISTA_TRADUCCION = /\b(traduccion de|traducid[oa]s? (del|de la|de|por)|version (castellana|espanola|inglesa|francesa|italiana) de|translated (from|by)|translation of|translator|traduit (de|par)|traduction de|tradotto (da|dal)|traduzione di)\b/;

/** Un trozo de material que leer: texto de una unidad o texto en pantalla percibido. */
interface TrozoMaterial {
  texto: string;
  evidencia(caracteres?: [number, number], literal?: string): Evidencia;
}

async function trozosDe(ctx: ContextoComprension, o: Obra): Promise<TrozoMaterial[]> {
  const trozos: TrozoMaterial[] = [];
  const modo = o.medio === 'video' ? 'video' : o.medio === 'audio' ? 'audio' : 'texto';
  for (const u of await leerUnidades(ctx.sql, o.id)) {
    const texto = (u.texto ?? '').normalize('NFC');
    if (!texto.trim()) continue;
    trozos.push({
      texto,
      evidencia: (c, literal) => ({ documento: o.id, modo, unidad: u.id, ancla: { ...u.ancla, ...(c ? { caracteres: c } : {}) }, ...(literal ? { cita: literal } : {}) }),
    });
  }
  if (o.medio === 'video' && ctx.percepcion) {
    const p = await ctx.percepcion(o.id).catch(() => null);
    for (const e of p?.escenas ?? []) {
      for (const pl of e.planos) {
        if (!pl.textoEnPantalla?.trim()) continue;
        const t = pl.textoEnPantalla.trim();
        trozos.push({ texto: t, evidencia: () => ({ documento: o.id, modo: 'video', ancla: { tipo: 'tiempo', t0: pl.t0, t1: pl.t1, instante: (pl.t0 + pl.t1) / 2 }, cita: `Texto en pantalla: «${t}»` }) });
      }
    }
  }
  return trozos;
}

/** El título de `b` (y su autoría) en el material de `a`, con lo que dice el contexto. */
export function senalesContenido(a: Obra, b: Obra, trozos: readonly TrozoMaterial[]): SenalRelacion[] {
  if (a.titulos.some((t) => b.titulos.includes(t))) return [];
  const titulos = b.titulos.filter((t) => t.split(' ').length >= 2 && t.length >= 10);
  const unaPalabra = b.titulos.filter((t) => !titulos.includes(t) && t.length >= 6);
  if (!titulos.length && !unaPalabra.length) return [];
  const senales: SenalRelacion[] = [];
  let menciones = 0;
  for (const tr of trozos) {
    const norm = normalizar(tr.texto);
    for (const t of [...titulos, ...unaPalabra]) {
      if (!` ${norm} `.includes(` ${t} `)) continue;
      const loc = localizarCita({ texto: tr.texto }, t);
      const ini = loc ? Array.from(tr.texto).slice(0, loc.caracteres[0]).join('').length : 0;
      const ventana = normalizar(tr.texto.slice(Math.max(0, ini - 220), ini + t.length + 220));
      const conAutor = b.apellidos.some((x) => ` ${ventana} `.includes(` ${x} `));
      if (!titulos.includes(t) && !conAutor) continue;
      menciones++;
      const literal = loc ? Array.from(tr.texto).slice(Math.max(0, loc.caracteres[0] - 80), loc.caracteres[1] + 40).join('').trim() : tr.texto.slice(0, 200);
      const ev = tr.evidencia(loc?.caracteres, literal);
      if (PISTA_TRADUCCION.test(ventana)) senales.push({ origen: 'contenido', tipo: 'traduccion_de', sentido: 'a', peso: 0.75, descripcion: `${rotulo(a)} se declara traducción de ${rotulo(b)}`, evidencias: [ev] });
      else if (PISTA_ADAPTACION.test(ventana)) senales.push({ origen: 'contenido', tipo: 'adaptacion_de', sentido: 'a', peso: conAutor ? 0.85 : 0.75, descripcion: `${rotulo(a)} declara basarse en ${rotulo(b)}${ev.cita ? `: «${ev.cita.replace(/^Texto en pantalla: /, '').replace(/^«|»$/g, '').slice(0, 140)}»` : ''}`, evidencias: [ev] });
      else if (menciones <= 3) senales.push({ origen: 'contenido', tipo: 'cita_a', sentido: 'a', peso: conAutor ? 0.5 : 0.35, descripcion: `${rotulo(a)} nombra ${rotulo(b)}`, evidencias: [ev] });
      break;
    }
    if (senales.length >= 6) break;
  }
  return senales;
}

/** Lo que el material de `y` dice de cada una de las `otras` (una sola lectura del material). */
async function contenidoDe(ctx: ContextoComprension, y: Obra, otras: readonly Obra[]): Promise<Map<string, SenalRelacion[]>> {
  const salida = new Map<string, SenalRelacion[]>();
  if (!otras.length) return salida;
  const trozos = await trozosDe(ctx, y);
  for (const x of otras) { const s = senalesContenido(y, x, trozos); if (s.length) salida.set(x.id, s); }
  return salida;
}

/**
 * ¿Hace falta leer el material de `y` para buscar en él los títulos de `x`? Un texto con
 * fragmentos se mira antes en el índice léxico (frase exacta): si no aparece, no se lee.
 * Los medios se leen siempre (los créditos están en la percepción, no en los fragmentos).
 */
async function nombraA(ctx: ContextoComprension, y: Obra, x: Obra): Promise<boolean> {
  if (y.medio !== 'texto') return true;
  const titulos = x.titulos.filter((t) => t.split(' ').length >= 2 && t.length >= 10);
  if (!titulos.length) return false;
  try {
    const [n] = await ctx.sql.ejecutar<{ n: number }>('SELECT COUNT(*) AS n FROM fragmentos WHERE documento = ?', y.id);
    if (!Number(n?.n ?? 0)) return true;
    const q = titulos.map((t) => `"${t}"`).join(' OR ');
    const [f] = await ctx.sql.ejecutar<{ n: number }>(
      'SELECT COUNT(*) AS n FROM fragmentos_fts JOIN fragmentos f ON f.n = fragmentos_fts.rowid WHERE fragmentos_fts MATCH ? AND f.documento = ?', q, y.id);
    return Number(f?.n ?? 0) > 0;
  } catch { return true; }
}

// ---------------------------------------------------------------------------
// Wikidata
// ---------------------------------------------------------------------------

function evidenciaWikidata(documento: string, qid: string, p: keyof typeof NOMBRE_PROPIEDAD, texto: string, ahora: string): Evidencia {
  return {
    documento, modo: 'dato', cita: texto,
    ancla: { tipo: 'web', url: urlWikidata(qid, p), ruta: ['Wikidata', qid, `${p} ${NOMBRE_PROPIEDAD[p]}`], parrafo: 0, consultada: ahora },
  };
}

export function senalesWikidata(a: Obra, wa: ObraWikidata | null, b: Obra, wb: ObraWikidata | null, ahora: string): SenalRelacion[] {
  if (!wa && !wb) return [];
  const s: SenalRelacion[] = [];
  const tiene = (w: ObraWikidata | null, p: keyof ObraWikidata['claims'], q: string | undefined) => !!q && !!w?.claims[p]?.includes(q);
  const autoresDe = (o: Obra, w: ObraWikidata | null) => [...new Set([...o.apellidos, ...((w?.claims.P50 ?? []).map((q) => normalizar(w!.personas[q] ?? '')))])].filter(Boolean);
  for (const [x, wx, y, wy, sentido] of [[a, wa, b, wb, 'a'], [b, wb, a, wa, 'b']] as const) {
    if (!wx) continue;
    const derivada: TipoRelacion = x.medio !== y.medio ? 'adaptacion_de' : lenguaDe(wx, x) !== lenguaDe(wy, y) && lenguaDe(wy, y) ? 'traduccion_de' : 'version_de';
    if (tiene(wx, 'P144', wy?.qid) || tiene(wy, 'P4969', wx.qid)) {
      const p = tiene(wx, 'P144', wy?.qid) ? 'P144' : 'P4969';
      const qid = p === 'P144' ? wx.qid : wy!.qid;
      s.push({
        origen: 'wikidata', tipo: derivada, sentido, peso: 0.92,
        descripcion: `Wikidata: ${wx.etiqueta} (${wx.qid}) ${p === 'P144' ? 'está basada en' : 'figura como obra derivada de'} ${wy!.etiqueta} (${wy!.qid}), ${p}`,
        evidencias: [evidenciaWikidata(p === 'P144' ? x.id : y.id, qid, p, `${wx.etiqueta} ${NOMBRE_PROPIEDAD.P144} ${wy!.etiqueta}`, ahora)],
      });
    }
    if (tiene(wx, 'P629', wy?.qid) || tiene(wy, 'P747', wx.qid)) {
      const tipo: TipoRelacion = lenguaDe(wx, x) && lenguaDe(wy, y) && lenguaDe(wx, x) !== lenguaDe(wy, y) ? 'traduccion_de' : 'edicion_de';
      s.push({
        origen: 'wikidata', tipo, sentido, peso: 0.9, descripcion: `Wikidata: ${wx.etiqueta} (${wx.qid}) es edición o traducción de ${wy!.etiqueta} (${wy!.qid}), P629`,
        evidencias: [evidenciaWikidata(x.id, wx.qid, 'P629', `${wx.etiqueta} ${NOMBRE_PROPIEDAD.P629} ${wy!.etiqueta}`, ahora)],
      });
    }
    // Guionista o «según una obra de» que es autor de la otra: la película adapta algo suyo.
    const autoresY = autoresDe(y, wy);
    for (const p of ['P58', 'P1877'] as const) {
      const casa = (wx.claims[p] ?? []).find((q) => { const n = normalizar(wx.personas[q] ?? ''); return !!n && autoresY.some((ap) => n.includes(ap)); });
      if (casa && x.medio !== y.medio) {
        s.push({
          origen: 'wikidata', tipo: 'adaptacion_de', sentido, peso: p === 'P58' ? 0.4 : 0.5,
          descripcion: `Wikidata: ${p === 'P58' ? 'el guionista' : 'la obra de partida es'} de ${wx.etiqueta} es ${wx.personas[casa]}, autor de ${rotulo(y)}`,
          evidencias: [evidenciaWikidata(x.id, wx.qid, p, `${NOMBRE_PROPIEDAD[p]}: ${wx.personas[casa]}`, ahora)],
        });
      }
    }
  }
  // Dos ediciones o traducciones de la misma obra.
  const comun = (wa?.claims.P629 ?? []).find((q) => wb?.claims.P629?.includes(q));
  if (comun && wa && wb) {
    const la = lenguaDe(wa, a), lb = lenguaDe(wb, b);
    const traduccion = la && lb && la !== lb;
    const sentido = traduccion ? (wa.claims.P655 ? 'a' : wb.claims.P655 ? 'b' : undefined) : undefined;
    s.push({
      origen: 'wikidata', tipo: traduccion ? 'traduccion_de' : 'misma_obra', ...(sentido ? { sentido } : {}), peso: traduccion ? 0.75 : 0.8,
      descripcion: `Wikidata: las dos son ediciones de la misma obra (${comun}, P629)`, evidencias: [evidenciaWikidata(a.id, wa.qid, 'P629', `${wa.etiqueta} y ${wb.etiqueta}: ${comun}`, ahora)],
    });
  }
  return s;
}

// ---------------------------------------------------------------------------
// Grafo de citas
// ---------------------------------------------------------------------------

async function senalesCitas(ctx: ContextoComprension, a: Obra, b: Obra): Promise<SenalRelacion[]> {
  let filas: Array<{ origen: string; destino: string; tipo: string; confianza: number; referencia: string | null }> = [];
  try {
    filas = await ctx.sql.ejecutar('SELECT origen, destino, tipo, confianza, referencia FROM grafo_aristas WHERE (origen = ? AND destino = ?) OR (origen = ? AND destino = ?)', a.id, b.id, b.id, a.id);
  } catch { return []; }
  const s: SenalRelacion[] = [];
  for (const f of filas) {
    const sentido = String(f.origen) === a.id ? 'a' : 'b';
    const evidencias: Evidencia[] = [];
    try {
      const [r] = await ctx.sql.ejecutar<{ texto: string; fragmento: string | null }>(
        'SELECT texto, fragmento FROM grafo_referencias WHERE origen = ? AND resuelto = ? ORDER BY confianza DESC LIMIT 1', String(f.origen), String(f.destino));
      if (r?.fragmento) {
        const [fr] = await ctx.sql.ejecutar<{ unidad: string; ancla: string }>('SELECT unidad, ancla FROM fragmentos WHERE id = ?', String(r.fragmento));
        if (fr) evidencias.push({ documento: String(f.origen), modo: 'texto', unidad: String(fr.unidad), fragmento: String(r.fragmento), ancla: JSON.parse(String(fr.ancla)), cita: String(r.texto).slice(0, 400) });
      }
    } catch { /* sin pruebas */ }
    const de = sentido === 'a' ? a : b, a_ = sentido === 'a' ? b : a;
    s.push({ origen: 'citas', tipo: 'cita_a', sentido, peso: Math.min(0.9, Number(f.confianza ?? 0.6) * (f.tipo === 'cita' ? 0.95 : 0.7)), descripcion: `${rotulo(de)} ${f.tipo === 'cita' ? 'cita' : 'menciona'} ${rotulo(a_)} (grafo de citas)`, evidencias });
  }
  return s;
}

// ---------------------------------------------------------------------------
// Entidades compartidas
// ---------------------------------------------------------------------------

interface EntidadDoc { n: number; tipo: string; ficticia: boolean; nombre: string }
export type MapaEntidades = Map<string, Map<string, EntidadDoc>>;

const PESO_TIPO: Record<string, number> = { persona: 1, obra: 1.2, lugar: 0.8, organizacion: 0.8, evento: 1 };

/** Las entidades del grafo que aparecen en cada documento (apariciones de la comprensión y menciones del grafo). */
export async function entidadesPorDocumento(ctx: ContextoComprension, ids: readonly string[]): Promise<MapaEntidades> {
  const salida: MapaEntidades = new Map(ids.map((d) => [d, new Map()]));
  const sumar = (filas: Array<Record<string, unknown>>) => {
    for (const f of filas) {
      const m = salida.get(String(f.d));
      if (!m) continue;
      const id = String(f.ent);
      const previa = m.get(id);
      m.set(id, { n: (previa?.n ?? 0) + Number(f.n ?? 0), tipo: String(f.tipo ?? ''), ficticia: Number(f.ficticia ?? 0) === 1, nombre: String(f.nombre ?? '') });
    }
  };
  for (const tabla of ['apariciones', 'menciones']) {
    try {
      sumar(await ctx.sql.ejecutar(
        `SELECT x.documento AS d, coalesce(e.fusionada_en, e.id) AS ent, e.tipo AS tipo, e.ficticia AS ficticia, e.nombre AS nombre, COUNT(*) AS n
           FROM ${tabla} x JOIN entidades e ON e.id = x.entidad GROUP BY x.documento, coalesce(e.fusionada_en, e.id)`));
    } catch { /* sin grafo */ }
  }
  return salida;
}

export function senalEntidades(a: Obra, b: Obra, mapa: MapaEntidades, apariciones?: { a: Evidencia[]; b: Evidencia[] }): SenalRelacion | null {
  const ea = mapa.get(a.id), eb = mapa.get(b.id);
  if (!ea?.size || !eb?.size) return null;
  const n = Math.max(2, [...mapa.values()].filter((x) => x.size).length);
  const df = new Map<string, number>();
  for (const m of mapa.values()) for (const k of m.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  const peso = (k: string, e: EntidadDoc) => {
    const base = e.ficticia ? 3 : PESO_TIPO[e.tipo] ?? 0;
    if (!base || (e.n < 2 && !e.ficticia)) return 0;
    return base * Math.log(1 + n / (df.get(k) ?? 1)) / Math.log(1 + n);
  };
  const masa = (m: Map<string, EntidadDoc>) => [...m].reduce((t, [k, e]) => t + peso(k, e), 0);
  const comunes = [...ea].filter(([k]) => eb.has(k)).map(([k, e]) => ({ k, e, w: Math.min(peso(k, e), peso(k, eb.get(k)!)) })).filter((x) => x.w > 0).sort((x, y) => y.w - x.w);
  if (!comunes.length) return null;
  const puntos = comunes.reduce((t, x) => t + x.w, 0) / Math.max(1e-6, Math.min(masa(ea), masa(eb)));
  const ficticias = comunes.filter((x) => x.e.ficticia || eb.get(x.k)?.ficticia).length;
  const fuerza = Math.min(0.9, puntos * 1.2 + 0.1 * Math.min(ficticias, 4));
  if (fuerza < 0.15) return null;
  return {
    origen: 'entidades', peso: r2(fuerza),
    descripcion: `comparten ${comunes.length} entidades del grafo${ficticias ? `, ${ficticias} de ellas personajes de ficción` : ''} (${comunes.slice(0, 8).map((x) => x.e.nombre).join(', ')})`,
    ...(apariciones ? { evidencias: [...apariciones.a, ...apariciones.b] } : {}),
  };
}

/** Una aparición de cada uno de los personajes comunes más fuertes, en cada documento (pruebas de la señal). */
async function pruebasEntidades(ctx: ContextoComprension, a: Obra, b: Obra, mapa: MapaEntidades): Promise<{ a: Evidencia[]; b: Evidencia[] }> {
  const ea = mapa.get(a.id)!, eb = mapa.get(b.id)!;
  const comunes = [...ea].filter(([k, e]) => eb.has(k) && (e.ficticia || e.tipo === 'persona')).sort((x, y) => (y[1].n + eb.get(y[0])!.n) - (x[1].n + eb.get(x[0])!.n)).slice(0, 3);
  const salida = { a: [] as Evidencia[], b: [] as Evidencia[] };
  for (const [k] of comunes) {
    for (const [o, lado] of [[a, 'a'], [b, 'b']] as const) {
      const [ap] = await leerApariciones(ctx.sql, { entidad: k, documento: o.id, limite: 1 }).catch(() => []);
      if (ap) salida[lado].push({ documento: o.id, ancla: ap.ancla, ...(ap.anclaFin ? { anclaFin: ap.anclaFin } : {}), modo: ap.ancla.tipo === 'tiempo' ? (o.medio === 'audio' ? 'audio' : 'video') : 'texto', cita: `${ea.get(k)!.nombre}: ${ap.forma}` });
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Fichas globales
// ---------------------------------------------------------------------------

const VACIAS = new Set('the a an of and in on to with for by from his her their its is are was were as at that this which who into he she they it be or not but about two one story film novel work'.split(' '));
const palabras = (s: string) => new Set(normalizar(s).split(' ').filter((w) => w.length > 3 && !VACIAS.has(w)));

async function resumenGlobal(ctx: ContextoComprension, id: string): Promise<string> {
  const [g] = await leerFichas(ctx.sql, { documento: id, clase: 'global' }).catch(() => []);
  if (!g) return '';
  const r = (g.datos.resumen ?? {}) as { es?: string; en?: string };
  const temas = (Array.isArray(g.datos.temas) ? g.datos.temas : []).map((t: { nombre?: string }) => t.nombre ?? '').join(', ');
  return [r.en, r.es, temas].filter(Boolean).join('\n');
}

async function senalFichas(ctx: ContextoComprension, a: Obra, b: Obra, cacheResumen: Map<string, string>, cacheVector: Map<string, Float32Array | null>): Promise<SenalRelacion | null> {
  for (const o of [a, b]) if (!cacheResumen.has(o.id)) cacheResumen.set(o.id, await resumenGlobal(ctx, o.id));
  const ra = cacheResumen.get(a.id)!, rb = cacheResumen.get(b.id)!;
  if (!ra || !rb) return null;
  let parecido: number;
  const emb = ctx.embebedor;
  if (emb?.admite('texto')) {
    for (const [o, r] of [[a, ra], [b, rb]] as const) {
      if (!cacheVector.has(o.id)) {
        try { cacheVector.set(o.id, (await emb.vectorizar([{ modalidad: 'texto', texto: r }], 'documento'))[0] ?? null); } catch { cacheVector.set(o.id, null); }
      }
    }
    const va = cacheVector.get(a.id), vb = cacheVector.get(b.id);
    if (!va || !vb) return null;
    let p = 0, na = 0, nb = 0;
    for (let i = 0; i < Math.min(va.length, vb.length); i++) { p += va[i]! * vb[i]!; na += va[i]! ** 2; nb += vb[i]! ** 2; }
    const cos = p / Math.max(1e-9, Math.sqrt(na * nb));
    parecido = Math.max(0, Math.min(1, (cos - 0.62) / 0.3));
  } else {
    const wa = palabras(ra), wb = palabras(rb);
    const j = [...wa].filter((x) => wb.has(x)).length / Math.max(1, new Set([...wa, ...wb]).size);
    parecido = Math.max(0, Math.min(1, (j - 0.06) / 0.25));
  }
  if (parecido < 0.2) return null;
  return { origen: 'fichas', peso: r2(parecido * 0.6), descripcion: `sus fichas globales se parecen (${Math.round(parecido * 100)} %)` };
}

// ---------------------------------------------------------------------------
// Combinar y decidir
// ---------------------------------------------------------------------------

/** Tipo, sentido y confianza a partir de los indicios (sin modelo). */
export function combinar(a: Obra, b: Obra, senales: readonly SenalRelacion[]): { tipo: TipoRelacion; sentido: 'a' | 'b' | undefined; confianza: number; tipado: number } | null {
  const conTipo = senales.filter((s) => s.tipo);
  const sinTipo = oRuidoso(senales.filter((s) => !s.tipo).map((s) => s.peso));
  const porTipo = new Map<TipoRelacion, number[]>();
  for (const s of conTipo) porTipo.set(s.tipo!, [...(porTipo.get(s.tipo!) ?? []), s.peso]);
  // Un tipo de derivación gana a una cita con la misma fuerza.
  const ranking = [...porTipo].map(([t, ps]) => ({ t, p: oRuidoso(ps) + (DERIVACION.has(t) ? 0.01 : 0) })).sort((x, y) => y.p - x.p);
  const sentidoDe = (tipo: TipoRelacion): 'a' | 'b' | undefined => {
    let va = 0, vb = 0;
    for (const s of conTipo) if (s.tipo === tipo) { if (s.sentido === 'a') va += s.peso; if (s.sentido === 'b') vb += s.peso; }
    if (va || vb) return va >= vb ? 'a' : 'b';
    return undefined;
  };
  const mejor = ranking[0];
  if (mejor) {
    const tipado = Math.min(1, mejor.p);
    // Las entidades y las fichas solo refuerzan una derivación (no una cita suelta).
    const refuerzo = DERIVACION.has(mejor.t) ? 0.35 * sinTipo : 0.1 * sinTipo;
    return { tipo: mejor.t, sentido: sentidoDe(mejor.t), confianza: Math.min(0.99, r2(1 - (1 - tipado) * (1 - refuerzo))), tipado };
  }
  if (sinTipo < 0.3) return null;
  // Sin indicio con tipo: el medio y la lengua sugieren cuál, con poca confianza (lo decide el modelo).
  const ficticias = senales.some((s) => s.origen === 'entidades' && /personajes de ficción/.test(s.descripcion));
  if (ficticias && a.medio !== b.medio) {
    const sentido = a.medio === 'texto' ? 'b' : b.medio === 'texto' ? 'a' : undefined;
    return { tipo: 'adaptacion_de', sentido, confianza: r2(0.6 * sinTipo), tipado: 0 };
  }
  if (ficticias && a.idioma && b.idioma && a.idioma !== b.idioma) {
    const sentido = (a.anio ?? 0) > (b.anio ?? 0) ? 'a' : (b.anio ?? 0) > (a.anio ?? 0) ? 'b' : undefined;
    return { tipo: 'traduccion_de', sentido, confianza: r2(0.55 * sinTipo), tipado: 0 };
  }
  return { tipo: 'relacionado', sentido: undefined, confianza: r2(0.7 * sinTipo), tipado: 0 };
}

const TIPOS: TipoRelacion[] = ['adaptacion_de', 'traduccion_de', 'edicion_de', 'version_de', 'cita_a', 'comenta_a', 'responde_a', 'parte_de', 'misma_obra', 'relacionado'];

const SISTEMA_DECISION = `Eres un bibliotecario y especialista en literatura comparada, estudios de adaptación y traducción. Decides si dos obras de una biblioteca académica están relacionadas y cómo, a partir de sus fichas y de los indicios reunidos.

Tipos (A es la primera obra, B la segunda; «origen» es la que adapta, traduce, edita, cita, comenta o responde a la otra):
- adaptacion_de: una obra lleva a otro medio o género la historia de la otra (película de un cuento, obra de teatro de una novela).
- traduccion_de: la misma obra en otra lengua.
- edicion_de: otra edición del mismo texto en la misma lengua.
- version_de: una reescritura de la misma obra en el mismo medio (versión ampliada, refundición).
- cita_a, comenta_a, responde_a: una obra cita, estudia o polemiza con la otra.
- parte_de: una está contenida en la otra.
- misma_obra: son el mismo documento o la misma obra sin más diferencia.
- relacionado: comparten tema, personajes o mundo, pero no hay derivación.

Solo hay relación si los indicios y las fichas la sostienen; no inventes. La nota, en español impecable (tildes, eñes) y en una o dos frases, dice en qué se basa la decisión.`;

const ESQUEMA_DECISION = {
  type: 'object',
  properties: {
    relacion: { type: 'boolean' },
    tipo: { type: 'string', enum: TIPOS },
    origen: { type: 'string', enum: ['a', 'b'], description: 'La obra que adapta, traduce, edita, cita… a la otra.' },
    confianza: { type: 'number' },
    nota: { type: 'string' },
  },
  required: ['relacion', 'tipo', 'origen', 'confianza', 'nota'],
};

async function tarjeta(ctx: ContextoComprension, o: Obra): Promise<string> {
  const m = o.doc.metadatos;
  const [g] = await leerFichas(ctx.sql, { documento: o.id, clase: 'global' }).catch(() => []);
  const r = (g?.datos.resumen ?? {}) as { es?: string };
  return [
    `${rotulo(o)}: ${claseDeObra(o)}, ${o.doc.tipo}${m.tipoCSL ? ` (${m.tipoCSL})` : ''}, lengua ${o.idioma || '¿?'}${o.anio ? `, ${o.anio}` : ''}`,
    o.autores.length ? `Autoría: ${o.autores.join('; ')}` : '',
    o.traductores.length ? `Traducción: ${o.traductores.join('; ')}` : '',
    m.tituloOriginal ? `Título original: ${m.tituloOriginal}` : '',
    m.editorial ? `Editorial o productora: ${m.editorial}` : '',
    m.resumen ? `Resumen de catálogo: ${m.resumen.slice(0, 500)}` : '',
    r.es ? `Resumen de su ficha global: ${r.es}` : '',
    g ? `Ficha global (inicio): ${g.texto.slice(0, 1500)}` : '',
  ].filter(Boolean).join('\n');
}

async function decidirConModelo(ctx: ContextoComprension, a: Obra, b: Obra, senales: SenalRelacion[], uso: { uso: UsoModelo }) {
  if (!ctx.modelo) return null;
  const texto = `Obra A\n${await tarjeta(ctx, a)}\n\nObra B\n${await tarjeta(ctx, b)}\n\nIndicios reunidos:\n${senales.map((s) => `- [${s.origen}, peso ${s.peso.toFixed(2)}${s.tipo ? `, sugiere ${s.tipo}${s.sentido ? ` (origen ${s.sentido.toUpperCase()})` : ''}` : ''}] ${s.descripcion}`).join('\n')}\n\nResponde solo con el JSON.`;
  try {
    return await llamar<{ relacion: boolean; tipo: TipoRelacion; origen: 'a' | 'b'; confianza: number; nota: string }>(ctx.modelo, {
      sistema: SISTEMA_DECISION, partes: [{ texto }], esquema: ESQUEMA_DECISION, calidad: 'rapida', maxTokens: 1200, operacion: 'transmedia:decidir',
    }, uso);
  } catch { return null; }
}

/** Una frase con lo esencial de los indicios (la nota de la relación). */
function notaDe(tipo: TipoRelacion, origen: Obra, destino: Obra, senales: SenalRelacion[], delModelo?: string): string {
  const verbo: Record<TipoRelacion, string> = {
    adaptacion_de: 'adapta', traduccion_de: 'traduce', edicion_de: 'es otra edición de', version_de: 'es una versión de', cita_a: 'cita', comenta_a: 'comenta',
    responde_a: 'responde a', parte_de: 'forma parte de', misma_obra: 'es la misma obra que', relacionado: 'se relaciona con',
  };
  const motivos = [...senales].sort((x, y) => y.peso - x.peso).slice(0, 3).map((s) => s.descripcion.replace(/\.$/, ''));
  const base = `${claseDeObra(origen).replace(/^./, (c) => c.toUpperCase())} ${rotulo(origen)} ${verbo[tipo]} ${claseDeObra(destino)} ${rotulo(destino)}.`;
  return `${base}${motivos.length ? ` Indicios: ${motivos.join('; ')}.` : ''}${delModelo ? ` ${delModelo.trim()}` : ''}`.slice(0, 900);
}

/** La fuente principal de una relación según los indicios del tipo elegido. */
function fuenteDe(tipo: TipoRelacion, senales: SenalRelacion[], decidioModelo: boolean): Relacion['fuente'] {
  const del = senales.filter((s) => s.tipo === tipo && s.origen !== 'modelo');
  if (!del.length || (decidioModelo && !del.some((s) => s.peso >= 0.6))) return 'modelo';
  if (del.some((s) => s.origen === 'wikidata' && s.peso >= 0.6)) return 'wikidata';
  return 'metadatos';
}

/**
 * Evalúa un par de documentos: reúne los indicios y propone (o no) una relación.
 * `contexto` lleva lo que se reutiliza al comparar uno con muchos.
 */
export async function evaluarPar(
  ctx: ContextoComprension, a: Obra, b: Obra,
  c: { wikidata: Map<string, ObraWikidata | null>; contenido: Map<string, Map<string, SenalRelacion[]>>; entidades: MapaEntidades; resumenes: Map<string, string>; vectores: Map<string, Float32Array | null>; uso: { uso: UsoModelo }; modelo: boolean; ahora: string },
): Promise<CandidataRelacion | null> {
  const senales: SenalRelacion[] = [...senalesMetadatos(a, b)];
  for (const [x, y] of [[a, b], [b, a]] as const) {
    const delMaterial = c.contenido.get(x.id)?.get(y.id) ?? [];
    senales.push(...delMaterial.map((s) => (x === a ? s : { ...s, sentido: s.sentido === 'a' ? 'b' as const : 'a' as const })));
  }
  senales.push(...senalesWikidata(a, c.wikidata.get(a.id) ?? null, b, c.wikidata.get(b.id) ?? null, c.ahora));
  senales.push(...await senalesCitas(ctx, a, b));
  const ent = senalEntidades(a, b, c.entidades);
  if (ent) senales.push({ ...ent, evidencias: [...(await pruebasEntidades(ctx, a, b, c.entidades).then((p) => [...p.a, ...p.b]))] });
  const fi = await senalFichas(ctx, a, b, c.resumenes, c.vectores);
  if (fi) senales.push(fi);
  if (!senales.length) return null;
  let decision = combinar(a, b, senales);
  if (!decision) return null;
  let decidioModelo = false;
  let notaModelo: string | undefined;
  // Lo dudoso (o el sentido sin decidir en una derivación) lo decide el modelo.
  const dudoso = decision.confianza >= 0.3 && (decision.tipado < 0.8 || (DERIVACION.has(decision.tipo) && !decision.sentido && decision.tipo !== 'misma_obra'));
  if (dudoso && c.modelo && ctx.modelo) {
    const m = await decidirConModelo(ctx, a, b, senales, c.uso);
    if (m) {
      senales.push({ origen: 'modelo', ...(m.relacion ? { tipo: m.tipo, sentido: m.origen } : {}), peso: r2(Math.max(0, Math.min(1, m.confianza))), descripcion: m.nota });
      if (!m.relacion && decision.tipado < 0.8) return null;
      if (m.relacion) {
        decidioModelo = decision.tipado < 0.8;
        if (decidioModelo) decision = { tipo: m.tipo, sentido: m.origen, confianza: r2(Math.max(decision.confianza, 0.85 * m.confianza)), tipado: decision.tipado };
        else if (!decision.sentido && m.tipo === decision.tipo) decision = { ...decision, sentido: m.origen };
        notaModelo = m.nota;
      }
    }
  }
  const simetrica = decision.tipo === 'misma_obra' || decision.tipo === 'relacionado';
  const sentido = decision.sentido ?? (simetrica ? (a.id < b.id ? 'a' : 'b') : (a.anio ?? 0) >= (b.anio ?? 0) ? 'a' : 'b');
  const [origen, destino] = sentido === 'a' ? [a, b] : [b, a];
  const evidencias = senales.filter((s) => !s.tipo || s.tipo === decision!.tipo).flatMap((s) => s.evidencias ?? []).slice(0, 16);
  return {
    origen: origen.id, destino: destino.id, tipo: decision.tipo, confianza: decision.confianza, fuente: fuenteDe(decision.tipo, senales, decidioModelo),
    nota: notaDe(decision.tipo, origen, destino, senales.filter((s) => s.origen !== 'modelo' && (!s.tipo || s.tipo === decision!.tipo)), notaModelo), evidencias, senales,
  };
}

/**
 * Detecta las relaciones de un documento con el resto de la biblioteca (o, sin
 * documento, las de toda la biblioteca, par a par) y las guarda. Devuelve las
 * relaciones vigentes que salen de la detección.
 */
export async function detectarRelaciones(ctx: ContextoComprension, documento: string | null, o: OpcionesDeteccion = {}): Promise<{ relaciones: Relacion[]; candidatas: CandidataRelacion[]; nuevas: number; uso: UsoModelo; avisos: string[] }> {
  const ahora = ahoraDe(ctx);
  const uso = { uso: { modelo: '', tokensEntrada: 0, tokensSalida: 0, usd: 0, ms: 0, llamadas: 0 } };
  const avisos: string[] = [];
  const todas = await obrasDeLaBiblioteca(ctx.sql, o.con ? [...o.con, ...(documento ? [documento] : [])] : undefined);
  if (documento && !todas.some((x) => x.id === documento)) {
    const d = await import('@scholaris/spdf').then((s) => s.leerDocumento(ctx.sql, documento));
    if (!d) throw new Error(`No existe el documento ${documento}.`);
    todas.push(obraDe(d));
  }
  const pares: Array<[Obra, Obra]> = [];
  for (let i = 0; i < todas.length; i++) for (let j = i + 1; j < todas.length; j++) {
    const x = todas[i]!, y = todas[j]!;
    if (!documento || x.id === documento || y.id === documento) pares.push([x, y]);
  }
  const wikidata = new Map<string, ObraWikidata | null>();
  const usarWikidata = (o.wikidata ?? true) && !!ctx.fetch;
  if (usarWikidata) {
    const ids = new Set(pares.flatMap(([x, y]) => [x.id, y.id]));
    for (const ob of todas) {
      if (!ids.has(ob.id)) continue;
      try { wikidata.set(ob.id, await obraWikidata(ctx.fetch!, ctx.sql, ob)); } catch (e) {
        wikidata.set(ob.id, null);
        if (!avisos.some((x) => x.startsWith('Wikidata'))) avisos.push(`Wikidata no respondió (${(e as Error).message.slice(0, 80)}): se decide sin ella.`);
      }
    }
  }
  const contexto = {
    wikidata, contenido: new Map<string, Map<string, SenalRelacion[]>>(), entidades: await entidadesPorDocumento(ctx, todas.map((x) => x.id)),
    resumenes: new Map<string, string>(), vectores: new Map<string, Float32Array | null>(), uso, modelo: o.modelo ?? true, ahora,
  };
  // El material de cada documento se lee una vez: el del documento nuevo, entero; el de los demás, solo si lo nombran.
  const implicadas = todas.filter((x) => pares.some(([p, q]) => p.id === x.id || q.id === x.id));
  if (documento) {
    const foco = todas.find((x) => x.id === documento)!;
    contexto.contenido.set(foco.id, await contenidoDe(ctx, foco, implicadas.filter((x) => x !== foco)));
    for (const y of implicadas) if (y !== foco && await nombraA(ctx, y, foco)) contexto.contenido.set(y.id, await contenidoDe(ctx, y, [foco]));
  } else {
    for (const y of implicadas) contexto.contenido.set(y.id, await contenidoDe(ctx, y, implicadas.filter((x) => x !== y)));
  }
  const umbral = o.umbral ?? 0.5;
  const existentes = documento ? await leerRelaciones(ctx.sql, documento) : await leerRelaciones(ctx.sql);
  const deUsuario = new Set(existentes.filter((r) => r.fuente === 'usuario').map((r) => [r.origen, r.destino].sort().join('|')));
  const rechazos = await leerRechazos(ctx.sql);
  const candidatas: CandidataRelacion[] = [];
  for (const [x, y] of pares) {
    if (deUsuario.has([x.id, y.id].sort().join('|'))) continue;
    const cand = await evaluarPar(ctx, x, y, contexto);
    if (!cand || cand.confianza < umbral) continue;
    if (rechazos.some((r) => r.par === [cand.origen, cand.destino].sort().join('|') && (!r.tipo || r.tipo === cand.tipo))) continue;
    candidatas.push(cand);
  }
  const { relaciones, nuevas } = await guardarDetectadas(ctx.sql, candidatas, pares.map(([x, y]) => [x.id, y.id] as [string, string]), ahora);
  return { relaciones, candidatas, nuevas, uso: uso.uso, avisos };
}

export { idRelacion, huella };
