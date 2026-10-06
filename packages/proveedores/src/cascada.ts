/**
 * Cascada de lectores: prueba cada lector en orden y solo pasa al siguiente
 * las páginas que no superan el control de calidad (texto vacío en una página
 * que no está en blanco, proporción de basura, bucles, confianza baja) o el
 * pliego entero si el lector falla.
 *
 * Cada página devuelta lleva además `lector` (quién la leyó) y, si hubo
 * reintentos, `intentos` (por qué lectores pasó): la ingesta lo guarda como
 * procedencia.
 */

import type { Lector, PaginaLeida } from '@scholaris/nucleo';
import { cortarPdf } from './pdf.js';
import { evaluarPagina, paginaFaltante, type VeredictoCalidad } from './lectura.js';
import { paginasDe, type EntradaPliego } from './pliego.js';

export type PaginaConLector = PaginaLeida & { lector: string; intentos?: string[] };

export interface OpcionesCascada {
  /** Control de calidad por página. Por defecto, `evaluarPagina`. */
  evaluar?: (p: PaginaLeida) => VeredictoCalidad;
  /** Aviso cada vez que unas páginas pasan al siguiente lector. */
  alPasar?: (info: { lector: string; paginas: number[]; motivo: string }) => void;
  nombre?: string;
}

export function cascadaLectores(lectores: Lector[], opciones: OpcionesCascada = {}): Lector {
  if (!lectores.length) throw new Error('cascadaLectores: hace falta al menos un lector');
  const evaluar = opciones.evaluar ?? ((p: PaginaLeida) => evaluarPagina(p));
  const avisar = opciones.alPasar ?? (() => {});

  /** Sub-entrada con solo las páginas físicas pedidas (contiguas). */
  async function subEntrada(e: EntradaPliego, desde: number, hasta: number): Promise<EntradaPliego> {
    const i0 = desde - e.primeraFisica, i1 = hasta - e.primeraFisica + 1;
    if (e.imagenes?.length) return { ...e, imagenes: e.imagenes.slice(i0, i1), primeraFisica: desde };
    return { ...e, pdf: await cortarPdf(e.pdf as Uint8Array, i0, i1), primeraFisica: desde };
  }

  return {
    nombre: opciones.nombre ?? `cascada(${lectores.map((l) => l.nombre).join(' → ')})`,
    async leerPliego(entrada) {
      const n = await paginasDe(entrada);
      const finales = new Map<number, PaginaConLector>();
      /** Mejor intento fallido por página, por si ningún lector la supera. */
      const mejores = new Map<number, PaginaConLector>();
      const recorrido = new Map<number, string[]>();
      let pendientes = Array.from({ length: n }, (_, i) => entrada.primeraFisica + i);

      for (const lector of lectores) {
        if (!pendientes.length) break;
        // Tramos contiguos de páginas pendientes: una llamada por tramo.
        const tramos: Array<[number, number]> = [];
        for (const f of pendientes) {
          const ultimo = tramos[tramos.length - 1];
          if (ultimo && ultimo[1] === f - 1) ultimo[1] = f; else tramos.push([f, f]);
        }
        const siguientes: number[] = [];
        await Promise.all(tramos.map(async ([desde, hasta]) => {
          const fisicas = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
          for (const f of fisicas) recorrido.set(f, [...(recorrido.get(f) ?? []), lector.nombre]);
          let paginas: PaginaLeida[];
          try {
            const sub = desde === entrada.primeraFisica && hasta === entrada.primeraFisica + n - 1 ? entrada : await subEntrada(entrada, desde, hasta);
            paginas = await lector.leerPliego(sub);
          } catch (e) {
            avisar({ lector: lector.nombre, paginas: fisicas, motivo: `error: ${(e as Error)?.message?.slice(0, 200) ?? e}` });
            siguientes.push(...fisicas);
            return;
          }
          const porFisica = new Map(paginas.map((p) => [p.fisica, p]));
          const malas: number[] = [];
          const motivos = new Set<string>();
          for (const f of fisicas) {
            const p = porFisica.get(f) ?? paginaFaltante(f);
            const v = evaluar(p);
            const conLector: PaginaConLector = { ...p, lector: lector.nombre };
            if (v.aceptable) finales.set(f, conLector);
            else {
              malas.push(f);
              if (v.motivo) motivos.add(v.motivo);
              const previa = mejores.get(f);
              if (!previa || puntuacion(conLector) > puntuacion(previa)) mejores.set(f, conLector);
            }
          }
          if (malas.length) { avisar({ lector: lector.nombre, paginas: malas, motivo: [...motivos].join('; ') }); siguientes.push(...malas); }
        }));
        pendientes = siguientes.sort((a, b) => a - b);
      }

      const salida: PaginaConLector[] = [];
      for (let i = 0; i < n; i++) {
        const f = entrada.primeraFisica + i;
        const p = finales.get(f) ?? mejores.get(f) ?? { ...paginaFaltante(f), lector: 'ninguno' };
        const intentos = recorrido.get(f) ?? [];
        salida.push(intentos.length > 1 ? { ...p, intentos } : p);
      }
      return salida;
    },
  };
}

function puntuacion(p: PaginaLeida): number {
  return p.texto.length * Math.max(0.05, p.confianza);
}
