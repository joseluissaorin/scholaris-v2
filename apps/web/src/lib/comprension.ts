/**
 * La comprensión en la interfaz, sin React: los nombres de cada cosa en buen
 * castellano, el árbol de la estructura, el avance del flujo, las entidades de
 * un documento agrupadas, el découpage de una película (secuencias, escenas,
 * planos y sonido) con quién está en cuadro en cada instante, los recortes de
 * una región y las cuentas de las alineaciones entre dos obras.
 *
 * Todo se prueba sin navegador (lib/comprension.test.ts).
 */
import { anclaACita, tiempoACadena } from '@scholaris/nucleo';
import type {
  Alineacion, AnclaMaterial, Ficha, LadoAlineacion, Lente, Region, Relacion, RolAparicion, Segmento, TipoCorrespondencia, TipoEntrada, TipoRelacion, TipoSegmento,
} from '@scholaris/nucleo';
import type { AparicionVista, EstadoComprensionValorVista, EstadoComprensionVista } from '@scholaris/contrato';

// ---------------------------------------------------------------------------
// Relaciones entre obras (el contrato de transmedia, ola 2)
// ---------------------------------------------------------------------------

/** La otra obra de una relación, lo justo para nombrarla. */
export interface ObraRelacionada {
  id: string;
  titulo: string;
  /** Nombres para mostrar. */
  autores: string[];
  anio?: number;
  tipo: TipoEntrada;
}

/** Cómo va la alineación de una relación (el Workflow de transmedia). */
export interface EstadoAlineacionVista {
  estado: 'en_marcha' | 'hecho' | 'error';
  alineaciones: number;
  usd: number;
  avisos: string[];
  error?: string;
  actualizado: string;
}

/**
 * GET /documentos/:id/relaciones → RelacionVista[]. Copia del tipo de
 * `@scholaris/contrato` (transmedia.ts, ola 2); al integrar, se importa de allí.
 */
export type RelacionVista = Relacion & {
  otro: ObraRelacionada;
  /** El lado del documento que se pide: `origen` adapta, traduce o edita a `destino`. */
  sentido: 'origen' | 'destino';
  alineaciones: number;
  /** La ficha de la relación (objetivo «relacion»). */
  ficha?: Ficha;
  /** La puso o la confirmó el usuario. */
  confirmada: boolean;
  estadoAlineacion?: EstadoAlineacionVista;
};

/** Un cambio de la ficha de una relación: qué cambia de B (destino) a A (origen), con sus pruebas (índices en `ficha.evidencias`). */
export interface CambioRelacion { aspecto: string; afirmacion: string; pruebas: { a: number[]; b: number[] }; inferido?: boolean }
export interface PersonajeRelacion { nombre: string; cambio: string; nota: string; pruebas: { a: number[]; b: number[] } }

export const NOMBRE_ASPECTO: Record<string, string> = {
  estructura: 'Estructura', personajes: 'Personajes', punto_de_vista: 'Punto de vista', tiempo: 'Tiempo', espacio: 'Espacio', final: 'Final',
  ideologia: 'Ideología', tono: 'Tono', dialogo: 'Diálogo', simbolos: 'Símbolos', medio: 'Lo propio de cada medio', otro: 'Otros cambios',
};
export const NOMBRE_CAMBIO_PERSONAJE: Record<string, string> = {
  conservado: 'se conserva', anadido: 'añadido', suprimido: 'suprimido', fusionado: 'fundido con otro', desdoblado: 'desdoblado', transformado: 'transformado',
  ampliado: 'ampliado', reducido: 'reducido', de_mencionado_a_escena: 'de mencionado a estar en escena', renombrado: 'renombrado',
};

const indices = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x) && x >= 0) : []);
const pruebasDe = (v: unknown) => { const p = (v && typeof v === 'object' ? v : {}) as { a?: unknown; b?: unknown }; return { a: indices(p.a), b: indices(p.b) }; };

/** Los cambios de la ficha de una relación, saneados (lo que no se entienda se cae). */
export function cambiosDeFicha(f: Ficha | undefined): CambioRelacion[] {
  const v = f?.datos.cambios;
  if (!Array.isArray(v)) return [];
  return v.filter((c) => c && typeof c === 'object' && typeof (c as { afirmacion?: unknown }).afirmacion === 'string' && (c as { afirmacion: string }).afirmacion.trim())
    .map((c: { aspecto?: unknown; afirmacion: string; pruebas?: unknown; inferido?: unknown }) => ({
      aspecto: typeof c.aspecto === 'string' ? c.aspecto : 'otro', afirmacion: c.afirmacion.trim(), pruebas: pruebasDe(c.pruebas), ...(c.inferido ? { inferido: true } : {}),
    }));
}

