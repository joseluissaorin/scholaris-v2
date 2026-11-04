/** El latido de un paso de Workflow no sobrevive a su plazo (incidente de la comprensión del 4-11-2026). */
import { describe, expect, it } from 'vitest';
import { conLatidoAcotado } from '../src/compartido/latido.js';

describe('latido acotado', () => {
  it('late mientras dura el paso y se calla al llegar al plazo aunque el trabajo siga pendiente', async () => {
    const avisos: number[] = [];
    const t0 = Date.now();
    let soltar!: (v: string) => void;
    const trabajo = new Promise<string>((r) => { soltar = r; });
    const paso = conLatidoAcotado(async (hasta) => { avisos.push(hasta); }, 0.2, () => trabajo, { intervaloMs: 40, avisoMs: 1000 });
    await new Promise((r) => setTimeout(r, 600));
    // Primer aviso al empezar, nunca más allá del plazo (+ un intervalo de gracia) y ninguno pasado el plazo.
    expect(avisos.length).toBeGreaterThanOrEqual(2);
    expect(avisos.length).toBeLessThanOrEqual(7);
    expect(Math.max(...avisos)).toBeLessThanOrEqual(t0 + 200 + 40 + 50);
    const n = avisos.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(avisos.length).toBe(n);
    soltar('hecho');
    expect(await paso).toBe('hecho');
  });

  it('un aviso que falla no tumba el paso', async () => {
    const r = await conLatidoAcotado(async () => { throw new Error('tarea caída'); }, 1, async () => 7, { intervaloMs: 10 });
    expect(r).toBe(7);
  });
});
