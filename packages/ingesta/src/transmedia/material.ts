/**
 * Las dos obras de una relación tal como las lee el modelo de la alineación: su
 * material entero (unidades marcadas con «⟦A12 · …⟧» y «⟦B3 · …⟧» para no
 * confundirlas), su estructura con ids cortos («a52», «b3»), las fichas de sus
 * segmentos, su ficha global y, en los medios, la percepción y los huecos de la
 * transcripción.
 */
import type { Ficha, PercepcionMedio, Segmento } from '@scholaris/nucleo';
import { leerFichas, leerSegmentos } from '@scholaris/spdf';
import { coberturaDelMaterial, etiquetaUnidad, fichaDocumento, huecosTranscripcion, leerMaterial, textoParaModelo, type Material } from '../comprension/material.js';
import { textoReparto } from '../comprension/medios.js';
import { vocesPercibidas } from '../comprension/flujo.js';
import type { ContextoComprension } from '../comprension/tipos.js';
import { obraDe, type Obra } from './obras.js';

export type Letra = 'A' | 'B';

export interface MaterialObra {
  letra: Letra;
  o: Obra;
  m: Material;
  /** Los segmentos que se alinean: los más hondos de la estructura (sin planos). */
  hojas: Segmento[];
  /** Todos los segmentos sin planos (para el localizador). */
  segmentos: Segmento[];
  /** `true` si los segmentos son de mentira (el documento no tiene comprensión): no se guardan como segmento. */
  provisionales: boolean;
  fichas: Map<string, Ficha>;
  global: Ficha | null;
  percepcion: PercepcionMedio | null;
}

export const idCortoDe = (letra: Letra, s: Pick<Segmento, 'orden'>) => `${letra.toLowerCase()}${s.orden}`;

/** Segmentos de reserva para un documento sin comprensión: tramos de unas pocas páginas o de cinco minutos. */
function provisionales(m: Material): Segmento[] {
  const us = m.unidades.filter((u) => u.texto.trim());
  if (!us.length) return [];
  const salida: Segmento[] = [];
  if (m.medio) {
    let grupo: typeof us = [];
    const cerrar = () => {
      if (!grupo.length) return;
      const a = grupo[0]!, b = grupo.at(-1)!;
      salida.push({ id: `${m.documento.id}:ps${salida.length}`, documento: m.documento.id, padre: null, nivel: 1, orden: salida.length, tipo: 'bloque', titulo: `${etiquetaUnidad({ tipo: 'tiempo', t0: a.t0 ?? 0, t1: b.t1 ?? 0 })}`, ancla: { tipo: 'tiempo', t0: a.t0 ?? 0, t1: b.t1 ?? 0 }, unidadDesde: a.id, unidadHasta: b.id, origen: 'deducido', confianza: 0.3 });
      grupo = [];
    };
    for (const u of us) { if (grupo.length && (u.t0 ?? 0) - (grupo[0]!.t0 ?? 0) > 300) cerrar(); grupo.push(u); }
    cerrar();
    return salida;
  }
  const porGrupo = Math.max(1, Math.ceil(us.length / 30));
  for (let i = 0; i < us.length; i += porGrupo) {
    const a = us[i]!, b = us[Math.min(us.length - 1, i + porGrupo - 1)]!;
    salida.push({ id: `${m.documento.id}:ps${salida.length}`, documento: m.documento.id, padre: null, nivel: 1, orden: salida.length, tipo: 'apartado', titulo: a.etiqueta === b.etiqueta ? a.etiqueta : `${a.etiqueta}-${b.etiqueta}`, ancla: a.ancla, anclaFin: b.ancla, unidadDesde: a.id, unidadHasta: b.id, origen: 'deducido', confianza: 0.3 });
  }
  return salida;
}

export async function materialObra(ctx: ContextoComprension, documento: string, letra: Letra): Promise<MaterialObra> {
  const m = await leerMaterial(ctx.sql, documento);
  const percepcion = m.medio && ctx.percepcion ? await ctx.percepcion(documento).catch(() => null) : null;
  if (percepcion?.escenas?.length) m.voces = vocesPercibidas(percepcion);
  const segmentos = (await leerSegmentos(ctx.sql, documento)).filter((s) => s.tipo !== 'plano');
  const conHijos = new Set(segmentos.map((s) => s.padre).filter(Boolean));
  let hojas = segmentos.filter((s) => !conHijos.has(s.id));
  const prov = !hojas.length;
  if (prov) hojas = provisionales(m);
  const fichas = new Map<string, Ficha>();
  let global: Ficha | null = null;
  for (const f of await leerFichas(ctx.sql, { documento })) {
    if (f.objetivo === 'segmento' && f.clase !== 'plano') fichas.set(f.objetivoId, f);
    if (f.objetivo === 'documento' && f.clase === 'global' && !global) global = f;
  }
  return { letra, o: obraDe(m.documento), m, hojas, segmentos: prov ? hojas : segmentos, provisionales: prov, fichas, global, percepcion: percepcion?.escenas?.length ? percepcion : null };
}