export function personajesDeFicha(f: Ficha | undefined): PersonajeRelacion[] {
  const v = f?.datos.personajes;
  if (!Array.isArray(v)) return [];
  return v.filter((p) => p && typeof p === 'object' && typeof (p as { nombre?: unknown }).nombre === 'string' && (p as { nombre: string }).nombre.trim())
    .map((p: { nombre: string; cambio?: unknown; nota?: unknown; pruebas?: unknown }) => ({ nombre: p.nombre.trim(), cambio: typeof p.cambio === 'string' ? p.cambio : 'transformado', nota: typeof p.nota === 'string' ? p.nota : '', pruebas: pruebasDe(p.pruebas) }));
}

/** Los cambios agrupados por aspecto, en el orden de la disciplina (estructura, personajes, punto de vista…). */
export function cambiosPorAspecto(cs: readonly CambioRelacion[]): Array<[string, CambioRelacion[]]> {
  const orden = Object.keys(NOMBRE_ASPECTO);
  const m = new Map<string, CambioRelacion[]>();
  for (const c of cs) m.set(c.aspecto, [...(m.get(c.aspecto) ?? []), c]);
  return [...m.entries()].sort(([a], [b]) => (orden.indexOf(a) + 99 * +(orden.indexOf(a) < 0)) - (orden.indexOf(b) + 99 * +(orden.indexOf(b) < 0)));
}

// ---------------------------------------------------------------------------
// Nombres
// ---------------------------------------------------------------------------

export const NOMBRE_LENTE: Record<Lente, string> = {
  narrativa: 'Narrativa', poesia: 'Poesía', teatro: 'Teatro', cine: 'Cine', documental: 'Documental', periodismo: 'Periodismo',
  entrevista: 'Entrevista', podcast: 'Pódcast', clase: 'Clase', ensayo: 'Ensayo', cientifico: 'Científica', archivo: 'Archivo',
  juridico: 'Jurídica', datos: 'Datos', presentacion: 'Presentación', general: 'General',
};

/** Con qué ojos se ha leído: «con la lente de la narratología». */
export const DISCIPLINA_LENTE: Record<Lente, string> = {
  narrativa: 'la narratología', poesia: 'el análisis métrico y retórico', teatro: 'el análisis teatral', cine: 'el análisis fílmico',
  documental: 'el análisis del documental', periodismo: 'el análisis periodístico', entrevista: 'el análisis de la conversación', podcast: 'el análisis de la conversación',
  clase: 'la didáctica', ensayo: 'el análisis argumentativo', cientifico: 'la lectura científica', archivo: 'la paleografía y la diplomática',
  juridico: 'el análisis jurídico', datos: 'el análisis de datos', presentacion: 'el análisis de la presentación', general: 'una lectura general',
};

export const NOMBRE_SEGMENTO: Record<TipoSegmento, [singular: string, plural: string]> = {
  obra: ['Obra', 'Obras'], parte: ['Parte', 'Partes'], capitulo: ['Capítulo', 'Capítulos'], apartado: ['Apartado', 'Apartados'],
  secuencia: ['Secuencia', 'Secuencias'], escena: ['Escena', 'Escenas'], plano: ['Plano', 'Planos'], acto: ['Acto', 'Actos'], cuadro: ['Cuadro', 'Cuadros'],
  poema: ['Poema', 'Poemas'], estrofa: ['Estrofa', 'Estrofas'], tema: ['Tema', 'Temas'], bloque: ['Bloque', 'Bloques'],
  intervencion: ['Intervención', 'Intervenciones'], diapositiva: ['Diapositiva', 'Diapositivas'], tabla: ['Tabla', 'Tablas'], folio: ['Folio', 'Folios'],
  articulo: ['Artículo', 'Artículos'], otro: ['Parte', 'Partes'],
};

/** Cómo está una entidad en un sitio. En vídeo, «visible» es «en cuadro». */
export const NOMBRE_ROL: Record<RolAparicion, string> = {
  nombrado: 'nombrado', aludido: 'aludido', presente: 'presente', habla: 'habla', visible: 'en cuadro', audible: 'se oye',
  citado: 'citado', definido: 'definido', otro: 'aparece',
};

export const NOMBRE_ESTADO: Record<EstadoComprensionValorVista, string> = {
  pendiente: 'Sin comprender', en_marcha: 'Comprendiendo', hecho: 'Comprendido', error: 'No se pudo comprender', sin_modelo: 'Sin modelo de comprensión',
};

export const NOMBRE_RELACION: Record<TipoRelacion, string> = {
  adaptacion_de: 'Adaptación', traduccion_de: 'Traducción', edicion_de: 'Edición', version_de: 'Versión', cita_a: 'Cita', comenta_a: 'Comentario',
  responde_a: 'Respuesta', parte_de: 'Parte', misma_obra: 'La misma obra', relacionado: 'Relación',
};

