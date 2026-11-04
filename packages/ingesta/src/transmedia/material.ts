/**
 * Las dos obras de una relación, en memoria acotada (un Durable Object tiene 128 MB
 * para todo): de cada obra se guarda solo lo ligero (la estructura sin planos, el
 * resumen de cada segmento, el inicio de la ficha global, el índice de unidades sin
 * su texto y, en los medios, la percepción condensada en texto por escena), y el
 * texto se carga por tramos, segmento a segmento, cuando hace falta y se suelta
 * después. Las unidades se marcan «⟦A12 · …⟧» y «⟦B3 · …⟧» para no confundirlas y
 * los segmentos llevan ids cortos («a52», «b3»).
 *
 * Nada de leer todas las fichas (con sus cientos de planos), todas las apariciones o
 * la percepción entera de una vez: así se reventó la memoria en producción el 4-11-2026.
 */
import type { Ancla, Documento, Lente, Region, Segmento } from '@scholaris/nucleo';
import { leerDocumento, leerSegmentos, leerUnidades } from '@scholaris/spdf';
import { coberturaDelMaterial, etiquetaUnidad, fichaDocumento, textoParaModelo, type FotogramaMaterial, type Material, type UnidadMaterial, type VozPercibida } from '../comprension/material.js';
import { textoEscena, textoReparto } from '../comprension/medios.js';
import type { ContextoComprension } from '../comprension/tipos.js';
import { obraDe, type Obra } from './obras.js';

export type Letra = 'A' | 'B';

/** Una unidad sin su texto: lo justo para localizar segmentos y tramos. */
export interface UnidadIndice {
  id: string;
  orden: number;
  ancla: Ancla;
  t0?: number;
  t1?: number;
  etiqueta: string;
  largo: number;
}

/** Una escena percibida, condensada: el resumen para la cabecera y el detalle (planos, sonido, diálogo) en texto. */
export interface EscenaLigera {
  t0: number;
  t1: number;
  linea: string;
  detalle: string;
}

/** Quién o qué está en cada plano y dónde (para la región de un lado visual). */
export interface PlanoLigero {
  t0: number;
  t1: number;
  locs: Array<{ nombre: string; region: Region; instante?: number }>;
}

export interface MaterialObra {
  letra: Letra;
  o: Obra;
  documento: Documento;
  medio: boolean;
  indice: UnidadIndice[];
  porId: Map<string, UnidadIndice>;
  porOrden: Map<number, UnidadIndice>;
  /** Los segmentos que se alinean: los más hondos de la estructura (sin planos). */
  hojas: Segmento[];
  /** Todos los segmentos sin planos (para el localizador). */
  segmentos: Segmento[];
  /** `true` si los segmentos son de mentira (el documento no tiene comprensión): no se guardan como segmento. */
  provisionales: boolean;
  /** Resumen (en español) de la ficha de cada segmento. */
  resumenes: Map<string, string>;
  global: { texto: string; resumen?: string; lente?: Lente } | null;
  escenas: EscenaLigera[];
  planos: PlanoLigero[];
  voces: VozPercibida[];
  reparto: string;
  conPercepcion: boolean;
  /** Caracteres de todo el texto (sin cargarlo). */
  caracteres: number;
}

export const idCortoDe = (letra: Letra, s: Pick<Segmento, 'orden'>) => `${letra.toLowerCase()}${s.orden}`;

