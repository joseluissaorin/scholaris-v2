/**
 * Puertos falsos, deterministas y con latencia configurable, para probar la
 * búsqueda y las citas sin red. El embebedor entiende un pequeño diccionario
 * multilingüe de conceptos, así que «vigilancia» y «surveillance» se parecen.
 */
import type { Embebedor, EspacioVectorial, Juez, Modalidad, PiezaEmbebible, PreguntaJuez, Redactor, Reordenador, RespuestaJuez } from '@scholaris/nucleo';
import { normalizarVector } from '@scholaris/nucleo';
import { plegar, terminos } from '../../src/texto.js';

export const esperar = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

/** Concepto → palabra por idioma. Todas las formas cuentan como el mismo concepto. */
export const CONCEPTOS: Record<string, Record<string, string[]>> = {
  panoptico: { es: ['panoptico', 'panoptismo'], en: ['panopticon', 'panopticism'], fr: ['panoptique'], it: ['panopticon'], la: ['panopticum'], de: ['panoptikum'] },
  vigilancia: { es: ['vigilancia', 'vigilar', 'vigilaba'], en: ['surveillance', 'watch', 'watched'], fr: ['surveillance', 'surveiller'], it: ['sorveglianza'], la: ['custodia'], de: ['uberwachung'] },
  disciplina: { es: ['disciplina'], en: ['discipline'], fr: ['discipline'], it: ['disciplina'], la: ['disciplina'], de: ['disziplin'] },
  cuerpo: { es: ['cuerpo', 'cuerpos'], en: ['body', 'bodies'], fr: ['corps'], it: ['corpo'], la: ['corpus'], de: ['korper'] },
  poder: { es: ['poder'], en: ['power'], fr: ['pouvoir'], it: ['potere'], la: ['potestas'], de: ['macht'] },
  prision: { es: ['prision', 'carcel'], en: ['prison', 'jail'], fr: ['prison'], it: ['prigione', 'carcere'], la: ['carcer'], de: ['gefangnis'] },
  castigo: { es: ['castigo', 'castigar', 'suplicio', 'supliciado'], en: ['punishment', 'punish', 'torture'], fr: ['punition', 'supplice'], it: ['punizione', 'supplizio'], la: ['poena', 'supplicium'], de: ['strafe'] },
  fortuna: { es: ['fortuna'], en: ['fortune'], fr: ['fortune'], it: ['fortuna'], la: ['fortuna', 'fortunae'], de: ['fortuna', 'gluck'] },
  rueda: { es: ['rueda'], en: ['wheel'], fr: ['roue'], it: ['ruota'], la: ['rota', 'rotam'], de: ['rad'] },
  cosmos: { es: ['cosmos', 'universo', 'esferas', 'esfera'], en: ['cosmos', 'universe', 'spheres', 'sphere', 'heavens'], fr: ['cosmos', 'univers', 'spheres'], it: ['cosmo', 'universo', 'sfere'], la: ['mundus', 'sphaera'], de: ['kosmos', 'spharen'] },
  medieval: { es: ['medieval', 'medievales'], en: ['medieval'], fr: ['medieval'], it: ['medievale'], la: ['medii'], de: ['mittelalterlich'] },
  modelo: { es: ['modelo'], en: ['model'], fr: ['modele'], it: ['modello'], la: ['exemplar'], de: ['modell'] },
  cancion: { es: ['cancion', 'canciones'], en: ['song', 'songs'], fr: ['chanson'], it: ['canzone'], la: ['carmen', 'carmina'], de: ['lied'] },
  felicidad: { es: ['felicidad'], en: ['happiness'], fr: ['bonheur'], it: ['felicita'], la: ['beatitudo', 'beatitudinem', 'felicitas'], de: ['gluckseligkeit'] },
  dios: { es: ['dios'], en: ['god'], fr: ['dieu'], it: ['dio'], la: ['deus', 'deum', 'deo', 'dei'], de: ['gott'] },
  libertad: { es: ['libertad'], en: ['freedom', 'liberty'], fr: ['liberte'], it: ['liberta'], la: ['libertas', 'libertatem'], de: ['freiheit'] },
  censura: { es: ['censura'], en: ['censorship'], fr: ['censure'], it: ['censura'], la: ['censura'], de: ['zensur'] },
  diagrama: { es: ['diagrama', 'lamina', 'esquema'], en: ['diagram', 'plate', 'figure'], fr: ['diagramme'], it: ['diagramma'], la: ['figura'], de: ['diagramm'] },
  seleccion: { es: ['seleccion'], en: ['selection'], fr: ['selection'], it: ['selezione'], la: ['selectio'], de: ['selektion'] },
  especie: { es: ['especies', 'especie'], en: ['species'], fr: ['especes'], it: ['specie'], la: ['species'], de: ['arten'] },
  origen: { es: ['origen'], en: ['origin'], fr: ['origine'], it: ['origine'], la: ['origo'], de: ['ursprung'] },
  molino: { es: ['molinos', 'molino'], en: ['mills', 'windmills'], fr: ['moulins'], it: ['mulini'], la: ['molae'], de: ['muhlen'] },
  gigante: { es: ['gigantes', 'gigante'], en: ['giants'], fr: ['geants'], it: ['giganti'], la: ['gigantes'], de: ['riesen'] },
  luna: { es: ['luna'], en: ['moon'], fr: ['lune'], it: ['luna'], la: ['luna'], de: ['mond'] },
  espacio: { es: ['espacio'], en: ['space'], fr: ['espace'], it: ['spazio'], la: ['spatium'], de: ['weltraum'] },
  variacion: { es: ['variaciones', 'variacion'], en: ['variations', 'variation'], fr: ['variations'], it: ['variazioni'], la: ['variatio'], de: ['variationen'] },
  favorable: { es: ['favorables', 'favorable'], en: ['favourable', 'favorable'], fr: ['favorables'], it: ['favorevoli'], la: ['favorabilis'], de: ['gunstig'] },
  obediencia: { es: ['obediencia', 'docil', 'dociles', 'sometido', 'sometidos'], en: ['obedience', 'docile'], fr: ['obeissance', 'dociles'], it: ['obbedienza'], la: ['oboedientia'], de: ['gehorsam'] },
};

