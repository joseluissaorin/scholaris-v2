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
 *
 * Memoria acotada: los párrafos se recorren por tandas de unidades y solo se guarda
 * su posición y su longitud; el texto se carga ventana a ventana. La programación
 * dinámica guarda solo la banda diagonal.
 */
import type { Alineacion, LadoAlineacion, Relacion, TipoCorrespondencia } from '@scholaris/nucleo';
import { leerUnidades } from '@scholaris/spdf';
import { llamar } from '../comprension/modelo.js';
import type { ContextoComprension, ModeloComprension, UsoModelo } from '../comprension/tipos.js';
import { segmentoEn, TIPOS_CORRESPONDENCIA } from './alineacion.js';
import type { MaterialObra } from './material.js';
import { rotulo } from './obras.js';

export interface Parrafo {
  /** «A17», «B15». */
  id: string;
  unidad: string;
  ordenUnidad: number;
  caracteres: [number, number];
  largo: number;
}

/** Los párrafos de un texto, con su tramo exacto (puntos de código). */
export function parrafosDeTexto(texto: string): Array<{ caracteres: [number, number]; texto: string }> {
  const salida: Array<{ caracteres: [number, number]; texto: string }> = [];
  const cp = (i: number) => Array.from(texto.slice(0, i)).length;
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
    salida.push({ caracteres: [cp(x), cp(y)], texto: t });
  }
  return salida;
}

/** Los párrafos de una obra (sin su texto), recorriéndola por tandas de unidades. */
export async function parrafosDe(ctx: Pick<ContextoComprension, 'sql'>, mo: MaterialObra, tanda = 40): Promise<Parrafo[]> {
  const salida: Parrafo[] = [];
  const ordenes = mo.indice.map((u) => u.orden);
  for (let i = 0; i < ordenes.length; i += tanda) {
    const desde = ordenes[i]!, hasta = ordenes[Math.min(ordenes.length - 1, i + tanda - 1)]!;
    for (const u of await leerUnidades(ctx.sql, mo.documento.id, { desde, hasta })) {
      for (const p of parrafosDeTexto((u.texto ?? '').normalize('NFC'))) {
        salida.push({ id: `${mo.letra}${salida.length + 1}`, unidad: u.id, ordenUnidad: u.orden, caracteres: p.caracteres, largo: p.texto.length });
      }
    }
  }
  return salida;
}

/** El texto de unos párrafos (carga solo las unidades que tocan). */
export async function textosDe(ctx: Pick<ContextoComprension, 'sql'>, mo: MaterialObra, ps: readonly Parrafo[]): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  if (!ps.length) return salida;
  const desde = Math.min(...ps.map((p) => p.ordenUnidad)), hasta = Math.max(...ps.map((p) => p.ordenUnidad));
  const textos = new Map((await leerUnidades(ctx.sql, mo.documento.id, { desde, hasta })).map((u) => [u.id, Array.from((u.texto ?? '').normalize('NFC'))]));
  for (const p of ps) salida.set(p.id, (textos.get(p.unidad) ?? []).slice(...p.caracteres).join(''));
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
 * Solo se guarda la banda alrededor de la diagonal (memoria lineal en la obra).
 */
