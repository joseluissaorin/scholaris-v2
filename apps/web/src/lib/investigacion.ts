/**
 * Investigar, sin React: el estado de una investigación a partir de sus eventos
 * (plan, pasos, pruebas, texto, verificación y fin), las marcas de las pruebas,
 * el resumen de cada paso en una línea y la respuesta con sus citas para copiar.
 *
 * Las marcas: las pruebas llegan como «P1», «P2»… según se encuentran; la
 * respuesta las cita como «[E1]», «[E2]»… (numeradas por orden de aparición).
 * Mientras se escribe, cada trozo de texto dice qué prueba hay detrás de cada
 * marca nueva (`marcas`: { E3: 'P7' }); al final, `fin.evidencias` trae las
 * citadas con su `prueba`.
 */
import { tiempoACadena } from '@scholaris/nucleo';
import type { EventoInvestigacion, EvidenciaInvestigacion, FraseVerificada, PasoInvestigacion, PlanInvestigacion, PresupuestoInvestigacion } from '@scholaris/contrato';
import { numero } from './numero';
import { analizarMarkdown, aHtml, idsDeMarca } from './markdown-respuesta';

export type FinInvestigacion = Extract<EventoInvestigacion, { tipo: 'fin' }>;
export type VerificacionInvestigacion = Omit<Extract<EventoInvestigacion, { tipo: 'verificacion' }>, 'tipo'>;

export type FaseInvestigacion = 'empezando' | 'planificando' | 'investigando' | 'escribiendo' | 'hecho' | 'error';

export interface EstadoInvestigacion {
  pregunta: string;
  fase: FaseInvestigacion;
  id?: string;
  modelo?: string;
  presupuesto?: PresupuestoInvestigacion;
  plan?: PlanInvestigacion;
  pasos: PasoInvestigacion[];
  /** Las pruebas según llegan («P1», «P2»…). */
  pruebas: EvidenciaInvestigacion[];
  /** La respuesta mientras se escribe. */
  texto: string;
  /** De la marca de la respuesta («E3») a la prueba («P7»), según se escribe. */
  marcas: Record<string, string>;
  verificacion?: VerificacionInvestigacion;
  fin?: FinInvestigacion;
  error?: string;
  /** Milisegundos de reloj (Date.now) al empezar y al terminar. */
  empezada: number;
  terminada?: number;
}

export function estadoInicial(pregunta: string, ahora = Date.now()): EstadoInvestigacion {
  return { pregunta, fase: 'empezando', pasos: [], pruebas: [], texto: '', marcas: {}, empezada: ahora };
}

const antesDeEscribir = (f: FaseInvestigacion) => f === 'empezando' || f === 'planificando' || f === 'investigando';

/** El estado tras un evento (sin mutar el anterior). Los eventos desconocidos no cambian nada. */
export function aplicarEvento(e: EstadoInvestigacion, ev: EventoInvestigacion, ahora = Date.now()): EstadoInvestigacion {
  if (e.fase === 'hecho' || e.fase === 'error') {
    // Tras el final solo cuenta una verificación rezagada.
    return ev.tipo === 'verificacion' ? { ...e, verificacion: { frases: ev.frases, respaldadas: ev.respaldadas, total: ev.total } } : e;
  }
  switch (ev.tipo) {
    case 'inicio': return { ...e, fase: e.fase === 'empezando' ? 'planificando' : e.fase, id: ev.id, modelo: ev.modelo, presupuesto: ev.presupuesto };
    case 'plan': return { ...e, plan: ev.plan, fase: antesDeEscribir(e.fase) ? 'investigando' : e.fase };
    case 'paso': {
      const { tipo: _, ...paso } = ev;
      const pasos = e.pasos.some((p) => p.n === paso.n) ? e.pasos.map((p) => (p.n === paso.n ? paso : p)) : [...e.pasos, paso];
      return { ...e, pasos, fase: antesDeEscribir(e.fase) ? 'investigando' : e.fase };
    }
    case 'evidencia': {
      const p = ev.evidencia;
      const pruebas = e.pruebas.some((x) => x.id === p.id) ? e.pruebas.map((x) => (x.id === p.id ? p : x)) : [...e.pruebas, p];
      return { ...e, pruebas };
    }
    // «reinicio»: la redacción anterior falló y se vuelve a escribir desde cero.
    case 'texto': return ev.reinicio
      ? { ...e, fase: 'escribiendo', texto: ev.delta, marcas: ev.marcas ?? {} }
      : { ...e, fase: 'escribiendo', texto: e.texto + ev.delta, marcas: ev.marcas ? { ...e.marcas, ...ev.marcas } : e.marcas };
    case 'verificacion': return { ...e, verificacion: { frases: ev.frases, respaldadas: ev.respaldadas, total: ev.total } };
    case 'fin': return { ...e, fase: 'hecho', fin: ev, terminada: ahora };
    case 'error': return { ...e, fase: 'error', error: ev.mensaje || 'La investigación falló.', terminada: ahora };
    default: return e;
  }
}

