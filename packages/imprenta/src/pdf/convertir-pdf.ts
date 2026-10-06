/**
 * PDF → paquete. El hilo de la conversión abre el documento para la ficha, los
 * marcadores y las etiquetas; las páginas las procesa un grupo de trabajadores
 * (o este mismo hilo) y salen en cuanto están listas.
 */

import { enParalelo } from '@scholaris/nucleo';
import type { Contexto } from '../contexto.js';
import { num4 } from '../contexto.js';
import type { MotorPdf, Plataforma } from '../plataforma.js';
import type { ContenidoPdf, MetadatosIncrustados, OrigenArchivo, PaginaPdf, PaqueteConversion } from '../tipos.js';
import { VERSION_PAQUETE } from '../tipos.js';
import { construirCapa, detectarTitulillos, diagnosticar } from './capa-texto.js';
import { buscarDoi, leerEsquema, leerEtiquetas, leerFicha } from './documento.js';
import { procesarPaginaCruda, type OpcionesPaginaCruda, type PaginaCruda } from './pagina-cruda.js';

/** Motor en el mismo hilo (sin trabajadores). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function motorLocal(plataforma: Plataforma, lib: { OPS: Record<string, number> }, doc: any): MotorPdf {
  return {
    hilos: 1,
    procesar: (fisica, op) => procesarPaginaCruda(plataforma, lib, doc, fisica, op),
    cerrar: async () => {},
  };
}

/** Convierte una página cruda en la página del manifiesto (y emite sus partes). */
export async function armarPagina(ctx: Contexto, c: PaginaCruda, etiqueta: string | null): Promise<PaginaPdf> {
  const texto = diagnosticar(c.items, c.cobertura);
  const capa = construirCapa(c.items, c.ancho, c.alto);
  const n = num4(c.fisica);
  let imagen: string | undefined, miniatura: string | undefined;
  if (c.jpeg) imagen = await ctx.parte(`paginas/${n}.jpg`, 'pagina', 'image/jpeg', c.jpeg.bytes, { unidad: c.fisica, ancho: c.jpeg.ancho, alto: c.jpeg.alto });
  if (c.miniatura) miniatura = await ctx.parte(`miniaturas/${n}.jpg`, 'miniatura', 'image/jpeg', c.miniatura.bytes, { unidad: c.fisica, ancho: c.miniatura.ancho, alto: c.miniatura.alto });
  const imagenes: PaginaPdf['imagenes'] = c.imagenes.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  let k = 0;
  for (const f of c.figuras) {
    const id = await ctx.parte(`figuras/${n}-${++k}.jpg`, 'figura', 'image/jpeg', f.imagen.bytes, { unidad: c.fisica, ancho: f.imagen.ancho, alto: f.imagen.alto });
    const destino = imagenes.find((r) => r.x === f.region.x && r.y === f.region.y && r.w === f.region.w && r.h === f.region.h);
    if (destino) destino.parte = id;
  }
  return {
    fisica: c.fisica,
    ancho: Math.round(c.ancho * 100) / 100,
    alto: Math.round(c.alto * 100) / 100,
    rotacion: c.rotacion,
    etiqueta,
    clase: texto.util ? 'pdf' : 'pdf_escaneado',
    texto,
    cuerpo: capa.cuerpo,
    lineas: capa.lineas,
    bloques: capa.bloques,
    cabecera: capa.cabecera,
    pie: capa.pie,
    candidatosFolio: capa.candidatosFolio,
    imagenes,
    ...(imagen ? { imagen } : {}),
    ...(miniatura ? { miniatura } : {}),
    ms: Math.round(c.ms.total),
  };
}

