/**
 * Alineación de una traducción con su original, párrafo a párrafo y por el
 * sentido (docs/COMPRENSION.md, «Transidioma»). Las anclas salen exactas de los
 * párrafos (caracteres de la unidad en los dos lados), sin depender de citas.
 *
 * 1. Gale y Church: programación dinámica por longitudes (1-1, 1-0, 0-1, 2-1, 1-2,
 *    2-2), que casi nunca se equivoca en traducciones fieles y no cuesta nada.
 * 2. El modelo revisa la propuesta por ventanas, con los párrafos de los dos lados
 *    delante: corrige los cortes, marca lo omitido y lo añadido y anota los
 *    desplazamientos de traducción que importan.
 */
import { enParalelo, type Alineacion, type LadoAlineacion, type Relacion, type TipoCorrespondencia } from '@scholaris/nucleo';
import { llamar } from '../comprension/modelo.js';
import type { ModeloComprension, UsoModelo } from '../comprension/tipos.js';
import { localizadorSegmentos } from '../comprension/util.js';
import { TIPOS_CORRESPONDENCIA } from './alineacion.js';
import type { MaterialObra } from './material.js';
import { rotulo } from './obras.js';

export interface Parrafo {
  /** «A17», «B15». */
  id: string;
  unidad: string;
  ordenUnidad: number;
  caracteres: [number, number];
  texto: string;
}

/** Los párrafos de una obra, con su tramo exacto (puntos de código) en su unidad. */
export function parrafosDe(mo: MaterialObra): Parrafo[] {
  const salida: Parrafo[] = [];
  const cp = (s: string, i: number) => Array.from(s.slice(0, i)).length;
  for (const u of mo.m.unidades) {
    const texto = u.texto;
    // Párrafos separados por una línea en blanco; si la unidad no tiene ninguna, por saltos de línea.
    const separador = /\n[ \t]*\n/.test(texto) || texto.length < 600 ? /\n[ \t]*\n\s*/g : /\n\s*/g;
    const tramos: Array<[number, number]> = [];
    let ini = 0;
    for (const m of texto.matchAll(separador)) { tramos.push([ini, m.index!]); ini = m.index! + m[0].length; }
    tramos.push([ini, texto.length]);
    for (let [x, y] of tramos) {
      while (x < y && /\s/.test(texto[x]!)) x++;
      while (y > x && /\s/.test(texto[y - 1]!)) y--;
      const t = texto.slice(x, y);
      if (t.replace(/[\s\p{P}\d]/gu, '').length < 2) continue;
      salida.push({ id: `${mo.letra}${salida.length + 1}`, unidad: u.id, ordenUnidad: u.orden, caracteres: [cp(texto, x), cp(texto, y)], texto: t });
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Gale y Church
// ---------------------------------------------------------------------------

export interface Cuenta { a: number[]; b: number[] }

const PASOS: Array<[number, number, number]> = [[1, 1, 0], [1, 0, 3], [0, 1, 3], [2, 1, 1.2], [1, 2, 1.2], [2, 2, 2]];

/**
 * Empareja dos listas de longitudes. Coste de cada cuenta: lo que se aparta la
 * razón de longitudes de la razón media, más una penalización por tipo de cuenta.
 */
export function galeChurch(la: readonly number[], lb: readonly number[]): Cuenta[] {
  const n = la.length, m = lb.length;
  const c = Math.max(0.2, lb.reduce((t, x) => t + x, 0) / Math.max(1, la.reduce((t, x) => t + x, 0)));
  const ancho = m + 1;
  const coste = new Float64Array((n + 1) * (m + 1)).fill(Number.POSITIVE_INFINITY);
  const desde = new Int8Array((n + 1) * (m + 1)).fill(-1);
  coste[0] = 0;
  // Banda alrededor de la diagonal para las obras largas.
  const banda = Math.max(30, Math.ceil(Math.max(n, m) * 0.15));
  for (let i = 0; i <= n; i++) {
    const centro = Math.round((i * m) / Math.max(1, n));
    for (let j = Math.max(0, centro - banda); j <= Math.min(m, centro + banda); j++) {
      const base = coste[i * ancho + j]!;
      if (!Number.isFinite(base)) continue;
      PASOS.forEach(([di, dj, pena], k) => {
        if (i + di > n || j + dj > m) return;
        let sa = 0, sb = 0;
        for (let x = 0; x < di; x++) sa += la[i + x]!;
        for (let y = 0; y < dj; y++) sb += lb[j + y]!;
        const d = Math.abs(Math.log((sb + 20) / ((sa + 20) * c))) * 4 + pena;
        const idx = (i + di) * ancho + (j + dj);
        if (base + d < coste[idx]!) { coste[idx] = base + d; desde[idx] = k; }
      });
    }
  }
  const salida: Cuenta[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const k = desde[i * ancho + j]!;
    if (k < 0) {
      // Fuera de la banda (no debería pasar): lo que quede, emparejado de uno en uno.
      salida.push({ a: i > 0 ? [i - 1] : [], b: j > 0 ? [j - 1] : [] });
      i = Math.max(0, i - 1); j = Math.max(0, j - 1);
      continue;
    }
    const [di, dj] = PASOS[k]!;
    salida.push({ a: Array.from({ length: di }, (_, x) => i - di + x), b: Array.from({ length: dj }, (_, y) => j - dj + y) });
    i -= di; j -= dj;
  }
  return salida.reverse();
}

// ---------------------------------------------------------------------------
// Revisión por el modelo
// ---------------------------------------------------------------------------

const ESQUEMA_PARRAFOS = {
  type: 'object',
  properties: {
    grupos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          a: { type: 'array', items: { type: 'string' }, description: 'Ids de los párrafos de A («A17»); vacío si A lo omite.' },
          b: { type: 'array', items: { type: 'string' }, description: 'Ids de los párrafos de B; vacío si A lo añade.' },
          tipo: { type: 'string', enum: [...TIPOS_CORRESPONDENCIA] },
          nota: { type: 'string', description: 'Solo si hay algo que decir: el desplazamiento de traducción y su efecto. Vacío si es una traducción sin más.' },
        },
        required: ['a', 'b', 'tipo', 'nota'],
      },
    },
  },
  required: ['grupos'],
};

