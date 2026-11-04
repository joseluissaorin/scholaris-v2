/**
 * Precisión de las citas de una respuesta: cada frase frente a cada cita que la
 * acompaña (nota [^n] o evidencia [E1]) y frente a cada ancla escrita en la prosa
 * («p. 14», «1:02:03-1:03:10»). El ancla se resuelve contra la fuente real (el texto de
 * la página o la transcripción del tramo, nunca el pasaje que dice el sistema) y un
 * juez decide si la sostiene. Un ancla que no existe en el documento es una cita
 * inventada. Lo visual se puede comprobar mirando el recorte (Mirador).
 */
import { enParalelo, type Ancla } from '@scholaris/nucleo';
import { contieneCita, type Fuentes } from './fuentes.js';
import type { ModeloJuez } from './modelo.js';
import type { CitaRespuesta, JuicioCita, Pregunta, RespuestaNormalizada, VeredictoCita } from './tipos.js';

// ---------------------------------------------------------------------------
// Frases y marcas
// ---------------------------------------------------------------------------

const MARCA_NOTA = /\[\^(\d+)\]/g;
const MARCA_EVIDENCIA = /\[((?:E\d+)(?:\s*[,;]\s*E\d+)*)\]/g;

/** Líneas que son la lista de notas o de pruebas del final, no prosa. */
function esListaDeFuentes(linea: string): boolean {
  return /^\s*(?:[-*]\s*)?(?:\[\^\d+\]:|\[E\d+\]\s*[:.—-]|\*\*E\d+\*\*|E\d+\s*[:.—])/.test(linea);
}

export interface Frase {
  texto: string;
  /** Ids de las citas que lleva («1», «E3»). */
  citas: string[];
}

