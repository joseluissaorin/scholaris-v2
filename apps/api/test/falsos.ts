/**
 * Inteligencia falsa y determinista para las pruebas: sin red ni claves.
 * El embebedor es una bolsa de palabras con hash (1536 dimensiones), así que
 * la vía densa encuentra lo que comparte vocabulario con la consulta.
 */
import type { Embebedor, Inteligencia, PaginaLeida, PiezaEmbebible } from '@scholaris/nucleo';
import { normalizarVector } from '@scholaris/nucleo';

const DIMS = 1536;

function plegar(t: string): string[] {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((x) => x.length > 2);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export const embebedorFalso: Embebedor = {
  espacio: { id: 'falso@1536', proveedor: 'pruebas', modelo: 'falso', dims: DIMS, normalizado: true, modalidades: ['texto', 'imagen'] },
  admite: (m) => m === 'texto' || m === 'imagen',
  async vectorizar(piezas: PiezaEmbebible[]) {
    return piezas.map((p) => {
      const v = new Float32Array(DIMS);
      const texto = p.modalidad === 'texto' ? p.texto : 'imagen';
      for (const w of plegar(texto)) v[hash(w) % DIMS]! += 1;
      v[0]! += 0.01;
      return normalizarVector(v);
    });
  },
};

/** Cuántas veces se ha oído cada «audio» de las pruebas de medios. */
const oidas = new Map<string, number>();

export function inteligenciaFalsa(): Inteligencia {
  return {
    lector: {
      nombre: 'lector-falso',
      async leerPliego(e) {
        const n = e.imagenes?.length ?? 1;
        return Array.from({ length: n }, (_, i): PaginaLeida => ({
          fisica: e.primeraFisica + i, texto: `Página ${e.primeraFisica + i} leída por visión.`, notas: [], cabecera: '', pie: String(e.primeraFisica + i),
          folio: String(e.primeraFisica + i), titulos: [], figuras: [], vacia: false, confianza: 0.9,
        }));
      },
    },
    embebedor: embebedorFalso,
    transcriptor: {
      nombre: 'asr-falso',
      // Un «audio» que es un JSON con sus palabras: las devuelve tal cual. Las `ocultas` solo las oye a la segunda
      // (lo que el transcriptor se saltó en la ingesta y sale al revisar la transcripción).
      async transcribir(a) {
        try {
          const texto = new TextDecoder().decode(a.bytes);
          const j = JSON.parse(texto) as { palabras?: Array<{ texto: string; t0: number; t1: number; hablante?: string }>; ocultas?: Array<{ texto: string; t0: number; t1: number }> };
          if (Array.isArray(j.palabras)) {
            const vez = (oidas.get(texto) ?? 0) + 1;
            oidas.set(texto, vez);
            const palabras = [...j.palabras, ...(vez > 1 ? j.ocultas ?? [] : [])].sort((x, y) => x.t0 - y.t0);
            return { palabras, texto: palabras.map((w) => w.texto).join(' ') };
          }
        } catch { /* no es de las pruebas de medios */ }
        return { palabras: [], texto: '' };
      },
    },
    reordenador: {
      nombre: 'reordenador-falso',
      async reordenar(consulta, textos) {
        const q = new Set(plegar(consulta));
        return textos.map((t) => { const ws = plegar(t); return ws.filter((w) => q.has(w)).length / Math.max(1, q.size); });
      },
    },
    juez: {
      nombre: 'juez-falso',
      async juzgar(_estado, preguntas) {
        const r: Record<string, never> = {};
        for (const [k, p] of Object.entries(preguntas)) {
          (r as Record<string, unknown>)[k] = p.tipo === 'si_no' ? { tipo: 'si_no', probabilidad: 0.8 }
            : p.tipo === 'eleccion' ? { tipo: 'eleccion', eleccion: Object.keys(p.opciones)[0], probabilidades: { [Object.keys(p.opciones)[0]!]: 1 } }
            : { tipo: 'escala', valor: 0, probabilidades: [1] };
        }
        return r;
      },
    },
    redactor: {
      nombre: 'redactor-falso',
      async generar<T>() { return { texto: '{}', json: {} as T }; },
    },
  };
}