function sistemaParrafos(rel: Relacion, a: MaterialObra, b: MaterialObra): string {
  return `Eres traductólogo. Alineas, párrafo a párrafo y por el sentido, una traducción con su original: ${rotulo(a.o)} (A, la traducción, en ${a.o.idioma || '¿?'}) y ${rotulo(b.o)} (B, el original, en ${b.o.idioma || '¿?'}).

Recibes una ventana de párrafos de los dos lados con una propuesta de emparejamiento por longitudes. Corrígela: cada párrafo de A y de B va en un grupo, en orden; un grupo puede juntar varios párrafos de un lado (la traducción une o parte párrafos); un párrafo de B sin correspondencia es «suprimido» (A lo omite) y uno de A sin correspondencia es «anadido».
Tipos: traducido (dice lo mismo; unir o partir párrafos sin perder contenido sigue siendo «traducido»), condensado (la traducción resume u omite parte del contenido), ampliado (añade contenido), transformado (cambia el sentido), reordenado, anadido, suprimido.
Nota: solo cuando hay un desplazamiento que importa (omisión, adición, modulación, explicitación, adaptación cultural, domesticación o extranjerización, cambio de registro, error de sentido), en español impecable (tildes, eñes) y en una o dos frases, con el vocabulario de los estudios de traducción. Si es una traducción sin más, nota vacía. Sin emojis ni markdown; la raya, a la española.${rel.nota ? `\n\nRelación: ${rel.nota}` : ''}`;
}