/** El número que se ve de una marca: «E3» → 3, «P12» → 12. */
export const numeroDeMarca = (id: string) => Number(/\d+/.exec(id)?.[0] ?? 0);

/**
 * Las pruebas que cita la respuesta, por su marca («E1» → la prueba). Al final,
 * las de `fin`; mientras se escribe, las que dicen las `marcas` del texto.
 */
export function pruebasCitadas(e: Pick<EstadoInvestigacion, 'fin' | 'marcas' | 'pruebas'>): Map<string, EvidenciaInvestigacion> {
  const m = new Map<string, EvidenciaInvestigacion>();
  if (e.fin) { for (const x of e.fin.evidencias) m.set(x.id, x); return m; }
  const porId = new Map(e.pruebas.map((p) => [p.id, p]));
  for (const [marca, prueba] of Object.entries(e.marcas)) { const p = porId.get(prueba); if (p) m.set(marca, p); }
  return m;
}

/** Las pruebas reunidas que la respuesta final no cita (ni directamente ni estrechadas). */
export function pruebasSinCitar(e: Pick<EstadoInvestigacion, 'fin' | 'pruebas'>): EvidenciaInvestigacion[] {
  if (!e.fin) return [];
  const usadas = new Set(e.fin.evidencias.map((x) => x.prueba).filter(Boolean));
  const claves = new Set(e.fin.evidencias.map(claveEvidencia));
  return e.pruebas.filter((p) => !usadas.has(p.id) && !claves.has(claveEvidencia(p)));
}

/** Lo que identifica una prueba más allá de su marca: dónde está y qué dice. */
export function claveEvidencia(x: EvidenciaInvestigacion): string {
  return `${x.documento}|${JSON.stringify(x.ancla)}|${x.fragmento ?? ''}|${x.figura ?? ''}`;
}

/** ¿Hay que marcar esta frase? Las que sus pruebas no sostienen y las que no citan ninguna. */
export const fraseDudosa = (f: FraseVerificada) => f.veredicto === 'sin_respaldo' || f.veredicto === 'sin_prueba';

export const VEREDICTO: Record<FraseVerificada['veredicto'], string> = {
  respaldada: 'respaldada',
  parcial: 'respaldada solo en parte',
  sin_respaldo: 'sus pruebas no lo dicen',
  sin_prueba: 'no cita ninguna prueba',
};

// ---------------------------------------------------------------------------
// Las herramientas y sus pasos
// ---------------------------------------------------------------------------

export const ETIQUETA_HERRAMIENTA: Record<string, string> = {
  buscar: 'Buscar',
  leer: 'Leer',
  mapa: 'Mapa',
  entidad: 'Entidad',
  citas: 'Citas',
  relaciones: 'Relaciones',
  alinear: 'Alinear',
  ver: 'Ver',
  escuchar: 'Escuchar',
  recordar: 'Recordar',
  anotar: 'Anotar',
};

export function etiquetaHerramienta(h: string): string {
  return ETIQUETA_HERRAMIENTA[h] ?? (h ? h[0]!.toLocaleUpperCase('es') + h.slice(1) : 'Paso');
}

const corto = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const TEXTO = ['consulta', 'pregunta', 'q', 'texto', 'nombre', 'entidad', 'termino', 'tema', 'que', 'clave'];
const DOCS = ['documento', 'documentos', 'doc', 'docs', 'obra', 'obras'];
const OMITIR = new Set([...TEXTO, ...DOCS, 'desde', 'hasta', 'unidades', 'paginas', 'pagina', 't0', 't1', 'inicio', 'fin', 'tramo', 'k', 'limite', 'max']);

function tramo(entrada: Record<string, unknown>): string | null {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null);
  const par = (a: unknown, b: unknown): [number, number | null] | null => { const x = n(a); return x == null ? null : [x, n(b)]; };
  const t = par(entrada.t0 ?? entrada.inicio, entrada.t1 ?? entrada.fin);
  if (t && (entrada.t0 != null || entrada.t1 != null)) return t[1] != null && t[1] !== t[0] ? `${tiempoACadena(t[0])}-${tiempoACadena(t[1])}` : tiempoACadena(t[0]);
  const u = Array.isArray(entrada.unidades) ? par(entrada.unidades[0], entrada.unidades.at(-1)) : Array.isArray(entrada.paginas) ? par(entrada.paginas[0], entrada.paginas.at(-1)) : par(entrada.desde ?? entrada.pagina, entrada.hasta);
  if (u) return u[1] != null && u[1] !== u[0] ? `pp. ${u[0]}-${u[1]}` : `p. ${u[0]}`;
  if (Array.isArray(entrada.tramo) && entrada.tramo.length === 2) {
    const [a, b] = entrada.tramo.map(n);
    if (a != null && b != null) return `${tiempoACadena(a)}-${tiempoACadena(b)}`;
  }
  return null;
}

