/**
 * Autocita: el texto del usuario → afirmaciones → candidatos de la biblioteca →
 * propuestas del redactor (SOLO entre candidatos) → verificación en código
 * (cronología, cita literal, términos clave) → verificación con el juez por
 * lotes (respaldo sí/no + relación) → CitaVerificada[] por afirmación.
 *
 * Ninguna cita sale de lo que diga el modelo: el documento, el ancla y el pasaje
 * se toman del fragmento recuperado; el modelo solo elige entre candidatos.
 */
import type { Buscador } from '@scholaris/busqueda';
import { contieneLiteral, pasajeSiResponde, plegar, terminos } from '@scholaris/busqueda';
import type { Ancla, CitaVerificada, Filtros, Fragmento, Juez, MetadatosDocumento, PreguntaJuez, Redactor, RelacionCita, Resultado } from '@scholaris/nucleo';
import { anclaACita, enParalelo } from '@scholaris/nucleo';
import { MotorCitas } from './csl/motor.js';
import type { DocumentoCitable } from './csl/mapeo.js';
import { dividirAfirmaciones, dividirParrafos, puntoDeInsercion, type Afirmacion, type Parrafo } from './segmentar.js';
import { analizarTemporal, detectarAfirmacionNegativa, terminosClaveAusentes, type AnalisisTemporal } from './temporal.js';

export type EstadoCita = 'aceptada' | 'revisar' | 'descartada';

/** Una cita propuesta y verificada para una afirmación. */
export interface CitaPropuesta extends CitaVerificada {
  id: string;
  estado: EstadoCita;
  /** Hay algo que un humano debería mirar (aunque esté aceptada). */
  revisar: boolean;
  motivos: string[];
  /** Lo que propuso el redactor antes de verificar. */
  relacionPropuesta: RelacionCita;
  confianzaRedactor: number;
  /** Probabilidades de relación del juez. */
  relaciones?: Partial<Record<RelacionCita, number>>;
  /** Cita literal del pasaje que eligió el redactor (verificada). */
  evidencia?: string;
  /** Para aplicaciones de marco: frase reescrita con la atribución. */
  reescritura?: string;
  temporal?: AnalisisTemporal;
  documentoMetadatos: MetadatosDocumento;
  tipoDocumento: DocumentoCitable['tipo'];
}

export interface AfirmacionCitada extends Afirmacion {
  citas: CitaPropuesta[];
  /** Afirmación negativa («X no menciona Y»). */
  negativa?: string;
}

/** Forma del contrato de la API (packages/contrato): una propuesta por afirmación. */
export interface PropuestaCita {
  id: string;
  parrafo: number;
  /** Rango de la afirmación en el texto. */
  desde: number;
  hasta: number;
  /** Punto exacto donde va la cita según el estilo. */
  insercion: number;
  afirmacion: string;
  cita: CitaVerificada;
  textoCita: string;
  estado: EstadoCita;
  motivos: string[];
  reescritura?: string;
  alternativas?: CitaVerificada[];
}

export interface ResultadoAutocita {
  texto: string;
  parrafos: string[];
  afirmaciones: AfirmacionCitada[];
  propuestas: PropuestaCita[];
  bibliografia: string[];
  estilo: string;
  estadisticas: { afirmaciones: number; propuestas: number; aceptadas: number; revisar: number; descartadas: number; inventadas: number; llamadasJuez: number; ms: number };
  avisos: string[];
}

export type EventoAutocita =
  | { fase: 'segmentacion'; parrafos: number; afirmaciones: number }
  | { fase: 'recuperacion' | 'propuesta'; hechos: number; total: number }
  | { fase: 'verificacion'; hechos: number; total: number }
  | { fase: 'listo'; ms: number };

export interface OpcionesAutocita {
  filtros?: Filtros;
  estilo?: string;
  idioma?: string;
  /** Respaldo mínimo para aceptar (0,7). */
  umbral?: number;
  /** Respaldo mínimo para proponer con revisión (0,4). */
  umbralRevisar?: number;
  maxPorAfirmacion?: number;
  maxPorParrafo?: number;
  /** Candidatos por párrafo (14). */
  candidatos?: number;
  /** Pares afirmación-pasaje por llamada al juez (8). */
  loteJuez?: number;
  /** Párrafos en paralelo (3). */
  paralelo?: number;
  /** Año del texto del usuario (para la lógica temporal; por defecto, el actual). */
  anioTexto?: number;
  alProgreso?: (e: EventoAutocita) => void;
}

export interface PuertosAutocita {
  buscador: Buscador;
  redactor: Redactor;
  juez?: Juez;
}