const FORMA_A_CONCEPTO = new Map<string, string>();
for (const [c, idiomas] of Object.entries(CONCEPTOS)) for (const formas of Object.values(idiomas)) for (const f of formas) FORMA_A_CONCEPTO.set(f, c);

export function concepto(t: string): string { return FORMA_A_CONCEPTO.get(t) ?? t; }

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export interface Contador { llamadas: number; piezas: number }

export class EmbebedorFalso implements Embebedor {
  readonly espacio: EspacioVectorial = { id: 'falso@96', proveedor: 'pruebas', modelo: 'falso', dims: 96, normalizado: true, modalidades: ['texto', 'imagen'] };
  readonly contador: Contador = { llamadas: 0, piezas: 0 };
  constructor(public latencia = 0) {}
  admite(m: Modalidad): boolean { return this.espacio.modalidades.includes(m); }
  vectorTexto(texto: string): Float32Array {
    const v = new Float32Array(this.espacio.dims);
    for (const t of terminos(texto)) {
      const c = concepto(t);
      const h = hash(c);
      // Los conceptos del diccionario pesan más que las palabras sueltas.
      const peso = FORMA_A_CONCEPTO.has(t) ? 2 : 0.6;
      v[h % this.espacio.dims]! += (h & 1 ? 1 : -1) * peso;
      v[(h >>> 8) % this.espacio.dims]! += (h & 2 ? 0.5 : -0.5) * peso;
    }
    return normalizarVector(v);
  }
  async vectorizar(piezas: PiezaEmbebible[], _tarea: 'documento' | 'consulta'): Promise<Float32Array[]> {
    this.contador.llamadas++;
    this.contador.piezas += piezas.length;
    await esperar(this.latencia);
    return piezas.map((p) => (p.modalidad === 'texto' ? this.vectorTexto(p.texto) : new Float32Array(this.espacio.dims)));
  }
}

export class ReordenadorFalso implements Reordenador {
  readonly nombre = 'reordenador-falso';
  readonly contador: Contador = { llamadas: 0, piezas: 0 };
  constructor(public latencia = 0) {}
  async reordenar(consulta: string, textos: string[]): Promise<number[]> {
    this.contador.llamadas++;
    this.contador.piezas += textos.length;
    await esperar(this.latencia);
    const q = new Set(terminos(consulta).map(concepto));
    return textos.map((t) => {
      const ts = terminos(t).map(concepto);
      let n = 0;
      for (const x of new Set(ts)) if (q.has(x)) n++;
      return q.size ? n / q.size : 0;
    });
  }
}

/**
 * Juez falso: «apoyo» por solape de conceptos entre afirmación y pasaje; la
 * relación CONTRADICCION si el pasaje niega lo que afirma la afirmación.
 */