/** Segmentos de reserva para un documento sin comprensión: tramos de unas pocas páginas o de cinco minutos. */
function provisionales(documento: string, indice: readonly UnidadIndice[], medio: boolean): Segmento[] {
  const us = indice.filter((u) => u.largo > 0);
  if (!us.length) return [];
  const salida: Segmento[] = [];
  const crear = (a: UnidadIndice, b: UnidadIndice): Segmento => (medio
    ? { id: `${documento}:ps${salida.length}`, documento, padre: null, nivel: 1, orden: salida.length, tipo: 'bloque', titulo: etiquetaUnidad({ tipo: 'tiempo', t0: a.t0 ?? 0, t1: b.t1 ?? 0 }), ancla: { tipo: 'tiempo', t0: a.t0 ?? 0, t1: b.t1 ?? 0 }, unidadDesde: a.id, unidadHasta: b.id, origen: 'deducido', confianza: 0.3 }
    : { id: `${documento}:ps${salida.length}`, documento, padre: null, nivel: 1, orden: salida.length, tipo: 'apartado', titulo: a.etiqueta === b.etiqueta ? a.etiqueta : `${a.etiqueta}-${b.etiqueta}`, ancla: a.ancla, anclaFin: b.ancla, unidadDesde: a.id, unidadHasta: b.id, origen: 'deducido', confianza: 0.3 });
  if (medio) {
    let grupo: UnidadIndice[] = [];
    for (const u of us) {
      if (grupo.length && (u.t0 ?? 0) - (grupo[0]!.t0 ?? 0) > 300) { salida.push(crear(grupo[0]!, grupo.at(-1)!)); grupo = []; }
      grupo.push(u);
    }
    if (grupo.length) salida.push(crear(grupo[0]!, grupo.at(-1)!));
    return salida;
  }
  const porGrupo = Math.max(1, Math.ceil(us.length / 30));
  for (let i = 0; i < us.length; i += porGrupo) salida.push(crear(us[i]!, us[Math.min(us.length - 1, i + porGrupo - 1)]!));
  return salida;
}

/** El índice de unidades de un documento sin su texto (id, orden, ancla y longitud). */
export async function indiceDeUnidades(ctx: Pick<ContextoComprension, 'sql'>, documento: string): Promise<UnidadIndice[]> {
  const filas = await ctx.sql.ejecutar<{ id: string; orden: number; ancla: string; largo: number }>(
    'SELECT id, orden, ancla, length(texto) AS largo FROM unidades WHERE documento = ? ORDER BY orden', documento);
  return filas.map((f) => {
    const ancla = JSON.parse(String(f.ancla)) as Ancla;
    return {
      id: String(f.id), orden: Number(f.orden), ancla, etiqueta: (() => { try { return etiquetaUnidad(ancla); } catch { return ''; } })(), largo: Number(f.largo ?? 0),
      ...(ancla.tipo === 'tiempo' ? { t0: ancla.t0, t1: ancla.t1 } : {}),
    };
  });
}

/**
 * Lo ligero de una obra. Las consultas piden solo las columnas y las filas que hacen
 * falta (ni los planos, ni las fichas enteras, ni las apariciones), y la percepción
 * se condensa en texto y se suelta.
 */
