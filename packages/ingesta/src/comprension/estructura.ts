/**
 * Estructura: el árbol de segmentos de la lente (docs/COMPRENSION.md, paso 2).
 *
 * Por este orden de autoridad:
 *   1. lo que el propio documento declara (índice del EPUB, esquema del PDF,
 *      títulos detectados en la ingesta: tabla `secciones`) → origen «leido»;
 *   2. la percepción de un medio (escenas y planos con sus cortes) → «modelo»;
 *   3. el modelo, que lee la obra entera y propone el resto → «modelo».
 * Los segmentos de nivel alto alimentan `secciones` cuando el documento no
 * tenía índice: son el índice navegable y los capítulos del reproductor.
 */
import type { AnclaMaterial, Lente, PercepcionMedio, Segmento, SQL, TipoSegmento } from '@scholaris/nucleo';
import { borrarSegmentos, escribirSecciones, escribirSegmentos, leerSegmentos } from '@scholaris/spdf';
import { anclaDe, limpiarProsa, localizarCita } from './anclaje.js';
import { lente, REGLAS_COMUNES } from './lentes/index.js';
import { cadena, entero, lista, numero, objeto, opcion } from './lentes/comun.js';
import { fichaDocumento, textoParaModelo, type Material, type UnidadMaterial } from './material.js';
import { llamar } from './modelo.js';
import type { ModeloComprension, SegmentoModelo, UsoModelo } from './tipos.js';

const TIPOS: readonly TipoSegmento[] = [
  'obra', 'parte', 'capitulo', 'apartado', 'secuencia', 'escena', 'plano', 'acto', 'cuadro', 'poema', 'estrofa', 'tema', 'bloque',
  'intervencion', 'diapositiva', 'tabla', 'folio', 'articulo', 'otro',
];

// ---------------------------------------------------------------------------
// Unidades y tiempos
// ---------------------------------------------------------------------------

/** La unidad que contiene (o la más cercana a) un instante. */
export function unidadEnTiempo(m: Material, t: number): UnidadMaterial {
  let mejor = m.unidades[0]!;
  let distancia = Number.POSITIVE_INFINITY;
  for (const u of m.unidades) {
    if (u.t0 === undefined || u.t1 === undefined) continue;
    if (t >= u.t0 && t < u.t1) return u;
    const d = t < u.t0 ? u.t0 - t : t - u.t1;
    if (d < distancia) { distancia = d; mejor = u; }
  }
  return mejor;
}

/** Unidades cuyo tramo toca [t0, t1] (o la más cercana si ninguna lo toca). */
export function unidadesEnTramo(m: Material, t0: number, t1: number): UnidadMaterial[] {
  const us = m.unidades.filter((u) => u.t0 !== undefined && u.t1 !== undefined && u.t0 < t1 && u.t1 > t0);
  return us.length ? us : [unidadEnTiempo(m, (t0 + t1) / 2)];
}

// ---------------------------------------------------------------------------
// Árbol
// ---------------------------------------------------------------------------

/** Un segmento antes de numerarlo: posición de inicio y fin para ordenar y anidar. */
interface Borrador {
  clave: string;
  padreClave?: string;
  tipo: TipoSegmento;
  titulo: string;
  resumen?: string;
  origen: Segmento['origen'];
  confianza: number;
  desde: UnidadMaterial;
  hasta: UnidadMaterial;
  ancla: AnclaMaterial;
  anclaFin?: AnclaMaterial;
  /** Posición comparable: [orden de unidad, carácter] o segundos. */
  ini: number;
  fin: number;
  /** Rango de la lente (0 = el nivel más alto). */
  rango: number;
}

const POS = (u: UnidadMaterial, c = 0) => u.orden * 1e7 + c;

/**
 * Numera y anida: orden de lectura en preorden, padres por contención (o los que
 * dijo el modelo, si de verdad contienen), niveles desde 1 e ids estables.
 */