const RELACIONES_REDACTOR: RelacionCita[] = ['APOYO_DIRECTO', 'APLICACION_DE_MARCO', 'CONTEXTO', 'CONTRIBUCION_PROPIA', 'CONTRADICCION', 'OPINION_REFERIDA', 'AFIRMACION_NEGATIVA'];

const ESQUEMA_PROPUESTAS = {
  type: 'object',
  properties: {
    citas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          afirmacion: { type: 'string', description: 'Etiqueta de la afirmación, p. ej. «A1.2».' },
          candidato: { type: 'string', description: 'Etiqueta del pasaje candidato, p. ej. «C3».' },
          relacion: { type: 'string', enum: RELACIONES_REDACTOR },
          evidencia: { type: 'string', description: 'Frase copiada literalmente del pasaje que sostiene la afirmación.' },
          confianza: { type: 'number' },
          reescritura: { type: ['string', 'null'] },
        },
        required: ['afirmacion', 'candidato', 'relacion', 'confianza'],
      },
    },
  },
  required: ['citas'],
} as const;

const SISTEMA = `Eres un asistente de citación académica. Para cada afirmación numerada del texto del usuario decides qué pasajes candidatos de su biblioteca la sostienen.
Reglas:
1. SOLO puedes proponer candidatos de la lista (C1, C2…). No inventes autores, obras ni páginas: el sistema imprime la referencia a partir del pasaje elegido.
2. Antes de proponer, comprueba la implicación: ¿el pasaje dice realmente lo que afirma el texto? Si solo trata el mismo tema, la relación es CONTEXTO, nunca APOYO_DIRECTO.
3. Relaciones: APOYO_DIRECTO (el pasaje lo dice o lo implica), APLICACION_DE_MARCO (el texto aplica un concepto del autor a un ámbito nuevo: añade en «reescritura» la frase reescrita atribuyendo el concepto al autor, sin poner la cita), CONTEXTO (fondo general), CONTRIBUCION_PROPIA (idea del usuario: no se cita), CONTRADICCION (el pasaje dice lo contrario: indícalo siempre, es lo más valioso), OPINION_REFERIDA (el texto atribuye una opinión a alguien a través de esta fuente), AFIRMACION_NEGATIVA (el texto dice que algo NO está o NO ocurre y el pasaje solo habla de lo que sí).
4. «evidencia» es una frase COPIADA LITERALMENTE del pasaje, sin cambiar ni una letra.
5. No juzgues la cronología: el sistema la comprueba con los años de los metadatos.
6. Como mucho tres candidatos por afirmación. Si ninguna afirmación necesita cita, devuelve {"citas": []}.
Devuelve solo JSON.`;

const ahora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Pasajes que no deben citarse: índices, tablas de contenido. */
export function esParatextual(f: Fragmento): boolean {
  if (f.seccion.some((s) => /^(índice|indice|contents|table of contents|sommaire|table des matières|indice generale|inhaltsverzeichnis)$/i.test(s.trim()))) return true;
  const lineas = f.texto.split(/\n|(?<=\d)\.\s+(?=[IVXLC]+\.)/).map((l) => l.trim()).filter(Boolean);
  const toc = lineas.filter((l) => /^(?:[ivxlcdm]+\.?|\d+\.?)\s+.+\s+\d+\.?$/i.test(l)).length;
  if (lineas.length > 1 && toc / lineas.length > 0.5) return true;
  // «I. Suplicio 11. II. Castigo 77…»: muchas parejas título-número en una línea.
  return (f.texto.match(/\b[\p{L}]+\s+\d{1,4}\./gu) ?? []).length >= 3 && f.texto.length < 300;
}

function anioDe(m: MetadatosDocumento): number | undefined { return m.anioOriginal ?? m.anio; }

interface Candidato { etiqueta: string; resultado: Resultado }

interface Propuesta {
  afirmacion: Afirmacion;
  candidato: Candidato;
  relacion: RelacionCita;
  confianza: number;
  evidencia?: string;
  reescritura?: string;
}

/** Recupera candidatos para un párrafo: búsqueda del párrafo + búsquedas por afirmación (vectores en una llamada). */
async function recuperar(buscador: Buscador, parrafo: Parrafo, afirmaciones: Afirmacion[], opciones: OpcionesAutocita): Promise<Resultado[]> {
  const k = opciones.candidatos ?? 14;
  const textos = afirmaciones.map((a) => a.texto);
  // Precalienta la caché de vectores de consulta: una sola llamada al embebedor.
  await buscador.vectorizarConsultas([parrafo.texto.slice(0, 1500), ...textos]).catch(() => []);
  const busquedas = await Promise.all([
    buscador.buscar(parrafo.texto.slice(0, 1500), { filtros: opciones.filtros, limite: k, comprender: false }),
    ...textos.map((t) => buscador.buscar(t, { filtros: opciones.filtros, limite: 5, comprender: false, reordenar: false })),
  ]);
  const vistos = new Map<string, Resultado>();
  // Intercala: los mejores de cada búsqueda primero.
  for (let i = 0; i < k * 2 && vistos.size < k; i++) {
    for (const b of busquedas) {
      const r = b.resultados[i];
      if (r && !vistos.has(r.fragmento.id) && !esParatextual(r.fragmento)) vistos.set(r.fragmento.id, r);
    }
  }
  return [...vistos.values()].slice(0, k);
}