export async function materialObra(ctx: ContextoComprension, documento: string, letra: Letra): Promise<MaterialObra> {
  const doc = await leerDocumento(ctx.sql, documento);
  if (!doc) throw new Error(`No existe el documento ${documento}.`);
  const indice = await indiceDeUnidades(ctx, documento);
  const medio = doc.tipo === 'audio' || doc.tipo === 'video' || indice.some((u) => u.ancla.tipo === 'tiempo');
  const segmentos = await leerSegmentos(ctx.sql, documento, { sinPlanos: true });
  const conHijos = new Set(segmentos.map((s) => s.padre).filter(Boolean));
  let hojas = segmentos.filter((s) => !conHijos.has(s.id));
  const prov = !hojas.length;
  if (prov) hojas = provisionales(documento, indice, medio);
  const resumenes = new Map<string, string>();
  for (const f of await ctx.sql.ejecutar<{ objetivo_id: string; r: string | null }>(
    "SELECT objetivo_id, json_extract(datos, '$.resumen.es') AS r FROM fichas WHERE documento = ? AND objetivo = 'segmento' AND clase <> 'plano'", documento)) {
    if (f.r) resumenes.set(String(f.objetivo_id), String(f.r));
  }
  const [g] = await ctx.sql.ejecutar<{ texto: string; lente: string; r: string | null }>(
    "SELECT substr(texto, 1, 8000) AS texto, lente, json_extract(datos, '$.resumen.es') AS r FROM fichas WHERE documento = ? AND objetivo = 'documento' AND clase = 'global' ORDER BY n LIMIT 1", documento);
  // La percepción: se lee, se condensa en texto y se suelta (el objeto entero pesa varias veces su JSON).
  const escenas: EscenaLigera[] = [];
  const planos: PlanoLigero[] = [];
  let voces: VozPercibida[] = [];
  let reparto = '';
  if (medio && ctx.percepcion) {
    const p = await ctx.percepcion(documento).catch(() => null);
    if (p?.escenas?.length) {
      const orden = [...p.escenas].sort((x, y) => x.t0 - y.t0);
      orden.forEach((e, i) => {
        escenas.push({
          t0: e.t0, t1: e.t1, detalle: textoEscena(p, i),
          linea: `[${etiquetaUnidad({ tipo: 'tiempo', t0: e.t0, t1: e.t0 })}-${etiquetaUnidad({ tipo: 'tiempo', t0: e.t1, t1: e.t1 })}] «${e.titulo}»${e.lugar ? `, ${e.lugar}` : ''}. ${e.accion}${e.personas.length ? ` (${e.personas.join(', ')})` : ''}`,
        });
        for (const pl of e.planos) {
          const locs = [...pl.objetos, ...pl.personas].filter((x) => x.region).map((x) => ({ nombre: x.nombre, region: x.region!, ...(x.instante !== undefined ? { instante: x.instante } : {}) }));
          if (locs.length) planos.push({ t0: pl.t0, t1: pl.t1, locs });
        }
      });
      voces = orden.flatMap((e) => e.dialogoClave.filter((d) => d.hablante).map((d) => ({ t: d.t, hablante: d.hablante!, texto: d.texto }))).sort((x, y) => x.t - y.t);
      reparto = p.reparto.length ? textoReparto(p) : '';
    }
  }
  return {
    letra, o: obraDe(doc), documento: doc, medio, indice, porId: new Map(indice.map((u) => [u.id, u])), porOrden: new Map(indice.map((u) => [u.orden, u])),
    hojas, segmentos: prov ? hojas : segmentos, provisionales: prov, resumenes,
    global: g ? { texto: String(g.texto ?? ''), ...(g.r ? { resumen: String(g.r) } : {}), ...(g.lente ? { lente: String(g.lente) as Lente } : {}) } : null,
    escenas, planos, voces, reparto, conPercepcion: escenas.length > 0, caracteres: indice.reduce((t, u) => t + u.largo, 0),
  };
}

// ---------------------------------------------------------------------------
// Tramos: el texto de unos segmentos, cargado cuando hace falta
// ---------------------------------------------------------------------------

/** Los órdenes de unidad que cubren unos segmentos (en los medios, por tiempo), con margen. */
export function ordenesDe(mo: MaterialObra, segs: readonly Segmento[], margen = 1): number[] {
  const ordenes = new Set<number>();
  for (const s of segs) {
    if (mo.medio && s.ancla.tipo === 'tiempo') {
      const t0 = s.ancla.t0 - 10, t1 = (s.anclaFin?.tipo === 'tiempo' ? s.anclaFin.t1 : s.ancla.t1) + 10;
      for (const u of mo.indice) if (u.t0 !== undefined && u.t1 !== undefined && u.t0 < t1 && u.t1 > t0) ordenes.add(u.orden);
    } else {
      const d = mo.porId.get(s.unidadDesde)?.orden ?? 0, h = mo.porId.get(s.unidadHasta)?.orden ?? d;
      for (let o = d - margen; o <= h + margen; o++) if (mo.porOrden.has(o)) ordenes.add(o);
    }
  }
  return [...ordenes].sort((x, y) => x - y);
}