export function construirArbol(documento: string, borradores: Borrador[]): Segmento[] {
  const bs = [...borradores].sort((a, b) => a.ini - b.ini || a.rango - b.rango || b.fin - a.fin);
  const porClave = new Map(bs.map((b) => [b.clave, b]));
  const padreDe = new Map<Borrador, Borrador | null>();
  const pila: Borrador[] = [];
  for (const b of bs) {
    while (pila.length && !(pila.at(-1)!.ini <= b.ini && pila.at(-1)!.fin >= b.fin && pila.at(-1)!.rango < b.rango)) pila.pop();
    const declarado = b.padreClave ? porClave.get(b.padreClave) : undefined;
    const padre = declarado && declarado.ini <= b.ini && declarado.fin >= b.fin && declarado !== b ? declarado : pila.at(-1) ?? null;
    padreDe.set(b, padre);
    pila.push(b);
  }
  // Preorden: hijos tras su padre, en orden de lectura.
  const hijos = new Map<Borrador | null, Borrador[]>();
  for (const b of bs) {
    const p = padreDe.get(b) ?? null;
    hijos.set(p, [...(hijos.get(p) ?? []), b]);
  }
  const salida: Segmento[] = [];
  const ids = new Map<Borrador, string>();
  const recorrer = (p: Borrador | null, nivel: number) => {
    for (const b of hijos.get(p) ?? []) {
      const orden = salida.length;
      const id = `${documento}:sg${orden}`;
      ids.set(b, id);
      const s: Segmento = {
        id, documento, padre: p ? ids.get(p)! : null, nivel, orden, tipo: b.tipo, titulo: b.titulo.slice(0, 300),
        ancla: b.ancla, unidadDesde: b.desde.id, unidadHasta: b.hasta.id, origen: b.origen, confianza: Math.round(b.confianza * 1000) / 1000,
      };
      if (b.anclaFin) s.anclaFin = b.anclaFin;
      if (b.resumen) s.resumen = b.resumen.slice(0, 600);
      salida.push(s);
      recorrer(b, nivel + 1);
    }
  };
  recorrer(null, 1);
  return salida;
}

// ---------------------------------------------------------------------------
// 1. Lo que declara el documento
// ---------------------------------------------------------------------------

/** Las secciones de la ingesta como segmentos «leidos» (tipo según la lente y el nivel). */
export function segmentosDeSecciones(m: Material, l: Lente): Borrador[] {
  const def = lente(l);
  const conTexto = m.secciones.filter((s) => m.porId.has(s.unidadDesde));
  // Las secciones que crea la propia comprensión no cuentan como índice del documento.
  const propias = conTexto.filter((s) => !s.id.startsWith(`${m.documento.id}:cs`));
  // El índice ocupa los niveles altos de la lente; el más fino (la escena, el plano) lo pone el modelo.
  const disponibles = def.segmentos.length > 1 ? def.segmentos.slice(0, -1) : def.segmentos;
  const maxNivel = Math.max(1, ...propias.map((s) => s.nivel));
  const rangoDe = (nivel: number) => Math.min(disponibles.length - 1, Math.max(0, disponibles.length - maxNivel + (nivel - 1)));
  return propias.map((s, i) => {
    const desde = m.porId.get(s.unidadDesde)!;
    const siguiente = propias.slice(i + 1).find((x) => x.nivel <= s.nivel);
    const hastaId = s.unidadHasta && m.porId.has(s.unidadHasta) ? s.unidadHasta : siguiente ? siguiente.unidadDesde : m.unidades.at(-1)!.id;
    let hasta = m.porId.get(hastaId) ?? desde;
    if (siguiente && hasta.id === siguiente.unidadDesde && hasta.orden > desde.orden && !s.unidadHasta) hasta = m.porOrden.get(hasta.orden - 1) ?? hasta;
    const tipo = disponibles[rangoDe(s.nivel)] ?? 'apartado';
    const loc = localizarCita(desde, s.titulo);
    const medio = desde.t0 !== undefined;
    return {
      clave: `sec:${s.id}`, ...(s.padre ? { padreClave: `sec:${s.padre}` } : {}), tipo, titulo: s.titulo, ...(s.resumen ? { resumen: s.resumen } : {}),
      origen: 'leido' as const, confianza: 1, desde, hasta,
      ancla: medio ? { tipo: 'tiempo' as const, t0: desde.t0!, t1: hasta.t1 ?? desde.t1! } : anclaDe(desde, loc?.caracteres),
      ...(medio ? {} : { anclaFin: anclaDe(hasta) }),
      ini: medio ? desde.t0! : POS(desde, loc?.caracteres[0] ?? 0), fin: medio ? hasta.t1 ?? desde.t1! : POS(hasta, 9e6),
      rango: rangoDe(s.nivel),
    };
  });
}

