/**
 * Lotes: llenar una biblioteca de golpe (carpetas, zips, listas de enlaces,
 * exportaciones de Zotero, montones de .spdf) con una cola de concurrencia
 * limitada encima de la ingesta de siempre (Workflow en la nube, cola local).
 *
 *   · Los enlaces los lanza el servidor, como mucho `concurrencia` a la vez.
 *   · Los archivos los sube quien los tiene (el navegador con su imprenta, o el
 *     SDK): reserva sitio con `siguientes`, sube por /subidas como siempre y
 *     apunta el documento y la tarea en el elemento.
 *   · Al cerrarse cada ingesta (`alCerrarDocumento`), el elemento queda listo o
 *     con error y el lote avanza solo. Pausar deja de empezar cosas nuevas; lo
 *     que está en marcha termina. Reanudar sigue donde iba (también al día siguiente).
 */
import type { TipoEntrada } from '@scholaris/nucleo';
import { nuevoId } from '@scholaris/nucleo';
import type {
  CifrasModo, DetalleLote, ElementoLote, ElementoNuevo, EstadoElemento, EstadoLote, EstimacionLote, Lote, ModoIngesta, NuevoLote,
} from '@scholaris/contrato';
import type { PuertosUsuario } from '../puertos.js';
import { ahora, cambiarBiblioteca, documentoPorHuella } from './estanteria.js';
import { exigir, fallo, noEncontrado } from './errores.js';
import { deducirTipo, ingerirDesdeUrl } from '../rutas/subidas.js';

const MB = 1024 * 1024;

/** Lo que cuesta leer con IA, aproximado (euros): por página y por minuto, en modo rápido. El económico, la mitad. */
export const TARIFAS = { pagina: 0.0006, minuto: 0.004, economico: 0.5 } as const;

function tipoDe(e: ElementoNuevo): TipoEntrada | 'spdf' {
  if (e.clase === 'spdf') return 'spdf';
  if (e.tipo) return e.tipo;
  if (e.clase === 'url') {
    const u = e.url ?? e.nombre;
    return /youtu\.?be|vimeo/.test(u) ? 'video' : /\.pdf($|\?)/i.test(u) ? 'pdf' : /\.(mp3|m4a|ogg|opus|wav)($|\?)/i.test(u) ? 'audio' : 'web';
  }
  return deducirTipo(e.nombre, e.mime ?? '') ?? 'documento';
}

/** Páginas y minutos de un elemento: lo medido o, si no, una estimación por el tamaño. */
function medida(e: ElementoNuevo, tipo: TipoEntrada | 'spdf'): { paginas: number; minutos: number; medido: boolean } {
  const b = e.bytes ?? 0;
  if (tipo === 'spdf') return { paginas: e.paginas ?? 0, minutos: e.minutos ?? 0, medido: true };
  if (tipo === 'audio') return { paginas: 0, minutos: e.minutos ?? (b ? b / MB : 30), medido: e.minutos != null };
  if (tipo === 'video') return { paginas: 0, minutos: e.minutos ?? (b ? b / (8 * MB) : 30), medido: e.minutos != null };
  if (e.paginas != null) return { paginas: e.paginas, minutos: 0, medido: true };
  const est = tipo === 'pdf' || tipo === 'pdf_escaneado' ? (b ? Math.min(2000, Math.max(1, Math.round(b / 60_000))) : 20)
    : tipo === 'epub' ? Math.max(1, Math.round(b / 2_500))
    : tipo === 'imagen' ? 1
    : tipo === 'presentacion' ? Math.max(1, Math.round(b / 150_000))
    : tipo === 'web' ? 8
    : Math.max(1, Math.round(b / 12_000));
  return { paginas: Math.min(5000, est), minutos: 0, medido: false };
}