export async function convertirPdf(ctx: Contexto, bytes: Uint8Array, origen: OrigenArchivo): Promise<PaqueteConversion> {
  const { plataforma, op } = ctx;
  const { lib, parametros } = await plataforma.pdfjs();
  // pdf.js se queda con el buffer que le pasas: le damos una copia.
  const doc = await ctx.medir('abrir', async () => lib.getDocument({ ...parametros, data: bytes.slice() }).promise);
  const total: number = doc.numPages;
  const [ficha, esquema, etiquetas] = await ctx.medir('ficha', () => Promise.all([leerFicha(doc), leerEsquema(doc), leerEtiquetas(doc)]));
  const cifrado = Boolean(ficha.info.EncryptFilterName);
  const metadatos: MetadatosIncrustados = ficha.metadatos;
  await ctx.emitir({ tipo: 'inicio', entrada: 'pdf', origen, unidades: total, metadatos });

  const lista = (op.paginas ?? Array.from({ length: total }, (_, i) => i + 1)).filter((p) => p >= 1 && p <= total);
  // Arrancar un trabajador cuesta (pdf.js + el documento): uno por cada ~25
  // páginas como mucho; con pocos, en este mismo hilo.
  let hilos = Math.min(op.hilos, lista.length);
  if (op.hilosAuto) {
    hilos = Math.min(hilos, Math.ceil(lista.length / 25));
    if (hilos <= 1) hilos = 0;
  }
  const motor = hilos > 0 ? await ctx.medir('trabajadores', () => plataforma.motorPdf(bytes, hilos)) : motorLocal(plataforma, lib, doc);
  const opPagina: OpcionesPaginaCruda = {
    ladoEscaneada: op.ladoEscaneada,
    ladoDigital: op.ladoDigital,
    ladoMiniatura: op.ladoMiniatura,
    calidad: op.calidadJpeg,
    recortarFiguras: op.recortarFiguras,
  };

  const paginas: PaginaPdf[] = [];
  let hechas = 0;
  const tPaginas = performance.now();
  const msRender = { texto: 0, operadores: 0, render: 0, codificar: 0 };
  try {
    // Dos páginas en vuelo por trabajador para que ninguno espere.
    await enParalelo(lista, Math.max(1, motor.hilos * 2), async (fisica) => {
      ctx.comprobar();
      const cruda = await motor.procesar(fisica, opPagina);
      msRender.texto += cruda.ms.texto; msRender.operadores += cruda.ms.operadores;
      msRender.render += cruda.ms.render; msRender.codificar += cruda.ms.codificar;
      const pagina = await armarPagina(ctx, cruda, etiquetas?.[fisica - 1] ?? null);
      paginas.push(pagina);
      await ctx.emitir({ tipo: 'pagina_pdf', pagina });
      await ctx.emitir({ tipo: 'progreso', fase: 'paginas', hechas: ++hechas, total: lista.length });
    });
  } finally {
    await motor.cerrar();
  }
  ctx.tiempos.paginas = Math.round(performance.now() - tPaginas);
  for (const [k, v] of Object.entries(msRender)) ctx.tiempos[`paginas.${k}`] = Math.round(v);
  paginas.sort((a, b) => a.fisica - b.fisica);

  // DOI en el texto de las primeras páginas (si la ficha no lo traía).
  const doiTexto = buscarDoi(paginas.slice(0, 3).map((p) => [p.cuerpo, ...p.cabecera.map((l) => l.texto), ...p.pie.map((l) => l.texto)].join('\n')).join('\n'));
  if (doiTexto) {
    metadatos.doiEnTexto = doiTexto;
    if (!metadatos.doi) {
      metadatos.doi = doiTexto;
      metadatos.procedencia = { ...metadatos.procedencia, doi: { fuente: 'pdf', confianza: 0.75 } };
    }
  }

  const escaneadas = paginas.filter((p) => p.clase === 'pdf_escaneado').map((p) => p.fisica);
  const contenido: ContenidoPdf = {
    clase: 'pdf',
    paginas,
    esquema,
    etiquetas,
    mixto: escaneadas.length > 0 && escaneadas.length < paginas.length,
    paginasEscaneadas: escaneadas,
    titulillos: {
      cabecera: detectarTitulillos(paginas.map((p) => p.cabecera)),
      pie: detectarTitulillos(paginas.map((p) => p.pie)),
    },
    info: ficha.info,
    xmp: ficha.xmp,
    ...(ficha.version ? { version: ficha.version } : {}),
    cifrado,
  };
  await doc.loadingTask.destroy();
  // El documento es «escaneado» si lo son la mayoría de sus páginas; la clase por página manda.
  const tipo = escaneadas.length > paginas.length / 2 ? 'pdf_escaneado' : 'pdf';
  return {
    version: VERSION_PAQUETE,
    tipo,
    origen,
    metadatos,
    unidades: total,
    contenido,
    partes: ctx.partes,
    reserva: null,
    avisos: ctx.avisos,
    entorno: plataforma.nombre,
    tiempos: ctx.cerrarTiempos(),
  };
}