// ---------------------------------------------------------------------------
// 2. La percepción de un medio
// ---------------------------------------------------------------------------

export interface SecuenciaAgrupada { titulo: string; desde: number; hasta: number; resumen?: string }

/** Escenas (y sus planos) de la percepción como segmentos; las secuencias, si se agruparon. */
export function segmentosDePercepcion(m: Material, p: PercepcionMedio, secuencias: SecuenciaAgrupada[] = []): Borrador[] {
  const salida: Borrador[] = [];
  const tramo = (t0: number, t1: number) => {
    const us = unidadesEnTramo(m, t0, t1);
    return { desde: us[0]!, hasta: us.at(-1)! };
  };
  const escenas = [...p.escenas].sort((a, b) => a.t0 - b.t0);
  for (const [i, s] of secuencias.entries()) {
    const a = escenas[Math.max(0, s.desde)], b = escenas[Math.min(escenas.length - 1, s.hasta)];
    if (!a || !b) continue;
    const { desde, hasta } = tramo(a.t0, b.t1);
    salida.push({
      clave: `sq${i}`, tipo: 'secuencia', titulo: s.titulo, ...(s.resumen ? { resumen: s.resumen } : {}), origen: 'modelo', confianza: 0.8,
      desde, hasta, ancla: { tipo: 'tiempo', t0: a.t0, t1: b.t1 }, ini: a.t0, fin: b.t1, rango: 0,
    });
  }
  for (const [i, e] of escenas.entries()) {
    const { desde, hasta } = tramo(e.t0, e.t1);
    salida.push({
      clave: `es${i}`, tipo: 'escena', titulo: e.titulo || `Escena ${i + 1}`, resumen: [e.lugar, e.accion].filter(Boolean).join('. ').slice(0, 600),
      origen: 'modelo', confianza: 0.9, desde, hasta, ancla: { tipo: 'tiempo', t0: e.t0, t1: e.t1 }, ini: e.t0, fin: e.t1, rango: 1,
    });
    for (const [k, pl] of [...e.planos].sort((x, y) => x.t0 - y.t0).entries()) {
      const t = tramo(pl.t0, pl.t1);
      salida.push({
        clave: `es${i}pl${k}`, padreClave: `es${i}`, tipo: 'plano',
        titulo: [pl.escala, pl.movimiento && pl.movimiento !== 'fija' ? pl.movimiento : ''].filter(Boolean).join(', ') || `Plano ${k + 1}`,
        resumen: pl.descripcion.slice(0, 600), origen: 'modelo', confianza: 0.85, desde: t.desde, hasta: t.hasta,
        ancla: { tipo: 'tiempo', t0: pl.t0, t1: pl.t1 }, ini: pl.t0, fin: pl.t1, rango: 2,
      });
    }
  }
  return salida;
}

export const ESQUEMA_SECUENCIAS = objeto({
  secuencias: lista(objeto({
    titulo: cadena('Título breve y descriptivo, como un capítulo de un DVD.'),
    desde: entero('Número de la primera escena (desde 0).'),
    hasta: entero('Número de la última escena (incluida).'),
    resumen: cadena('Una línea.'),
  }, ['titulo', 'desde', 'hasta', 'resumen'])),
}, ['secuencias']);

