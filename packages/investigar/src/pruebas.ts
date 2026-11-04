/**
 * El cuaderno de pruebas de una investigación: cada prueba que una herramienta
 * pone delante del modelo recibe una marca («P7») y queda aquí con su evidencia
 * material. El modelo solo puede citar esas marcas; al redactar, una cita literal
 * delante de la marca estrecha el ancla a esas palabras (los caracteres en la
 * página, o los segundos exactos en un medio con instantes por palabra).
 *
 * Nada de lo que se cita sale del texto del modelo: el ancla viene siempre de la
 * biblioteca (unidad, fragmento, figura, ficha, tarjeta) o de lo que el modelo vio
 * en un tramo real del vídeo o en una página real.
 */
import type { Ancla, AnclaMaterial, Evidencia, SQL } from '@scholaris/nucleo';
import { anclaACita, anclarPasaje, enLista, ubicarPasaje } from '@scholaris/nucleo';
import type { CapaEvidencia, EvidenciaInvestigacion } from '@scholaris/contrato';
import { autorYAnio, contieneLiteral, type DocumentoBreve } from '@scholaris/busqueda';

/** El texto de donde sale una prueba (su unidad), para estrechar las citas. */
export interface Ambito {
  unidad: string;
  orden: number;
  texto: string;
  ancla: Ancla;
  palabras?: { v: number; t0: number; cs: number[] } | null;
}

export interface Prueba {
  /** «P7». */
  id: string;
  evidencia: Evidencia;
  capa: CapaEvidencia;
  herramienta: string;
  /** Lo que muestra, si la herramienta lo sabe (lo que se vio, de qué escena es). */
  nota?: string;
  ambito?: Ambito;
  /** Clave de la imagen de la unidad o de la figura (para el recorte). */
  imagen?: string;
}

/** Lo que se sabe de cada documento para citarlo. */
export interface FichaDocumento {
  id: string;
  titulo: string;
  /** «Paz», «Gutiérrez Alea y Tabío». */
  autor: string;
  /** «1991/1994». */
  anio: string;
  tipo: string;
  idioma?: string;
}

export function fichaDocumento(d: DocumentoBreve): FichaDocumento {
  const { autor, anio } = autorYAnio({ documento: d });
  return { id: d.id, titulo: d.metadatos.titulo, autor, anio, tipo: d.tipo, ...(d.metadatos.idioma ? { idioma: d.metadatos.idioma } : {}) };
}

export function etiquetaDe(a: Ancla, fin?: Ancla): string {
  return anclaACita(a, fin);
}

/** «(Paz, 1991/1994, p. 14)». */
export function citaCortaDe(doc: FichaDocumento | undefined, a: Ancla, fin?: Ancla): string {
  return doc ? `(${doc.autor}, ${doc.anio}, ${etiquetaDe(a, fin)})` : `(${etiquetaDe(a, fin)})`;
}

const claveDe = (e: Evidencia) => {
  const a = e.ancla as AnclaMaterial;
  const lugar = a.tipo === 'pagina' ? `p${a.fisica}` : a.tipo === 'tiempo' ? `t${Math.round(a.t0 * 10)}-${Math.round(a.t1 * 10)}` : JSON.stringify(a);
  const fino = `${a.caracteres?.join('-') ?? ''}|${a.region ? Object.values(a.region).map((x) => x.toFixed(2)).join(',') : ''}|${a.instante ?? ''}`;
  return `${e.documento}|${e.fragmento ?? e.figura ?? e.unidad ?? ''}|${lugar}|${fino}|${(e.cita ?? '').slice(0, 80)}`;
};

/** Posición en puntos de código (lo que cuenta `caracteres`) de un índice UTF-16. */
export function puntosDeCodigo(texto: string, i: number): number {
  return Array.from(texto.slice(0, i)).length;
}

/** El hablante de la marca «**Nombre:**» que precede a la posición `i` del texto de una unidad. */
export function hablanteEn(texto: string, i: number): string | undefined {
  let ultimo: string | undefined;
  for (const m of texto.slice(0, i).matchAll(/\*\*([^*\n]{1,60}?):\*\*/g)) ultimo = m[1]?.trim();
  return ultimo;
}

