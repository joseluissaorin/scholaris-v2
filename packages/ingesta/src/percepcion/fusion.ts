/**
 * De lo que devuelve cada ventana a una sola percepción: tiempos absolutos y
 * dentro de la ventana, cada cosa en la ventana dueña de su instante, los
 * duplicados de los solapes fundidos, los planos contiguos (y ajustados a los
 * cortes detectados), las escenas tilando la obra entera y un solo nombre por
 * persona.
 */
import type { EscenaPercibida, Localizado, PersonaPercibida, PlanoPercibido, Region, SonidoPercibido } from '@scholaris/nucleo';
import { CLASES_SONIDO } from './esquema.js';
import { fusionarReparto, normalNombre, Unificador } from './reparto.js';
import { aSegundos, type Ventana } from './ventanas.js';

export interface EscenaPlana {
  t0: number;
  t1: number;
  titulo: string;
  lugar?: string;
  tiempo?: string;
  personas: string[];
  accion: string;
  transicion?: string;
  notas?: string;
}

export interface DialogoPlano {
  t: number;
  hablante?: string;
  texto: string;
}

/** Lo que vio una ventana, ya en tiempo absoluto y recortado a la ventana. */
export interface VentanaNormalizada {
  ventana: Ventana;
  escenas: EscenaPlana[];
  planos: PlanoPercibido[];
  sonidos: SonidoPercibido[];
  dialogos: DialogoPlano[];
  reparto: PersonaPercibida[];
  /** Las marcas venían contadas desde el inicio de la ventana y se desplazaron. */
  desplazada: boolean;
}

type Crudo = Record<string, unknown>;
const lista = (x: unknown): Crudo[] => (Array.isArray(x) ? x.filter((e): e is Crudo => !!e && typeof e === 'object') : []);
const texto = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x.trim() : undefined);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** [ymin, xmin, ymax, xmax] en 0-1000 (o en 0-1) → región en fracciones. */
export function regionDeCaja(caja: unknown): Region | undefined {
  if (!Array.isArray(caja) || caja.length !== 4) return undefined;
  let [y0, x0, y1, x1] = caja.map(Number) as [number, number, number, number];
  if (![y0, x0, y1, x1].every(Number.isFinite)) return undefined;
  const escala = Math.max(y0, x0, y1, x1) <= 1.0001 ? 1 : 1000;
  [y0, x0, y1, x1] = [y0, x0, y1, x1].map((v) => Math.min(1, Math.max(0, v / escala))) as [number, number, number, number];
  if (y1 < y0) [y0, y1] = [y1, y0];
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (x1 - x0 < 0.005 || y1 - y0 < 0.005) return undefined;
  return { x: r3(x0), y: r3(y0), w: r3(x1 - x0), h: r3(y1 - y0) };
}

/** Todas las marcas de una ventana cruda (para saber si van desde el inicio de la obra o de la ventana). */
function marcasDe(c: Crudo): number[] {
  const ts: number[] = [];
  for (const k of ['escenas', 'planos', 'sonidos']) for (const e of lista(c[k])) ts.push(aSegundos(e.inicio), aSegundos(e.fin));
  for (const d of lista(c.dialogos)) ts.push(aSegundos(d.t));
  return ts.filter(Number.isFinite);
}

