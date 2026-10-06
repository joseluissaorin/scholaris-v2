import { avisar } from '@scholaris/ui';
import { api } from '../datos/api';

/** Nombre de fichero seguro a partir del título. */
export const nombreFichero = (titulo: string) => titulo.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'documento';

/**
 * Descarga el .spdf que arma el servidor. Si algo se quedó fuera, el servidor lo
 * dice en `x-scholaris-aviso` (con encodeURIComponent) junto a
 * `x-scholaris-omitidos: N`; se enseña en un aviso que no bloquea.
 */
export async function descargarSpdfServidor(id: string, titulo: string) {
  avisar(`Preparando «${titulo}.spdf»…`);
  try {
    const res = await api().bruto('GET', `/documentos/${encodeURIComponent(id)}/spdf`);
    const datos = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([datos], { type: 'application/x-spdf' }));
    a.download = `${nombreFichero(titulo)}.spdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    const aviso = avisoDeCabeceras(res.headers);
    if (aviso) avisar(aviso, { duracion: 9000 });
  } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo exportar.', { tono: 'error' }); }
}

export function avisoDeCabeceras(h: Headers): string | null {
  const crudo = h.get('x-scholaris-aviso');
  if (!crudo) return null;
  let texto: string;
  try { texto = decodeURIComponent(crudo); } catch { texto = crudo; }
  texto = texto.trim();
  if (!texto) return null;
  const n = Number(h.get('x-scholaris-omitidos'));
  // El servidor ya explica qué falta; el número solo se añade si el texto no lo dice.
  return Number.isFinite(n) && n > 0 && !texto.includes(String(n)) ? `${texto} (${n} ${n === 1 ? 'elemento omitido' : 'elementos omitidos'})` : texto;
}