/** El material entero con las marcas de su letra («⟦A12 · 1:02:03-1:02:40⟧»). */
export function textoMarcado(mo: MaterialObra, o: { desde?: number; hasta?: number; maxCaracteres?: number } = {}): string {
  const t = textoParaModelo(mo.m, { ...o, fotogramas: mo.m.medio && !mo.percepcion });
  return t.replace(/⟦U(\d+)/g, `⟦${mo.letra}$1`).replace(/⟦F(\d+)/g, `⟦F${mo.letra}$1`);
}

const tiempo = (x: number) => etiquetaUnidad({ tipo: 'tiempo', t0: x, t1: x });

export function localizadorDe(s: Segmento): string {
  if (s.ancla.tipo === 'tiempo') return `${tiempo(s.ancla.t0)}-${tiempo(s.anclaFin?.tipo === 'tiempo' ? s.anclaFin.t1 : s.ancla.t1)}`;
  return etiquetaUnidad(s.ancla) + (s.anclaFin && etiquetaUnidad(s.anclaFin) !== etiquetaUnidad(s.ancla) ? `-${etiquetaUnidad(s.anclaFin).replace(/^pp?\. /, '')}` : '');
}

/** Los segmentos que se alinean, con su id corto, su localizador, las unidades que cubren y el resumen de su ficha. */
export function textoHojas(mo: MaterialObra): string {
  const orden = (id: string) => mo.m.porId.get(id)?.orden ?? '?';
  const padres = new Map(mo.segmentos.map((s) => [s.id, s]));
  return mo.hojas.map((s) => {
    const f = mo.fichas.get(s.id);
    const r = (f?.datos.resumen as { es?: string } | undefined)?.es ?? s.resumen ?? '';
    const padre = s.padre ? padres.get(s.padre) : undefined;
    const cob = s.ancla.tipo === 'tiempo' && mo.m.medio ? coberturaDelMaterial(mo.m, s.ancla.t0, s.anclaFin?.tipo === 'tiempo' ? s.anclaFin.t1 : s.ancla.t1) : null;
    return `${idCortoDe(mo.letra, s)} ${s.tipo} «${s.titulo}» ${localizadorDe(s)} (${mo.letra}${orden(s.unidadDesde)}-${mo.letra}${orden(s.unidadHasta)})${padre ? ` [en «${padre.titulo}»]` : ''}${cob && cob.cobertura < 0.9 ? ` [transcripción ${Math.round(cob.cobertura * 100)} %]` : ''}${r ? `: ${r}` : ''}`;
  }).join('\n');
}

/** La cabecera de una obra: ficha, reparto percibido, escenas percibidas y huecos de la transcripción. */
export function cabeceraObra(mo: MaterialObra): string {
  const partes = [`Obra ${mo.letra}\n${fichaDocumento(mo.m.documento)}`];
  if (mo.global) {
    const r = (mo.global.datos.resumen as { es?: string } | undefined)?.es;
    if (r) partes.push(`Resumen de su ficha global: ${r}`);
  }
  if (mo.percepcion?.reparto.length) partes.push(`Reparto percibido de ${mo.letra}:\n${textoReparto(mo.percepcion)}`);
  partes.push(`Segmentos de ${mo.letra} que se alinean (id corto, localizador, unidades, resumen):\n${textoHojas(mo)}`);
  if (mo.percepcion) {
    const escenas = [...mo.percepcion.escenas].sort((a, b) => a.t0 - b.t0);
    partes.push(`Percepción de ${mo.letra}, escena a escena:\n${escenas.map((e, i) => `Escena ${i} [${tiempo(e.t0)}-${tiempo(e.t1)}] «${e.titulo}»${e.lugar ? `, ${e.lugar}` : ''}. ${e.accion}${e.personas.length ? ` (${e.personas.join(', ')})` : ''}`).join('\n')}`);
  }
  const huecos = mo.m.medio ? huecosTranscripcion(mo.m) : [];
  if (huecos.length) partes.push(`Tramos de ${mo.letra} sin transcripción (no se sabe si son silencio, música o huecos): ${huecos.map(([a, b]) => `${tiempo(a)}-${tiempo(b)}`).join(', ')}. Lo que pase ahí solo se conoce por la percepción: nunca concluyas que algo no se dice porque no esté en la transcripción.`);
  return partes.join('\n\n');
}

/** La prosa sin las marcas del material de las dos obras («⟦A12 · 1:02:03⟧» → «1:02:03»). */
export function limpiarMarcas(texto: string, a: MaterialObra, b: MaterialObra): string {
  if (!texto.includes('⟦')) return texto.trim();
  return texto
    .replace(/⟦\s*F?([AB])(\d+)(?:\s*·\s*([^⟧]*))?⟧/g, (_x, l: string, n: string, et?: string) => {
      if (et?.trim()) return et.trim();
      const mo = l === 'A' ? a : b;
      return mo.m.porOrden.get(Number(n))?.etiqueta ?? '';
    })
    .replace(/\(\s*\)/g, '').replace(/\s+([,.;:])/g, '$1').replace(/ {2,}/g, ' ').trim();
}
