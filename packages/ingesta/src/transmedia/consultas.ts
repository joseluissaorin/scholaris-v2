/**
 * Lo que corresponde a un pasaje en las obras relacionadas: la traducción de un
 * párrafo del original (o el original de un párrafo traducido), la escena que
 * adapta una página. Sirve para citar el original con su traducción al lado
 * (docs/COMPRENSION.md, «Transidioma», principio 5) y para que Investigar y la
 * interfaz salten de una obra a otra.
 */
import type { Alineacion, AnclaMaterial, LadoAlineacion, SQL } from '@scholaris/nucleo';
import { leerAlineaciones, leerUnidades } from '@scholaris/spdf';

export interface Correspondencia {
  alineacion: Alineacion;
  /** El lado del documento pedido. */
  propio: LadoAlineacion;
  /** El otro lado (vacío si el pasaje se añadió o se suprimió). */
  otro?: LadoAlineacion;
  /** El texto literal del otro lado (de su ancla a su ancla de cierre), si es texto o transcripción. */
  textoOtro?: string;
}

const enRango = (a: AnclaMaterial, fin: AnclaMaterial | undefined, x: AnclaMaterial): boolean => {
  if (a.tipo === 'tiempo' && x.tipo === 'tiempo') {
    const t1 = fin?.tipo === 'tiempo' ? fin.t1 : a.t1;
    return x.t0 < t1 && x.t1 > a.t0;
  }
  if (a.tipo === 'pagina' && x.tipo === 'pagina') {
    const f0 = a.fisica, f1 = fin?.tipo === 'pagina' ? fin.fisica : f0;
    if (x.fisica < f0 || x.fisica > f1) return false;
    if (!x.caracteres) return true;
    const c0 = x.fisica === f0 ? a.caracteres?.[0] ?? 0 : 0;
    const c1 = x.fisica === f1 ? (fin ?? a).caracteres?.[1] ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    return x.caracteres[0] < c1 && x.caracteres[1] > c0;
  }
  return false;
};

/** El texto literal de un lado (unidades de su ancla a su ancla de cierre, recortadas por sus caracteres). */
export async function textoDeLado(sql: SQL, l: LadoAlineacion, max = 4000): Promise<string> {
  const unidades = await leerUnidades(sql, l.documento);
  const clave = (a: AnclaMaterial) => JSON.stringify(a.tipo === 'pagina' ? [a.fisica] : a.tipo === 'tiempo' ? [a.t0] : [a]);
  const sin = (a: AnclaMaterial) => { const { caracteres: _c, region: _r, instante: _i, ...resto } = a; return resto; };
  if (l.ancla.tipo === 'tiempo') {
    const t0 = l.ancla.t0, t1 = l.anclaFin?.tipo === 'tiempo' ? l.anclaFin.t1 : l.ancla.t1;
    const us = unidades.filter((u) => u.ancla.tipo === 'tiempo' && u.ancla.t0 < t1 && u.ancla.t1 > t0);
    if (us.length === 1 && l.ancla.caracteres) return Array.from(us[0]!.texto ?? '').slice(...l.ancla.caracteres).join('').slice(0, max);
    return us.map((u) => u.texto ?? '').join('\n').slice(0, max);
  }
  const i0 = unidades.findIndex((u) => clave(u.ancla) === clave(sin(l.ancla)));
  const fin = l.anclaFin ?? l.ancla;
  const i1 = unidades.findIndex((u) => clave(u.ancla) === clave(sin(fin)));
  if (i0 < 0) return '';
  const partes: string[] = [];
  for (let i = i0; i <= Math.max(i0, i1); i++) {
    const cps = Array.from(unidades[i]!.texto ?? '');
    const desde = i === i0 ? l.ancla.caracteres?.[0] ?? 0 : 0;
    const hasta = i === Math.max(i0, i1) ? fin.caracteres?.[1] ?? cps.length : cps.length;
    partes.push(cps.slice(desde, hasta).join(''));
  }
  return partes.join('\n\n').slice(0, max);
}

/** Las correspondencias de un pasaje (un ancla de un documento) en todas sus relaciones, con el texto del otro lado. */
export async function correspondencias(sql: SQL, documento: string, ancla: AnclaMaterial, o: { limite?: number } = {}): Promise<Correspondencia[]> {
  const salida: Correspondencia[] = [];
  for (const x of await leerAlineaciones(sql, { documento })) {
    const propio = x.a?.documento === documento ? x.a : x.b?.documento === documento ? x.b : undefined;
    if (!propio || !enRango(propio.ancla, propio.anclaFin, ancla)) continue;
    const otro = propio === x.a ? x.b : x.a;
    salida.push({ alineacion: x, propio, ...(otro ? { otro, textoOtro: await textoDeLado(sql, otro) } : {}) });
    if (salida.length >= (o.limite ?? 10)) break;
  }
  return salida;
}
