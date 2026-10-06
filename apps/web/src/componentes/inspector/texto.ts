/** Búsqueda sin tildes ni mayúsculas en las descripciones (todas las palabras, por su principio). */
export const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();

export function coincide(consulta: string, ...textos: Array<string | null | undefined>): boolean {
  const q = sinTildes(consulta).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!q.length) return true;
  const t = sinTildes(textos.filter(Boolean).join(' '));
  return q.every((w) => t.includes(w));
}
