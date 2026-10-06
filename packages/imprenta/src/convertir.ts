/**
 * La puerta común: `crearConvertidor(plataforma)` devuelve el `convertir()`
 * progresivo de esa plataforma. Navegador y Node exportan el suyo.
 */

import { sha256 } from '@scholaris/nucleo';
import { Canal, Contexto, resolverOpciones } from './contexto.js';
import { compararNombres, detectar, type Deteccion } from './detectar.js';
import { convertirDocumento } from './documentos/convertir-documento.js';
import { convertirHoja } from './documentos/hoja.js';
import { convertirPresentacion } from './documentos/presentacion.js';
import { convertirImagenes } from './imagenes.js';
import { convertirMedio } from './medios/convertir-medio.js';
import { convertirPdf } from './pdf/convertir-pdf.js';
import type { Plataforma } from './plataforma.js';
import type { ArchivoEntrada, EventoConversion, OpcionesConversion, OrigenArchivo, PaqueteConversion, PaqueteEnMemoria } from './tipos.js';
import { VERSION_PAQUETE } from './tipos.js';

export type Convertir = (archivo: ArchivoEntrada, opciones?: OpcionesConversion) => AsyncGenerator<EventoConversion>;

export async function origenDe(archivo: ArchivoEntrada, d: Deteccion): Promise<OrigenArchivo> {
  return { nombre: archivo.nombre, mime: d.mime, bytes: archivo.bytes.byteLength, huella: await sha256(archivo.bytes) };
}

async function despachar(ctx: Contexto, archivo: ArchivoEntrada, opciones: OpcionesConversion): Promise<PaqueteConversion> {
  const d = detectar(archivo.bytes, archivo.nombre, archivo.mime);
  const tipo = opciones.tipo ?? (opciones.fotos && opciones.fotos.length > 1 ? 'fotos' : d.tipo);
  const origen = await ctx.medir('huella', () => origenDe(archivo, d));
  switch (tipo) {
    case 'pdf':
    case 'pdf_escaneado':
      return convertirPdf(ctx, archivo.bytes, origen);
    case 'fotos':
    case 'imagen': {
      const fotos = [...(opciones.fotos ?? [archivo])].sort((a, b) => compararNombres(a.nombre, b.nombre));
      return convertirImagenes(ctx, fotos, origen, tipo);
    }
    case 'audio':
    case 'video':
      return convertirMedio(ctx, archivo, d, origen, tipo);
    case 'documento':
    case 'epub':
      return convertirDocumento(ctx, archivo, d, origen);
    case 'presentacion':
      return convertirPresentacion(ctx, archivo, d, origen);
    case 'hoja':
      return convertirHoja(ctx, archivo, d, origen);
    case 'web':
      await ctx.emitir({ tipo: 'inicio', entrada: 'web', origen, unidades: null, metadatos: { autores: [] } });
      return {
        version: VERSION_PAQUETE, tipo: 'web', origen, metadatos: {}, unidades: 0,
        contenido: { clase: 'web', url: archivo.nombre, consultada: new Date().toISOString(), bloques: [], esquema: [] },
        partes: [], reserva: { motivo: 'Las páginas web las descarga el servidor (CORS).', tareas: ['web'] },
        avisos: ctx.avisos, entorno: ctx.plataforma.nombre, tiempos: ctx.cerrarTiempos(),
      };
  }
}

export function crearConvertidor(plataforma: Plataforma): Convertir {
  return async function* convertir(archivo, opciones = {}) {
    const canal = new Canal<EventoConversion>(64);
    const ctx = new Contexto(plataforma, resolverOpciones(opciones, plataforma), canal);
    const trabajo = despachar(ctx, archivo, opciones).then(
      async (paquete) => {
        await canal.poner({ tipo: 'fin', paquete });
        canal.cerrar();
      },
      (e) => canal.cerrar(e ?? new Error('Conversión fallida')),
    );
    try {
      yield* canal;
    } finally {
      canal.cerrar();
      await trabajo.catch(() => {});
    }
  };
}

/** Recorre la conversión entera y la devuelve en memoria (pruebas, banco, reserva del servidor). */
export async function recolectar(eventos: AsyncIterable<EventoConversion>, alEvento?: (e: EventoConversion) => void): Promise<PaqueteEnMemoria> {
  const datos = new Map<string, Uint8Array>();
  let paquete: PaqueteConversion | null = null;
  for await (const e of eventos) {
    alEvento?.(e);
    if (e.tipo === 'parte') datos.set(e.parte.id, e.datos);
    else if (e.tipo === 'fin') paquete = e.paquete;
  }
  if (!paquete) throw new Error('La conversión terminó sin paquete');
  return { paquete, datos };
}