export async function estimar(p: PuertosUsuario, elementos: ElementoNuevo[], concurrencia = 3): Promise<EstimacionLote> {
  exigir(Array.isArray(elementos) && elementos.length > 0 && elementos.length <= 5000, 'Un lote lleva entre 1 y 5000 elementos.');
  const salida: EstimacionLote = {
    elementos: elementos.length, nuevos: 0, paginas: 0, minutos: 0, porTipo: {}, duplicados: [], avisos: [],
    modos: { rapido: { segundos: 0, euros: 0 }, economico: { segundos: 0, euros: 0 } }, recomendado: 'rapido',
  };
  const vistas = new Map<string, number>();
  let sinMedir = 0;
  let trabajo = 0; // segundos de trabajo en modo rápido, uno detrás de otro
  for (const [i, e] of elementos.entries()) {
    const tipo = tipoDe(e);
    salida.porTipo[tipo] = (salida.porTipo[tipo] ?? 0) + 1;
    if (e.huella) {
      const ya = await documentoPorHuella(p.sql, e.huella);
      if (ya) {
        const [f] = await p.sql.ejecutar<{ titulo: string | null; bibliotecas: string }>('SELECT titulo, bibliotecas FROM documentos WHERE id = ?', ya);
        salida.duplicados.push({ indice: i, documento: ya, titulo: f?.titulo ?? e.nombre, bibliotecas: JSON.parse(f?.bibliotecas ?? '[]') as string[] });
        continue;
      }
      if (vistas.has(e.huella)) {
        salida.duplicados.push({ indice: i, documento: '', titulo: `Repetido en este lote (${elementos[vistas.get(e.huella)!]!.nombre})`, bibliotecas: [] });
        continue;
      }
      vistas.set(e.huella, i);
    }
    const m = medida(e, tipo);
    if (!m.medido) sinMedir++;
    if (tipo === 'spdf') { trabajo += 2; continue; }
    salida.nuevos++;
    salida.paginas += m.paginas;
    salida.minutos += m.minutos;
    trabajo += 12 + m.paginas * 0.8 + m.minutos * 6;
  }
  salida.minutos = Math.round(salida.minutos * 10) / 10;
  const euros = salida.paginas * TARIFAS.pagina + salida.minutos * TARIFAS.minuto;
  const rapido: CifrasModo = { segundos: Math.round(trabajo / Math.max(1, concurrencia)), euros: Math.round(euros * 100) / 100 };
  // La API por lotes entrega en horas: el texto ya legible se indexa enseguida, lo demás llega después.
  const economico: CifrasModo = { segundos: Math.max(rapido.segundos, 2 * 3600 + Math.round(salida.paginas * 0.3)), euros: Math.round(euros * TARIFAS.economico * 100) / 100 };
  salida.modos = { rapido, economico };
  salida.recomendado = salida.nuevos > 20 || salida.paginas > 1500 || salida.minutos > 120 ? 'economico' : 'rapido';
  if (sinMedir) salida.avisos.push(`${sinMedir === 1 ? 'Un elemento se ha medido' : `${sinMedir} elementos se han medido`} por su tamaño: las páginas y los minutos son aproximados.`);
  if (salida.duplicados.length) salida.avisos.push(`${salida.duplicados.length === 1 ? 'Uno ya estaba' : `${salida.duplicados.length} ya estaban`} en tu Scholaris: no se vuelve${salida.duplicados.length === 1 ? '' : 'n'} a leer.`);
  return salida;
}

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

interface FilaElemento {
  lote: string; n: number; clase: ElementoLote['clase']; nombre: string; ruta: string | null; mime: string | null; bytes: number | null; huella: string | null;
  url: string | null; tipo: string | null; paginas: number | null; minutos: number | null; metadatos: string | null; estado: EstadoElemento;
  documento: string | null; tarea: string | null; error: string | null; intentos: number; actualizado: string;
}

interface FilaLote { id: string; nombre: string; biblioteca: string | null; modo: ModoIngesta; concurrencia: number; estado: EstadoLote; estimacion: string | null; creado: string; actualizado: string }

function aElemento(f: FilaElemento, avance?: number): ElementoLote {
  const e: ElementoLote = { n: f.n, clase: f.clase, nombre: f.nombre, estado: f.estado, intentos: f.intentos, actualizado: f.actualizado };
  if (f.ruta) e.ruta = f.ruta;
  if (f.mime) e.mime = f.mime;
  if (f.bytes != null) e.bytes = f.bytes;
  if (f.huella) e.huella = f.huella;
  if (f.url) e.url = f.url;
  if (f.tipo) e.tipo = f.tipo as TipoEntrada;
  if (f.paginas != null) e.paginas = f.paginas;
  if (f.minutos != null) e.minutos = f.minutos;
  if (f.metadatos) e.metadatos = JSON.parse(f.metadatos) as ElementoLote['metadatos'];
  if (f.documento) e.documento = f.documento;
  if (f.tarea) e.tarea = f.tarea;
  if (f.error) e.error = f.error;
  if (avance != null) e.avance = avance;
  return e;
}