function describirCandidato(c: Candidato): string {
  const m = c.resultado.documento.metadatos;
  const autores = m.autores.map((a) => a.apellidos).join('; ') || (m.editores ?? []).map((a) => a.apellidos).join('; ') || 's. a.';
  const anio = anioDe(m);
  return `[${c.etiqueta}] ${autores} (${anio ?? 's. f.'}), «${m.titulo}», ${anclaACita(c.resultado.fragmento.ancla, c.resultado.fragmento.anclaFin)}\n${c.resultado.fragmento.texto}`;
}

/** Pide al redactor propuestas para un párrafo y descarta todo lo que no esté en la lista. */
async function proponer(redactor: Redactor, texto: string, parrafo: Parrafo, afirmaciones: Afirmacion[], resultados: Resultado[], inventadas: { n: number }, avisos: string[]): Promise<Propuesta[]> {
  if (!afirmaciones.length || !resultados.length) return [];
  const candidatos: Candidato[] = resultados.map((r, i) => ({ etiqueta: `C${i + 1}`, resultado: r }));
  const porEtiqueta = new Map(candidatos.map((c) => [c.etiqueta, c]));
  const porAfirmacion = new Map(afirmaciones.map((a) => [a.id, a]));
  const contextoDoc = texto.length > 4000 ? `${texto.slice(0, 2000)}\n[…]\n${texto.slice(-1000)}` : texto;
  const mensaje = `CONTEXTO DEL DOCUMENTO:\n${contextoDoc}\n\nPÁRRAFO ${parrafo.indice + 1}:\n${parrafo.texto}\n\nAFIRMACIONES:\n${afirmaciones.map((a) => `[${a.id}] ${a.texto}`).join('\n')}\n\nPASAJES CANDIDATOS:\n\n${candidatos.map(describirCandidato).join('\n\n')}`;
  let salida: { citas?: Array<{ afirmacion?: string; candidato?: string; relacion?: string; evidencia?: string; confianza?: number; reescritura?: string | null }> };
  try {
    const r = await redactor.generar<typeof salida>({
      sistema: SISTEMA,
      mensajes: [{ rol: 'usuario', partes: [{ texto: mensaje }] }],
      esquema: ESQUEMA_PROPUESTAS as unknown as Record<string, unknown>,
      temperatura: 0.1,
      maxTokens: 3000,
      calidad: 'alta',
    });
    salida = r.json ?? JSON.parse(r.texto.slice(r.texto.indexOf('{'), r.texto.lastIndexOf('}') + 1));
  } catch (e) {
    avisos.push(`Párrafo ${parrafo.indice + 1}: el redactor falló (${(e as Error).message}).`);
    return [];
  }
  const propuestas: Propuesta[] = [];
  for (const c of salida.citas ?? []) {
    const a = porAfirmacion.get(String(c.afirmacion ?? '').trim());
    const cand = porEtiqueta.get(String(c.candidato ?? '').trim().toUpperCase().replace(/^\[|\]$/g, ''));
    if (!a || !cand) { inventadas.n++; continue; } // inventada: no está en la lista
    const relacion = (RELACIONES_REDACTOR as string[]).includes(String(c.relacion)) ? (c.relacion as RelacionCita) : 'CONTEXTO';
    if (relacion === 'CONTRIBUCION_PROPIA') continue;
    if (propuestas.some((p) => p.afirmacion.id === a.id && p.candidato.etiqueta === cand.etiqueta)) continue;
    propuestas.push({
      afirmacion: a, candidato: cand, relacion,
      confianza: typeof c.confianza === 'number' ? Math.max(0, Math.min(1, c.confianza > 1 ? c.confianza / 100 : c.confianza)) : 0.5,
      ...(c.evidencia ? { evidencia: c.evidencia.trim() } : {}),
      ...(c.reescritura ? { reescritura: c.reescritura.trim() } : {}),
    });
  }
  return propuestas;
}

const OPCIONES_JUEZ: Record<string, string> = {
  APOYO_DIRECTO: 'The passage directly states the claim or logically entails it.',
  APLICACION_DE_MARCO: "The claim applies a concept or framework from the passage to a new domain the passage does not discuss.",
  CONTEXTO: 'The passage is on the same topic and gives background, but does not establish this specific claim.',
  CONTRADICCION: 'The passage states the opposite of the claim or gives a different fact, number, date or name.',
  OPINION_REFERIDA: "The claim reports someone's view, and the passage is where that view is stated or reported.",
  AFIRMACION_NEGATIVA: 'The claim says something is absent or does not happen, while the passage only discusses what is present.',
};

