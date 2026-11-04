/**
 * El puerto del modelo del agente: un LLM que sabe llamar a herramientas, mirar
 * medios (vídeo, audio e imágenes) y escribir por trozos. Lo implementa Gemini
 * (gemini.ts); las pruebas usan uno guionizado.
 */

/** Una herramienta tal como la ve el modelo (parámetros en JSON Schema). */
export interface DeclaracionHerramienta {
  nombre: string;
  descripcion: string;
  parametros: Record<string, unknown>;
}

export interface LlamadaHerramienta {
  /** Identificador de la llamada, si el proveedor lo da (se devuelve con la respuesta). */
  id?: string;
  nombre: string;
  args: Record<string, unknown>;
}

export type ParteMensaje =
  | { tipo: 'texto'; texto: string }
  | ({ tipo: 'llamada' } & LlamadaHerramienta)
  | { tipo: 'respuesta'; id?: string; nombre: string; contenido: Record<string, unknown> }
  /** Un medio subido (Gemini Files): vídeo o audio, con su tramo en segundos si se recorta. */
  | { tipo: 'medio'; uri: string; mime: string; desde?: number; hasta?: number; fps?: number }
  /** Bytes en línea (una página escaneada, un fotograma). */
  | { tipo: 'bytes'; bytes: Uint8Array; mime: string };

export interface MensajeAgente {
  rol: 'usuario' | 'modelo';
  partes: ParteMensaje[];
  /**
   * El contenido tal como lo devolvió el proveedor (con las firmas de pensamiento de
   * Gemini 3): si está, se le devuelve tal cual en el turno siguiente.
   */
  crudo?: unknown;
}

export interface UsoModelo {
  modelo: string;
  entrada: number;
  salida: number;
  cache: number;
  usd: number;
  ms: number;
}

export type NivelPensamiento = 'minimo' | 'bajo' | 'medio' | 'alto';

export interface PeticionModelo {
  sistema?: string;
  mensajes: MensajeAgente[];
  herramientas?: DeclaracionHerramienta[];
  /** Salida JSON con este esquema (sin herramientas). */
  esquema?: Record<string, unknown>;
  temperatura?: number;
  maxTokens?: number;
  pensamiento?: NivelPensamiento;
  /** Resolución con que se miran los medios (baja = 66 tokens por fotograma). */
  resolucion?: 'baja' | 'media' | 'alta';
  /** Obligar a llamar a alguna herramienta en este turno. */
  obligarHerramienta?: boolean;
  /** Señal para cancelar. */
  signal?: AbortSignal;
}

export interface RespuestaModelo {
  /** El mensaje del modelo, para añadirlo al historial. */
  mensaje: MensajeAgente;
  texto: string;
  llamadas: LlamadaHerramienta[];
  json?: unknown;
  uso: UsoModelo;
  /** Motivo de fin del proveedor (STOP, MAX_TOKENS…). */
  fin?: string;
}

export type TrozoModelo = { delta: string } | { uso: UsoModelo };

export interface ModeloAgente {
  readonly nombre: string;
  turno(p: PeticionModelo): Promise<RespuestaModelo>;
  /** Texto por trozos (sin herramientas). Si falta, se usa `turno`. */
  flujo?(p: PeticionModelo): AsyncIterable<TrozoModelo>;
}

/** Suma de lo gastado en todas las llamadas de una investigación. */
export class Contabilidad {
  usd = 0;
  entrada = 0;
  salida = 0;
  llamadas = 0;
  readonly porModelo = new Map<string, { usd: number; llamadas: number }>();

  apuntar(u: UsoModelo): void {
    this.usd += u.usd;
    this.entrada += u.entrada;
    this.salida += u.salida;
    this.llamadas++;
    const m = this.porModelo.get(u.modelo) ?? { usd: 0, llamadas: 0 };
    m.usd += u.usd;
    m.llamadas++;
    this.porModelo.set(u.modelo, m);
  }
}

/** Texto entero de un `flujo` (o del `turno` si no hay flujo), apuntando el uso. */
export async function* flujoDe(modelo: ModeloAgente, p: PeticionModelo, cuentas?: Contabilidad): AsyncGenerator<string> {
  if (modelo.flujo) {
    for await (const t of modelo.flujo(p)) {
      if ('delta' in t) yield t.delta;
      else cuentas?.apuntar(t.uso);
    }
    return;
  }
  const r = await modelo.turno(p);
  cuentas?.apuntar(r.uso);
  yield r.texto;
}
