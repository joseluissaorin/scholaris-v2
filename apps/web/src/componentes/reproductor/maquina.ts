/**
 * La máquina de estados del reproductor. Pura: recibe los hechos (eventos del
 * elemento de medio y peticiones de la persona) y devuelve el estado nuevo y,
 * si hace falta, qué hacer (renovar la URL firmada, reintentar, rendirse).
 *
 * El estado visible se DERIVA de unas pocas banderas, en vez de guardarse:
 * así no hay combinaciones imposibles («sonando» y «en error» a la vez) ni
 * transiciones olvidadas.
 *
 *   vacio ─cargar─► cargando ─metadatos─► listo ⇄ sonando
 *                                           │   ⇅ esperando (sin datos)
 *                                           │   ⇅ buscando (salto en curso)
 *                                           └─► terminado
 *   cualquiera ─error─► (renovar URL y reintentar, con espera creciente) ─► error
 */

export type Estado = 'vacio' | 'cargando' | 'listo' | 'sonando' | 'esperando' | 'buscando' | 'terminado' | 'error';

export type TipoError = 'red' | 'formato' | 'agotado';

export interface Banderas {
  fuente: boolean;
  metadatos: boolean;
  /** Esta fuente ya dio metadatos alguna vez (sobrevive a las recargas por renovación). */
  conocida: boolean;
  /** Hay datos para seguir sonando (canplay). */
  datos: boolean;
  /** La persona quiere que suene (pulsó reproducir y no ha pausado). */
  quiere: boolean;
  /** El elemento está realmente avanzando (playing). */
  avanza: boolean;
  buscando: boolean;
  terminado: boolean;
  /** Reintentos seguidos sin haber vuelto a sonar. */
  intentos: number;
  error: { tipo: TipoError; mensaje: string } | null;
}

export type Evento =
  | { tipo: 'cargar' }
  | { tipo: 'descargar' }
  | { tipo: 'metadatos' }
  | { tipo: 'datos' }          // canplay / canplaythrough
  | { tipo: 'pedirSonar' }
  | { tipo: 'pedirPausa' }
  | { tipo: 'play' }           // el elemento acepta reproducir
  | { tipo: 'avanza' }         // playing
  | { tipo: 'pausa' }          // pause (del elemento: también la del sistema o de PiP)
  | { tipo: 'espera' }         // waiting / stalled
  | { tipo: 'buscar' }         // seeking
  | { tipo: 'buscado' }        // seeked
  | { tipo: 'fin' }            // ended
  | { tipo: 'error'; codigo: number }
  | { tipo: 'atasco' }         // el vigilante: demasiado tiempo esperando
  | { tipo: 'reintentar' };    // la persona pulsa «Reintentar»

export type Accion =
  | { tipo: 'renovar'; esperaMs: number }  // pedir otra URL firmada y recargar en el mismo instante
  | null;

export const MAX_INTENTOS = 4;

export const INICIAL: Banderas = {
  fuente: false, metadatos: false, conocida: false, datos: false, quiere: false, avanza: false, buscando: false, terminado: false, intentos: 0, error: null,
};

/** Códigos de MediaError. */
export const MEDIA_ERR = { ABORTADO: 1, RED: 2, DECODIFICACION: 3, NO_ADMITIDO: 4 } as const;

export function estadoDe(b: Banderas): Estado {
  if (b.error) return 'error';
  if (!b.fuente) return 'vacio';
  if (!b.metadatos) return 'cargando';
  if (b.buscando) return 'buscando';
  if (b.terminado && !b.quiere) return 'terminado';
  if (b.quiere) return b.avanza && b.datos ? 'sonando' : 'esperando';
  return 'listo';
}