/** Verifica las propuestas con el juez, por lotes y en paralelo. */
async function verificarConJuez(juez: Juez, propuestas: Propuesta[], lote: number, alProgreso?: (hechos: number) => void): Promise<{ resultados: Array<{ respaldo: number; relaciones: Record<string, number>; eleccion: string } | undefined>; llamadas: number }> {
  const lotes: Propuesta[][] = [];
  for (let i = 0; i < propuestas.length; i += lote) lotes.push(propuestas.slice(i, i + lote));
  let hechos = 0;
  const salida = await enParalelo(lotes, 4, async (grupo) => {
    const pares = grupo.map((p) => {
      const m = p.candidato.resultado.documento.metadatos;
      return { afirmacion: p.afirmacion.texto, pasaje: p.candidato.resultado.fragmento.texto, fuente: { autores: m.autores.map((a) => a.apellidos).join('; '), titulo: m.titulo } };
    });
    const preguntas: Record<string, PreguntaJuez> = {};
    grupo.forEach((_, i) => {
      preguntas[`apoyo${i}`] = {
        tipo: 'si_no',
        instrucciones: `Does the passage \`pares[${i}].pasaje\` support the claim \`pares[${i}].afirmacion\`, so that a skeptical reader checking the citation would agree the source says it?`,
        criterios: { si: 'The passage states or clearly entails the claim.', no: 'The passage only shares the topic, says something different, or contradicts the claim.' },
      };
      preguntas[`relacion${i}`] = {
        tipo: 'eleccion',
        instrucciones: `How does the passage \`pares[${i}].pasaje\` relate to the claim \`pares[${i}].afirmacion\`?`,
        opciones: OPCIONES_JUEZ,
      };
    });
    try {
      const r = await juez.juzgar({ tarea: 'Comprobar citas académicas: cada par une una afirmación de un texto con un pasaje de la fuente propuesta.', pares }, preguntas);
      hechos += grupo.length;
      alProgreso?.(hechos);
      return grupo.map((_, i) => {
        const a = r[`apoyo${i}`], e = r[`relacion${i}`];
        if (!a || a.tipo !== 'si_no') return undefined;
        return { respaldo: a.probabilidad, relaciones: e?.tipo === 'eleccion' ? e.probabilidades : {}, eleccion: e?.tipo === 'eleccion' ? e.eleccion : '' };
      });
    } catch {
      return grupo.map(() => undefined);
    }
  });
  return { resultados: salida.flat(), llamadas: lotes.length };
}

/** Une citas de la misma afirmación y el mismo documento en páginas cercanas (±3) en un rango. */
export function fundirRangos(citas: CitaPropuesta[]): CitaPropuesta[] {
  const fuera = new Set<CitaPropuesta>();
  const porDoc = new Map<string, CitaPropuesta[]>();
  for (const c of citas) {
    if (c.ancla.tipo !== 'pagina' || c.estado === 'descartada') continue;
    const l = porDoc.get(c.documento) ?? [];
    l.push(c);
    porDoc.set(c.documento, l);
  }
  for (const grupo of porDoc.values()) {
    if (grupo.length < 2) continue;
    grupo.sort((a, b) => (a.ancla as { fisica: number }).fisica - (b.ancla as { fisica: number }).fisica);
    let racha: CitaPropuesta[] = [grupo[0]!];
    const cerrar = () => {
      if (racha.length >= 2) {
        const mejor = racha.reduce((a, b) => (b.respaldo > a.respaldo ? b : a));
        const ultimo = racha[racha.length - 1]!;
        // El final se lee ANTES de mover el ancla: si el mejor es el último, su ancla se pisa
        // y la cita se quedaba en la primera página sin la del pasaje (banco de calidad, c030 y c041).
        const fin = ultimo.anclaFin ?? ultimo.ancla;
        mejor.ancla = racha[0]!.ancla;
        if ((fin as { fisica: number }).fisica !== (mejor.ancla as { fisica: number }).fisica) mejor.anclaFin = fin;
        mejor.pasaje = racha.map((c) => c.pasaje).join(' […] ');
        for (const c of racha) if (c !== mejor) fuera.add(c);
      }
    };
    for (let i = 1; i < grupo.length; i++) {
      const prev = racha[racha.length - 1]!, c = grupo[i]!;
      // Solo páginas consecutivas, cada una con un pasaje verificado: un hueco no se cubre con un rango
      // («pp. 10-13» citaría páginas que nadie ha comprobado); esas van como citas separadas.
      if ((c.ancla as { fisica: number }).fisica - ((prev.anclaFin ?? prev.ancla) as { fisica: number }).fisica <= 1) racha.push(c);
      else { cerrar(); racha = [c]; }
    }
    cerrar();
  }
  return citas.filter((c) => !fuera.has(c));
}

