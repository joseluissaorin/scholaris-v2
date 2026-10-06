/**
 * `pnpm bench ingesta <archivo> [--digital capa|vision|auto] [--pliego N] [--concurrencia N] [--sin-contexto] [--tramo S]`
 *
 * Convierte con la imprenta (Node), ingiere con APIs reales y escribe el SPDF 4.0
 * en bench/datos/salida/ con un informe JSON de tiempos, coste y recuentos.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { convertirEnMemoria, abrirCortador, type PaqueteEnMemoria, type OpcionesConversion } from '@scholaris/imprenta/node';
import { crearInteligencia, type UsoProveedor } from '@scholaris/proveedores';
import { crearSpdf } from '@scholaris/spdf';
import { ejecutarIngesta, type FuentePaquete, type OpcionesOrquestador } from '@scholaris/ingesta';
import { sha256, type Progreso, type Transcripcion, type Transcriptor } from '@scholaris/nucleo';
import { cargarEntorno } from './entorno.js';

export const RAIZ = resolve(import.meta.dirname, '..');
export const SALIDA = join(RAIZ, 'datos', 'salida');

export interface OpcionesBanco {
  digital?: 'capa' | 'vision' | 'auto';
  pliego?: number;
  concurrencia?: number;
  sinContexto?: boolean;
  tramo?: number;
  etiqueta?: string;
  pista?: string;
  sinFiguras?: boolean;
  /** Incrustar el original en el SPDF (blobs). */
  original?: boolean;
  /** Lector: 'alta' (3.8 Flash primero) o 'rapida' (Flash-Lite primero). Por defecto, alta solo para escaneados y fotos. */
  lector?: 'alta' | 'rapida';
  sinVista?: boolean;
  vista?: 'todas' | 'utiles' | 'ninguna';
  modo?: 'rapido' | 'economico';
  /** Reutilizar transcripciones ya hechas (bench/datos/cache): por defecto sí. */
  cacheTranscripciones?: boolean;
}

/** Las transcripciones cuestan dinero y minutos: en el banco se guardan por huella del audio. */
export function transcriptorConCache(t: Transcriptor): Transcriptor {
  const dir = join(RAIZ, 'datos', 'cache', 'transcripciones');
  return {
    nombre: t.nombre,
    async transcribir(audio, opciones = {}) {
      const clave = await sha256(new Uint8Array([...new TextEncoder().encode(JSON.stringify({ n: t.nombre, d: audio.desplazamiento ?? 0, o: opciones })), ...audio.bytes.subarray(0, 2_000_000)]));
      const ruta = join(dir, `${clave}.json`);
      try { return JSON.parse(await readFile(ruta, 'utf8')) as Transcripcion; } catch { /* no está */ }
      const r = await t.transcribir(audio, opciones);
      await mkdir(dir, { recursive: true });
      await writeFile(ruta, JSON.stringify(r));
      return r;
    },
  };
}

export function fuenteEnMemoria(m: PaqueteEnMemoria, original: Uint8Array | null): FuentePaquete {
  const mimes = new Map(m.paquete.partes.map((p) => [p.id, p.mime]));
  let cortador: ReturnType<typeof abrirCortador> | null = null;
  const imagenes = new Map<string, Promise<Awaited<ReturnType<typeof loadImage>>>>();
  return {
    async parte(id) {
      const bytes = m.datos.get(id);
      return bytes ? { bytes, mime: mimes.get(id) ?? 'application/octet-stream' } : null;
    },
    ...(original && m.paquete.contenido.clase === 'pdf'
      ? {
          async subPdf(desde: number, hasta: number) {
            cortador ??= abrirCortador(original);
            return (await cortador).cortar(desde, hasta);
          },
        }
      : {}),
    async recorte(id, r) {
      const bytes = m.datos.get(id);
      if (!bytes) return null;
      let p = imagenes.get(id);
      if (!p) { p = loadImage(Buffer.from(bytes)); imagenes.set(id, p); }
      const img = await p;
      const x = Math.max(0, Math.floor(r.x * img.width)), y = Math.max(0, Math.floor(r.y * img.height));
      const w = Math.max(8, Math.min(img.width - x, Math.ceil(r.w * img.width))), h = Math.max(8, Math.min(img.height - y, Math.ceil(r.h * img.height)));
      const c = createCanvas(w, h);
      c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
      return { bytes: new Uint8Array(await c.encode('jpeg', 85)), mime: 'image/jpeg' };
    },
  };
}

