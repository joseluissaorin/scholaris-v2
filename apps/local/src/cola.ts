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
  componer, ErrorReserva, leerUnPliego, limpiarTrabajo, preparar, revectorizar, soloVectores, transcribirUnTramo, type ContextoMotor,
} from '@scholaris/api/compartido/motor-ingesta';
import { cerrarIngesta } from '@scholaris/api/compartido/cierre';
import { apuntarProgreso, leerTarea } from '@scholaris/api/compartido/estanteria';
import { LIMITES } from '@scholaris/api/compartido/planes';

export interface DependenciasCola {
  /** Base donde se apuntan los trabajos (la de cuentas). */
  sql: SQL;
  puertosPara(usuario: string, plan: ParamsIngesta['plan']): Promise<PuertosUsuario>;
  convertir?: ContextoMotor['convertir'];
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
        ...(this.d.sinVerificacion ? { sinVerificacion: true } : {}),
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

      if (soloVectores(p)) {
        await avisar('vectores', 0, 0.1, 'Calculando vectores');
        await revectorizar(ctx, p);
        await cerrarIngesta(puertos, { tarea: p.tarea, documento: p.documento, ok: true });
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
        await enParalelo(info.pliegos, this.d.pliegosEnParalelo ?? 6, async (id) => { await leerUnPliego(ctx, p, info, id); await paso(); });
        await enParalelo(info.tramos, this.d.pliegosEnParalelo ?? 6, async (n) => { await transcribirUnTramo(ctx, p, info, n); await paso(); });
        const [sub] = await puertos.sql.ejecutar<{ metadatos: string | null }>('SELECT metadatos FROM pl_subidas WHERE documento = ? ORDER BY creada DESC LIMIT 1', p.documento);
        const metadatosUsuario = sub?.metadatos ? (JSON.parse(sub.metadatos) as Record<string, unknown>) : null;
        const r = await componer(ctx, p, info, metadatosUsuario);
        await cerrarIngesta(puertos, {
          tarea: p.tarea, documento: p.documento, ok: true, original: info.original ?? p.original, bibliotecas: p.bibliotecas ?? [], unidades: r.unidades,
          ...(info.mime ? { mime: info.mime } : {}), ...(info.bytes ? { bytes: info.bytes } : {}),
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
