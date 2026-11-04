/**
 * La transcripción revisada y la percepción de los medios en la demostración
 * (contrato/medios.ts). Los precios por hora son los de la API
 * (apps/api/src/compartido/medios-existentes.ts, «preciosHora»). La película
 * inventada ya está revisada y aplicada (con algún hueco que queda); la
 * grabación de «La vida es sueño» tiene una revisión hecha sin aplicar; el
 * discurso no se ha revisado nunca. Lanzar crea una tarea que termina sola.
 */
import type {
  CoberturaTranscripcionVista, EstimacionMedio, EventoTiempoReal, HuecoTranscripcion, ParteTrabajoMedio, PreciosMedio, RevisionTranscripcionVista,
} from '@scholaris/contrato';
import type { DocDemo } from './corpus';
import { ID_PELICULA } from './obras-inventadas';

type Ruta = (metodo: string, patron: string, fn: (m: RegExpMatchArray, cuerpo: any, q: URLSearchParams) => Promise<Response> | Response) => void;
interface Ayudas {
  ruta: Ruta;
  json: (cuerpo: unknown, ms?: number, estado?: number) => Promise<Response>;
  error: (estado: number, codigo: string, mensaje: string) => Promise<Response>;
  emitir: (e: EventoTiempoReal) => void;
  documento: (id: string) => (DocDemo & { estado: string; borrado?: boolean }) | undefined;
  documentos: () => Array<DocDemo & { estado: string; borrado?: boolean }>;
  /** Una tarea de la demo que termina sola al cabo de `ms` (y avisa por el tiempo real). */
  tarea: (documento: string, ms: number, alTerminar: () => void) => string;
}

const PRECIOS: PreciosMedio = { percepcion: 2.6, huecos: 0.6, hablantes: 0.96 };

interface MedioDemo {
  proxy: boolean;
  percepcion: boolean;
  revision: { antes: CoberturaTranscripcionVista; despues?: CoberturaTranscripcionVista; aplicada: string | null; correcciones: { huecos: number; tiemposRotos: number; hablantes: number; desfases: number }; usd: number; avisos: string[] } | null;
  tarea: { id: string; estado: string; actualizada: string; error?: string } | null;
}

const h = (t0: number, t1: number, motivo: HuecoTranscripcion['motivo'] = 'sin_texto'): HuecoTranscripcion => ({ t0, t1, motivo, activo: Math.round((t1 - t0) * 0.8 * 10) / 10 });
const cobertura = (activo: number, huecos: HuecoTranscripcion[], rotas = 0): CoberturaTranscripcionVista => {
  const sinTexto = Math.round(huecos.filter((x) => x.motivo === 'sin_texto').reduce((s, x) => s + x.activo, 0));
  const roto = huecos.filter((x) => x.motivo === 'tiempos_rotos').reduce((s, x) => s + x.activo, 0);
  return { activo, cubierto: Math.round(activo - sinTexto - roto), huecos: huecos.length, segundosSinTexto: sinTexto, palabrasRotas: rotas, lista: huecos };
};

const estado = new Map<string, MedioDemo>();
function medio(id: string): MedioDemo {
  let m = estado.get(id);
  if (m) return m;
  if (id === ID_PELICULA) {
    m = {
      proxy: true, percepcion: true, tarea: null,
      revision: {
        antes: cobertura(2400, [h(232, 300), h(610, 700), h(1010, 1046), h(1300, 1350), h(3560, 3640), h(3925, 3990), h(4620, 4700), h(5320, 5345, 'tiempos_rotos')], 14),
        despues: cobertura(2400, [h(1010, 1046), h(3925, 3990), h(5320, 5345, 'tiempos_rotos')], 3),
        aplicada: '2026-10-22T08:40:00Z', correcciones: { huecos: 5, tiemposRotos: 0, hablantes: 3, desfases: 1 }, usd: 1.37,
        avisos: ['Dos tramos con música por encima de la voz no se pudieron transcribir del todo.'],
      },
    };
  } else if (id === 'd-vida-sueno') {
    m = {
      proxy: true, percepcion: false, tarea: null,
      revision: { antes: cobertura(640, [h(118, 131), h(402, 416), h(598, 641)], 2), aplicada: null, correcciones: { huecos: 3, tiemposRotos: 0, hablantes: 0, desfases: 2 }, usd: 0.14, avisos: [] },
    };
  } else m = { proxy: false, percepcion: false, revision: null, tarea: null };
  estado.set(id, m);
  return m;
}

