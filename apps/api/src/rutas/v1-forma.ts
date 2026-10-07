/**
 * La forma de la API v1: de las vistas de la v2 a los objetos cortos de la v1,
 * los enlaces al lector y el Markdown que leen los agentes. Sin lógica de
 * dominio: las citas y los localizadores salen siempre del ancla guardada.
 */
import { anclaACita, limpiarMarcadoOCR, repararMarcasHablante, type Ancla, type Autor, type MetadatosDocumento, type Pasaje } from '@scholaris/nucleo';
import type {
  CitaV1, DetalleDocumento, DocumentoV1, EstadoV1, FuenteV1, PasajeV1, ResultadoVista, ResumenDocumento, RespuestaBuscarV1,
  RespuestaCitarV1, RespuestaPreguntarV1, RespuestaVerificarV1, TextoV1,
} from '@scholaris/contrato';
import { PREFIJO_V1 } from '@scholaris/contrato';

export const localizador = (a: Ancla, fin?: Ancla): string => {
  try { return anclaACita(a, fin); } catch { return ''; }
};

/** «Apellidos, Nombre». */
export const autorV1 = (a: Autor): string => (a.apellidos ? (a.nombre ? `${a.apellidos}, ${a.nombre}` : a.apellidos) : a.nombre);

/** «Cortázar, Julio; Borges, Jorge Luis» → autores del contrato. */
export function autoresDeTexto(t: string | string[] | undefined): Autor[] | undefined {
  if (t === undefined) return undefined;
  const lista = (Array.isArray(t) ? t : t.split(';')).map((x) => x.trim()).filter(Boolean);
  return lista.map((x) => {
    const [ap, ...resto] = x.split(',');
    return resto.length ? { apellidos: ap!.trim(), nombre: resto.join(',').trim() } : { apellidos: x, nombre: '' };
  });
}

/** Parámetros del lector para abrir un ancla (como `anclaABusqueda` de la web); con `rango`, el pasaje [desde, hasta) del fragmento, subrayado. */
export function enlaceLector(origen: string, documento: string, a?: Ancla, fragmento?: string, rango?: [number, number]): string {
  const q = new URLSearchParams();
  if (a) {
    switch (a.tipo) {
      case 'pagina': q.set('u', String(a.fisica)); break;
      case 'tiempo': q.set('t', String(Math.floor(a.t0 * 10) / 10)); break;
      case 'diapositiva': q.set('u', String(a.n)); break;
      case 'seccion': case 'web': q.set('sec', a.ruta.at(-1) ?? ''); q.set('par', String(a.parrafo)); break;
      case 'hoja': q.set('u', String(Math.floor((a.filaDesde - 1) / 50) + 1)); break;
      default: break;
    }
  }
  if (fragmento) q.set('f', fragmento);
  if (fragmento && rango && rango[1] > rango[0]) { q.set('pd', String(rango[0])); q.set('ph', String(rango[1])); }
  const s = q.toString();
  return `${origen}/lector/${encodeURIComponent(documento)}${s ? `?${s}` : ''}`;
}

export function estadoV1(e: string, tareaActiva?: boolean): EstadoV1 {
  if (e === 'listo') return 'listo';
  if (e === 'error') return 'error';
  if (e === 'pendiente') return tareaActiva ? 'procesando' : 'en_cola';
  return 'procesando';
}

const rutaDoc = (origen: string, id: string) => `${origen}${PREFIJO_V1}/documentos/${encodeURIComponent(id)}`;

