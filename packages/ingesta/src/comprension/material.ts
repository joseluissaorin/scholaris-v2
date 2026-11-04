/**
 * El material de la comprensión: el documento entero tal como lo ve el modelo
 * (unidades marcadas con su orden y su localizador, y en los medios los
 * fotogramas descritos), con lo necesario para anclar después lo que diga.
 */
import { anclaACita, type Ancla, type Documento, type SQL } from '@scholaris/nucleo';
import { instantesDePalabras, leerDocumento, leerFiguras, leerSecciones, leerUnidades, type PalabrasTiempo, type Seccion } from '@scholaris/spdf';

export interface UnidadMaterial {
  id: string;
  orden: number;
  ancla: Ancla;
  /** Texto de la unidad en NFC: los `caracteres` de las anclas cuentan sobre él. */
  texto: string;
  etiqueta: string;
  t0?: number;
  t1?: number;
  palabras?: PalabrasTiempo;
  imagen?: string;
}

export interface FotogramaMaterial {
  /** Número para el modelo («⟦F12 · …⟧»), desde 1 en orden de tiempo. */
  n: number;
  id: string;
  t: number;
  descripcion: string;
  unidad: string;
}

export interface Material {
  documento: Documento;
  unidades: UnidadMaterial[];
  porOrden: Map<number, UnidadMaterial>;
  porId: Map<string, UnidadMaterial>;
  secciones: Seccion[];
  fotogramas: FotogramaMaterial[];
  medio: boolean;
  caracteres: number;
}

export function etiquetaUnidad(a: Ancla): string {
  try { return anclaACita(a); } catch { return ''; }
}

export async function leerMaterial(sql: SQL, documento: string): Promise<Material> {
  const doc = await leerDocumento(sql, documento);
  if (!doc) throw new Error(`No existe el documento ${documento}.`);
  const filas = await leerUnidades(sql, documento);
  const unidades: UnidadMaterial[] = filas.map((u) => {
    const ancla = u.ancla;
    const m: UnidadMaterial = { id: u.id, orden: u.orden, ancla, texto: (u.texto ?? '').normalize('NFC'), etiqueta: etiquetaUnidad(ancla) };
    if (ancla.tipo === 'tiempo') { m.t0 = ancla.t0; m.t1 = ancla.t1; }
    if (u.palabras) m.palabras = u.palabras;
    if (u.imagen) m.imagen = u.imagen;
    return m;
  });
  const medio = doc.tipo === 'audio' || doc.tipo === 'video' || unidades.some((u) => u.ancla.tipo === 'tiempo');
  const fotogramas: FotogramaMaterial[] = [];
  if (medio) {
    const figs = (await leerFiguras(sql, documento))
      .filter((f) => f.ancla.tipo === 'tiempo' && (f.descripcion ?? '').trim().length > 12)
      .map((f) => ({ id: f.id, t: (f.ancla as { t0: number }).t0, descripcion: (f.descripcion ?? '').trim(), unidad: f.unidad }))
      .sort((a, b) => a.t - b.t);
    figs.forEach((f, i) => fotogramas.push({ n: i + 1, ...f }));
  }
  return {
    documento: doc, unidades,
    porOrden: new Map(unidades.map((u) => [u.orden, u])), porId: new Map(unidades.map((u) => [u.id, u])),
    secciones: await leerSecciones(sql, documento), fotogramas, medio,
    caracteres: unidades.reduce((t, u) => t + u.texto.length, 0) + fotogramas.reduce((t, f) => t + f.descripcion.length + 20, 0),
  };
}

/** Tokens aproximados de un texto (≈ 3,6 caracteres por token en español). */
export const tokensDe = (caracteres: number) => Math.ceil(caracteres / 3.6);

export function cabeceraUnidad(u: UnidadMaterial): string {
  return `⟦U${u.orden}${u.etiqueta ? ` · ${u.etiqueta}` : ''}⟧`;
}

export function cabeceraFotograma(f: FotogramaMaterial): string {
  return `⟦F${f.n} · ${etiquetaUnidad({ tipo: 'tiempo', t0: f.t, t1: f.t })}⟧`;
}

