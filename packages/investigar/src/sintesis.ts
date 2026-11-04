/**
 * La redacción: el modelo escribe con el cuaderno de pruebas delante y solo puede
 * citar sus marcas [P#]. Según llega el texto, cada marca se convierte en [E1],
 * [E2]… (por orden de aparición); si va justo detrás de una cita literal «…», la
 * prueba se estrecha a esas palabras (caracteres o segundos exactos). Las marcas
 * que no existen se quitan y se cuentan.
 */
import type { EvidenciaInvestigacion, PlanInvestigacion } from '@scholaris/contrato';
import { pasajeSiResponde, terminos } from '@scholaris/busqueda';
import { frasesDe } from './verificacion.js';
import { flujoDe, type ModeloAgente } from './modelo.js';
import { fichaDe, lineaPrueba, recortar, type ContextoHerramientas, type Nota } from './contexto.js';
import { estrechar, vistaPrueba, type Prueba } from './pruebas.js';

/** [P3], [P3, P8] y también con un localizador dentro («[P3, p. 14]», «[P5: 1:02:03]»), que se quita. */
const MARCA = /\[\s*(P\d+\b[^[\]\n]{0,80}?)\s*\]/gi;

/** Una cita literal justo antes de la marca («…» o “…”), si la hay. */
export function citaPrevia(previo: string): string | null {
  const m = /[«“"]([^«»“”"]{3,800})[»”"]\s*[,.;:]?\s*$/.exec(previo);
  return m ? (m[1] as string).trim() : null;
}

interface Marcada {
  id: string;
  prueba: Prueba;
  cita?: string;
  evidencia: EvidenciaInvestigacion;
  /** La cita literal se encontró en la prueba (si no, la evidencia es la prueba entera). */
  estrechada: boolean;
  /** Sin cita literal, se estrechó a las oraciones de la unidad que sostienen las frases que la citan. */
  afinada?: boolean;
}

/** Numera las pruebas citadas (E1, E2…) y estrecha las anclas a las citas literales. */
export class Numerador {
  readonly marcadas: Marcada[] = [];
  private readonly porClave = new Map<string, Marcada>();
  descartadas: string[] = [];
  /** Citas cuya marca se cambió a la prueba donde está la cita de verdad. */
  reanclados = 0;
  /** Citas literales que no están en la prueba que citan. */
  literalesNoEncontrados: Array<{ cita: string; prueba: string }> = [];

  constructor(private ctx: ContextoHerramientas, private urlDe: (p: Prueba) => string | undefined = () => undefined) {}

  /** Sustituye el contenido de una marca; `previo` es el texto crudo anterior (para ver si va detrás de una cita). */
  resolver(contenido: string, previo: string): { texto: string; nuevas: Record<string, string> } {
    const ids = [...new Set((contenido.match(/\bP\d+\b/gi) ?? []).map((x) => x.toUpperCase()))];
    const cita = citaPrevia(previo);
    const salida: string[] = [];
    const nuevas: Record<string, string> = {};
    let citaUsada = false;
    for (const pid of ids) {
      let p = this.ctx.pruebas.obtener(pid);
      if (!p) { this.descartadas.push(pid); continue; }
      let e: ReturnType<typeof estrechar> = null;
      if (cita && !citaUsada) {
        e = estrechar(p, cita);
        // La cita no está en esa prueba pero sí en otra del mismo documento (la página o el tramo de
        // al lado, que el redactor confundió): la marca pasa a la prueba donde está de verdad.
        if (!e) {
          for (const otra of this.ctx.pruebas.todas()) {
            if (otra.id === p.id || otra.evidencia.documento !== p.evidencia.documento || !otra.ambito) continue;
            const x = estrechar(otra, cita);
            if (x) { e = x; p = otra; this.reanclados++; break; }
          }
        }
        if (e) citaUsada = true;
      }
      // La misma cita en el mismo sitio es una sola evidencia, aunque llegue por dos pruebas (buscar y leer).
      const ev = e ? { ancla: e.ancla, cita: e.cita } : { ancla: p.evidencia.ancla, cita: p.evidencia.cita ?? '' };
      const clave = `${p.evidencia.documento}|${JSON.stringify(ev.ancla)}|${ev.cita.toLowerCase().replace(/\s+/g, ' ').slice(0, 200)}`;
      let m = this.porClave.get(clave);
      if (!m) {
        const id = `E${this.marcadas.length + 1}`;
        const base: Prueba = e ? { ...p, evidencia: { ...p.evidencia, ancla: e.ancla, ...(e.anclaFin ? { anclaFin: e.anclaFin } : {}), cita: e.cita } } : p;
        const url = this.urlDe(p);
        m = { id, prueba: p, ...(e ? { cita: e.cita } : {}), evidencia: vistaPrueba(base, fichaDe(this.ctx, p.evidencia.documento), { id, ...(url ? { imagenUrl: url } : {}) }), estrechada: !!e };
        this.marcadas.push(m);
        this.porClave.set(clave, m);
        nuevas[id] = p.id;
      }
      if (!salida.includes(m.id)) salida.push(m.id);
    }
    if (cita && !citaUsada && ids.some((x) => this.ctx.pruebas.obtener(x))) this.literalesNoEncontrados.push({ cita, prueba: ids.join(',') });
    return { texto: salida.map((x) => `[${x}]`).join(''), nuevas };
  }