/** Lo que se haría con un medio y lo que costaría (la misma cuenta que la API). */
function estimar(d: DocDemo, o: { percepcion: boolean; hablantes: boolean; rehacer?: boolean }): EstimacionMedio {
  const m = medio(d.id);
  const horas = (d.duracion ?? 0) / 3600;
  const hara: ParteTrabajoMedio[] = [];
  let usd = 0;
  if (!m.proxy) hara.push('proxy');
  if (o.percepcion && (!m.percepcion || o.rehacer)) { hara.push('percepcion'); usd += PRECIOS.percepcion * horas; }
  const revisar = !!o.rehacer || !m.revision;
  if (revisar) { hara.push('huecos'); usd += PRECIOS.huecos * horas; }
  if (revisar && o.hablantes && (o.percepcion || m.percepcion)) { hara.push('hablantes'); usd += PRECIOS.hablantes * horas; }
  if (revisar || (m.revision && !m.revision.aplicada)) hara.push('reescritura');
  return {
    documento: d.id, titulo: d.meta.titulo, tipo: d.tipo, duracion: d.duracion ?? 0, tieneProxy: m.proxy, tienePercepcion: m.percepcion, tieneRevision: !!m.revision,
    revisionAplicada: !!m.revision?.aplicada, hara, usd: Math.round(usd * 100) / 100,
  };
}

function vista(d: DocDemo): RevisionTranscripcionVista | null {
  const m = medio(d.id);
  if (!m.revision && !m.tarea) return null;
  if (!m.revision) return { documento: d.id, aplicada: null, tarea: m.tarea, avisosDocumento: [] };
  const r = m.revision;
  return {
    documento: d.id, version: 'percepcion@3', modelo: 'gemini-3.8-flash', aplicada: r.aplicada, correcciones: r.correcciones,
    cobertura: { antes: r.antes, ...(r.despues ? { despues: r.despues } : {}) }, usd: r.usd, avisos: r.avisos, tarea: m.tarea, avisosDocumento: [],
  };
}

