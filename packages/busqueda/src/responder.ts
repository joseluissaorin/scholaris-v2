/**
 * Respuesta con citas (RAG) donde el modelo SOLO puede citar los pasajes que se
 * le dan. Cada marca se valida contra el contexto: lo que no existe o no estaba
 * en el contexto se quita y se avisa. Las marcas válidas se convierten en notas
 * Markdown (`[^1]`) cuyo texto sale del ancla del fragmento (anclaACita), nunca
 * del modelo. Las citas literales del modelo («…») se comprueban contra el texto
 * de los pasajes citados.
 *
 * Es un generador asíncrono: si el redactor sabe emitir por trozos
 * (`generarFlujo`), los deltas salen según llegan, ya con las marcas resueltas.
 */
import type { Pasaje, Redactor, Resultado } from '@scholaris/nucleo';
import { anclaACita } from '@scholaris/nucleo';
import type { Buscador } from './buscador.js';
import { contieneLiteral, pasajeSiResponde, terminos } from './texto.js';
import type { OpcionesBusqueda, RespuestaBusqueda } from './tipos.js';

/** Un redactor que además sabe emitir texto por trozos. */
export interface RedactorConFlujo extends Redactor {
  generarFlujo(peticion: Parameters<Redactor['generar']>[0]): AsyncIterable<string>;
}

function tieneFlujo(r: Redactor): r is RedactorConFlujo {
  return typeof (r as Partial<RedactorConFlujo>).generarFlujo === 'function';
}

export interface FuenteRespuesta {
  /** Número de la nota en la respuesta. */
  n: number;
  fragmento: string;
  documento: string;
  /** «Darwin, 1859, p. 81». */
  etiqueta: string;
  /** Línea de la nota al pie. */
  nota: string;
  pasaje: string;
  resultado: Resultado;
  /**
   * Las oraciones del fragmento que sostienen lo que dice la respuesta junto a la
   * nota (con su ancla). Solo si casan con las palabras de esa frase; si no, la
   * nota se queda con el fragmento entero.
   */
  pasajeRelevante?: Pasaje;
}

export type EventoRespuesta =
  | { tipo: 'busqueda'; busqueda: RespuestaBusqueda }
  | { tipo: 'texto'; delta: string }
  | {
    tipo: 'fin';
    markdown: string;
    fuentes: FuenteRespuesta[];
    /** Marcas que el modelo escribió y que no correspondían a ningún pasaje del contexto. */
    descartadas: string[];
    /** Citas literales del modelo que no aparecen en los pasajes que cita. */
    literalesNoVerificados: string[];
    avisos: string[];
  };

export interface OpcionesRespuesta {
  busqueda?: OpcionesBusqueda;
  /** Pasajes que se dan al modelo (8). */
  contexto?: number;
  /** Idioma de la respuesta; por defecto, el de la pregunta. */
  idioma?: string;
}

/** Autor (o autores) y año de una fuente, por separado. */
export function autorYAnio(r: Pick<Resultado, 'documento'>): { autor: string; anio: string } {
  const m = r.documento.metadatos;
  const autores = m.autores.length ? m.autores : m.editores ?? [];
  const autor = autores.length === 0 ? m.titulo : autores.length === 1 ? autores[0]!.apellidos : autores.length === 2 ? `${autores[0]!.apellidos} y ${autores[1]!.apellidos}` : `${autores[0]!.apellidos} et al.`;
  const anio = m.anioOriginal && m.anio && m.anioOriginal !== m.anio ? `${m.anioOriginal}/${m.anio}` : String(m.anio ?? m.anioOriginal ?? 's. f.');
  return { autor, anio };
}

/** Etiqueta corta de autor y año para una fuente: «Darwin, 1859». */
export function etiquetaAutor(r: Pick<Resultado, 'documento'>): string {
  const { autor, anio } = autorYAnio(r);
  return `${autor}, ${anio}`;
}

const SISTEMA = `Eres el asistente de una biblioteca académica. Respondes a la pregunta usando EXCLUSIVAMENTE los pasajes numerados que se te dan.
Reglas obligatorias:
1. Cada afirmación que proceda de un pasaje lleva su marca entre corchetes justo después, por ejemplo [F2] o [F1, F3]. Solo existen las marcas que aparecen en el contexto: no inventes otras, ni números de página, ni autores, ni años.
2. Si los pasajes no bastan para responder, dilo con claridad; no rellenes con conocimiento propio.
3. Si citas literalmente, copia el texto exacto del pasaje entre comillas latinas «…».
4. Escribe en Markdown sencillo, en el idioma indicado, con ortografía cuidada. Sé conciso: de uno a tres párrafos.`;

