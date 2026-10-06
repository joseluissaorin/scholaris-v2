/**
 * La mesa de entrada: todo lo que se está leyendo, con su avance en vivo.
 *
 * Por qué se siente rápida:
 *  1. La tarjeta aparece en el mismo fotograma en que se suelta el archivo.
 *  2. El original sube EN PARALELO a la conversión del navegador.
 *  3. Las miniaturas que rasteriza la imprenta se enseñan al instante, antes de
 *     que el servidor haya leído nada: el usuario ve sus páginas en segundos.
 *  4. Después, cada evento `unidades` del tiempo real marca páginas ya legibles.
 */
import { useSyncExternalStore } from 'react';
import { subirFichero, type EventoTiempoReal, type SubidaCreada } from '@scholaris/contrato';
import type { FaseIngesta, TipoEntrada } from '@scholaris/nucleo';
import type { ArchivoEntrada, EventoConversion, PaqueteConversion, ParteBinaria } from '@scholaris/imprenta';
import { api, esSimulado, escucharTiempoReal } from './api';
import { clienteConsultas } from './consultas';
import type { MensajeDesdeImprenta, MensajeHaciaImprenta } from '../trabajadores/imprenta.worker';

export type Etapa = 'preparando' | 'convirtiendo' | 'procesando' | 'listo' | 'error' | 'cancelada' | 'duplicado';

export interface Ingesta {
  id: string;
  nombre: string;
  tipo: TipoEntrada;
  bytes: number;
  documento?: string;
  tarea?: string;
  etapa: Etapa;
  fase?: FaseIngesta;
  /** 0-1 global. */
  avance: number;
  /** 0-1 de la subida del original. */
  subido: number;
  unidades: number | null;
  /** Unidades rasterizadas en el navegador. */
  preparadas: number;
  /** Unidades ya leídas por el servidor (buscables). */
  leidas: number;
  miniaturas: string[];
  mensaje?: string;
  error?: string;
  inicio: number;
  fin?: number;
}

// ---------------------------------------------------------------------------
// El almacén
// ---------------------------------------------------------------------------

let estado: Ingesta[] = [];
const oyentes = new Set<() => void>();
const emitir = () => oyentes.forEach((o) => o());

function poner(id: string, cambio: Partial<Ingesta> | ((i: Ingesta) => Partial<Ingesta>)) {
  estado = estado.map((i) => (i.id === id ? { ...i, ...(typeof cambio === 'function' ? cambio(i) : cambio) } : i));
  emitir();
}

export function useIngestas(): Ingesta[] {
  return useSyncExternalStore((o) => { oyentes.add(o); return () => oyentes.delete(o); }, () => estado, () => estado);
}

export function retirarIngesta(id: string) {
  const i = estado.find((x) => x.id === id);
  i?.miniaturas.forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u));
  estado = estado.filter((x) => x.id !== id);
  emitir();
}

const controles = new Map<string, { cancelar: () => void }>();

export async function cancelarIngesta(id: string) {
  const i = estado.find((x) => x.id === id);
  controles.get(id)?.cancelar();
  poner(id, { etapa: 'cancelada', fin: Date.now() });
  try {
    if (i?.tarea) await api().tareas.cancelar(i.tarea);
  } catch { /* ya terminó */ }
  setTimeout(() => retirarIngesta(id), 400);
  void clienteConsultas.invalidateQueries({ queryKey: ['documentos'] });
}

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

const EXT: Record<string, TipoEntrada> = {
  pdf: 'pdf', epub: 'epub', docx: 'documento', doc: 'documento', odt: 'documento', rtf: 'documento', md: 'documento', markdown: 'documento', txt: 'documento', html: 'documento', htm: 'documento',
  pptx: 'presentacion', key: 'presentacion', odp: 'presentacion', xlsx: 'hoja', xls: 'hoja', csv: 'hoja', ods: 'hoja', tsv: 'hoja',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', opus: 'audio', flac: 'audio', aac: 'audio',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', m4v: 'video',
  jpg: 'imagen', jpeg: 'imagen', png: 'imagen', webp: 'imagen', heic: 'imagen', heif: 'imagen', tif: 'imagen', tiff: 'imagen', gif: 'imagen',
};

