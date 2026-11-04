/** Carga y comprobación del banco de preguntas (preguntas.json del banco privado (ver LEEME)). */
import { readFileSync } from 'node:fs';
import { contieneCita, type Fuentes } from './fuentes.js';
import { CATEGORIAS, type AnclaRubrica, type Banco, type Pregunta } from './tipos.js';

export function cargarBanco(ruta: string): Banco {
  return JSON.parse(readFileSync(ruta, 'utf8')) as Banco;
}

/** Errores de forma: ids, categorías, anclas completas. */
export function erroresDeForma(b: Banco): string[] {
  const e: string[] = [];
  const ids = new Set<string>();
  for (const p of b.preguntas) {
    if (ids.has(p.id)) e.push(`${p.id}: id repetido`);
    ids.add(p.id);
    if (!p.pregunta.trim()) e.push(`${p.id}: pregunta vacía`);
    if (!(p.dificultad >= 1 && p.dificultad <= 5)) e.push(`${p.id}: dificultad fuera de 1-5`);
    for (const c of p.categorias) if (!CATEGORIAS.includes(c)) e.push(`${p.id}: categoría desconocida «${c}»`);
    if (!p.rubrica.puntos.some((x) => x.obligatorio)) e.push(`${p.id}: ningún punto obligatorio`);
    const pids = new Set<string>();
    for (const x of p.rubrica.puntos) {
      if (pids.has(x.id) || !x.id.startsWith(`${p.id}.`)) e.push(`${p.id}: id de punto inválido «${x.id}»`);
      pids.add(x.id);
      if (!x.anclas.length) e.push(`${x.id}: sin anclas`);
      for (const a of x.anclas) {
        if (!p.documentos.includes(a.documento)) e.push(`${x.id}: ancla de un documento que la pregunta no declara (${a.documento})`);
        const tiempo = a.t0 !== undefined, pagina = a.fisica !== undefined;
        if (tiempo === pagina) e.push(`${x.id}: el ancla debe ser de página o de tiempo`);
        if (tiempo && !(a.t1 !== undefined && a.t1 >= (a.t0 as number))) e.push(`${x.id}: tramo de tiempo inválido`);
        if (!a.cita && !a.que) e.push(`${x.id}: ancla sin cita ni descripción`);
      }
      if (x.verificacion.startsWith('visual') && !x.comprobacion?.length) e.push(`${x.id}: punto visual sin registro de comprobación`);
      if (x.verificacion === 'visual-doble' && new Set((x.comprobacion ?? []).map((c) => /\(([^)]+)\)/.exec(c)?.[1])).size < 2) e.push(`${x.id}: «visual-doble» con menos de dos modelos`);
    }
  }
  return e;
}

/** ¿Está cada cita literal en la fuente, en el sitio que dice el ancla? */
export function comprobarCitas(b: Banco, fuentes: Fuentes): Array<{ punto: string; ancla: AnclaRubrica; problema: string }> {
  const salida: Array<{ punto: string; ancla: AnclaRubrica; problema: string }> = [];
  for (const p of b.preguntas) {
    for (const x of p.rubrica.puntos) {
      for (const a of x.anclas) {
        if (!a.cita) continue;
        const d = fuentes.documento(a.documento);
        if (!d) { salida.push({ punto: x.id, ancla: a, problema: 'documento sin fuente descargada' }); continue; }
        const ancla = a.t0 !== undefined
          ? { tipo: 'tiempo' as const, t0: a.t0, t1: a.t1 ?? a.t0 }
          : d.unidades.find((u) => u.ancla.tipo === 'pagina' && u.ancla.fisica === a.fisica)?.ancla;
        if (!ancla) { salida.push({ punto: x.id, ancla: a, problema: `la unidad física ${a.fisica} no existe` }); continue; }
        const c = fuentes.contenido(a.documento, ancla);
        // Lo que sale de Whisper (huecos de la transcripción) no está en las unidades de Scholaris.
        if (x.comprobacion?.some((k) => k.startsWith('whisper')) && (c.sinTexto || !contieneCita(c.texto, a.cita, 0.7))) continue;
        if (!contieneCita(c.texto, a.cita, 0.75)) salida.push({ punto: x.id, ancla: a, problema: c.sinTexto ? 'tramo sin transcripción' : 'la cita no aparece en ese sitio' });
      }
    }
  }
  return salida;
}

export function filtrar(preguntas: Pregunta[], solo?: string[]): Pregunta[] {
  return solo?.length ? preguntas.filter((p) => solo.includes(p.id)) : preguntas;
}