/** Ficha bibliográfica breve para encabezar el material. */
export function fichaDocumento(d: Documento): string {
  const m = d.metadatos;
  const autores = (m.autores ?? []).map((a) => [a.nombre, a.apellidos].filter(Boolean).join(' ')).filter(Boolean).join('; ');
  const partes = [
    `Título: ${m.titulo ?? 'sin título'}`,
    autores ? `Autoría: ${autores}` : '',
    m.anio ? `Año: ${m.anio}${m.anioOriginal && m.anioOriginal !== m.anio ? ` (original de ${m.anioOriginal})` : ''}` : '',
    m.editorial ? `Editorial o productora: ${m.editorial}` : '',
    m.lugar ? `Lugar: ${m.lugar}` : '',
    m.idioma ? `Lengua: ${m.idioma}` : '',
    m.tipoCSL ? `Tipo: ${m.tipoCSL}` : '',
    `Soporte: ${d.tipo}${d.duracion ? `, ${Math.round(d.duracion / 60)} min` : ''}`,
  ].filter(Boolean);
  return partes.join('\n');
}

export interface OpcionesTexto {
  /** Órdenes de unidad [desde, hasta] (incluidos). */
  desde?: number;
  hasta?: number;
  /** Incluir los fotogramas descritos entre las unidades (medios). */
  fotogramas?: boolean;
  /** Tope de caracteres: lo que sobra se recorta por unidad, de forma pareja. */
  maxCaracteres?: number;
}

/**
 * El documento (o un tramo) como lo lee el modelo: cada unidad con su cabecera y,
 * en los medios, los fotogramas intercalados por tiempo.
 */
export function textoParaModelo(m: Material, o: OpcionesTexto = {}): string {
  const desde = o.desde ?? Number.MIN_SAFE_INTEGER, hasta = o.hasta ?? Number.MAX_SAFE_INTEGER;
  const us = m.unidades.filter((u) => u.orden >= desde && u.orden <= hasta && u.texto.trim());
  const total = us.reduce((t, u) => t + u.texto.length, 0);
  const factor = o.maxCaracteres && total > o.maxCaracteres ? o.maxCaracteres / total : 1;
  const recortar = (t: string) => (factor < 1 && t.length > 400 ? `${t.slice(0, Math.max(400, Math.floor(t.length * factor)))} […]` : t);
  const bloques: Array<{ t: number; texto: string }> = us.map((u, i) => ({ t: u.t0 ?? i, texto: `${cabeceraUnidad(u)}\n${recortar(u.texto.trim())}` }));
  if (o.fotogramas && m.medio && m.fotogramas.length) {
    const t0 = us[0]?.t0 ?? 0, t1 = us.at(-1)?.t1 ?? Number.MAX_SAFE_INTEGER;
    const fs = m.fotogramas.filter((f) => (o.desde === undefined || f.t >= t0 - 1) && (o.hasta === undefined || f.t <= t1 + 1));
    for (const f of fs) bloques.push({ t: f.t + 0.001, texto: `${cabeceraFotograma(f)} (fotograma) ${f.descripcion}` });
    bloques.sort((a, b) => a.t - b.t);
  }
  return bloques.map((b) => b.texto).join('\n\n');
}

/** Una muestra para elegir la lente: principio, medio y final. */
export function muestraDe(m: Material, caracteres = 9000): string {
  const texto = m.unidades.map((u) => u.texto).join('\n\n');
  if (texto.length <= caracteres) return texto;
  const tercio = Math.floor(caracteres / 3);
  const medio = Math.floor(texto.length / 2);
  return [texto.slice(0, tercio), texto.slice(medio - tercio / 2, medio + tercio / 2), texto.slice(-tercio)].join('\n\n[…]\n\n');
}

/** Hablantes distintos de un medio (de las anclas y de las marcas «**Nombre:**»). */
export function hablantesDe(m: Material): string[] {
  const s = new Set<string>();
  for (const u of m.unidades) {
    if (u.ancla.tipo === 'tiempo' && u.ancla.hablante) s.add(u.ancla.hablante);
    for (const x of u.texto.matchAll(/\*\*([^*\n]{1,40}):\*\*/g)) s.add(x[1]!.trim());
  }
  return [...s];
}

/** Instante de cada palabra de una unidad de tiempo, si se guardaron. */
export function instantes(u: UnidadMaterial): Array<[number, number]> | null {
  return u.palabras ? instantesDePalabras(u.palabras) : null;
}
