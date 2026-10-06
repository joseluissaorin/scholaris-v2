/**
 * Paso de hablantes: quién dice cada frase de un audio o un vídeo.
 *
 * La diarización del transcriptor se hace por tramos de 10 minutos y se
 * equivoca justo donde más importa: la pregunta corta del entrevistador queda
 * pegada a la respuesta («¿Eres un místico? Es inevitable…»), y las etiquetas
 * (H0, H1) no son las mismas de un tramo a otro. Aquí:
 *
 * 1. Se reconoce el reparto (quién habla y en qué papel) con una llamada al
 *    Redactor sobre muestras de toda la transcripción y los metadatos.
 * 2. Se reparte la transcripción en ventanas de frases y, en paralelo, el
 *    Redactor asigna cada frase a una persona del reparto, usando la etiqueta
 *    de la diarización como pista, las preguntas, los vocativos («Muchas gracias,
 *    Facundo») y la lógica de la conversación. Al trabajar con nombres, las voces
 *    quedan casadas entre tramos sin depender del solape.
 * 3. Las palabras reciben el nombre de su frase; los turnos consecutivos del
 *    mismo hablante se unen al cortar en unidades.
 */

import { enParalelo, reintentar, type MetadatosDocumento, type PalabraTranscrita, type Redactor } from '@scholaris/nucleo';
import type { Procedencia } from '../tipos.js';
import { nombreCompleto } from './autores.js';

export interface FraseIndexada {
  n: number;
  t0: number;
  t1: number;
  texto: string;
  etiqueta?: string;
  /** Índices [desde, hasta) de sus palabras. */
  desde: number;
  hasta: number;
}

export interface Persona {
  nombre: string;
  papel: string;
  /** Etiquetas de la diarización que suelen ser esta persona (pista). */
  etiquetas?: string[];
}

/**
 * Frases con sus palabras. Corta en puntuación final, en pausa larga y en
 * cambio de etiqueta (más fino de lo necesario: el Redactor vuelve a juntar).
 */
