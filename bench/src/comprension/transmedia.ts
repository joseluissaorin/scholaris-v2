/**
 * Cobertura de la capa transmedia frente a la rúbrica del banco: ¿cuántos puntos
 * de las preguntas que comparan dos obras tienen ya, en las alineaciones y en la
 * ficha de la relación, una correspondencia que caiga en sus anclas? Y, con un
 * juez, ¿cuántos dice de verdad lo que el punto afirma?
 *
 *   pnpm bench comprension transmedia --dir <carpeta con relaciones.json, alineaciones-*.json, ficha-*.json>
 *       [--juez gemini-3.8-flash] [--sin-juez]
 *
 * El banco es privado (cita obras con derechos): se lee de DIR_BANCO y el informe
 * se escribe en la misma carpeta de entrada, nunca en el repositorio.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Alineacion, Ficha, LadoAlineacion, Relacion } from '@scholaris/nucleo';
import type { ModeloJuez } from './modelo.js';
import type { AnclaRubrica, Banco, PuntoRubrica } from './tipos.js';

/**
 * ¿Cae un lado de una alineación (o una prueba) en un ancla de la rúbrica? Solo los
 * lados estrechos cuentan (un pasaje de hasta dos páginas o de hasta tres minutos):
 * una escena añadida entera no «cubre» cada detalle que pase dentro.
 */
export function caeEn(l: Pick<LadoAlineacion, 'documento' | 'ancla' | 'anclaFin'>, a: AnclaRubrica, margen = 20): boolean {
  if (l.documento !== a.documento) return false;
  if (l.ancla.tipo === 'pagina' && a.fisica !== undefined) {
    const p0 = l.ancla.fisica, p1 = l.anclaFin?.tipo === 'pagina' ? l.anclaFin.fisica : p0;
    return p1 - p0 <= 1 && p0 <= a.fisica && a.fisica <= p1;
  }
  if (l.ancla.tipo === 'tiempo' && a.t0 !== undefined) {
    const t0 = l.ancla.t0, t1 = l.anclaFin?.tipo === 'tiempo' ? l.anclaFin.t1 : l.ancla.t1;
    const b0 = a.t0, b1 = a.t1 ?? a.t0;
    return t1 - t0 <= 180 && t0 < b1 + margen && t1 > b0 - margen;
  }
  return false;
}

export interface CoberturaPunto {
  pregunta: string;
  punto: string;
  afirmacion: string;
  documentos: string[];
  /** El punto tiene anclas en las dos obras (una comparación). */
  comparativo: boolean;
  /** Alineaciones finas que caen en las anclas del punto (en todas sus obras de la relación). */
  alineaciones: string[];
  /** Pruebas de la ficha de la relación que caen en sus anclas. */
  ficha: number;
  cubierto: boolean;
  juez?: 'si' | 'parcial' | 'no';
  motivo?: string;
}

/** Puntos de la rúbrica cuyas anclas son todas de las dos obras de la relación (con al menos una). */
export function puntosDeLaRelacion(banco: Banco, rel: Pick<Relacion, 'origen' | 'destino'>): Array<{ pregunta: string; punto: PuntoRubrica }> {
  const docs = new Set([rel.origen, rel.destino]);
  const salida: Array<{ pregunta: string; punto: PuntoRubrica }> = [];
  for (const q of banco.preguntas) {
    // Las preguntas que comparan las dos obras (no las de una sola, ni las de otras de la biblioteca).
    if (!q.categorias.includes('transmedia') || !q.documentos.some((d) => docs.has(d))) continue;
    for (const p of q.rubrica.puntos) {
      if (!p.anclas.length || !p.anclas.every((a) => docs.has(a.documento))) continue;
      salida.push({ pregunta: q.id, punto: p });
    }
  }
  return salida;
}

export function cobertura(banco: Banco, rel: Relacion, alineaciones: readonly Alineacion[], ficha: Ficha | null): CoberturaPunto[] {
  return puntosDeLaRelacion(banco, rel).map(({ pregunta, punto }) => {
    const docs = [...new Set(punto.anclas.map((a) => a.documento))];
    const casan = alineaciones.filter((x) => !x.id.includes(':g') && docs.every((d) => {
      const lado = x.a?.documento === d ? x.a : x.b?.documento === d ? x.b : undefined;
      return !!lado && punto.anclas.filter((a) => a.documento === d).some((a) => caeEn(lado, a));
    }));
    const deFicha = (ficha?.evidencias ?? []).filter((e) => punto.anclas.some((a) => caeEn(e, a))).length;
    return { pregunta, punto: punto.id, afirmacion: punto.afirmacion, documentos: docs, comparativo: docs.length > 1, alineaciones: casan.map((x) => x.id), ficha: deFicha, cubierto: casan.length > 0 };
  });
}

const ESQUEMA_JUEZ = {
  type: 'object',
  properties: { veredicto: { type: 'string', enum: ['si', 'parcial', 'no'] }, motivo: { type: 'string' } },
  required: ['veredicto', 'motivo'],
};

