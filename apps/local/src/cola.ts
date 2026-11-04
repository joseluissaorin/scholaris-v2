/**
 * Cola local de ingesta, reanudable. Cada trabajo se apunta en la base de
 * cuentas antes de empezar; al arrancar se reanudan los que quedaron a medias.
 * Los pasos son los mismos que los del Workflow de la nube y las lecturas
 * quedan grabadas en el almacén, así que reanudar no vuelve a pagar ninguna.
 */
import type { Progreso, SQL } from '@scholaris/nucleo';
import { enParalelo } from '@scholaris/nucleo';
import type { Orquestador, ParamsIngesta, PuertosUsuario } from '@scholaris/api/puertos';
import {
  componer, ErrorReserva, leerPrimeraPagina, leerUnPliego, limpiarTrabajo, preparar, revectorizar, soloMedio, soloVectores, transcribirUnTramo, type ContextoMotor,
} from '@scholaris/api/compartido/motor-ingesta';
import { cerrarIngesta } from '@scholaris/api/compartido/cierre';
import { cacheEnAlmacen } from '@scholaris/api/compartido/motor-ingesta';
import { adelantarMoov, esMp4 } from '@scholaris/api/compartido/medio-rapido';
import { asegurarProxy, type HacerProxy } from '@scholaris/api/compartido/proxy';
import { apuntarProgreso, leerTarea } from '@scholaris/api/compartido/estanteria';
import { LIMITES } from '@scholaris/api/compartido/planes';
import { comprenderEnProceso, lanzarPendientes, type ParamsComprension } from '@scholaris/api/compartido/comprension';
import { completarTranscripcionEn } from '@scholaris/api/compartido/transcripcion';
import { pasoAplicarMedio, pasoPercepcionMedio, pasoRevisionMedio, type ContextoMedio } from '@scholaris/api/compartido/medios-existentes';

export interface DependenciasCola {
  /** Base donde se apuntan los trabajos (la de cuentas). */
  sql: SQL;
  puertosPara(usuario: string, plan: ParamsIngesta['plan']): Promise<PuertosUsuario>;
  convertir?: ContextoMotor['convertir'];
  recortar?: ContextoMotor['recortar'];
  /** Proxy ligero de los medios (lo que ven los modelos): ffmpeg local o el contenedor. */
  hacerProxy?: HacerProxy;
  /** Ingestas a la vez (cada una lee varios pliegos en paralelo). */
  concurrencia?: number;
  pliegosEnParalelo?: number;
  sinVerificacion?: boolean;
  /** Clave de Gemini del usuario (YouTube por URL). */
  gemini?(usuario: string): Promise<ContextoMotor['gemini']>;
}

class Cancelada extends Error {}

function legible(m: string): string {
  if (/cancelad/i.test(m)) return 'Cancelada.';
  if (/cuota|páginas de lectura|plan|navegador|YouTube|servidor|paquete|página respondió|texto que leer|clave|GEMINI|lector|embebedor/i.test(m)) return m;
  return 'No he podido leer este documento. Vuelve a intentarlo; si sigue fallando, prueba a subirlo de nuevo.';
}

export class ColaLocal implements Orquestador {
  private pendientes: ParamsIngesta[] = [];
  private enCurso = new Set<string>();
  private canceladas = new Set<string>();
  private listo: Promise<void>;

  constructor(private readonly d: DependenciasCola) {
    this.listo = (async () => {
      await d.sql.ejecutar(`CREATE TABLE IF NOT EXISTS cola_local (
        tarea TEXT PRIMARY KEY, usuario TEXT NOT NULL, params TEXT NOT NULL, estado TEXT NOT NULL, intentos INTEGER NOT NULL DEFAULT 0,
        error TEXT, creada TEXT NOT NULL, actualizada TEXT NOT NULL)`);
    })();
  }

  /** Reanuda lo que quedó a medias (al arrancar). */
  async reanudar(): Promise<number> {
    await this.listo;
    const filas = await this.d.sql.ejecutar<{ params: string }>("SELECT params FROM cola_local WHERE estado IN ('pendiente','ejecutando') ORDER BY creada");
    for (const f of filas) this.pendientes.push(JSON.parse(f.params) as ParamsIngesta);
    this.bombear();
    return filas.length;
  }

