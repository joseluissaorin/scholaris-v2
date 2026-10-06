/**
 * Historial de búsquedas: se graba cada búsqueda terminada (si el usuario no
 * lo ha desactivado), con su registro paso a paso para poder reproducirla, el
 * vector de la consulta para los insights, y una vista FTS para buscar en él.
 */

import { anclaACita, nuevoId, vectorABytes, type Ancla, type Filtros, type SQL } from '@scholaris/nucleo';
import type {
  Buscar,
  DetalleEventoBusqueda,
  EstadisticasHistorial,
  EventoBusqueda,
  FiltrosHistorial,
  IntencionConsulta,
  Pagina,
} from '@scholaris/contrato';
import { grabacionActiva } from './ajustes.js';
import type { ConfianzaRespuesta, RespuestaBusqueda } from './puertos.js';
import { aJSON, ahora, bool, consultaFTS, deJSON, ErrorFunciones, haceDias, limitar, noEncontrado, num, numONulo, texto, una } from './util.js';

export type TipoEventoBusqueda = EventoBusqueda['tipo'];

/** Lo que se graba de una búsqueda terminada. */
export interface NuevaBusqueda {
  id?: string;
  correlacion?: string;
  tipo?: TipoEventoBusqueda;
  consulta: string;
  intencion?: IntencionConsulta | string | null;
  filtros?: Filtros;
  idioma?: string | null;
  verbosidad?: number;
  pro?: boolean;
  estado?: 'ok' | 'error' | 'cancelada';
  codigoError?: string | null;
  mensajeError?: string | null;
  nResultados?: number;
  respuesta?: string | null;
  confianza?: ConfianzaRespuesta | null;
  resumen?: string | null;
  refinamientos?: unknown;
  /** Los primeros resultados, ya compactos (ver `compactarResultados`). */
  principales?: DetalleEventoBusqueda['principales'];
  espacio?: string | null;
  vector?: Float32Array | null;
  ms?: number | null;
  msRedactor?: number | null;
  msBusqueda?: number | null;
  msReordenacion?: number | null;
  creada?: string;
  /** Eventos del flujo (SSE) para reproducirla. */
  eventos?: Array<{ ms: number; etapa?: string; datos: unknown }>;
}

/** Compacta los resultados de una búsqueda para el historial (los diez primeros). */
export function compactarResultados(resultados: RespuestaBusqueda['resultados'], n = 10): DetalleEventoBusqueda['principales'] {
  return resultados.slice(0, n).map((r) => ({
    fragmento: r.fragmento.id,
    documento: r.documento.id,
    etiqueta: anclaACita(r.fragmento.ancla as Ancla, r.fragmento.anclaFin as Ancla | undefined),
    titulo: r.documento.metadatos?.titulo ?? '',
    puntuacion: r.puntuacion,
  }));
}

/**
 * Graba una búsqueda. Devuelve su id, o `null` si la grabación está apagada
 * (en ese caso no se escribe absolutamente nada).
 */