/** Un Material (el de la comprensión) con solo estas unidades: para anclar citas y escribir el tramo para el modelo. */
export async function cargarTramo(ctx: Pick<ContextoComprension, 'sql'>, mo: MaterialObra, ordenes: readonly number[]): Promise<Material> {
  const unidades: UnidadMaterial[] = [];
  // Rangos contiguos: una consulta por rango.
  const rangos: Array<[number, number]> = [];
  for (const o of [...new Set(ordenes)].sort((x, y) => x - y)) {
    const ultimo = rangos.at(-1);
    if (ultimo && o === ultimo[1] + 1) ultimo[1] = o; else rangos.push([o, o]);
  }
  for (const [desde, hasta] of rangos) {
    for (const u of await leerUnidades(ctx.sql, mo.documento.id, { desde, hasta })) {
      const m: UnidadMaterial = { id: u.id, orden: u.orden, ancla: u.ancla, texto: (u.texto ?? '').normalize('NFC'), etiqueta: mo.porId.get(u.id)?.etiqueta ?? '' };
      if (u.ancla.tipo === 'tiempo') { m.t0 = u.ancla.t0; m.t1 = u.ancla.t1; }
      if (u.palabras) m.palabras = u.palabras;
      unidades.push(m);
    }
  }
  // Sin percepción, los fotogramas descritos del tramo (solo su texto, nunca la imagen).
  const fotogramas: FotogramaMaterial[] = [];
  if (mo.medio && !mo.conPercepcion && unidades.length) {
    const t0 = Math.min(...unidades.map((u) => u.t0 ?? 0)), t1 = Math.max(...unidades.map((u) => u.t1 ?? 0));
    const filas = await ctx.sql.ejecutar<{ id: string; unidad: string; descripcion: string | null; t: number }>(
      "SELECT id, unidad, descripcion, json_extract(ancla, '$.t0') AS t FROM figuras WHERE documento = ? AND json_extract(ancla, '$.t0') BETWEEN ? AND ? ORDER BY t", mo.documento.id, t0 - 1, t1 + 1);
    filas.filter((f) => (f.descripcion ?? '').trim().length > 12).forEach((f, i) => fotogramas.push({ n: i + 1, id: String(f.id), unidad: String(f.unidad), t: Number(f.t), descripcion: String(f.descripcion).trim() }));
  }
  const t0 = unidades[0]?.t0, t1 = unidades.at(-1)?.t1;
  return {
    documento: mo.documento, unidades, porOrden: new Map(unidades.map((u) => [u.orden, u])), porId: new Map(unidades.map((u) => [u.id, u])),
    secciones: [], fotogramas, medio: mo.medio, caracteres: unidades.reduce((t, u) => t + u.texto.length, 0),
    ...(mo.voces.length ? { voces: t0 !== undefined && t1 !== undefined ? mo.voces.filter((v) => v.t >= t0 - 5 && v.t <= t1 + 5) : mo.voces } : {}),
  };
}

/** El tramo con las marcas de su letra («⟦A12 · 1:02:03-1:02:40⟧»). */
export function textoMarcado(mo: MaterialObra, m: Material): string {
  const t = textoParaModelo(m, { fotogramas: mo.medio && !mo.conPercepcion });
  return t.replace(/⟦U(\d+)/g, `⟦${mo.letra}$1`).replace(/⟦F(\d+)/g, `⟦F${mo.letra}$1`);
}

/** La cobertura de la transcripción en un tramo de tiempo, sin cargar el texto. */
export function cobertura(mo: MaterialObra, t0: number, t1: number) {
  return coberturaDelMaterial({ documento: mo.documento, unidades: mo.indice.filter((u) => u.largo > 0) as unknown as UnidadMaterial[] }, t0, t1);
}

const tiempo = (x: number) => etiquetaUnidad({ tipo: 'tiempo', t0: x, t1: x });

