/**
 * Llenar una biblioteca de golpe desde la web.
 *
 *  1. `prepararEntrada` convierte lo soltado (archivos, carpetas, zips, un .bib o
 *     .ris con la carpeta de Zotero, .spdf, enlaces) en elementos de lote: con la
 *     huella de cada archivo (los repetidos no se vuelven a leer) y los minutos de
 *     audio y vídeo medidos aquí.
 *  2. El servidor estima y crea el lote (los enlaces los lanza él).
 *  3. El conductor de esta pestaña sube los archivos con la imprenta del
 *     navegador, como mucho los que deja la concurrencia del lote, y apunta en
 *     cada elemento su documento y su tarea. Si se cierra la pestaña, el lote
 *     espera: al volver basta con soltar otra vez los archivos que faltan.
 */
import type { ElementoLote, ElementoNuevo, ModoIngesta } from '@scholaris/contrato';
import { abrirZip, EXTENSION_PAQUETE } from '@scholaris/contrato';
import { api } from './api';
import { deducirTipo, ingerirParaLote, sha256Archivo } from './ingesta';
import { clienteConsultas } from './consultas';
import { leerReferencias, nombreBase, type EntradaReferencia } from '../lib/referencias-exportadas';

/** Un archivo que se puede leer cuando toque (de lo soltado o de dentro de un zip). */
export interface Fuente {
  nombre: string;
  ruta: string;
  bytes: number;
  mime: string;
  leer(): Promise<File>;
}

export interface Preparacion {
  elementos: ElementoNuevo[];
  /** La fuente de cada elemento de archivo, por su posición en `elementos`. */
  fuentes: Map<number, Fuente>;
  /** Lo que no se pudo usar, con el motivo. */
  descartados: Array<{ nombre: string; motivo: string }>;
  /** Entradas de un .bib o .ris que no traían ni archivo ni enlace. */
  sinAdjunto: number;
}

const EXT_REFS = /\.(bib|ris)$/i;
const IGNORAR = /(^|\/)(\.ds_store|thumbs\.db|desktop\.ini|__macosx\/.*|\..*)$/i;

/** Recorre lo soltado (también carpetas, con su ruta relativa). */
export async function archivosDeSoltar(dt: DataTransfer): Promise<File[]> {
  const entradas = [...dt.items].map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!entradas.length) return [...dt.files];
  const salida: File[] = [];
  const recorrer = async (e: FileSystemEntry, ruta: string): Promise<void> => {
    if (e.isFile) {
      const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      Object.defineProperty(f, 'webkitRelativePath', { value: `${ruta}${f.name}` });
      salida.push(f);
    } else if (e.isDirectory) {
      const lector = (e as FileSystemDirectoryEntry).createReader();
      let lote: FileSystemEntry[];
      do {
        lote = await new Promise<FileSystemEntry[]>((res, rej) => lector.readEntries(res, rej));
        for (const x of lote) await recorrer(x, `${ruta}${e.name}/`);
      } while (lote.length);
    }
  };
  for (const e of entradas) await recorrer(e, '');
  return salida;
}

const rutaDe = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;

function fuenteDe(f: File): Fuente {
  return { nombre: f.name, ruta: rutaDe(f), bytes: f.size, mime: f.type, leer: async () => f };
}

/** Las entradas de un zip como fuentes (se descomprimen una a una, al subir). */
async function fuentesDeZip(f: File): Promise<Fuente[]> {
  const zip = await abrirZip(f);
  return zip.entradas.filter((e) => !e.nombre.endsWith('/') && !IGNORAR.test(e.nombre)).map((e) => {
    const nombre = e.nombre.split('/').pop()!;
    return {
      nombre, ruta: `${f.name}/${e.nombre}`, bytes: e.tamano, mime: '',
      leer: async () => new File([(await zip.leer(e)) as BlobPart], nombre),
    };
  });
}

/** Minutos de un audio o vídeo, medidos por el navegador (sin leerlo entero). */
function medirMinutos(f: File): Promise<number | undefined> {
  return new Promise((res) => {
    const url = URL.createObjectURL(f);
    const m = document.createElement(f.type.startsWith('video') ? 'video' : 'audio');
    const fin = (v?: number) => { URL.revokeObjectURL(url); res(v); };
    const reloj = setTimeout(() => fin(undefined), 4000);
    m.preload = 'metadata';
    m.onloadedmetadata = () => { clearTimeout(reloj); fin(Number.isFinite(m.duration) ? m.duration / 60 : undefined); };
    m.onerror = () => { clearTimeout(reloj); fin(undefined); };
    m.src = url;
  });
}