async function aLote(p: PuertosUsuario, f: FilaLote): Promise<Lote> {
  const cuentas: Lote['cuentas'] = {};
  let total = 0;
  for (const c of await p.sql.ejecutar<{ estado: EstadoElemento; n: number }>('SELECT estado, COUNT(*) AS n FROM pl_lote_elementos WHERE lote = ? GROUP BY estado', f.id)) {
    cuentas[c.estado] = c.n;
    total += c.n;
  }
  const l: Lote = { id: f.id, nombre: f.nombre, modo: f.modo, concurrencia: f.concurrencia, estado: f.estado, total, cuentas, creado: f.creado, actualizado: f.actualizado };
  if (f.biblioteca) l.biblioteca = f.biblioteca;
  if (f.estimacion) l.estimacion = JSON.parse(f.estimacion) as Lote['estimacion'];
  return l;
}

async function filaLote(p: PuertosUsuario, id: string): Promise<FilaLote> {
  const [f] = await p.sql.ejecutar<FilaLote>('SELECT * FROM pl_lotes WHERE id = ?', id);
  return f ?? noEncontrado('El lote');
}

export async function listarLotes(p: PuertosUsuario): Promise<Lote[]> {
  const filas = await p.sql.ejecutar<FilaLote>('SELECT * FROM pl_lotes ORDER BY creado DESC LIMIT 50');
  for (const f of filas) if (f.estado === 'en_marcha') await avanzarLote(p, f.id).catch((e) => console.error('avanzarLote', e));
  return Promise.all((await p.sql.ejecutar<FilaLote>('SELECT * FROM pl_lotes ORDER BY creado DESC LIMIT 50')).map((f) => aLote(p, f)));
}

export async function detalleLote(p: PuertosUsuario, id: string): Promise<DetalleLote> {
  const f = await filaLote(p, id);
  const filas = await p.sql.ejecutar<FilaElemento & { progreso: string | null }>(
    `SELECT e.*, t.progreso FROM pl_lote_elementos e LEFT JOIN pl_tareas t ON t.id = e.tarea WHERE e.lote = ? ORDER BY e.n`, id);
  const elementos = filas.map((x) => {
    let avance: number | undefined;
    if (x.estado === 'procesando' && x.progreso) { try { avance = (JSON.parse(x.progreso) as { total?: number }).total; } catch { /* sin progreso */ } }
    if (x.estado === 'listo') avance = 1;
    return aElemento(x, avance);
  });
  return { ...(await aLote(p, f)), elementos };
}

// ---------------------------------------------------------------------------
// Crear y avanzar
// ---------------------------------------------------------------------------