export function deducirTipo(f: { name: string; type: string }): TipoEntrada {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (EXT[ext]) return EXT[ext]!;
  if (f.type.startsWith('image/')) return 'imagen';
  if (f.type.startsWith('audio/')) return 'audio';
  if (f.type.startsWith('video/')) return 'video';
  if (f.type === 'application/pdf') return 'pdf';
  return 'documento';
}

// ---------------------------------------------------------------------------
// La imprenta del navegador
// ---------------------------------------------------------------------------

interface Conversion {
  eventos: AsyncGenerator<EventoConversion | { tipo: 'no_disponible' }>;
  cancelar: () => void;
}

async function bytesDe(f: File): Promise<ArchivoEntrada> {
  return { nombre: f.name, mime: f.type || undefined, bytes: new Uint8Array(await f.arrayBuffer()) };
}

function convertirEnHilo(archivo: File, fotos?: File[]): Conversion {
  const hilo = new Worker(new URL('../trabajadores/imprenta.worker.ts', import.meta.url), { type: 'module', name: 'imprenta' });
  const cola: Array<MensajeDesdeImprenta> = [];
  let despertar: (() => void) | null = null;
  const TIPOS = new Set(['evento', 'no_disponible', 'fallo', 'hecho']);
  // Solo nuestros mensajes: pdf.js a veces anuncia su propio «ready».
  hilo.onmessage = (ev: MessageEvent<MensajeDesdeImprenta>) => { if (!TIPOS.has((ev.data as { tipo?: string })?.tipo ?? '')) return; cola.push(ev.data); despertar?.(); };
  hilo.onerror = (ev) => { cola.push({ tipo: 'fallo', mensaje: ev.message || 'La imprenta del navegador se detuvo' }); despertar?.(); };
  void (async () => {
    const msj: MensajeHaciaImprenta = { tipo: 'convertir', archivo: await bytesDe(archivo), ...(fotos ? { fotos: await Promise.all(fotos.map(bytesDe)) } : {}) };
    hilo.postMessage(msj, [msj.archivo.bytes.buffer as ArrayBuffer]);
  })();
  async function* eventos() {
    try {
      while (true) {
        while (!cola.length) await new Promise<void>((r) => (despertar = r));
        const m = cola.shift()!;
        if (m.tipo === 'evento') yield m.evento;
        else if (m.tipo === 'no_disponible') { yield { tipo: 'no_disponible' as const }; return; }
        else if (m.tipo === 'fallo') throw new Error(m.mensaje);
        else return;
      }
    } finally { hilo.terminate(); }
  }
  return { eventos: eventos(), cancelar: () => { hilo.postMessage({ tipo: 'cancelar' } satisfies MensajeHaciaImprenta); hilo.terminate(); } };
}

/** Qué entradas sabe convertir el navegador (lo demás lo hace el servidor). */
const CONVIERTE_NAVEGADOR = new Set<TipoEntrada>(['pdf', 'pdf_escaneado', 'fotos', 'imagen', 'audio', 'video', 'documento', 'epub', 'hoja', 'presentacion']);

// ---------------------------------------------------------------------------
// Subida de partes
// ---------------------------------------------------------------------------

async function ponerBytes(destino: SubidaCreada['original'], cuerpo: Blob) {
  if (esSimulado()) { await new Promise((r) => setTimeout(r, 20)); return; }
  if (destino.modo !== 'simple' || !destino.url) throw new Error('Recurso sin URL simple');
  const r = await fetch(destino.url, { method: 'PUT', body: cuerpo, headers: destino.cabeceras });
  if (!r.ok) throw new Error(`No se pudo subir un recurso (${r.status})`);
}

/** Sube partes en tandas: pide URLs por lotes y las sube con concurrencia limitada. */
function crearSubidorPartes(subida: string) {
  const pendientes: Array<{ parte: ParteBinaria; datos: Uint8Array }> = [];
  let enVuelo = Promise.resolve();
  let fallo: unknown = null;
  const vaciar = () => {
    if (!pendientes.length) return;
    const lote = pendientes.splice(0, 24);
    enVuelo = enVuelo.then(async () => {
      const { recursos } = await api().subidas.recursos(subida, { recursos: lote.map((x) => ({ ruta: x.parte.id, mime: x.parte.mime, bytes: x.parte.bytes })) });
      const porRuta = new Map(recursos.map((r) => [r.ruta, r.subida]));
      let i = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (i < lote.length) {
          const x = lote[i++]!;
          const d = porRuta.get(x.parte.id);
          if (d) await ponerBytes(d, new Blob([x.datos as BlobPart], { type: x.parte.mime }));
        }
      }));
    }).catch((e) => { fallo = e; });
  };
  return {
    anadir(parte: ParteBinaria, datos: Uint8Array) { pendientes.push({ parte, datos }); if (pendientes.length >= 24) vaciar(); },
    async terminar() { vaciar(); await enVuelo; if (fallo) throw fallo; },
  };
}