export async function prepararEntrada(archivos: File[], enlaces: string[], alAvance?: (hechos: number, total: number, que: string) => void): Promise<Preparacion> {
  const descartados: Preparacion['descartados'] = [];
  // 1. Lo soltado, con los zips abiertos (un .scholaris no es un lote: se importa como paquete).
  let fuentes: Fuente[] = [];
  const referencias: Array<{ nombre: string; entradas: EntradaReferencia[] }> = [];
  for (const f of archivos) {
    if (IGNORAR.test(rutaDe(f)) || f.name.startsWith('.')) continue;
    if (f.name.toLowerCase().endsWith(EXTENSION_PAQUETE)) { descartados.push({ nombre: f.name, motivo: 'Es un paquete de biblioteca: ábrelo con «Importar paquete».' }); continue; }
    if (/\.zip$/i.test(f.name)) {
      try { fuentes.push(...(await fuentesDeZip(f))); } catch (e) { descartados.push({ nombre: f.name, motivo: `No se pudo abrir el zip: ${(e as Error).message}` }); }
      continue;
    }
    if (EXT_REFS.test(f.name)) { referencias.push({ nombre: f.name, entradas: leerReferencias(f.name, await f.text()) }); continue; }
    fuentes.push(fuenteDe(f));
  }
  for (const f of [...fuentes]) {
    if (EXT_REFS.test(f.nombre)) {
      referencias.push({ nombre: f.nombre, entradas: leerReferencias(f.nombre, await (await f.leer()).text()) });
      fuentes = fuentes.filter((x) => x !== f);
    }
  }

  // 2. Con un .bib o .ris: cada entrada se empareja con su adjunto (por el nombre del fichero) y le da sus metadatos.
  const porNombre = new Map<string, Fuente>();
  for (const f of fuentes) porNombre.set(nombreBase(f.nombre), f);
  const metadatosDe = new Map<Fuente, EntradaReferencia>();
  const urlsDeReferencias: Array<{ url: string; e: EntradaReferencia }> = [];
  let sinAdjunto = 0;
  for (const r of referencias) {
    for (const e of r.entradas) {
      const f = e.ficheros.map((x) => porNombre.get(nombreBase(x))).find(Boolean);
      if (f) metadatosDe.set(f, e);
      else if (e.url) urlsDeReferencias.push({ url: e.url, e });
      else sinAdjunto++;
    }
  }

  // 3. Los elementos: huella de cada archivo (para los repetidos) y minutos de los medios.
  const elementos: ElementoNuevo[] = [];
  const mapa = new Map<number, Fuente>();
  const total = fuentes.length;
  let hechos = 0;
  const cola = [...fuentes];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cola.length) {
      const f = cola.shift()!;
      alAvance?.(hechos, total, f.nombre);
      const spdf = /\.spdf$/i.test(f.nombre);
      const archivo = await f.leer();
      const tipo = spdf ? undefined : deducirTipo(archivo);
      const e: ElementoNuevo = { clase: spdf ? 'spdf' : 'archivo', nombre: f.nombre, ruta: f.ruta, bytes: f.bytes, mime: archivo.type || 'application/octet-stream', ...(tipo ? { tipo } : {}) };
      if (archivo.size < 512 * 1024 ** 2) { const h = await sha256Archivo(archivo); if (h) e.huella = h; }
      if (tipo === 'audio' || tipo === 'video') { const m = await medirMinutos(archivo); if (m) e.minutos = Math.round(m * 10) / 10; }
      const ref = metadatosDe.get(f);
      if (ref) e.metadatos = ref.metadatos;
      mapa.set(elementos.length, f);
      elementos.push(e);
      hechos++;
    }
  }));
  alAvance?.(total, total, '');
  for (const u of [...enlaces, ...urlsDeReferencias.map((x) => x.url)]) {
    const url = u.trim();
    if (!/^https?:\/\//i.test(url)) { if (url) descartados.push({ nombre: url, motivo: 'No es un enlace http(s).' }); continue; }
    const ref = urlsDeReferencias.find((x) => x.url === url)?.e;
    elementos.push({ clase: 'url', nombre: url, url, ...(ref ? { metadatos: ref.metadatos } : {}) });
  }
  return { elementos, fuentes: mapa, descartados, sinAdjunto };
}

// ---------------------------------------------------------------------------
// El conductor
// ---------------------------------------------------------------------------

/** Las fuentes de cada lote en esta pestaña, por número de elemento. */
const fuentesPorLote = new Map<string, Map<number, Fuente>>();
const conductores = new Map<string, { parar: () => void }>();

export function registrarFuentes(lote: string, porNumero: Map<number, Fuente>) {
  const m = fuentesPorLote.get(lote) ?? new Map<number, Fuente>();
  for (const [n, f] of porNumero) m.set(n, f);
  fuentesPorLote.set(lote, m);
}

export const tieneFuente = (lote: string, n: number) => !!fuentesPorLote.get(lote)?.has(n);