  async lanzarIngesta(p: ParamsIngesta): Promise<void> {
    await this.listo;
    const t = new Date().toISOString();
    await this.d.sql.ejecutar("INSERT OR REPLACE INTO cola_local (tarea, usuario, params, estado, creada, actualizada) VALUES (?, ?, ?, 'pendiente', ?, ?)", p.tarea, p.usuario, JSON.stringify(p), t, t);
    this.pendientes.push(p);
    this.bombear();
  }

  /**
   * La comprensión (docs/COMPRENSION.md), una detrás de otra en este mismo
   * proceso: es larga y cara, y no debe quitarle sitio a la lectura.
   */
  private comprensiones: ParamsComprension[] = [];
  private comprendiendo = false;

  async lanzarComprension(p: ParamsComprension): Promise<void> {
    this.comprensiones.push(p);
    void this.bombearComprension();
  }

  private async bombearComprension(): Promise<void> {
    if (this.comprendiendo) return;
    this.comprendiendo = true;
    try {
      while (this.comprensiones.length) {
        const p = this.comprensiones.shift()!;
        try {
          const puertos = await this.d.puertosPara(p.usuario, p.plan);
          await comprenderEnProceso(puertos, p, this.d.gemini ? await this.d.gemini(p.usuario) : undefined);
          await lanzarPendientes(puertos);
        } catch (e) {
          console.error(`[comprensión ${p.documento}]`, e);
        }
      }
    } finally {
      this.comprendiendo = false;
    }
  }

  async cancelar(tarea: string): Promise<void> {
    this.canceladas.add(tarea);
    this.pendientes = this.pendientes.filter((p) => p.tarea !== tarea);
    await this.d.sql.ejecutar("UPDATE cola_local SET estado = 'cancelada', actualizada = ? WHERE tarea = ?", new Date().toISOString(), tarea);
  }

  async estado(tarea: string): Promise<string | null> {
    const [f] = await this.d.sql.ejecutar<{ estado: string }>('SELECT estado FROM cola_local WHERE tarea = ?', tarea);
    return f?.estado ?? null;
  }

  /** Espera a que la cola se vacíe (pruebas, cierre ordenado). */
  async vaciar(): Promise<void> {
    while (this.pendientes.length || this.enCurso.size) await new Promise((r) => setTimeout(r, 100));
  }

  private bombear(): void {
    const max = this.d.concurrencia ?? 2;
    while (this.enCurso.size < max && this.pendientes.length) {
      const p = this.pendientes.shift()!;
      if (this.enCurso.has(p.tarea)) continue;
      this.enCurso.add(p.tarea);
      void this.ejecutar(p).finally(() => { this.enCurso.delete(p.tarea); this.bombear(); });
    }
  }

