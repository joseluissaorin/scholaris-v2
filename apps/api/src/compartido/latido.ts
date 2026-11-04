/**
 * Latido acotado para un paso de Workflow que espera a un Trabajador.
 *
 * Mientras el trabajo dura, avisa al vigilante (`vivo(hasta)`) cada `intervaloMs`, pero
 * nunca más allá del plazo del paso: si el paso caduca, su promesa puede seguir
 * pendiente en el aislamiento del Workflow, y un latido sin fin taparía al vigilante
 * (así pasó con la comprensión el 4-11-2026: el paso de entidades caducó tres veces y
 * la tarea seguía «viva»). El latido de trabajo real lo da el propio Trabajador.
 */
export async function conLatidoAcotado<T>(
  vivo: (hasta: number) => Promise<unknown>, segundos: number, fn: () => Promise<T>,
  o: { intervaloMs?: number; avisoMs?: number; reloj?: () => number } = {},
): Promise<T> {
  const reloj = o.reloj ?? Date.now;
  const intervalo = o.intervaloMs ?? 60_000;
  const aviso = o.avisoMs ?? 4 * 60_000;
  const fin = reloj() + segundos * 1000;
  await vivo(Math.min(fin, reloj() + aviso)).catch(() => undefined);
  const latido = setInterval(() => {
    if (reloj() >= fin) { clearInterval(latido); return; }
    void vivo(Math.min(fin + intervalo, reloj() + aviso)).catch(() => undefined);
  }, intervalo);
  try { return await fn(); } finally { clearInterval(latido); }
}