export async function ingerir(ruta: string, o: OpcionesBanco = {}) {
  const nombre = basename(ruta).replace(/\.[^.]+$/, '');
  const etiqueta = o.etiqueta ?? nombre;
  await mkdir(SALIDA, { recursive: true });
  const t0 = Date.now();
  const original = new Uint8Array(await readFile(ruta));

  // 1. Imprenta (en la nube la hace el navegador del usuario: se mide aparte).
  const opcionesImprenta: OpcionesConversion = { ...(o.tramo ? { tramo: o.tramo } : {}) };
  const enMemoria = await convertirEnMemoria(ruta, opcionesImprenta);
  const msImprenta = Date.now() - t0;
  const paquete = enMemoria.paquete;
  console.error(`[${etiqueta}] imprenta: ${paquete.tipo}, ${paquete.unidades} unidades, ${enMemoria.datos.size} partes, ${(msImprenta / 1000).toFixed(1)} s`);

  // 2. Inteligencia con contador de uso.
  const usos: UsoProveedor[] = [];
  // Escaneados y fotos (CER 0,007 con 3.8 Flash frente a 0,021 con Flash-Lite en el Casamiento):
  // calidad alta. Digitales y capas de OCR que se releen: Flash-Lite, igual de bueno y 3 veces más rápido.
  const calidadLector = o.lector ?? (paquete.tipo === 'pdf_escaneado' || paquete.tipo === 'fotos' || paquete.tipo === 'imagen' ? 'alta' : 'rapida');
  const pasos: Record<string, number> = {};
  const muestras: string[] = [];
  const ia = crearInteligencia(cargarEntorno(), {
    onUso: (u) => usos.push(u), concurrencia: 48, calidadLector,
    alPasarLector: (i) => { const k = `${i.lector.split(':').pop()} → ${i.motivo.slice(0, 80)}`; pasos[k] = (pasos[k] ?? 0) + i.paginas.length; if (muestras.length < 5 && /red/.test(i.motivo)) muestras.push(i.motivo.slice(0, 400)); },
  });
  if (o.cacheTranscripciones !== false) ia.transcriptor = transcriptorConCache(ia.transcriptor);
  const archivo = await crearSpdf({ generador: 'scholaris-nube/bench' });
  const fuente = fuenteEnMemoria(enMemoria, original);

  let ultimo = 0;
  const progreso: Progreso[] = [];
  let busqueda: Promise<{ ms: number; palabra: string; resultados: number } | null> | null = null;
  const tIngesta = Date.now();
  const opciones: OpcionesOrquestador = {
    ...(o.digital ? { digital: o.digital } : {}),
    ...(o.pliego ? { paginasPorPliego: o.pliego } : {}),
    ...(o.concurrencia ? { concurrencia: o.concurrencia } : {}),
    ...(o.sinContexto ? { sinContexto: true } : {}),
    ...(o.pista ? { pista: o.pista } : {}),
    ...(o.sinFiguras ? { describirFiguras: false } : {}),
    ...(o.sinVista ? { vectorPorPagina: false } : {}),
    ...(o.vista ? { vistaPaginas: o.vista } : {}),
    ...(o.modo ? { modo: o.modo } : {}),
    // Primera búsqueda útil: en cuanto hay unidades buscables, se pregunta al índice léxico.
    alUnidades: (_d: number, _h: number, buscables: boolean) => {
      if (!buscables || busqueda) return;
      busqueda = (async () => {
        const filas = await archivo.sql.ejecutar<{ texto: string }>('SELECT texto FROM fragmentos ORDER BY length(texto) DESC LIMIT 1');
        const palabra = (filas[0]?.texto ?? '').match(/\p{L}{7,}/gu)?.[0];
        if (!palabra) return null;
        const t = Date.now() - tIngesta;
        const hits = await archivo.sql.ejecutar('SELECT rowid FROM fragmentos_fts WHERE fragmentos_fts MATCH ? LIMIT 20', `"${palabra}"`);
        return { ms: t, palabra, resultados: hits.length };
      })().catch(() => null);
    },
    onProgreso: (p) => {
      progreso.push(p);
      const ahora = Date.now();
      if (ahora - ultimo > 2000 || p.fase === 'listo') {
        ultimo = ahora;
        console.error(`[${etiqueta}] ${(p.transcurrido / 1000).toFixed(1)} s ${p.fase} ${(p.total * 100).toFixed(0)} % legibles ${p.unidadesListas ?? 0} buscables ${p.unidadesBuscables ?? 0} ${p.mensaje ?? ''}`);
      }
    },
  };
  const r = await ejecutarIngesta(paquete, { inteligencia: ia, fuente, sql: archivo.sql, correoContacto: 'jl@joseluissaorin.com' }, opciones);
  const msIngesta = Date.now() - tIngesta;

  // 3. Blobs: miniaturas, fotogramas y figuras (el SPDF se ve sin el original); el original, opcional.
  for (const p of paquete.partes) {
    if (p.clase === 'miniatura' || p.clase === 'fotograma' || p.clase === 'figura') {
      const b = enMemoria.datos.get(p.id);
      if (b) await archivo.ponerBlob(p.id, p.mime, b);
    }
  }
  if (o.original) await archivo.ponerBlob('original', paquete.origen.mime, original);
  await archivo.optimizarIndice();
  const bytes = archivo.exportar();
  const rutaSpdf = join(SALIDA, `${etiqueta}.spdf`);
  await writeFile(rutaSpdf, bytes);
  // Copia sin comprimir para inspeccionar con sqlite3.
  await writeFile(join(SALIDA, `${etiqueta}.sqlite`), archivo.exportarSqlite());

  const uso = ia.contador.detalle();
  const total = ia.contador.total();
  const informe = {
    archivo: basename(ruta),
    etiqueta,
    opciones: { ...o, lector: calidadLector },
    tipo: paquete.tipo,
    unidades: r.unidades.length,
    duracion: paquete.duracion ?? null,
    ms: { imprenta: msImprenta, ingesta: msIngesta, total: msImprenta + msIngesta, fases: r.tiempos },
    usd: total.usd,
    llamadas: total.llamadas,
    uso,
    plan: { pliegos: r.plan.pliegos.length, vision: r.plan.vias.filter((v) => v === 'vision').length, capa: r.plan.vias.filter((v) => v === 'capa').length, tramos: r.plan.tramos.length, notas: r.plan.notas },
    metadatos: r.documento.metadatos,
    secciones: r.secciones.length,
    fragmentos: r.fragmentos.length,
    figuras: r.figuras.length,
    vectores: r.vectores,
    avisos: r.avisos.slice(0, 50),
    cascada: pasos,
    erroresRed: muestras,
    folios: r.unidades.reduce<Record<string, number>>((m, u) => { const a = u.ancla; const k = a?.tipo === 'pagina' ? a.origen : a?.tipo ?? 'sin'; m[k] = (m[k] ?? 0) + 1; return m; }, {}),
    bytesSpdf: bytes.length,
    primeraUnidadMs: progreso.find((p) => (p.unidadesListas ?? 0) > 0)?.transcurrido ?? null,
    hitos: { primeraLegible: r.tiempos.primeraLegible, primeraBuscable: r.tiempos.primeraBuscable, todoBuscable: r.tiempos.todoBuscable, lecturaCompleta: r.tiempos.lecturaCompleta, consolidacion: r.tiempos.consolidacion, listo: r.tiempos.total },
    primeraBusqueda: busqueda ? await busqueda : null,
  };
  await writeFile(join(SALIDA, `${etiqueta}.informe.json`), JSON.stringify(informe, null, 2));
  await mkdir(join(SALIDA, 'historial'), { recursive: true });
  await writeFile(join(SALIDA, 'historial', `${etiqueta}.${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ ...informe, procedencia: r.procedencia.filter((p) => p.ms > 5000 || p.fase !== 'lectura') }, null, 2));
  archivo.cerrar();
  console.error(`[${etiqueta}] LISTO en ${((msImprenta + msIngesta) / 1000).toFixed(1)} s (ingesta ${(msIngesta / 1000).toFixed(1)} s), ${total.llamadas} llamadas, ${total.usd.toFixed(4)} $ → ${rutaSpdf}`);
  void gzipSync;
  return informe;
}
