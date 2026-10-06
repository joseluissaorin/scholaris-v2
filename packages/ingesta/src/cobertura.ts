/** Cobertura de la cola de latencia de las APIs. */

/**
 * Llamadas cubiertas: si una llamada tarda bastante más que la mediana de las ya
 * terminadas, se lanza una segunda idéntica y gana la primera que responda. La
 * cola larga de latencia de las APIs (3 s de mediana, 80 s de máximo) es lo que
 * marca el tiempo de reloj de un libro entero; cubrirla cuesta poco.
 */
export class Cobertura {
  private latencias: number[] = [];
  private lanzadas = 0;
  /**
   * Presupuesto: como mucho un 20 % de llamadas cubiertas. Si la API va lenta para
   * todos (carga), cubrir duplica la carga y empeora la cola: entonces no se cubre.
   */
  constructor(private readonly minimoMs = 15_000, private readonly factor = 2.2, private readonly reloj: () => number = Date.now, private readonly presupuesto = 0.2) {}
  umbral(): number {
    if (this.latencias.length < 3) return this.minimoMs * 1.5;
    const s = [...this.latencias].sort((a, b) => a - b);
    return Math.max(this.minimoMs, (s[Math.floor(s.length / 2)] as number) * this.factor);
  }
  anotar(ms: number) { this.latencias.push(ms); if (this.latencias.length > 200) this.latencias.shift(); }
  cubiertas = 0;
  async llamar<T>(fn: () => Promise<T>): Promise<T> {
    const t0 = this.reloj();
    this.lanzadas++;
    return new Promise<T>((resolver, rechazar) => {
      let hecho = false, fallos = 0, lanzadas = 1;
      const intento = () => fn().then(
        (v) => { if (!hecho) { hecho = true; clearTimeout(temporizador); this.anotar(this.reloj() - t0); resolver(v); } },
        (e) => { if (++fallos >= lanzadas && !hecho) { hecho = true; clearTimeout(temporizador); rechazar(e); } },
      );
      const temporizador = setTimeout(() => {
        if (hecho || this.cubiertas + 1 > Math.max(2, this.lanzadas * this.presupuesto)) return;
        lanzadas++; this.cubiertas++; void intento();
      }, this.umbral());
      void intento();
    });
  }
}