  private async ejecutar(p: ParamsIngesta): Promise<void> {
    const marcar = (estado: string, error?: string) => this.d.sql.ejecutar('UPDATE cola_local SET estado = ?, error = ?, actualizada = ?, intentos = intentos + ? WHERE tarea = ?',
      estado, error ?? null, new Date().toISOString(), estado === 'ejecutando' ? 1 : 0, p.tarea);
    const puertos = await this.d.puertosPara(p.usuario, p.plan);
    const inicio = Date.now();
    try {
      await marcar('ejecutando');
      const ia = await puertos.inteligencia();
      const ctx: ContextoMotor = {
        almacen: puertos.almacen,
        inteligencia: ia,
        sql: puertos.sql,
        indice: puertos.indice,
        espacioNombres: puertos.config.espacioNombres(p.usuario),
        ...(this.d.convertir ? { convertir: this.d.convertir } : {}),
        ...(this.d.recortar ? { recortar: this.d.recortar } : {}),
        ...(this.d.sinVerificacion ? { sinVerificacion: true } : {}),
        // Catálogos de metadatos: caché en disco (el almacén local) y clave de OpenAlex si la hay.
        catalogos: { cache: cacheEnAlmacen(puertos.almacen), ...(process.env.OPENALEX_API_KEY ? { claveOpenAlex: process.env.OPENALEX_API_KEY } : {}) },
        ...(this.d.gemini ? { gemini: await this.d.gemini(p.usuario) } : {}),
        alUnidades: async (desde: number, hasta: number) => { await puertos.emisor.emitir(`usuario:${p.usuario}`, { tipo: 'unidades', tarea: p.tarea, documento: p.documento, desde, hasta }); },
        alProgreso: async (pr: Progreso) => {
          if (this.canceladas.has(p.tarea)) throw new Cancelada('Cancelada.');
          const t = await leerTarea(puertos.sql, p.tarea);
          if (t && (t.estado === 'cancelada' || t.estado === 'error')) { this.canceladas.add(p.tarea); throw new Cancelada('Cancelada.'); }
          await apuntarProgreso(puertos.sql, pr);
          await puertos.emisor.emitir(`usuario:${p.usuario}`, { tipo: 'progreso', progreso: pr });
        },
      };
      const avisar = (fase: Progreso['fase'], avance: number, total: number, mensaje?: string) =>
        ctx.alProgreso!({ tarea: p.tarea, documento: p.documento, fase, avance, total, transcurrido: Date.now() - inicio, ...(mensaje ? { mensaje } : {}) });

      const medioExistente = soloMedio(p);
      if (soloVectores(p)) {
        await avisar('vectores', 0, 0.1, 'Calculando vectores');
        await revectorizar(ctx, p);
        await cerrarIngesta(puertos, { tarea: p.tarea, documento: p.documento, ok: true });
      } else if (medioExistente) {
        // Un medio que ya existe: proxy, revisión de la transcripción, percepción y la revisión aplicada (como en la nube).
        const cm: ContextoMedio = {
          almacen: puertos.almacen, sql: puertos.sql, inteligencia: ia, indice: puertos.indice, espacioNombres: ctx.espacioNombres,
          ...(ctx.gemini ? { gemini: ctx.gemini } : {}), ...(this.d.hacerProxy ? { hacerProxy: this.d.hacerProxy } : {}),
        };
        const avisos: Array<{ codigo: string; mensaje: string }> = [];
        try {
          await avisar('lectura', 0.2, 0.2, 'Revisando la transcripción');
          await pasoRevisionMedio(cm, p);
          if (medioExistente === 'percepcion') {
            await avisar('lectura', 0.4, 0.4, 'Mirando y escuchando la obra entera');
            await pasoPercepcionMedio(cm, p);
            if (p.plan !== 'gratis' && p.medio?.hablantes !== false) {
              await avisar('lectura', 0.8, 0.8, 'Revisando quién dice cada frase');
              await pasoRevisionMedio(cm, { ...p, medio: { ...p.medio, rehacer: true } }, { hablantes: true });
            }
          }
          await avisar('lectura', 0.9, 0.9, 'Reescribiendo la transcripción');
          const r = await pasoAplicarMedio(cm, p);
          if (!r.aplicada && r.motivo) avisos.push({ codigo: 'transcripcion_sin_aplicar', mensaje: r.motivo });
          console.log(JSON.stringify({ que: 'transcripcion-aplicada', ...r }));
        } catch (e) {
          if (e instanceof Cancelada) throw e;
          console.error(`[medio ${p.documento}]`, e);
          avisos.push({ codigo: 'transcripcion_sin_revisar', mensaje: 'No se pudo revisar la transcripción de este medio. Lo ya hecho se aprovecha si se vuelve a pedir.' });
        }
        await cerrarIngesta(puertos, { tarea: p.tarea, documento: p.documento, ok: true, ...(avisos.length ? { avisos } : {}) });
      } else {
        await avisar('conversion', 0, 0.01, p.paquete ? 'Planificando la lectura' : 'Convirtiendo en el servidor');
        const info = await preparar(ctx, p);
        const plan = puertos.config.modo === 'local' && !puertos.config.requiereAutenticacion ? 'local' : p.plan;
        if (LIMITES[plan].paginasMes !== null && !(await puertos.cuentas.consumir(p.usuario, plan, 'paginasMes', info.coste))) {
          throw new ErrorReserva(`Este documento necesita ${info.coste} páginas de lectura y no te quedan suficientes este mes.`);
        }
        const total = info.pliegos.length + info.tramos.length;
        let hechos = 0;
        const paso = async () => { hechos++; await avisar('lectura', hechos / Math.max(1, total), 0.03 + 0.22 * (hechos / Math.max(1, total)), `${hechos} de ${total}`); };
        await avisar('lectura', 0, 0.03, `${info.unidades} unidades; ${info.pliegos.length} pliegos de visión`);
        const primera = info.modo === 'paginas' ? leerPrimeraPagina(ctx, p, info).catch(() => 0) : Promise.resolve(0);
        await enParalelo(info.pliegos, this.d.pliegosEnParalelo ?? 6, async (id) => { await leerUnPliego(ctx, p, info, id); await paso(); });
        await primera;
        await enParalelo(info.tramos, this.d.pliegosEnParalelo ?? 6, async (n) => { await transcribirUnTramo(ctx, p, info, n); await paso(); });
        const [sub] = await puertos.sql.ejecutar<{ metadatos: string | null }>('SELECT metadatos FROM pl_subidas WHERE documento = ? ORDER BY creada DESC LIMIT 1', p.documento);
        const metadatosUsuario = sub?.metadatos ? (JSON.parse(sub.metadatos) as Record<string, unknown>) : null;
        // El original pudo seguir subiendo: se espera (hasta 2 h).
        const claveOriginal = info.original ?? p.original;
        let bytesOriginal: number | undefined;
        const prepararMedio = async () => {
          for (let i = 0; claveOriginal && i < 240; i++) {
            const cab = await puertos.almacen.cabecera(claveOriginal);
            if (cab) { bytesOriginal = cab.bytes; break; }
            await new Promise((res) => setTimeout(res, 30_000));
          }
          // MP4 con el índice al final: se pone delante para que suene al instante.
          if (claveOriginal && bytesOriginal && esMp4(info.mime ?? p.mime, claveOriginal)) {
            await adelantarMoov(puertos.almacen, claveOriginal, info.mime ?? p.mime).catch((e) => console.error(`[medio ${p.documento}]`, e));
          }
          // El proxy para los modelos (percepción, «ver» de Investigar, huecos de la transcripción). Si falla, el documento sigue valiendo.
          if (claveOriginal && bytesOriginal && this.d.hacerProxy && (p.tipo === 'video' || p.tipo === 'audio' || /^(video|audio)\//.test(info.mime ?? p.mime))) {
            const tipo = p.tipo === 'audio' || /^audio\//.test(info.mime ?? p.mime) ? 'audio' : 'video';
            await asegurarProxy({ almacen: puertos.almacen, hacerProxy: this.d.hacerProxy }, { prefijo: p.prefijo, original: claveOriginal, mime: info.mime ?? p.mime, tipo, nombre: p.nombre })
              .catch((e) => console.error(`[proxy ${p.documento}]`, e));
          }
        };
        // Audio y vídeo: el proxy antes de consolidar, y la transcripción se completa antes de consolidar
        // (huecos, tiempos rotos y, con percepción, hablantes: percepcion/NOTAS.md), como en la nube.
        const medio = info.modo === 'medio';
        if (medio) await prepararMedio();
        const r = await componer(ctx, p, info, metadatosUsuario, medio ? {
          antesDeConsolidar: async (ctxT) => {
            await avisar('lectura', 1, 0.7, 'Revisando la transcripción');
            const resumen = await completarTranscripcionEn(ctx, ctxT, p, {
              plan: plan === 'gratis' ? 'gratis' : 'pro',
              alProgreso: (pr) => { void Promise.resolve(avisar('lectura', pr.hechas / Math.max(1, pr.total), 0.7, pr.fase === 'huecos' ? `Revisando la transcripción: ${pr.hechas} de ${pr.total} tramos sin texto` : `Revisando quién habla: ${pr.hechas} de ${pr.total} ventanas`)).catch(() => undefined); },
            });
            console.log(JSON.stringify({ que: 'transcripcion-completa', documento: p.documento, ...resumen }));
          },
        } : {});
        if (!medio) await prepararMedio();
        await cerrarIngesta(puertos, {
          tarea: p.tarea, documento: p.documento, ok: true, original: info.original ?? p.original, bibliotecas: p.bibliotecas ?? [], unidades: r.unidades,
          ...(info.mime ? { mime: info.mime } : {}), ...(info.bytes ?? bytesOriginal ? { bytes: info.bytes ?? bytesOriginal } : {}),
          ...(r.vectoresPendientes ? { avisos: [{ codigo: 'vectores_pendientes', mensaje: 'Los vectores aún no están en el índice: ya se puede leer y buscar por texto, y la búsqueda semántica llegará en unos minutos.' }] } : {}),
          ...(metadatosUsuario ? { metadatosUsuario } : {}),
        });
        await limpiarTrabajo(puertos.almacen, p);
      }
      await marcar('hecha');
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      if (!(e instanceof Cancelada)) console.error(`[ingesta ${p.tarea}]`, e);
      await cerrarIngesta(puertos, { tarea: p.tarea, documento: p.documento, ok: false, error: legible(mensaje) }).catch(() => undefined);
      await marcar(e instanceof Cancelada ? 'cancelada' : 'error', mensaje);
    } finally {
      this.canceladas.delete(p.tarea);
    }
  }
}
