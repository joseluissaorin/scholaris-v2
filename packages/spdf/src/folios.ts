/**
 * Rehacer los folios de un documento ya ingerido, sin volver a leerlo.
 *
 * Toma las unidades guardadas (texto, cabecera, pie, ancla anterior) y vuelve a
 * pasar `@scholaris/folios`: lo que la ingesta dio por leído se usa como lectura
 * del lector; si los folios salieron de las etiquetas del PDF, esas etiquetas
 * vuelven a entrar como tales. Actualiza el ancla de las unidades, los
 * fragmentos (ancla y ancla_fin) y las figuras, y deja constancia en la
 * procedencia. Funciona sobre cualquier puerto SQL (Durable Object, sqlite-wasm,
 * node:sqlite).
 */

import type { Ancla, AnclaPagina, Juez, SQL, ValorSQL } from '@scholaris/nucleo';
import { aAncla, calcularFolios, type PaginaFolio, type ResultadoFolios } from '@scholaris/folios';
import { registrarProcedencia } from './repositorio.js';

type Fila = Record<string, ValorSQL>;

export interface ResultadoRehacerFolios {
  documento: string;
  /** Unidades de página del documento (0 si no es paginado: audio, vídeo…). */
  unidades: number;
  /** Unidades cuyo folio impreso cambió. */
  cambiadas: number;
  /** Unidades cuya ancla se reescribió (folio, origen o confianza). */
  actualizadas: number;
  fragmentos: number;
  figuras: number;
  fuente: ResultadoFolios['fuente'] | null;
  estrategia: ResultadoFolios['estrategia'] | null;
  /** Cambios, como «física: antes → después» (los 50 primeros). */
  cambios: string[];
  avisos: string[];
}

const leer = <T>(v: ValorSQL | undefined, def: T): T => {
  if (typeof v !== 'string' || !v) return def;
  try { return JSON.parse(v) as T; } catch { return def; }
};

const igual = (a: AnclaPagina, b: AnclaPagina) => a.impresa === b.impresa && a.romana === b.romana && a.origen === b.origen && Math.abs(a.confianza - b.confianza) < 1e-9;

/** ¿Los folios anteriores salieron de las etiquetas del PDF? (procedencia más reciente de la fase «folios»). */
async function veniaDeEtiquetas(sql: SQL, documento: string): Promise<boolean> {
  const filas = await sql.ejecutar<Fila>("SELECT proveedor, detalle FROM procedencia WHERE documento = ? AND fase = 'folios' ORDER BY rowid DESC LIMIT 1", documento);
  const f = filas[0];
  if (!f) return false;
  if (f.proveedor === 'etiquetas-pdf') return true;
  return leer<{ fuente?: string }>(f.detalle, {}).fuente === 'etiquetas';
}