export interface OpcionesTraduccion {
  calidad: 'alta' | 'rapida';
  concurrencia: number;
  presupuestoUsd: number;
  /** Párrafos de A por ventana (por defecto 30). */
  ventana?: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function lado(mo: MaterialObra, ps: readonly Parrafo[], loc: ReturnType<typeof localizadorSegmentos> | null): LadoAlineacion | undefined {
  if (!ps.length) return undefined;
  const a = ps[0]!, z = ps.at(-1)!;
  const ua = mo.m.porId.get(a.unidad)!, uz = mo.m.porId.get(z.unidad)!;
  const l: LadoAlineacion = { documento: mo.m.documento.id, ancla: { ...ua.ancla, caracteres: a.caracteres } };
  if (ps.length > 1) l.anclaFin = { ...uz.ancla, caracteres: z.caracteres };
  const seg = loc?.enTexto(ua.orden, a.caracteres[0]);
  if (seg) l.segmento = seg;
  return l;
}

/**
 * La alineación párrafo a párrafo de una traducción (A) con su original (B).
 * Sin modelo, queda la de Gale y Church con el tipo «traducido».
 */
export async function alinearTraduccion(
  rel: Relacion, a: MaterialObra, b: MaterialObra, modelo: ModeloComprension | null, acumulado: { uso: UsoModelo }, o: OpcionesTraduccion,
): Promise<{ alineaciones: Alineacion[]; avisos: string[]; parrafos: { a: number; b: number }; revisadas: number }> {
  const pa = parrafosDe(a), pb = parrafosDe(b);
  const avisos: string[] = [];
  const cuentas = galeChurch(pa.map((p) => p.texto.length), pb.map((p) => p.texto.length));
  let grupos: Array<{ a: Parrafo[]; b: Parrafo[]; tipo: TipoCorrespondencia; nota: string; confianza: number }> = cuentas.map((c) => ({
    a: c.a.map((i) => pa[i]!), b: c.b.map((j) => pb[j]!), tipo: !c.b.length ? 'anadido' : !c.a.length ? 'suprimido' : 'traducido', nota: '', confianza: 0.6,
  }));
  let revisadas = 0;
  if (modelo && pa.length && pb.length) {
    // Ventanas de unas 30 cuentas: cada una con sus párrafos de A y de B.
    const tam = o.ventana ?? 30;
    const ventanas: Array<typeof grupos> = [];
    for (let i = 0; i < grupos.length; i += tam) ventanas.push(grupos.slice(i, i + tam));
    const porId = new Map([...pa, ...pb].map((p) => [p.id, p]));
    const revisar = async (v: typeof grupos, calidad: 'alta' | 'rapida'): Promise<typeof grupos | null> => {
      if (acumulado.uso.usd > o.presupuestoUsd) return null;
      const ida = v.flatMap((g) => g.a), idb = v.flatMap((g) => g.b);
      const texto = [
        'Párrafos de A (traducción):', ...ida.map((p) => `${p.id}: ${p.texto}`), '',
        'Párrafos de B (original):', ...idb.map((p) => `${p.id}: ${p.texto}`), '',
        'Propuesta por longitudes:', ...v.map((g) => `${g.a.map((p) => p.id).join('+') || '∅'} ↔ ${g.b.map((p) => p.id).join('+') || '∅'}`), '',
        'Corrige la propuesta y responde solo con el JSON.',
      ].join('\n');
      try {
        const r = await llamar<{ grupos: Array<{ a?: string[]; b?: string[]; tipo: TipoCorrespondencia; nota?: string }> }>(modelo, {
          sistema: sistemaParrafos(rel, a, b), partes: [{ texto }], esquema: ESQUEMA_PARRAFOS, calidad, maxTokens: 16_000, operacion: 'transmedia:parrafos',
        }, acumulado);
        const permitidos = new Set([...ida, ...idb].map((p) => p.id));
        const usados = new Set<string>();
        const salida: typeof grupos = [];
        for (const g of r.grupos ?? []) {
          const xa = (g.a ?? []).filter((x) => permitidos.has(x) && x.startsWith(a.letra) && !usados.has(x)).map((x) => porId.get(x)!);
          const xb = (g.b ?? []).filter((x) => permitidos.has(x) && x.startsWith(b.letra) && !usados.has(x)).map((x) => porId.get(x)!);
          if (!xa.length && !xb.length) continue;
          for (const p of [...xa, ...xb]) usados.add(p.id);
          let tipo: TipoCorrespondencia = TIPOS_CORRESPONDENCIA.includes(g.tipo) ? g.tipo : 'traducido';
          if (!xb.length) tipo = 'anadido'; else if (!xa.length) tipo = 'suprimido'; else if (tipo === 'anadido' || tipo === 'suprimido' || tipo === 'equivalente') tipo = 'traducido';
          salida.push({ a: xa, b: xb, tipo, nota: (g.nota ?? '').trim(), confianza: 0.85 });
        }
        // Lo que el modelo se dejó, se queda como lo propuso la programación dinámica.
        const falta = v.filter((g) => [...g.a, ...g.b].some((p) => !usados.has(p.id)));
        for (const g of falta) {
          const xa = g.a.filter((p) => !usados.has(p.id)), xb = g.b.filter((p) => !usados.has(p.id));
          if (xa.length || xb.length) salida.push({ a: xa, b: xb, tipo: !xb.length ? 'anadido' : !xa.length ? 'suprimido' : 'traducido', nota: '', confianza: 0.5 });
        }
        return salida;
      } catch (e) {
        // Un bloqueo del modelo rápido (falso positivo de seguridad) se reintenta una vez con el alto.
        if (o.calidad === 'rapida' && /bloquead|PROHIBITED|SAFETY/i.test((e as Error).message) && !(v as { reintentada?: boolean }).reintentada) {
          (v as { reintentada?: boolean }).reintentada = true;
          return revisar(v, 'alta');
        }
        if (!avisos.some((x) => x.startsWith('Una ventana'))) avisos.push(`Una ventana de párrafos no se pudo revisar (${(e as Error).message.slice(0, 100)}): queda la alineación por longitudes.`);
        return null;
      }
    };
    const revisadasPorVentana = await enParalelo(ventanas, Math.max(1, o.concurrencia), (v) => revisar(v, o.calidad));
    grupos = revisadasPorVentana.flatMap((r, i) => { if (r) revisadas++; return r ?? ventanas[i]!; });
    if (acumulado.uso.usd > o.presupuestoUsd) avisos.push(`Presupuesto agotado (${acumulado.uso.usd.toFixed(2)} USD): parte de la traducción queda alineada solo por longitudes.`);
  }
  const posicion = (p: Parrafo | undefined) => (p ? p.ordenUnidad * 1e7 + p.caracteres[0] : Number.MAX_SAFE_INTEGER);
  grupos.sort((x, y) => (posicion(x.a[0]) === posicion(y.a[0]) ? posicion(x.b[0]) - posicion(y.b[0]) : posicion(x.a[0]) - posicion(y.a[0])));
  const la = a.provisionales ? null : localizadorSegmentos(a.m, a.segmentos);
  const lb = b.provisionales ? null : localizadorSegmentos(b.m, b.segmentos);
  const notaPorDefecto: Record<TipoCorrespondencia, string> = {
    traducido: 'Traducción sin desplazamientos notables.', equivalente: 'Traducción sin desplazamientos notables.', condensado: 'La traducción condensa el original.',
    ampliado: 'La traducción amplía el original.', transformado: 'La traducción cambia el sentido del original.', reordenado: 'La traducción cambia el orden del original.',
    anadido: 'Párrafo sin correspondencia en el original.', suprimido: 'Párrafo del original que la traducción omite.', alusion: 'La traducción alude al original.',
  };
  const alineaciones: Alineacion[] = grupos.map((g, i) => {
    const xa = lado(a, g.a, la), xb = lado(b, g.b, lb);
    return {
      id: `${rel.id}:p${String(i).padStart(5, '0')}`, relacion: rel.id, orden: i, tipo: g.tipo,
      ...(xa ? { a: xa } : {}), ...(xb ? { b: xb } : {}), nota: g.nota || notaPorDefecto[g.tipo], confianza: r2(g.confianza),
    };
  });
  return { alineaciones, avisos, parrafos: { a: pa.length, b: pb.length }, revisadas };
}