/**
 * La entrada de un paso en una línea: qué busca o lee, en qué obras y en qué
 * tramo («“el helado” · Coppelia (película) · 1:02:03-1:03:10»).
 * `titulo` traduce un id de documento a su título, si se conoce.
 */
export function resumirEntrada(entrada: Record<string, unknown> | undefined, titulo: (id: string) => string | undefined = () => undefined, max = 140): string {
  if (!entrada || typeof entrada !== 'object') return '';
  const partes: string[] = [];
  for (const k of TEXTO) {
    const v = entrada[k];
    if (typeof v === 'string' && v.trim()) { partes.push(`«${corto(v.trim().replace(/\s+/g, ' '), 70)}»`); break; }
  }
  for (const k of DOCS) {
    const v = entrada[k];
    const ids = typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    if (!ids.length) continue;
    const nombres = ids.map((id) => titulo(id)).filter((x): x is string => !!x);
    partes.push(nombres.length === ids.length && nombres.length <= 2 ? nombres.map((x) => corto(x, 48)).join(', ') : ids.length === 1 ? 'un documento' : `${ids.length} documentos`);
    break;
  }
  const t = tramo(entrada);
  if (t) partes.push(t);
  for (const [k, v] of Object.entries(entrada)) {
    if (OMITIR.has(k) || v == null || v === '' || typeof v === 'object') continue;
    if (typeof v === 'boolean') { if (v) partes.push(k); continue; }
    partes.push(`${k}: ${corto(String(v), 30)}`);
  }
  return corto(partes.join(' · '), max);
}

// ---------------------------------------------------------------------------
// Cifras
// ---------------------------------------------------------------------------

/** «38 s», «2 min 5 s», «1 h 3 min». */
export function duracionLegible(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${numero(s, { maximumFractionDigits: 1 })} s`;
  if (s < 60) return `${Math.round(s)} s`;
  const min = Math.floor(s / 60), seg = Math.round(s % 60);
  if (min < 60) return seg ? `${min} min ${seg} s` : `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** «0,08 USD»; por debajo de un céntimo, «menos de 0,01 USD». */
export function costeLegible(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '0 USD';
  if (usd < 0.01) return 'menos de 0,01 USD';
  return `${numero(usd, { minimumFractionDigits: 2, maximumFractionDigits: usd < 0.1 ? 3 : 2 })} USD`;
}

// ---------------------------------------------------------------------------
// Copiar con citas
// ---------------------------------------------------------------------------

/** Las citas cortas de unas marcas, juntas: «(Paz, 1991, p. 14; Paz, 1991, p. 20)». */
export function citasJuntas(ids: string[], pruebas: Map<string, Pick<EvidenciaInvestigacion, 'citaCorta'>>): string {
  const cortas = ids.map((id) => pruebas.get(id)?.citaCorta).filter((c): c is string => !!c);
  const unicas = [...new Set(cortas)];
  if (!unicas.length) return '';
  if (unicas.length === 1) return unicas[0]!;
  return unicas.every((c) => /^\(.*\)$/.test(c)) ? `(${unicas.map((c) => c.slice(1, -1)).join('; ')})` : unicas.join('; ');
}

/** La respuesta en Markdown con cada marca cambiada por su cita corta (las marcas seguidas, en una sola). */
export function markdownConCitas(md: string, pruebas: Map<string, Pick<EvidenciaInvestigacion, 'citaCorta'>>): string {
  return md
    .replace(/[ \t]*((?:\[E\d{1,4}(?:\s*[,;–—-]\s*E?\d{1,4})*\])+)/g, (_, grupo: string) => {
      const ids = [...grupo.matchAll(/\[([^\]]+)\]/g)].flatMap((m) => idsDeMarca(m[1]!));
      const c = citasJuntas(ids, pruebas);
      return c ? ` ${c}` : '';
    });
}

/** La respuesta para el portapapeles: Markdown con citas (texto) y HTML con formato (para pegar en un procesador). */
export function respuestaParaCopiar(md: string, pruebas: Map<string, Pick<EvidenciaInvestigacion, 'citaCorta'>>): { texto: string; html: string } {
  const texto = markdownConCitas(md, pruebas).trim();
  const html = aHtml(analizarMarkdown(md), (ids) => citasJuntas(ids, pruebas));
  return { texto, html };
}