// ---------------------------------------------------------------------------
// El flujo de una ingesta
// ---------------------------------------------------------------------------

/** «the_discarded-image.pdf» → «The discarded image»: mientras no llegue el título de verdad. */
function nombreLegible(archivo: string): string {
  const base = archivo.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : archivo;
}

function nueva(nombre: string, tipo: TipoEntrada, bytes: number): Ingesta {
  const i: Ingesta = { id: `i-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, nombre, tipo, bytes, etapa: 'preparando', avance: 0, subido: 0, unidades: null, preparadas: 0, leidas: 0, miniaturas: [], inicio: Date.now(), mensaje: 'Preparando…' };
  estado = [i, ...estado];
  emitir();
  asegurarEscucha();
  return i;
}

/** Ingresa archivos. Varias fotos juntas (3 o más) se leen como las páginas de un mismo libro. */
export function ingerirArchivos(archivos: File[], opciones: { biblioteca?: string; fotosSueltas?: boolean } = {}): Ingesta[] {
  const imagenes = archivos.filter((f) => deducirTipo(f) === 'imagen');
  const resto = archivos.filter((f) => deducirTipo(f) !== 'imagen');
  const salida: Ingesta[] = [];
  if (imagenes.length >= 3 && !opciones.fotosSueltas) {
    const ordenadas = [...imagenes].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
    const total = ordenadas.reduce((s, f) => s + f.size, 0);
    const nombre = comunPrefijo(ordenadas.map((f) => f.name)) || `Libro fotografiado (${ordenadas.length} fotos)`;
    const i = nueva(nombre, 'fotos', total);
    i.unidades = ordenadas.length;
    void correr(i, ordenadas[0]!, opciones.biblioteca, ordenadas);
    salida.push(i);
  } else {
    resto.push(...imagenes);
  }
  for (const f of resto) {
    const i = nueva(nombreLegible(f.name), deducirTipo(f), f.size);
    void correr(i, f, opciones.biblioteca);
    salida.push(i);
  }
  return salida;
}

function comunPrefijo(nombres: string[]) {
  let p = nombres[0] ?? '';
  for (const n of nombres) while (!n.startsWith(p)) p = p.slice(0, -1);
  return p.replace(/[\s_\-.(]*\d*$/, '').trim();
}

export async function ingerirUrl(url: string, biblioteca?: string): Promise<Ingesta> {
  const tipo: TipoEntrada = /youtu\.?be|vimeo/.test(url) ? 'video' : /\.pdf($|\?)/i.test(url) ? 'pdf' : 'web';
  const i = nueva(url.replace(/^https?:\/\/(www\.)?/, ''), tipo, 0);
  try {
    poner(i.id, { mensaje: 'Pidiendo la página…', etapa: 'procesando' });
    const r = await api().subidas.desdeUrl({ url, ...(biblioteca ? { bibliotecas: [biblioteca] } : {}) });
    poner(i.id, { documento: r.documento, tarea: r.tarea, mensaje: 'Leyendo…' });
    void clienteConsultas.invalidateQueries({ queryKey: ['documentos'] });
  } catch (e) {
    poner(i.id, { etapa: 'error', error: mensajeDe(e) });
  }
  return i;
}

async function correr(i: Ingesta, archivo: File, biblioteca?: string, fotos?: File[]) {
  let conversion: Conversion | null = null;
  controles.set(i.id, { cancelar: () => conversion?.cancelar() });
  try {
    const sub = await api().subidas.crear({ nombre: archivo.name, mime: archivo.type || 'application/octet-stream', bytes: i.bytes, tipo: i.tipo, ...(biblioteca ? { bibliotecas: [biblioteca] } : {}) });
    if (sub.duplicado) {
      poner(i.id, { etapa: 'duplicado', documento: sub.duplicado, avance: 1, mensaje: 'Ya estaba en tu biblioteca', fin: Date.now() });
      return;
    }
    poner(i.id, { documento: sub.documento, mensaje: 'Subiendo y convirtiendo…', etapa: 'convirtiendo' });

    // 1. El original sube en paralelo a todo lo demás (por partes si es grande).
    const original = (async () => {
      if (fotos) return; // las fotos viajan como partes de la imprenta
      if (esSimulado()) {
        for (let k = 1; k <= 10; k++) { await new Promise((r) => setTimeout(r, 60)); poner(i.id, { subido: k / 10 }); }
        return;
      }
      await subirFichero(api(), sub.subida, sub.original, archivo, (env, tot) => poner(i.id, { subido: env / tot }));
    })();

    // 2. La imprenta del navegador, si sabe con este tipo.
    let paquete: PaqueteConversion | null = null;
    if (CONVIERTE_NAVEGADOR.has(i.tipo) && typeof Worker !== 'undefined') {
      conversion = convertirEnHilo(archivo, fotos);
      const partes = crearSubidorPartes(sub.subida);
      for await (const e of conversion.eventos) {
        if (e.tipo === 'no_disponible') break;
        if (e.tipo === 'inicio') poner(i.id, (x) => ({ unidades: e.unidades ?? x.unidades, tipo: e.entrada, ...(e.metadatos.titulo?.trim() ? { nombre: e.metadatos.titulo.trim() } : {}) }));
        else if (e.tipo === 'progreso') poner(i.id, (x) => ({ preparadas: Math.max(x.preparadas, e.hechas), unidades: x.unidades ?? e.total, avance: Math.max(x.avance, 0.3 * (e.total ? e.hechas / e.total : 0)), mensaje: e.mensaje ?? x.mensaje }));
        else if (e.tipo === 'parte') {
          partes.anadir(e.parte, e.datos);
          if (e.parte.clase === 'miniatura') {
            const url = URL.createObjectURL(new Blob([e.datos as BlobPart], { type: e.parte.mime }));
            poner(i.id, (x) => ({ miniaturas: [...x.miniaturas, url] }));
          }
        } else if (e.tipo === 'fin') paquete = e.paquete;
      }
      if (paquete) {
        const json = new TextEncoder().encode(JSON.stringify(paquete));
        partes.anadir({ id: 'paquete.json', clase: 'recurso', mime: 'application/json', bytes: json.byteLength }, json);
        await partes.terminar();
      }
    }
    if (!paquete && esSimulado()) await simularMiniaturas(i);

    await original;
    poner(i.id, { etapa: 'procesando', mensaje: 'Leyendo…', avance: 0.32 });
    const r = await api().subidas.ingestar(sub.subida, paquete ? { paquete: 'paquete.json' } : {});
    poner(i.id, { tarea: r.tarea, documento: r.documento });
    void clienteConsultas.invalidateQueries({ queryKey: ['documentos'] });
  } catch (e) {
    if (estado.find((x) => x.id === i.id)?.etapa === 'cancelada') return;
    poner(i.id, { etapa: 'error', error: mensajeDe(e), fin: Date.now() });
  } finally {
    controles.delete(i.id);
  }
}

/** En la demostración no hay imprenta: dibuja miniaturas de papel para que se vea el gesto. */
async function simularMiniaturas(i: Ingesta) {
  if (!['pdf', 'pdf_escaneado', 'fotos', 'documento', 'epub', 'presentacion', 'imagen'].includes(i.tipo)) return;
  const n = Math.max(3, Math.min(14, Math.round(i.bytes / 80_000)));
  poner(i.id, { unidades: i.unidades ?? n });
  for (let k = 0; k < Math.min(n, 14); k++) {
    await new Promise((r) => setTimeout(r, 70));
    poner(i.id, (x) => ({ preparadas: k + 1, miniaturas: [...x.miniaturas, miniaturaDePapel(k)], avance: 0.3 * ((k + 1) / n) }));
  }
}

function miniaturaDePapel(k: number): string {
  const lineas = Array.from({ length: 9 }, (_, j) => `<rect x='10' y='${18 + j * 9}' width='${j === 8 ? 30 : 52 - ((k + j) % 3) * 6}' height='3' fill='%2322160f' opacity='.55'/>`).join('');
  return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 100'><rect width='72' height='100' fill='%23faf7f0'/>${k === 0 ? "<rect x='10' y='10' width='40' height='5' fill='%23b8321c'/>" : ''}${lineas}<rect x='32' y='92' width='8' height='2' fill='%2322160f' opacity='.6'/></svg>`;
}

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : 'Algo falló al leer el archivo';
}