export function documentoDeDetalle(origen: string, d: DetalleDocumento, extra: { progreso?: number; fase?: string; referencia?: string } = {}): DocumentoV1 {
  const m = d.metadatos;
  const v: DocumentoV1 = {
    id: d.id, titulo: m.titulo, autores: (m.autores ?? []).map(autorV1), tipo: d.tipo, estado: estadoV1(d.estado, !!d.tarea),
    unidades: d.unidades, creado: d.creado, enlace: enlaceLector(origen, d.id), texto_url: `${rutaDoc(origen, d.id)}/texto`,
  };
  if (m.anio ?? m.anioOriginal) v.anio = (m.anio ?? m.anioOriginal)!;
  if (d.duracion) v.duracion = d.duracion;
  if (m.idioma) v.idioma = m.idioma;
  if (m.url) v.url = m.url;
  if (extra.referencia) v.referencia = extra.referencia;
  if (v.estado !== 'listo' && v.estado !== 'error') {
    v.progreso_url = rutaDoc(origen, d.id);
    if (extra.progreso !== undefined) v.progreso = Math.round(extra.progreso * 1000) / 1000;
    if (extra.fase) v.fase = extra.fase;
  }
  if (d.error) v.error = d.error;
  return v;
}

export function documentoDeResumen(origen: string, r: ResumenDocumento): DocumentoV1 {
  const v: DocumentoV1 = {
    id: r.id, titulo: r.titulo, autores: r.autores ? r.autores.split(';').map((x) => x.trim()).filter(Boolean) : [], tipo: r.tipo,
    estado: estadoV1(r.estado, !!r.tarea), unidades: r.unidades, creado: r.creado, enlace: enlaceLector(origen, r.id), texto_url: `${rutaDoc(origen, r.id)}/texto`,
  };
  if (r.anio) v.anio = r.anio;
  if (r.duracion) v.duracion = r.duracion;
  if (r.idioma) v.idioma = r.idioma;
  if (v.estado !== 'listo' && v.estado !== 'error') v.progreso_url = rutaDoc(origen, r.id);
  return v;
}

export function docBreve(id: string, m: Pick<MetadatosDocumento, 'titulo' | 'autores' | 'anio'> & Partial<Pick<MetadatosDocumento, 'anioOriginal'>>): PasajeV1['documento'] {
  const anio = m.anio ?? m.anioOriginal;
  return { id, titulo: m.titulo, autores: (m.autores ?? []).map(autorV1), ...(anio ? { anio } : {}) };
}

/**
 * Un resultado en la forma de la v1. `pasaje` (lo que se cita) son las oraciones
 * relevantes del fragmento; `cita`, `localizador`, `ancla` y `enlace` son los suyos.
 * `pasaje` puede venir de fuera (la frase de una respuesta que lleva la nota).
 */