/** Pide al modelo que agrupe las escenas de la percepción en secuencias. */
export async function agruparSecuencias(m: Material, p: PercepcionMedio, modelo: ModeloComprension, l: Lente, acumulado: { uso: UsoModelo }): Promise<SecuenciaAgrupada[]> {
  const escenas = [...p.escenas].sort((a, b) => a.t0 - b.t0);
  if (escenas.length < 3) return [];
  const lista_ = escenas.map((e, i) => `${i}. [${Math.round(e.t0)}-${Math.round(e.t1)} s] ${e.titulo}${e.lugar ? ` (${e.lugar})` : ''}: ${e.accion.slice(0, 240)}`).join('\n');
  const r = await llamar<{ secuencias: SecuenciaAgrupada[] }>(modelo, {
    sistema: `${REGLAS_COMUNES}\n\nTarea: agrupar las escenas de una obra audiovisual en secuencias.\n${lente(l).guiaEstructura}`,
    partes: [{ texto: `${fichaDocumento(m.documento)}\n\nEscenas percibidas:\n${lista_}` }, { texto: 'Agrupa todas las escenas, en orden y sin huecos ni solapes, en secuencias narrativas. Responde solo con el JSON.' }],
    esquema: ESQUEMA_SECUENCIAS, calidad: 'rapida', maxTokens: 8000, operacion: 'estructura:secuencias',
  }, acumulado);
  // Saneado: en orden, sin solapes, cubriendo todo.
  const salida: SecuenciaAgrupada[] = [];
  let siguiente = 0;
  for (const s of [...(r.secuencias ?? [])].sort((a, b) => a.desde - b.desde)) {
    const desde = Math.max(siguiente, Math.floor(s.desde));
    const hasta = Math.min(escenas.length - 1, Math.max(desde, Math.floor(s.hasta)));
    if (desde > escenas.length - 1) break;
    salida.push({ titulo: s.titulo, desde, hasta, ...(s.resumen ? { resumen: s.resumen } : {}) });
    siguiente = hasta + 1;
  }
  if (salida.length && siguiente < escenas.length) salida.at(-1)!.hasta = escenas.length - 1;
  return salida;
}

// ---------------------------------------------------------------------------
// 3. El modelo
// ---------------------------------------------------------------------------

export function esquemaEstructura(tipos: readonly TipoSegmento[]) {
  return objeto({
    segmentos: lista(objeto({
      id: cadena('«s1», «s2»…'),
      padre: cadena('Id del segmento que lo contiene; vacío en el nivel más alto.'),
      tipo: opcion([...new Set([...tipos, 'otro'])]),
      titulo: cadena('Para un índice: el título literal si lo tiene; si no, uno descriptivo y breve.'),
      resumen: cadena('Una línea: qué pasa o de qué trata.'),
      desde: objeto({ u: entero('Unidad donde empieza.'), inicio: cadena('Primeras 5-10 palabras literales del segmento.'), t: numero('En medios, segundo de inicio.') }, ['u']),
      hasta: objeto({ u: entero('Unidad donde termina.'), fin: cadena('Últimas 5-10 palabras literales del segmento.'), t: numero('En medios, segundo final.') }, ['u']),
      confianza: numero('0-1.'),
    }, ['id', 'tipo', 'titulo', 'resumen', 'desde', 'hasta'])),
  }, ['segmentos']);
}