/** El verbo desde cada lado: [lo que hace el origen, lo que le pasa al destino]. */
const VERBO_RELACION: Record<TipoRelacion, [string, string]> = {
  adaptacion_de: ['adapta', 'está adaptada en'], traduccion_de: ['traduce', 'está traducida en'], edicion_de: ['es una edición de', 'tiene una edición en'],
  version_de: ['es una versión de', 'tiene una versión en'], cita_a: ['cita', 'está citada en'], comenta_a: ['comenta', 'está comentada en'],
  responde_a: ['responde a', 'tiene una respuesta en'], parte_de: ['forma parte de', 'contiene'], misma_obra: ['es la misma obra que', 'es la misma obra que'],
  relacionado: ['se relaciona con', 'se relaciona con'],
};

/** «Esta obra adapta», «Esta obra está adaptada en»: el verbo desde el lado de quien mira. */
export function verboRelacion(tipo: TipoRelacion, sentido: 'origen' | 'destino'): string {
  return VERBO_RELACION[tipo][sentido === 'origen' ? 0 : 1];
}

export const NOMBRE_CORRESPONDENCIA: Record<TipoCorrespondencia, string> = {
  equivalente: 'Equivalente', traducido: 'Traducido', condensado: 'Condensado', ampliado: 'Ampliado', transformado: 'Transformado',
  reordenado: 'Reordenado', anadido: 'Añadido', suprimido: 'Suprimido', alusion: 'Alusión',
};

/** Qué quiere decir cada tipo, para la leyenda y los lectores de pantalla. */
export const SENTIDO_CORRESPONDENCIA: Record<TipoCorrespondencia, string> = {
  equivalente: 'cuenta lo mismo', traducido: 'lo mismo en otra lengua', condensado: 'lo resume en menos', ampliado: 'lo desarrolla más',
  transformado: 'lo conserva cambiando su sentido', reordenado: 'lo cuenta en otro lugar del relato', anadido: 'solo está en la primera obra',
  suprimido: 'solo está en la segunda obra', alusion: 'lo evoca sin contarlo',
};

/** La forma y el color de cada tipo (Kandinsky: azul el círculo, amarillo el triángulo, rojo el cuadrado). */
export const FORMA_CORRESPONDENCIA: Record<TipoCorrespondencia, { forma: 'circulo' | 'triangulo' | 'cuadrado'; color: 'azul' | 'amarillo' | 'rojo' | 'tinta'; hueca?: boolean }> = {
  equivalente: { forma: 'circulo', color: 'azul' }, traducido: { forma: 'circulo', color: 'azul', hueca: true },
  condensado: { forma: 'triangulo', color: 'amarillo' }, ampliado: { forma: 'triangulo', color: 'amarillo', hueca: true },
  reordenado: { forma: 'triangulo', color: 'tinta', hueca: true }, transformado: { forma: 'cuadrado', color: 'rojo' },
  anadido: { forma: 'cuadrado', color: 'tinta' }, suprimido: { forma: 'cuadrado', color: 'tinta', hueca: true }, alusion: { forma: 'circulo', color: 'tinta', hueca: true },
};

export const ORDEN_CORRESPONDENCIAS: TipoCorrespondencia[] = ['equivalente', 'traducido', 'condensado', 'ampliado', 'reordenado', 'transformado', 'anadido', 'suprimido', 'alusion'];

// ---------------------------------------------------------------------------
// Anclas
// ---------------------------------------------------------------------------

/** El tramo de tiempo de algo anclado (segmento, aparición, lado de una alineación), o nada si no es de un medio. */
export function tramoDe(x: { ancla: AnclaMaterial; anclaFin?: AnclaMaterial | undefined }): [number, number] | null {
  if (x.ancla.tipo !== 'tiempo') return null;
  const t1 = x.anclaFin?.tipo === 'tiempo' ? Math.max(x.anclaFin.t1, x.anclaFin.t0) : x.ancla.t1;
  return [x.ancla.t0, Math.max(x.ancla.t0, t1)];
}

/**
 * Lo que se cita de un ancla: «p. 14», «pp. 14-15», «1:02:03-1:03:10». Un
 * fotograma con región se cita por su instante («1:02:10»).
 */
export function etiquetaAncla(a: AnclaMaterial, fin?: AnclaMaterial): string {
  if (a.tipo === 'tiempo' && a.region && a.instante != null) return tiempoACadena(a.instante);
  return anclaACita(a, fin);
}

