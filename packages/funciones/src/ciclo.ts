/**
 * Enganches del ciclo de vida para la plataforma: qué hacer cuando entra o
 * sale un documento de la estantería.
 */

import { invalidarInstantanea } from './corpus.js';
import { borrarEntidadesDocumento, extraerEntidadesDocumento, reanudarEntidades } from './entidades/trabajo.js';
import { actualizarGrafoDocumento } from './grafo/grafo.js';
import type { PuertosFunciones } from './puertos.js';
import { vigilarIngesta, type AlertaCompleta } from './vigilantes.js';

export interface ResultadoIngesta {
  alertas: AlertaCompleta[];
  errores: string[];
}

/**
 * Tras ingerir un documento: invalida las cifras del corpus, actualiza el
 * grafo de citas (salientes y entrantes), lanza los vigilantes y extrae las
 * entidades (personas, obras, lugares…) para el grafo de conocimiento. Nunca lanza:
 * los fallos van en `errores`, la ingesta ya está hecha.
 */
export async function alIngerirDocumento(p: PuertosFunciones, documento: string): Promise<ResultadoIngesta> {
  const errores: string[] = [];
  try { await invalidarInstantanea(p.sql); } catch (e) { errores.push(`corpus: ${(e as Error).message}`); }
  try { await actualizarGrafoDocumento(p.sql, documento); } catch (e) { errores.push(`grafo: ${(e as Error).message}`); }
  let alertas: AlertaCompleta[] = [];
  try { alertas = await vigilarIngesta(p, documento); } catch (e) { errores.push(`vigilantes: ${(e as Error).message}`); }
  // Entidades: lo último, porque es lo más largo (unos segundos por cada 20 000 caracteres).
  // Ya corre en segundo plano; si el proceso muere a medias, se reanuda por lotes.
  if (p.inteligencia?.redactor) {
    try {
      await extraerEntidadesDocumento(p, documento);
      await reanudarEntidades(p, { maximo: 3 });
    } catch (e) { errores.push(`entidades: ${(e as Error).message}`); }
  }
  return { alertas, errores };
}

/** Tras borrar un documento: limpia sus aristas del grafo y las cifras. */
export async function alBorrarDocumento(p: PuertosFunciones, documento: string): Promise<void> {
  await invalidarInstantanea(p.sql);
  await actualizarGrafoDocumento(p.sql, documento);
  await borrarEntidadesDocumento(p.sql, documento);
  await p.sql.ejecutar('DELETE FROM mapa_puntos WHERE documento = ?', documento);
  await p.sql.ejecutar("UPDATE cuadernos_tarjetas SET estado = 'huerfana' WHERE documento = ?", documento);
}