export function registrarMedios(a: Ayudas): void {
  const { ruta, json, error } = a;
  const esMedio = (d: DocDemo | undefined) => !!d && (d.tipo === 'video' || d.tipo === 'audio');

  /** El trabajo de un medio: una tarea que, al terminar, deja la transcripción revisada y aplicada (y la percepción, si se pidió). */
  const trabajar = (d: DocDemo, o: { percepcion: boolean; hablantes: boolean; rehacer?: boolean }) => {
    const m = medio(d.id);
    const e = estimar(d, o);
    const ms = 5000 + (e.hara.includes('percepcion') ? 4000 : 0);
    const id = a.tarea(d.id, ms, () => {
      m.proxy = true;
      if (e.hara.includes('percepcion')) m.percepcion = true;
      const activo = Math.round((d.duracion ?? 600) * 0.82);
      const antes = m.revision?.antes ?? cobertura(activo, [h(activo * 0.2, activo * 0.2 + 40), h(activo * 0.55, activo * 0.55 + 25), h(activo * 0.8, activo * 0.8 + 12, 'tiempos_rotos')], 9);
      m.revision = {
        antes, despues: cobertura(antes.activo, (antes.lista ?? []).slice(-1), 1), aplicada: new Date().toISOString(),
        correcciones: { huecos: Math.max(1, antes.huecos - 1), tiemposRotos: 0, hablantes: e.hara.includes('hablantes') ? 4 : 0, desfases: 1 }, usd: e.usd || m.revision?.usd || 0,
        avisos: e.hara.includes('hablantes') ? [] : ['Quién dice cada frase no se revisó: hace falta la percepción del medio.'],
      };
      m.tarea = { id, estado: 'listo', actualizada: new Date().toISOString() };
    });
    m.tarea = { id, estado: 'procesando', actualizada: new Date().toISOString() };
    return id;
  };

  ruta('GET', '/documentos/:id/transcripcion/revision', (m) => {
    const d = a.documento(m[1]!);
    if (!d) return error(404, 'no_encontrado', 'El documento no existe.');
    const v = esMedio(d) ? vista(d) : null;
    return v ? json(v) : error(404, 'no_encontrado', 'La revisión de la transcripción no existe.');
  });
  ruta('POST', '/documentos/:id/transcripcion/revisar', (m, c: { simular?: boolean; percepcion?: boolean; hablantes?: boolean; rehacer?: boolean }) => {
    const d = a.documento(m[1]!);
    if (!d) return error(404, 'no_encontrado', 'El documento no existe.');
    if (!esMedio(d)) return error(400, 'peticion_invalida', 'Solo los audios y los vídeos tienen transcripción que revisar.');
    const o = { percepcion: !!c.percepcion, hablantes: c.hablantes !== false, ...(c.rehacer ? { rehacer: true } : {}) };
    const e = estimar(d, o);
    const estimacion = e.hara.length ? e : null;
    if (c.simular) return json({ documento: d.id, lanzada: false, estimacion, precios: PRECIOS }, 500);
    const mm = medio(d.id);
    if (mm.tarea?.estado === 'procesando') return error(409, 'conflicto', 'El documento ya se está procesando.');
    return json({ documento: d.id, tarea: trabajar(d, o), lanzada: true, estimacion }, 200, 202);
  });

  const biblioteca = (que: 'percepcion' | 'transcripcion') => (_m: RegExpMatchArray, c: { documentos?: string[]; confirmar?: boolean; hablantes?: boolean; rehacer?: boolean; presupuestoUsd?: number }) => {
    const o = { percepcion: que === 'percepcion', hablantes: c.hablantes !== false, ...(c.rehacer ? { rehacer: true } : {}) };
    const medios = a.documentos().filter((d) => !d.borrado && d.estado === 'listo' && esMedio(d) && (!c.documentos?.length || c.documentos.includes(d.id)));
    const docs = medios.map((d) => estimar(d, o)).filter((e) => e.hara.length);
    const usd = Math.round(docs.reduce((s, e) => s + e.usd, 0) * 100) / 100;
    const horas = Math.round((docs.reduce((s, e) => s + e.duracion, 0) / 3600) * 100) / 100;
    const salida = { documentos: docs, usd, horas, precios: PRECIOS, ...(que === 'percepcion' ? { hablantes: o.hablantes } : {}) };
    if (!c.confirmar) return json({ lanzada: false, ...salida, aviso: 'Solo es una estimación: repite la petición con «confirmar»: true para lanzarla.' }, 600);
    if (c.presupuestoUsd !== undefined && usd > c.presupuestoUsd) return error(409, 'conflicto', `La estimación (${usd.toFixed(2)} $) pasa del presupuesto que has puesto (${c.presupuestoUsd.toFixed(2)} $).`);
    // Dos a la vez; los demás, en cola (aquí, escalonados).
    const lanzados: Array<{ documento: string; tarea: string }> = [];
    docs.forEach((e, i) => {
      const d = a.documento(e.documento)!;
      if (i < 2) lanzados.push({ documento: d.id, tarea: trabajar(d, o) });
      else setTimeout(() => trabajar(d, o), Math.floor(i / 2) * 9500);
    });
    return json({ lanzada: true, ...salida, encolados: docs.length, lanzados }, 300, 202);
  };
  ruta('POST', '/medios/percibir', biblioteca('percepcion'));
  ruta('POST', '/transcripcion/revisar', biblioteca('transcripcion'));
}