export class JuezFalso implements Juez {
  readonly nombre = 'juez-falso';
  readonly contador: Contador = { llamadas: 0, piezas: 0 };
  readonly estados: unknown[] = [];
  constructor(public latencia = 0) {}
  async juzgar(estado: unknown, preguntas: Record<string, PreguntaJuez>): Promise<Record<string, RespuestaJuez>> {
    this.contador.llamadas++;
    this.contador.piezas += Object.keys(preguntas).length;
    this.estados.push(estado);
    await esperar(this.latencia);
    const salida: Record<string, RespuestaJuez> = {};
    const leer = (ruta: string): string => {
      let x: unknown = estado;
      for (const p of ruta.replace(/\[(\d+)\]/g, '.$1').split('.')) x = (x as Record<string, unknown>)?.[p];
      return typeof x === 'string' ? x : JSON.stringify(x ?? '');
    };
    for (const [id, p] of Object.entries(preguntas)) {
      const rutas = [...p.instrucciones.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
      const textos = rutas.map(leer);
      const [a = '', b = ''] = rutas.length >= 2 ? [textos[1] ?? '', textos[0] ?? ''] : [textos[0] ?? '', ''];
      const ca = new Set(terminos(a).map(concepto)), cb = new Set(terminos(b).map(concepto));
      let n = 0;
      for (const x of ca) if (cb.has(x)) n++;
      const sol = ca.size && cb.size ? n / Math.min(ca.size, cb.size) : 0;
      const niega = /\b(no|not|never|nunca|ningun|nothing)\b/.test(plegar(a)) !== /\b(no|not|never|nunca|ningun|nothing)\b/.test(plegar(b));
      if (p.tipo === 'si_no') salida[id] = { tipo: 'si_no', probabilidad: Math.max(0.02, Math.min(0.97, sol * 1.3)) };
      else if (p.tipo === 'eleccion') {
        const opciones = Object.keys(p.opciones);
        const eleccion = niega && sol > 0.3 && opciones.includes('CONTRADICCION') ? 'CONTRADICCION' : sol > 0.45 ? 'APOYO_DIRECTO' : opciones.includes('CONTEXTO') ? 'CONTEXTO' : opciones[0]!;
        salida[id] = { tipo: 'eleccion', eleccion, probabilidades: Object.fromEntries(opciones.map((o) => [o, o === eleccion ? 0.8 : 0.2 / Math.max(1, opciones.length - 1)])) };
      } else salida[id] = { tipo: 'escala', valor: sol, probabilidades: [1 - sol, sol] };
    }
    return salida;
  }
}

type Peticion = Parameters<Redactor['generar']>[0];

/** Traducción palabra a palabra con el diccionario de conceptos. */
export function traducir(texto: string, idioma: string): string {
  return terminos(texto).map((t) => CONCEPTOS[concepto(t)]?.[idioma]?.[0] ?? t).join(' ');
}

export class RedactorFalso implements Redactor {
  readonly nombre = 'redactor-falso';
  readonly contador: Contador = { llamadas: 0, piezas: 0 };
  readonly peticiones: Peticion[] = [];
  /** Respuestas a medida por tarea (se detecta por el texto del sistema). */
  manejadores: Array<{ si: RegExp; responder: (p: Peticion) => { texto: string; json?: unknown } }> = [];
  fallar = false;
  constructor(public latencia = 0) {}

  async generar<T>(p: Peticion): Promise<{ texto: string; json?: T }> {
    this.contador.llamadas++;
    this.peticiones.push(p);
    await esperar(this.latencia);
    if (this.fallar) throw new Error('redactor caído');
    const sistema = p.sistema ?? '';
    for (const m of this.manejadores) if (m.si.test(sistema)) return m.responder(p) as { texto: string; json?: T };
    const usuario = p.mensajes.map((m) => m.partes.map((x) => ('texto' in x ? x.texto : '')).join('')).join('\n');
    if (/comprensión de consultas/.test(sistema)) {
      const e = JSON.parse(usuario) as { consulta: string; traducir_a: string[]; autores_en_la_biblioteca: string[] };
      const q = e.consulta;
      const pq = plegar(q);
      const traducciones = Object.fromEntries(e.traducir_a.map((i) => [i, traducir(q, i)]));
      const autores = e.autores_en_la_biblioteca.filter((a) => pq.includes(plegar(a)));
      const json = {
        intencion: /lamina|diagrama|imagen/.test(pq) ? 'visual' : 'conceptual',
        idioma: 'es',
        parafrasis: [terminos(q).reverse().join(' ')],
        enunciado: q.endsWith('?') ? q.replace(/^¿|\?$/g, '') : null,
        hyde: `Un pasaje académico sobre ${terminos(q).join(', ')}.`,
        traducciones,
        filtros: { autores, anioDesde: null, anioHasta: null, idiomas: [], tipos: [] },
      };
      return { texto: JSON.stringify(json), json: json as T };
    }
    if (/asistente de una biblioteca/.test(sistema)) {
      const primer = usuario.match(/\[F1\][^\n]*\n([^\n]+)/)?.[1] ?? '';
      const literal = primer.split(/[.:;]/)[0]!.trim();
      const texto = `Según el primer pasaje, «${literal}» [F1]. También lo confirma el segundo [F2, F1].\n\nEsto lo dice otro pasaje [F99] y un fragmento inventado [frinventado]. Y «una frase que no existe en ningún pasaje del contexto» [F2].`;
      return { texto };
    }
    return { texto: '{}', json: {} as T };
  }
}

/** Redactor falso con streaming: trocea la respuesta en pedazos de 7 caracteres. */
export class RedactorFalsoConFlujo extends RedactorFalso {
  async *generarFlujo(p: Peticion): AsyncIterable<string> {
    const { texto } = await this.generar(p);
    for (let i = 0; i < texto.length; i += 7) yield texto.slice(i, i + 7);
  }
}