export function transicion(b: Banderas, e: Evento): { banderas: Banderas; accion: Accion } {
  const igual = { banderas: b, accion: null };
  switch (e.tipo) {
    case 'cargar':
      return { banderas: { ...INICIAL, fuente: true, quiere: b.quiere, intentos: b.intentos, conocida: b.conocida }, accion: null };
    case 'descargar':
      return { banderas: INICIAL, accion: null };
    case 'metadatos':
      return { banderas: { ...b, metadatos: true, conocida: true, error: null }, accion: null };
    case 'datos':
      return { banderas: { ...b, datos: true, metadatos: true, conocida: true }, accion: null };
    case 'pedirSonar':
      return { banderas: { ...b, quiere: true, terminado: false }, accion: null };
    case 'pedirPausa':
      return { banderas: { ...b, quiere: false, avanza: false }, accion: null };
    case 'play':
      return { banderas: { ...b, quiere: true, terminado: false }, accion: null };
    case 'avanza':
      // Ha vuelto a sonar: se olvidan los reintentos.
      return { banderas: { ...b, quiere: true, avanza: true, datos: true, buscando: false, terminado: false, intentos: 0, error: null }, accion: null };
    case 'pausa':
      return { banderas: { ...b, quiere: false, avanza: false }, accion: null };
    case 'espera':
      return { banderas: { ...b, avanza: false, datos: false }, accion: null };
    case 'buscar':
      return { banderas: { ...b, buscando: true, terminado: false }, accion: null };
    case 'buscado':
      return { banderas: { ...b, buscando: false }, accion: null };
    case 'fin':
      return { banderas: { ...b, quiere: false, avanza: false, terminado: true }, accion: null };
    case 'error':
      return fallo(b, e.codigo);
    case 'atasco':
      if (!b.quiere || b.error) return igual;
      return fallo(b, MEDIA_ERR.RED);
    case 'reintentar':
      // «Reintentar» es también «reproducir»: la persona quiere oírlo.
      return { banderas: { ...b, error: null, intentos: 0, quiere: true }, accion: { tipo: 'renovar', esperaMs: 0 } };
  }
}

/**
 * Qué hacer ante un error. La causa más común a mitad de reproducción es que
 * la URL firmada caducó o la red se cortó: se pide otra y se sigue donde iba,
 * esperando 0,5 · 2^n s. «No admitido» antes de los metadatos puede ser también
 * una URL caducada (el servidor responde 403 y el navegador lo toma por un
 * formato raro): se renueva una vez y, si vuelve, es el formato.
 */
function fallo(b: Banderas, codigo: number): { banderas: Banderas; accion: Accion } {
  if (codigo === MEDIA_ERR.ABORTADO) return { banderas: b, accion: null };
  const formato = codigo === MEDIA_ERR.NO_ADMITIDO || codigo === MEDIA_ERR.DECODIFICACION;
  if (formato && !b.conocida && b.intentos >= 1) {
    return {
      banderas: { ...b, avanza: false, error: { tipo: 'formato', mensaje: 'Este navegador no puede reproducir el formato de este archivo.' } },
      accion: null,
    };
  }
  if (b.intentos >= MAX_INTENTOS) {
    return {
      banderas: { ...b, avanza: false, error: { tipo: 'agotado', mensaje: 'Se ha perdido la conexión con el archivo.' } },
      accion: null,
    };
  }
  return {
    banderas: { ...b, avanza: false, datos: false, intentos: b.intentos + 1 },
    accion: { tipo: 'renovar', esperaMs: b.intentos === 0 ? 0 : 500 * 2 ** (b.intentos - 1) },
  };
}

/** Velocidades disponibles, en orden, para [ y ]. */
export const VELOCIDADES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export function velocidadVecina(actual: number, dir: 1 | -1): number {
  const i = VELOCIDADES.findIndex((v) => Math.abs(v - actual) < 0.01);
  if (i < 0) return dir > 0 ? (VELOCIDADES.find((v) => v > actual) ?? 3) : ([...VELOCIDADES].reverse().find((v) => v < actual) ?? 0.5);
  return VELOCIDADES[Math.max(0, Math.min(VELOCIDADES.length - 1, i + dir))]!;
}

/**
 * Dónde retomar: la posición guardada si es útil (ni el principio ni el
 * final). Un instante pedido explícitamente (?t=, una cita) manda siempre.
 */
export function puntoDePartida(pedido: number | undefined, guardado: { t: number } | null, duracion: number | undefined): { t: number; retomado: boolean } {
  if (pedido != null && Number.isFinite(pedido) && pedido > 0) return { t: pedido, retomado: false };
  if (guardado && guardado.t > 10 && (!duracion || guardado.t < duracion - 15)) return { t: guardado.t, retomado: true };
  return { t: 0, retomado: false };
}
