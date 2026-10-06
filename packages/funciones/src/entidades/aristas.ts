/**
 * Aristas entre entidades: coapariciones ponderadas por la cercanía, por
 * documento (el peso global es la suma), y relaciones con nombre para las
 * aristas fuertes, en una sola llamada al redactor por documento.
 *
 * Peso de una coaparición:
 *   - en el mismo fragmento: 0,4 + 0,6 · e^(−d/400), con d los caracteres que
 *     separan las dos menciones más cercanas (pegadas ≈ 1, lejos ≈ 0,4);
 *   - en fragmentos contiguos: 0,15.
 * Las fechas no entran en el grafo (sirven a la línea temporal).
 */

import type { Redactor, SQL } from '@scholaris/nucleo';
import { ahora, marcas, normalizarClave, num } from '../util.js';
import { contextoMencion } from './normalizar.js';
import { tokensAprox, type UsoLote } from './extraer.js';

const MAX_POR_FRAGMENTO = 40;
const PESO_CONTIGUO = 0.15;

interface Pos { entidad: string; ini: number; fin: number }

export function pesoCercania(distancia: number): number {
  return 0.4 + 0.6 * Math.exp(-Math.max(0, distancia) / 400);
}

/** Coapariciones de un documento a partir de sus menciones (puro). */
export function calcularAristas(menciones: ReadonlyArray<{ entidad: string; orden: number; fragmento: string; ini: number; fin: number }>) {
  const porOrden = new Map<number, { fragmento: string; pos: Pos[] }>();
  for (const m of menciones) {
    const g = porOrden.get(m.orden) ?? { fragmento: m.fragmento, pos: [] };
    g.pos.push({ entidad: m.entidad, ini: m.ini, fin: m.fin });
    porOrden.set(m.orden, g);
  }
  const aristas = new Map<string, { a: string; b: string; peso: number; coapariciones: number; fragmento: string | null; mejor: number }>();
  const sumar = (x: string, y: string, w: number, fragmento: string | null, mismo: boolean) => {
    if (x === y) return;
    const [a, b] = x < y ? [x, y] : [y, x];
    const k = `${a}\u0000${b}`;
    const e = aristas.get(k) ?? { a, b, peso: 0, coapariciones: 0, fragmento: null, mejor: 0 };
    e.peso += w;
    if (mismo) {
      e.coapariciones++;
      if (w > e.mejor) { e.mejor = w; e.fragmento = fragmento; }
    } else if (!e.fragmento) e.fragmento = fragmento;
    aristas.set(k, e);
  };
  const entidadesDe = (pos: Pos[]) => {
    const cuenta = new Map<string, number>();
    for (const p of pos) cuenta.set(p.entidad, (cuenta.get(p.entidad) ?? 0) + 1);
    return [...cuenta.entries()].sort((x, y) => y[1] - x[1]).slice(0, MAX_POR_FRAGMENTO).map(([e]) => e);
  };
  const ordenes = [...porOrden.keys()].sort((a, b) => a - b);
  for (const o of ordenes) {
    const g = porOrden.get(o)!;
    const ents = entidadesDe(g.pos);
    const posDe = new Map<string, Pos[]>();
    for (const p of g.pos) posDe.set(p.entidad, [...(posDe.get(p.entidad) ?? []), p]);
    for (let i = 0; i < ents.length; i++) {
      for (let j = i + 1; j < ents.length; j++) {
        let d = Infinity;
        for (const p of posDe.get(ents[i]!)!) for (const q of posDe.get(ents[j]!)!) {
          d = Math.min(d, p.fin <= q.ini ? q.ini - p.fin : q.fin <= p.ini ? p.ini - q.fin : 0);
        }
        sumar(ents[i]!, ents[j]!, pesoCercania(d), g.fragmento, true);
      }
    }
    const sig = porOrden.get(o + 1);
    if (sig) {
      const aqui = new Set(ents), alla = entidadesDe(sig.pos);
      for (const x of aqui) for (const y of alla) if (!aqui.has(y) || !alla.includes(x)) sumar(x, y, PESO_CONTIGUO, g.fragmento, false);
    }
  }
  return [...aristas.values()].map(({ mejor: _m, ...e }) => ({ ...e, peso: Math.round(e.peso * 1000) / 1000 }));
}

