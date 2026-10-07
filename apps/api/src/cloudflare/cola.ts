/** Mensajes de la cola de segundo plano. */
export type MensajeCola =
  | { tipo: 'vigilantes'; usuario: string; plan: 'gratis' | 'pro'; modo: 'diario' | 'semanal' }
  /** Volver a mandar a Vectorize los vectores de un documento que se quedaron pendientes. */
  | { tipo: 'reindexar'; usuario: string; documento: string }
  /** Mantenimiento de una cuenta entera, por tandas con reanudación: reinsertar en Vectorize o rellenar vectores de figuras. */
  | { tipo: 'mantenimiento'; usuario: string; trabajo: TrabajoMantenimiento; desde?: string };

export type TrabajoMantenimiento = 'reindexar' | 'figuras';

/** Lo que sabe hacer el consumidor con cada tipo de mensaje. */
export interface ManejadoresCola {
  vigilantes(b: Extract<MensajeCola, { tipo: 'vigilantes' }>): Promise<unknown>;
  reindexar(b: Extract<MensajeCola, { tipo: 'reindexar' }>): Promise<unknown>;
  mantenimiento(b: Extract<MensajeCola, { tipo: 'mantenimiento' }>): Promise<unknown>;
}

interface MensajeLote { body: unknown; attempts: number; ack(): void; retry(o?: { delaySeconds?: number }): void }

/**
 * Atiende un lote. Un tipo que este despliegue no conoce NO se confirma: vuelve
 * a la cola (lo atenderá un despliegue más nuevo) en vez de perderse en silencio.
 */
export async function atenderLote(mensajes: readonly MensajeLote[], m: ManejadoresCola): Promise<{ hechos: number; reintentos: number; desconocidos: number }> {
  let hechos = 0, reintentos = 0, desconocidos = 0;
  for (const msg of mensajes) {
    const b = msg.body as MensajeCola;
    try {
      if (b?.tipo === 'vigilantes') await m.vigilantes(b);
      else if (b?.tipo === 'reindexar') await m.reindexar(b);
      else if (b?.tipo === 'mantenimiento') await m.mantenimiento(b);
      else {
        console.warn(JSON.stringify({ nivel: 'aviso', cola: 'tipo_desconocido', tipo: (b as { tipo?: unknown } | null)?.tipo ?? null }));
        msg.retry({ delaySeconds: 300 });
        desconocidos++;
        continue;
      }
      msg.ack();
      hechos++;
    } catch (e) {
      console.error(JSON.stringify({ nivel: 'error', cola: msg.body, error: (e as Error).message }));
      msg.retry({ delaySeconds: Math.min(900, 60 * 2 ** Math.min(4, msg.attempts)) });
      reintentos++;
    }
  }
  return { hechos, reintentos, desconocidos };
}