/**
 * Lo que se cita de un candidato: las oraciones del fragmento que sostienen la
 * afirmación (la evidencia literal del redactor, si la hay, manda), con la
 * página o el segundo de esas oraciones. Si ninguna oración casa de verdad, el
 * fragmento entero con su ancla: mejor largo que señalar la frase equivocada.
 */
export async function pasajeDeCita(buscador: Pick<Buscador, 'anclarPasajes'>, r: Resultado, afirmacion: string, evidencia?: string): Promise<{ texto: string; ancla: Ancla; anclaFin?: Ancla }> {
  const entero = { texto: r.fragmento.texto, ancla: r.fragmento.ancla, ...(r.fragmento.anclaFin ? { anclaFin: r.fragmento.anclaFin } : {}) };
  const ts = [...new Set([...terminos(evidencia ?? ''), ...terminos(afirmacion)])];
  const p = ts.length ? pasajeSiResponde(r.fragmento.texto, ts) : null;
  if (!p) return entero;
  const x: Resultado = { ...r, pasaje: p };
  try { await buscador.anclarPasajes([x]); } catch { /* vale el ancla del fragmento */ }
  const q = x.pasaje!;
  if (q.ancla) return { texto: q.texto, ancla: q.ancla, ...(q.anclaFin ? { anclaFin: q.anclaFin } : {}) };
  return { ...entero, texto: q.texto };
}

const ORDEN_ESTADO: Record<EstadoCita, number> = { aceptada: 0, revisar: 1, descartada: 2 };