export async function crearLote(p: PuertosUsuario, b: NuevoLote): Promise<DetalleLote> {
  const concurrencia = Math.min(8, Math.max(1, Math.round(b.concurrencia ?? 3)));
  for (const e of b.elementos ?? []) {
    exigir(['archivo', 'url', 'spdf'].includes(e.clase), `Clase de elemento no válida: «${String(e.clase)}».`);
    exigir(typeof e.nombre === 'string' && e.nombre.length > 0 && e.nombre.length <= 1000, 'Cada elemento necesita un nombre.');
    if (e.clase === 'url') {
      let u: URL | null = null;
      try { u = new URL(e.url ?? e.nombre); } catch { /* abajo */ }
      exigir(u && (u.protocol === 'https:' || u.protocol === 'http:'), `La URL «${e.url ?? e.nombre}» no es válida.`);
    }
  }
  if (b.elementos.some((e) => e.clase === 'url') && !p.config.conversionServidor) fallo('no_disponible', 'Esta instancia no puede descargar enlaces.');
  const est = await estimar(p, b.elementos, concurrencia);
  const modo: ModoIngesta = b.modo ?? est.recomendado;
  const id = nuevoId('l');
  const t = ahora();
  const nombre = (b.nombre?.trim() || `Lote del ${new Date().toLocaleDateString('es-ES')}`).slice(0, 200);
  const dup = new Map(est.duplicados.map((d) => [d.indice, d]));
  await p.sql.transaccion(async (tx) => {
    await tx.ejecutar('INSERT INTO pl_lotes (id, nombre, biblioteca, modo, concurrencia, estado, estimacion, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, nombre, b.biblioteca ?? null, modo, concurrencia, 'en_marcha', JSON.stringify({ paginas: est.paginas, minutos: est.minutos, modos: est.modos }), t, t);
    for (const [i, e] of b.elementos.entries()) {
      const d = dup.get(i);
      await tx.ejecutar(
        `INSERT INTO pl_lote_elementos (lote, n, clase, nombre, ruta, mime, bytes, huella, url, tipo, paginas, minutos, metadatos, estado, documento, intentos, actualizado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        id, i + 1, e.clase, e.nombre, e.ruta ?? null, e.mime ?? null, e.bytes ?? null, e.huella ?? null, e.clase === 'url' ? (e.url ?? e.nombre) : null,
        e.tipo ?? (e.clase === 'spdf' ? null : tipoDe(e)), e.paginas ?? null, e.minutos ?? null, e.metadatos ? JSON.stringify(e.metadatos) : null,
        d ? 'duplicado' : 'pendiente', d?.documento || null, t,
      );
    }
  });
  // Lo que ya estaba entra en la biblioteca del lote sin leerlo otra vez.
  if (b.biblioteca) {
    const ya = est.duplicados.map((d) => d.documento).filter(Boolean);
    if (ya.length) await cambiarBiblioteca(p.sql, b.biblioteca, ya, true);
  }
  await avanzarLote(p, id);
  return detalleLote(p, id);
}

/**
 * Pone al día los elementos en marcha (por sus tareas) y lanza los enlaces
 * pendientes hasta llenar la concurrencia. Idempotente: se llama al crear, al
 * consultar, al reanudar y al cerrarse cada ingesta.
 */
export async function avanzarLote(p: PuertosUsuario, id: string): Promise<void> {
  const l = await filaLote(p, id);
  const t = ahora();
  // Lo que terminó sin que nos avisaran (otro proceso, un reinicio).
  await p.sql.ejecutar(
    `UPDATE pl_lote_elementos SET estado = CASE WHEN (SELECT estado FROM pl_tareas WHERE id = tarea) = 'listo' THEN 'listo' ELSE 'error' END,
       error = CASE WHEN (SELECT estado FROM pl_tareas WHERE id = tarea) = 'listo' THEN NULL ELSE COALESCE((SELECT error FROM pl_tareas WHERE id = tarea), 'La ingesta falló.') END,
       actualizado = ?
     WHERE lote = ? AND estado = 'procesando' AND tarea IS NOT NULL AND (SELECT estado FROM pl_tareas WHERE id = tarea) IN ('listo', 'error', 'cancelada')`, t, id);
  // Subidas que se quedaron a medias (se cerró el navegador): vuelven a la cola.
  const viejo = new Date(Date.now() - 30 * 60_000).toISOString();
  await p.sql.ejecutar("UPDATE pl_lote_elementos SET estado = 'pendiente', actualizado = ? WHERE lote = ? AND estado = 'subiendo' AND actualizado < ?", t, id, viejo);
  if (l.estado === 'en_marcha') {
    const [{ activos } = { activos: 0 }] = await p.sql.ejecutar<{ activos: number }>("SELECT COUNT(*) AS activos FROM pl_lote_elementos WHERE lote = ? AND estado IN ('subiendo','procesando')", id);
    const huecos = l.concurrencia - activos;
    if (huecos > 0) {
      const urls = await p.sql.ejecutar<FilaElemento>("SELECT * FROM pl_lote_elementos WHERE lote = ? AND clase = 'url' AND estado = 'pendiente' ORDER BY n LIMIT ?", id, huecos);
      for (const e of urls) {
        try {
          const r = await ingerirDesdeUrl(p, {
            url: e.url ?? e.nombre, modo: l.modo, ...(l.biblioteca ? { bibliotecas: [l.biblioteca] } : {}),
            ...(e.tipo ? { tipo: e.tipo as TipoEntrada } : {}), ...(e.metadatos ? { metadatos: JSON.parse(e.metadatos) as Record<string, unknown> } : {}),
          });
          await p.sql.ejecutar("UPDATE pl_lote_elementos SET estado = 'procesando', documento = ?, tarea = ?, intentos = intentos + 1, error = NULL, actualizado = ? WHERE lote = ? AND n = ?", r.documento, r.tarea, ahora(), id, e.n);
        } catch (err) {
          await p.sql.ejecutar("UPDATE pl_lote_elementos SET estado = 'error', error = ?, intentos = intentos + 1, actualizado = ? WHERE lote = ? AND n = ?", (err as Error).message, ahora(), id, e.n);
        }
      }
    }
    const [{ vivos } = { vivos: 0 }] = await p.sql.ejecutar<{ vivos: number }>("SELECT COUNT(*) AS vivos FROM pl_lote_elementos WHERE lote = ? AND estado IN ('pendiente','subiendo','procesando')", id);
    if (!vivos) {
      await p.sql.ejecutar("UPDATE pl_lotes SET estado = 'terminado', actualizado = ? WHERE id = ? AND estado = 'en_marcha'", ahora(), id);
      const [r] = await p.sql.ejecutar<{ listos: number; errores: number }>("SELECT SUM(estado IN ('listo','duplicado')) AS listos, SUM(estado = 'error') AS errores FROM pl_lote_elementos WHERE lote = ?", id);
      await p.cuentas.notificar({
        usuario: p.usuario.id, tipo: 'lote_terminado', destino: `/lotes/${id}`, biblioteca: l.biblioteca,
        texto: `«${l.nombre}» ha terminado: ${r?.listos ?? 0} listos${r?.errores ? ` y ${r.errores} con error` : ''}.`,
      }).catch(() => undefined);
    }
  }
  await p.sql.ejecutar('UPDATE pl_lotes SET actualizado = ? WHERE id = ?', ahora(), id);
}

/** El conductor reserva archivos que subir (como mucho los huecos libres). */
export async function siguientes(p: PuertosUsuario, id: string, max: number): Promise<ElementoLote[]> {
  await avanzarLote(p, id);
  const l = await filaLote(p, id);
  if (l.estado !== 'en_marcha') return [];
  const [{ activos } = { activos: 0 }] = await p.sql.ejecutar<{ activos: number }>("SELECT COUNT(*) AS activos FROM pl_lote_elementos WHERE lote = ? AND estado IN ('subiendo','procesando')", id);
  const n = Math.min(Math.max(0, Math.floor(max)), Math.max(0, l.concurrencia - activos));
  if (!n) return [];
  const filas = await p.sql.ejecutar<FilaElemento>("SELECT * FROM pl_lote_elementos WHERE lote = ? AND clase IN ('archivo','spdf') AND estado = 'pendiente' ORDER BY n LIMIT ?", id, n);
  const t = ahora();
  for (const f of filas) await p.sql.ejecutar("UPDATE pl_lote_elementos SET estado = 'subiendo', intentos = intentos + 1, error = NULL, actualizado = ? WHERE lote = ? AND n = ?", t, id, f.n);
  return filas.map((f) => aElemento({ ...f, estado: 'subiendo', intentos: f.intentos + 1, error: null, actualizado: t }));
}

const ESTADOS: EstadoElemento[] = ['pendiente', 'subiendo', 'procesando', 'listo', 'error', 'omitido', 'duplicado', 'cancelado'];

export async function apuntarElemento(p: PuertosUsuario, id: string, n: number, c: { estado?: EstadoElemento; documento?: string; tarea?: string; error?: string }): Promise<ElementoLote> {
  await filaLote(p, id);
  exigir(c.estado === undefined || ESTADOS.includes(c.estado), 'Estado no válido.');
  const [f] = await p.sql.ejecutar<FilaElemento>('SELECT * FROM pl_lote_elementos WHERE lote = ? AND n = ?', id, n);
  if (!f) noEncontrado('El elemento');
  // Si la ingesta ya terminó antes de que el conductor apuntara la tarea, se respeta lo que hay.
  let estado = c.estado ?? f.estado;
  if (c.tarea) {
    const [t] = await p.sql.ejecutar<{ estado: string; error: string | null }>('SELECT estado, error FROM pl_tareas WHERE id = ?', c.tarea);
    if (t?.estado === 'listo') estado = 'listo';
    else if (t && (t.estado === 'error' || t.estado === 'cancelada')) { estado = 'error'; c.error ??= t.error ?? 'La ingesta falló.'; }
  }
  await p.sql.ejecutar('UPDATE pl_lote_elementos SET estado = ?, documento = COALESCE(?, documento), tarea = COALESCE(?, tarea), error = ?, actualizado = ? WHERE lote = ? AND n = ?',
    estado, c.documento ?? null, c.tarea ?? null, estado === 'error' ? (c.error ?? f.error ?? 'Falló.') : null, ahora(), id, n);
  if (estado === 'duplicado' && c.documento) {
    const l = await filaLote(p, id);
    if (l.biblioteca) await cambiarBiblioteca(p.sql, l.biblioteca, [c.documento], true);
  }
  await avanzarLote(p, id);
  const [g] = await p.sql.ejecutar<FilaElemento>('SELECT * FROM pl_lote_elementos WHERE lote = ? AND n = ?', id, n);
  return aElemento(g!);
}

export async function cambiarEstadoLote(p: PuertosUsuario, id: string, accion: 'pausar' | 'reanudar' | 'cancelar'): Promise<DetalleLote> {
  const l = await filaLote(p, id);
  const t = ahora();
  if (accion === 'pausar' && l.estado === 'en_marcha') await p.sql.ejecutar("UPDATE pl_lotes SET estado = 'pausado', actualizado = ? WHERE id = ?", t, id);
  if (accion === 'reanudar' && (l.estado === 'pausado' || l.estado === 'terminado')) await p.sql.ejecutar("UPDATE pl_lotes SET estado = 'en_marcha', actualizado = ? WHERE id = ?", t, id);
  if (accion === 'cancelar' && l.estado !== 'cancelado') {
    // Lo que ya se está leyendo termina; lo demás no empieza.
    await p.sql.ejecutar("UPDATE pl_lotes SET estado = 'cancelado', actualizado = ? WHERE id = ?", t, id);
    await p.sql.ejecutar("UPDATE pl_lote_elementos SET estado = 'cancelado', actualizado = ? WHERE lote = ? AND estado IN ('pendiente','subiendo')", t, id);
  }
  await avanzarLote(p, id);
  return detalleLote(p, id);
}

export async function reintentarElemento(p: PuertosUsuario, id: string, n: number, omitir: boolean, borrar: (documento: string) => Promise<void>): Promise<DetalleLote> {
  const l = await filaLote(p, id);
  const [f] = await p.sql.ejecutar<FilaElemento>('SELECT * FROM pl_lote_elementos WHERE lote = ? AND n = ?', id, n);
  if (!f) noEncontrado('El elemento');
  if (omitir) {
    if (['pendiente', 'error', 'subiendo', 'cancelado'].includes(f.estado)) await p.sql.ejecutar("UPDATE pl_lote_elementos SET estado = 'omitido', actualizado = ? WHERE lote = ? AND n = ?", ahora(), id, n);
  } else {
    if (!['error', 'cancelado', 'omitido'].includes(f.estado)) fallo('conflicto', 'Solo se reintenta lo que falló, se canceló o se omitió.');
    // El documento fallido de un enlace se quita (los archivos se reemplazan solos al volver a subirlos con la misma huella).
    if (f.documento && f.clase === 'url') {
      const [d] = await p.sql.ejecutar<{ estado: string }>('SELECT estado FROM documentos WHERE id = ?', f.documento);
      if (d && d.estado !== 'listo') await borrar(f.documento).catch(() => undefined);
    }
    await p.sql.ejecutar("UPDATE pl_lote_elementos SET estado = 'pendiente', documento = NULL, tarea = NULL, error = NULL, actualizado = ? WHERE lote = ? AND n = ?", ahora(), id, n);
    if (l.estado === 'terminado' || l.estado === 'cancelado') await p.sql.ejecutar("UPDATE pl_lotes SET estado = 'en_marcha', actualizado = ? WHERE id = ?", ahora(), id);
  }
  await avanzarLote(p, id);
  return detalleLote(p, id);
}

/** Al cerrarse la ingesta de un documento: su elemento (si es de un lote) y el lote avanzan. */
export async function alCerrarDocumento(p: PuertosUsuario, documento: string, ok: boolean, error?: string): Promise<void> {
  const filas = await p.sql.ejecutar<{ lote: string; n: number }>("SELECT lote, n FROM pl_lote_elementos WHERE documento = ? AND estado IN ('subiendo','procesando')", documento);
  if (!filas.length) return;
  for (const f of filas) {
    await p.sql.ejecutar('UPDATE pl_lote_elementos SET estado = ?, error = ?, actualizado = ? WHERE lote = ? AND n = ?', ok ? 'listo' : 'error', ok ? null : (error ?? 'La ingesta falló.'), ahora(), f.lote, f.n);
  }
  for (const l of new Set(filas.map((f) => f.lote))) await avanzarLote(p, l);
}