/** Convierte lo que propuso el modelo en borradores anclados (descarta lo que no se sostiene). */
export function borradoresDelModelo(m: Material, l: Lente, segs: readonly SegmentoModelo[], prefijo = 'm'): Borrador[] {
  const def = lente(l);
  const salida: Borrador[] = [];
  const primera = m.unidades[0], ultima = m.unidades.at(-1);
  if (!primera || !ultima) return [];
  for (const s of segs) {
    const tipo = TIPOS.includes(s.tipo) ? s.tipo : 'otro';
    let desde = m.porOrden.get(Math.round(s.desde?.u ?? primera.orden));
    let hasta = m.porOrden.get(Math.round(s.hasta?.u ?? s.desde?.u ?? ultima.orden));
    if (m.medio && s.desde?.t !== undefined) desde = unidadEnTiempo(m, s.desde.t);
    if (m.medio && s.hasta?.t !== undefined) hasta = unidadEnTiempo(m, Math.max(s.hasta.t - 0.01, s.desde?.t ?? 0));
    if (!desde || !hasta) continue;
    if (hasta.orden < desde.orden) [desde, hasta] = [hasta, desde];
    const ini = s.desde?.inicio ? localizarCita(desde, s.desde.inicio) : null;
    const fin = s.hasta?.fin ? localizarCita(hasta, s.hasta.fin) : null;
    const rangoLente = def.segmentos.indexOf(tipo);
    const rango = rangoLente >= 0 ? rangoLente : tipo === 'otro' ? 0 : def.segmentos.length;
    const confianza = Math.max(0.1, Math.min(1, (s.confianza ?? 0.8) * (ini || !s.desde?.inicio ? 1 : 0.85)));
    if (m.medio) {
      const t0 = s.desde?.t ?? desde.t0 ?? 0;
      const t1 = Math.max(t0 + 0.5, s.hasta?.t ?? hasta.t1 ?? t0 + 1);
      salida.push({
        clave: `${prefijo}:${s.id}`, ...(s.padre ? { padreClave: `${prefijo}:${s.padre}` } : {}), tipo, titulo: limpiarProsa(s.titulo || tipo, m), ...(s.resumen ? { resumen: limpiarProsa(s.resumen, m) } : {}),
        origen: 'modelo', confianza, desde, hasta, ancla: { tipo: 'tiempo', t0, t1 }, ini: t0, fin: t1, rango,
      });
      continue;
    }
    const cIni: [number, number] | undefined = ini?.caracteres;
    const cFin: [number, number] | undefined = fin?.caracteres;
    salida.push({
      clave: `${prefijo}:${s.id}`, ...(s.padre ? { padreClave: `${prefijo}:${s.padre}` } : {}), tipo, titulo: limpiarProsa(s.titulo || tipo, m), ...(s.resumen ? { resumen: limpiarProsa(s.resumen, m) } : {}),
      origen: 'modelo', confianza, desde, hasta,
      ancla: anclaDe(desde, cIni), anclaFin: anclaDe(hasta, cFin),
      ini: POS(desde, cIni?.[0] ?? 0), fin: POS(hasta, cFin?.[1] ?? 9e6), rango,
    });
  }
  // Hermanos del mismo rango que se pisan: el anterior acaba donde empieza el siguiente.
  const porRango = new Map<number, Borrador[]>();
  for (const b of salida) porRango.set(b.rango, [...(porRango.get(b.rango) ?? []), b]);
  for (const grupo of porRango.values()) {
    grupo.sort((a, b) => a.ini - b.ini);
    for (let i = 0; i + 1 < grupo.length; i++) {
      const a = grupo[i]!, b = grupo[i + 1]!;
      if (a.fin > b.ini && a.ini < b.ini) {
        a.fin = b.ini;
        if (m.medio && a.ancla.tipo === 'tiempo') a.ancla = { ...a.ancla, t1: b.ini };
      }
    }
  }
  return salida;
}

/** Ventanas de unidades para documentos que no caben enteros. */
export function ventanas(m: Material, maxCaracteres: number): Array<[number, number]> {
  const salida: Array<[number, number]> = [];
  let ini = m.unidades[0]?.orden ?? 0, n = 0;
  for (const u of m.unidades) {
    if (n > 0 && n + u.texto.length > maxCaracteres) { salida.push([ini, u.orden - 1]); ini = u.orden; n = 0; }
    n += u.texto.length + 30;
  }
  if (m.unidades.length) salida.push([ini, m.unidades.at(-1)!.orden]);
  return salida;
}