export async function registrarBusqueda(sql: SQL, b: NuevaBusqueda): Promise<string | null> {
  if (!(await grabacionActiva(sql))) return null;
  const id = b.id ?? nuevoId('b');
  await sql.transaccion(async (tx) => {
    await tx.ejecutar(
      `INSERT INTO historial (id, correlacion, tipo, consulta, intencion, biblioteca, documento, tipo_medio, filtros, idioma,
         verbosidad, pro, estado, codigo_error, mensaje_error, n_resultados, respuesta, confianza, resumen, refinamientos,
         resultados, espacio, vector, ms, ms_redactor, ms_busqueda, ms_reordenacion, creada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      b.correlacion ?? null,
      b.tipo ?? 'busqueda',
      b.consulta,
      b.intencion ?? null,
      b.filtros?.bibliotecas?.[0] ?? null,
      b.filtros?.documentos?.length === 1 ? b.filtros.documentos[0]! : null,
      b.filtros?.tipos?.length === 1 ? b.filtros.tipos[0]! : null,
      aJSON(b.filtros && Object.keys(b.filtros).length ? b.filtros : null),
      b.idioma ?? null,
      b.verbosidad ?? 1,
      b.pro ? 1 : 0,
      b.estado ?? 'ok',
      b.codigoError ?? null,
      b.mensajeError ?? null,
      b.nResultados ?? b.principales?.length ?? 0,
      b.respuesta ?? null,
      b.confianza ?? null,
      b.resumen ?? null,
      aJSON(b.refinamientos),
      aJSON(b.principales ?? []),
      b.vector ? (b.espacio ?? null) : null,
      b.vector ? vectorABytes(b.vector) : null,
      b.ms ?? null,
      b.msRedactor ?? null,
      b.msBusqueda ?? null,
      b.msReordenacion ?? null,
      b.creada ?? ahora(),
    );
    let n = 0;
    for (const e of b.eventos ?? []) {
      await tx.ejecutar(
        'INSERT INTO historial_eventos (busqueda, n, ms, etapa, datos) VALUES (?, ?, ?, ?, ?)',
        id, n++, Math.round(e.ms), e.etapa ?? null, JSON.stringify(e.datos ?? null),
      );
    }
  });
  return id;
}

/**
 * Graba una búsqueda en flujo (SSE): se le pasa cada evento y se cierra al
 * final. Si la grabación está apagada, no hace nada. Nunca lanza: grabar es
 * secundario respecto a la búsqueda en sí.
 */
export class GrabadorBusqueda {
  readonly id = nuevoId('b');
  private readonly t0 = Date.now();
  private readonly fila: NuevaBusqueda;
  private readonly eventos: NonNullable<NuevaBusqueda['eventos']> = [];
  private cerrado = false;

  constructor(private readonly sql: SQL, datos: NuevaBusqueda, private readonly maxEventos = 2000) {
    this.fila = { ...datos, id: this.id, estado: 'ok', creada: ahora() };
  }

  /** Vector de la consulta (para los insights). */
  vectorConsulta(vector: Float32Array, espacio: string): void {
    this.fila.vector = vector;
    this.fila.espacio = espacio;
  }

  /** Recoge un evento del flujo. Reconoce los de /busqueda/responder y los genéricos { etapa, estado, detalle }. */
  registrar(evento: Record<string, unknown>): void {
    if (this.cerrado) return;
    const etapa = texto(evento.tipo) ?? texto(evento.etapa) ?? texto(evento.stage) ?? undefined;
    if (this.eventos.length < this.maxEventos) this.eventos.push({ ms: Date.now() - this.t0, etapa, datos: evento });
    switch (etapa) {
      case 'resultados': {
        const rs = (evento.resultados as RespuestaBusqueda['resultados']) ?? [];
        this.fila.nResultados = rs.length;
        this.fila.principales = compactarResultados(rs);
        if (evento.intencion) this.fila.intencion = String(evento.intencion);
        break;
      }
      case 'texto':
        this.fila.respuesta = (this.fila.respuesta ?? '') + String(evento.delta ?? '');
        break;
      case 'fin':
        if (evento.confianza) this.fila.confianza = evento.confianza as ConfianzaRespuesta;
        break;
      case 'error':
        this.fila.estado = 'error';
        this.fila.codigoError = texto(evento.codigo) ?? 'interno';
        this.fila.mensajeError = texto(evento.mensaje);
        break;
    }
  }

  /** Completa campos a mano (p. ej. tiempos por fase). */
  completar(datos: Partial<NuevaBusqueda>): void {
    Object.assign(this.fila, datos);
  }

  marcarCancelada(): void {
    if (this.fila.estado === 'ok') this.fila.estado = 'cancelada';
  }

  async finalizar(): Promise<string | null> {
    if (this.cerrado) return null;
    this.cerrado = true;
    this.fila.ms = Date.now() - this.t0;
    this.fila.eventos = this.eventos;
    try {
      return await registrarBusqueda(this.sql, this.fila);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

const COLUMNAS_RESUMEN =
  'n, id, tipo, consulta, intencion, filtros, n_resultados, confianza, estado, ms, fijada, nota, redactada, creada';

function filaAEvento(f: Record<string, unknown>): EventoBusqueda {
  const e: EventoBusqueda = {
    id: String(f.id),
    consulta: String(f.consulta),
    tipo: (texto(f.tipo) ?? 'busqueda') as TipoEventoBusqueda,
    resultados: num(f.n_resultados),
    estado: f.estado === 'error' ? 'error' : 'ok',
    fijado: bool(f.fijada),
    oculto: bool(f.redactada),
    cuando: String(f.creada),
  };
  if (f.intencion) e.intencion = String(f.intencion) as IntencionConsulta;
  const filtros = deJSON<Filtros | null>(f.filtros, null);
  if (filtros) e.filtros = filtros;
  if (f.confianza) e.confianza = String(f.confianza) as ConfianzaRespuesta;
  if (f.ms !== null && f.ms !== undefined) e.ms = num(f.ms);
  if (f.nota) e.nota = String(f.nota);
  return e;
}

export interface FiltrosHistorialAmpliados extends FiltrosHistorial {
  confianza?: ConfianzaRespuesta;
  biblioteca?: string;
}

/** Lista el historial, del más reciente al más antiguo, con cursor opaco. */
export async function listarHistorial(sql: SQL, f: FiltrosHistorialAmpliados = {}): Promise<Pagina<EventoBusqueda>> {
  const limite = limitar(f.limite, 1, 200, 50);
  const donde: string[] = [];
  const p: Array<string | number> = [];
  if (f.cursor) {
    donde.push('n < ?');
    p.push(num(f.cursor, 0));
  }
  if (f.intencion) { donde.push('intencion = ?'); p.push(f.intencion); }
  if (f.biblioteca) { donde.push('biblioteca = ?'); p.push(f.biblioteca); }
  if (f.confianza) { donde.push('confianza = ?'); p.push(f.confianza); }
  if (f.fijados) donde.push('fijada = 1');
  if (f.desde) { donde.push('creada >= ?'); p.push(f.desde); }
  if (f.hasta) { donde.push('creada <= ?'); p.push(f.hasta); }
  const q = f.q ? consultaFTS(f.q) : '';
  if (q) {
    donde.unshift('n IN (SELECT rowid FROM historial_fts WHERE historial_fts MATCH ?)');
    p.unshift(q);
  }
  const filas = await sql.ejecutar(
    `SELECT ${COLUMNAS_RESUMEN} FROM historial ${donde.length ? 'WHERE ' + donde.join(' AND ') : ''} ORDER BY n DESC LIMIT ?`,
    ...p,
    limite + 1,
  );
  const hay = filas.length > limite;
  const elementos = filas.slice(0, limite);
  const pagina: Pagina<EventoBusqueda> = { elementos: elementos.map(filaAEvento) };
  if (hay) pagina.siguiente = String(elementos[elementos.length - 1]!.n);
  return pagina;
}

export interface DetalleBusquedaCompleto extends DetalleEventoBusqueda {
  resumen?: string;
  refinamientos?: unknown;
  idioma?: string;
  tiempos: { busqueda?: number; reordenacion?: number; redactor?: number };
  /** Hay registro paso a paso para reproducirla. */
  reproducible: boolean;
}

export async function obtenerBusqueda(sql: SQL, id: string): Promise<DetalleBusquedaCompleto> {
  const f = await una(sql, 'SELECT * FROM historial WHERE id = ?', id);
  if (!f) throw noEncontrado('esa búsqueda en el historial');
  const eventos = await una<{ n: number }>(sql, 'SELECT count(*) AS n FROM historial_eventos WHERE busqueda = ?', id);
  const d: DetalleBusquedaCompleto = {
    ...filaAEvento(f),
    principales: deJSON(f.resultados, []),
    tiempos: {},
    reproducible: num(eventos?.n) > 0,
  };
  if (f.respuesta) d.respuesta = String(f.respuesta);
  if (f.mensaje_error) d.error = String(f.mensaje_error);
  if (f.resumen) d.resumen = String(f.resumen);
  if (f.refinamientos) d.refinamientos = deJSON(f.refinamientos, null);
  if (f.idioma) d.idioma = String(f.idioma);
  const tb = numONulo(f.ms_busqueda), tr = numONulo(f.ms_reordenacion), tl = numONulo(f.ms_redactor);
  if (tb !== null) d.tiempos.busqueda = tb;
  if (tr !== null) d.tiempos.reordenacion = tr;
  if (tl !== null) d.tiempos.redactor = tl;
  return d;
}

/** Eventos grabados de una búsqueda, en orden, para reproducirla. */
export async function eventosBusqueda(sql: SQL, id: string): Promise<Array<{ ms: number; etapa: string | null; datos: unknown }>> {
  const f = await una<{ redactada: number }>(sql, 'SELECT redactada FROM historial WHERE id = ?', id);
  if (!f) throw noEncontrado('esa búsqueda en el historial');
  if (bool(f.redactada)) throw new ErrorFunciones('no_disponible', 'Esta búsqueda está oculta: su contenido ya no se puede reproducir.', 410);
  const filas = await sql.ejecutar('SELECT ms, etapa, datos FROM historial_eventos WHERE busqueda = ? ORDER BY n', id);
  return filas.map((e) => ({ ms: num(e.ms), etapa: texto(e.etapa), datos: deJSON(e.datos, null) }));
}

async function existe(sql: SQL, id: string): Promise<void> {
  if (!(await una(sql, 'SELECT 1 AS x FROM historial WHERE id = ?', id))) throw noEncontrado('esa búsqueda en el historial');
}

export async function fijarBusqueda(sql: SQL, id: string, fijado: boolean): Promise<void> {
  await existe(sql, id);
  await sql.ejecutar('UPDATE historial SET fijada = ? WHERE id = ?', fijado ? 1 : 0, id);
}

export async function anotarBusqueda(sql: SQL, id: string, nota: string | null): Promise<void> {
  if (nota && nota.length > 4000) throw new ErrorFunciones('peticion_invalida', 'La nota no puede pasar de 4000 caracteres.');
  await existe(sql, id);
  await sql.ejecutar('UPDATE historial SET nota = ? WHERE id = ?', nota && nota.trim() ? nota : null, id);
}

/**
 * Oculta una búsqueda: borra la consulta, la respuesta, la nota, el vector y el
 * registro paso a paso, pero deja la fila para que las estadísticas cuadren.
 */
export async function ocultarBusqueda(sql: SQL, id: string): Promise<void> {
  await existe(sql, id);
  await sql.transaccion(async (tx) => {
    await tx.ejecutar(
      `UPDATE historial SET consulta = '(oculta)', respuesta = NULL, resumen = NULL, nota = NULL, redactada = 1,
         refinamientos = NULL, resultados = NULL, vector = NULL, espacio = NULL, filtros = NULL, mensaje_error = NULL
       WHERE id = ?`,
      id,
    );
    await tx.ejecutar('DELETE FROM historial_eventos WHERE busqueda = ?', id);
  });
}

export async function borrarBusqueda(sql: SQL, id: string): Promise<void> {
  await existe(sql, id);
  await sql.transaccion(async (tx) => {
    await tx.ejecutar('DELETE FROM historial_eventos WHERE busqueda = ?', id);
    await tx.ejecutar('DELETE FROM historial WHERE id = ?', id);
  });
}

/** Parámetros para repetir una búsqueda (la interfaz los manda a /busqueda/responder). */
export async function parametrosRepeticion(sql: SQL, id: string): Promise<Buscar> {
  const f = await una(sql, 'SELECT consulta, filtros, redactada FROM historial WHERE id = ?', id);
  if (!f) throw noEncontrado('esa búsqueda en el historial');
  if (bool(f.redactada)) throw new ErrorFunciones('no_disponible', 'Esta búsqueda está oculta: ya no se puede repetir.', 410);
  const b: Buscar = { consulta: String(f.consulta) };
  const filtros = deJSON<Filtros | null>(f.filtros, null);
  if (filtros) b.filtros = filtros;
  return b;
}

export type RangoEstadisticas = '24h' | '7d' | '30d' | '90d' | 'todo';

export async function estadisticasHistorial(sql: SQL, rango: RangoEstadisticas = '30d'): Promise<EstadisticasHistorial> {
  const dias: Record<RangoEstadisticas, number | null> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90, todo: null };
  const d = dias[rango] ?? 30;
  const donde = d === null ? '' : 'WHERE creada >= ?';
  const p = d === null ? [] : [haceDias(d)];
  const agrupar = async (col: string) => {
    const r: Record<string, number> = {};
    for (const f of await sql.ejecutar(`SELECT ${col} AS k, count(*) AS n FROM historial ${donde} GROUP BY ${col}`, ...p)) {
      r[texto(f.k) ?? 'desconocida'] = num(f.n);
    }
    return r;
  };
  const total = await una<{ n: number }>(sql, `SELECT count(*) AS n FROM historial ${donde}`, ...p);
  const porDia = await sql.ejecutar(`SELECT substr(creada, 1, 10) AS dia, count(*) AS n FROM historial ${donde} GROUP BY dia ORDER BY dia`, ...p);
  return {
    total: num(total?.n),
    porIntencion: await agrupar('intencion'),
    porConfianza: await agrupar('confianza'),
    porEstado: await agrupar('estado'),
    porDia: porDia.map((f) => ({ dia: String(f.dia), n: num(f.n) })),
  };
}