/** El juez: ¿dicen las notas de esas alineaciones (y la ficha) lo que afirma el punto? */
export async function juzgarCobertura(juez: ModeloJuez, c: CoberturaPunto, alineaciones: ReadonlyMap<string, Alineacion>, ficha: Ficha | null): Promise<{ veredicto: 'si' | 'parcial' | 'no'; motivo: string; usd: number }> {
  const notas = c.alineaciones.slice(0, 10).map((id) => alineaciones.get(id)!).map((x) => `- (${x.tipo}) ${x.nota}`).join('\n');
  const cambios = ((ficha?.datos.cambios ?? []) as Array<{ afirmacion: string }>).map((x) => `- ${x.afirmacion}`).join('\n');
  const personajes = ((ficha?.datos.personajes ?? []) as Array<{ nombre: string; cambio: string; nota: string }>).map((x) => `- ${x.nombre} (${x.cambio}): ${x.nota}`).join('\n');
  const r = await juez.json<{ veredicto: 'si' | 'parcial' | 'no'; motivo: string }>({
    sistema: 'Eres un juez estricto. Dices si un análisis comparativo de dos obras recoge una afirmación concreta. «si»: la recoge con su sustancia; «parcial»: recoge una parte o la roza; «no»: no la recoge o dice otra cosa. Responde en español, con un motivo de una frase.',
    usuario: `Afirmación de la rúbrica:\n${c.afirmacion}\n\nNotas de las alineaciones que caen en sus anclas:\n${notas || '(ninguna)'}\n\nCambios de la ficha de la relación:\n${cambios || '(ninguno)'}\n\nPersonajes en la ficha:\n${personajes || '(ninguno)'}\n\nInicio de la ficha:\n${(ficha?.texto ?? '').slice(0, 6000)}`,
    esquema: ESQUEMA_JUEZ,
  });
  return { ...r.json, usd: r.usd };
}

export interface InformeTransmedia {
  relacion: string;
  puntos: number;
  cubiertos: number;
  /** Los puntos que comparan las dos obras (anclas en las dos), y cuántos tienen una alineación fina que une sus dos anclas. */
  comparativos: { puntos: number; cubiertos: number; si: number; parcial: number };
  juez?: { si: number; parcial: number; no: number; usd: number };
  porPregunta: Record<string, { puntos: number; cubiertos: number; si?: number }>;
  detalle: CoberturaPunto[];
}

export async function informeTransmedia(dir: string, banco: Banco, juez: ModeloJuez | null): Promise<InformeTransmedia[]> {
  const relaciones = JSON.parse(readFileSync(join(dir, 'relaciones.json'), 'utf8')) as Relacion[];
  const informes: InformeTransmedia[] = [];
  for (const rel of relaciones) {
    const ruta = readdirSync(dir).find((f) => f === `alineaciones-${rel.id}.json`);
    if (!ruta) continue;
    const als = JSON.parse(readFileSync(join(dir, ruta), 'utf8')) as Alineacion[];
    const fRuta = readdirSync(dir).find((f) => f === `ficha-${rel.id}.json`);
    const ficha = fRuta ? JSON.parse(readFileSync(join(dir, fRuta), 'utf8')) as Ficha : null;
    const detalle = cobertura(banco, rel, als, ficha);
    let usd = 0;
    const porId = new Map(als.map((x) => [x.id, x]));
    if (juez) {
      for (const c of detalle) {
        if (!c.cubierto && !c.ficha) { c.juez = 'no'; c.motivo = 'Sin alineación ni prueba de la ficha en sus anclas.'; continue; }
        const v = await juzgarCobertura(juez, c, porId, ficha);
        c.juez = v.veredicto; c.motivo = v.motivo; usd += v.usd;
      }
    }
    const porPregunta: InformeTransmedia['porPregunta'] = {};
    for (const c of detalle) {
      const x = porPregunta[c.pregunta] ?? { puntos: 0, cubiertos: 0, ...(juez ? { si: 0 } : {}) };
      x.puntos++; if (c.cubierto) x.cubiertos++; if (c.juez === 'si') x.si = (x.si ?? 0) + 1;
      porPregunta[c.pregunta] = x;
    }
    const comp = detalle.filter((c) => c.comparativo);
    informes.push({
      relacion: rel.id, puntos: detalle.length, cubiertos: detalle.filter((c) => c.cubierto).length, porPregunta, detalle,
      comparativos: { puntos: comp.length, cubiertos: comp.filter((c) => c.cubierto).length, si: comp.filter((c) => c.juez === 'si').length, parcial: comp.filter((c) => c.juez === 'parcial').length },
      ...(juez ? { juez: { si: detalle.filter((c) => c.juez === 'si').length, parcial: detalle.filter((c) => c.juez === 'parcial').length, no: detalle.filter((c) => c.juez === 'no').length, usd } } : {}),
    });
  }
  writeFileSync(join(dir, 'cobertura-banco.json'), JSON.stringify(informes, null, 2));
  return informes;
}