export async function estructuraDelModelo(
  m: Material, l: Lente, modelo: ModeloComprension, acumulado: { uso: UsoModelo },
  o: { leidos?: Borrador[]; maxCaracteres: number; calidad: 'alta' | 'rapida' },
): Promise<Borrador[]> {
  const def = lente(l);
  const tipos = def.segmentos.filter((t) => t !== 'plano');
  const indice = (o.leidos ?? []).length
    ? `\n\nÍndice que declara el propio documento (respétalo: tus segmentos van dentro de estas divisiones):\n${o.leidos!.map((b) => `${'  '.repeat(b.rango)}- ${b.titulo} (U${b.desde.orden}-U${b.hasta.orden})`).join('\n')}`
    : '';
  const salida: Borrador[] = [];
  for (const [k, [desde, hasta]] of ventanas(m, o.maxCaracteres).entries()) {
    const parcial = desde > (m.unidades[0]?.orden ?? 0) || hasta < (m.unidades.at(-1)?.orden ?? 0);
    const r = await llamar<{ segmentos: SegmentoModelo[] }>(modelo, {
      sistema: `${REGLAS_COMUNES}\n\nTarea: la estructura de la obra con la lente «${l}».\n${def.guiaEstructura}`,
      partes: [
        { texto: `${fichaDocumento(m.documento)}${indice}\n\nMaterial${parcial ? ` (unidades ${desde} a ${hasta} de un documento más largo)` : ''}:\n\n${textoParaModelo(m, { desde, hasta, fotogramas: m.medio })}` },
        { texto: `Devuelve el árbol de segmentos de ${parcial ? 'este tramo' : 'la obra entera'}, en orden de lectura, sin huecos: los paratextos (portada, créditos, índice, colofón) van como «otro». Tipos posibles, de mayor a menor: ${tipos.join(', ')}. Usa un nivel solo si la obra lo tiene. Para cada segmento da dónde empieza y dónde acaba (unidad y palabras literales${m.medio ? '; en los medios, además, el segundo' : ''}). Responde solo con el JSON.` },
      ],
      esquema: esquemaEstructura(tipos), calidad: o.calidad, maxTokens: 30_000, operacion: 'estructura',
    }, acumulado);
    salida.push(...borradoresDelModelo(m, l, r.segmentos ?? [], `m${k}`));
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/** Sustituye los segmentos del documento y, si no tenía índice propio, sus secciones de comprensión. */
export async function guardarEstructura(sql: SQL, m: Material, segmentos: Segmento[]): Promise<{ secciones: number }> {
  await borrarSegmentos(sql, m.documento.id);
  await escribirSegmentos(sql, segmentos);
  await sql.ejecutar('DELETE FROM secciones WHERE documento = ? AND id LIKE ?', m.documento.id, `${m.documento.id}:cs%`);
  const propias = m.secciones.filter((s) => !s.id.startsWith(`${m.documento.id}:cs`));
  if (propias.length) return { secciones: 0 };
  // Sin índice propio: el nivel alto (y el segundo si el alto es solo uno) hace de índice y de capítulos.
  const altos = segmentos.filter((s) => s.nivel === 1 && s.tipo !== 'otro');
  const niveles = altos.length <= 1 ? 2 : 1;
  const elegidos = segmentos.filter((s) => s.nivel <= niveles && s.tipo !== 'plano' && s.tipo !== 'otro');
  await escribirSecciones(sql, elegidos.map((s) => ({
    id: `${m.documento.id}:cs${s.orden}`, documento: m.documento.id, padre: s.padre && elegidos.some((x) => x.id === s.padre) ? `${m.documento.id}:cs${s.padre.split(':sg')[1]}` : null,
    nivel: s.nivel, titulo: s.titulo, unidadDesde: s.unidadDesde, unidadHasta: s.unidadHasta, resumen: s.resumen ?? null,
  })));
  return { secciones: elegidos.length };
}

export { leerSegmentos };
export type { Borrador };
