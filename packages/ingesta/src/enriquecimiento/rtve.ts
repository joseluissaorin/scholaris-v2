/**
 * Catálogo de RTVE Play: el episodio concreto de un programa, con su título
 * de catálogo («Julio Cortázar»), la fecha de emisión y su dirección.
 *
 * API pública sin clave: el identificador del programa sale de su página
 * (`/play/videos/<programa>/`) y los vídeos de `/api/programas/<id>/videos.json`.
 */

import type { Autor, MetadatosDocumento } from '@scholaris/nucleo';
import { normalizar, similitud } from '../texto.js';
import { autorDe, claveAutor } from '../pasos/metadatos/nombres.js';
import type { Hallazgo } from './fuentes.js';
import type { Consultor } from './red.js';

interface VideoRtve { id?: string; title?: string; dateOfEmission?: string; publicationDate?: string; htmlUrl?: string; description?: string }

const decodificar = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&([a-z])acute;/gi, (_m, l: string) => ({ a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' } as Record<string, string>)[l] ?? l)
  .replace(/&ntilde;/g, 'ñ').replace(/&Ntilde;/g, 'Ñ').replace(/&uuml;/g, 'ü').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

export const slugRtve = (s: string) => normalizar(s).replace(/\s+/g, '-');

/** «20-03-1977 00:00:00» → «1977-03-20». */
export function fechaRtve(s: string | undefined): string | undefined {
  const m = s ? /^(\d{2})-(\d{2})-(\d{4})/.exec(s) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

/**
 * Busca el episodio de `programa` cuyo título casa con alguno de los
 * invitados (o con el título leído). Recorre como mucho 10 páginas de 60.
 */
export async function rtveEpisodio(programa: string, invitados: Autor[], tituloLeido: string | undefined, red: Consultor): Promise<Hallazgo | null> {
  const pagina = await red.texto(`https://www.rtve.es/play/videos/${slugRtve(programa)}/`);
  const id = pagina ? /api\/programas\/(\d+)/.exec(pagina)?.[1] : undefined;
  if (!id) return null;
  const nombres = invitados.map((a) => normalizar(`${a.nombre} ${a.apellidos}`)).filter(Boolean);
  const claves = new Set(invitados.map((a) => claveAutor(a).split('|')[0]));
  let mejor: { v: VideoRtve; p: number } | null = null;
  for (let n = 1; n <= 10; n++) {
    const j = await red.json<{ page?: { items?: VideoRtve[]; totalPages?: number } }>(`https://www.rtve.es/api/programas/${id}/videos.json?size=60&page=${n}`);
    for (const v of j?.page?.items ?? []) {
      const t = normalizar(v.title ?? '');
      if (!t) continue;
      let p = Math.max(0, ...nombres.map((x) => similitud(x, t)));
      // «Leopoldo Torre Nilsson y Fernando Díaz Plaja»: basta con que esté el apellido de un invitado.
      if (p < 0.85 && [...claves].some((k) => k && t.split(' ').includes(k))) p = Math.max(p, 0.86);
      if (tituloLeido && normalizar(tituloLeido) !== normalizar(programa)) p = Math.max(p, similitud(tituloLeido, v.title ?? ''));
      if (p >= 0.85 && (!mejor || p > mejor.p)) mejor = { v, p };
    }
    if (n >= (j?.page?.totalPages ?? 0)) break;
  }
  if (!mejor) return null;
  const v = mejor.v;
  const d: Partial<MetadatosDocumento> = { titulo: decodificar(v.title ?? ''), contenedor: programa, editorial: 'RTVE', tipoCSL: 'broadcast' };
  const fecha = fechaRtve(v.dateOfEmission);
  // La fecha de publicación en la web no es la de emisión: solo vale dateOfEmission.
  if (fecha) { d.fecha = fecha; d.anio = Number(fecha.slice(0, 4)); }
  if (v.htmlUrl) d.url = v.htmlUrl;
  const descripcion = decodificar(v.description ?? '');
  // «Joaquín Soler Serrano entrevista al escritor…»: el entrevistador.
  const quien = /^([\p{Lu}][\p{L}]+(?:\s+[\p{Lu}][\p{L}]+){1,3})\s+entrevista\b/u.exec(descripcion)?.[1];
  if (quien) d.entrevistadores = [autorDe(quien, 'es')];
  return { fuente: 'rtve', confianza: 0.92, porCampo: { anio: 0.95, fecha: 0.95 }, datos: d, id: v.htmlUrl ?? `https://www.rtve.es/api/videos/${v.id}` };
}
