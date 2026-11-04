/**
 * La memoria de una investigación (un cuaderno) como anotaciones SPDF: un fichero
 * `.spdfa.json` con una `AnnotationCollection` del modelo W3C Web Annotation (SPDF 5.0
 * §17.1). Cada tarjeta verificada es una anotación cuyo destino lleva la URI de ancla
 * (`SpdfAnchorSelector`, con la precisión material de la prueba: caracteres, región,
 * instante) y la cita literal (`TextQuoteSelector`), para que sobreviva a una relectura
 * que mueva los desplazamientos. En vídeo y audio va además un `FragmentSelector` de
 * Media Fragments, para las herramientas que no conocen SPDF.
 *
 * Las notas (hallazgos, hipótesis) y las síntesis no tienen un único sitio: apuntan a las
 * pruebas que citan, así que su `target` es una lista (lo admite el modelo W3C; el perfil
 * `understanding` propuesto para SPDF 5.1 lo hace explícito).
 */
import type { AnclaMaterial, SQL } from '@scholaris/nucleo';
import { enLista } from '@scholaris/nucleo';
import { obtenerCuaderno } from '@scholaris/funciones';
import { formatAnchorUri } from 'spdf-format/core';
import { anclaA50 } from './comprension-spdf.js';

const CONTEXTO = 'http://www.w3.org/ns/anno.jsonld';
/** Identificadores de las anotaciones: URI «tag» (RFC 4151), que no hace falta registrar. */
const TAG = 'tag:scholaris.joseluissaorin.com,2026';
const HEX64 = /^[0-9a-f]{64}$/;

export interface DestinoSpdf {
  source: string;
  selector: Array<Record<string, unknown>>;
}

export interface AnotacionW3C {
  id: string;
  type: 'Annotation';
  motivation: string;
  created?: string;
  modified?: string;
  body?: Array<Record<string, unknown>>;
  target: DestinoSpdf | DestinoSpdf[];
}

export interface ColeccionAnotaciones {
  '@context': string;
  id: string;
  type: 'AnnotationCollection';
  spdf_annotations: '1.0';
  label: string;
  created: string;
  modified: string;
  total: number;
  first: { type: 'AnnotationPage'; items: AnotacionW3C[] };
}

interface FilaTarjeta {
  id: string; tipo: string; documento: string | null; ancla: string | null; ancla_fin: string | null; pasaje: string | null;
  cita: string | null; contenido: string; afirmacion: string | null; estado: string; creada: string; actualizada: string;
}

const deJson = <T>(v: unknown, defecto: T): T => {
  if (v === null || v === undefined || v === '') return defecto;
  try { return JSON.parse(String(v)) as T; } catch { return defecto; }
};
const cadena = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Un cuerpo de texto (W3C `TextualBody`). */
function cuerpo(value: string, purpose: string, format = 'text/plain'): Record<string, unknown> {
  return { type: 'TextualBody', value, format, purpose };
}

/** `TextQuoteSelector` con la cita exacta y su contexto (32 caracteres a cada lado) dentro del pasaje verificado. */
function selectorCita(pasaje: string, cita?: string): Record<string, unknown> | null {
  const p = pasaje.normalize('NFC');
  const c = (cita ?? '').normalize('NFC');
  const i = c ? p.indexOf(c) : -1;
  if (i < 0) return p ? { type: 'TextQuoteSelector', exact: p } : null;
  const antes = [...p.slice(0, i)].slice(-32).join('');
  const despues = [...p.slice(i + c.length)].slice(0, 32).join('');
  return { type: 'TextQuoteSelector', exact: c, prefix: antes, suffix: despues };
}

/** Lo que entiende cualquier lector de Media Fragments: el tiempo y la región de la URI de ancla. */
function selectorMedia(uri: string): Record<string, unknown> | null {
  const fragmento = uri.split('#')[1];
  if (!fragmento) return null;
  const partes = fragmento.split('&').filter((p) => p.startsWith('t=') || p.startsWith('xywh='));
  if (!partes.some((p) => p.startsWith('t='))) return null;
  return { type: 'FragmentSelector', conformsTo: 'http://www.w3.org/TR/media-frags/', value: partes.join('&') };
}

/**
 * Las anotaciones de un cuaderno. Las tarjetas que ya no se pueden resolver (huérfanas)
 * se quedan fuera; las notas sin pruebas apuntan al documento entero de las obras del
 * cuaderno, y si el cuaderno no tiene ninguna obra no se exportan.
 */