  /** Sustituye todas las marcas de un texto entero (sin flujo). */
  sustituir(textoCrudo: string): string {
    let salida = '';
    let ultimo = 0;
    for (const m of textoCrudo.matchAll(MARCA)) {
      const i = m.index ?? 0;
      salida += textoCrudo.slice(ultimo, i);
      salida += this.resolver(m[1] as string, textoCrudo.slice(0, i)).texto;
      ultimo = i + m[0].length;
    }
    return salida + textoCrudo.slice(ultimo);
  }

  evidencia(id: string): EvidenciaInvestigacion | undefined {
    return this.marcadas.find((m) => m.id === id)?.evidencia;
  }

  marcada(id: string): Marcada | undefined {
    return this.marcadas.find((m) => m.id === id);
  }
}

/**
 * Una página o un tramo citado sin cita literal es un ancla gruesa (una página entera, a
 * veces dos). Si la cita una sola frase, se estrecha a las oraciones de esa unidad que casan
 * con ella (de una a tres, con al menos dos términos en común); si no, se queda entera.
 */
export function afinar(numerador: Numerador, ctx: ContextoHerramientas, markdown: string): number {
  const frases = frasesDe(markdown);
  let n = 0;
  for (const m of numerador.marcadas) {
    const amb = m.prueba.ambito;
    if (m.estrechada || !amb || amb.texto.length < 400) continue;
    // Solo si la cita una frase: si varias la citan por cosas distintas de la página, la página entera es lo honrado.
    const deEsta = frases.filter((f) => f.evidencias.includes(m.id));
    if (deEsta.length !== 1) continue;
    const citan = deEsta[0]!.limpia;
    const ts = [...new Set(terminos(citan))];
    if (ts.length < 2) continue;
    const p = pasajeSiResponde(amb.texto, ts);
    if (!p?.texto) continue;
    const e = estrechar(m.prueba, p.texto);
    if (!e) continue;
    const base: Prueba = { ...m.prueba, evidencia: { ...m.prueba.evidencia, ancla: e.ancla, ...(e.anclaFin ? { anclaFin: e.anclaFin } : {}), cita: e.cita } };
    m.evidencia = { ...vistaPrueba(base, fichaDe(ctx, m.prueba.evidencia.documento), { id: m.id, ...(m.evidencia.imagenUrl ? { imagenUrl: m.evidencia.imagenUrl } : {}) }) };
    m.afinada = true;
    n++;
  }
  return n;
}

const NOMBRES_IDIOMA: Record<string, string> = { es: 'español', en: 'inglés', fr: 'francés', it: 'italiano', pt: 'portugués', de: 'alemán', la: 'latín', ca: 'catalán', gl: 'gallego', eu: 'euskera' };
export const nombreIdioma = (i: string) => NOMBRES_IDIOMA[i.slice(0, 2).toLowerCase()] ?? i;

