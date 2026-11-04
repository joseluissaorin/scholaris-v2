/**
 * La percepción de un medio (PercepcionMedio, del equipo de percepción) vista
 * desde la comprensión: el texto que lee el modelo de cada escena y las fichas
 * de plano, que no necesitan modelo (salen tal cual del découpage percibido).
 */
import type { Evidencia, Ficha, Localizado, PercepcionMedio, PlanoPercibido, Segmento } from '@scholaris/nucleo';
import { etiquetaUnidad } from './material.js';

const t = (s: number) => etiquetaUnidad({ tipo: 'tiempo', t0: s, t1: s });
const reg = (l: Localizado) => (l.region ? ` en x ${l.region.x.toFixed(2)}, y ${l.region.y.toFixed(2)}, ${l.region.w.toFixed(2)}×${l.region.h.toFixed(2)}` : '');

/** Escena percibida en texto para el modelo (con sus planos, su sonido y quién está). */
export function textoEscena(p: PercepcionMedio, i: number): string {
  const e = [...p.escenas].sort((a, b) => a.t0 - b.t0)[i];
  if (!e) return '';
  const lineas = [
    `Escena ${i} [${t(e.t0)}-${t(e.t1)}] «${e.titulo}»${e.lugar ? `, ${e.lugar}` : ''}${e.tiempo ? `, ${e.tiempo}` : ''}`,
    e.personas.length ? `Presentes: ${e.personas.join(', ')}` : '',
    `Acción: ${e.accion}`,
    e.transicion ? `Transición desde lo anterior: ${e.transicion}` : '',
    ...e.dialogoClave.map((d) => `  Diálogo ${t(d.t)}${d.hablante ? ` ${d.hablante}` : ''}: «${d.texto}»`),
    ...e.sonido.map((s) => `  Sonido ${t(s.t0)}-${t(s.t1)} ${s.clase}${s.diegetico === undefined ? '' : s.diegetico ? ' (diegético)' : ' (extradiegético)'}: ${s.descripcion}${s.obra ? ` [${s.obra}]` : ''}`),
    ...[...e.planos].sort((a, b) => a.t0 - b.t0).map((pl, k) => `  Plano ${k} ${textoPlano(pl)}`),
    e.notas ? `Notas: ${e.notas}` : '',
  ];
  return lineas.filter(Boolean).join('\n');
}

export function textoPlano(pl: PlanoPercibido): string {
  const rasgos = [pl.escala, pl.angulacion && pl.angulacion !== 'normal' ? pl.angulacion : '', pl.movimiento].filter(Boolean).join(', ');
  return [
    `[${t(pl.t0)}-${t(pl.t1)}]${rasgos ? ` ${rasgos}.` : ''} ${pl.descripcion}`,
    pl.composicion ? `Composición: ${pl.composicion}.` : '',
    pl.luz || pl.color ? `Luz y color: ${[pl.luz, pl.color].filter(Boolean).join('; ')}.` : '',
    pl.personas.length ? `Personas: ${pl.personas.map((x) => `${x.nombre}${reg(x)}${x.instante !== undefined ? ` (${t(x.instante)})` : ''}${x.nota ? `, ${x.nota}` : ''}`).join('; ')}.` : '',
    pl.objetos.length ? `Objetos: ${pl.objetos.map((x) => `${x.nombre}${reg(x)}${x.nota ? `, ${x.nota}` : ''}`).join('; ')}.` : '',
    pl.textoEnPantalla ? `Texto en pantalla: «${pl.textoEnPantalla}».` : '',
  ].filter(Boolean).join(' ');
}

/** El reparto percibido, como guía para reconocer a cada uno. */
export function textoReparto(p: PercepcionMedio): string {
  return p.reparto.map((r) => `- ${r.nombre}${r.actor ? ` (${r.actor})` : ''}${r.ficticia === false ? ', persona real' : ''}${r.descripcionVisual ? `: ${r.descripcionVisual}` : ''}${r.voz ? `; voz: ${r.voz}` : ''}`).join('\n');
}