/**
 * Estrecha una prueba a una cita literal: busca las palabras en el texto de su
 * unidad y devuelve el ancla de esas palabras. En una página, los caracteres
 * [inicio, fin) en puntos de código; en un medio con instantes por palabra, sus
 * segundos (y su hablante). Null si la cita no está en el texto de la prueba.
 */
export function estrechar(p: Prueba, cita: string): { ancla: AnclaMaterial; anclaFin?: AnclaMaterial; cita: string } | null {
  const limpia = cita.replace(/^[«"“\s]+|[»"”\s]+$/g, '').trim();
  if (limpia.length < 3) return null;
  const amb = p.ambito;
  if (!amb) {
    // Sin el texto de la unidad (una observación de vídeo, una tarjeta): la cita tiene que estar en la prueba.
    return p.evidencia.cita && contieneLiteral(p.evidencia.cita, limpia) ? { ancla: p.evidencia.ancla, ...(p.evidencia.anclaFin ? { anclaFin: p.evidencia.anclaFin } : {}), cita: limpia } : null;
  }
  if (amb.ancla.tipo === 'tiempo') {
    const r = ubicarPasaje(amb.texto, limpia);
    if (!r) return null;
    const pasaje = anclarPasaje({ texto: limpia, desde: 0, hasta: limpia.length }, { ancla: amb.ancla }, [{ orden: amb.orden, ancla: amb.ancla, texto: amb.texto, palabras: amb.palabras ?? null }]);
    const base = (pasaje.ancla ?? amb.ancla) as AnclaMaterial;
    const hablante = hablanteEn(amb.texto, r[0]);
    const ancla: AnclaMaterial = base.tipo === 'tiempo' && hablante ? { ...base, hablante } : { ...base };
    ancla.caracteres = [puntosDeCodigo(amb.texto, r[0]), puntosDeCodigo(amb.texto, r[1])];
    return { ancla, cita: amb.texto.slice(r[0], r[1]).replace(/\*\*[^*\n]{1,60}?:\*\*\s*/g, '').trim() || limpia };
  }
  const r = ubicarPasaje(amb.texto, limpia);
  if (!r) return null;
  const ancla: AnclaMaterial = { ...(amb.ancla as AnclaMaterial), caracteres: [puntosDeCodigo(amb.texto, r[0]), puntosDeCodigo(amb.texto, r[1])] };
  // Una región ya medida (la de lo que se vio en la página) se conserva.
  const region = (p.evidencia.ancla as AnclaMaterial).region;
  if (region) ancla.region = region;
  return { ancla, cita: amb.texto.slice(r[0], r[1]).trim() };
}

export class CuadernoPruebas {
  private n = 0;
  private readonly porId = new Map<string, Prueba>();
  private readonly porClave = new Map<string, string>();

  /** Apunta una prueba; si ya estaba (mismo sitio y misma cita), devuelve su marca. */
  registrar(p: Omit<Prueba, 'id'>): { prueba: Prueba; nueva: boolean } {
    const clave = claveDe(p.evidencia);
    const ya = this.porClave.get(clave);
    if (ya) {
      const previa = this.porId.get(ya)!;
      if (!previa.nota && p.nota) previa.nota = p.nota;
      return { prueba: previa, nueva: false };
    }
    const prueba: Prueba = { ...p, id: `P${++this.n}` };
    this.porId.set(prueba.id, prueba);
    this.porClave.set(clave, prueba.id);
    return { prueba, nueva: true };
  }

  obtener(id: string): Prueba | undefined {
    return this.porId.get(id.toUpperCase());
  }

  todas(): Prueba[] {
    return [...this.porId.values()];
  }

  get tamano(): number {
    return this.porId.size;
  }
}