/** El segundo al que hay que ir para ver un ancla de un medio: el del fotograma si lo hay, si no, el principio. */
export function segundoDe(a: AnclaMaterial): number | null {
  if (a.tipo !== 'tiempo') return null;
  return a.instante != null ? a.instante : a.t0;
}

/** Busca el tramo que contiene `t` en una lista ordenada por inicio (búsqueda binaria); -1 si cae en un hueco. */
export function indiceEnTramos(tramos: ReadonlyArray<readonly [number, number]>, t: number): number {
  let lo = 0, hi = tramos.length - 1, k = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (tramos[m]![0] <= t) { k = m; lo = m + 1; } else hi = m - 1;
  }
  // Tramos que se solapan: el último que empieza antes puede haber acabado; se mira hacia atrás.
  for (let i = k; i >= 0 && i > k - 4; i--) if (t < tramos[i]![1]) return i;
  return -1;
}

/** [inicio, fin) en puntos de código NFC → el texto partido en lo de antes, lo señalado y lo de después. */
export function partirPorCaracteres(texto: string, [inicio, fin]: readonly [number, number]): [string, string, string] {
  const cp = Array.from(texto.normalize('NFC'));
  const a = Math.max(0, Math.min(cp.length, inicio)), b = Math.max(a, Math.min(cp.length, fin));
  return [cp.slice(0, a).join(''), cp.slice(a, b).join(''), cp.slice(b).join('')];
}

/**
 * Un trozo del texto alrededor de los caracteres señalados, para una tarjeta:
 * hasta `margen` puntos de código a cada lado, cortado en palabra y con «…».
 */
export function contextoDeCaracteres(texto: string, c: readonly [number, number], margen = 120): [string, string, string] {
  const [antes, dentro, despues] = partirPorCaracteres(texto, c);
  const a = Array.from(antes), d = Array.from(despues);
  let pre = a.length > margen ? a.slice(-margen).join('') : antes;
  let post = d.length > margen ? d.slice(0, margen).join('') : despues;
  if (a.length > margen) pre = `…${pre.replace(/^\S*\s/, '')}`;
  if (d.length > margen) post = `${post.replace(/\s\S*$/, '')}…`;
  return [pre.replace(/\s+/g, ' '), dentro.replace(/\s+/g, ' '), post.replace(/\s+/g, ' ')];
}

// ---------------------------------------------------------------------------
// Recortes de una región (página o fotograma)
// ---------------------------------------------------------------------------

/** La región con aire alrededor (una fracción de su tamaño, y un mínimo), sin salirse de la imagen. */
export function regionConHolgura(r: Region, holgura = 0.35, minimo = 0.03): Region {
  const dx = Math.max(minimo, r.w * holgura), dy = Math.max(minimo, r.h * holgura);
  const x = Math.max(0, r.x - dx), y = Math.max(0, r.y - dy);
  const x1 = Math.min(1, r.x + r.w + dx), y1 = Math.min(1, r.y + r.h + dy);
  return { x, y, w: Math.max(0.001, x1 - x), h: Math.max(0.001, y1 - y) };
}

/**
 * Cómo enseñar solo un trozo de una imagen: la caja tiene la proporción del
 * trozo y la imagen, dentro, se agranda y se desplaza (todo en porcentajes, así
 * vale para cualquier tamaño). `aspecto` es ancho/alto de la imagen entera.
 * Devuelve también dónde cae la región original dentro del recorte.
 */
export function geometriaRecorte(region: Region, aspecto: number, holgura = 0.35): {
  aspecto: number;
  imagen: { width: string; height: string; left: string; top: string };
  marca: Region;
} {
  const c = regionConHolgura(region, holgura, holgura ? 0.03 : 0);
  const pct = (n: number) => `${Math.round(n * 10_000) / 100}%`;
  return {
    aspecto: (c.w * aspecto) / c.h,
    imagen: { width: pct(1 / c.w), height: pct(1 / c.h), left: pct(-c.x / c.w), top: pct(-c.y / c.h) },
    marca: { x: (region.x - c.x) / c.w, y: (region.y - c.y) / c.h, w: region.w / c.w, h: region.h / c.h },
  };
}

// ---------------------------------------------------------------------------
// Estructura
// ---------------------------------------------------------------------------

export interface NodoSegmento {
  s: Segmento;
  hijos: NodoSegmento[];
  /** Profundidad en el árbol (0 en la raíz), que no siempre es `nivel`. */
  profundidad: number;
}

