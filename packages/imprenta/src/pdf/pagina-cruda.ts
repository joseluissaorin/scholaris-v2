/**
 * El trabajo de UNA página, tal como lo hace cada trabajador del grupo:
 * capa de texto en crudo, regiones de imagen (del operator list), decisión de
 * resolución, rasterizado a JPEG y miniatura. Todo lo que devuelve es
 * transferible entre hilos (números, cadenas y Uint8Array).
 */

import type { Plataforma } from '../plataforma.js';
import type { Region } from '../tipos.js';
import { diagnosticar } from './capa-texto.js';

export interface ItemCrudo {
  /** Texto del trozo. */
  s: string;
  /** Caja normalizada 0-1 (arriba a la izquierda). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Cuerpo de letra en puntos. */
  tam: number;
  /** pdf.js marca fin de línea. */
  fl: boolean;
  /** Texto girado (sellos al margen, ejes de gráficas): fuera del orden de lectura. */
  rot?: boolean;
}

export interface ImagenCodificada {
  bytes: Uint8Array;
  ancho: number;
  alto: number;
}

export interface PaginaCruda {
  fisica: number;
  ancho: number;
  alto: number;
  rotacion: number;
  items: ItemCrudo[];
  imagenes: Region[];
  cobertura: number;
  jpeg: ImagenCodificada | null;
  miniatura: ImagenCodificada | null;
  figuras: Array<{ region: Region; imagen: ImagenCodificada }>;
  ms: { texto: number; operadores: number; render: number; codificar: number; total: number };
}

export interface OpcionesPaginaCruda {
  ladoEscaneada: number;
  ladoDigital: number;
  ladoMiniatura: number;
  calidad: number;
  recortarFiguras: boolean;
}

type Matriz = [number, number, number, number, number, number];