export function pasajeDeVista(origen: string, r: ResultadoVista, pasaje: Pasaje | undefined = r.pasaje): PasajeV1 {
  const f = r.fragmento;
  const ancla = pasaje?.ancla ?? f.ancla;
  const fin = pasaje?.ancla ? pasaje.anclaFin : f.anclaFin;
  const texto = pasaje?.texto || repararMarcasHablante(limpiarMarcadoOCR(f.texto)).trim();
  const rango: [number, number] | undefined = pasaje?.texto ? [pasaje.desde, pasaje.hasta] : undefined;
  return {
    id: f.id, documento: docBreve(r.documento.id, r.documento.metadatos), texto: f.texto, pasaje: texto, ...(rango ? { pasaje_rango: rango } : {}),
    cita: r.citaCorta, localizador: r.etiqueta || localizador(ancla, fin), ancla, enlace: enlaceLector(origen, r.documento.id, ancla, f.id, rango),
    puntuacion: Math.round(r.puntuacion * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const cita = (t: string) => repararMarcasHablante(limpiarMarcadoOCR(t)).split('\n').map((l) => `> ${l}`).join('\n');
const autoria = (d: { autores: string[]; anio?: number }) => [d.autores.join('; ') || 's. a.', d.anio ?? 's. f.'].join(', ');

export function mdDocumento(d: DocumentoV1): string {
  const filas: Array<[string, string | number | undefined]> = [
    ['id', `\`${d.id}\``], ['autores', d.autores.join('; ') || undefined], ['año', d.anio], ['tipo', d.tipo],
    ['estado', d.estado + (d.progreso !== undefined ? ` (${Math.round(d.progreso * 100)} %)` : '')], ['unidades', d.unidades],
    ['duración', d.duracion ? `${Math.round(d.duracion)} s` : undefined], ['referencia', d.referencia], ['error', d.error],
    ['lector', d.enlace], ['texto', d.texto_url],
  ];
  return `# ${d.titulo}\n\n${filas.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `- **${k}**: ${v}`).join('\n')}\n`;
}

export function mdDocumentos(ds: DocumentoV1[], total: number, siguiente?: string): string {
  const lineas = ds.map((d) => `- \`${d.id}\` **${d.titulo}**${d.autores.length ? `, ${d.autores.join('; ')}` : ''}${d.anio ? ` (${d.anio})` : ''} · ${d.tipo} · ${d.estado}`);
  return `# Documentos (${total})\n\n${lineas.join('\n') || 'La biblioteca está vacía.'}\n${siguiente ? `\nSiguiente página: \`cursor=${siguiente}\`\n` : ''}`;
}

export function mdPasajes(r: RespuestaBuscarV1): string {
  if (!r.pasajes.length) return `# ${r.consulta}\n\nSin resultados.\n`;
  const bloques = r.pasajes.map((p, i) => `## ${i + 1}. ${p.cita}\n\n*${p.documento.titulo}* · ${p.localizador} · [abrir](${p.enlace}) · \`${p.id}\`\n\n${cita(p.pasaje || p.texto)}`);
  return `# ${r.consulta}\n\n${bloques.join('\n\n')}\n`;
}

export function mdRespuesta(r: RespuestaPreguntarV1): string {
  const fuentes = r.fuentes.map((f) => `- [^${f.n}] ${f.cita}: *${f.documento.titulo}*, ${f.localizador}. [abrir](${f.enlace})`);
  return `${r.respuesta}\n\n---\n\nFuentes (confianza ${r.confianza}):\n\n${fuentes.join('\n') || '- Ninguna.'}\n`;
}

export function mdCitar(r: RespuestaCitarV1): string {
  if (r.estado !== 'listo') return `Estado: ${r.estado}${r.error ? `. ${r.error}` : ''}\n${r.progreso_url ? `\nConsulta el avance en ${r.progreso_url}\n` : ''}`;
  const biblio = (r.bibliografia ?? []).map((b) => `- ${b}`).join('\n');
  return `${r.texto ?? ''}\n\n## Referencias\n\n${biblio || '- Sin referencias: ningún pasaje respaldaba el texto con suficiente seguridad.'}\n`;
}

export function mdVerificar(r: RespuestaVerificarV1): string {
  const ps = r.pasajes.map((p) => `## ${p.cita} · ${p.relacion} · respaldo ${p.respaldo.toFixed(2)}\n\n*${p.documento.titulo}* · [abrir](${p.enlace})\n\n${cita(p.texto)}`);
  return `# ${r.afirmacion}\n\n**Veredicto**: ${r.veredicto} (probabilidad ${r.probabilidad.toFixed(2)})\n\n${ps.join('\n\n')}\n`;
}

export function mdTexto(t: TextoV1): string {
  const d = t.documento;
  const partes = t.unidades.map((u) => `## ${u.localizador || `[${u.posicion}]`}\n\n${u.texto.trim()}`);
  return `# ${d.titulo}\n\n*${autoria(d)}*\n\n${partes.join('\n\n')}\n${t.siguiente ? `\n---\n\nSigue en \`desde=${t.siguiente}\`\n` : ''}`;
}

export function citaDePropuesta(origen: string, p: { afirmacion: string; textoCita: string; cita: { documento: string; fragmento: string; ancla: Ancla; anclaFin?: Ancla; pasaje: string; respaldo: number } }): CitaV1 {
  return {
    afirmacion: p.afirmacion, cita: p.textoCita, localizador: localizador(p.cita.ancla, p.cita.anclaFin), documento: p.cita.documento,
    fragmento: p.cita.fragmento, pasaje: p.cita.pasaje, respaldo: p.cita.respaldo, enlace: enlaceLector(origen, p.cita.documento, p.cita.ancla, p.cita.fragmento),
  };
}

export type { FuenteV1 };
