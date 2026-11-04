/**
 * El juez de la respuesta entera: cada punto de la rúbrica (cubierto, parcial,
 * ausente o contradicho), las trampas en las que cae y la precisión de cada cita.
 */
import { anclaACita } from '@scholaris/nucleo';
import { juzgarCitas, type Mirador } from './citas.js';
import type { Fuentes } from './fuentes.js';
import type { ModeloJuez } from './modelo.js';
import { puntuar } from './puntuar.js';
import type { AnclaRubrica, JuicioPregunta, JuicioPunto, JuicioTrampa, Pregunta, RespuestaNormalizada, VeredictoPunto } from './tipos.js';

export const VERSION_JUEZ = 'comprension-juez-1';

export const SISTEMA_RUBRICA = `Eres el juez de un banco de pruebas de comprensión académica (filología, cine, transmedia). Recibes una pregunta muy difícil, su rúbrica de puntos (verdad comprobada contra las fuentes, con sus anclas), una lista de trampas (afirmaciones falsas) y la respuesta de un sistema.
Para cada punto decide:
- "cubierto": la respuesta afirma con claridad lo esencial del punto (vale la paráfrasis y cualquier lengua). Si el punto incluye un lugar (página, minuto) y la pregunta lo pide, el lugar debe ser correcto o muy cercano (misma página o pliego; tramo de tiempo que se solape o diste menos de un minuto).
- "parcial": recoge solo una parte, lo dice de forma vaga, o acierta el contenido pero falla o calla el lugar que la pregunta pide.
- "ausente": no lo dice.
- "contradicho": afirma lo contrario o un dato incompatible con el punto.
Para los puntos que dicen que algo NO está en las fuentes, solo es "cubierto" si la respuesta lo dice expresamente; si se inventa ese contenido, es "contradicho".
Una trampa está "activada" si la respuesta la afirma como hecho, aunque sea con matices; no lo está si la menciona para negarla.
Reglas: la rúbrica es la verdad; no uses lo que sepas de las obras para premiar o castigar. No premies la extensión ni la retórica; no castigues información correcta que no esté en la rúbrica. Si la respuesta dice que no puede responder, los puntos quedan "ausentes" (no contradichos).
Motivos en español, de 30 palabras como mucho, citando el fragmento de la respuesta que decide.`;

const ESQUEMA_RUBRICA = {
  type: 'object',
  properties: {
    puntos: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, veredicto: { type: 'string', enum: ['cubierto', 'parcial', 'ausente', 'contradicho'] }, motivo: { type: 'string' } },
        required: ['id', 'veredicto', 'motivo'],
      },
    },
    trampas: {
      type: 'array',
      items: { type: 'object', properties: { n: { type: 'integer' }, activada: { type: 'boolean' }, motivo: { type: 'string' } }, required: ['n', 'activada', 'motivo'] },
    },
  },
  required: ['puntos', 'trampas'],
};

const hms = (s: number) => {
  const t = Math.round(s);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};

export function describirAncla(a: AnclaRubrica, titulos: Record<string, string>): string {
  const doc = titulos[a.documento] ?? a.documento;
  const donde = a.t0 !== undefined ? `${hms(a.t0)}-${hms(a.t1 ?? a.t0)}` : a.impresa ? `p. ${a.impresa}` : a.fisica !== undefined ? `unidad ${a.fisica}` : '';
  return `${doc}, ${donde}${a.cita ? `: «${a.cita}»` : ''}${a.que ? ` [se ve u oye: ${a.que}]` : ''}`;
}

export function textoParaJuez(p: Pregunta, r: RespuestaNormalizada, titulos: Record<string, string>): string {
  const puntos = p.rubrica.puntos.map((x) => `- ${x.id}${x.obligatorio ? ' (obligatorio)' : ''}: ${x.afirmacion}\n  Anclas: ${x.anclas.map((a) => describirAncla(a, titulos)).join(' | ')}`).join('\n');
  const trampas = p.rubrica.trampas.map((t, i) => `${i + 1}. ${t}`).join('\n') || '(ninguna)';
  const citas = r.citas.map((c) => {
    const donde = c.etiqueta ?? (c.ancla ? anclaACita(c.ancla, c.anclaFin) : '');
    return `[${/^\d+$/.test(c.id) ? `^${c.id}` : c.id}] ${titulos[c.documento] ?? c.documento}, ${donde}`;
  }).join('\n');
  return `PREGUNTA (${p.idioma}): ${p.pregunta}\n\nRÚBRICA:\n${puntos}\n\nTRAMPAS:\n${trampas}\n\nRESPUESTA DEL SISTEMA:\n${r.markdown || '(vacía)'}\n\nCITAS DE LA RESPUESTA:\n${citas || '(ninguna)'}`;
}

export async function juzgarRubrica(p: Pregunta, r: RespuestaNormalizada, juez: ModeloJuez, titulos: Record<string, string>): Promise<{ puntos: JuicioPunto[]; trampas: JuicioTrampa[]; usd: number }> {
  if (!r.markdown.trim()) {
    return {
      puntos: p.rubrica.puntos.map((x) => ({ id: x.id, veredicto: 'ausente' as VeredictoPunto, motivo: 'Respuesta vacía.' })),
      trampas: p.rubrica.trampas.map((t) => ({ trampa: t, activada: false, motivo: 'Respuesta vacía.' })),
      usd: 0,
    };
  }
  const res = await juez.json<{ puntos: Array<{ id: string; veredicto: VeredictoPunto; motivo: string }>; trampas: Array<{ n: number; activada: boolean; motivo: string }> }>({
    sistema: SISTEMA_RUBRICA, usuario: textoParaJuez(p, r, titulos), esquema: ESQUEMA_RUBRICA,
  });
  if (!Array.isArray(res.json.puntos) || !Array.isArray(res.json.trampas)) throw new Error('El juez devolvió un JSON sin puntos o sin trampas.');
  const validos = new Set(p.rubrica.puntos.map((x) => x.id));
  const puntos = res.json.puntos.filter((x) => validos.has(x.id)).map((x) => ({ id: x.id, veredicto: x.veredicto, motivo: x.motivo }));
  const porN = new Map(res.json.trampas.map((t) => [t.n, t]));
  const trampas = p.rubrica.trampas.map((t, i) => ({ trampa: t, activada: porN.get(i + 1)?.activada ?? false, motivo: porN.get(i + 1)?.motivo ?? '' }));
  return { puntos, trampas, usd: res.usd };
}

export interface OpcionesJuicio {
  juez: ModeloJuez;
  /** Juez de las citas (por defecto el mismo). */
  juezCitas?: ModeloJuez;
  fuentes: Fuentes;
  titulos: Record<string, string>;
  mirador?: Mirador;
  sinCitas?: boolean;
}

export async function juzgarPregunta(p: Pregunta, r: RespuestaNormalizada, o: OpcionesJuicio): Promise<JuicioPregunta> {
  const [rub, cit] = await Promise.all([
    juzgarRubrica(p, r, o.juez, o.titulos),
    o.sinCitas ? Promise.resolve({ juicios: [], usd: 0 }) : juzgarCitas(r, p, o.fuentes, o.juezCitas ?? o.juez, o.mirador),
  ]);
  return {
    preguntaId: p.id, modo: r.modo, juez: o.juez.nombre,
    puntos: rub.puntos, trampas: rub.trampas, citas: cit.juicios,
    puntuacion: puntuar(p, rub.puntos, rub.trampas, cit.juicios),
    usdJuez: rub.usd + cit.usd,
  };
}
