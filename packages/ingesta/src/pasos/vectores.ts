/**
 * Paso de vectores: fragmentos (contexto + texto), imagen de cada página,
 * figuras y fotogramas, en lotes grandes y en paralelo, para el espacio base y
 * para los espacios extra. Los vectores no vuelven en el resultado (pesan): se
 * entregan lote a lote a `guardar`, que los escribe en el SPDF o en el índice.
 */

import { enParalelo, reintentar, type Embebedor, type ObjetivoVector, type PiezaEmbebible, type Vector } from '@scholaris/nucleo';
import type { FragmentoPlano, FuentePaquete, Procedencia } from '../tipos.js';

export interface PiezaVector {
  objetivo: ObjetivoVector;
  id: string;
  /** Texto a vectorizar, o parte binaria (imagen) a traer de la fuente. */
  texto?: string;
  parte?: string;
  recorte?: { parte: string; region: { x: number; y: number; w: number; h: number } };
}

/** El texto que se vectoriza de un fragmento: su contexto, su sección y el texto. */
export function textoVectorizable(f: Pick<FragmentoPlano, 'texto' | 'contexto' | 'seccion'>): string {
  const cabeza = [f.contexto, f.seccion.length ? f.seccion.join(' › ') : ''].filter(Boolean).join('\n');
  return cabeza ? `${cabeza}\n\n${f.texto}` : f.texto;
}

export interface OpcionesVectores {
  loteTexto?: number;
  loteImagen?: number;
  concurrencia?: number;
  reloj?: () => number;
  alLote?: (hechos: number, total: number) => void;
}

export async function vectorizar(
  piezas: PiezaVector[],
  embebedor: Embebedor,
  fuente: FuentePaquete,
  guardar: (vectores: Vector[]) => Promise<void>,
  opciones: OpcionesVectores = {},
): Promise<Procedencia> {
  const reloj = opciones.reloj ?? Date.now;
  const t = reloj();
  const textos = piezas.filter((p) => p.texto !== undefined && embebedor.admite('texto'));
  const imagenes = piezas.filter((p) => (p.parte || p.recorte) && embebedor.admite('imagen'));
  const loteT = opciones.loteTexto ?? 100, loteI = opciones.loteImagen ?? 16;
  const lotes: PiezaVector[][] = [];
  for (let i = 0; i < textos.length; i += loteT) lotes.push(textos.slice(i, i + loteT));
  for (let i = 0; i < imagenes.length; i += loteI) lotes.push(imagenes.slice(i, i + loteI));
  let hechos = 0, fallidos = 0, vectores = 0, omitidas = 0, duplicadas = 0;
  await enParalelo(lotes, opciones.concurrencia ?? 8, async (lote) => {
    const entradas: Array<{ p: PiezaVector; pieza: PiezaEmbebible }> = [];
    /** Piezas idénticas a otra del mismo lote (páginas repetidas, en blanco): se vectorizan una vez. */
    const copias: Array<{ p: PiezaVector; de: PiezaVector }> = [];
    const vistas = new Map<string, PiezaVector>();
    for (const p of lote) {
      if (p.texto !== undefined) {
        const previa = vistas.get(`t:${p.texto}`);
        if (previa) { copias.push({ p, de: previa }); continue; }
        vistas.set(`t:${p.texto}`, p);
        entradas.push({ p, pieza: { modalidad: 'texto', texto: p.texto } });
        continue;
      }
      const b = p.recorte && fuente.recorte ? await fuente.recorte(p.recorte.parte, p.recorte.region) : p.parte ? await fuente.parte(p.parte) : null;
      if (!b) { omitidas++; continue; }
      const huella = `i:${b.bytes.byteLength}:${huellaBytes(b.bytes)}`;
      const previa = vistas.get(huella);
      if (previa) { copias.push({ p, de: previa }); continue; }
      vistas.set(huella, p);
      entradas.push({ p, pieza: { modalidad: 'imagen', bytes: b.bytes, mime: b.mime } });
    }
    if (!entradas.length) return;
    let vs: Float32Array[];
    try {
      vs = await reintentar(() => embebedor.vectorizar(entradas.map((e) => e.pieza), 'documento'), { intentos: 4, base: 1000 });
    } catch {
      // Un lote que el embebedor no puede vectorizar se cuenta y se sigue: el documento
      // vale sin esos vectores. Lo que falle al GUARDAR, en cambio, se propaga: un
      // documento a medio indexar no debe darse por bueno (el paso se reintenta).
      fallidos += entradas.length;
      opciones.alLote?.(++hechos, lotes.length);
      return;
    }
    const porPieza = new Map(entradas.map((e, i) => [e.p, vs[i] as Float32Array]));
    const todos: Vector[] = entradas.map((e, i) => ({ objetivo: e.p.objetivo, id: e.p.id, espacio: embebedor.espacio.id, valores: vs[i] as Float32Array }));
    for (const c of copias) { const v = porPieza.get(c.de); if (v) todos.push({ objetivo: c.p.objetivo, id: c.p.id, espacio: embebedor.espacio.id, valores: v }); }
    await guardar(todos);
    vectores += todos.length;
    duplicadas += copias.length;
    opciones.alLote?.(++hechos, lotes.length);
  });
  return {
    fase: 'vectores',
    proveedor: embebedor.espacio.id,
    ms: reloj() - t,
    detalle: { textos: textos.length, imagenes: imagenes.length, lotes: lotes.length, vectores, fallidos, omitidas, duplicadas },
  };
}

/** Huella rápida de unos bytes (FNV-1a sobre una muestra): basta para reconocer imágenes idénticas. */
function huellaBytes(b: Uint8Array): string {
  let h = 0x811c9dc5;
  const paso = Math.max(1, Math.floor(b.byteLength / 4096));
  for (let i = 0; i < b.byteLength; i += paso) { h ^= b[i] as number; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
