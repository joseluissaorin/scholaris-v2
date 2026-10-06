/**
 * Catálogo de RTVE Play: el episodio concreto de un programa, con su título
 * de catálogo («Julio Cortázar»), la fecha de emisión y su dirección.
 *
 * API pública sin clave: el identificador del programa sale de su página
 * (`/play/videos/<programa>/`) y los vídeos de `/api/programas/<id>/videos.json`.
 *
 * El episodio se elige por PRUEBAS de la propia grabación, no por lo que diga
 * el modelo: cuántas veces se nombra en la transcripción a la persona del
 * título del episodio, si es uno de los hablantes, y si la duración cuadra.
 * Si hay duda (pocas menciones, otro episodio casi igual de probable, una
 * duración que no cuadra), no se asigna ninguno.
 */

import type { Autor, MetadatosDocumento } from '@scholaris/nucleo';
import { normalizar } from '../texto.js';
import { autorDe } from '../pasos/metadatos/nombres.js';
import type { Hallazgo } from './fuentes.js';
import type { Consultor } from './red.js';

interface VideoRtve { id?: string; title?: string; dateOfEmission?: string; htmlUrl?: string; description?: string; duration?: number }

/** Lo que la grabación dice de sí misma. */
export interface EvidenciaGrabacion {
  /** Transcripción entera (o lo más posible). */
  texto: string;
  /** Nombres de hablante ya resueltos («Facundo Cabral»), si los hay. */
  hablantes: string[];
  /** Duración en segundos. */
  duracion?: number;
}