const MARCA = /\[((?:F\d+|fr[a-z0-9]+|\d+)(?:\s*[,;]\s*(?:F\d+|fr[a-z0-9]+|\d+))*)\]/gi;

/** Respuesta con citas, en streaming. */
export async function* responder(buscador: Buscador, redactor: Redactor, pregunta: string, opciones: OpcionesRespuesta = {}): AsyncGenerator<EventoRespuesta> {
  const busqueda = await buscador.buscar(pregunta, { limite: opciones.contexto ?? 8, ...opciones.busqueda });
  yield { tipo: 'busqueda', busqueda };
  const contexto = busqueda.resultados.slice(0, opciones.contexto ?? 8);
  const avisos: string[] = [];
  if (!contexto.length) {
    const texto = 'No he encontrado en tu biblioteca pasajes que respondan a esta pregunta.';
    yield { tipo: 'texto', delta: texto };
    yield { tipo: 'fin', markdown: texto, fuentes: [], descartadas: [], literalesNoVerificados: [], avisos: ['Sin resultados.'] };
    return;
  }

  // Etiquetas F1…Fn ↔ fragmentos del contexto.
  const porEtiqueta = new Map<string, Resultado>();
  const porId = new Map<string, Resultado>();
  contexto.forEach((r, i) => { porEtiqueta.set(`F${i + 1}`, r); porId.set(r.fragmento.id.toLowerCase(), r); });
  const pasajes = contexto.map((r, i) => {
    const m = r.documento.metadatos;
    return `[F${i + 1}] ${etiquetaAutor(r)}, «${m.titulo}», ${anclaACita(r.fragmento.ancla, r.fragmento.anclaFin)}\n${r.fragmento.texto}`;
  }).join('\n\n');

  const idioma = opciones.idioma ?? busqueda.comprension.expansiones[0]?.idioma ?? 'el de la pregunta';
  const peticion: Parameters<Redactor['generar']>[0] = {
    sistema: SISTEMA,
    mensajes: [{ rol: 'usuario', partes: [{ texto: `Idioma de la respuesta: ${idioma}.\n\nPASAJES:\n\n${pasajes}\n\nPREGUNTA: ${pregunta}` }] }],
    temperatura: 0.2,
    maxTokens: 1200,
    calidad: 'alta',
  };

  const fuentes: FuenteRespuesta[] = [];
  const numeroDe = new Map<string, number>();
  const descartadas: string[] = [];
  const resolver = (contenido: string): string => {
    const notas: number[] = [];
    for (const parte of contenido.split(/\s*[,;]\s*/)) {
      const clave = parte.trim();
      const r = porEtiqueta.get(clave.toUpperCase()) ?? porId.get(clave.toLowerCase()) ?? (/^\d+$/.test(clave) ? porEtiqueta.get(`F${clave}`) : undefined);
      if (!r) { descartadas.push(clave); continue; }
      let n = numeroDe.get(r.fragmento.id);
      if (n === undefined) {
        n = fuentes.length + 1;
        numeroDe.set(r.fragmento.id, n);
        const m = r.documento.metadatos;
        const loc = anclaACita(r.fragmento.ancla, r.fragmento.anclaFin);
        fuentes.push({
          n, fragmento: r.fragmento.id, documento: r.documento.id,
          etiqueta: `${etiquetaAutor(r)}, ${loc}`,
          nota: `${autorYAnio(r).autor}, *${m.titulo}* (${autorYAnio(r).anio}), ${loc}.`,
          pasaje: r.fragmento.texto, resultado: r,
        });
      }
      if (!notas.includes(n)) notas.push(n);
    }
    return notas.map((n) => `[^${n}]`).join('');
  };
  const sustituir = (texto: string) => texto.replace(MARCA, (_, c: string) => resolver(c));

  let crudo = '';
  let salida = '';
  let pendiente = '';
  const emitir = function* (trozo: string, final = false): Generator<EventoRespuesta> {
    pendiente += trozo;
    // Retiene desde el último «[» sin cerrar (una marca a medias).
    let corte = pendiente.length;
    const abierto = pendiente.lastIndexOf('[');
    if (!final && abierto !== -1 && pendiente.indexOf(']', abierto) === -1 && pendiente.length - abierto < 80) corte = abierto;
    const listo = pendiente.slice(0, corte);
    pendiente = pendiente.slice(corte);
    if (listo) {
      const delta = sustituir(listo);
      salida += delta;
      if (delta) yield { tipo: 'texto', delta };
    }
  };

  try {
    if (tieneFlujo(redactor)) {
      for await (const trozo of redactor.generarFlujo(peticion)) { crudo += trozo; yield* emitir(trozo); }
    } else {
      const r = await redactor.generar(peticion);
      crudo = r.texto;
      // Sin streaming del modelo: se entrega por párrafos.
      for (const parrafo of r.texto.split(/(?<=\n\n)/)) yield* emitir(parrafo);
    }
    yield* emitir('', true);
  } catch (e) {
    avisos.push(`El redactor falló: ${(e as Error).message}`);
  }

  // Limpieza: espacios antes de notas y marcas vacías.
  let markdown = salida.replace(/[ \t]+(\[\^\d+\])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();

  // Citas literales: «…» o "…" de 15+ caracteres deben estar en algún pasaje citado.
  const literalesNoVerificados: string[] = [];
  const citados = fuentes.map((f) => f.pasaje);
  for (const m of markdown.matchAll(/«([^»]{15,})»|“([^”]{15,})”|"([^"]{15,})"/g)) {
    const cita = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!citados.some((p) => contieneLiteral(p, cita)) && !contexto.some((r) => contieneLiteral(r.fragmento.texto, cita))) literalesNoVerificados.push(cita);
  }
  if (literalesNoVerificados.length) avisos.push(`${literalesNoVerificados.length} cita(s) literal(es) no aparecen en los pasajes: revisar.`);
  if (descartadas.length) avisos.push(`Se quitaron ${descartadas.length} marca(s) que no corresponden a ningún pasaje del contexto.`);
  if (crudo && !fuentes.length) avisos.push('La respuesta no cita ningún pasaje.');

  // El pasaje de cada nota: las oraciones del fragmento que casan con las frases de la respuesta que la llaman.
  const frasesDe = (n: number) => markdown.split(/(?<=[.?!…])\s+|\n+/).filter((f) => f.includes(`[^${n}]`)).map((f) => f.replace(/\[\^\d+\]/g, ''));
  await Promise.all(fuentes.map(async (f) => {
    const ts = [...new Set([...frasesDe(f.n).flatMap((x) => terminos(x)), ...terminos(pregunta)])];
    const p = pasajeSiResponde(f.resultado.fragmento.texto, ts);
    if (!p) return;
    const r: Resultado = { ...f.resultado, pasaje: p };
    await buscador.anclarPasajes([r]);
    f.pasajeRelevante = r.pasaje;
    const a = r.pasaje?.ancla;
    if (a) {
      const loc = anclaACita(a, r.pasaje?.anclaFin);
      const m2 = f.resultado.documento.metadatos;
      f.etiqueta = `${etiquetaAutor(f.resultado)}, ${loc}`;
      f.nota = `${autorYAnio(f.resultado).autor}, *${m2.titulo}* (${autorYAnio(f.resultado).anio}), ${loc}.`;
    }
  }));

  if (fuentes.length) markdown += '\n\n' + fuentes.map((f) => `[^${f.n}]: ${f.nota}`).join('\n');
  yield { tipo: 'fin', markdown, fuentes, descartadas, literalesNoVerificados, avisos };
}

/** Lo mismo que `responder`, pero espera al final. */
export async function responderCompleto(buscador: Buscador, redactor: Redactor, pregunta: string, opciones: OpcionesRespuesta = {}): Promise<Extract<EventoRespuesta, { tipo: 'fin' }> & { busqueda: RespuestaBusqueda }> {
  let busqueda: RespuestaBusqueda | undefined;
  for await (const e of responder(buscador, redactor, pregunta, opciones)) {
    if (e.tipo === 'busqueda') busqueda = e.busqueda;
    if (e.tipo === 'fin') return { ...e, busqueda: busqueda as RespuestaBusqueda };
  }
  throw new Error('responder terminó sin evento final');
}