/** El árbol de la estructura a partir de la lista plana (padre y orden). Un padre que no está deja al hijo en la raíz. */
export function arbolDeSegmentos(segmentos: readonly Segmento[]): NodoSegmento[] {
  const orden = [...segmentos].sort((a, b) => a.orden - b.orden);
  const nodos = new Map(orden.map((s) => [s.id, { s, hijos: [] as NodoSegmento[], profundidad: 0 }]));
  const raiz: NodoSegmento[] = [];
  for (const s of orden) {
    const n = nodos.get(s.id)!;
    const padre = s.padre ? nodos.get(s.padre) : undefined;
    if (padre && padre !== n) padre.hijos.push(n);
    else raiz.push(n);
  }
  const fijar = (ns: NodoSegmento[], p: number) => { for (const n of ns) { n.profundidad = p; fijar(n.hijos, p + 1); } };
  fijar(raiz, 0);
  return raiz;
}

/** Cuántos segmentos hay de cada tipo, en el orden en que aparecen: «3 partes, 12 capítulos». */
export function cuentaPorTipo(segmentos: readonly Pick<Segmento, 'tipo'>[]): Array<[TipoSegmento, number]> {
  const m = new Map<TipoSegmento, number>();
  for (const s of segmentos) m.set(s.tipo, (m.get(s.tipo) ?? 0) + 1);
  return [...m.entries()];
}

export function cuentaLegible(tipo: TipoSegmento, n: number): string {
  const [uno, varios] = NOMBRE_SEGMENTO[tipo];
  return n === 1 ? `1 ${uno.toLocaleLowerCase('es')}` : `${n} ${varios.toLocaleLowerCase('es')}`;
}

/** El resumen de una línea de un segmento: el suyo o el de su ficha. */
export function resumenDe(s: Segmento, ficha?: Ficha): string | undefined {
  const r = (ficha?.datos.resumen as { es?: string } | undefined)?.es;
  return s.resumen?.trim() || r?.trim() || undefined;
}

// ---------------------------------------------------------------------------
// Avance de la comprensión
// ---------------------------------------------------------------------------

/** Lo que dice el tiempo real mientras trabaja (evento «comprension»). */
export interface AvanceVivo { paso: string; avance: number; mensaje: string; estado?: 'en_marcha' | 'hecho' | 'error' }

/**
 * Cuánto falta, de 0 a 1, y en qué está: por los pasos terminados (estructura,
 * tandas de fichas, entidades, ficha global, indexado) o por el último aviso en
 * vivo, lo que vaya más adelantado.
 */
export function avanceComprension(e: Pick<EstadoComprensionVista, 'estado' | 'pasos'> | null, vivo?: AvanceVivo | null): { valor: number; texto: string } {
  if (e?.estado === 'hecho') return { valor: 1, texto: 'Terminada' };
  const pasos = e?.pasos ?? {};
  const lotes = Number(pasos.estructura?.detalle?.lotes ?? 0);
  const tandas = Object.keys(pasos).filter((k) => k.startsWith('fichas:')).length;
  let valor = 0, texto = 'En cola';
  if (pasos.estructura) { valor = 0.15; texto = 'Escribiendo las fichas'; }
  if (lotes && tandas) { valor = 0.15 + 0.5 * Math.min(1, tandas / lotes); texto = `Escribiendo las fichas: ${tandas} de ${lotes} tandas`; }
  if (pasos.entidades && (!lotes || tandas >= lotes)) { valor = Math.max(valor, 0.7); texto = 'Escribiendo la ficha global'; }
  if (pasos.global) { valor = 0.9; texto = 'Indexando para la búsqueda'; }
  if (pasos.indexado) { valor = 0.97; texto = 'Terminando'; }
  if (!pasos.estructura && e?.estado === 'en_marcha') texto = 'Leyendo la estructura de la obra';
  if (vivo && vivo.avance > valor && vivo.avance < 1) return { valor: vivo.avance, texto: vivo.mensaje || texto };
  return { valor, texto };
}

// ---------------------------------------------------------------------------
// Ficha global: temas y motivos con sus apariciones
// ---------------------------------------------------------------------------