/** Vuelve a casar archivos soltados con los elementos que esperan (por nombre y tamaño). */
export function reasociar(lote: string, elementos: ElementoLote[], archivos: File[]): number {
  const libres = [...archivos];
  const m = new Map<number, Fuente>();
  for (const e of elementos) {
    if (e.clase === 'url' || !['pendiente', 'subiendo', 'error', 'cancelado'].includes(e.estado)) continue;
    const i = libres.findIndex((f) => f.name === e.nombre && (e.bytes == null || f.size === e.bytes));
    if (i >= 0) { m.set(e.n, fuenteDe(libres[i]!)); libres.splice(i, 1); }
  }
  registrarFuentes(lote, m);
  return m.size;
}

/** Arranca (si no lo está) el conductor de un lote en esta pestaña. */
export function conducir(lote: string, opciones: { biblioteca?: string; modo: ModoIngesta; alCambiar?: () => void }) {
  if (conductores.has(lote)) return;
  let vivo = true;
  conductores.set(lote, { parar: () => { vivo = false; } });
  const enVuelo = new Set<number>();
  void (async () => {
    try {
      while (vivo) {
        const fuentes = fuentesPorLote.get(lote);
        if (!fuentes?.size) break;
        let pedidos: ElementoLote[] = [];
        try { pedidos = await api().lotes.siguientes(lote, 4); } catch { /* reintento abajo */ }
        for (const e of pedidos) {
          const f = fuentes.get(e.n);
          // Sin el archivo aquí (otra pestaña, otro día): se devuelve a la cola.
          if (!f) { await api().lotes.apuntar(lote, e.n, { estado: 'pendiente' }).catch(() => undefined); continue; }
          enVuelo.add(e.n);
          void subirElemento(lote, e, f, opciones).finally(() => { enVuelo.delete(e.n); fuentes.delete(e.n); opciones.alCambiar?.(); });
        }
        opciones.alCambiar?.();
        const quedan = [...fuentes.keys()].filter((n) => !enVuelo.has(n)).length;
        if (!quedan && !enVuelo.size) break;
        await new Promise((r) => setTimeout(r, pedidos.length ? 800 : 2500));
      }
    } finally {
      conductores.delete(lote);
      opciones.alCambiar?.();
    }
  })();
}

export const conduciendo = (lote: string) => conductores.has(lote);
export function pararConductor(lote: string) { conductores.get(lote)?.parar(); }

async function subirElemento(lote: string, e: ElementoLote, f: Fuente, o: { biblioteca?: string; modo: ModoIngesta }) {
  try {
    const archivo = await f.leer();
    if (e.clase === 'spdf') {
      const r = await api().documentos.importar(archivo, { ...(o.biblioteca ? { biblioteca: o.biblioteca } : {}), deduplicar: true });
      await api().lotes.apuntar(lote, e.n, r.repetido ? { estado: 'duplicado', documento: r.documento } : r.tarea ? { estado: 'procesando', documento: r.documento, tarea: r.tarea } : { estado: 'listo', documento: r.documento });
      void clienteConsultas.invalidateQueries({ queryKey: ['documentos'] });
      return;
    }
    const r = await ingerirParaLote(archivo, {
      ...(o.biblioteca ? { biblioteca: o.biblioteca } : {}), modo: o.modo, ...(e.huella ? { huella: e.huella } : {}),
      ...(e.metadatos ? { metadatos: e.metadatos as Record<string, unknown> } : {}),
      // El documento se apunta en cuanto existe: si la ingesta cierra antes, el lote ya sabe de quién es.
      alCrear: (documento) => void api().lotes.apuntar(lote, e.n, { estado: 'subiendo', documento }).catch(() => undefined),
    });
    if (r.duplicado) await api().lotes.apuntar(lote, e.n, { estado: 'duplicado', documento: r.duplicado });
    else if (r.error) await api().lotes.apuntar(lote, e.n, { estado: 'error', error: r.error });
    else await api().lotes.apuntar(lote, e.n, { estado: 'procesando', ...(r.documento ? { documento: r.documento } : {}), ...(r.tarea ? { tarea: r.tarea } : {}) });
  } catch (err) {
    await api().lotes.apuntar(lote, e.n, { estado: 'error', error: err instanceof Error ? err.message : 'Falló la subida.' }).catch(() => undefined);
  }
}

/** Formatea segundos como «unos 4 min», «unas 2 h». */
export function tiempoAproximado(seg: number): string {
  if (seg < 90) return 'menos de dos minutos';
  if (seg < 3600) return `unos ${Math.round(seg / 60)} min`;
  const h = seg / 3600;
  return h < 1.5 ? 'alrededor de una hora' : `unas ${Math.round(h)} h`;
}

export function euros(n: number): string {
  if (n < 0.01) return 'menos de un céntimo';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: n < 1 ? 2 : 2 }).format(n);
}
