/**
 * Ver y escuchar: el modelo mira un tramo real del vídeo (el proxy o el original
 * en Gemini Files, recortado con `videoMetadata`) o unas páginas reales (sus
 * imágenes), con la pregunta, la transcripción del tramo y el reparto. Lo que
 * devuelve son observaciones atadas a un instante y, si se ve, a una región del
 * fotograma o de la página: esas son las pruebas. Si dice unas palabras que están
 * en la transcripción o en el texto de la página, la prueba se ancla a ellas.
 */
import type { AnclaMaterial, Region } from '@scholaris/nucleo';
import { tiempoACadena } from '@scholaris/nucleo';
import { entidadesDocumento } from '@scholaris/funciones';
import { apuntar, documentosDisponibles, fallo, fichaDe, lineaPrueba, recortar, resolverDocumento, segundosDe, texto, tramoDe, type ContextoHerramientas, type Herramienta } from './contexto.js';
import type { ParteMensaje } from './modelo.js';
import { estrechar, unidadesDeTramo, type Ambito, type Prueba } from './pruebas.js';

const CLASES = ['plano', 'composicion', 'accion', 'personaje', 'objeto', 'texto', 'luz', 'montaje', 'dialogo', 'sonido', 'musica', 'silencio'] as const;
const SONORAS = new Set(['dialogo', 'sonido', 'musica', 'silencio']);

const ESQUEMA_VER = {
  type: 'object',
  properties: {
    respuesta: { type: 'string', description: 'Lo que contesta a la pregunta, de dos a seis frases, solo con lo que se ve o se oye.' },
    observaciones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          desde: { type: 'string', description: 'Instante H:MM:SS o M:SS contado desde el principio de la obra completa (no del tramo).' },
          hasta: { type: 'string', description: 'Fin, si dura (un plano, una canción).' },
          pagina: { type: 'integer', description: 'Solo en páginas: la página física.' },
          clase: { type: 'string', enum: [...CLASES] },
          descripcion: { type: 'string', description: 'Lo observado, preciso y con el vocabulario de la disciplina (escala, angulación, movimiento, quién domina el encuadre, luz, sonido diegético o no).' },
          caja: { type: 'array', items: { type: 'integer' }, description: '[ymin, xmin, ymax, xmax] en 0-1000 de lo descrito en el fotograma de «desde» o en la página.' },
          personas: { type: 'array', items: { type: 'string' } },
          cita: { type: 'string', description: 'Palabras exactas que se oyen o que se leen, si las hay (en su lengua).' },
        },
        required: ['clase', 'descripcion'],
      },
    },
  },
  required: ['respuesta', 'observaciones'],
};

interface Observacion { desde?: string; hasta?: string; pagina?: number; clase?: string; descripcion?: string; caja?: number[]; personas?: string[]; cita?: string }