export function localizadorDe(s: Segmento): string {
  if (s.ancla.tipo === 'tiempo') return `${tiempo(s.ancla.t0)}-${tiempo(s.anclaFin?.tipo === 'tiempo' ? s.anclaFin.t1 : s.ancla.t1)}`;
  return etiquetaUnidad(s.ancla) + (s.anclaFin && etiquetaUnidad(s.anclaFin) !== etiquetaUnidad(s.ancla) ? `-${etiquetaUnidad(s.anclaFin).replace(/^pp?\. /, '')}` : '');
}

/** Los segmentos que se alinean, con su id corto, su localizador, las unidades que cubren y el resumen de su ficha. */
export function textoHojas(mo: MaterialObra): string {
  const orden = (id: string) => mo.porId.get(id)?.orden ?? '?';
  const padres = new Map(mo.segmentos.map((s) => [s.id, s]));
  return mo.hojas.map((s) => {
    const r = mo.resumenes.get(s.id) ?? s.resumen ?? '';
    const padre = s.padre ? padres.get(s.padre) : undefined;
    const c = s.ancla.tipo === 'tiempo' && mo.medio ? cobertura(mo, s.ancla.t0, s.anclaFin?.tipo === 'tiempo' ? s.anclaFin.t1 : s.ancla.t1) : null;
    return `${idCortoDe(mo.letra, s)} ${s.tipo} «${s.titulo}» ${localizadorDe(s)} (${mo.letra}${orden(s.unidadDesde)}-${mo.letra}${orden(s.unidadHasta)})${padre ? ` [en «${padre.titulo}»]` : ''}${c && c.cobertura < 0.9 ? ` [transcripción ${Math.round(c.cobertura * 100)} %]` : ''}${r ? `: ${r}` : ''}`;
  }).join('\n');
}

/** La cabecera de una obra: ficha, ficha global, reparto, segmentos, escenas percibidas y huecos de la transcripción. */
export function cabeceraObra(mo: MaterialObra, o: { global?: boolean } = {}): string {
  const partes = [`Obra ${mo.letra}\n${fichaDocumento(mo.documento)}`];
  if (mo.global?.resumen) partes.push(`Resumen de su ficha global: ${mo.global.resumen}`);
  if (o.global && mo.global?.texto) partes.push(`Ficha global de ${mo.letra} (inicio):\n${mo.global.texto}`);
  if (mo.reparto) partes.push(`Reparto percibido de ${mo.letra}:\n${mo.reparto}`);
  partes.push(`Segmentos de ${mo.letra} que se alinean (id corto, localizador, unidades, resumen):\n${textoHojas(mo)}`);
  if (mo.escenas.length) partes.push(`Percepción de ${mo.letra}, escena a escena:\n${mo.escenas.map((e, i) => `Escena ${i} ${e.linea}`).join('\n')}`);
  if (mo.medio) {
    const huecos = cobertura(mo, 0, mo.documento.duracion ?? Math.max(0, ...mo.indice.map((u) => u.t1 ?? 0))).huecos;
    if (huecos.length) partes.push(`Tramos de ${mo.letra} sin transcripción (no se sabe si son silencio, música o huecos): ${huecos.map(([a, b]) => `${tiempo(a)}-${tiempo(b)}`).join(', ')}. Lo que pase ahí solo se conoce por la percepción: nunca concluyas que algo no se dice porque no esté en la transcripción.`);
  }
  return partes.join('\n\n');
}

/** La prosa sin las marcas del material de las dos obras («⟦A12 · 1:02:03⟧» → «1:02:03»). */
export function limpiarMarcas(texto: string, a: MaterialObra, b: MaterialObra): string {
  if (!texto.includes('⟦')) return texto.trim();
  return texto
    .replace(/⟦\s*F?([AB])(\d+)(?:\s*·\s*([^⟧]*))?⟧/g, (_x, l: string, n: string, et?: string) => {
      if (et?.trim()) return et.trim();
      return (l === 'A' ? a : b).porOrden.get(Number(n))?.etiqueta ?? '';
    })
    .replace(/\(\s*\)/g, '').replace(/\s+([,.;:])/g, '$1').replace(/ {2,}/g, ' ').trim();
}