function multiplicar(m1: Matriz, m2: Matriz): Matriz {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function aplicar(m: Matriz, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Recorre el operator list siguiendo la matriz actual y devuelve dónde se pintan imágenes. */
export function regionesDeImagen(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  ops: Record<string, number>,
  vista: Matriz,
  anchoVista: number,
  altoVista: number,
): { regiones: Region[]; cobertura: number } {
  const pila: Matriz[] = [];
  let ctm: Matriz = [1, 0, 0, 1, 0, 0];
  const pintar = new Set([ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageMaskXObject, ops.paintImageXObjectRepeat]);
  const regiones: Region[] = [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === ops.save) pila.push(ctm);
    else if (fn === ops.restore) ctm = pila.pop() ?? ctm;
    else if (fn === ops.transform) ctm = multiplicar(ctm, argsArray[i] as Matriz);
    else if (fn === ops.paintFormXObjectBegin) {
      pila.push(ctm);
      const m = (argsArray[i] as [Matriz | null])[0];
      if (m && m.length === 6) ctm = multiplicar(ctm, Array.from(m) as Matriz);
    } else if (fn === ops.paintFormXObjectEnd) ctm = pila.pop() ?? ctm;
    else if (fn !== undefined && pintar.has(fn)) {
      const m = multiplicar(vista, ctm);
      const esquinas = [aplicar(m, 0, 0), aplicar(m, 1, 0), aplicar(m, 0, 1), aplicar(m, 1, 1)];
      const xs = esquinas.map((p) => p[0]);
      const ys = esquinas.map((p) => p[1]);
      const x0 = Math.max(0, Math.min(...xs) / anchoVista), x1 = Math.min(1, Math.max(...xs) / anchoVista);
      const y0 = Math.max(0, Math.min(...ys) / altoVista), y1 = Math.min(1, Math.max(...ys) / altoVista);
      if (x1 - x0 > 0.005 && y1 - y0 > 0.005) regiones.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  }
  // Cobertura de la unión en una rejilla de 64 × 64.
  const N = 64;
  const rejilla = new Uint8Array(N * N);
  for (const r of regiones) {
    const a = Math.floor(r.x * N), b = Math.ceil((r.x + r.w) * N);
    const c = Math.floor(r.y * N), d = Math.ceil((r.y + r.h) * N);
    for (let y = c; y < d; y++) for (let x = a; x < b; x++) rejilla[y * N + x] = 1;
  }
  let llenas = 0;
  for (const v of rejilla) llenas += v;
  return { regiones, cobertura: llenas / (N * N) };
}

const dormir0 = () => new Promise<void>((r) => setTimeout(r, 0));

/** Procesa una página. `doc` es un PDFDocumentProxy de pdf.js. */
export async function procesarPaginaCruda(
  plataforma: Plataforma,
  lib: { OPS: Record<string, number> },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  fisica: number,
  op: OpcionesPaginaCruda,
): Promise<PaginaCruda> {
  const t0 = performance.now();
  const pagina = await doc.getPage(fisica);
  const vista = pagina.getViewport({ scale: 1 });
  const W: number = vista.width, H: number = vista.height;
  const vt = vista.transform as Matriz;

  // 1. Capa de texto.
  const contenido = await pagina.getTextContent();
  const items: ItemCrudo[] = [];
  for (const it of contenido.items as Array<{ str?: string; transform: Matriz; width: number; height: number; hasEOL: boolean; fontName: string }>) {
    if (typeof it.str !== 'string') continue;
    if (it.str === '' && !it.hasEOL) continue;
    const m = multiplicar(vt, it.transform);
    const tam = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]) || 1;
    const estilo = contenido.styles?.[it.fontName] as { ascent?: number; descent?: number } | undefined;
    const ascenso = estilo?.ascent && estilo.ascent > 0.3 ? estilo.ascent : 0.8;
    // Ancho en la vista: el ancho del item va en unidades de usuario, a lo largo de la línea base.
    const escalaH = Math.hypot(vt[0], vt[1]);
    const ancho = it.width * escalaH;
    const x = m[4], base = m[5];
    const girado = Math.abs(m[1]) > Math.abs(m[0]) * 0.5 || m[0] < 0;
    items.push({
      ...(girado ? { rot: true } : {}),
      s: it.str,
      x: x / W,
      y: (base - tam * ascenso) / H,
      w: ancho / W,
      h: tam / H,
      tam: tam / escalaH,
      fl: it.hasEOL,
    });
  }
  const t1 = performance.now();

  // 2. Imágenes pintadas (operator list; pdf.js lo reutiliza al rasterizar).
  let imagenes: Region[] = [];
  let cobertura = 0;
  try {
    const lista = await pagina.getOperatorList();
    const r = regionesDeImagen(lista.fnArray, lista.argsArray, lib.OPS, vt, W, H);
    imagenes = r.regiones.filter((g) => g.w * g.h >= 0.01);
    cobertura = r.cobertura;
  } catch {
    /* página rota: sin regiones */
  }
  const t2 = performance.now();

  // 3. ¿Digital o escaneada? Decide la resolución.
  const diag = diagnosticar(items, cobertura);
  const lado = diag.util ? op.ladoDigital : op.ladoEscaneada;

  let jpeg: ImagenCodificada | null = null;
  let miniatura: ImagenCodificada | null = null;
  const figuras: PaginaCruda['figuras'] = [];
  let tRender = 0, tCodificar = 0;
  if (lado > 0) {
    const escala = lado / Math.max(W, H);
    const vp = pagina.getViewport({ scale: escala });
    const ancho = Math.max(1, Math.round(vp.width)), alto = Math.max(1, Math.round(vp.height));
    const lienzo = plataforma.crearLienzo(ancho, alto);
    lienzo.ctx.fillStyle = '#ffffff';
    lienzo.ctx.fillRect(0, 0, ancho, alto);
    const tr = performance.now();
    await pagina.render({ canvas: lienzo.nativo, canvasContext: lienzo.ctx, viewport: vp, annotationMode: 0 }).promise;
    const tc = performance.now();
    tRender = tc - tr;
    jpeg = { bytes: await plataforma.aJpeg(lienzo, op.calidad), ancho, alto };
    if (op.ladoMiniatura > 0) {
      const e = op.ladoMiniatura / Math.max(ancho, alto);
      const mw = Math.max(1, Math.round(ancho * e)), mh = Math.max(1, Math.round(alto * e));
      const mini = plataforma.crearLienzo(mw, mh);
      mini.ctx.imageSmoothingEnabled = true;
      mini.ctx.imageSmoothingQuality = 'high';
      mini.ctx.drawImage(lienzo.nativo, 0, 0, ancho, alto, 0, 0, mw, mh);
      miniatura = { bytes: await plataforma.aJpeg(mini, 0.7), ancho: mw, alto: mh };
    }
    if (op.recortarFiguras && cobertura < 0.85) {
      for (const g of imagenes) {
        if (g.w * g.h < 0.02) continue;
        const fw = Math.max(1, Math.round(g.w * ancho)), fh = Math.max(1, Math.round(g.h * alto));
        const f = plataforma.crearLienzo(fw, fh);
        f.ctx.drawImage(lienzo.nativo, Math.round(g.x * ancho), Math.round(g.y * alto), fw, fh, 0, 0, fw, fh);
        figuras.push({ region: g, imagen: { bytes: await plataforma.aJpeg(f, op.calidad), ancho: fw, alto: fh } });
      }
    }
    tCodificar = performance.now() - tc;
  }
  pagina.cleanup();
  await dormir0();
  return {
    fisica,
    ancho: W,
    alto: H,
    rotacion: pagina.rotate ?? 0,
    items,
    imagenes,
    cobertura,
    jpeg,
    miniatura,
    figuras,
    ms: { texto: t1 - t0, operadores: t2 - t1, render: tRender, codificar: tCodificar, total: performance.now() - t0 },
  };
}
