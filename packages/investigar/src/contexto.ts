/**
 * Lo que comparten las herramientas durante una investigación: los puertos, el
 * cuaderno de pruebas, los documentos, el ámbito, las notas y la contabilidad.
 */
import type { DocumentoBreve } from '@scholaris/busqueda';
import { plegar } from '@scholaris/busqueda';
import type { Evidencia, Filtros } from '@scholaris/nucleo';
import type { CapaEvidencia } from '@scholaris/contrato';
import type { Contabilidad, DeclaracionHerramienta } from './modelo.js';
import type { PuertosInvestigar } from './puertos.js';
import { CuadernoPruebas, fichaDocumento, type Ambito, type FichaDocumento, type Prueba, etiquetaDe } from './pruebas.js';

export interface Nota {
  tipo: 'hallazgo' | 'hipotesis' | 'pendiente';
  texto: string;
  pruebas: string[];
}

export interface ContextoHerramientas {
  p: PuertosInvestigar;
  pruebas: CuadernoPruebas;
  docs: Map<string, DocumentoBreve>;
  fichas: Map<string, FichaDocumento>;
  /** Documentos permitidos (los de los filtros), o null si toda la biblioteca. */
  ambito: Set<string> | null;
  filtros: Filtros;
  notas: Nota[];
  cuentas: Contabilidad;
  /** Segundos de vídeo como mucho por llamada a «ver». */
  segundosVer: number;
  resultadosPorBusqueda: number;
  idioma: string;
  /** Se llama con cada prueba nueva (para emitir el evento «evidencia»). */
  alPrueba: (p: Prueba) => void;
  avisos: string[];
  signal?: AbortSignal;
}

export interface ResultadoHerramienta {
  /** Lo que lee el modelo. */
  texto: string;
  /** Una línea para la interfaz. */
  resumen: string;
  /** Pruebas nuevas. */
  pruebas: string[];
  error?: string;
}

export interface Herramienta {
  declaracion: DeclaracionHerramienta;
  ejecutar(args: Record<string, unknown>, ctx: ContextoHerramientas): Promise<ResultadoHerramienta>;
}

export const fallo = (mensaje: string): ResultadoHerramienta => ({ texto: `ERROR: ${mensaje}`, resumen: mensaje, pruebas: [], error: mensaje });

export function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function numero(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Acepta «1:02:03», «62:03», «3723» o un número. */
export function segundosDe(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const s = texto(v);
  if (!s) return undefined;
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  const partes = s.split(':').map((x) => Number(x.replace(',', '.')));
  if (partes.some((x) => !Number.isFinite(x))) return undefined;
  return partes.reduce((a, x) => a * 60 + x, 0);
}

/** Un tramo [desde, hasta] de los argumentos del modelo ({desde, hasta} o [a, b]). */
export function tramoDe(v: unknown, conv: (x: unknown) => number | undefined = numero): [number, number] | undefined {
  if (Array.isArray(v) && v.length >= 1) {
    const a = conv(v[0]);
    const b = conv(v[1] ?? v[0]);
    return a !== undefined && b !== undefined ? [Math.min(a, b), Math.max(a, b)] : undefined;
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const a = conv(o.desde ?? o.inicio ?? o.t0 ?? o.de);
    const b = conv(o.hasta ?? o.fin ?? o.t1 ?? o.a ?? o.desde);
    return a !== undefined && b !== undefined ? [Math.min(a, b), Math.max(a, b)] : undefined;
  }
  return undefined;
}

export function recortar(s: string, n: number): string {
  const t = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length <= n) return t;
  const corte = t.slice(0, n);
  const ultimo = corte.lastIndexOf(' ');
  return `${(ultimo > n * 0.6 ? corte.slice(0, ultimo) : corte).replace(/[\s,;:.]+$/, '')}…`;
}

/** «Título» (Autor, año) [id]. */
export function rotuloDocumento(ctx: ContextoHerramientas, id: string): string {
  const f = ctx.fichas.get(id);
  return f ? `«${f.titulo}» (${f.autor}, ${f.anio}) [${id}]` : `[${id}]`;
}

export function fichaDe(ctx: ContextoHerramientas, id: string): FichaDocumento | undefined {
  let f = ctx.fichas.get(id);
  if (!f) {
    const d = ctx.docs.get(id);
    if (d) { f = fichaDocumento(d); ctx.fichas.set(id, f); }
  }
  return f;
}

/** El documento al que se refiere el modelo: su id, o un trozo de su título. Respeta el ámbito. */
export function resolverDocumento(ctx: ContextoHerramientas, valor: unknown): string | null {
  const v = texto(valor);
  if (!v) return null;
  const dentro = (id: string) => !ctx.ambito || ctx.ambito.has(id);
  if (ctx.docs.has(v)) return dentro(v) ? v : null;
  const q = plegar(v.replace(/^[«"“]|[»"”]$/g, '')).replace(/\s+/g, ' ').trim();
  if (q.length < 3) return null;
  let mejor: string | null = null;
  for (const d of ctx.docs.values()) {
    if (!dentro(d.id)) continue;
    const t = plegar(`${d.metadatos.titulo} ${d.metadatos.subtitulo ?? ''}`);
    if (t === q || t.startsWith(q)) return d.id;
    if (!mejor && (t.includes(q) || q.includes(plegar(d.metadatos.titulo)))) mejor = d.id;
  }
  return mejor;
}

export function documentosDisponibles(ctx: ContextoHerramientas): string {
  const ids = [...ctx.docs.keys()].filter((id) => !ctx.ambito || ctx.ambito.has(id)).slice(0, 12);
  return ids.map((id) => rotuloDocumento(ctx, id)).join('; ');
}

/** Apunta una prueba y avisa si es nueva. */
export function apuntar(ctx: ContextoHerramientas, e: Evidencia, meta: { capa: CapaEvidencia; herramienta: string; nota?: string; ambito?: Ambito; imagen?: string }): Prueba {
  const { prueba, nueva } = ctx.pruebas.registrar({ evidencia: e, ...meta });
  if (nueva) ctx.alPrueba(prueba);
  return prueba;
}

/** Cómo ve el modelo una prueba: su marca, de dónde es, dónde, y lo que dice o muestra. */
export function lineaPrueba(ctx: ContextoHerramientas, p: Prueba, n = 600): string {
  const e = p.evidencia;
  const f = fichaDe(ctx, e.documento);
  const a = e.ancla;
  const donde = etiquetaDe(a, e.anclaFin);
  const extra = [
    a.tipo === 'pagina' ? `pág. física ${a.fisica}` : '',
    a.tipo === 'tiempo' && a.hablante ? `habla: ${a.hablante}` : '',
    a.instante !== undefined ? `instante ${a.instante}s` : '',
    a.region ? `región x=${a.region.x.toFixed(2)} y=${a.region.y.toFixed(2)} w=${a.region.w.toFixed(2)} h=${a.region.h.toFixed(2)}` : '',
  ].filter(Boolean).join(', ');
  const cabecera = `[${p.id}] ${f ? `${f.autor}, ${f.anio}, «${f.titulo}»` : e.documento}, ${donde}${extra ? ` (${extra})` : ''} · ${p.capa}${e.modo !== 'texto' ? `, ${e.modo}` : ''}`;
  const cuerpo = e.cita ? (e.modo === 'texto' || e.modo === 'audio' ? `«${recortar(e.cita, n)}»` : recortar(e.cita, n)) : '';
  return `${cabecera}${p.nota ? `\n  (${recortar(p.nota, 240)})` : ''}${cuerpo ? `\n${cuerpo}` : ''}`;
}
