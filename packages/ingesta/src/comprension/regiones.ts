/**
 * La región de las pruebas en la página (docs/COMPRENSION.md, principio 1, «Ancla
 * material y evidencia»). `anclarReferencias` da los caracteres de cada cita en el
 * texto de su unidad; aquí se añade su sitio en la imagen de la página con el
 * anclaje material: la unión de las líneas que ocupa en un PDF digital (gratis) o
 * lo que localiza el modelo en un escaneo (con caché).
 *
 * Nunca hace fallar una ficha: una prueba que no se localiza se queda con sus
 * caracteres. La visión respeta el presupuesto del documento.
 */
import { enParalelo, type Evidencia, type Ficha, type Region } from '@scholaris/nucleo';
import { textoDeCaracteres } from './anclaje.js';
import { sumarUso } from './estado.js';
import type { Material } from './material.js';
import type { AnclajeMaterialDocumento, ContextoComprension, UsoModelo } from './tipos.js';

export interface ResultadoRegiones {
  /** Pruebas de página que no tenían región. */
  candidatas: number;
  /** Las que la tienen ahora. */
  regiones: number;
}

export interface OpcionesRegiones {
  /** Si puede mirar la imagen (cuesta); se pregunta antes de cada localización. Por defecto, sí. */
  vision?: boolean | (() => boolean);
  /** Localizaciones a la vez (por defecto 6: el cupo de conexiones de una invocación de Workers). */
  concurrencia?: number;
}

/** Una prueba de página con sus caracteres y sin región todavía. */
const sinRegion = (e: Evidencia) => e.ancla.tipo === 'pagina' && !e.ancla.region && !!e.ancla.caracteres && !!e.unidad;

/** Las pruebas de unas fichas que pueden recibir región. */
export function candidatasRegion(m: Pick<Material, 'porId'>, fichas: readonly Ficha[]): Evidencia[] {
  return fichas.flatMap((f) => f.evidencias.filter((e) => sinRegion(e) && m.porId.get(e.unidad!)?.ancla.tipo === 'pagina'));
}

/**
 * Pone la región a las pruebas de página de unas fichas que aún no la tienen (las
 * modifica en su sitio). La misma cita en dos fichas se localiza una sola vez.
 */
export async function regionesDeFichas(
  anclaje: AnclajeMaterialDocumento, m: Pick<Material, 'porId'>, fichas: readonly Ficha[], o: OpcionesRegiones = {},
): Promise<ResultadoRegiones> {
  const grupos = new Map<string, { orden: number; caracteres: [number, number]; cita: string; evidencias: Evidencia[] }>();
  const candidatas = candidatasRegion(m, fichas);
  for (const e of candidatas) {
    const u = m.porId.get(e.unidad!)!;
    const caracteres = e.ancla.caracteres!;
    const clave = `${u.orden}:${caracteres[0]}-${caracteres[1]}`;
    const g = grupos.get(clave) ?? { orden: u.orden, caracteres, cita: textoDeCaracteres(u, caracteres) || e.cita || '', evidencias: [] };
    g.evidencias.push(e);
    grupos.set(clave, g);
  }
  let regiones = 0;
  await enParalelo([...grupos.values()], Math.max(1, o.concurrencia ?? 6), async (g) => {
    const vision = typeof o.vision === 'function' ? o.vision() : o.vision !== false;
    let region: Region | undefined;
    try {
      region = await anclaje.region(g.orden, { caracteres: g.caracteres, ...(g.cita.trim() ? { cita: g.cita } : {}), vision });
    } catch { region = undefined; }
    if (!region) return;
    for (const e of g.evidencias) e.ancla = { ...e.ancla, region };
    regiones += g.evidencias.length;
  });
  return { candidatas: candidatas.length, regiones };
}

/**
 * Las regiones de las pruebas de un paso: pide el anclaje del documento, deja mirar
 * mientras quede presupuesto, suma lo gastado a `acumulado` y devuelve el detalle
 * para la procedencia (`regiones`, `sinRegion`); vacío si no había nada que anclar.
 */
export async function regionesDelPaso(
  ctx: ContextoComprension, m: Material, fichas: readonly Ficha[], acumulado: { uso: UsoModelo }, o: { gastado: number; presupuestoUsd: number },
): Promise<Record<string, number>> {
  if (!ctx.anclajeMaterial || !candidatasRegion(m, fichas).length) return {};
  let anclaje: AnclajeMaterialDocumento;
  try { anclaje = ctx.anclajeMaterial(m.documento.id); } catch { return {}; }
  const antes = acumulado.uso.usd;
  const r = await regionesDeFichas(anclaje, m, fichas, { vision: () => o.gastado + antes + anclaje.uso().usd < o.presupuestoUsd });
  const uso = anclaje.uso();
  if (uso.llamadas) acumulado.uso = sumarUso(acumulado.uso, uso);
  return { regiones: r.regiones, ...(r.candidatas > r.regiones ? { sinRegion: r.candidatas - r.regiones } : {}) };
}