/** La ficha de un plano, en prosa del análisis fílmico, sin llamar al modelo. */
export function prosaPlano(pl: PlanoPercibido): string {
  const partes: string[] = [];
  const cab = [pl.escala ? pl.escala.charAt(0).toUpperCase() + pl.escala.slice(1) : 'Plano', pl.angulacion ? `con angulación ${pl.angulacion}` : '', pl.movimiento ? (pl.movimiento === 'fija' ? 'y cámara fija' : `y ${pl.movimiento}`) : ''].filter(Boolean).join(' ');
  partes.push(`${cab}, de ${t(pl.t0)} a ${t(pl.t1)} (${Math.max(0, pl.t1 - pl.t0).toFixed(1).replace('.', ',')} s).`);
  if (pl.descripcion) partes.push(pl.descripcion.trim().replace(/\.?$/, '.'));
  if (pl.composicion) partes.push(`Composición: ${pl.composicion.trim().replace(/\.?$/, '.')}`);
  if (pl.luz || pl.color) partes.push(`Luz y color: ${[pl.luz, pl.color].filter(Boolean).join('; ').trim().replace(/\.?$/, '.')}`);
  if (pl.personas.length) partes.push(`En cuadro: ${pl.personas.map((x) => `${x.nombre}${x.nota ? ` (${x.nota})` : ''}`).join(', ')}.`);
  if (pl.objetos.length) partes.push(`Objetos: ${pl.objetos.map((x) => `${x.nombre}${x.nota ? ` (${x.nota})` : ''}`).join(', ')}.`);
  if (pl.textoEnPantalla) partes.push(`Texto en pantalla: «${pl.textoEnPantalla}».`);
  return partes.join(' ');
}

/** Las fichas de plano de un documento: una por segmento de tipo «plano». */
export function fichasDePlanos(p: PercepcionMedio, segmentos: readonly Segmento[], o: { idioma: string; modelo: string; version: string; creada: string }): Ficha[] {
  const planos = p.escenas.flatMap((e) => e.planos).sort((a, b) => a.t0 - b.t0);
  const salida: Ficha[] = [];
  for (const s of segmentos) {
    if (s.tipo !== 'plano' || s.ancla.tipo !== 'tiempo') continue;
    const a = s.ancla;
    const pl = planos.find((x) => Math.abs(x.t0 - a.t0) < 0.05 && Math.abs(x.t1 - a.t1) < 0.05);
    if (!pl) continue;
    const evidencias: Evidencia[] = [...pl.personas, ...pl.objetos].map((x) => ({
      documento: s.documento, modo: 'video' as const, unidad: s.unidadDesde,
      ancla: { tipo: 'tiempo' as const, t0: pl.t0, t1: pl.t1, instante: x.instante ?? (pl.t0 + pl.t1) / 2, ...(x.region ? { region: x.region } : {}) },
      cita: `${x.nombre}${x.nota ? `: ${x.nota}` : ''}`,
    }));
    if (!evidencias.length) evidencias.push({ documento: s.documento, modo: 'video', unidad: s.unidadDesde, ancla: { tipo: 'tiempo', t0: pl.t0, t1: pl.t1, instante: (pl.t0 + pl.t1) / 2 }, cita: pl.descripcion.slice(0, 300) });
    const datos: Record<string, unknown> = {
      escala: pl.escala ?? null, angulacion: pl.angulacion ?? null, movimiento: pl.movimiento ?? null, composicion: pl.composicion ?? null,
      luz: pl.luz ?? null, color: pl.color ?? null, duracion: Math.round((pl.t1 - pl.t0) * 100) / 100,
      personas: pl.personas.map((x) => x.nombre), objetos: pl.objetos.map((x) => x.nombre), textoEnPantalla: pl.textoEnPantalla ?? null,
      resumen: { es: pl.descripcion.slice(0, 300) },
      percepcion: p.modelo,
    };
    salida.push({
      id: `${s.documento}:fi:${s.id}:plano`, documento: s.documento, objetivo: 'segmento', objetivoId: s.id, lente: 'cine', clase: 'plano',
      idioma: o.idioma, texto: prosaPlano(pl), datos, evidencias, modelo: p.modelo, version: `${o.version} percepcion:${p.version}`, creada: o.creada,
    });
  }
  return salida;
}
