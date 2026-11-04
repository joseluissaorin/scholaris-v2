/**
 * La región de las citas en la página (docs/COMPRENSION.md, principio 1, «Ancla
 * material y evidencia»). Al terminar de redactar, cada prueba citada en una página
 * con sus caracteres recibe su sitio en la imagen: en un PDF digital, por la capa de
 * texto (gratis); en un escaneo, por visión (con caché en el almacén). Solo las
 * citadas, y una vez por sitio: es perezoso a propósito. Nunca hace fallar la
 * investigación: una cita que no se localiza se queda con sus caracteres.
 */
import type { AnclaMaterial, Region } from '@scholaris/nucleo';
import type { ContextoHerramientas } from './contexto.js';
import type { AnclajeInvestigar } from './puertos.js';
import type { Prueba } from './pruebas.js';
import type { Numerador } from './sintesis.js';

export interface ResultadoRegionesCitas {
  /** Citas de página con caracteres y sin región. */
  candidatas: number;
  /** Las que la tienen ahora. */
  regiones: number;
  /** Pruebas del cuaderno con la misma ancla que la cita (la región también es suya): para volver a emitirlas. */
  pruebas: Prueba[];
  uso: { modelo: string; tokensEntrada: number; tokensSalida: number; usd: number; llamadas: number };
}

export interface OpcionesRegionesCitas {
  /** Si puede mirar la imagen (cuesta); se pregunta antes de cada localización. Por defecto, sí. */
  vision?: boolean | (() => boolean);
  /** Localizaciones a la vez (por defecto 3: se hacen mientras se verifica). */
  concurrencia?: number;
  /** Como mucho, tantas citas (por defecto 60). */
  maximo?: number;
}

const mismos = (a?: [number, number], b?: [number, number]) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

/** Pone la región a las citas de página de la respuesta (las modifica en su sitio) y a las pruebas de donde salen, si es la misma ancla. */
export async function regionesDeCitas(ctx: ContextoHerramientas, numerador: Numerador, o: OpcionesRegionesCitas = {}): Promise<ResultadoRegionesCitas> {
  const uso = { modelo: '', tokensEntrada: 0, tokensSalida: 0, usd: 0, llamadas: 0 };
  const vacio: ResultadoRegionesCitas = { candidatas: 0, regiones: 0, pruebas: [], uso };
  if (!ctx.p.anclajeMaterial) return vacio;
  const candidatas = numerador.marcadas.filter((m) => {
    const a = m.evidencia.ancla as AnclaMaterial;
    const amb = m.prueba.ambito;
    return a.tipo === 'pagina' && !a.region && !!a.caracteres && !!amb && amb.ancla.tipo === 'pagina' && !!amb.texto;
  }).slice(0, o.maximo ?? 60);
  if (!candidatas.length) return vacio;

  const anclajes = new Map<string, AnclajeInvestigar | null>();
  const anclajeDe = (documento: string) => {
    if (!anclajes.has(documento)) {
      let a: AnclajeInvestigar | null = null;
      try { a = ctx.p.anclajeMaterial?.(documento) ?? null; } catch { a = null; }
      anclajes.set(documento, a);
    }
    return anclajes.get(documento) ?? null;
  };
  // Un sitio (documento, unidad, caracteres) se localiza una vez aunque lo citen dos marcas.
  const grupos = new Map<string, typeof candidatas>();
  for (const m of candidatas) {
    const c = (m.evidencia.ancla as AnclaMaterial).caracteres!;
    const clave = `${m.evidencia.documento}|${m.prueba.ambito!.orden}|${c[0]}-${c[1]}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), m]);
  }
  let regiones = 0;
  const pruebas = new Set<Prueba>();
  const lista = [...grupos.values()];
  let siguiente = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, o.concurrencia ?? 3), lista.length) }, async () => {
    while (siguiente < lista.length) {
      const grupo = lista[siguiente++]!;
      const m = grupo[0]!;
      const amb = m.prueba.ambito!;
      const caracteres = (m.evidencia.ancla as AnclaMaterial).caracteres!;
      const anclaje = anclajeDe(m.evidencia.documento);
      if (!anclaje) continue;
      const vision = typeof o.vision === 'function' ? o.vision() : o.vision !== false;
      // Los caracteres cuentan puntos de código del texto de la unidad: la cita es ese trozo, tal cual.
      const cita = Array.from(amb.texto).slice(caracteres[0], caracteres[1]).join('');
      let region: Region | undefined;
      try { region = await anclaje.region(amb.orden, { caracteres, ...(cita.trim() ? { cita } : {}), vision }); } catch { region = undefined; }
      if (!region) continue;
      for (const x of grupo) {
        x.evidencia = { ...x.evidencia, ancla: { ...x.evidencia.ancla, region } as AnclaMaterial };
        regiones++;
        const pa = x.prueba.evidencia.ancla as AnclaMaterial;
        if (pa.tipo === 'pagina' && !pa.region && mismos(pa.caracteres, caracteres)) {
          x.prueba.evidencia = { ...x.prueba.evidencia, ancla: { ...pa, region } };
          pruebas.add(x.prueba);
        }
      }
    }
  }));
  for (const a of anclajes.values()) {
    if (!a) continue;
    const u = a.uso();
    if (!u.llamadas) continue;
    uso.modelo = uso.modelo || u.modelo;
    uso.tokensEntrada += u.tokensEntrada; uso.tokensSalida += u.tokensSalida; uso.usd += u.usd; uso.llamadas += u.llamadas;
  }
  return { candidatas: candidatas.length, regiones, pruebas: [...pruebas], uso };
}
