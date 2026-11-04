/**
 * `percibirMedio`: el modelo multimodal ve (o escucha) la obra entera por
 * ventanas con solape, con la transcripción de cada ventana, el reparto y la
 * lente, y lo que devuelve se funde en un `PercepcionMedio`.
 *
 * Idempotente y reanudable: cada ventana se graba en el almacén de trabajo en
 * cuanto llega, con una clave que depende de todo lo que cambia la respuesta
 * (versión del prompt, modelo, lente, medio, fps, resolución, tramo). Repetir la
 * llamada no paga dos veces; si se cae a la mitad, sigue donde iba.
 */
import { enParalelo, sha256 } from '@scholaris/nucleo';
import type { PersonaPercibida } from '@scholaris/nucleo';
import { esquemaVentana, instruccionesSistema, textoVentana, VERSION_PERCEPCION } from './esquema.js';
import { fusionar, normalizarVentana, type VentanaNormalizada } from './fusion.js';
import { fusionarReparto, repartoInicial, separarInterpretes, Unificador } from './reparto.js';
import type { CostePercepcion, FicheroModelo, Mirada, OpcionesPercepcion, PercepcionConCoste, PuertosPercepcion } from './tipos.js';
import { hablantesDe, partirVentana, transcripcionDeVentana, turnosDe, ventanasDe, type Turno, type Ventana } from './ventanas.js';

export class ErrorPresupuesto extends Error {
  constructor(readonly usd: number, readonly limite: number) {
    super(`La percepción se detuvo al llegar al presupuesto (${usd.toFixed(2)} de ${limite.toFixed(2)} USD); lo hecho queda grabado.`);
    this.name = 'ErrorPresupuesto';
  }
}

/** Lo que se graba de cada ventana. */
export interface VentanaGrabada {
  ventana: Ventana;
  modelo: string;
  version: string;
  crudo: unknown;
  usd: number;
  tokensEntrada: number;
  tokensSalida: number;
  ms: number;
  fecha: string;
}

/** Errores que piden subir otra vez el fichero: caducado, borrado o sin permiso. */
const FICHERO_CADUCADO = /HTTP (403|404)|not exist|NOT_FOUND|PERMISSION_DENIED|expired|caducad/i;
/** Salida cortada o ilegible: la ventana se parte en dos. */
const SALIDA_CORTADA = /MAX_TOKENS|JSON ilegible|salida cortada/i;

export interface OpcionesVentana {
  medio: 'video' | 'audio';
  lente: OpcionesPercepcion['lente'];
  ficha?: string;
  idioma?: string;
  reparto: PersonaPercibida[];
  interpretes?: string[];
  turnos: Turno[];
  cortes?: number[];
  n: number;
  total: number;
  modelo?: string;
  fps?: number;
  resolucion?: OpcionesPercepcion['resolucion'];
  pensamiento?: OpcionesPercepcion['pensamiento'];
}

/** Una llamada al modelo para una ventana (lo usa también el banco). */
export async function mirarVentana(vidente: PuertosPercepcion['vidente'], fuente: FicheroModelo, v: Ventana, o: OpcionesVentana): Promise<Mirada> {
  const m = await vidente.mirar({
    fuente, desde: v.t0, hasta: v.t1,
    sistema: instruccionesSistema(o.medio, o.lente, o.idioma),
    texto: textoVentana({
      medio: o.medio, lente: o.lente, ...(o.ficha ? { ficha: o.ficha } : {}), ...(o.idioma ? { idioma: o.idioma } : {}),
      t0: v.t0, t1: v.t1, n: o.n, total: o.total, reparto: o.reparto, ...(o.interpretes?.length ? { interpretes: o.interpretes } : {}), transcripcion: transcripcionDeVentana(o.turnos, v.t0, v.t1),
      ...(o.cortes ? { cortes: o.cortes } : {}),
    }),
    esquema: esquemaVentana(o.medio),
    ...(o.modelo ? { modelo: o.modelo } : {}),
    ...(o.fps ? { fps: o.fps } : {}),
    ...(o.resolucion ? { resolucion: o.resolucion } : {}),
    ...(o.pensamiento ? { pensamiento: o.pensamiento } : {}),
    temperatura: 0.2,
    maxTokens: 65_536,
  });
  if (m.json === undefined) throw new Error(`Salida cortada o JSON ilegible del modelo (${m.fin ?? '¿?'})`);
  return m;
}