export async function rehacerFolios(sql: SQL, documento: string, opciones: { juez?: Juez; simular?: boolean } = {}): Promise<ResultadoRehacerFolios> {
  const t0 = Date.now();
  const filas = await sql.ejecutar<Fila>('SELECT id, orden, ancla, texto, cabecera, pie FROM unidades WHERE documento = ? ORDER BY orden', documento);
  const conFiguras = new Set((await sql.ejecutar<Fila>('SELECT DISTINCT unidad FROM figuras WHERE documento = ?', documento)).map((f) => String(f.unidad)));
  const unidades = filas
    .map((f) => ({ id: String(f.id), ancla: leer<Ancla>(f.ancla, { tipo: 'imagen' }), texto: String(f.texto ?? ''), cabecera: String(f.cabecera ?? ''), pie: String(f.pie ?? '') }))
    .filter((u): u is typeof u & { ancla: AnclaPagina } => u.ancla.tipo === 'pagina');
  const vacio: ResultadoRehacerFolios = { documento, unidades: unidades.length, cambiadas: 0, actualizadas: 0, fragmentos: 0, figuras: 0, fuente: null, estrategia: null, cambios: [], avisos: [] };
  if (!unidades.length) return { ...vacio, avisos: ['El documento no tiene páginas: no hay folios que rehacer.'] };

  const etiquetas = await veniaDeEtiquetas(sql, documento);
  const paginas: PaginaFolio[] = unidades.map((u) => {
    const vacia = !u.texto.trim() && !u.cabecera.trim() && !u.pie.trim() && !conFiguras.has(u.id);
    const p: PaginaFolio = {
      fisica: u.ancla.fisica, texto: u.texto.slice(0, 600), cabecera: u.cabecera, pie: u.pie, vacia,
      folio: u.ancla.origen === 'leido' ? u.ancla.impresa : null,
    };
    if (etiquetas) p.etiqueta = u.ancla.impresa;
    return p;
  });
  const r = await calcularFolios(paginas, opciones.juez ? { juez: opciones.juez } : {});
  const nuevas = new Map<number, AnclaPagina>(r.paginas.map((f) => [f.fisica, aAncla(f)]));

  const cambios: string[] = [];
  const porId = new Map<string, AnclaPagina>();
  for (const u of unidades) {
    const n = nuevas.get(u.ancla.fisica);
    if (!n || igual(n, u.ancla)) continue;
    porId.set(u.id, n);
    if (n.impresa !== u.ancla.impresa) cambios.push(`${u.ancla.fisica}: ${u.ancla.impresa ?? '—'} → ${n.impresa ?? '—'}`);
  }
  const reanclar = (a: Ancla | null): Ancla | null => (a && a.tipo === 'pagina' ? nuevas.get(a.fisica) ?? a : a);

  let fragmentos = 0, figuras = 0;
  if (!opciones.simular && porId.size) {
    await sql.transaccion(async (t) => {
      for (const [id, a] of porId) await t.ejecutar('UPDATE unidades SET ancla = ?, impresa = ? WHERE id = ?', JSON.stringify(a), a.impresa, id);
      for (const f of await t.ejecutar<Fila>('SELECT id, ancla, ancla_fin FROM fragmentos WHERE documento = ?', documento)) {
        const a = leer<Ancla | null>(f.ancla, null), b = leer<Ancla | null>(f.ancla_fin, null);
        const na = reanclar(a), nb = reanclar(b);
        if (JSON.stringify(na) === JSON.stringify(a) && JSON.stringify(nb) === JSON.stringify(b)) continue;
        await t.ejecutar('UPDATE fragmentos SET ancla = ?, ancla_fin = ? WHERE id = ?', JSON.stringify(na), nb ? JSON.stringify(nb) : null, String(f.id));
        fragmentos++;
      }
      for (const f of await t.ejecutar<Fila>('SELECT id, ancla FROM figuras WHERE documento = ?', documento)) {
        const a = leer<Ancla | null>(f.ancla, null);
        const na = reanclar(a);
        if (!na || JSON.stringify(na) === JSON.stringify(a)) continue;
        await t.ejecutar('UPDATE figuras SET ancla = ? WHERE id = ?', JSON.stringify(na), String(f.id));
        figuras++;
      }
    });
  }
  const resultado: ResultadoRehacerFolios = {
    documento, unidades: unidades.length, cambiadas: cambios.length, actualizadas: porId.size, fragmentos, figuras, fuente: r.fuente, estrategia: r.estrategia,
    cambios: cambios.slice(0, 50), avisos: r.avisos,
  };
  if (!opciones.simular) {
    const cuenta = { leido: 0, deducido: 0, ninguno: 0, epub: 0 };
    for (const a of nuevas.values()) cuenta[a.origen]++;
    await registrarProcedencia(sql, {
      documento, fase: 'folios', proveedor: opciones.juez ? `folios-rehacer+${opciones.juez.nombre}` : 'folios-rehacer', ms: Date.now() - t0,
      detalle: { fuente: r.fuente, estrategia: r.estrategia, disposicion: r.disposicion, juez: r.juez, cambiadas: cambios.length, actualizadas: porId.size, fragmentos, figuras, ...cuenta, avisos: r.avisos.slice(0, 5) },
    });
  }
  return resultado;
}