export function galeChurch(la: readonly number[], lb: readonly number[]): Cuenta[] {
  const n = la.length, m = lb.length;
  const c = Math.max(0.2, lb.reduce((t, x) => t + x, 0) / Math.max(1, la.reduce((t, x) => t + x, 0)));
  const banda = Math.min(400, Math.max(30, Math.ceil(Math.max(n, m) * 0.15)));
  const ancho = 2 * banda + 3;
  const centro = (i: number) => Math.round((i * m) / Math.max(1, n));
  const k0 = (i: number) => centro(i) - banda - 1;
  const coste = new Float64Array((n + 1) * ancho).fill(Number.POSITIVE_INFINITY);
  const desde = new Int8Array((n + 1) * ancho).fill(-1);
  const idx = (i: number, j: number) => { const k = j - k0(i); return k >= 0 && k < ancho ? i * ancho + k : -1; };
  coste[idx(0, 0)] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = Math.max(0, centro(i) - banda); j <= Math.min(m, centro(i) + banda); j++) {
      const a0 = idx(i, j);
      if (a0 < 0) continue;
      const base = coste[a0]!;
      if (!Number.isFinite(base)) continue;
      PASOS.forEach(([di, dj, pena], k) => {
        if (i + di > n || j + dj > m) return;
        const destino = idx(i + di, j + dj);
        if (destino < 0) return;
        let sa = 0, sb = 0;
        for (let x = 0; x < di; x++) sa += la[i + x]!;
        for (let y = 0; y < dj; y++) sb += lb[j + y]!;
        const d = Math.abs(Math.log((sb + 20) / ((sa + 20) * c))) * 4 + pena;
        if (base + d < coste[destino]!) { coste[destino] = base + d; desde[destino] = k; }
      });
    }
  }
  const salida: Cuenta[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const p = idx(i, j);
    const k = p >= 0 ? desde[p]! : -1;
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

export interface GrupoParrafos { a: Parrafo[]; b: Parrafo[]; tipo: TipoCorrespondencia; nota: string; confianza: number }

/** Las ventanas de la revisión: la propuesta por longitudes, en tandas de unas `tam` cuentas (deterministas). */
export function ventanasDeTraduccion(pa: readonly Parrafo[], pb: readonly Parrafo[], tam = 30): GrupoParrafos[][] {
  const cuentas = galeChurch(pa.map((p) => p.largo), pb.map((p) => p.largo));
  const grupos: GrupoParrafos[] = cuentas.map((c) => ({
    a: c.a.map((i) => pa[i]!), b: c.b.map((j) => pb[j]!), tipo: !c.b.length ? 'anadido' : !c.a.length ? 'suprimido' : 'traducido', nota: '', confianza: 0.6,
  }));
  const ventanas: GrupoParrafos[][] = [];
  for (let i = 0; i < grupos.length; i += tam) ventanas.push(grupos.slice(i, i + tam));
  return ventanas;
}

/**
 * Revisa una ventana con el modelo (carga el texto de sus párrafos y lo suelta al
 * acabar). Lo que el modelo se deja se queda como lo propuso la programación dinámica.
 */
export async function revisarVentana(
  ctx: Pick<ContextoComprension, 'sql'>, rel: Relacion, a: MaterialObra, b: MaterialObra, v: readonly GrupoParrafos[], modelo: ModeloComprension, acumulado: { uso: UsoModelo },
  o: { calidad: 'alta' | 'rapida'; limiteMs?: number },
): Promise<GrupoParrafos[]> {
  const ida = v.flatMap((g) => g.a), idb = v.flatMap((g) => g.b);
  const ta = await textosDe(ctx, a, ida), tb = await textosDe(ctx, b, idb);
  const texto = [
    'Párrafos de A (traducción):', ...ida.map((p) => `${p.id}: ${ta.get(p.id) ?? ''}`), '',
    'Párrafos de B (original):', ...idb.map((p) => `${p.id}: ${tb.get(p.id) ?? ''}`), '',
    'Propuesta por longitudes:', ...v.map((g) => `${g.a.map((p) => p.id).join('+') || '∅'} ↔ ${g.b.map((p) => p.id).join('+') || '∅'}`), '',
    'Corrige la propuesta y responde solo con el JSON.',
  ].join('\n');
  const r = await llamar<{ grupos: Array<{ a?: string[]; b?: string[]; tipo: TipoCorrespondencia; nota?: string }> }>(modelo, {
    sistema: sistemaParrafos(rel, a, b), partes: [{ texto }], esquema: ESQUEMA_PARRAFOS, calidad: o.calidad, maxTokens: 16_000, operacion: 'transmedia:parrafos',
    ...(o.limiteMs ? { limiteMs: o.limiteMs } : {}),
  }, acumulado);
  const porId = new Map([...ida, ...idb].map((p) => [p.id, p]));
  const usados = new Set<string>();
  const salida: GrupoParrafos[] = [];
  for (const g of r.grupos ?? []) {
    const xa = (g.a ?? []).filter((x) => porId.has(x) && x.startsWith(a.letra) && !usados.has(x)).map((x) => porId.get(x)!);
    const xb = (g.b ?? []).filter((x) => porId.has(x) && x.startsWith(b.letra) && !usados.has(x)).map((x) => porId.get(x)!);
    if (!xa.length && !xb.length) continue;
    for (const p of [...xa, ...xb]) usados.add(p.id);
    let tipo: TipoCorrespondencia = TIPOS_CORRESPONDENCIA.includes(g.tipo) ? g.tipo : 'traducido';
    if (!xb.length) tipo = 'anadido'; else if (!xa.length) tipo = 'suprimido'; else if (tipo === 'anadido' || tipo === 'suprimido' || tipo === 'equivalente') tipo = 'traducido';
    salida.push({ a: xa, b: xb, tipo, nota: (g.nota ?? '').trim(), confianza: 0.85 });
  }
  for (const g of v) {
    const xa = g.a.filter((p) => !usados.has(p.id)), xb = g.b.filter((p) => !usados.has(p.id));
    if (xa.length || xb.length) salida.push({ a: xa, b: xb, tipo: !xb.length ? 'anadido' : !xa.length ? 'suprimido' : 'traducido', nota: '', confianza: 0.5 });
  }
  return salida;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function lado(mo: MaterialObra, ps: readonly Parrafo[]): LadoAlineacion | undefined {
  if (!ps.length) return undefined;
  const a = ps[0]!, z = ps.at(-1)!;
  const ua = mo.porId.get(a.unidad)!, uz = mo.porId.get(z.unidad)!;
  const l: LadoAlineacion = { documento: mo.documento.id, ancla: { ...ua.ancla, caracteres: a.caracteres } };
  if (ps.length > 1) l.anclaFin = { ...uz.ancla, caracteres: z.caracteres };
  const seg = segmentoEn(mo, l.ancla, ua.id);
  if (seg) l.segmento = seg;
  return l;
}

const NOTA_POR_DEFECTO: Record<TipoCorrespondencia, string> = {
  traducido: 'Traducción sin desplazamientos notables.', equivalente: 'Traducción sin desplazamientos notables.', condensado: 'La traducción condensa el original.',
  ampliado: 'La traducción amplía el original.', transformado: 'La traducción cambia el sentido del original.', reordenado: 'La traducción cambia el orden del original.',
  anadido: 'Párrafo sin correspondencia en el original.', suprimido: 'Párrafo del original que la traducción omite.', alusion: 'La traducción alude al original.',
};

/** Las alineaciones de una ventana (ids `«relación»:p«ventana»-«n»`: deterministas, para reanudar). */
export function alineacionesDeVentana(rel: Relacion, a: MaterialObra, b: MaterialObra, ventana: number, grupos: readonly GrupoParrafos[]): Alineacion[] {
  const posicion = (p: Parrafo | undefined) => (p ? p.ordenUnidad * 1e7 + p.caracteres[0] : Number.MAX_SAFE_INTEGER);
  return [...grupos]
    .sort((x, y) => (posicion(x.a[0]) === posicion(y.a[0]) ? posicion(x.b[0]) - posicion(y.b[0]) : posicion(x.a[0]) - posicion(y.a[0])))
    .map((g, i) => {
      const xa = lado(a, g.a), xb = lado(b, g.b);
      return {
        id: `${rel.id}:p${String(ventana).padStart(4, '0')}-${String(i).padStart(3, '0')}`, relacion: rel.id, orden: ventana * 1000 + i, tipo: g.tipo,
        ...(xa ? { a: xa } : {}), ...(xb ? { b: xb } : {}), nota: g.nota || NOTA_POR_DEFECTO[g.tipo], confianza: r2(g.confianza),
      };
    });
}

/**
 * La alineación entera de una traducción en un solo proceso, sin guardar nada (pruebas
 * y guiones). La plataforma usa las ventanas una a una (`flujo.ts`), guardando cada una.
 */
export async function alinearTraduccion(
  ctx: Pick<ContextoComprension, 'sql'>, rel: Relacion, a: MaterialObra, b: MaterialObra, modelo: ModeloComprension | null, acumulado: { uso: UsoModelo }, o: { calidad: 'alta' | 'rapida' },
): Promise<{ alineaciones: Alineacion[]; parrafos: { a: number; b: number } }> {
  const pa = await parrafosDe(ctx, a), pb = await parrafosDe(ctx, b);
  const ventanas = ventanasDeTraduccion(pa, pb);
  const alineaciones: Alineacion[] = [];
  for (const [k, v] of ventanas.entries()) {
    const grupos = modelo ? await revisarVentana(ctx, rel, a, b, v, modelo, acumulado, o).catch(() => [...v]) : v;
    alineaciones.push(...alineacionesDeVentana(rel, a, b, k, grupos));
  }
  return { alineaciones, parrafos: { a: pa.length, b: pb.length } };
}