// ---------------------------------------------------------------------------
// Tiempo real: el avance del servidor
// ---------------------------------------------------------------------------

let escuchando = false;

function asegurarEscucha() {
  if (escuchando) return;
  escuchando = true;
  escucharTiempoReal(manejar);
}

function porTarea(tarea: string, documento?: string) {
  return estado.find((x) => x.tarea === tarea || (documento && x.documento === documento));
}

function manejar(e: EventoTiempoReal) {
  if (e.tipo === 'progreso') {
    const p = e.progreso;
    const i = porTarea(p.tarea, p.documento);
    if (!i) return;
    poner(i.id, (x) => ({
      etapa: p.fase === 'listo' ? 'listo' : 'procesando', fase: p.fase, tarea: p.tarea,
      avance: Math.max(x.avance, 0.32 + 0.68 * p.total), leidas: Math.max(x.leidas, p.unidadesListas ?? 0),
      mensaje: p.mensaje ?? x.mensaje, ...(p.error ? { etapa: 'error' as const, error: p.error } : {}),
    }));
  } else if (e.tipo === 'unidades') {
    const i = porTarea(e.tarea, e.documento);
    if (i) poner(i.id, (x) => ({ leidas: Math.max(x.leidas, e.hasta) }));
    // Las páginas nuevas ya se pueden abrir en el lector.
    void clienteConsultas.invalidateQueries({ queryKey: ['unidades', e.documento] });
  } else if (e.tipo === 'fin') {
    const i = porTarea(e.tarea, e.documento);
    if (i) poner(i.id, { etapa: e.estado === 'listo' ? 'listo' : e.estado === 'cancelada' ? 'cancelada' : 'error', avance: 1, fin: Date.now(), ...(e.error ? { error: e.error } : {}) });
    void clienteConsultas.invalidateQueries({ queryKey: ['documentos'] });
    if (e.documento) void clienteConsultas.invalidateQueries({ queryKey: ['documento', e.documento] });
    if (i && e.estado === 'listo') setTimeout(() => retirarIngesta(i.id), 5200);
  } else if (e.tipo === 'alerta') {
    void clienteConsultas.invalidateQueries({ queryKey: ['alertas'] });
    void clienteConsultas.invalidateQueries({ queryKey: ['vigilantes'] });
  }
}

