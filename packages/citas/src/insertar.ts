/** Inserción de citas en texto plano y Markdown, con bibliografía o notas al final. */
import type { Ancla } from '@scholaris/nucleo';
import type { DocumentoCitable } from './csl/mapeo.js';
import { MotorCitas, type ElementoCita } from './csl/motor.js';
import { puntoDeInsercion } from './segmentar.js';

/** Lo mínimo que hace falta para insertar una cita (PropuestaCita lo cumple). */
export interface CitaAInsertar {
  /** Rango de la afirmación en el texto. */
  desde: number;
  hasta: number;
  cita: { documento: string; ancla: Ancla; anclaFin?: Ancla };
  /** Si viene, sustituye a la afirmación (aplicación de marco). */
  reescritura?: string;
}

export interface OpcionesInsercion {
  estilo?: string;
  idioma?: string;
  bibliografia?: boolean;
  /** Título de la bibliografía; por defecto según idioma y estilo. */
  tituloBibliografia?: string;
}

const SUPERINDICES = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export function superindice(n: number): string { return String(n).split('').map((d) => SUPERINDICES[Number(d)]).join(''); }

export function tituloBibliografia(idioma: string, estilo: string): string {
  const i = idioma.slice(0, 2);
  if (estilo === 'apa') return ({ es: 'Referencias', en: 'References', fr: 'Références', it: 'Riferimenti bibliografici' } as Record<string, string>)[i] ?? 'Referencias';
  if (estilo === 'mla') return ({ es: 'Obras citadas', en: 'Works Cited', fr: 'Ouvrages cités', it: 'Opere citate' } as Record<string, string>)[i] ?? 'Obras citadas';
  return ({ es: 'Bibliografía', en: 'Bibliography', fr: 'Bibliographie', it: 'Bibliografia' } as Record<string, string>)[i] ?? 'Bibliografía';
}

export function tituloNotas(idioma: string): string {
  return ({ es: 'Notas', en: 'Notes', fr: 'Notes', it: 'Note' } as Record<string, string>)[idioma.slice(0, 2)] ?? 'Notas';
}

/** Agrupa citas que van en el mismo punto en un solo grupo («(A, 1990; B, 2001)»). */
export function agrupar(texto: string, citas: CitaAInsertar[], modo: 'autor-fecha' | 'nota'): Array<{ punto: number; desde: number; corte: number; reescritura?: string; elementos: ElementoCita[] }> {
  const grupos = new Map<number, { punto: number; desde: number; corte: number; reescritura?: string; elementos: ElementoCita[] }>();
  for (const c of [...citas].sort((a, b) => a.desde - b.desde)) {
    const punto = puntoDeInsercion(texto, c.desde, c.hasta, modo);
    const corte = puntoDeInsercion(texto, c.desde, c.hasta, 'autor-fecha');
    const g = grupos.get(punto) ?? { punto, desde: c.desde, corte, elementos: [] };
    if (c.reescritura && !g.reescritura) g.reescritura = c.reescritura.replace(/[\s.;:]+$/, '');
    if (!g.elementos.some((e) => e.documento === c.cita.documento && JSON.stringify(e.ancla) === JSON.stringify(c.cita.ancla))) {
      g.elementos.push({ documento: c.cita.documento, ancla: c.cita.ancla, ...(c.cita.anclaFin ? { anclaFin: c.cita.anclaFin } : {}) });
    }
    grupos.set(punto, g);
  }
  return [...grupos.values()].sort((a, b) => a.punto - b.punto);
}

/**
 * Inserta las citas en un texto. Autor-fecha: la cita va tras la afirmación y
 * antes del punto. Notas: llamada tras la puntuación y notas al final
 * (`[^n]` en Markdown, superíndices en texto plano).
 */
export async function insertarCitasTexto(
  texto: string, citas: CitaAInsertar[], documentos: DocumentoCitable[], opciones: OpcionesInsercion & { formato?: 'texto' | 'markdown' } = {},
): Promise<{ texto: string; bibliografia: string[]; notas: string[] }> {
  const formato = opciones.formato ?? 'markdown';
  const motor = await MotorCitas.crear({ estilo: opciones.estilo ?? 'apa', idioma: opciones.idioma ?? 'es-ES', documentos });
  const modo = motor.esNotas ? 'nota' : 'autor-fecha';
  const grupos = agrupar(texto, citas, modo);
  const { citas: textos, bibliografia } = motor.citar(grupos.map((g) => g.elementos), formato);
  let salida = texto;
  // De atrás adelante para no mover las posiciones.
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i]!;
    const llamada = motor.esNotas ? (formato === 'markdown' ? `[^${i + 1}]` : superindice(i + 1)) : ` ${textos[i]}`;
    salida = salida.slice(0, g.punto) + llamada + salida.slice(g.punto);
    if (g.reescritura) salida = salida.slice(0, g.desde) + g.reescritura + salida.slice(g.corte);
  }
  const notas = motor.esNotas ? textos : [];
  if (notas.length) {
    salida += formato === 'markdown'
      ? '\n\n' + notas.map((n, i) => `[^${i + 1}]: ${n}`).join('\n')
      : `\n\n${tituloNotas(motor.idioma)}\n\n` + notas.map((n, i) => `${i + 1}. ${n}`).join('\n');
  }
  if (opciones.bibliografia !== false && bibliografia.length) {
    const titulo = opciones.tituloBibliografia ?? tituloBibliografia(motor.idioma, motor.estilo);
    salida += formato === 'markdown' ? `\n\n## ${titulo}\n\n${bibliografia.join('\n\n')}\n` : `\n\n${titulo}\n\n${bibliografia.join('\n')}\n`;
  }
  return { texto: salida, bibliografia, notas };
}