export async function percibirMedio(p: PuertosPercepcion, o: OpcionesPercepcion): Promise<PercepcionConCoste> {
  const reloj = p.reloj ?? Date.now;
  const largo = o.largo ?? 480;
  const solapeV = o.solape ?? 30;
  const ventanas = ventanasDe(o.duracion, largo, solapeV);
  const turnos = turnosDe(o.unidades);
  const { personajes, interpretes } = separarInterpretes(o.reparto);
  const conocidos = repartoInicial(personajes, hablantesDe(turnos));
  const modelo = o.modelo ?? p.vidente.nombre.replace(/^[^:]*:/, '');
  const huella = (await sha256(JSON.stringify([VERSION_PERCEPCION, modelo, o.medio, o.lente, o.fps ?? 1, o.resolucion ?? 'media', o.pensamiento ?? '', o.idioma ?? '', o.cortes?.length ? 'cortes' : '']))).slice(0, 12);
  const prefijo = `${o.prefijoTrabajo ?? 'percepcion/'}${huella}/`;
  const coste: CostePercepcion = { usd: 0, llamadas: 0, tokensEntrada: 0, tokensSalida: 0, ms: 0, grabadas: 0 };
  const avisos: string[] = [];
  const hechas: VentanaGrabada[] = [];
  let terminadas = 0;
  let total = ventanas.length;

  let fichero: Promise<FicheroModelo> | null = null;
  const fuente = (renovar = false) => {
    if (!fichero || renovar) {
      fichero = p.fuente(renovar ? { renovar: true } : undefined);
      fichero.catch(() => { fichero = null; });
    }
    return fichero;
  };

  // El reparto que ven las ventanas: el conocido, más lo que describió la primera.
  let repartoVisto: PersonaPercibida[] = conocidos;

  const hacer = async (v: Ventana, n: number): Promise<void> => {
    const clave = `${prefijo}${v.id}.json`;
    const grabada = await p.trabajo.leer(clave).catch(() => null);
    if (grabada) {
      try {
        hechas.push(JSON.parse(grabada) as VentanaGrabada);
        coste.grabadas++;
        terminadas++;
        await p.alProgreso?.({ hechas: terminadas, total, usd: coste.usd, ventana: { t0: v.t0, t1: v.t1, grabada: true } });
        return;
      } catch { /* grabación rota: se repite */ }
    }
    if (o.presupuestoUsd !== undefined && coste.usd >= o.presupuestoUsd) throw new ErrorPresupuesto(coste.usd, o.presupuestoUsd);
    const t = reloj();
    let m: Mirada | null = null;
    let ultimoError: unknown = null;
    for (let intento = 0; intento < 3 && !m; intento++) {
      try {
        m = await mirarVentana(p.vidente, await fuente(intento > 0 && FICHERO_CADUCADO.test(String((ultimoError as Error)?.message ?? ''))), v, {
          medio: o.medio, lente: o.lente, ...(o.ficha ? { ficha: o.ficha } : {}), ...(o.idioma ? { idioma: o.idioma } : {}),
          reparto: repartoVisto, interpretes, turnos, ...(o.cortes ? { cortes: o.cortes } : {}), n, total: ventanas.length,
          modelo, ...(o.fps ? { fps: o.fps } : {}), ...(o.resolucion ? { resolucion: o.resolucion } : {}), ...(o.pensamiento ? { pensamiento: o.pensamiento } : {}),
        });
      } catch (e) {
        ultimoError = e;
        const msg = String((e as Error)?.message ?? e);
        if (SALIDA_CORTADA.test(msg) && v.t1 - v.t0 > 150) {
          // No cabe: dos mitades, cada una dueña de la mitad de su tramo.
          const [a, b] = partirVentana(v, solapeV);
          total++;
          avisos.push(`La ventana ${Math.round(v.t0)}-${Math.round(v.t1)} s no cupo en una respuesta y se partió en dos.`);
          await Promise.all([hacer(a, n), hacer(b, n)]);
          return;
        }
        if (/bloquead|SAFETY|PROHIBITED/i.test(msg)) break;
      }
    }
    if (!m) {
      terminadas++;
      avisos.push(`No se pudo percibir el tramo ${Math.round(v.t0)}-${Math.round(v.t1)} s: ${String((ultimoError as Error)?.message ?? ultimoError).slice(0, 200)}`);
      await p.alProgreso?.({ hechas: terminadas, total, usd: coste.usd });
      return;
    }
    const registro: VentanaGrabada = {
      ventana: v, modelo: m.modelo, version: VERSION_PERCEPCION, crudo: m.json, usd: m.usd ?? 0,
      tokensEntrada: m.tokensEntrada, tokensSalida: m.tokensSalida, ms: reloj() - t, fecha: new Date(reloj()).toISOString(),
    };
    await p.trabajo.escribir(clave, JSON.stringify(registro));
    hechas.push(registro);
    coste.usd += registro.usd; coste.llamadas++; coste.tokensEntrada += m.tokensEntrada; coste.tokensSalida += m.tokensSalida; coste.ms += registro.ms;
    terminadas++;
    await p.alProgreso?.({ hechas: terminadas, total, usd: coste.usd, ventana: { t0: v.t0, t1: v.t1, grabada: false } });
  };

  // La primera ventana sola: su descripción de cada persona guía a las demás.
  if (ventanas.length) {
    await hacer(ventanas[0]!, 1);
    const primera = hechas.find((h) => h.ventana.t0 === ventanas[0]!.t0);
    if (primera) repartoVisto = fusionarReparto([conocidos, normalizarVentana(primera.ventana, primera.crudo, new Unificador(conocidos)).reparto], new Unificador(conocidos)).slice(0, 40);
  }
  let parada: unknown = null;
  await enParalelo(ventanas.slice(1).map((v, i) => [v, i + 2] as const), o.concurrencia ?? 4, async ([v, n]) => {
    if (parada) return;
    try { await hacer(v, n); } catch (e) { parada ??= e; }
  });
  if (parada) throw parada;

  // Quién interpreta a quién, según lo que dijeron las ventanas: así un personaje nombrado por su actor
  // («Jorge Perugorría») se lleva también a su nombre en la obra.
  const previo = new Unificador(conocidos);
  const conActor: PersonaPercibida[] = hechas.flatMap((h) => {
    const r = (h.crudo as { reparto?: unknown } | null)?.reparto;
    return (Array.isArray(r) ? r : []).flatMap((x: { nombre?: unknown; actor?: unknown }) =>
      typeof x?.nombre === 'string' && typeof x.actor === 'string' && x.actor.trim() && x.nombre.trim() ? [{ nombre: previo.canonico(x.nombre), actor: x.actor.trim() }] : []);
  });
  const repartoConocido = fusionarReparto([conocidos, conActor.filter((p) => conocidos.some((c) => c.nombre === p.nombre))], new Unificador(conocidos));
  const unificador = new Unificador(repartoConocido);
  const normalizadas: VentanaNormalizada[] = hechas.map((h) => normalizarVentana(h.ventana, h.crudo, unificador));
  for (const v of normalizadas) if (v.desplazada) avisos.push(`Las marcas de la ventana ${Math.round(v.ventana.t0)}-${Math.round(v.ventana.t1)} s venían desde el inicio de la ventana y se desplazaron.`);
  const f = fusionar(normalizadas, { duracion: o.duracion, ...(o.cortes ? { cortes: o.cortes } : {}), ...(o.ajustarCortes !== undefined ? { ajustarCortes: o.ajustarCortes } : {}), repartoConocido, unificador });
  const modelos = [...new Set(hechas.map((h) => h.modelo))];
  return {
    documento: o.documento,
    modelo: modelos.join('+') || modelo,
    version: VERSION_PERCEPCION,
    duracion: o.duracion,
    reparto: f.reparto,
    escenas: f.escenas,
    avisos: [...avisos, ...f.avisos],
    coste,
    ventanas: hechas.sort((a, b) => a.ventana.t0 - b.ventana.t0).map((h) => ({ t0: h.ventana.t0, t1: h.ventana.t1, modelo: h.modelo, usd: h.usd, ms: h.ms })),
  };
}