/** Al abrir la app: las tareas que ya estaban en marcha (otra pestaña, otro día) vuelven a la mesa. */
export async function recuperarTareas() {
  asegurarEscucha();
  try {
    const [tareas, docs] = await Promise.all([api().tareas.listar(true), clienteConsultas.fetchQuery({ queryKey: ['documentos', {}], queryFn: () => api().documentos.listar({ limite: 500 }) })]);
    for (const t of tareas) {
      if (t.tipo !== 'ingesta' || estado.some((x) => x.tarea === t.id)) continue;
      const d = docs.elementos.find((x) => x.id === t.documento);
      const i: Ingesta = {
        id: `i-${t.id}`, nombre: d?.titulo ?? 'Documento', tipo: d?.tipo ?? 'pdf', bytes: d?.bytes ?? 0, documento: t.documento, tarea: t.id, etapa: 'procesando',
        fase: t.progreso?.fase, avance: 0.32 + 0.68 * (t.progreso?.total ?? 0), subido: 1, unidades: d?.unidades ?? null, preparadas: d?.unidades ?? 0,
        leidas: t.progreso?.unidadesListas ?? 0, miniaturas: [], inicio: Date.parse(t.creada), mensaje: t.progreso?.mensaje ?? 'Leyendo…',
      };
      estado = [...estado, i];
    }
    emitir();
  } catch { /* sin tareas que recuperar */ }
}
