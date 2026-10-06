/**
 * Remuestreo en flujo a 16 kHz mono: mezcla de canales, filtro paso bajo
 * (sinc con ventana de Blackman) e interpolación lineal. Suficiente para voz.
 */

export class Remuestreador {
  private readonly razon: number;
  private readonly nucleo: Float32Array;
  private historia: Float32Array;
  private pos = 0; // posición fraccionaria en la señal filtrada, relativa al bloque actual
  private anterior = 0; // última muestra filtrada del bloque anterior

  constructor(readonly entrada: number, readonly salida = 16000, taps = 48) {
    this.razon = entrada / salida;
    const corte = Math.min(0.5, 0.5 / this.razon) * 0.9; // ciclos por muestra de entrada
    const n = this.razon > 1 ? taps | 1 : 1;
    this.nucleo = new Float32Array(n);
    if (n === 1) this.nucleo[0] = 1;
    else {
      const m = (n - 1) / 2;
      let suma = 0;
      for (let i = 0; i < n; i++) {
        const x = i - m;
        const sinc = x === 0 ? 2 * corte : Math.sin(2 * Math.PI * corte * x) / (Math.PI * x);
        const ventana = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
        this.nucleo[i] = sinc * ventana;
        suma += this.nucleo[i] as number;
      }
      for (let i = 0; i < n; i++) (this.nucleo as Float32Array)[i] = (this.nucleo[i] as number) / suma;
    }
    this.historia = new Float32Array(n - 1);
  }

  /** Mezcla canales a mono. */
  static mono(canales: Float32Array[]): Float32Array {
    if (canales.length === 1) return canales[0] as Float32Array;
    const n = Math.min(...canales.map((c) => c.length));
    const out = new Float32Array(n);
    for (const c of canales) for (let i = 0; i < n; i++) out[i] = (out[i] as number) + (c[i] as number) / canales.length;
    return out;
  }

  /** Procesa un bloque mono a la frecuencia de entrada; devuelve las muestras a 16 kHz. */
  procesar(bloque: Float32Array): Float32Array {
    if (this.entrada === this.salida) return bloque;
    const k = this.nucleo.length;
    const ext = new Float32Array(this.historia.length + bloque.length);
    ext.set(this.historia);
    ext.set(bloque, this.historia.length);
    const filtrada = new Float32Array(bloque.length);
    for (let i = 0; i < bloque.length; i++) {
      let s = 0;
      for (let j = 0; j < k; j++) s += (ext[i + j] as number) * (this.nucleo[j] as number);
      filtrada[i] = s;
    }
    this.historia = ext.slice(ext.length - (k - 1));
    const salida: number[] = [];
    while (this.pos < filtrada.length - 1 + 1e-9) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const a = i < 0 ? this.anterior : (filtrada[i] as number);
      const b = filtrada[i + 1] ?? a;
      salida.push(a + (b - a) * f);
      this.pos += this.razon;
    }
    this.pos -= filtrada.length;
    this.anterior = filtrada[filtrada.length - 1] ?? 0;
    return Float32Array.from(salida);
  }
}
