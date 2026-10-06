/** Fakes de los puertos y constructores de paquetes para las pruebas. */
import { comprobarParametros, sqlConLimite, type Embebedor, type Inteligencia, type Lector, type PaginaLeida, type Redactor, type SQL, type Transcriptor, type ValorSQL } from '@scholaris/nucleo';
import type { PaginaPdf, PaqueteConversion } from '@scholaris/imprenta';
import type { FuentePaquete } from '../src/tipos.js';

export function paginaPdf(fisica: number, cuerpo: string, extra: Partial<PaginaPdf> = {}): PaginaPdf {
  const bloques = cuerpo.split(/\n\s*\n/).map((texto, i) => ({ x: 0.1, y: 0.1 + i * 0.1, w: 0.8, h: 0.05, lineas: [], texto, tam: 10 }));
  return {
    fisica, ancho: 595, alto: 842, rotacion: 0, etiqueta: null, clase: 'pdf',
    texto: { util: cuerpo.length > 60, calidad: 0.95, origen: cuerpo ? 'digital' : 'ninguno', caracteres: cuerpo.length, basura: 0, palabrasRaras: 0, coberturaImagen: 0 },
    cuerpo, lineas: [], bloques, cabecera: [], pie: [], candidatosFolio: [], imagenes: [], imagen: `paginas/${String(fisica).padStart(4, '0')}.jpg`, ms: 1,
    ...extra,
  };
}

export function paquetePdf(paginas: PaginaPdf[], extra: Partial<PaqueteConversion> = {}): PaqueteConversion {
  return {
    version: 1, tipo: 'pdf', origen: { nombre: 'prueba.pdf', mime: 'application/pdf', bytes: 1000, huella: 'abc' },
    metadatos: {}, unidades: paginas.length,
    contenido: { clase: 'pdf', paginas, esquema: [], etiquetas: null, mixto: false, paginasEscaneadas: [], titulillos: { cabecera: [], pie: [] }, info: {}, xmp: null, cifrado: false },
    partes: [], reserva: null, avisos: [], entorno: 'node', tiempos: {},
    ...extra,
  };
}

export const fuenteFalsa: FuentePaquete = {
  async parte(id) { return { bytes: new TextEncoder().encode(id), mime: 'image/jpeg' }; },
  async subPdf() { return new Uint8Array([1, 2, 3]); },
};

export function lectorFalso(nombre: string, fn: (desde: number, hasta: number) => PaginaLeida[] | Promise<PaginaLeida[]>): Lector & { llamadas: Array<[number, number]> } {
  const llamadas: Array<[number, number]> = [];
  return {
    nombre, llamadas,
    async leerPliego(e) {
      const n = e.imagenes?.length ?? 0;
      // El fake no sabe cuántas páginas trae un PDF: lo deduce de la pista «desde-hasta».
      const [d, h] = (e.pista ?? '').split('-').map(Number);
      const desde = e.primeraFisica, hasta = n ? desde + n - 1 : (h ?? desde);
      llamadas.push([desde, hasta]);
      void d;
      return fn(desde, hasta);
    },
  };
}

export function paginaLeida(fisica: number, texto: string, extra: Partial<PaginaLeida> = {}): PaginaLeida {
  return { fisica, texto, notas: [], cabecera: '', pie: '', folio: null, titulos: [], figuras: [], vacia: false, confianza: 0.95, ...extra };
}

export function redactorFalso(fn: (texto: string) => unknown): Redactor & { llamadas: number } {
  const r = {
    nombre: 'redactor-falso', llamadas: 0,
    async generar<T>(p: Parameters<Redactor['generar']>[0]) {
      r.llamadas++;
      const texto = p.mensajes.flatMap((m) => m.partes).map((x) => ('texto' in x ? x.texto : '')).join('\n');
      const json = fn(texto) as T;
      return { texto: JSON.stringify(json), json };
    },
  };
  return r;
}

export const embebedorFalso: Embebedor = {
  espacio: { id: 'falso@4', proveedor: 'pruebas', modelo: 'falso', dims: 4, normalizado: true, modalidades: ['texto', 'imagen'] },
  admite: () => true,
  async vectorizar(piezas) { return piezas.map((_, i) => new Float32Array([i, 1, 0, 0])); },
};

export function inteligenciaFalsa(over: Partial<Inteligencia> = {}): Inteligencia {
  const transcriptor: Transcriptor = { nombre: 'asr-falso', async transcribir() { return { palabras: [], texto: '' }; } };
  return {
    lector: lectorFalso('lector-falso', (d, h) => Array.from({ length: h - d + 1 }, (_, i) => paginaLeida(d + i, `Texto de la página ${d + i}.`))),
    embebedor: embebedorFalso,
    transcriptor,
    reordenador: { nombre: 'r', async reordenar(_, t) { return t.map(() => 0); } },
    juez: { nombre: 'j', async juzgar() { return {}; } },
    redactor: redactorFalso(() => ({})),
    ...over,
  };
}

export class SqlFalso implements SQL {
  filas: Record<string, ValorSQL[][]> = {};
  async ejecutar<T>(consulta: string, ...p: ValorSQL[]): Promise<T[]> {
    comprobarParametros(consulta, p);
    if (/SELECT dims FROM espacios/.test(consulta)) return [{ dims: 4 } as T];
    const m = /INSERT (?:OR \w+ )?INTO (\w+)/.exec(consulta);
    if (m) (this.filas[m[1] as string] ??= []).push(p);
    return [];
  }
  async transaccion<T>(fn: (sql: SQL) => Promise<T>): Promise<T> { return fn(this); }
}

/** Una base SPDF 4.0 de verdad (sqlite-wasm en memoria) para probar la tubería. */
export async function baseReal() {
  const { crearSpdf } = await import('@scholaris/spdf');
  const archivo = await crearSpdf();
  // Como D1 y los Durable Objects: más de 100 parámetros en una sentencia es un error.
  const sql = sqlConLimite(archivo.sql);
  const filas = async <T = Record<string, unknown>>(q: string, ...p: Array<string | number | null>) => sql.ejecutar<T>(q, ...p);
  return { archivo, sql, filas };
}
