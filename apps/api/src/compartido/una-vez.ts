/**
 * Un trabajo largo, una sola vez aunque lo pidan varios.
 *
 * Un paso de Workflow que caduca no detiene la llamada RPC que hizo: el Durable
 * Object sigue trabajando y el reintento del paso le llega mientras tanto. Antes,
 * ese reintento arrancaba un segundo trabajo igual en paralelo (los vectores se
 * pagaban dos veces y las escrituras se cruzaban), y el primero, al terminar,
 * borraba lo que el segundo necesitaba: una película de casi dos horas quedó en
 * error estando ya consolidada.
 *
 * - Mientras un trabajo con una clave está en marcha, quien pide la misma clave
 *   se suma a él y recibe su resultado.
 * - Con `recordar`, el resultado se guarda en el almacenamiento del objeto: quien
 *   llega después (otro reintento, el relanzamiento del vigilante) lo recibe sin
 *   repetir nada.
 * - Con `exclusivo`, los trabajos exclusivos de un mismo objeto van uno detrás de
 *   otro aunque tengan claves distintas: un relanzamiento que vuelve a preparar la
 *   ingesta (clave nueva) espera a que acabe la consolidación que seguía viva.
 * - Un fallo no se recuerda: el intento siguiente empieza de cero.
 */
export interface AlmacenUnaVez {
  get<T>(clave: string): Promise<T | undefined>;
  put<T>(clave: string, valor: T): Promise<void>;
}

export class UnaVez {
  private readonly enCurso = new Map<string, Promise<unknown>>();
  private fila: Promise<unknown> = Promise.resolve();

  constructor(private readonly almacen?: AlmacenUnaVez) {}

  hacer<T>(clave: string, fn: () => Promise<T>, opciones: { recordar?: boolean; exclusivo?: boolean } = {}): Promise<T> {
    const enMarcha = this.enCurso.get(clave);
    if (enMarcha) return enMarcha as Promise<T>;
    const recordar = !!opciones.recordar && !!this.almacen;
    const guardado = `una-vez:${clave}`;
    const turno = opciones.exclusivo ? this.fila : null;
    // Sin ningún «await» entre leer y apuntar el trabajo: dos peticiones no pueden colarse a la vez.
    const trabajo = (async () => {
      if (turno) await turno;
      if (recordar) {
        const hecho = await this.almacen!.get<{ valor: T }>(guardado);
        if (hecho) return hecho.valor;
      }
      const valor = await fn();
      if (recordar) await this.almacen!.put(guardado, { valor });
      return valor;
    })();
    this.enCurso.set(clave, trabajo);
    if (opciones.exclusivo) this.fila = trabajo.catch(() => undefined);
    const soltar = () => { if (this.enCurso.get(clave) === trabajo) this.enCurso.delete(clave); };
    trabajo.then(soltar, soltar);
    return trabajo;
  }
}