export function sistemaRedaccion(idioma: string): string {
  return `Eres un investigador que escribe la respuesta a una pregunta académica con las pruebas reunidas en un cuaderno. Escribes en ${nombreIdioma(idioma)}, en registro académico, con ortografía impecable.

Reglas obligatorias:
1. Una afirmación por frase, y frases cortas. La marca va al FINAL de la frase, nunca en medio: «…lo que dice la prueba [P3].». Cada marca tiene que sostener ELLA SOLA la frase ENTERA: si dos datos salen de dos pruebas distintas, escríbelos en dos frases, cada una con su marca. Mal: «La escena muestra la calle [P1], gente en la acera [P2] y un mural [P3].» Bien: «La escena empieza en la calle [P1]. Se ve gente en la acera [P2]. Al fondo hay un mural [P3].» Solo existen las marcas del cuaderno; nunca inventes marcas, autores ni años.
2. Nunca escribas en el texto (ni en los títulos ni en las tablas) páginas, folios, minutos ni tramos de tiempo: el sitio exacto lo dan las marcas. Nada de «(p. 14)», «en el minuto 9:36» ni «(1:45:03-1:45:50)».
3. Cuando cites palabras de una obra, cópialas EXACTAS entre comillas latinas, en su lengua original, y pon la marca justo detrás: «tal cual» [P3]. Si la lengua de la cita no es la de la respuesta, añade detrás su traducción entre paréntesis: «original» [P3] («traducción»). Si dices que una obra o un personaje nombra, menciona o dice algo, esas palabras tienen que estar escritas en la prueba que citas.
4. Lo que se ve o se oye (planos, encuadre, quién domina la imagen, gestos, objetos, música, silencio) solo como lo describe una prueba de lo que se vio o se oyó, sin añadir objetos, músicas, gestos ni detalles que la prueba no diga. No afines más que la prueba (qué mano, qué parte de la cara, cuántos objetos, la escala exacta) salvo que lo diga y haga falta. Lo dicho en un diálogo no prueba cómo está filmado.
5. Las conclusiones y comparaciones que juntan varias pruebas van en frases propias, presentadas como interpretación («cabe leerlo como…», «así, …»), sin marcas o con una marca que las sostenga enteras. Nunca presentes como hecho lo que no está probado. Si las pruebas no bastan para una parte, dilo («no he podido comprobar…»). No afirmes que algo no aparece o no ocurre porque no esté en el cuaderno: la transcripción y el texto pueden tener huecos.
6. Extensión: la que pida la pregunta. Cubre todo lo que pregunta (cada parte, cada caso, cada motivo que den las pruebas), sin repetir y sin relleno. Si tiene varias partes, dedica a cada una su apartado (###) y cierra con una conclusión breve. Cuando compares, puedes cerrar con una tabla que resuma lo ya dicho y citado en el texto; las tablas van sin marcas y no añaden nada que el texto no diga (ni un dato más, ni lo que el texto descarta).
7. No hables de herramientas, del cuaderno ni de marcas P: escribe como en un artículo, citando así.
8. Rayas según la RAE: nunca un guion largo con espacios a los dos lados como en inglés; prefiere comas o paréntesis.`;
}

/** ¿Entra la prueba en la redacción? Las de obras ajenas al plan, solo si el agente las pidió. */
export function pruebaEnAmbito(ctx: ContextoHerramientas, p: Prueba): boolean {
  const plan = ctx.documentosPlan;
  if (!plan?.length) return true;
  return plan.includes(p.evidencia.documento) || !!ctx.pedidos?.has(p.evidencia.documento);
}

export function textoCuaderno(ctx: ContextoHerramientas): string {
  const porDoc = new Map<string, Prueba[]>();
  for (const p of ctx.pruebas.todas()) {
    if (!pruebaEnAmbito(ctx, p)) continue;
    const l = porDoc.get(p.evidencia.documento) ?? [];
    l.push(p);
    porDoc.set(p.evidencia.documento, l);
  }
  // Las páginas y los tramos leídos enteros van con su texto entero (hasta un tope por
  // prueba y otro para todo el cuaderno): de ahí salen las citas literales.
  let presupuesto = 180_000;
  const linea = (p: Prueba): string => {
    const amb = p.ambito;
    const leida = amb && p.herramienta === 'leer' && amb.texto.length > (p.evidencia.cita?.length ?? 0) + 20;
    if (!leida || presupuesto <= 0) return lineaPrueba(ctx, p, amb && p.evidencia.cita && p.evidencia.cita.length > 600 ? 1200 : 700);
    const entero = amb.texto.length > 4500 ? `${amb.texto.slice(0, 4500)}…` : amb.texto;
    presupuesto -= entero.length;
    const cabecera = lineaPrueba(ctx, { ...p, evidencia: { ...p.evidencia, cita: '' } }, 0);
    return `${cabecera}\n«${entero}»`;
  };
  const bloques: string[] = [];
  for (const [doc, ps] of porDoc) {
    const f = fichaDe(ctx, doc);
    bloques.push(`### ${f ? `«${f.titulo}» (${f.autor}, ${f.anio})${f.idioma ? `, en ${nombreIdioma(f.idioma)}` : ''}` : doc}\n\n${ps.map(linea).join('\n\n')}`);
  }
  return bloques.join('\n\n');
}