const decodificar = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&([a-z])acute;/gi, (_m, l: string) => ({ a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' } as Record<string, string>)[l] ?? l)
  .replace(/&ntilde;/g, 'ñ').replace(/&Ntilde;/g, 'Ñ').replace(/&uuml;/g, 'ü').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

export const slugRtve = (s: string) => normalizar(s).replace(/\s+/g, '-');

/** «20-03-1977 00:00:00» → «1977-03-20». */
export function fechaRtve(s: string | undefined): string | undefined {
  const m = s ? /^(\d{2})-(\d{2})-(\d{4})/.exec(s) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

/** Personas de un título de episodio: «Leopoldo Torre Nilsson y Fernando Díaz Plaja». */
export function personasDelTitulo(titulo: string): string[] {
  return titulo.split(/\s*(?:,|\by\b|\be\b|&)\s*/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 2 && x.split(/\s+/).length <= 5);
}

const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'san', 'santa', 'van', 'von', 'da', 'do', 'dos', 'di']);

/** Palabras que identifican a la persona: apellidos y nombre de pila (sin partículas ni nombres muy cortos). */
function rasgos(nombre: string): { apellidos: string[]; pila: string } {
  const p = normalizar(nombre).split(' ').filter((w) => w.length >= 3 && !PALABRAS_VACIAS.has(w));
  return { pila: p[0] ?? '', apellidos: p.slice(1) };
}

function contar(texto: string, palabra: string): number {
  if (!palabra) return 0;
  let n = 0;
  for (let i = texto.indexOf(` ${palabra} `); i >= 0; i = texto.indexOf(` ${palabra} `, i + 1)) n++;
  return n;
}

/**
 * Cuánto respalda la grabación que esta persona está en ella: menciones del
 * apellido (o de nombre y apellido juntos) y si es uno de los hablantes.
 */
export function presencia(nombre: string, ev: { textoNormalizado: string; hablantes: string[] }): number {
  const { pila, apellidos } = rasgos(nombre);
  if (!apellidos.length) return 0;
  const t = ev.textoNormalizado;
  // El apellido más distintivo (el menos frecuente) manda: «Díaz» aparece en muchos sitios, «Cabral» no.
  const porApellido = Math.min(...apellidos.map((a) => contar(t, a)));
  const completo = contar(t, `${pila} ${apellidos[0]}`);
  const menciones = porApellido + 2 * completo;
  // Ser hablante con nombre solo suma si además se le nombra: el nombre del hablante también lo puso un modelo.
  const hablante = menciones >= 2 && ev.hablantes.some((h) => { const r = rasgos(h); return r.apellidos.some((a) => apellidos.includes(a)) && r.pila === pila; });
  return menciones + (hablante ? 10 : 0);
}

export interface EleccionRtve {
  hallazgo: Hallazgo | null;
  /** Por qué se eligió o se descartó (para la procedencia). */
  motivo: string;
}

/** Busca el episodio de `programa` que la grabación respalda. */
export async function rtveEpisodio(programa: string, ev: EvidenciaGrabacion, red: Consultor): Promise<EleccionRtve> {
  const pagina = await red.texto(`https://www.rtve.es/play/videos/${slugRtve(programa)}/`);
  const id = pagina ? /api\/programas\/(\d+)/.exec(pagina)?.[1] : undefined;
  if (!id) return { hallazgo: null, motivo: 'programa no encontrado en RTVE Play' };
  if (normalizar(ev.texto).length < 400) return { hallazgo: null, motivo: 'transcripción demasiado corta para identificar el episodio' };
  const evidencia = { textoNormalizado: ` ${normalizar(ev.texto)} `, hablantes: ev.hablantes };
  const puntuados: Array<{ v: VideoRtve; p: number }> = [];
  for (let n = 1; n <= 10; n++) {
    const j = await red.json<{ page?: { items?: VideoRtve[]; totalPages?: number } }>(`https://www.rtve.es/api/programas/${id}/videos.json?size=60&page=${n}`);
    for (const v of j?.page?.items ?? []) {
      const personas = personasDelTitulo(decodificar(v.title ?? ''));
      if (!personas.length) continue;
      // Un episodio con varios invitados: cuenta el que menos aparece (tienen que estar todos).
      puntuados.push({ v, p: Math.min(...personas.map((x) => presencia(x, evidencia))) });
    }
    if (n >= (j?.page?.totalPages ?? 0)) break;
  }
  puntuados.sort((a, b) => b.p - a.p);
  const [mejor, segundo] = puntuados;
  if (!mejor || mejor.p < 8) return { hallazgo: null, motivo: `ningún invitado del catálogo se nombra lo bastante (máx. ${mejor?.p ?? 0} en «${mejor?.v.title ?? '—'}»)` };
  if (segundo && segundo.p * 3 > mejor.p) return { hallazgo: null, motivo: `duda entre «${mejor.v.title}» (${mejor.p}) y «${segundo.v.title}» (${segundo.p})` };
  const v = mejor.v;
  const duracionRtve = v.duration ? v.duration / 1000 : undefined;
  if (duracionRtve && ev.duracion) {
    const r = ev.duracion / duracionRtve;
    // Un recorte puede ser más corto; nunca bastante más largo que el episodio.
    if (r > 1.15 || r < 0.4) return { hallazgo: null, motivo: `«${v.title}» dura ${Math.round(duracionRtve / 60)} min y la grabación ${Math.round(ev.duracion / 60)} min` };
  }
  const titulo = decodificar(v.title ?? '');
  const d: Partial<MetadatosDocumento> = { titulo, contenedor: programa, editorial: 'RTVE', tipoCSL: 'broadcast' };
  const fecha = fechaRtve(v.dateOfEmission);
  // La fecha de publicación en la web no es la de emisión: solo vale dateOfEmission.
  if (fecha) { d.fecha = fecha; d.anio = Number(fecha.slice(0, 4)); }
  if (v.htmlUrl) d.url = v.htmlUrl;
  d.autores = personasDelTitulo(titulo).map((x) => autorDe(x, 'es'));
  const descripcion = decodificar(v.description ?? '');
  // «Joaquín Soler Serrano entrevista al escritor…»: el entrevistador.
  const quien = /^([\p{Lu}][\p{L}]+(?:\s+[\p{Lu}][\p{L}]+){1,3})\s+entrevista\b/u.exec(descripcion)?.[1];
  if (quien) d.entrevistadores = [autorDe(quien, 'es')];
  const conDuracion = Boolean(duracionRtve && ev.duracion);
  return {
    hallazgo: { fuente: 'rtve', confianza: conDuracion ? 0.93 : 0.9, porCampo: { anio: 0.95, fecha: 0.95, autores: 0.9 }, datos: d, id: v.htmlUrl ?? `https://www.rtve.es/api/videos/${v.id}` },
    motivo: `«${titulo}»: ${mejor.p} frente a ${segundo?.p ?? 0}${conDuracion ? `, ${Math.round((duracionRtve as number) / 60)} min en el catálogo` : ''}`,
  };
}

export type { Autor };