/** Rehace las aristas de un documento desde sus menciones. */
export async function reconstruirAristasDocumento(sql: SQL, documento: string): Promise<number> {
  const menciones = await sql.ejecutar<{ entidad: string; orden: number; fragmento: string; ini: number; fin: number }>(
    "SELECT entidad, orden, fragmento, ini, fin FROM menciones WHERE documento = ? AND tipo <> 'fecha' ORDER BY orden, ini", documento,
  );
  const aristas = calcularAristas(menciones.map((m) => ({ ...m, orden: num(m.orden), ini: num(m.ini), fin: num(m.fin) })));
  await sql.ejecutar('DELETE FROM aristas_entidades WHERE documento = ?', documento);
  for (let i = 0; i < aristas.length; i += 16) {
    const lote = aristas.slice(i, i + 16);
    await sql.ejecutar(
      `INSERT INTO aristas_entidades (a, b, documento, peso, coapariciones, fragmento) VALUES ${lote.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
      ...lote.flatMap((e) => [e.a, e.b, documento, e.peso, e.coapariciones, e.fragmento]),
    );
  }
  return aristas.length;
}

export const ESQUEMA_RELACIONES = {
  type: 'object',
  properties: {
    r: {
      type: 'array',
      items: {
        type: 'object',
        properties: { i: { type: 'integer' }, e: { type: 'string' } },
        required: ['i'],
      },
    },
  },
  required: ['r'],
} as const;

export const SISTEMA_RELACIONES = `Para cada par numerado de entidades (A y B) recibes un pasaje donde aparecen juntas. En «e» escribe UNA frase breve en español (como mucho 12 palabras) que diga la relación entre las dos tal como la afirma el pasaje, empezando por el nombre de una y terminando con el de la otra, en el sentido correcto: «Julio Cortázar admira a Charlie Parker», «Rayuela es una novela de Julio Cortázar», «Johnny Carter está inspirado en Charlie Parker». Usa los nombres tal como se te dan. Si el pasaje solo las menciona juntas sin afirmar una relación concreta, deja «e» vacío. No inventes nada que no diga el pasaje. Responde solo con el JSON.`;

/** ¿La frase nombra a las dos entidades? (Si no, el redactor se ha ido por las ramas.) */
export function fraseValida(frase: string, a: string, b: string): boolean {
  const n = normalizarClave(frase);
  const nombra = (x: string) => {
    const ps = normalizarClave(x).split(' ').filter((p) => p.length > 2);
    return ps.length ? ps.some((p) => n.includes(p)) : n.includes(normalizarClave(x));
  };
  return nombra(a) && nombra(b);
}

/**
 * Pone nombre a las aristas más fuertes de un documento que aún no lo tienen
 * (una sola llamada). Devuelve cuántas se etiquetaron.
 */
export async function etiquetarRelaciones(sql: SQL, redactor: Redactor, documento: string, maximo = 14): Promise<{ etiquetadas: number; uso: UsoLote }> {
  const uso: UsoLote = { tokensEntrada: 0, tokensSalida: 0, llamadas: 0 };
  const fuertes = await sql.ejecutar<{ a: string; b: string; fragmento: string; peso: number }>(
    `SELECT x.a, x.b, x.fragmento, x.peso FROM aristas_entidades x
      LEFT JOIN entidades_relaciones r ON r.a = x.a AND r.b = x.b
      WHERE x.documento = ? AND x.fragmento IS NOT NULL AND x.coapariciones > 0 AND r.a IS NULL AND x.peso >= 0.9
      ORDER BY x.peso DESC LIMIT ?`,
    documento, maximo,
  );
  if (!fuertes.length) return { etiquetadas: 0, uso };
  const ids = [...new Set(fuertes.flatMap((f) => [f.a, f.b]))];
  const nombres = new Map((await sql.ejecutar<{ id: string; nombre: string }>(`SELECT id, nombre FROM entidades WHERE id IN (${marcas(ids.length)})`, ...ids)).map((f) => [f.id, f.nombre]));
  const pares: Array<{ a: string; b: string; fragmento: string; pasaje: string }> = [];
  for (const f of fuertes) {
    const [fr] = await sql.ejecutar<{ texto: string }>('SELECT texto FROM fragmentos WHERE id = ?', f.fragmento);
    const ms = await sql.ejecutar<{ entidad: string; ini: number; fin: number }>(
      'SELECT entidad, ini, fin FROM menciones WHERE fragmento = ? AND entidad IN (?, ?) ORDER BY ini', f.fragmento, f.a, f.b,
    );
    if (!fr || !ms.length) continue;
    // La ventana que cubre las dos menciones más cercanas.
    let mejor: [number, number] = [num(ms[0]!.ini), num(ms[0]!.fin)];
    let d = Infinity;
    for (const p of ms) for (const q of ms) {
      if (p.entidad === q.entidad) continue;
      const ini = Math.min(num(p.ini), num(q.ini)), fin = Math.max(num(p.fin), num(q.fin));
      if (fin - ini < d) { d = fin - ini; mejor = [ini, fin]; }
    }
    const pasaje = contextoMencion(fr.texto, mejor[0], mejor[1], 160).replace(/[⟦⟧]/g, '');
    pares.push({ a: f.a, b: f.b, fragmento: f.fragmento, pasaje: pasaje.slice(0, 900) });
  }
  if (!pares.length) return { etiquetadas: 0, uso };
  const texto = pares.map((p, i) => `[${i + 1}] A = ${nombres.get(p.a)} · B = ${nombres.get(p.b)}\n${p.pasaje}`).join('\n\n');
  uso.llamadas++;
  uso.tokensEntrada += tokensAprox(SISTEMA_RELACIONES) + tokensAprox(texto);
  let respuesta: Array<{ i?: unknown; e?: unknown }> = [];
  try {
    const r = await redactor.generar<{ r: Array<{ i?: unknown; e?: unknown }> }>({
      sistema: SISTEMA_RELACIONES, mensajes: [{ rol: 'usuario', partes: [{ texto }] }],
      esquema: ESQUEMA_RELACIONES as unknown as Record<string, unknown>, calidad: 'rapida', temperatura: 0, maxTokens: 2048,
    });
    uso.tokensSalida += tokensAprox(r.texto ?? '');
    respuesta = Array.isArray(r.json?.r) ? r.json!.r : [];
  } catch {
    return { etiquetadas: 0, uso };
  }
  const t = ahora();
  let etiquetadas = 0;
  const vistos = new Set<number>();
  for (const x of respuesta) {
    const i = Math.trunc(num(x.i)) - 1;
    const p = pares[i];
    if (!p || vistos.has(i)) continue;
    vistos.add(i);
    const e = typeof x.e === 'string' ? x.e.replace(/\s+/g, ' ').trim().replace(/[.«»"]+$/g, '').replace(/^[«"]+/, '') : '';
    const etiqueta = e && e.length <= 140 && fraseValida(e, nombres.get(p.a) ?? '', nombres.get(p.b) ?? '') ? e : null;
    if (etiqueta) etiquetadas++;
    await sql.ejecutar(
      'INSERT OR REPLACE INTO entidades_relaciones (a, b, etiqueta, documento, fragmento, creada) VALUES (?, ?, ?, ?, ?, ?)',
      p.a, p.b, etiqueta, documento, p.fragmento, t,
    );
  }
  return { etiquetadas, uso };
}