/** Autocita completa sobre un texto. */
export async function autocitar(texto: string, puertos: PuertosAutocita, opciones: OpcionesAutocita = {}): Promise<ResultadoAutocita> {
  const t0 = ahora();
  const umbral = opciones.umbral ?? 0.7, umbralRevisar = opciones.umbralRevisar ?? 0.4;
  const avisos: string[] = [];
  const inventadas = { n: 0 };
  const parrafos = dividirParrafos(texto);
  const afirmacionesPorParrafo = parrafos.map((p) => dividirAfirmaciones(p));
  const todas = afirmacionesPorParrafo.flat();
  opciones.alProgreso?.({ fase: 'segmentacion', parrafos: parrafos.length, afirmaciones: todas.length });

  // 1-2. Recuperación y propuestas, por párrafos en paralelo.
  let hechos = 0;
  const propuestasPorParrafo = await enParalelo(parrafos, opciones.paralelo ?? 3, async (p, i) => {
    const afirmaciones = (afirmacionesPorParrafo[i] ?? []).filter((a) => !a.yaCitada);
    if (!afirmaciones.length) return [];
    const candidatos = await recuperar(puertos.buscador, p, afirmaciones, opciones).catch((e) => { avisos.push(`Párrafo ${i + 1}: búsqueda fallida (${(e as Error).message}).`); return []; });
    const r = await proponer(puertos.redactor, texto, p, afirmaciones, candidatos, inventadas, avisos);
    opciones.alProgreso?.({ fase: 'propuesta', hechos: ++hechos, total: parrafos.length });
    return r;
  });
  const propuestas = propuestasPorParrafo.flat();

  // 3. Verificación en código.
  const anioTexto = opciones.anioTexto ?? new Date().getFullYear();
  const previas = propuestas.map((p) => {
    const motivos: string[] = [];
    const r = p.candidato.resultado;
    const m = r.documento.metadatos;
    const anio = anioDe(m);
    let relacion = p.relacion;
    const temporal = analizarTemporal(p.afirmacion.texto, anio, relacion, [...m.autores, ...(m.editores ?? [])].map((a) => a.apellidos));
    if (anio !== undefined && anio > anioTexto) { temporal.imposible = true; temporal.aviso = `La fuente (${anio}) es posterior al texto (${anioTexto}).`; }
    let evidencia = p.evidencia;
    if (evidencia && !contieneLiteral(r.fragmento.texto, evidencia)) {
      motivos.push('La evidencia que dio el redactor no aparece literalmente en el pasaje.');
      evidencia = undefined;
    }
    const negativa = detectarAfirmacionNegativa(p.afirmacion.texto);
    if (negativa && relacion === 'APOYO_DIRECTO') relacion = 'AFIRMACION_NEGATIVA';
    const ausentes = terminosClaveAusentes(p.afirmacion.texto, r.fragmento.texto);
    if (ausentes.length) motivos.push(`Términos de la afirmación ausentes del pasaje: ${ausentes.slice(0, 5).join(', ')}.`);
    return { p, relacion, temporal, evidencia, negativa, motivos };
  });

  // 4. Juez por lotes (lo temporalmente imposible no se pregunta).
  const aJuzgar = previas.filter((x) => !x.temporal.imposible);
  let llamadasJuez = 0;
  const veredictos = new Map<(typeof previas)[number], { respaldo: number; relaciones: Record<string, number>; eleccion: string }>();
  if (puertos.juez && aJuzgar.length) {
    const r = await verificarConJuez(puertos.juez, aJuzgar.map((x) => x.p), opciones.loteJuez ?? 8, (n) => opciones.alProgreso?.({ fase: 'verificacion', hechos: n, total: aJuzgar.length }));
    llamadasJuez = r.llamadas;
    aJuzgar.forEach((x, i) => { const v = r.resultados[i]; if (v) veredictos.set(x, v); });
  } else if (aJuzgar.length) avisos.push('Sin juez: las citas se proponen con la confianza del redactor y quedan para revisar.');

  // 5. Decisión. Lo que se cita es el pasaje de cada candidato (sus oraciones, con su página).
  const pasajes = new Map(await Promise.all(previas.map(async (x) => [x, await pasajeDeCita(puertos.buscador, x.p.candidato.resultado, x.p.afirmacion.texto, x.evidencia)] as const)));
  const citasPorAfirmacion = new Map<string, CitaPropuesta[]>();
  for (const x of previas) {
    const { p, temporal, motivos } = x;
    const r = p.candidato.resultado;
    const v = veredictos.get(x);
    let relacion: RelacionCita = x.relacion;
    let respaldo = v ? v.respaldo : p.confianza * 0.8;
    if (!v && !temporal.imposible) motivos.push(puertos.juez ? 'El juez no respondió.' : 'Sin verificación del juez.');
    if (v?.eleccion && v.eleccion in OPCIONES_JUEZ) {
      const juezRel = v.eleccion as RelacionCita;
      if (juezRel !== relacion) motivos.push(`El redactor propuso ${relacion} y el juez ve ${juezRel}.`);
      relacion = juezRel;
      if (Math.max(...Object.values(v.relaciones)) < 0.5) motivos.push('El juez duda sobre la relación.');
    }
    if (temporal.imposible) { relacion = 'IMPOSIBLE_TEMPORAL'; respaldo = 0; }
    else if (temporal.relacionSugerida === 'APLICACION_DE_MARCO' && relacion === 'APOYO_DIRECTO') relacion = 'APLICACION_DE_MARCO';
    if (temporal.aviso && !temporal.imposible) motivos.push(temporal.aviso);
    if (x.negativa && relacion === 'APOYO_DIRECTO') relacion = 'AFIRMACION_NEGATIVA';
    if (relacion === 'AFIRMACION_NEGATIVA') respaldo = Math.min(respaldo, 0.4);
    if (relacion === 'CONTEXTO') respaldo = Math.min(respaldo, 0.6);
    if (relacion === 'APLICACION_DE_MARCO' && !p.reescritura) motivos.push('Aplicación de marco sin reescritura que atribuya el concepto.');

    let estado: EstadoCita;
    if (relacion === 'IMPOSIBLE_TEMPORAL') { estado = 'descartada'; motivos.unshift(temporal.aviso ?? 'Cronología imposible.'); }
    else if (relacion === 'CONTRADICCION') { estado = 'revisar'; motivos.unshift('El pasaje contradice la afirmación.'); }
    else if (respaldo >= umbral) estado = 'aceptada';
    else if (respaldo >= umbralRevisar) estado = 'revisar';
    else estado = 'descartada';
    const revisar = estado === 'revisar' || (estado === 'aceptada' && motivos.length > 0);

    const ps = pasajes.get(x)!;
    const cita: CitaPropuesta = {
      id: `${p.afirmacion.id}:${r.fragmento.id}`,
      fragmento: r.fragmento.id, documento: r.documento.id, ancla: ps.ancla,
      ...(ps.anclaFin ? { anclaFin: ps.anclaFin } : {}),
      relacion, respaldo: Math.round(respaldo * 1000) / 1000, pasaje: ps.texto,
      estado, revisar, motivos, relacionPropuesta: p.relacion, confianzaRedactor: p.confianza,
      ...(v ? { relaciones: v.relaciones as Partial<Record<RelacionCita, number>> } : {}),
      ...(x.evidencia ? { evidencia: x.evidencia } : {}),
      ...(p.reescritura && relacion === 'APLICACION_DE_MARCO' ? { reescritura: p.reescritura } : {}),
      ...(temporal.banderas.length || temporal.imposible ? { temporal } : {}),
      documentoMetadatos: r.documento.metadatos, tipoDocumento: r.documento.tipo,
    };
    const l = citasPorAfirmacion.get(p.afirmacion.id) ?? [];
    l.push(cita);
    citasPorAfirmacion.set(p.afirmacion.id, l);
  }

  const max = opciones.maxPorAfirmacion ?? 3;
  const afirmaciones: AfirmacionCitada[] = todas.map((a) => {
    const citas = fundirRangos(citasPorAfirmacion.get(a.id) ?? [])
      .sort((x, y) => ORDEN_ESTADO[x.estado] - ORDEN_ESTADO[y.estado] || y.respaldo - x.respaldo);
    const vivas = citas.filter((c) => c.estado !== 'descartada').slice(0, max);
    const negativa = detectarAfirmacionNegativa(a.texto);
    return { ...a, citas: [...vivas, ...citas.filter((c) => c.estado === 'descartada')], ...(negativa ? { negativa } : {}) };
  });

  // 6. Propuestas (forma del contrato) con el texto de la cita en el estilo pedido.
  const motor = await MotorCitas.crear({ estilo: opciones.estilo ?? 'apa', idioma: opciones.idioma ?? 'es-ES' });
  const docs = new Map<string, DocumentoCitable>();
  for (const a of afirmaciones) for (const c of a.citas) docs.set(c.documento, { id: c.documento, tipo: c.tipoDocumento, metadatos: c.documentoMetadatos });
  motor.agregar([...docs.values()]);
  const porParrafo = new Map<number, number>();
  const conCita = afirmaciones.filter((a) => a.citas[0] && a.citas[0].estado !== 'descartada');
  const elegidas = conCita.filter((a) => {
    const n = porParrafo.get(a.parrafo) ?? 0;
    if (opciones.maxPorParrafo !== undefined && n >= opciones.maxPorParrafo) return false;
    porParrafo.set(a.parrafo, n + 1);
    return true;
  });
  const { citas: textosCita, bibliografia } = motor.citar(elegidas.map((a) => [aElemento(a.citas[0]!)]), 'texto');
  const modo = motor.esNotas ? 'nota' : 'autor-fecha';
  const propuestas2: PropuestaCita[] = elegidas.map((a, i) => {
    const c = a.citas[0]!;
    const alternativas = a.citas.slice(1).filter((x) => x.estado !== 'descartada').map(aCitaVerificada);
    return {
      id: c.id, parrafo: a.parrafo, desde: a.inicio, hasta: a.fin, insercion: puntoDeInsercion(texto, a.inicio, a.fin, modo),
      afirmacion: a.texto, cita: aCitaVerificada(c), textoCita: textosCita[i] ?? '', estado: c.estado, motivos: c.motivos,
      ...(c.reescritura ? { reescritura: c.reescritura } : {}),
      ...(alternativas.length ? { alternativas } : {}),
    };
  });

  const todasCitas = afirmaciones.flatMap((a) => a.citas);
  const ms = Math.round(ahora() - t0);
  opciones.alProgreso?.({ fase: 'listo', ms });
  if (inventadas.n) avisos.push(`Se descartaron ${inventadas.n} propuesta(s) del redactor que no correspondían a ningún candidato.`);
  return {
    texto, parrafos: parrafos.map((p) => p.texto), afirmaciones, propuestas: propuestas2, bibliografia, estilo: motor.estilo,
    estadisticas: {
      afirmaciones: todas.length, propuestas: propuestas.length,
      aceptadas: todasCitas.filter((c) => c.estado === 'aceptada').length,
      revisar: todasCitas.filter((c) => c.estado === 'revisar').length,
      descartadas: todasCitas.filter((c) => c.estado === 'descartada').length,
      inventadas: inventadas.n, llamadasJuez, ms,
    },
    avisos,
  };
}