export function frasesIndexadas(palabras: PalabraTranscrita[]): FraseIndexada[] {
  const frases: FraseIndexada[] = [];
  const puntua = palabras.some((p) => /[.!?]["»”)]*$/.test(p.texto));
  let inicio = 0;
  const cerrar = (fin: number) => {
    if (fin <= inicio) return;
    const ws = palabras.slice(inicio, fin);
    const texto = ws.map((p) => p.texto.trim()).join(' ').replace(/\s+([,.;:!?…»”)])/g, '$1').replace(/([«“(¿¡])\s+/g, '$1');
    const etiquetas = new Map<string, number>();
    for (const w of ws) if (w.hablante) etiquetas.set(w.hablante, (etiquetas.get(w.hablante) ?? 0) + 1);
    const etiqueta = [...etiquetas].sort((a, b) => b[1] - a[1])[0]?.[0];
    frases.push({ n: frases.length, t0: (ws[0] as PalabraTranscrita).t0, t1: (ws.at(-1) as PalabraTranscrita).t1, texto, ...(etiqueta ? { etiqueta } : {}), desde: inicio, hasta: fin });
    inicio = fin;
  };
  for (let i = 0; i < palabras.length; i++) {
    const p = palabras[i] as PalabraTranscrita, sig = palabras[i + 1];
    const pausa = sig ? sig.t0 - p.t1 : 0;
    const fin = puntua ? /[.!?…]["»”)]*$/.test(p.texto) : pausa > 0.7;
    if (fin || pausa > 2.5 || (sig && sig.hablante !== p.hablante)) cerrar(i + 1);
  }
  cerrar(palabras.length);
  return frases;
}

const reloj = (t: number) => { const s = Math.round(t); return `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const linea = (f: FraseIndexada) => `${f.n} [${reloj(f.t0)}]${f.etiqueta ? ` (${f.etiqueta})` : ''} ${f.texto}`;

function fichaDe(m: MetadatosDocumento): string {
  const personas = [...(m.entrevistadores ?? []), ...m.autores];
  return [m.titulo && `«${m.titulo}»`, m.contenedor && m.contenedor !== m.titulo ? `(${m.contenedor})` : '', personas.length ? `con ${personas.map(nombreCompleto).join(', ')}` : '', m.anio ? `(${m.anio})` : '', m.resumen ?? ''].filter(Boolean).join(' ');
}

/** 1. El reparto: quién habla, con qué papel y qué etiquetas suelen ser suyas. */
export async function reconocerReparto(frases: FraseIndexada[], metadatos: MetadatosDocumento, redactor: Redactor): Promise<Persona[]> {
  // Muestras: el principio (presentaciones) y trozos repartidos por todo el medio.
  const muestras: FraseIndexada[] = [...frases.slice(0, 60)];
  for (let k = 1; k <= 6; k++) { const c = Math.floor((frases.length * k) / 7); muestras.push(...frases.slice(c, c + 15)); }
  muestras.push(...frases.slice(-20));
  const vistas = new Set<number>();
  const texto = muestras.filter((f) => !vistas.has(f.n) && vistas.add(f.n)).map(linea).join('\n');
  const r = await reintentar(() => redactor.generar<{ reparto: Array<{ nombre: string; papel: string; etiquetas?: string[] }> }>({
    sistema:
      'Identificas a las personas que hablan en una grabación (entrevista, programa, conferencia, debate). ' +
      'Das su nombre completo tal como se deduce del texto y de la ficha (si no se sabe, «Entrevistador», «Público», «Voz en off»…) y su papel: ' +
      'entrevistador, entrevistado, presentador, ponente, moderador, público, locutor, otro. ' +
      'Las etiquetas entre paréntesis (H0, H1…) vienen de una diarización automática por tramos: son una pista poco fiable; indica las que suelen corresponder a cada persona. ' +
      'Incluye solo a quien habla de verdad (no a quien se nombra).',
    mensajes: [{ rol: 'usuario', partes: [{ texto: `Ficha: ${fichaDe(metadatos)}\n\nMuestras de la transcripción (n [tiempo] (etiqueta) texto):\n${texto}` }] }],
    esquema: {
      type: 'object',
      properties: { reparto: { type: 'array', items: { type: 'object', properties: { nombre: { type: 'string' }, papel: { type: 'string' }, etiquetas: { type: 'array', items: { type: 'string' } } }, required: ['nombre', 'papel'] } } },
      required: ['reparto'],
    },
    temperatura: 0,
    maxTokens: 800,
    calidad: 'alta',
  }), { intentos: 3, base: 1500 });
  return (r.json?.reparto ?? []).filter((p) => p.nombre?.trim()).map((p) => ({ nombre: p.nombre.trim(), papel: p.papel?.trim() || 'otro', ...(p.etiquetas?.length ? { etiquetas: p.etiquetas } : {}) }));
}

/** 2. Asigna las frases de una ventana a personas del reparto. Devuelve n → nombre. */
export async function asignarVentana(
  ventana: FraseIndexada[],
  contexto: FraseIndexada[],
  reparto: Persona[],
  metadatos: MetadatosDocumento,
  redactor: Redactor,
): Promise<Map<number, string>> {
  const nombres = reparto.map((p) => p.nombre);
  const descripcion = reparto.map((p) => `- ${p.nombre}: ${p.papel}${p.etiquetas?.length ? ` (suele salir como ${p.etiquetas.join(', ')})` : ''}`).join('\n');
  const r = await reintentar(() => redactor.generar<{ turnos: Array<{ desde: number; hasta: number; hablante: string }> }>({
    sistema:
      'Atribuyes cada frase de una transcripción a quien la dice. Reglas:\n' +
      '1. Solo puedes usar nombres del reparto, escritos exactamente igual.\n' +
      '2. La etiqueta entre paréntesis es una diarización automática: casi siempre acierta en las frases largas, pero a menudo pega la pregunta corta del entrevistador a la respuesta del invitado, o al revés. Corrígela por el sentido.\n' +
      '3. En una entrevista, las preguntas al invitado, las presentaciones, los «muchas gracias», los vocativos dirigidos al invitado («¿Eres un místico?», «Cuéntanos, Julio…») son del entrevistador; quien habla de su propia vida, obra u opiniones es el invitado. Una respuesta no la dice quien hizo la pregunta.\n' +
      '4. Un turno no cambia a mitad de una frase; las frases seguidas del mismo hablante van en el mismo tramo.\n' +
      '5. Si suena una canción o un poema recitado, es de quien lo interpreta.\n' +
      'Devuelve tramos consecutivos {desde, hasta, hablante} que cubran TODAS las frases de la ventana, en orden.',
    mensajes: [{
      rol: 'usuario',
      partes: [{
        texto:
          `Ficha: ${fichaDe(metadatos)}\nReparto:\n${descripcion}\n\n` +
          (contexto.length ? `Contexto anterior (ya atribuido, no lo devuelvas):\n${contexto.map(linea).join('\n')}\n\n` : '') +
          `Ventana a atribuir (frases ${(ventana[0] as FraseIndexada).n}-${(ventana.at(-1) as FraseIndexada).n}):\n${ventana.map(linea).join('\n')}`,
      }],
    }],
    esquema: {
      type: 'object',
      properties: { turnos: { type: 'array', items: { type: 'object', properties: { desde: { type: 'integer' }, hasta: { type: 'integer' }, hablante: { type: 'string', enum: nombres } }, required: ['desde', 'hasta', 'hablante'] } } },
      required: ['turnos'],
    },
    temperatura: 0,
    maxTokens: 300 + ventana.length * 30,
    calidad: 'alta',
  }), { intentos: 3, base: 1500 });
  const salida = new Map<number, string>();
  const validos = new Set(nombres);
  for (const t of r.json?.turnos ?? []) {
    if (!validos.has(t.hablante)) continue;
    for (let n = t.desde; n <= t.hasta; n++) salida.set(n, t.hablante);
  }
  return salida;
}

export interface OpcionesHablantes {
  /** Frases por ventana. */
  ventana?: number;
  contexto?: number;
  concurrencia?: number;
  reloj?: () => number;
}

/**
 * Atribuye las palabras a personas con nombre. Devuelve palabras nuevas (con
 * `hablante` = nombre) y el reparto. Si algo falla, devuelve las palabras tal
 * cual: la diarización sigue valiendo como estaba.
 */
export async function atribuirHablantes(
  palabras: PalabraTranscrita[],
  metadatos: MetadatosDocumento,
  redactor: Redactor,
  opciones: OpcionesHablantes = {},
): Promise<{ palabras: PalabraTranscrita[]; reparto: Persona[]; procedencia: Procedencia }> {
  const reloj = opciones.reloj ?? Date.now;
  const t = reloj();
  const frases = frasesIndexadas(palabras);
  const etiquetas = new Set(frases.map((f) => f.etiqueta).filter(Boolean));
  const base = { fase: 'metadatos' as const, proveedor: `hablantes:${redactor.nombre}` };
  if (!frases.length) return { palabras, reparto: [], procedencia: { ...base, ms: 0, detalle: { frases: 0 } } };
  let reparto: Persona[] = [];
  try { reparto = await reconocerReparto(frases, metadatos, redactor); } catch { /* sin reparto, se queda la diarización */ }
  // Una sola persona y una sola etiqueta: no hay nada que atribuir más allá del nombre.
  if (reparto.length <= 1) {
    const nombre = reparto[0]?.nombre;
    const salida = nombre && etiquetas.size <= 1 ? palabras.map((p) => ({ ...p, hablante: nombre })) : palabras;
    return { palabras: salida, reparto, procedencia: { ...base, ms: reloj() - t, detalle: { frases: frases.length, reparto, ventanas: 0 } } };
  }
  const tam = opciones.ventana ?? 120, ctx = opciones.contexto ?? 8;
  const ventanas: FraseIndexada[][] = [];
  for (let i = 0; i < frases.length; i += tam) ventanas.push(frases.slice(i, i + tam));
  const asignado = new Map<number, string>();
  let fallidas = 0;
  await enParalelo(ventanas, opciones.concurrencia ?? 16, async (v) => {
    const desde = (v[0] as FraseIndexada).n;
    try {
      const m = await asignarVentana(v, frases.slice(Math.max(0, desde - ctx), desde), reparto, metadatos, redactor);
      for (const [n, h] of m) asignado.set(n, h);
    } catch { fallidas++; }
  });
  // Huecos (frases que el modelo no devolvió o ventanas fallidas): la etiqueta, por su persona más habitual.
  const porEtiqueta = new Map<string, Map<string, number>>();
  for (const f of frases) {
    const h = asignado.get(f.n);
    if (!h || !f.etiqueta) continue;
    const m = porEtiqueta.get(f.etiqueta) ?? new Map<string, number>();
    m.set(h, (m.get(h) ?? 0) + f.hasta - f.desde);
    porEtiqueta.set(f.etiqueta, m);
  }
  const deEtiqueta = (e?: string) => (e ? [...(porEtiqueta.get(e) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? reparto.find((p) => p.etiquetas?.includes(e))?.nombre : undefined);
  const salida = palabras.map((p) => ({ ...p }));
  let huecos = 0, cambios = 0;
  for (const f of frases) {
    let h = asignado.get(f.n);
    if (!h) { huecos++; h = deEtiqueta(f.etiqueta); }
    if (!h) continue;
    if (deEtiqueta(f.etiqueta) !== h) cambios++;
    for (let i = f.desde; i < f.hasta; i++) (salida[i] as PalabraTranscrita).hablante = h;
  }
  return {
    palabras: salida,
    reparto,
    procedencia: { ...base, ms: reloj() - t, detalle: { frases: frases.length, ventanas: ventanas.length, fallidas, huecos, corregidas: cambios, reparto: reparto.map((p) => `${p.nombre} (${p.papel})`) } },
  };
}
