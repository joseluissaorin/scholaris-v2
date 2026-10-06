/** Formatos que se repiten en todas las pantallas. Todo en español de España. */
import { anclaACita, tiempoACadena, type Ancla, type MetadatosDocumento, type TipoEntrada } from '@scholaris/nucleo';
import type { NombreIcono } from '@scholaris/ui';
import { numero } from './numero';

export const NOMBRE_TIPO: Record<TipoEntrada, string> = {
  pdf: 'PDF', pdf_escaneado: 'Escaneado', fotos: 'Fotos de libro', imagen: 'Imagen', audio: 'Audio', video: 'Vídeo',
  documento: 'Documento', epub: 'EPUB', presentacion: 'Presentación', hoja: 'Hoja', web: 'Web',
};

export const ICONO_TIPO: Record<TipoEntrada, NombreIcono> = {
  pdf: 'documento', pdf_escaneado: 'documento', fotos: 'camara', imagen: 'imagen', audio: 'audio', video: 'video',
  documento: 'documento', epub: 'lector', presentacion: 'diapositiva', hoja: 'hoja', web: 'web',
};

/** Qué es una «unidad» en cada tipo, en singular y plural. */
export function nombreUnidad(tipo: TipoEntrada, n: number): string {
  const [s, p] = tipo === 'audio' || tipo === 'video' ? ['tramo', 'tramos']
    : tipo === 'presentacion' ? ['diapositiva', 'diapositivas']
    : tipo === 'hoja' ? ['tramo', 'tramos']
    : tipo === 'epub' || tipo === 'documento' || tipo === 'web' ? ['sección', 'secciones']
    : tipo === 'fotos' ? ['foto', 'fotos']
    : ['página', 'páginas'];
  return `${numero(n)} ${n === 1 ? s : p}`;
}

export const esMedio = (t: TipoEntrada) => t === 'audio' || t === 'video';
export const esPaginado = (t: TipoEntrada) => t === 'pdf' || t === 'pdf_escaneado' || t === 'fotos' || t === 'imagen';

export function duracion(seg: number): string {
  const h = Math.floor(seg / 3600), m = Math.round((seg % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export { tiempoACadena, anclaACita };

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${numero(v, { maximumFractionDigits: v < 10 ? 1 : 0 })} ${u[i]}`;
}

const relativo = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
export function haceCuanto(iso: string): string {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 45) return 'ahora mismo';
  if (a < 3600) return relativo.format(Math.round(s / 60), 'minute');
  if (a < 86400) return relativo.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 30) return relativo.format(Math.round(s / 86400), 'day');
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function autores(m: Pick<MetadatosDocumento, 'autores'>): string {
  const n = m.autores.map((a) => `${a.nombre} ${a.apellidos}`.trim());
  if (n.length <= 2) return n.join(' y ');
  return `${n.slice(0, -1).join(', ')} y ${n.at(-1)}`;
}

export function autoresCorto(m: Pick<MetadatosDocumento, 'autores'>): string {
  const ap = m.autores.map((a) => a.apellidos || a.nombre);
  if (!ap.length) return 'Anónimo';
  return ap.length > 2 ? `${ap[0]} et al.` : ap.join(' y ');
}

export function anioCita(m: Pick<MetadatosDocumento, 'anio' | 'anioOriginal'>): string {
  if (m.anioOriginal && m.anio && m.anioOriginal !== m.anio) return `${m.anioOriginal}/${m.anio}`;
  return m.anio ? String(m.anio) : 's. f.';
}

/** Estilos que la web sabe imprimir en el acto (la API hace el resto con CSL). */
export const ESTILOS_RAPIDOS = [
  { id: 'apa', nombre: 'APA 7' },
  { id: 'chicago-author-date', nombre: 'Chicago autor-fecha' },
  { id: 'chicago-note-bibliography', nombre: 'Chicago notas' },
  { id: 'modern-language-association', nombre: 'MLA 9' },
  { id: 'iso690-author-date-es', nombre: 'UNE-ISO 690' },
] as const;

/** Cita en el texto para un ancla, en el estilo elegido. */
export function citaEnTexto(m: MetadatosDocumento, ancla: Ancla, estilo: string, fin?: Ancla): string {
  const loc = anclaACita(ancla, fin);
  const quien = autoresCorto(m);
  switch (estilo) {
    case 'modern-language-association': return `(${quien} ${loc.replace(/^pp?\. /, '')})`;
    case 'chicago-author-date': return `(${quien} ${anioCita(m)}, ${loc.replace(/^pp?\. /, '')})`;
    case 'chicago-note-bibliography': return `${autores(m)}, ${m.titulo} (${[m.lugar, m.editorial].filter(Boolean).join(': ')}${m.anio ? `, ${m.anio}` : ''}), ${loc.replace(/^pp?\. /, '')}.`;
    case 'iso690-author-date-es': return `(${quien.toUpperCase()}, ${anioCita(m)}, ${loc})`;
    default: return `(${quien}, ${anioCita(m)}, ${loc})`;
  }
}

/** Etiqueta del lugar exacto, más rica que la cita: «p. 145 · física 153». */
export function etiquetaLarga(a: Ancla): string {
  if (a.tipo === 'pagina') return a.impresa ? `p. ${a.impresa}` : `pág. física ${a.fisica}`;
  if (a.tipo === 'tiempo') return `${tiempoACadena(a.t0)}${a.hablante ? ` · ${a.hablante}` : ''}`;
  return anclaACita(a);
}

/** Etiqueta corta para columnas estrechas: «p. 145», «12:04», «párr. 3». */
export function etiquetaCorta(a: Ancla, etiqueta: string): string {
  if ((a.tipo === 'seccion' && !a.impresa) || a.tipo === 'web') return `párr. ${a.parrafo}`;
  if (a.tipo === 'hoja') return `filas ${a.filaDesde}-${a.filaHasta}`;
  return etiqueta;
}