export interface TemaFicha {
  nombre: string;
  descripcion: string;
  /** La entidad del grafo que lo representa (sus apariciones son las del tema). */
  entidad?: string;
  apariciones: AparicionVista[];
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Los temas (o los motivos) de la ficha global con sus apariciones en el documento, por entidad o, si falta, por nombre. */
export function temasDeFicha(ficha: Ficha | undefined, clave: 'temas' | 'motivos', apariciones: readonly AparicionVista[]): TemaFicha[] {
  const lista = Array.isArray(ficha?.datos[clave]) ? (ficha!.datos[clave] as Array<{ nombre?: string; descripcion?: string; entidad?: string }>) : [];
  return lista.filter((t) => t?.nombre).map((t) => {
    const n = norm(t.nombre!);
    const suyas = apariciones.filter((a) => (t.entidad ? a.entidad === t.entidad : norm(a.nombre) === n));
    const entidad = t.entidad ?? suyas[0]?.entidad;
    return { nombre: t.nombre!, descripcion: t.descripcion ?? '', ...(entidad ? { entidad } : {}), apariciones: ordenarApariciones(suyas) };
  });
}

/** En el orden del material: por página (y carácter) o por segundo. */
export function ordenarApariciones<T extends Pick<AparicionVista, 'ancla'>>(aps: readonly T[]): T[] {
  const clave = (a: T): [number, number] => {
    const x = a.ancla;
    if (x.tipo === 'tiempo') return [x.instante ?? x.t0, 0];
    if (x.tipo === 'pagina') return [x.fisica, x.caracteres?.[0] ?? 0];
    if (x.tipo === 'seccion' || x.tipo === 'web') return [x.parrafo, x.caracteres?.[0] ?? 0];
    if (x.tipo === 'diapositiva') return [x.n, 0];
    return [0, 0];
  };
  return [...aps].sort((a, b) => { const [a1, a2] = clave(a), [b1, b2] = clave(b); return a1 - b1 || a2 - b2; });
}

/** Una cadena del campo `datos` de una ficha, si la hay y no está vacía. */
export function datoTexto(f: Ficha | undefined, k: string): string | undefined {
  const v = f?.datos[k];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

// ---------------------------------------------------------------------------
// Entidades de un documento
// ---------------------------------------------------------------------------

export type CategoriaEntidad = 'personas' | 'lugares' | 'obras' | 'motivos' | 'otras';

export const NOMBRE_CATEGORIA: Record<CategoriaEntidad, string> = {
  personas: 'Personas y personajes', lugares: 'Lugares', obras: 'Obras', motivos: 'Temas y motivos', otras: 'Otras',
};

export function categoriaDe(tipo: string, esMotivo = false): CategoriaEntidad {
  if (esMotivo) return 'motivos';
  switch (tipo) {
    case 'persona': case 'personaje': return 'personas';
    case 'lugar': return 'lugares';
    case 'obra': case 'obra_musical': return 'obras';
    case 'motivo': case 'tema': case 'objeto': case 'concepto': return 'motivos';
    default: return 'otras';
  }
}

export interface EntidadEnDocumento {
  id: string;
  nombre: string;
  tipo: string;
  categoria: CategoriaEntidad;
  apariciones: AparicionVista[];
  /** Cuántas veces con cada rol. */
  roles: Partial<Record<RolAparicion, number>>;
}

/** Las apariciones de un documento, agrupadas por entidad y por orden de importancia (más apariciones primero). */
export function agruparApariciones(aps: readonly AparicionVista[], motivos: ReadonlySet<string> = new Set()): EntidadEnDocumento[] {
  const m = new Map<string, EntidadEnDocumento>();
  for (const a of aps) {
    let e = m.get(a.entidad);
    if (!e) { e = { id: a.entidad, nombre: a.nombre || 'Sin nombre', tipo: a.tipo, categoria: categoriaDe(a.tipo, motivos.has(a.entidad)), apariciones: [], roles: {} }; m.set(a.entidad, e); }
    e.apariciones.push(a);
    e.roles[a.rol] = (e.roles[a.rol] ?? 0) + 1;
  }
  return [...m.values()].map((e) => ({ ...e, apariciones: ordenarApariciones(e.apariciones) }))
    .sort((a, b) => b.apariciones.length - a.apariciones.length || a.nombre.localeCompare(b.nombre, 'es'));
}

/** «12 apariciones: 8 en cuadro, 4 habla». */
export function resumenRoles(e: Pick<EntidadEnDocumento, 'roles' | 'apariciones'>): string {
  const partes = Object.entries(e.roles).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([r, n]) => `${n} ${NOMBRE_ROL[r as RolAparicion]}`);
  const n = e.apariciones.length;
  return `${n} ${n === 1 ? 'aparición' : 'apariciones'}${partes.length > 1 ? `: ${partes.join(', ')}` : ''}`;
}

// ---------------------------------------------------------------------------
// La película: secuencias, escenas, planos y sonido
// ---------------------------------------------------------------------------

export interface Localizado { nombre: string; region?: Region; instante?: number; nota?: string }

export interface TramoPelicula {
  id: string;
  t0: number;
  t1: number;
  titulo: string;
  resumen?: string;
}

export interface PlanoVista extends TramoPelicula {
  escala?: string;
  angulacion?: string;
  movimiento?: string;
  composicion?: string;
  luz?: string;
  color?: string;
  textoEnPantalla?: string;
  personas: Localizado[];
  objetos: Localizado[];
  /** La ficha del plano (prosa), si la hay. */
  texto?: string;
  escena?: string;
}

export interface SonidoVista { id: string; t0: number; t1: number; nombre: string; tipo: string; forma?: string }

export interface Pelicula {
  secuencias: TramoPelicula[];
  escenas: Array<TramoPelicula & { secuencia?: string }>;
  planos: PlanoVista[];
  sonido: SonidoVista[];
  duracion: number;
}

const cad = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Los localizados de la ficha de un plano: nombres de `datos` y región e instante de sus evidencias («Nombre: nota»). */
function localizados(nombres: unknown, ficha: Ficha | undefined): Localizado[] {
  const lista = Array.isArray(nombres) ? nombres.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
  return lista.map((nombre) => {
    const ev = ficha?.evidencias.find((e) => (e.cita ?? '').startsWith(nombre) && /^(:|$)/.test((e.cita ?? '').slice(nombre.length)));
    const nota = ev?.cita && ev.cita.length > nombre.length + 2 ? ev.cita.slice(nombre.length + 1).trim() : undefined;
    return { nombre, ...(ev?.ancla.region ? { region: ev.ancla.region } : {}), ...(ev?.ancla.instante != null ? { instante: ev.ancla.instante } : {}), ...(nota ? { nota } : {}) };
  });
}

/**
 * El découpage de una película a partir de sus segmentos (secuencias, escenas y
 * planos), las fichas de plano (escala, angulación, quién está y dónde) y las
 * apariciones que se oyen (música, canciones, ruidos), cada cosa con su tramo.
 */
export function construirPelicula(segmentos: readonly Segmento[], fichasPlano: readonly Ficha[], apariciones: readonly AparicionVista[] = [], duracion = 0): Pelicula {
  const tramo = (s: Segmento) => tramoDe(s);
  const conTramo = segmentos.filter((s) => tramo(s)).sort((a, b) => tramo(a)![0] - tramo(b)![0] || a.orden - b.orden);
  const porFicha = new Map(fichasPlano.map((f) => [f.objetivoId, f]));
  const base = (s: Segmento): TramoPelicula => { const [t0, t1] = tramo(s)!; return { id: s.id, t0, t1, titulo: s.titulo, ...(s.resumen ? { resumen: s.resumen } : {}) }; };
  const secuencias = conTramo.filter((s) => s.tipo === 'secuencia').map(base);
  const escenas = conTramo.filter((s) => s.tipo === 'escena').map((s) => {
    const b = base(s);
    const sq = secuencias.find((q) => q.id === s.padre) ?? secuencias.find((q) => b.t0 >= q.t0 && b.t0 < q.t1);
    return { ...b, ...(sq ? { secuencia: sq.id } : {}) };
  });
  const planos = conTramo.filter((s) => s.tipo === 'plano').map((s): PlanoVista => {
    const f = porFicha.get(s.id);
    const d = f?.datos ?? {};
    const b = base(s);
    const escena = escenas.find((e) => e.id === s.padre) ?? escenas.find((e) => b.t0 >= e.t0 && b.t0 < e.t1);
    const v = (k: string) => cad(d[k]);
    return {
      ...b, personas: localizados(d.personas, f), objetos: localizados(d.objetos, f),
      ...(v('escala') ? { escala: v('escala') } : {}), ...(v('angulacion') ? { angulacion: v('angulacion') } : {}), ...(v('movimiento') ? { movimiento: v('movimiento') } : {}),
      ...(v('composicion') ? { composicion: v('composicion') } : {}), ...(v('luz') ? { luz: v('luz') } : {}), ...(v('color') ? { color: v('color') } : {}),
      ...(v('textoEnPantalla') ? { textoEnPantalla: v('textoEnPantalla') } : {}), ...(f?.texto ? { texto: f.texto } : {}), ...(escena ? { escena: escena.id } : {}),
    };
  });
  const sonido = ordenarApariciones(apariciones.filter((a) => a.rol === 'audible' && a.ancla.tipo === 'tiempo')).map((a) => {
    const [t0, t1] = tramoDe(a)!;
    return { id: a.id, t0, t1: Math.max(t1, t0 + 1), nombre: a.nombre, tipo: a.tipo, ...(a.forma && a.forma !== a.nombre ? { forma: a.forma } : {}) };
  });
  const fin = Math.max(duracion, ...[...secuencias, ...escenas, ...planos, ...sonido].map((x) => x.t1), 0);
  return { secuencias, escenas, planos, sonido, duracion: fin };
}

/** Los tramos de una lista, para `indiceEnTramos`. */
export const tramosDe = (xs: readonly Pick<TramoPelicula, 't0' | 't1'>[]) => xs.map((x) => [x.t0, x.t1] as const);

/** Qué hay en el instante `t`: la secuencia, la escena y el plano (índices, -1 si nada). */
export function enInstante(p: Pelicula, t: number, cache?: { sq: ReadonlyArray<readonly [number, number]>; es: ReadonlyArray<readonly [number, number]>; pl: ReadonlyArray<readonly [number, number]> }): { secuencia: number; escena: number; plano: number } {
  const c = cache ?? { sq: tramosDe(p.secuencias), es: tramosDe(p.escenas), pl: tramosDe(p.planos) };
  return { secuencia: indiceEnTramos(c.sq, t), escena: indiceEnTramos(c.es, t), plano: indiceEnTramos(c.pl, t) };
}

/** Quién y qué se ve en un plano con su región: lo que se dibuja sobre el fotograma. */
export function enCuadro(pl: PlanoVista | undefined): Array<Localizado & { region: Region; clase: 'persona' | 'objeto' }> {
  if (!pl) return [];
  return [
    ...pl.personas.filter((x): x is Localizado & { region: Region } => !!x.region).map((x) => ({ ...x, clase: 'persona' as const })),
    ...pl.objetos.filter((x): x is Localizado & { region: Region } => !!x.region).map((x) => ({ ...x, clase: 'objeto' as const })),
  ];
}

/** Los rasgos de cámara de un plano en una línea: «Plano medio, contrapicado, travelling». */
export function rasgosPlano(pl: Pick<PlanoVista, 'escala' | 'angulacion' | 'movimiento'>): string {
  const r = [pl.escala, pl.angulacion && pl.angulacion !== 'normal' ? pl.angulacion : '', pl.movimiento === 'fija' ? 'cámara fija' : pl.movimiento].filter((x): x is string => !!x);
  if (!r.length) return '';
  const t = r.join(', ');
  return t.charAt(0).toLocaleUpperCase('es') + t.slice(1);
}

/** «4,2 s», «1 min 3 s». */
export function duracionPlano(t0: number, t1: number): string {
  const d = Math.max(0, t1 - t0);
  if (d < 60) return `${(Math.round(d * 10) / 10).toString().replace('.', ',')} s`;
  const m = Math.floor(d / 60), s = Math.round(d % 60);
  return s ? `${m} min ${s} s` : `${m} min`;
}

// ---------------------------------------------------------------------------
// Alineaciones
// ---------------------------------------------------------------------------

/** Cuántas alineaciones hay de cada tipo, en el orden de la leyenda. */
export function cuentaCorrespondencias(als: readonly Pick<Alineacion, 'tipo'>[]): Array<[TipoCorrespondencia, number]> {
  const m = new Map<TipoCorrespondencia, number>();
  for (const a of als) m.set(a.tipo, (m.get(a.tipo) ?? 0) + 1);
  return ORDEN_CORRESPONDENCIAS.filter((t) => m.has(t)).map((t) => [t, m.get(t)!]);
}

/** El lado de una alineación que es de este documento (y el otro). */
export function ladosPara(al: Alineacion, documento: string): { este?: LadoAlineacion; otro?: LadoAlineacion } {
  if (al.b?.documento === documento && al.a?.documento !== documento) return { ...(al.b ? { este: al.b } : {}), ...(al.a ? { otro: al.a } : {}) };
  return { ...(al.a ? { este: al.a } : {}), ...(al.b ? { otro: al.b } : {}) };
}

/** «Escena 3 ↔ pp. 14-15»: dónde está cada lado, en una línea. */
export function etiquetaLado(l: LadoAlineacion | undefined): string {
  return l ? etiquetaAncla(l.ancla, l.anclaFin) : 'nada';
}

/**
 * El segmento más hondo que contiene un sitio: la página física `u` (por el ancla
 * de inicio y de cierre de cada segmento) o el segundo `t`. Los planos no cuentan.
 */
export function segmentoEn(segmentos: readonly Segmento[], sitio: { u?: number; t?: number }): Segmento | undefined {
  let mejor: Segmento | undefined;
  for (const s of segmentos) {
    if (s.tipo === 'plano') continue;
    let dentro = false;
    if (sitio.t != null && s.ancla.tipo === 'tiempo') { const [a, b] = tramoDe(s)!; dentro = sitio.t >= a && sitio.t < b; }
    else if (sitio.u != null && s.ancla.tipo === 'pagina') {
      const fin = s.anclaFin?.tipo === 'pagina' ? s.anclaFin.fisica : s.ancla.fisica;
      dentro = sitio.u >= s.ancla.fisica && sitio.u <= fin;
    }
    if (dentro && (!mejor || s.nivel > mejor.nivel || (s.nivel === mejor.nivel && s.orden > mejor.orden))) mejor = s;
  }
  return mejor;
}