/** [ymin, xmin, ymax, xmax] en 0-1000 → región en fracciones. */
export function regionDeCaja(caja: unknown): Region | undefined {
  if (!Array.isArray(caja) || caja.length !== 4 || caja.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return undefined;
  const [y0, x0, y1, x1] = (caja as number[]).map((x) => Math.min(1000, Math.max(0, x)) / 1000) as [number, number, number, number];
  const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  if (r.w < 0.01 || r.h < 0.01) return undefined;
  return { x: +r.x.toFixed(4), y: +r.y.toFixed(4), w: +r.w.toFixed(4), h: +r.h.toFixed(4) };
}

/**
 * Instantes de las observaciones en segundos de la obra. Si el modelo contó desde el
 * principio del tramo (todo cabe en la duración del tramo y nada llega a su inicio),
 * se desplazan. Lo que cae fuera del tramo se descarta.
 */
export function instantesDe(obs: Observacion[], t0: number, t1: number): Array<{ o: Observacion; a: number; b: number }> {
  const crudos = obs.map((o) => ({ o, a: segundosDe(o.desde), b: segundosDe(o.hasta) }));
  const conTiempo = crudos.filter((x) => x.a !== undefined) as Array<{ o: Observacion; a: number; b: number | undefined }>;
  const relativo = t0 > 5 && conTiempo.length > 0 && conTiempo.every((x) => x.a <= t1 - t0 + 3) && conTiempo.some((x) => x.a < t0 - 3);
  const salida: Array<{ o: Observacion; a: number; b: number }> = [];
  for (const x of conTiempo) {
    let a = x.a + (relativo ? t0 : 0);
    let b = (x.b ?? x.a) + (relativo ? t0 : 0);
    if (a > t1 + 2 || b < t0 - 2) continue;
    a = Math.max(t0, Math.min(t1, a));
    b = Math.max(a, Math.min(t1, b));
    salida.push({ o: x.o, a: Math.round(a * 10) / 10, b: Math.round(b * 10) / 10 });
  }
  return salida;
}

async function reparto(ctx: ContextoHerramientas, doc: string): Promise<string> {
  try {
    const e = await entidadesDocumento(ctx.p.sql, doc, 30);
    return e.entidades.filter((x) => x.tipo === 'persona').slice(0, 14).map((x) => x.nombre).join(', ');
  } catch { return ''; }
}

/** Mira un tramo de un medio o unas páginas y apunta lo que ve como pruebas. */
async function mirar(args: Record<string, unknown>, ctx: ContextoHerramientas, modo: 'ver' | 'escuchar') {
  const doc = resolverDocumento(ctx, args.documento);
  if (!doc) return fallo(`No conozco ese documento. Disponibles: ${documentosDisponibles(ctx)}`);
  const pregunta = texto(args.pregunta);
  if (!pregunta) return fallo('Falta «pregunta»: qué hay que mirar.');
  const modelo = ctx.p.modelos.vision ?? ctx.p.modelos.agente;
  const d = ctx.docs.get(doc)!;
  const f = fichaDe(ctx, doc);
  const esMedio = d.tipo === 'video' || d.tipo === 'audio';
  const partes: ParteMensaje[] = [];
  let ambitos: Array<Ambito & { imagen: string | null }> = [];
  let t0 = 0, t1 = 0;
  let instrucciones: string;

  if (esMedio) {
    if (modo === 'ver' && d.tipo === 'audio') return fallo('Es un audio: usa «escuchar».');
    const tramo = tramoDe(args.tiempo, segundosDe) ?? (args.t0 !== undefined ? tramoDe([args.t0, args.t1 ?? args.t0], segundosDe) : undefined);
    if (!tramo) return fallo('Indica «tiempo» {desde, hasta}.');
    [t0, t1] = tramo;
    if (t1 - t0 < 2) t1 = t0 + 10;
    const recortado = t1 - t0 > ctx.segundosVer;
    if (recortado) t1 = t0 + ctx.segundosVer;
    const fuente = ctx.p.medios ? await ctx.p.medios.fuente(doc).catch((e: unknown) => { ctx.avisos.push(`No se pudo preparar el medio: ${(e as Error).message}`); return null; }) : null;
    if (!fuente) return fallo('No puedo ver ni oír este documento (no hay medio disponible). Usa su transcripción con «leer» y sus fotogramas descritos.');
    const largo = t1 - t0;
    partes.push({ tipo: 'medio', uri: fuente.uri, mime: fuente.mime, desde: t0, hasta: t1, fps: modo === 'escuchar' ? 0.2 : largo > 300 ? 0.5 : 1 });
    ambitos = await unidadesDeTramo(ctx.p.sql, doc, { tiempo: [t0, t1] }, 40);
    const transcripcion = recortar(ambitos.map((u) => `[${u.ancla.tipo === 'tiempo' ? tiempoACadena(u.ancla.t0) : ''}] ${u.texto}`).join('\n'), 5000);
    const gente = await reparto(ctx, doc);
    instrucciones = [
      `${modo === 'ver' ? 'Mira' : 'Escucha'} el tramo ${tiempoACadena(t0)}-${tiempoACadena(t1)} de «${f?.titulo ?? doc}» (${f?.autor ?? ''}, ${f?.anio ?? ''}).${recortado ? ' (Es solo una parte de lo pedido.)' : ''}`,
      `Pregunta: ${pregunta}`,
      gente ? `Personas y personajes del documento: ${gente}.` : '',
      transcripcion ? `Transcripción del tramo (para reconocer quién habla; lo que importa es lo que se ${modo === 'ver' ? 've' : 'oye'}):\n${transcripcion}` : '',
      modo === 'ver'
        ? 'Analiza como un especialista en cine: planos (escala, angulación, movimiento de cámara), composición y quién domina el encuadre, profundidad de campo, luz y color, montaje, objetos y símbolos, texto en pantalla. Una observación por plano o hecho relevante para la pregunta, con su instante y la caja de lo descrito en el fotograma de ese instante.'
        : 'Analiza el sonido: música (diegética o no, qué pieza si la reconoces), canciones, silencios, ruido ambiente, tono y prosodia de las voces, quién habla. Una observación por hecho sonoro relevante, con su instante.',
      'Los instantes, SIEMPRE contados desde el principio de la obra completa. Solo lo que se ve o se oye de verdad; si algo no se distingue, dilo en la respuesta. No identifiques un objeto, una persona, un gesto o una pieza musical con más precisión de la que se distingue (si no se ve bien si es un disco o un casete, di «un soporte de música»; si no se sabe quién canta, no lo nombres); en las observaciones, quién es cada persona solo si se la reconoce sin duda. Escribe en español.',
    ].filter(Boolean).join('\n\n');
  } else {
    if (modo === 'escuchar') return fallo('Este documento no tiene sonido: usa «ver» o «leer».');
    let paginas = Array.isArray(args.paginas) ? (args.paginas as unknown[]).map(Number).filter((n) => Number.isFinite(n)) : [];
    if (!paginas.length) { const t = tramoDe(args.paginas); if (t) for (let i = t[0]; i <= t[1]; i++) paginas.push(i); }
    paginas = [...new Set(paginas)].slice(0, 4);
    if (!paginas.length) return fallo('Indica «paginas» (páginas físicas, como mucho cuatro).');
    if (!ctx.p.medios) return fallo('No puedo ver las imágenes de este documento. Usa «leer».');
    for (const n of paginas) ambitos.push(...(await unidadesDeTramo(ctx.p.sql, doc, { paginas: [n, n] }, 1)));
    let vistas = 0;
    for (const u of ambitos) {
      if (!u.imagen) continue;
      const img = await ctx.p.medios.imagen(doc, u.imagen).catch(() => null);
      if (!img) continue;
      partes.push({ tipo: 'texto', texto: `[Página física ${u.ancla.tipo === 'pagina' ? u.ancla.fisica : u.orden + 1}]` }, { tipo: 'bytes', bytes: img.bytes, mime: img.mime });
      vistas++;
    }
    if (!vistas) return fallo('Esas páginas no tienen imagen. Usa «leer».');
    instrucciones = [
      `Mira estas páginas de «${f?.titulo ?? doc}» (${f?.autor ?? ''}, ${f?.anio ?? ''}).`,
      `Pregunta: ${pregunta}`,
      'Una observación por cosa relevante (un pasaje, una ilustración, una nota manuscrita, la maqueta), con su página física, la caja de lo descrito y, si es texto, las palabras exactas tal como se leen. Solo lo que se ve. Escribe en español.',
    ].join('\n\n');
  }
  partes.push({ tipo: 'texto', texto: instrucciones });

  const r = await modelo.turno({
    mensajes: [{ rol: 'usuario', partes }], esquema: ESQUEMA_VER, pensamiento: 'bajo', temperatura: 0.2, maxTokens: 6000,
    resolucion: esMedio ? (t1 - t0 > 120 ? 'baja' : 'media') : 'alta', ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  ctx.cuentas.apuntar(r.uso);
  const j = (r.json ?? {}) as { respuesta?: string; observaciones?: Observacion[] };
  const obs = Array.isArray(j.observaciones) ? j.observaciones.slice(0, 24) : [];
  const nuevas: Prueba[] = [];
  const nota = `${modo === 'ver' ? 'Visto' : 'Oído'} al preguntar: ${recortar(pregunta, 140)}`;

  if (esMedio) {
    for (const { o, a, b } of instantesDe(obs, t0, t1)) {
      const clase = String(o.clase ?? 'accion');
      const descripcion = texto(o.descripcion);
      if (!descripcion) continue;
      // Si dice unas palabras de la transcripción, la prueba es esa frase con sus segundos.
      const cita = texto(o.cita);
      let literal: Prueba | null = null;
      if (cita && SONORAS.has(clase)) {
        for (const u of ambitos) {
          if (u.ancla.tipo !== 'tiempo' || u.ancla.t1 < a - 15 || u.ancla.t0 > b + 15) continue;
          const base: Prueba = { id: '', evidencia: { documento: doc, ancla: u.ancla as AnclaMaterial, modo: 'audio', unidad: u.unidad }, capa: 'literal', herramienta: modo, ambito: u };
          const e = estrechar(base, cita);
          if (e) { literal = apuntar(ctx, { documento: doc, ancla: e.ancla, cita: e.cita, modo: 'audio', unidad: u.unidad }, { capa: 'literal', herramienta: modo, ambito: u, nota: `${descripcion}` }); break; }
        }
      }
      if (literal) { nuevas.push(literal); continue; }
      const region = SONORAS.has(clase) ? undefined : regionDeCaja(o.caja);
      const ancla: AnclaMaterial = { tipo: 'tiempo', t0: a, t1: b, instante: a, ...(region ? { region } : {}) };
      const quien = Array.isArray(o.personas) && o.personas.length ? ` (${o.personas.join(', ')})` : '';
      const p = apuntar(ctx, { documento: doc, ancla, cita: `${clase === 'plano' ? 'Plano: ' : ''}${descripcion}${quien}${cita ? ` «${cita}»` : ''}`, modo: SONORAS.has(clase) ? 'audio' : 'video' }, { capa: 'percepcion', herramienta: modo, nota });
      nuevas.push(p);
    }
  } else {
    for (const o of obs) {
      const descripcion = texto(o.descripcion);
      const u = ambitos.find((x) => x.ancla.tipo === 'pagina' && x.ancla.fisica === Number(o.pagina)) ?? (ambitos.length === 1 ? ambitos[0] : undefined);
      if (!u || !descripcion) continue;
      const region = regionDeCaja(o.caja);
      const base: Prueba = { id: '', evidencia: { documento: doc, ancla: { ...(u.ancla as AnclaMaterial), ...(region ? { region } : {}) }, modo: 'imagen', unidad: u.unidad }, capa: 'percepcion', herramienta: modo, ambito: u };
      const cita = texto(o.cita);
      const e = cita ? estrechar(base, cita) : null;
      const ancla: AnclaMaterial = e ? { ...e.ancla, ...(region ? { region } : {}) } : base.evidencia.ancla;
      const p = apuntar(ctx, { documento: doc, ancla, cita: e ? e.cita : `${descripcion}${cita ? ` «${cita}»` : ''}`, modo: e ? 'texto' : 'imagen', unidad: u.unidad }, { capa: e ? 'literal' : 'percepcion', herramienta: modo, ambito: u, ...(u.imagen ? { imagen: u.imagen } : {}), nota: e ? descripcion : nota });
      nuevas.push(p);
    }
  }
  const lineas = nuevas.map((p) => lineaPrueba(ctx, p, 400));
  const respuesta = texto(j.respuesta);
  return {
    texto: `${respuesta ? `Lo que ${modo === 'ver' ? 'se ve' : 'se oye'}: ${respuesta}\n\n` : ''}${lineas.length ? `Observaciones:\n${lineas.join('\n')}` : 'No devolvió observaciones ancladas.'}`,
    resumen: `${nuevas.length} observaciones${esMedio ? ` en ${tiempoACadena(t0)}-${tiempoACadena(t1)}` : ''}`,
    pruebas: nuevas.map((p) => p.id),
  };
}

const PARAMETROS = (modo: 'ver' | 'escuchar') => ({
  type: 'object',
  properties: {
    documento: { type: 'string', description: 'Id (o título) del documento.' },
    tiempo: { type: 'object', description: 'Tramo del vídeo o del audio, en segundos o «H:MM:SS» desde el principio. Cuanto más corto, más fino (y más barato).', properties: { desde: { type: 'string' }, hasta: { type: 'string' } }, required: ['desde', 'hasta'] },
    ...(modo === 'ver' ? { paginas: { type: 'array', items: { type: 'integer' }, description: 'Páginas físicas que mirar (como mucho cuatro), en libros escaneados.' } } : {}),
    pregunta: { type: 'string', description: `Qué hay que ${modo === 'ver' ? 'mirar' : 'escuchar'}, concreto.` },
  },
  required: ['documento', 'pregunta'],
});

export const ver: Herramienta = {
  declaracion: {
    nombre: 'ver',
    descripcion: 'Mira de verdad un tramo de un vídeo (planos, encuadre, quién domina la imagen, gestos, objetos, luz, texto en pantalla) o unas páginas escaneadas (ilustraciones, maqueta, letra). Devuelve observaciones con su instante y la región del fotograma o de la página, como pruebas [P#]. Es la única forma de afirmar algo visual.',
    parametros: PARAMETROS('ver'),
  },
  ejecutar: (args, ctx) => mirar(args, ctx, 'ver'),
};

export const escuchar: Herramienta = {
  declaracion: {
    nombre: 'escuchar',
    descripcion: 'Escucha un tramo de un audio o de un vídeo: música (diegética o no), canciones, silencios, ruido, tono y prosodia de las voces. Devuelve observaciones con su instante, como pruebas [P#].',
    parametros: PARAMETROS('escuchar'),
  },
  ejecutar: (args, ctx) => mirar(args, ctx, 'escuchar'),
};

/**
 * Comprueba una frase visual volviendo a mirar el sitio de su prueba (unos segundos
 * alrededor del instante, o la página). Para la verificación.
 */
export async function volverAMirar(ctx: ContextoHerramientas, p: Prueba, frase: string): Promise<{ veredicto: 'si' | 'no' | 'dudoso'; nota: string } | null> {
  const modelo = ctx.p.modelos.vision ?? ctx.p.modelos.agente;
  const e = p.evidencia;
  const a = e.ancla;
  const partes: ParteMensaje[] = [];
  if (a.tipo === 'tiempo') {
    const fuente = ctx.p.medios ? await ctx.p.medios.fuente(e.documento).catch(() => null) : null;
    if (!fuente) return null;
    const centro = a.instante ?? a.t0;
    const desde = Math.max(0, Math.min(a.t0, centro - 3));
    const hasta = Math.max(desde + 6, Math.min(a.t1 + 2, desde + 40));
    partes.push({ tipo: 'medio', uri: fuente.uri, mime: fuente.mime, desde, hasta, fps: 2 });
    partes.push({ tipo: 'texto', texto: `Tramo ${tiempoACadena(desde)}-${tiempoACadena(hasta)}. ¿Lo que se ve y se oye aquí respalda esta afirmación? «${frase}»\nResponde «si», «no» o «dudoso» y una frase que lo explique.` });
  } else if (a.tipo === 'pagina' && p.imagen && ctx.p.medios) {
    const img = await ctx.p.medios.imagen(e.documento, p.imagen).catch(() => null);
    if (!img) return null;
    partes.push({ tipo: 'bytes', bytes: img.bytes, mime: img.mime });
    partes.push({ tipo: 'texto', texto: `¿Lo que se ve en esta página respalda esta afirmación? «${frase}»\nResponde «si», «no» o «dudoso» y una frase que lo explique.` });
  } else return null;
  const r = await modelo.turno({
    mensajes: [{ rol: 'usuario', partes }], pensamiento: 'bajo', temperatura: 0, maxTokens: 800, resolucion: 'media',
    esquema: { type: 'object', properties: { veredicto: { type: 'string', enum: ['si', 'no', 'dudoso'] }, nota: { type: 'string' } }, required: ['veredicto', 'nota'] },
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  ctx.cuentas.apuntar(r.uso);
  const j = (r.json ?? {}) as { veredicto?: string; nota?: string };
  const v = j.veredicto === 'si' || j.veredicto === 'no' ? j.veredicto : 'dudoso';
  return { veredicto: v, nota: texto(j.nota) };
}


/** El tramo que se vuelve a mirar para comprobar una prueba de un medio: el de la cita, con margen. */
export function tramoDeComprobacion(a: { t0: number; t1: number; instante?: number }): [number, number] {
  const centro = a.instante ?? a.t0;
  const desde = Math.max(0, Math.min(a.t0, centro) - 2);
  // Como en el banco: al menos 8 s desde el principio, y como mucho 45 s.
  const hasta = Math.min(desde + 45, Math.max(a.t1 + 2, desde + 10));
  return [Math.round(desde * 10) / 10, Math.round(hasta * 10) / 10];
}

/**
 * Comprueba varias afirmaciones a la vez en el sitio de una prueba: el tramo del vídeo o del
 * audio (con margen) o la imagen de la página. Para cada una: «si» (se ve o se oye tal
 * cual), «no» (no es así) o «dudoso». Null si ese sitio no se puede mirar.
 */
export async function comprobarEnSitio(ctx: ContextoHerramientas, p: Prueba, afirmaciones: string[], sentido: 'ver' | 'escuchar', o: { signal?: AbortSignal } = {}): Promise<Array<{ veredicto: 'si' | 'no' | 'dudoso'; nota: string }> | null> {
  if (!afirmaciones.length) return [];
  const modelo = ctx.p.modelos.revisor ?? ctx.p.modelos.agente;
  const e = p.evidencia;
  const a = e.ancla;
  const partes: ParteMensaje[] = [];
  const lista = afirmaciones.map((x, i) => `${i + 1}. ${x}`).join('\n');
  const reglas = 'Para cada afirmación responde «si» solo si TODO lo que afirma se ve o se oye tal cual (quién es cada persona, qué hace, qué objeto, cuántos, qué música, qué gesto, la escala del plano si la dice); «no» si algo no es así (otra persona, otro objeto, otra acción, otra música, o no ocurre aquí); «dudoso» si no se distingue. Sé estricto con cada detalle. Una nota breve en español para cada una que diga qué detalle falla.';
  if (a.tipo === 'tiempo') {
    const fuente = ctx.p.medios ? await ctx.p.medios.fuente(e.documento).catch(() => null) : null;
    if (!fuente) return null;
    const [desde, hasta] = tramoDeComprobacion(a);
    partes.push({ tipo: 'medio', uri: fuente.uri, mime: fuente.mime, desde, hasta, fps: 1 });
    partes.push({ tipo: 'texto', texto: `Tramo ${tiempoACadena(desde)}-${tiempoACadena(hasta)} (${sentido === 'escuchar' ? 'escucha con atención el sonido: música, voces, ruidos' : 'mira y escucha'}). Afirmaciones sobre este tramo:\n${lista}\n\n${reglas}` });
  } else if (a.tipo === 'pagina' && p.imagen && ctx.p.medios) {
    const img = await ctx.p.medios.imagen(e.documento, p.imagen).catch(() => null);
    if (!img) return null;
    partes.push({ tipo: 'bytes', bytes: img.bytes, mime: img.mime });
    partes.push({ tipo: 'texto', texto: `Afirmaciones sobre esta página:\n${lista}\n\n${reglas}` });
  } else return null;
  const r = await modelo.turno({
    mensajes: [{ rol: 'usuario', partes }], pensamiento: 'bajo', temperatura: 0, maxTokens: 1500, resolucion: 'media',
    esquema: {
      type: 'object',
      properties: { juicios: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, veredicto: { type: 'string', enum: ['si', 'no', 'dudoso'] }, nota: { type: 'string' } }, required: ['n', 'veredicto', 'nota'] } } },
      required: ['juicios'],
    },
    ...(o.signal ?? ctx.signal ? { signal: o.signal ?? ctx.signal } : {}),
  });
  ctx.cuentas.apuntar(r.uso);
  const juicios = ((r.json ?? {}) as { juicios?: Array<{ n: number; veredicto?: string; nota?: string }> }).juicios ?? [];
  return afirmaciones.map((_, i) => {
    const j = juicios.find((x) => x.n === i + 1);
    const v = j?.veredicto === 'si' || j?.veredicto === 'no' ? j.veredicto : 'dudoso';
    return { veredicto: v, nota: texto(j?.nota) };
  });
}
