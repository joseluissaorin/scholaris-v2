/**
 * Fotos de un libro (una por página) e imágenes sueltas: orientación EXIF,
 * reducción a un tamaño adecuado para visión y miniatura. Ya vienen ordenadas
 * por nombre con criterio numérico.
 */

import { sha256 } from '@scholaris/nucleo';
import type { Contexto } from './contexto.js';
import { num4 } from './contexto.js';
import { detectar } from './detectar.js';
import type { Lienzo } from './plataforma.js';
import type { ArchivoEntrada, OrigenArchivo, PaginaImagen, PaqueteConversion } from './tipos.js';
import { VERSION_PAQUETE } from './tipos.js';

/** Orientación EXIF (1-8) de un JPEG; 1 si no hay o no es JPEG. */
export function orientacionExif(b: Uint8Array): number {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 2;
  while (o + 4 < b.length) {
    if (b[o] !== 0xff) return 1;
    const marca = b[o + 1] as number;
    const tam = v.getUint16(o + 2);
    if (marca === 0xe1 && String.fromCharCode(...b.subarray(o + 4, o + 8)) === 'Exif') {
      const t = o + 10;
      const le = v.getUint16(t) === 0x4949;
      const ifd = t + v.getUint32(t + 4, le);
      const n = v.getUint16(ifd, le);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > b.length) break;
        if (v.getUint16(e, le) === 0x0112) {
          const val = v.getUint16(e + 8, le);
          return val >= 1 && val <= 8 ? val : 1;
        }
      }
      return 1;
    }
    if (marca === 0xda) return 1; // empieza la imagen
    o += 2 + tam;
  }
  return 1;
}

/**
 * Dibuja `fuente` (ancho × alto en su orientación cruda) en un lienzo
 * aplicando la orientación EXIF.
 */
export function dibujarOrientada(lienzo: Lienzo, fuente: unknown, anchoCrudo: number, altoCrudo: number, o: number): void {
  const { ctx, ancho, alto } = lienzo;
  const giraEjes = o >= 5;
  const w = giraEjes ? alto : ancho, h = giraEjes ? ancho : alto; // tamaño del dibujo antes de rotar
  switch (o) {
    case 2: ctx.setTransform(-1, 0, 0, 1, ancho, 0); break;
    case 3: ctx.setTransform(-1, 0, 0, -1, ancho, alto); break;
    case 4: ctx.setTransform(1, 0, 0, -1, 0, alto); break;
    case 5: ctx.setTransform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.setTransform(0, 1, -1, 0, ancho, 0); break;
    case 7: ctx.setTransform(0, -1, -1, 0, ancho, alto); break;
    case 8: ctx.setTransform(0, -1, 1, 0, 0, alto); break;
    default: ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.drawImage(fuente, 0, 0, anchoCrudo, altoCrudo, 0, 0, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export async function convertirImagenes(ctx: Contexto, fotos: ArchivoEntrada[], origen: OrigenArchivo, tipo: 'fotos' | 'imagen'): Promise<PaqueteConversion> {
  const { plataforma, op } = ctx;
  const origenes: OrigenArchivo[] = [];
  await ctx.emitir({ tipo: 'inicio', entrada: tipo, origen, unidades: fotos.length, metadatos: {} });
  const paginas: PaginaImagen[] = [];
  const noDecodificadas: string[] = [];
  let fisica = 0;
  for (const foto of fotos) {
    ctx.comprobar();
    fisica++;
    const d = detectar(foto.bytes, foto.nombre, foto.mime);
    origenes.push({ nombre: foto.nombre, mime: d.mime, bytes: foto.bytes.byteLength, huella: fotos.length === 1 ? origen.huella : await sha256(foto.bytes) });
    const exif = orientacionExif(foto.bytes);
    let img;
    try {
      img = await ctx.medir('decodificar', () => plataforma.decodificarImagen(foto.bytes, d.mime));
    } catch {
      noDecodificadas.push(foto.nombre);
      await ctx.aviso(`No se pudo decodificar ${foto.nombre} (${d.mime}) en ${plataforma.nombre}`);
      continue;
    }
    // Dimensiones ya orientadas.
    const girar = !img.orientada && exif >= 5;
    const anchoO = girar ? img.alto : img.ancho, altoO = girar ? img.ancho : img.alto;
    const e = Math.min(1, op.ladoEscaneada / Math.max(anchoO, altoO));
    const ancho = Math.max(1, Math.round(anchoO * e)), alto = Math.max(1, Math.round(altoO * e));
    const lienzo = plataforma.crearLienzo(ancho, alto);
    lienzo.ctx.fillStyle = '#ffffff';
    lienzo.ctx.fillRect(0, 0, ancho, alto);
    lienzo.ctx.imageSmoothingEnabled = true;
    lienzo.ctx.imageSmoothingQuality = 'high';
    dibujarOrientada(lienzo, img.fuente, img.ancho, img.alto, img.orientada ? 1 : exif);
    img.cerrar();
    const n = num4(fisica);
    const jpeg = await ctx.medir('codificar', () => plataforma.aJpeg(lienzo, op.calidadJpeg));
    const imagen = await ctx.parte(`paginas/${n}.jpg`, 'pagina', 'image/jpeg', jpeg, { unidad: fisica, ancho, alto });
    const em = op.ladoMiniatura / Math.max(ancho, alto);
    const mw = Math.max(1, Math.round(ancho * em)), mh = Math.max(1, Math.round(alto * em));
    const mini = plataforma.crearLienzo(mw, mh);
    mini.ctx.imageSmoothingEnabled = true;
    mini.ctx.imageSmoothingQuality = 'high';
    mini.ctx.drawImage(lienzo.nativo, 0, 0, ancho, alto, 0, 0, mw, mh);
    const miniatura = await ctx.parte(`miniaturas/${n}.jpg`, 'miniatura', 'image/jpeg', await plataforma.aJpeg(mini, 0.7), { unidad: fisica, ancho: mw, alto: mh });
    const pagina: PaginaImagen = { fisica, nombre: foto.nombre, anchoOriginal: anchoO, altoOriginal: altoO, ancho, alto, orientacionExif: exif, imagen, miniatura };
    paginas.push(pagina);
    await ctx.emitir({ tipo: 'pagina_imagen', pagina });
    await ctx.emitir({ tipo: 'progreso', fase: 'paginas', hechas: fisica, total: fotos.length });
  }
  return {
    version: VERSION_PAQUETE,
    tipo,
    origen,
    ...(fotos.length > 1 ? { origenes } : {}),
    metadatos: {},
    unidades: paginas.length,
    contenido: { clase: 'imagenes', paginas },
    partes: ctx.partes,
    reserva: noDecodificadas.length ? { motivo: `Formatos que ${plataforma.nombre} no decodifica (HEIC, TIFF…)`, tareas: ['decodificar_imagenes', ...noDecodificadas.map((n) => `imagen:${n}`)] } : null,
    avisos: ctx.avisos,
    entorno: plataforma.nombre,
    tiempos: ctx.cerrarTiempos(),
  };
}