/** Normaliza la salida de una ventana: tiempos absolutos, recortados a la ventana; nombres canónicos. */
export function normalizarVentana(v: Ventana, crudo: unknown, u: Unificador): VentanaNormalizada {
  const c = (crudo && typeof crudo === 'object' ? crudo : {}) as Crudo;
  const largo = v.t1 - v.t0;
  const ts = marcasDe(c);
  // Desde el inicio de la ventana: todo cabe en su largo y algo cae muy antes de su inicio.
  const desplazada = v.t0 > 60 && ts.length > 0 && Math.max(...ts) <= largo + 15 && Math.min(...ts) < v.t0 - 30;
  const abs = (x: unknown) => { const s = aSegundos(x); return Number.isFinite(s) ? (desplazada ? s + v.t0 : s) : NaN; };
  const tramo = (e: Crudo, min = 0.2): [number, number] | null => {
    let a = abs(e.inicio), b = abs(e.fin);
    if (!Number.isFinite(a)) return null;
    if (!Number.isFinite(b) || b < a) b = a;
    a = Math.max(v.t0, a); b = Math.min(v.t1, b);
    return b - a >= min ? [r2(a), r2(b)] : null;
  };
  const nombres = (x: unknown) => [...new Set((Array.isArray(x) ? x : []).filter((n): n is string => typeof n === 'string' && !!n.trim()).map((n) => u.canonico(n)))];

  const escenas: EscenaPlana[] = [];
  for (const e of lista(c.escenas)) {
    const t = tramo(e, 1);
    if (!t) continue;
    escenas.push({
      t0: t[0], t1: t[1], titulo: texto(e.titulo) ?? 'Escena', personas: nombres(e.personas), accion: texto(e.accion) ?? '',
      ...(texto(e.lugar) ? { lugar: texto(e.lugar) } : {}), ...(texto(e.tiempo) ? { tiempo: texto(e.tiempo) } : {}),
      ...(texto(e.transicion) ? { transicion: texto(e.transicion) } : {}), ...(texto(e.notas) ? { notas: texto(e.notas) } : {}),
    });
  }

  const planos: PlanoPercibido[] = [];
  for (const p of lista(c.planos)) {
    const t = tramo(p, 0.1);
    if (!t) continue;
    const localizados = (x: unknown): Localizado[] => lista(x).flatMap((l) => {
      const nombre = texto(l.nombre);
      if (!nombre) return [];
      const region = regionDeCaja(l.caja);
      let instante = abs(l.instante);
      if (!Number.isFinite(instante) || instante < t[0] - 0.5 || instante > t[1] + 0.5) instante = (t[0] + t[1]) / 2;
      instante = Math.min(t[1], Math.max(t[0], instante));
      return [{ nombre, ...(region ? { region, instante: r2(instante) } : {}), ...(texto(l.nota) ? { nota: texto(l.nota) } : {}) }];
    });
    const personas = localizados(p.personas).map((l) => ({ ...l, nombre: u.canonico(l.nombre) }));
    const dominante = texto(p.dominante);
    const composicion = [dominante && !/^nadie$/i.test(dominante) ? `Domina el encuadre: ${u.canonico(dominante)}.` : '', texto(p.composicion) ?? ''].filter(Boolean).join(' ');
    planos.push({
      t0: t[0], t1: t[1],
      ...(texto(p.escala) ? { escala: texto(p.escala) } : {}), ...(texto(p.angulacion) ? { angulacion: texto(p.angulacion) } : {}),
      ...(texto(p.movimiento) ? { movimiento: texto(p.movimiento) } : {}), ...(composicion ? { composicion } : {}),
      ...(texto(p.luz) ? { luz: texto(p.luz) } : {}), ...(texto(p.color) ? { color: texto(p.color) } : {}),
      personas, objetos: localizados(p.objetos),
      ...(texto(p.textoEnPantalla) ? { textoEnPantalla: texto(p.textoEnPantalla) } : {}),
      descripcion: texto(p.descripcion) ?? '',
    });
  }

  const sonidos: SonidoPercibido[] = [];
  for (const s of lista(c.sonidos)) {
    const t = tramo(s, 0.3);
    if (!t) continue;
    const clase = (CLASES_SONIDO as readonly string[]).includes(String(s.clase)) ? (s.clase as SonidoPercibido['clase']) : 'otro';
    sonidos.push({ t0: t[0], t1: t[1], clase, ...(typeof s.diegetico === 'boolean' ? { diegetico: s.diegetico } : {}), descripcion: texto(s.descripcion) ?? '', ...(texto(s.obra) ? { obra: texto(s.obra) } : {}) });
  }

  const dialogos: DialogoPlano[] = [];
  for (const d of lista(c.dialogos)) {
    const t = abs(d.t);
    const tx = texto(d.texto);
    if (!Number.isFinite(t) || !tx || t < v.t0 - 1 || t > v.t1 + 1) continue;
    dialogos.push({ t: r2(Math.min(v.t1, Math.max(v.t0, t))), texto: tx, ...(texto(d.hablante) ? { hablante: u.canonico(texto(d.hablante)!) } : {}) });
  }

  const reparto: PersonaPercibida[] = lista(c.reparto).flatMap((p) => {
    const nombre = texto(p.nombre);
    if (!nombre) return [];
    return [{
      nombre: u.canonico(nombre), ...(typeof p.ficticia === 'boolean' ? { ficticia: p.ficticia } : {}), ...(texto(p.actor) ? { actor: texto(p.actor) } : {}),
      ...(texto(p.descripcionVisual) ? { descripcionVisual: texto(p.descripcionVisual) } : {}), ...(texto(p.voz) ? { voz: texto(p.voz) } : {}),
    }];
  });

  const orden = <T extends { t0: number }>(xs: T[]) => xs.sort((a, b) => a.t0 - b.t0);
  return { ventana: v, escenas: orden(escenas), planos: orden(planos), sonidos: orden(sonidos), dialogos: dialogos.sort((a, b) => a.t - b.t), reparto, desplazada };
}

