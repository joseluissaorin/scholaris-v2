/**
 * Paso de folios: el número impreso de cada página.
 *
 * Fuentes, de más a menos fiable: las etiquetas de página del PDF (/PageLabels)
 * cuando son informativas y concuerdan con lo que se ve; los folios que ve el
 * lector o la capa, validados por consenso de desplazamiento (física − folio
 * constante en una zona); y la deducción para las páginas sin número dentro de
 * una zona. Los romanos de los preliminares se tratan como zona propia.
 *
 * `@scholaris/folios` (con Jev para los casos dudosos) se enchufa con
 * `opciones.deducir`; esta es la implementación propia, pura y sin red.
 */

import { aRomano, deRomano, type AnclaPagina } from '@scholaris/nucleo';
import type { Procedencia, UnidadLeida } from '../tipos.js';

export interface EntradaFolio {
  fisica: number;
  visto: string | null;
  etiqueta: string | null;
  vacia: boolean;
}

interface Lectura { fisica: number; valor: number; romano: boolean }

export function interpretarFolio(s: string | null | undefined): { valor: number; romano: boolean } | null {
  if (!s) return null;
  const t = s.trim().replace(/^[\[(—–\-·.\s]+|[\])—–\-·.\s]+$/g, '');
  if (/^\d{1,4}$/.test(t)) {
    const v = parseInt(t, 10);
    return v > 0 ? { valor: v, romano: false } : null;
  }
  const r = deRomano(t);
  return r !== null ? { valor: r, romano: true } : null;
}

/** ¿Las etiquetas del PDF dicen algo más que 1, 2, 3…? */
export function etiquetasInformativas(entradas: EntradaFolio[]): boolean {
  const con = entradas.filter((e) => e.etiqueta);
  if (con.length < entradas.length * 0.8) return false;
  return con.some((e) => e.etiqueta !== String(e.fisica));
}

/** Zonas de desplazamiento constante (física − valor) por consenso. */
function zonas(lecturas: Lectura[]): Array<{ desde: number; hasta: number; desplazamiento: number; romano: boolean; apoyos: number }> {
  const salida: Array<{ desde: number; hasta: number; desplazamiento: number; romano: boolean; apoyos: number }> = [];
  for (const romano of [true, false]) {
    const ls = lecturas.filter((l) => l.romano === romano).sort((a, b) => a.fisica - b.fisica);
    let i = 0;
    while (i < ls.length) {
      const d = (ls[i] as Lectura).fisica - (ls[i] as Lectura).valor;
      let j = i, apoyos = 0, ultimo = i, fallos = 0;
      while (j < ls.length) {
        const l = ls[j] as Lectura;
        if (l.fisica - l.valor === d) { apoyos++; ultimo = j; fallos = 0; }
        else if (++fallos > 2) break;
        j++;
      }
      // Una zona necesita dos apoyos (o uno solo si el documento casi no tiene folios).
      if (apoyos >= 2 || (apoyos === 1 && ls.length <= 2)) {
        salida.push({ desde: (ls[i] as Lectura).fisica, hasta: (ls[ultimo] as Lectura).fisica, desplazamiento: d, romano, apoyos });
      }
      i = ultimo + 1;
    }
  }
  return salida.sort((a, b) => a.desde - b.desde);
}