export async function cuadernoComoAnotaciones(sql: SQL, cuadernoId: string): Promise<ColeccionAnotaciones> {
  const cuaderno = await obtenerCuaderno(sql, cuadernoId);
  const tarjetas = await sql.ejecutar<FilaTarjeta>(
    'SELECT id, tipo, documento, ancla, ancla_fin, pasaje, cita, contenido, afirmacion, estado, creada, actualizada FROM cuadernos_tarjetas WHERE cuaderno = ? ORDER BY posicion, creada',
    cuadernoId,
  );
  const ids = [...new Set(tarjetas.map((t) => t.documento).filter((x): x is string => !!x))];
  const docref = new Map<string, string>();
  if (ids.length) {
    const l = enLista(ids);
    for (const f of await sql.ejecutar<{ id: string; huella: string | null }>(`SELECT id, huella FROM documentos WHERE id IN ${l.sql}`, l.param)) {
      const h = String(f.huella ?? '').trim().toLowerCase();
      docref.set(String(f.id), HEX64.test(h) ? `sha256-${h}` : String(f.id));
    }
  }
  const documentoEntero = (id: string): DestinoSpdf => {
    const uri = formatAnchorUri(docref.get(id) ?? id, {});
    return { source: uri, selector: [{ type: 'SpdfAnchorSelector', value: uri }] };
  };

  const items: AnotacionW3C[] = [];
  const destinoDe = new Map<string, DestinoSpdf>();
  const porEvidencia = new Map<string, string>();
  const notas: FilaTarjeta[] = [];
  for (const t of tarjetas) {
    const contenido = deJson<Record<string, unknown>>(t.contenido, {});
    const ev = contenido.evidencia as { id?: string; documento?: string; ancla?: AnclaMaterial; anclaFin?: AnclaMaterial; cita?: string; modo?: string } | undefined;
    if (typeof ev?.id === 'string') porEvidencia.set(ev.id, t.id);
    if (t.tipo === 'nota' || t.tipo === 'sintesis' || !t.documento || !docref.has(t.documento) || t.estado === 'huerfana') {
      if (t.tipo === 'nota') notas.push(t);
      continue;
    }
    // La prueba con su precisión material (caracteres, región, instante) si la guardó Investigar; si no, el ancla verificada.
    const material = ev && ev.documento === t.documento && ev.ancla ? ev : null;
    const ancla = material?.ancla ?? deJson<AnclaMaterial | null>(t.ancla, null);
    if (!ancla) continue;
    const fin = material ? material.anclaFin ?? null : deJson<AnclaMaterial | null>(t.ancla_fin, null);
    const ref = docref.get(t.documento)!;
    const uri = formatAnchorUri(ref, anclaA50(ancla), fin ? anclaA50(fin) : null);
    const selector: Array<Record<string, unknown>> = [{ type: 'SpdfAnchorSelector', value: uri }];
    const cita = t.pasaje ? selectorCita(t.pasaje, material?.modo === 'texto' ? material.cita : undefined) : null;
    if (cita) selector.push(cita);
    const media = selectorMedia(uri);
    if (media) selector.push(media);
    const destino: DestinoSpdf = { source: `spdf:${ref}`, selector };
    destinoDe.set(t.id, destino);
    const cuerpos: Array<Record<string, unknown>> = [];
    const afirmacion = cadena(t.afirmacion) || cadena(contenido.frase);
    if (afirmacion) cuerpos.push(cuerpo(afirmacion, 'commenting'));
    const comentario = cadena(contenido.comentario) || cadena(contenido.texto);
    if (comentario && comentario !== afirmacion) cuerpos.push(cuerpo(comentario, 'commenting'));
    if (material && material.modo !== 'texto' && cadena(material.cita)) cuerpos.push(cuerpo(cadena(material.cita), 'describing'));
    if (t.cita) cuerpos.push(cuerpo(t.cita, 'identifying'));
    items.push({
      id: `${TAG}:tarjeta/${t.id}`, type: 'Annotation', motivation: afirmacion || comentario ? 'commenting' : 'highlighting',
      created: t.creada, modified: t.actualizada, ...(cuerpos.length ? { body: cuerpos } : {}), target: destino,
    });
  }

  const todas = ids.filter((id) => docref.has(id)).map(documentoEntero);
  const uno = (ds: DestinoSpdf[]): DestinoSpdf | DestinoSpdf[] => (ds.length === 1 ? ds[0]! : ds);
  for (const t of notas) {
    const contenido = deJson<Record<string, unknown>>(t.contenido, {});
    const valor = cadena(contenido.texto) || cadena(contenido.comentario) || cadena(contenido.afirmacion);
    if (!valor) continue;
    const pruebas = (Array.isArray(contenido.pruebas) ? contenido.pruebas : []).map((p) => destinoDe.get(porEvidencia.get(String(p)) ?? '')).filter((d): d is DestinoSpdf => !!d);
    const destinos = pruebas.length ? pruebas : todas;
    if (!destinos.length) continue;
    const clase = cadena(contenido.clase);
    items.push({
      id: `${TAG}:tarjeta/${t.id}`, type: 'Annotation', motivation: clase === 'hipotesis' || clase === 'pendiente' ? 'questioning' : 'commenting',
      created: t.creada, modified: t.actualizada, body: [cuerpo(valor, 'commenting')], target: uno(destinos),
    });
  }

  const sintesis = await sql.ejecutar<{ id: string; peticion: string; cuerpo: string; fuentes: string; creada: string }>(
    'SELECT id, peticion, cuerpo, fuentes, creada FROM cuadernos_sintesis WHERE cuaderno = ? ORDER BY creada', cuadernoId,
  );
  for (const s of sintesis) {
    const fuentes = deJson<Array<{ tarjeta?: string }>>(s.fuentes, []);
    const citadas = fuentes.map((f) => destinoDe.get(String(f.tarjeta ?? ''))).filter((d): d is DestinoSpdf => !!d);
    const destinos = citadas.length ? citadas : todas;
    if (!destinos.length || !s.cuerpo.trim()) continue;
    items.push({
      id: `${TAG}:sintesis/${s.id}`, type: 'Annotation', motivation: 'describing', created: s.creada,
      body: [cuerpo(s.cuerpo, 'describing', 'text/markdown'), ...(s.peticion.trim() ? [cuerpo(s.peticion.trim(), 'questioning')] : [])],
      target: uno(destinos),
    });
  }

  return {
    '@context': CONTEXTO, id: `${TAG}:cuaderno/${cuaderno.id}`, type: 'AnnotationCollection', spdf_annotations: '1.0',
    label: cuaderno.titulo, created: cuaderno.creado, modified: cuaderno.actualizado, total: items.length,
    first: { type: 'AnnotationPage', items },
  };
}