// ---------------------------------------------------------------------------
// Fusión entre ventanas
// ---------------------------------------------------------------------------

interface Origen { _v: number; _cortadoIni: boolean; _cortadoFin: boolean }

const duenia = (v: Ventana, t: number, ultima: boolean) => t >= v.propioDesde && (t < v.propioHasta || (ultima && t <= v.propioHasta + 0.01));
const solape = (a: { t0: number; t1: number }, b: { t0: number; t1: number }) => Math.max(0, Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0));

/** Los elementos de cada ventana que caen en su tramo propio (por su punto medio), con su origen. */
function propios<T extends { t0: number; t1: number }>(vs: VentanaNormalizada[], sacar: (v: VentanaNormalizada) => T[]): Array<T & Origen> {
  const out: Array<T & Origen> = [];
  vs.forEach((vn, i) => {
    const v = vn.ventana;
    for (const x of sacar(vn)) {
      if (!duenia(v, (x.t0 + x.t1) / 2, i === vs.length - 1)) continue;
      out.push({ ...x, _v: i, _cortadoIni: i > 0 && x.t0 <= v.t0 + 0.6, _cortadoFin: i < vs.length - 1 && x.t1 >= v.t1 - 0.6 });
    }
  });
  return out.sort((a, b) => a.t0 - b.t0);
}

function sinOrigen<T>(x: T & Partial<Origen>): T {
  const { _v, _cortadoIni, _cortadoFin, ...resto } = x as T & Origen;
  void _v; void _cortadoIni; void _cortadoFin;
  return resto as T;
}

/** El corte detectado más cercano a `t` dentro de `tol`, o null. */
export function corteCercano(cortes: number[], t: number, tol: number): number | null {
  let lo = 0, hi = cortes.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if ((cortes[m] as number) < t) lo = m + 1; else hi = m; }
  let mejor: number | null = null;
  for (const i of [lo - 1, lo]) {
    const c = cortes[i];
    if (c !== undefined && Math.abs(c - t) <= tol && (mejor === null || Math.abs(c - t) < Math.abs(mejor - t))) mejor = c;
  }
  return mejor;
}

function fusionarLocalizados(a: Localizado[], b: Localizado[]): Localizado[] {
  const out = [...a];
  for (const x of b) if (!out.some((y) => y.nombre === x.nombre)) out.push(x);
  return out;
}

/** Planos: dueños, duplicados de los solapes fundidos, contiguos y ajustados a los cortes. */
export function fusionarPlanos(vs: VentanaNormalizada[], cortes: number[] = [], ajustar = true): PlanoPercibido[] {
  const todos = propios(vs, (v) => v.planos);
  const out: Array<PlanoPercibido & Origen> = [];
  for (const p of todos) {
    const ult = out.at(-1);
    if (ult && ult._v !== p._v && solape(ult, p) > 0.5 * Math.min(ult.t1 - ult.t0, p.t1 - p.t0)) {
      // El mismo plano visto desde dos ventanas: se queda el más completo.
      const base = (p._cortadoIni || p._cortadoFin) && !(ult._cortadoIni || ult._cortadoFin) ? ult : (p.t1 - p.t0 > ult.t1 - ult.t0 ? p : ult);
      const otro = base === p ? ult : p;
      out[out.length - 1] = { ...base, t0: Math.min(ult.t0, p.t0), t1: Math.max(ult.t1, p.t1), personas: fusionarLocalizados(base.personas, otro.personas), objetos: fusionarLocalizados(base.objetos, otro.objetos), _cortadoIni: false, _cortadoFin: false };
      continue;
    }
    out.push({ ...p });
  }
  const cs = [...cortes].sort((a, b) => a - b);
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i]!, b = out[i + 1]!;
    if (b.t0 < a.t1) {
      // Se pisan: la frontera en un corte detectado dentro del solape, o donde empieza el segundo.
      const c = corteCercano(cs, (b.t0 + a.t1) / 2, (a.t1 - b.t0) / 2 + 0.3);
      const f = c ?? b.t0;
      a.t1 = Math.max(a.t0, f); b.t0 = f;
    } else if (b.t0 - a.t1 < 2) {
      a.t1 = b.t0;
    }
  }
  if (ajustar && cs.length) {
    for (let i = 0; i < out.length; i++) {
      const p = out[i]!;
      const ant = out[i - 1];
      const tol = Math.min(1, (p.t1 - p.t0) / 2, ant ? (ant.t1 - ant.t0) / 2 : 1);
      const c = corteCercano(cs, p.t0, tol);
      if (c !== null) { p.t0 = c; if (ant && Math.abs(ant.t1 - c) <= tol + 0.01) ant.t1 = c; }
    }
    const ult = out.at(-1);
    if (ult) { const c = corteCercano(cs, ult.t1, Math.min(1, (ult.t1 - ult.t0) / 2)); if (c !== null) ult.t1 = c; }
  }
  return out.filter((p) => p.t1 - p.t0 >= 0.08).map((p) => {
    const limpio = sinOrigen<PlanoPercibido>(p);
    const dentro = (l: Localizado) => (l.instante === undefined ? l : { ...l, instante: r2(Math.min(limpio.t1, Math.max(limpio.t0, l.instante))) });
    return { ...limpio, t0: r2(limpio.t0), t1: r2(limpio.t1), personas: limpio.personas.map(dentro), objetos: limpio.objetos.map(dentro) };
  });
}