export function deducirFolios(entradas: EntradaFolio[]): AnclaPagina[] {
  const ninguno = (fisica: number): AnclaPagina => ({ tipo: 'pagina', fisica, impresa: null, romana: false, origen: 'ninguno', confianza: 0 });
  const vistos: Lectura[] = [];
  for (const e of entradas) {
    const f = interpretarFolio(e.visto);
    if (f && (f.romano ? f.valor <= 80 : f.valor <= 9999)) vistos.push({ fisica: e.fisica, ...f });
  }

  // 1. Etiquetas del PDF, si son informativas y no contradicen lo que se ve.
  if (etiquetasInformativas(entradas)) {
    let acuerdo = 0, comparadas = 0;
    for (const v of vistos) {
      const e = entradas.find((x) => x.fisica === v.fisica);
      const et = interpretarFolio(e?.etiqueta ?? null);
      if (!et) continue;
      comparadas++;
      if (et.valor === v.valor && et.romano === v.romano) acuerdo++;
    }
    if (comparadas === 0 || acuerdo / comparadas >= 0.7) {
      const vistosPor = new Map(vistos.map((v) => [v.fisica, v]));
      return entradas.map((e) => {
        const et = interpretarFolio(e.etiqueta);
        if (!e.etiqueta) return ninguno(e.fisica);
        const visto = vistosPor.get(e.fisica);
        const coincide = visto && et && visto.valor === et.valor;
        return {
          tipo: 'pagina', fisica: e.fisica, impresa: et?.romano ? (e.etiqueta as string).toLowerCase() : (e.etiqueta as string),
          romana: Boolean(et?.romano), origen: coincide ? 'leido' : 'deducido', confianza: coincide ? 0.99 : comparadas ? 0.9 : 0.8,
        };
      });
    }
  }

  // 2. Consenso de desplazamiento sobre lo que se ve.
  const zs = zonas(vistos);
  if (!zs.length) {
    return entradas.map((e) => {
      const f = interpretarFolio(e.visto);
      return f ? { tipo: 'pagina', fisica: e.fisica, impresa: f.romano ? aRomano(f.valor) : String(f.valor), romana: f.romano, origen: 'leido', confianza: 0.5 } : ninguno(e.fisica);
    });
  }
  // Extender cada zona hasta donde empieza la siguiente (las páginas sin número del medio son de la zona).
  const ext = zs.map((z, i) => {
    const sig = zs[i + 1];
    const hasta = sig ? sig.desde - 1 : entradas.at(-1)?.fisica ?? z.hasta;
    return { ...z, hastaExt: hasta };
  });
  const vistoPor = new Map(vistos.map((v) => [v.fisica, v]));
  return entradas.map((e) => {
    const zona = ext.find((z) => e.fisica >= z.desde && e.fisica <= z.hastaExt);
    const visto = vistoPor.get(e.fisica);
    if (zona) {
      const valor = e.fisica - zona.desplazamiento;
      if (valor < 1) return ninguno(e.fisica);
      const impresa = zona.romano ? aRomano(valor) : String(valor);
      if (visto && visto.valor === valor && visto.romano === zona.romano) return { tipo: 'pagina', fisica: e.fisica, impresa, romana: zona.romano, origen: 'leido', confianza: 0.98 };
      // Dentro de la zona leída, deducción; más allá del último apoyo, algo menos de confianza.
      const dentro = e.fisica <= zona.hasta;
      const lejos = e.fisica - zona.hasta;
      const confianza = dentro ? 0.9 : Math.max(0.55, 0.88 - lejos * 0.01);
      return { tipo: 'pagina', fisica: e.fisica, impresa, romana: zona.romano, origen: 'deducido', confianza: visto ? confianza - 0.1 : confianza };
    }
    // Antes de la primera zona: extrapolar hacia atrás solo unas pocas páginas y si sale ≥ 1.
    const primera = ext[0] as (typeof ext)[number];
    if (e.fisica < primera.desde && !primera.romano) {
      const valor = e.fisica - primera.desplazamiento;
      if (valor >= 1 && primera.desde - e.fisica <= 6 && !e.vacia) return { tipo: 'pagina', fisica: e.fisica, impresa: String(valor), romana: false, origen: 'deducido', confianza: 0.6 };
    }
    if (visto) return { tipo: 'pagina', fisica: e.fisica, impresa: visto.romano ? aRomano(visto.valor) : String(visto.valor), romana: visto.romano, origen: 'leido', confianza: 0.5 };
    return ninguno(e.fisica);
  });
}

export interface OpcionesFolios {
  /** Deductor externo (p. ej. `@scholaris/folios` con Jev). */
  deducir?: (entradas: EntradaFolio[]) => Promise<AnclaPagina[]>;
  reloj?: () => number;
}

/** Paso de folios: pone el ancla de página a cada unidad. */
export async function pasoFolios(unidades: UnidadLeida[], opciones: OpcionesFolios = {}): Promise<{ anclas: AnclaPagina[]; procedencia: Procedencia }> {
  const reloj = opciones.reloj ?? Date.now;
  const t = reloj();
  const entradas: EntradaFolio[] = unidades.map((u) => ({ fisica: u.fisica, visto: u.folioVisto, etiqueta: u.etiqueta ?? null, vacia: u.vacia }));
  let anclas: AnclaPagina[];
  let proveedor = 'folios-propio';
  if (opciones.deducir) {
    try { anclas = await opciones.deducir(entradas); proveedor = 'folios'; }
    catch { anclas = deducirFolios(entradas); }
  } else anclas = deducirFolios(entradas);
  const cuenta = { leido: 0, deducido: 0, ninguno: 0, epub: 0 };
  for (const a of anclas) cuenta[a.origen]++;
  return { anclas, procedencia: { fase: 'folios', proveedor, ms: reloj() - t, detalle: { ...cuenta, vistos: entradas.filter((e) => e.visto).length } } };
}