/** Parte el Markdown en frases y recoge las marcas de cada una. */
export function frasesConCitas(markdown: string): Frase[] {
  // Investigar cierra con la lista de pruebas («## Pruebas» o «## Evidence»): no es prosa.
  const prosa = markdown.split(/\n#{1,3}\s*(?:Pruebas|Evidence|Evidencias)\s*\n/i)[0] as string;
  const lineas = prosa.replace(/\s*\[sin prueba\]/gi, '').split('\n').filter((l) => !esListaDeFuentes(l));
  // Las marcas que van detrás del punto pertenecen a la frase anterior: se pasan delante.
  const texto = lineas.join('\n').replace(/([.?!…])((?:\s?\[\^\d+\]|\s?\[E\d+(?:\s*[,;]\s*E\d+)*\])+)/g, '$2$1');
  const salida: Frase[] = [];
  // No se corta tras abreviaturas («p. 14», «cap. 7», «vol. 2»).
  for (const bruto of texto.split(/(?<=[.?!…])(?<!(?:^|[\s(])(?:p|pp|pág|págs|cap|caps|vol|ed|núm|n|fig|cf|vid|ss|s)\.)\s+|\n+/i)) {
    const t = bruto.replace(/^\s*(?:[-*>]|\d+\.|#+|\|)\s*/, '').trim();
    if (t.replace(/[\s|*_#-]/g, '').length < 3) continue;
    const citas: string[] = [];
    for (const m of t.matchAll(MARCA_NOTA)) citas.push(m[1] as string);
    for (const m of t.matchAll(MARCA_EVIDENCIA)) for (const id of (m[1] as string).split(/\s*[,;]\s*/)) citas.push(id);
    salida.push({ texto: t.replace(MARCA_NOTA, '').replace(MARCA_EVIDENCIA, '').replace(/\s+([.,;:?!])/g, '$1').trim(), citas: [...new Set(citas)] });
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Anclas escritas en la prosa
// ---------------------------------------------------------------------------

export interface AnclaProsa {
  texto: string;
  tipo: 'pagina' | 'tiempo';
  /** Página impresa citada («23») o segundos. */
  desde: number;
  hasta: number;
}

const aSegundos = (s: string): number => s.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);

export function anclasEnProsa(frase: string): AnclaProsa[] {
  const salida: AnclaProsa[] = [];
  for (const m of frase.matchAll(/\b(?:pp?\.|págs?\.|páginas?)\s*(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?/gi)) {
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    salida.push({ texto: m[0], tipo: 'pagina', desde: a, hasta: Math.max(a, b) });
  }
  for (const m of frase.matchAll(/(?<![\d:])(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*(?:[-–]|al?|hasta|to)\s*(\d{1,2}:\d{2}(?::\d{2})?))?(?![\d:])/g)) {
    const a = aSegundos(m[1] as string), b = m[2] ? aSegundos(m[2]) : a + 20;
    salida.push({ texto: m[0], tipo: 'tiempo', desde: a, hasta: Math.max(a, b) });
  }
  // «minuto 40» o «minutos 40 y 41», pero no «minuto 1:42:44» (eso ya es un tramo de tiempo).
  for (const m of frase.matchAll(/\bminutos?\s+(\d{1,3})(?![\d:])(?:\s*(?:[-–]|y|al?)\s*(\d{1,3})(?![\d:]))?/gi)) {
    const a = Number(m[1]) * 60, b = m[2] ? Number(m[2]) * 60 + 59 : a + 59;
    salida.push({ texto: m[0], tipo: 'tiempo', desde: a, hasta: Math.max(a, b) });
  }
  return salida;
}

/** Ancla de Scholaris para una página impresa: la unidad cuyo folio es el más alto que no la pasa (vale para pliegos de dos páginas). */
export function anclaDePaginaImpresa(fuentes: Fuentes, documento: string, impresa: number): Ancla | null {
  const d = fuentes.documento(documento);
  if (!d) return null;
  let mejor: { n: number; ancla: Ancla } | null = null;
  for (const u of d.unidades) {
    if (u.ancla.tipo !== 'pagina') continue;
    const n = Number(u.ancla.impresa);
    if (!Number.isFinite(n) || n > impresa) continue;
    if (!mejor || n > mejor.n) mejor = { n, ancla: u.ancla };
  }
  // Más allá de la última página (con un margen de una, la otra cara del pliego) no existe.
  const ultima = Math.max(0, ...d.unidades.map((u) => (u.ancla.tipo === 'pagina' ? Number(u.ancla.impresa) || 0 : 0)));
  if (!mejor || impresa > ultima + 1) return null;
  return mejor.ancla;
}

// ---------------------------------------------------------------------------
// Pares por juzgar
// ---------------------------------------------------------------------------

export interface ParCita {
  cita: string;
  frase: string;
  documento: string;
  etiqueta: string;
  ancla: Ancla | null;
  anclaFin?: Ancla;
  /** Lo que el sistema dice que hay en el ancla (pasaje o cita de la evidencia). */
  declarado?: string;
  origen: 'cita' | 'prosa';
}

function tipoDoc(fuentes: Fuentes, id: string): 'pagina' | 'tiempo' | 'otro' {
  const d = fuentes.documento(id);
  const a = d?.unidades[0]?.ancla;
  return a?.tipo === 'pagina' ? 'pagina' : a?.tipo === 'tiempo' ? 'tiempo' : 'otro';
}

/**
 * El ancla de una cita que no la trae (respuestas guardadas antes de capturar las anclas
 * de los fragmentos): se deduce de su etiqueta («p. 12», «p. [1]», «19:56-20:42»).
 */
export function anclaDeEtiqueta(fuentes: Fuentes, documento: string, etiqueta: string): { ancla: Ancla; anclaFin?: Ancla } | null {
  const fisica = /^p\. \[(\d+)\]$/.exec(etiqueta.trim());
  if (fisica) {
    const u = fuentes.documento(documento)?.unidades.find((x) => x.ancla.tipo === 'pagina' && x.ancla.fisica === Number(fisica[1]));
    return u ? { ancla: u.ancla } : null;
  }
  const a = anclasEnProsa(etiqueta)[0];
  if (!a) return null;
  if (a.tipo === 'tiempo') return { ancla: { tipo: 'tiempo', t0: a.desde, t1: /[-–]/.test(a.texto) ? a.hasta : a.desde } };
  const ancla = anclaDePaginaImpresa(fuentes, documento, a.desde);
  if (!ancla) return null;
  const fin = a.hasta !== a.desde ? anclaDePaginaImpresa(fuentes, documento, a.hasta) : null;
  return { ancla, ...(fin ? { anclaFin: fin } : {}) };
}

export function paresDeCitas(r: RespuestaNormalizada, p: Pregunta, fuentes: Fuentes): { pares: ParCita[]; marcasHuerfanas: string[] } {
  const porId = new Map<string, CitaRespuesta>(r.citas.map((c) => {
    if (c.ancla || !c.etiqueta) return [c.id, c];
    const a = anclaDeEtiqueta(fuentes, c.documento, c.etiqueta);
    return [c.id, a ? { ...c, ...a } : c];
  }));
  const pares: ParCita[] = [];
  const huerfanas = new Set<string>();
  const usadas = new Set<string>();
  for (const f of frasesConCitas(r.markdown)) {
    const etiquetasCitadas: string[] = [];
    for (const id of f.citas) {
      const c = porId.get(id);
      if (!c) { huerfanas.add(id); continue; }
      usadas.add(id);
      etiquetasCitadas.push(c.etiqueta ?? '');
      pares.push({
        cita: id, frase: f.texto, documento: c.documento, etiqueta: c.etiqueta ?? '', ancla: c.ancla ?? null,
        ...(c.anclaFin ? { anclaFin: c.anclaFin } : {}), ...(c.texto ? { declarado: c.texto } : {}), origen: 'cita',
      });
    }
    // Anclas escritas en la frase, salvo las que repiten la etiqueta de una de sus citas.
    for (const a of anclasEnProsa(f.texto)) {
      if (etiquetasCitadas.some((e) => e && e.replace(/\s/g, '').includes(a.texto.replace(/^(?:pp?\.|págs?\.|páginas?)\s*/i, '').replace(/\s/g, '')))) continue;
      const candidatos = p.documentos.filter((d) => tipoDoc(fuentes, d) === a.tipo);
      if (candidatos.length !== 1) continue; // ambigua: no se juzga
      const documento = candidatos[0] as string;
      let ancla: Ancla | null;
      let anclaFin: Ancla | undefined;
      if (a.tipo === 'pagina') {
        ancla = anclaDePaginaImpresa(fuentes, documento, a.desde);
        const fin = a.hasta !== a.desde ? anclaDePaginaImpresa(fuentes, documento, a.hasta) : null;
        if (fin) anclaFin = fin;
        if (a.hasta !== a.desde && !fin) ancla = null;
      } else {
        ancla = { tipo: 'tiempo', t0: a.desde, t1: a.hasta };
      }
      pares.push({ cita: `«${a.texto}»`, frase: f.texto, documento, etiqueta: a.texto, ancla, ...(anclaFin ? { anclaFin } : {}), origen: 'prosa' });
    }
  }
  // Evidencias que no llama ninguna frase: se juzgan contra su propia cita (¿está donde dice?).
  for (const c of porId.values()) {
    if (usadas.has(c.id) || !c.texto) continue;
    pares.push({ cita: c.id, frase: c.texto, documento: c.documento, etiqueta: c.etiqueta ?? '', ancla: c.ancla ?? null, ...(c.anclaFin ? { anclaFin: c.anclaFin } : {}), declarado: c.texto, origen: 'cita' });
  }
  return { pares, marcasHuerfanas: [...huerfanas] };
}

// ---------------------------------------------------------------------------
// Juicio
// ---------------------------------------------------------------------------

/**
 * Frases que no afirman nada de la fuente sino de su falta («los pasajes no contienen
 * información sobre…»). Citarlas no prueba nada: no cuentan en la precisión.
 */
export function esFraseSobreLaFalta(frase: string): boolean {
  return /\b(?:pasajes|fragmentos|textos|extractos|materiales?|fuentes|passages|sources)\b[^.]{0,90}\b(?:no\s+(?:contienen|contiene|incluyen|aportan|muestran|permiten|bastan|ofrecen|proporcionan|mencionan|recogen|figura|aparece|aparecen)|do(?:es)?\s+not\s+(?:contain|include|mention))/i.test(frase)
    || /\bno\s+(?:es\s+posible|se\s+puede|puedo)\s+(?:responder|determinar|elaborar|reconstruir|comparar|saber)/i.test(frase);
}

/** Mira un tramo de vídeo con la frase delante (Gemini sobre el recorte). */
export interface Mirador {
  puedeVer(documento: string): boolean;
  ver(documento: string, t0: number, t1: number, frase: string): Promise<{ veredicto: 'sostiene' | 'parcial' | 'no_sostiene'; motivo: string; usd: number }>;
}

export const SISTEMA_CITAS = `Eres el verificador de citas de un banco de pruebas académico (filología y cine). Recibes frases de una respuesta y el contenido REAL de la fuente en el sitio citado (el texto OCR de la página o la transcripción del tramo de vídeo, con sus erratas).
Para cada frase decide:
- "sostiene": lo que afirma la frase está en ese contenido (literal o parafraseado con fidelidad). Las erratas de OCR o de transcripción no cuentan.
- "parcial": el contenido respalda una parte de la frase, pero la frase añade algo que no está, o el ancla es la de al lado.
- "no_sostiene": el contenido no dice eso, dice otra cosa o lo contradice.
Además marca "visual": true si la frase afirma algo que solo se puede comprobar viendo u oyendo la película (planos, encuadre, color, objetos, gestos, música, silencio) y que la transcripción no puede probar ni desmentir.
Juzga solo con el contenido dado; no uses lo que sepas de la obra. Motivo en español, de 25 palabras como mucho.`;

const ESQUEMA_CITAS = {
  type: 'object',
  properties: {
    juicios: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'integer' }, veredicto: { type: 'string', enum: ['sostiene', 'parcial', 'no_sostiene'] }, visual: { type: 'boolean' }, motivo: { type: 'string' } },
        required: ['n', 'veredicto', 'visual', 'motivo'],
      },
    },
  },
  required: ['juicios'],
};

const MAX_CONTENIDO = 9000;

export async function juzgarCitas(
  r: RespuestaNormalizada, p: Pregunta, fuentes: Fuentes, juez: ModeloJuez, mirador?: Mirador,
): Promise<{ juicios: JuicioCita[]; usd: number }> {
  const { pares, marcasHuerfanas } = paresDeCitas(r, p, fuentes);
  const juicios: JuicioCita[] = [];
  let usd = 0;
  const poner = (x: ParCita, veredicto: VeredictoCita, motivo: string, visual?: boolean) => juicios.push({
    cita: x.cita, frase: x.frase, documento: x.documento, etiqueta: x.etiqueta, veredicto, motivo, origen: x.origen, ...(visual ? { visual } : {}),
  });
  for (const id of marcasHuerfanas) {
    juicios.push({ cita: id, frase: '', documento: '', etiqueta: '', veredicto: 'inventada', motivo: 'La marca no corresponde a ninguna cita de la respuesta.', origen: 'cita' });
  }

  // Agrupar por cita (mismo documento y ancla): una llamada con todas sus frases.
  const grupos = new Map<string, ParCita[]>();
  for (const x of pares) {
    if (esFraseSobreLaFalta(x.frase)) { poner(x, 'sin_comprobar', 'La frase habla de la falta de información, no de la fuente: no se juzga como cita.'); continue; }
    if (!fuentes.documento(x.documento)) { poner(x, 'inventada', 'El documento citado no existe en la biblioteca.'); continue; }
    if (!x.ancla) { poner(x, 'inventada', `El ancla «${x.etiqueta}» no existe en el documento.`); continue; }
    const c = fuentes.contenido(x.documento, x.ancla, x.anclaFin);
    if (!c.existe) { poner(x, 'inventada', `El ancla «${x.etiqueta}» está fuera del documento.`); continue; }
    const clave = `${x.documento}|${JSON.stringify(x.ancla)}|${JSON.stringify(x.anclaFin ?? null)}`;
    const l = grupos.get(clave) ?? [];
    l.push(x);
    grupos.set(clave, l);
  }

  // Los grupos van en paralelo (cuatro a la vez); el orden de los juicios se rehace al final.
  await enParalelo([...grupos.values()], 4, async (grupo) => {
    const x0 = grupo[0] as ParCita;
    const c = fuentes.contenido(x0.documento, x0.ancla as Ancla, x0.anclaFin);
    const avisoPasaje = x0.declarado && c.texto && !contieneCita(c.texto, x0.declarado, 0.6)
      ? `\nAVISO: el pasaje que el sistema atribuye a este sitio no aparece en el contenido real; juzga con el contenido real.` : '';
    const contenido = c.sinTexto ? '(Tramo sin transcripción: imagen, música o silencio.)' : c.texto.slice(0, MAX_CONTENIDO);
    const usuario = `DOCUMENTO: ${fuentes.documento(x0.documento)?.titulo ?? x0.documento}\nSITIO CITADO: ${x0.etiqueta} (${c.unidades.join(', ') || 'sin unidades'})${avisoPasaje}\n\nCONTENIDO REAL DE LA FUENTE:\n${contenido}\n\nFRASES:\n${grupo.map((x, i) => `${i + 1}. ${x.frase}`).join('\n')}`;
    let res: { json: { juicios: Array<{ n: number; veredicto: 'sostiene' | 'parcial' | 'no_sostiene'; visual: boolean; motivo: string }> }; usd: number };
    try {
      res = await juez.json({ sistema: SISTEMA_CITAS, usuario, esquema: ESQUEMA_CITAS });
    } catch (e) {
      for (const x of grupo) poner(x, 'sin_comprobar', `El juez falló: ${(e as Error).message.slice(0, 120)}`);
      return;
    }
    usd += res.usd;
    const porN = new Map(res.json.juicios.map((j) => [j.n, j]));
    for (let i = 0; i < grupo.length; i++) {
      const x = grupo[i] as ParCita;
      const j = porN.get(i + 1);
      if (!j) { poner(x, 'sin_comprobar', 'El juez no devolvió veredicto.'); continue; }
      const a = x.ancla as Ancla;
      if (j.visual && j.veredicto !== 'sostiene' && a.tipo === 'tiempo') {
        if (mirador?.puedeVer(x.documento)) {
          const fin = x.anclaFin?.tipo === 'tiempo' ? x.anclaFin.t1 : a.t1;
          try {
            const v = await mirador.ver(x.documento, a.t0, Math.max(fin, a.t0 + 8), x.frase);
            usd += v.usd;
            poner(x, v.veredicto, `Visto en el recorte: ${v.motivo}`, true);
          } catch (e) {
            poner(x, 'sin_comprobar', `No se pudo mirar el recorte: ${(e as Error).message.slice(0, 120)}`, true);
          }
        } else {
          poner(x, 'sin_comprobar', `Afirmación visual sin recorte que mirar: ${j.motivo}`, true);
        }
        continue;
      }
      poner(x, j.veredicto, j.motivo, j.visual || undefined);
    }
  });
  const orden = new Map(pares.map((x, i) => [`${x.cita}|${x.frase}`, i]));
  juicios.sort((a, b) => (orden.get(`${a.cita}|${a.frase}`) ?? -1) - (orden.get(`${b.cita}|${b.frase}`) ?? -1));
  return { juicios, usd };
}