const parecidas = (a: EscenaPlana, b: EscenaPlana) => {
  const pa = new Set(a.personas), pb = new Set(b.personas);
  const inter = [...pa].filter((x) => pb.has(x)).length;
  const union = new Set([...pa, ...pb]).size;
  const mismoLugar = !!a.lugar && !!b.lugar && normalNombre(a.lugar) === normalNombre(b.lugar);
  return mismoLugar || (union > 0 && inter / union >= 0.34) || normalNombre(a.titulo) === normalNombre(b.titulo);
};

/** Escenas: dueñas, unidas a través de los cortes de ventana, sin solapes y tilando [0, duración]. */
export function fusionarEscenas(vs: VentanaNormalizada[], duracion: number, avisos: string[] = []): EscenaPlana[] {
  const todas = propios(vs, (v) => v.escenas);
  const out: Array<EscenaPlana & Origen> = [];
  for (const e of todas) {
    const ult = out.at(-1);
    if (ult && e.t1 <= ult.t1 + 0.5) { ult.personas = [...new Set([...ult.personas, ...e.personas])]; continue; } // contenida
    const cruza = ult && ult._v !== e._v && (ult._cortadoFin || e._cortadoIni) && e.t0 - ult.t1 <= 3;
    if (ult && cruza && parecidas(ult, e)) {
      out[out.length - 1] = {
        ...ult, t1: e.t1, personas: [...new Set([...ult.personas, ...e.personas])],
        accion: ult.accion && e.accion && !ult.accion.includes(e.accion) ? `${ult.accion} ${e.accion}` : ult.accion || e.accion,
        ...(ult.notas || e.notas ? { notas: [ult.notas, e.notas].filter(Boolean).join(' ') } : {}),
        _cortadoFin: e._cortadoFin,
      };
      continue;
    }
    out.push({ ...e });
  }
  const res: EscenaPlana[] = [];
  const hueco = (t0: number, t1: number): EscenaPlana => {
    avisos.push(`Sin escena entre ${Math.round(t0)} y ${Math.round(t1)} s: se rellena con un tramo sin título.`);
    return { t0, t1, titulo: 'Tramo sin escena identificada', personas: [], accion: '' };
  };
  for (const e of out.map((x) => sinOrigen<EscenaPlana>(x))) {
    const prev = res.at(-1);
    const fin = prev ? prev.t1 : 0;
    if (e.t0 > fin) {
      if (e.t0 - fin < 20) { if (prev) prev.t1 = e.t0; else e.t0 = 0; }
      else res.push(hueco(fin, e.t0));
    } else if (e.t0 < fin) {
      e.t0 = fin;
    }
    if (e.t1 - e.t0 >= 0.5) res.push(e);
  }
  const ult = res.at(-1);
  if (!ult) return duracion > 0 ? [hueco(0, duracion)] : [];
  if (duracion - ult.t1 < 20) ult.t1 = duracion; else res.push(hueco(ult.t1, duracion));
  return res.map((e) => ({ ...e, t0: r2(e.t0), t1: r2(e.t1) }));
}