export function peticionRedaccion(ctx: ContextoHerramientas, pregunta: string, plan: PlanInvestigacion | null, notas: Nota[], reflexion: string, idioma: string) {
  const planTxt = plan ? `Enfoque: ${plan.enfoque}\nSubpreguntas:\n${plan.subpreguntas.map((s, i) => `${i + 1}. ${s.pregunta}`).join('\n')}` : '';
  const notasTxt = notas.length ? `Hallazgos e hipótesis apuntados durante la investigación:\n${notas.map((n) => `- (${n.tipo}) ${n.texto}${n.pruebas.length ? ` [${n.pruebas.join(', ')}]` : ''}`).join('\n')}` : '';
  return {
    sistema: sistemaRedaccion(idioma),
    mensajes: [{
      rol: 'usuario' as const,
      partes: [{
        tipo: 'texto' as const,
        texto: [
          `PREGUNTA: ${pregunta}`,
          planTxt,
          notasTxt,
          reflexion ? `Lo que el investigador concluyó al terminar de buscar:\n${recortar(reflexion, 4000)}` : '',
          `CUADERNO DE PRUEBAS (cada prueba con su marca; las de páginas y tramos traen su texto entero o su principio: cita de ahí las palabras exactas):\n\n${textoCuaderno(ctx)}`,
          `Escribe ahora la respuesta en ${nombreIdioma(idioma)}, en Markdown, citando con las marcas [P#].`,
        ].filter(Boolean).join('\n\n'),
      }],
    }],
  };
}

/**
 * Escribe la respuesta por trozos. Cada trozo sale con sus marcas ya convertidas
 * (y las nuevas, E → P). Retiene lo que empieza por «[» hasta que se cierra.
 */
export async function* redactar(
  ctx: ContextoHerramientas, numerador: Numerador, pregunta: string, plan: PlanInvestigacion | null, notas: Nota[], reflexion: string, idioma: string,
  o: { modelo?: ModeloAgente; estado?: { fin?: string } } = {},
): AsyncGenerator<{ delta: string; marcas: Record<string, string> }> {
  const modelo = o.modelo ?? ctx.p.modelos.redactor ?? ctx.p.modelos.agente;
  const pet = peticionRedaccion(ctx, pregunta, plan, notas, reflexion, idioma);
  let crudo = '';
  let pendiente = '';
  const emitir = (final: boolean): { delta: string; marcas: Record<string, string> } | null => {
    let corte = pendiente.length;
    const abierto = pendiente.lastIndexOf('[');
    if (!final && abierto !== -1 && pendiente.indexOf(']', abierto) === -1 && pendiente.length - abierto < 60) corte = abierto;
    const listo = pendiente.slice(0, corte);
    pendiente = pendiente.slice(corte);
    if (!listo) return null;
    const marcas: Record<string, string> = {};
    let salida = '';
    let ultimo = 0;
    const base = crudo.length - pendiente.length - listo.length;
    for (const m of listo.matchAll(MARCA)) {
      const i = m.index ?? 0;
      salida += listo.slice(ultimo, i);
      const r = numerador.resolver(m[1] as string, crudo.slice(0, base + i));
      Object.assign(marcas, r.nuevas);
      salida += r.texto;
      ultimo = i + m[0].length;
    }
    salida += listo.slice(ultimo);
    return { delta: salida, marcas };
  };
  for await (const trozo of flujoDe(modelo, { ...pet, temperatura: 0.4, maxTokens: 12_000, pensamiento: 'bajo', ...(ctx.signal ? { signal: ctx.signal } : {}) }, ctx.cuentas, o.estado)) {
    crudo += trozo;
    pendiente += trozo;
    const x = emitir(false);
    if (x) yield x;
  }
  const x = emitir(true);
  if (x) yield x;
}