/** La prueba como la ve la interfaz. */
export function vistaPrueba(p: Prueba, doc: FichaDocumento | undefined, extra: { id?: string; imagenUrl?: string } = {}): EvidenciaInvestigacion {
  const e = p.evidencia;
  return {
    id: extra.id ?? p.id,
    documento: e.documento,
    titulo: doc?.titulo ?? '',
    ancla: e.ancla,
    ...(e.anclaFin ? { anclaFin: e.anclaFin } : {}),
    ...(e.cita ? { cita: e.cita } : {}),
    modo: e.modo,
    ...(e.unidad ? { unidad: e.unidad } : {}),
    ...(e.fragmento ? { fragmento: e.fragmento } : {}),
    ...(e.figura ? { figura: e.figura } : {}),
    capa: p.capa,
    herramienta: p.herramienta,
    etiqueta: etiquetaDe(e.ancla, e.anclaFin),
    citaCorta: citaCortaDe(doc, e.ancla, e.anclaFin),
    ...(doc?.idioma ? { idioma: doc.idioma } : {}),
    ...(p.ambito ? { orden: p.ambito.orden } : e.ancla.tipo === 'pagina' ? { orden: e.ancla.fisica - 1 } : {}),
    ...(extra.imagenUrl ? { imagenUrl: extra.imagenUrl } : {}),
    ...(p.nota ? { nota: p.nota } : {}),
    ...(extra.id && extra.id !== p.id ? { prueba: p.id } : {}),
  };
}

// ---------------------------------------------------------------------------
// Unidades (el ámbito de las pruebas)
// ---------------------------------------------------------------------------

interface FilaUnidad { id: string; documento: string; orden: number; ancla: string; texto: string; imagen: string | null; palabras: string | null }

export function filaAAmbito(f: FilaUnidad): Ambito & { documento: string; imagen: string | null } {
  let palabras: Ambito['palabras'] = null;
  if (f.palabras) { try { palabras = JSON.parse(f.palabras) as Ambito['palabras']; } catch { palabras = null; } }
  return { unidad: f.id, documento: f.documento, orden: Number(f.orden), texto: f.texto ?? '', ancla: JSON.parse(f.ancla) as Ancla, palabras, imagen: f.imagen };
}

const COLUMNAS_UNIDAD = 'id, documento, orden, ancla, texto, imagen, palabras';

/** Unidades por id (con su texto y sus instantes por palabra). */
export async function leerUnidades(sql: SQL, ids: readonly string[]): Promise<Map<string, ReturnType<typeof filaAAmbito>>> {
  const salida = new Map<string, ReturnType<typeof filaAAmbito>>();
  const unicos = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < unicos.length; i += 90) {
    const l = enLista(unicos.slice(i, i + 90));
    for (const f of await sql.ejecutar<FilaUnidad>(`SELECT ${COLUMNAS_UNIDAD} FROM unidades WHERE id IN ${l.sql}`, l.param)) salida.set(f.id, filaAAmbito(f));
  }
  return salida;
}

/** Unidades de un documento por tramo de orden, de páginas físicas o de tiempo. */
export async function unidadesDeTramo(sql: SQL, documento: string, t: { orden?: [number, number]; paginas?: [number, number]; tiempo?: [number, number] }, limite = 60): Promise<Array<ReturnType<typeof filaAAmbito>>> {
  let filas: FilaUnidad[];
  if (t.tiempo) {
    filas = await sql.ejecutar<FilaUnidad>(`SELECT ${COLUMNAS_UNIDAD} FROM unidades WHERE documento = ? AND t1 > ? AND t0 < ? ORDER BY orden LIMIT ?`, documento, t.tiempo[0], t.tiempo[1], limite);
  } else if (t.paginas) {
    filas = await sql.ejecutar<FilaUnidad>(
      `SELECT ${COLUMNAS_UNIDAD} FROM unidades WHERE documento = ? AND json_extract(ancla, '$.fisica') BETWEEN ? AND ? ORDER BY orden LIMIT ?`,
      documento, t.paginas[0], t.paginas[1], limite,
    );
    // Documentos sin páginas físicas (EPUB, diapositivas): el número es el orden + 1.
    if (!filas.length) filas = await sql.ejecutar<FilaUnidad>(`SELECT ${COLUMNAS_UNIDAD} FROM unidades WHERE documento = ? AND orden BETWEEN ? AND ? ORDER BY orden LIMIT ?`, documento, t.paginas[0] - 1, t.paginas[1] - 1, limite);
  } else {
    const [a, b] = t.orden ?? [0, limite - 1];
    filas = await sql.ejecutar<FilaUnidad>(`SELECT ${COLUMNAS_UNIDAD} FROM unidades WHERE documento = ? AND orden BETWEEN ? AND ? ORDER BY orden LIMIT ?`, documento, a, b, limite);
  }
  return filas.map(filaAAmbito);
}