/** Sonidos: dueños y unidos a través de los cortes de ventana (una música larga es una sola). */
export function fusionarSonidos(vs: VentanaNormalizada[]): SonidoPercibido[] {
  const todos = propios(vs, (v) => v.sonidos);
  const out: Array<SonidoPercibido & Origen> = [];
  for (const s of todos) {
    const igual = [...out].reverse().find((o) => o._v !== s._v && o.clase === s.clase && o.diegetico === s.diegetico && (!o.obra || !s.obra || normalNombre(o.obra) === normalNombre(s.obra)) && s.t0 - o.t1 <= 2 && (o._cortadoFin || s._cortadoIni));
    if (igual) {
      igual.t1 = Math.max(igual.t1, s.t1);
      if (!igual.obra && s.obra) igual.obra = s.obra;
      if (s.descripcion.length > igual.descripcion.length) igual.descripcion = s.descripcion;
      igual._cortadoFin = s._cortadoFin;
      continue;
    }
    out.push({ ...s });
  }
  return out.map((s) => sinOrigen<SonidoPercibido>(s)).sort((a, b) => a.t0 - b.t0);
}

export function fusionarDialogos(vs: VentanaNormalizada[]): DialogoPlano[] {
  const out: DialogoPlano[] = [];
  vs.forEach((vn, i) => {
    for (const d of vn.dialogos) {
      if (!duenia(vn.ventana, d.t, i === vs.length - 1)) continue;
      const n = normalNombre(d.texto).slice(0, 40);
      if (out.some((o) => Math.abs(o.t - d.t) < 2 && normalNombre(o.texto).slice(0, 40) === n)) continue;
      out.push(d);
    }
  });
  return out.sort((a, b) => a.t - b.t);
}

/** Monta las escenas del contrato: cada plano, sonido y frase clave dentro de su escena. */
export function componerEscenas(escenas: EscenaPlana[], planos: PlanoPercibido[], sonidos: SonidoPercibido[], dialogos: DialogoPlano[]): EscenaPercibida[] {
  return escenas.map((e, i) => {
    const ultima = i === escenas.length - 1;
    const dentro = (t: number) => t >= e.t0 && (t < e.t1 || (ultima && t <= e.t1));
    const ps = planos.filter((p) => dentro((p.t0 + p.t1) / 2));
    const personas = [...new Set([...e.personas, ...ps.flatMap((p) => p.personas.map((l) => l.nombre))])];
    return {
      t0: e.t0, t1: e.t1, titulo: e.titulo,
      ...(e.lugar ? { lugar: e.lugar } : {}), ...(e.tiempo ? { tiempo: e.tiempo } : {}),
      personas, accion: e.accion,
      dialogoClave: dialogos.filter((d) => dentro(d.t)).map((d) => ({ t: d.t, ...(d.hablante ? { hablante: d.hablante } : {}), texto: d.texto })),
      sonido: sonidos.filter((s) => solape(s, e) > 0.2 || (s.t0 >= e.t0 && s.t0 < e.t1)).map((s) => ({ ...s, t0: r2(Math.max(s.t0, e.t0)), t1: r2(Math.min(s.t1, e.t1)) })),
      planos: ps,
      ...(e.transicion ? { transicion: e.transicion } : {}), ...(e.notas ? { notas: e.notas } : {}),
    };
  });
}

/** Todo junto: de las ventanas normalizadas a escenas y reparto. */
export function fusionar(vs: VentanaNormalizada[], o: { duracion: number; cortes?: number[]; ajustarCortes?: boolean; repartoConocido?: PersonaPercibida[]; unificador: Unificador }): { escenas: EscenaPercibida[]; reparto: PersonaPercibida[]; avisos: string[] } {
  const avisos: string[] = [];
  const ordenadas = [...vs].sort((a, b) => a.ventana.t0 - b.ventana.t0);
  const planos = fusionarPlanos(ordenadas, o.cortes, o.ajustarCortes ?? true);
  const escenas = fusionarEscenas(ordenadas, o.duracion, avisos);
  const sonidos = fusionarSonidos(ordenadas);
  const dialogos = fusionarDialogos(ordenadas);
  const reparto = fusionarReparto([o.repartoConocido ?? [], ...ordenadas.map((v) => v.reparto)], o.unificador);
  // Solo quien aparece de verdad (o se conocía): fuera los nombres sueltos sin presencia.
  const presentes = new Set([...escenas.flatMap((e) => e.personas), ...planos.flatMap((p) => p.personas.map((l) => l.nombre)), ...dialogos.map((d) => d.hablante).filter(Boolean) as string[]]);
  const conocidos = new Set((o.repartoConocido ?? []).map((p) => p.nombre));
  return { escenas: componerEscenas(escenas, planos, sonidos, dialogos), reparto: reparto.filter((p) => presentes.has(p.nombre) || conocidos.has(p.nombre)), avisos };
}