export function aCitaVerificada(c: CitaPropuesta): CitaVerificada {
  return { fragmento: c.fragmento, documento: c.documento, ancla: c.ancla, ...(c.anclaFin ? { anclaFin: c.anclaFin } : {}), relacion: c.relacion, respaldo: c.respaldo, pasaje: c.pasaje };
}

export function aElemento(c: Pick<CitaVerificada, 'documento' | 'ancla' | 'anclaFin'>): { documento: string; ancla: CitaVerificada['ancla']; anclaFin?: CitaVerificada['ancla'] } {
  return { documento: c.documento, ancla: c.ancla, ...(c.anclaFin ? { anclaFin: c.anclaFin } : {}) };
}

// ---------------------------------------------------------------------------
// Verificar una afirmación suelta
// ---------------------------------------------------------------------------

export interface Verificacion {
  veredicto: 'respaldada' | 'parcial' | 'sin_respaldo' | 'contradicha';
  citas: Array<CitaVerificada & { etiqueta: string; citaCorta: string }>;
  relaciones?: Partial<Record<RelacionCita, number>>;
  ms: number;
}

/**
 * Verifica una afirmación contra la biblioteca (o contra unos fragmentos
 * concretos) sin pasar por el redactor: recuperación + juez + cronología.
 */
export async function verificarAfirmacion(
  afirmacion: string,
  puertos: { buscador: Buscador; juez: Juez },
  opciones: { fragmentos?: string[]; filtros?: Filtros; anioTexto?: number; k?: number; umbral?: number } = {},
): Promise<Verificacion> {
  const t0 = ahora();
  const k = opciones.k ?? 5;
  let resultados: Resultado[];
  if (opciones.fragmentos?.length) {
    const frags = await puertos.buscador.estanteria.fragmentos(opciones.fragmentos);
    const { porId } = await puertos.buscador.estanteria.documentos();
    resultados = opciones.fragmentos.map((id) => frags.get(id)).filter((f): f is Fragmento => !!f && porId.has(f.documento))
      .map((f) => ({ fragmento: f, documento: porId.get(f.documento)!, puntuacion: 1, vias: [] }));
  } else {
    resultados = (await puertos.buscador.buscar(afirmacion, { filtros: opciones.filtros, limite: k, comprender: false })).resultados.filter((r) => !esParatextual(r.fragmento));
  }
  const afirm: Afirmacion = { id: 'A', parrafo: 0, inicio: 0, fin: afirmacion.length, texto: afirmacion, yaCitada: false };
  const props: Propuesta[] = resultados.map((r, i) => ({ afirmacion: afirm, candidato: { etiqueta: `C${i + 1}`, resultado: r }, relacion: 'APOYO_DIRECTO', confianza: 0.5 }));
  const { resultados: v } = props.length ? await verificarConJuez(puertos.juez, props, 8) : { resultados: [] };
  const anioTexto = opciones.anioTexto ?? new Date().getFullYear();
  const pasajesV = await Promise.all(resultados.map((r) => pasajeDeCita(puertos.buscador, r, afirmacion)));
  const citas = resultados.map((r, i) => {
    const m = r.documento.metadatos;
    const anio = anioDe(m);
    const ver = v[i];
    let relacion = (ver?.eleccion && ver.eleccion in OPCIONES_JUEZ ? ver.eleccion : 'CONTEXTO') as RelacionCita;
    let respaldo = ver?.respaldo ?? 0;
    const t = analizarTemporal(afirmacion, anio, relacion, m.autores.map((a) => a.apellidos));
    if (t.imposible || (anio !== undefined && anio > anioTexto)) { relacion = 'IMPOSIBLE_TEMPORAL'; respaldo = 0; }
    else if (t.relacionSugerida === 'APLICACION_DE_MARCO' && relacion === 'APOYO_DIRECTO') relacion = 'APLICACION_DE_MARCO';
    const autores = m.autores.map((a) => a.apellidos).join(', ') || m.titulo;
    const ps = pasajesV[i]!;
    return {
      fragmento: r.fragmento.id, documento: r.documento.id, ancla: ps.ancla, ...(ps.anclaFin ? { anclaFin: ps.anclaFin } : {}),
      relacion, respaldo: Math.round(respaldo * 1000) / 1000, pasaje: ps.texto,
      etiqueta: `${autores}, «${m.titulo}»`,
      citaCorta: `(${m.autores[0]?.apellidos ?? m.titulo}, ${anio ?? 's. f.'}, ${anclaACita(ps.ancla, ps.anclaFin)})`,
      relaciones: ver?.relaciones as Partial<Record<RelacionCita, number>> | undefined,
    };
  }).sort((a, b) => b.respaldo - a.respaldo);
  const mejor = citas[0];
  const umbral = opciones.umbral ?? 0.7;
  const contradicha = citas.some((c) => c.relacion === 'CONTRADICCION' && (c.relaciones?.CONTRADICCION ?? 0) >= 0.5);
  const veredicto: Verificacion['veredicto'] = mejor && mejor.respaldo >= umbral && mejor.relacion === 'APOYO_DIRECTO' ? 'respaldada'
    : contradicha ? 'contradicha'
      : mejor && mejor.respaldo >= 0.4 ? 'parcial' : 'sin_respaldo';
  return {
    veredicto,
    citas: citas.map(({ relaciones: _r, ...c }) => c),
    ...(mejor?.relaciones ? { relaciones: mejor.relaciones } : {}),
    ms: Math.round(ahora() - t0),
  };
}

/** Normaliza para comparar afirmaciones (útil en pruebas e interfaces). */
export function claveAfirmacion(texto: string): string { return plegar(texto).replace(/\s+/g, ' ').trim(); }
