/**
 * La verificación y la corrección de la respuesta, con el mismo criterio que el banco:
 * cada marca, por separado, tiene que sostener la frase ENTERA en la que va.
 *
 *   1. Lo literal (determinista): las citas «…» y lo que la frase dice que se nombra tienen
 *      que estar escritos en la prueba.
 *   2. Un modelo barato juzga cada marca frente a su frase y clasifica la frase (hecho,
 *      visual, sonora, interpretación).
 *   3. Lo visual y lo sonoro se vuelve a mirar o a escuchar en el sitio de la prueba.
 *   4. Lo que no está del todo sostenido se corrige: se parte por afirmaciones, se ciñe a
 *      lo que dicen las pruebas, se añaden pruebas del cuaderno o se quita lo que nada
 *      sostiene. Lo corregido se vuelve a juzgar, y las marcas que siguen sin sostener nada
 *      se quitan.
 */
import type { FraseVerificada } from '@scholaris/contrato';
import { contieneLiteral, terminos } from '@scholaris/busqueda';
import { recortar, type ContextoHerramientas } from './contexto.js';
import type { Prueba } from './pruebas.js';
import { pruebaEnAmbito, type Numerador } from './sintesis.js';
import { comprobarEnSitio, tramoDeComprobacion } from './vision.js';

export interface FraseRespuesta {
  /** El texto tal como está en la respuesta (con sus marcas). */
  original: string;
  /** Sin marcas ni Markdown. */
  limpia: string;
  evidencias: string[];
  /** Fila de una tabla (no se le añade la marca de «sin prueba» dentro). */
  tabla: boolean;
}

const MARCA_E = /\[E(\d+)\]/g;

/**
 * Parte un párrafo en oraciones sin cortar dentro de una cita «…» ni de un paréntesis:
 * el corte va tras el punto (y las marcas [E#] que lo siguen), antes de mayúscula o signo de apertura.
 */
export function oracionesDe(parrafo: string): string[] {
  const salida: string[] = [];
  let profundidad = 0;
  let inicio = 0;
  for (let i = 0; i < parrafo.length; i++) {
    const c = parrafo[i]!;
    let cierraOracion = false;
    if (c === '«' || c === '(' || c === '“') profundidad++;
    else if ((c === '»' || c === ')' || c === '”') && profundidad > 0) {
      profundidad--;
      // «… apostamos.» [E8] Después: la cita acababa en punto, la oración también.
      cierraOracion = profundidad === 0 && /[.!?…]\s*$/.test(parrafo.slice(Math.max(0, i - 3), i));
    }
    if (profundidad > 0 || (!cierraOracion && !'.!?…'.includes(c))) continue;
    let j = i + 1;
    // Lo que cierra la oración: comillas, paréntesis y las marcas que van detrás del punto.
    for (;;) {
      const m = /^(?:[»”)\]]|\s*\[E\d+\])/.exec(parrafo.slice(j));
      if (!m) break;
      j += m[0].length;
    }
    const resto = parrafo.slice(j);
    // No se corta ante un paréntesis: tras una cita suele venir su localizador («…» (11:30-12:01) [E34]).
    if (/^\s+[«“"¿¡\p{Lu}]/u.test(resto)) {
      salida.push(parrafo.slice(inicio, j).trim());
      inicio = j;
      i = j - 1;
    }
  }
  const ultimo = parrafo.slice(inicio).trim();
  if (ultimo) salida.push(ultimo);
  return salida;
}

/** Las frases de la respuesta (oraciones de cada párrafo y filas de tabla), sin encabezados ni la lista de pruebas. */
export function frasesDe(markdown: string): FraseRespuesta[] {
  const cuerpo = markdown.replace(/\n#{1,3}\s*(Pruebas|Evidence)\s*\n[\s\S]*$/i, '');
  const salida: FraseRespuesta[] = [];
  for (const linea of cuerpo.split('\n')) {
    const l = linea.trim();
    if (!l || /^#{1,6}\s/.test(l) || /^\|?\s*:?-{3,}/.test(l)) continue;
    const tabla = l.startsWith('|');
    const trozos = tabla ? [l] : oracionesDe(l.replace(/^([-*+]|\d+[.)])\s+/, '').replace(/^>\s*/, ''));
    for (const t of trozos) {
      const evidencias = [...new Set([...t.matchAll(MARCA_E)].map((m) => `E${m[1]}`))];
      const limpia = t.replace(MARCA_E, '').replace(/\*\*|__|`/g, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
      if (limpia.length < 25) continue;
      salida.push({ original: t, limpia, evidencias, tabla });
    }
  }
  return salida;
}

export type VeredictoMarca = 'sostiene' | 'parcial' | 'no_sostiene';
export type ClaseFrase = 'hecho' | 'visual' | 'sonora' | 'interpretacion';

/** Una frase de la respuesta con el juicio de cada una de sus marcas (como el banco: cada marca frente a la frase entera). */
export interface FraseJuzgada extends FraseRespuesta {
  clase: ClaseFrase;
  marcas: Record<string, { veredicto: VeredictoMarca; nota?: string }>;
  nota?: string;
  revisada?: boolean;
  corregida?: boolean;
}

/** Veredicto de la frase entera a partir de los de sus marcas. */
export function veredictoDeFrase(f: Pick<FraseJuzgada, 'clase' | 'marcas' | 'evidencias'>): FraseVerificada['veredicto'] | 'interpretacion' {
  const vs = f.evidencias.map((id) => f.marcas[id]?.veredicto ?? 'sostiene');
  if (!vs.length) return f.clase === 'interpretacion' ? 'interpretacion' : 'sin_prueba';
  if (vs.every((v) => v === 'sostiene')) return 'respaldada';
  if (vs.every((v) => v === 'no_sostiene')) return 'sin_respaldo';
  return 'parcial';
}

/** Lo que la verificación sabe de una prueba citada: su cita y, si es una página o un tramo, el texto entero de la unidad. */
export function textoDePrueba(numerador: Numerador, id: string, maximo = 6000): string {
  const x = numerador.marcada(id);
  if (!x) return '';
  const e = x.evidencia;
  const amb = x.prueba.ambito?.texto;
  const contexto = amb && amb.length > (e.cita?.length ?? 0) + 40 ? `\n   Texto de la unidad: ${recortar(amb, maximo)}` : '';
  return `[${id}] ${e.citaCorta} · ${e.modo}${e.capa === 'percepcion' ? ' (lo que se vio u oyó al mirar)' : ''}${e.nota ? ` (${recortar(e.nota, 160)})` : ''}: ${recortar(e.cita ?? '', 900)}${contexto}`;
}

/** Todo el texto de una prueba citada (para comprobar palabras literales). */
function todoElTexto(numerador: Numerador, id: string): string {
  const x = numerador.marcada(id);
  return x ? `${x.evidencia.cita ?? ''}\n${x.prueba.ambito?.texto ?? ''}\n${x.prueba.evidencia.cita ?? ''}` : '';
}

const VERBOS_NOMBRAR = /\b(?:nombr\w*|mencion\w*|cit[aeo]\w*|alud\w*|dic[ee]n?|dijo|pronunci\w*|llam\w*|se refiere\w*|invoc\w*|explícita\w*|literal\w*|por su nombre)\b/i;

/**
 * Lo que una frase dice que una obra nombra, menciona o dice: siglas («UMAP») y nombres
 * propios que van detrás del verbo. Tienen que estar escritos en la prueba que se cita.
 */
export function nombradosEn(frase: string): string[] {
  const m = VERBOS_NOMBRAR.exec(frase);
  if (!m) return [];
  const despues = frase.slice(m.index).replace(/«[^»]*»/g, ' ');
  const siglas = despues.match(/\b[A-ZÁÉÍÓÚÑ]{2,6}\b/g) ?? [];
  const nombres = despues.slice(m[0].length).match(/(?<![.!?]\s)(?<=\s)\p{Lu}[\p{Ll}]{2,}(?:\s+(?:de\s+(?:la\s+|los\s+)?)?\p{Lu}[\p{Ll}]{2,})*/gu) ?? [];
  return [...new Set([...siglas, ...nombres])].filter((x) => !/^(?:El|La|Los|Las|En|Un|Una|Pero|Sin|Con|Por|Para|Esta|Este|David|Diego)$/.test(x)).slice(0, 6);
}

/**
 * Comprobaciones deterministas de una frase: las citas literales tienen que estar en sus
 * pruebas, y lo que la frase dice que se nombra, también. Devuelve las marcas que no lo cumplen.
 */
export function comprobacionesLiterales(f: FraseRespuesta, numerador: Numerador): Record<string, { veredicto: VeredictoMarca; nota: string }> {
  const salida: Record<string, { veredicto: VeredictoMarca; nota: string }> = {};
  if (!f.evidencias.length) return salida;
  const textos = new Map(f.evidencias.map((id) => [id, todoElTexto(numerador, id)]));
  for (const m of f.original.matchAll(/«([^«»]{12,})»/g)) {
    const cita = (m[1] as string).trim();
    // Una traducción entre paréntesis detrás de la marca no está en la prueba: no cuenta.
    if (new RegExp(`\\]\\s*\\(\\s*«${cita.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(f.original)) continue;
    const en = f.evidencias.filter((id) => contieneLiteral(textos.get(id) ?? '', cita));
    if (!en.length) for (const id of f.evidencias) salida[id] = { veredicto: 'no_sostiene', nota: `La cita «${recortar(cita, 60)}» no está en esta prueba.` };
  }
  for (const nombre of nombradosEn(f.limpia)) {
    const en = f.evidencias.filter((id) => contieneLiteral(textos.get(id) ?? '', nombre));
    if (!en.length) for (const id of f.evidencias) salida[id] = { veredicto: 'no_sostiene', nota: `«${nombre}» no aparece escrito ni dicho en esta prueba.` };
  }
  return salida;
}

const ESQUEMA = {
  type: 'object',
  properties: {
    frases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          clase: { type: 'string', enum: ['hecho', 'visual', 'sonora', 'interpretacion'] },
          marcas: {
            type: 'array',
            items: {
              type: 'object',
              properties: { marca: { type: 'string' }, veredicto: { type: 'string', enum: ['sostiene', 'parcial', 'no_sostiene'] }, nota: { type: 'string' } },
              required: ['marca', 'veredicto'],
            },
          },
          nota: { type: 'string' },
        },
        required: ['i', 'clase', 'marcas'],
      },
    },
  },
  required: ['frases'],
};

const SISTEMA = `Compruebas frase a frase una respuesta académica contra sus pruebas, como un revisor estricto. Para cada frase numerada:
1. «clase»: «visual» si afirma algo que solo se comprueba viendo (planos, encuadre, gestos, objetos, ropa, luz, texto en pantalla); «sonora» si solo oyendo (música, canciones, ruidos, silencio, tono de voz); «hecho» si afirma algo concreto de las obras que se comprueba leyendo (qué pasa, qué dice alguien, qué se nombra, dónde está); «interpretacion» si es comentario, análisis o conclusión razonada.
2. Para CADA marca de la frase, por separado: «sostiene» si esa prueba sola respalda la frase ENTERA (literal o parafraseada con fidelidad); «parcial» si respalda solo una parte (la frase junta varios datos y esta prueba no los tiene todos, exagera o añade algo); «no_sostiene» si no lo dice, dice otra cosa o lo contradice.
3. Lo que la frase dice que alguien nombra, cita o dice tiene que estar literalmente en la prueba. Una afirmación de ausencia («no aparece», «no se menciona») solo se sostiene si la prueba muestra entero el sitio donde debería estar.
Las erratas de OCR o de transcripción no cuentan. Las notas, en español y breves: qué falta o qué no cuadra.`;

/** El juez de las frases (un modelo barato, por lotes de 12): clase y veredicto de cada marca. */
async function juzgarFrases(ctx: ContextoHerramientas, numerador: Numerador, frases: FraseRespuesta[]): Promise<Map<number, { clase: ClaseFrase; marcas: FraseJuzgada['marcas']; nota?: string }>> {
  const modelo = ctx.p.modelos.verificador ?? ctx.p.modelos.agente;
  const salida = new Map<number, { clase: ClaseFrase; marcas: FraseJuzgada['marcas']; nota?: string }>();
  const indices = frases.map((_, i) => i);
  const lotes: number[][] = [];
  for (let k = 0; k < indices.length; k += 12) lotes.push(indices.slice(k, k + 12));
  await Promise.all(lotes.map(async (lote) => {
    const ids = [...new Set(lote.flatMap((i) => frases[i]!.evidencias))];
    const pruebas = ids.map((id) => textoDePrueba(numerador, id)).filter(Boolean).join('\n');
    const lista = lote.map((i) => `${i}. ${frases[i]!.limpia}${frases[i]!.evidencias.length ? ` [marcas: ${frases[i]!.evidencias.join(', ')}]` : ' [sin marcas]'}`).join('\n');
    try {
      const pet = {
        sistema: SISTEMA,
        mensajes: [{ rol: 'usuario' as const, partes: [{ tipo: 'texto' as const, texto: `PRUEBAS:\n${pruebas || '(ninguna)'}\n\nFRASES:\n${lista}` }] }],
        esquema: ESQUEMA, temperatura: 0, pensamiento: 'bajo' as const, maxTokens: 8000, ...(ctx.signal ? { signal: ctx.signal } : {}),
      };
      // Si el modelo barato bloquea el lote (contenido literario delicado), lo juzga el del agente.
      const r = await modelo.turno(pet).catch((e: Error) => {
        if (modelo !== ctx.p.modelos.agente && /bloquead|PROHIBITED|SAFETY/i.test(e.message)) return ctx.p.modelos.agente.turno(pet);
        throw e;
      });
      ctx.cuentas.apuntar(r.uso);
      for (const x of ((r.json as { frases?: Array<{ i: number; clase?: string; marcas?: Array<{ marca: string; veredicto: string; nota?: string }>; nota?: string }> })?.frases ?? [])) {
        if (!lote.includes(x.i)) continue;
        const f = frases[x.i]!;
        const clase = (['hecho', 'visual', 'sonora', 'interpretacion'] as const).find((c) => c === x.clase) ?? 'hecho';
        const marcas: FraseJuzgada['marcas'] = {};
        for (const m of x.marcas ?? []) {
          const id = String(m.marca).replace(/[[\]\s]/g, '').toUpperCase();
          const v = (['sostiene', 'parcial', 'no_sostiene'] as const).find((y) => y === m.veredicto);
          if (f.evidencias.includes(id) && v) marcas[id] = { veredicto: v, ...(m.nota?.trim() ? { nota: m.nota.trim() } : {}) };
        }
        salida.set(x.i, { clase: f.evidencias.length && clase === 'interpretacion' ? 'hecho' : clase, marcas, ...(x.nota?.trim() ? { nota: x.nota.trim() } : {}) });
      }
    } catch (e) {
      ctx.avisos.push(`La verificación de un lote falló: ${(e as Error).message}`);
    }
  }));
  return salida;
}

/** Juzga frases: lo literal (determinista) y después el juez de marcas. */
async function juzgar(ctx: ContextoHerramientas, numerador: Numerador, frases: FraseRespuesta[]): Promise<FraseJuzgada[]> {
  const j = await juzgarFrases(ctx, numerador, frases);
  return frases.map((f, i) => {
    const x = j.get(i);
    const marcas: FraseJuzgada['marcas'] = {};
    // Sin juicio (lote caído): se da por bueno, y la frase se señala.
    for (const id of f.evidencias) marcas[id] = x?.marcas[id] ?? { veredicto: 'sostiene', nota: x ? 'Sin juicio.' : 'Sin verificar.' };
    for (const [id, v] of Object.entries(comprobacionesLiterales(f, numerador))) marcas[id] = v;
    // Tres marcas o más en una frase casi nunca sostienen cada una la frase entera (en el banco,
    // más de la mitad quedaban «parcial»): se corrige siempre, partiéndola.
    if (!f.tabla && new Set(f.evidencias).size >= 3) {
      for (const id of f.evidencias) if (marcas[id]!.veredicto === 'sostiene') marcas[id] = { veredicto: 'parcial', nota: 'La frase junta varias afirmaciones con varias pruebas: hay que partirla.' };
    }
    return { ...f, clase: x?.clase ?? (f.evidencias.length ? 'hecho' : 'interpretacion'), marcas, ...(x?.nota ? { nota: x.nota } : {}) };
  });
}

const VISUAL = /\b(?:planos?|encuadr\w*|cámara|contrapicad\w*|picad\w*|travelling|panorámica|zoom|fotogramas?|se ve[n]?|vemos|en pantalla|mira\w*|gesto\w*|sonr[íi]\w*|llor\w*|viste\w*|ropa|vestid\w*|colores?|luz|ilumina\w*|sombras?|composición|escorzo|fondo|primer término)\b/i;
const SONORA = /\b(?:música|musical|canci[óo]n\w*|suena\w*|se oye\w*|oímos|silencio\w*|ruido\w*|disco\w*|ópera|aria|melodía|piano|tararea\w*|cant[aó]\w*|voz en off|banda sonora|sonido\w*)\b/i;

/**
 * Clase de una frase antes de juzgarla, para poder volver a mirar a la vez que se juzga: visual
 * o sonora si alguna de sus pruebas es de lo que se vio u oyó, o si habla de planos, gestos,
 * música…; si no, un hecho (que se revisa también si dice quién habla).
 */
export function claseProvisional(f: FraseRespuesta, numerador: Numerador): ClaseFrase {
  if (!f.evidencias.length) return 'interpretacion';
  const ms = f.evidencias.map((id) => numerador.marcada(id)).filter((x): x is NonNullable<typeof x> => !!x);
  if (SONORA.test(f.limpia) || ms.some((m) => m.prueba.capa === 'percepcion' && m.evidencia.modo === 'audio')) return 'sonora';
  if (VISUAL.test(f.limpia) || ms.some((m) => m.prueba.capa === 'percepcion' && (m.evidencia.modo === 'video' || m.evidencia.modo === 'imagen'))) return 'visual';
  return 'hecho';
}

type Miradas = Map<number, Record<string, { veredicto: 'si' | 'no' | 'dudoso'; nota: string; sentido: 'ver' | 'escuchar' }>>;

/**
 * Vuelve a mirar o a escuchar el sitio de las pruebas de las frases visuales y sonoras (y de
 * las que dicen quién habla, cuando solo se apoyan en la transcripción). Agrupa por sitio:
 * una llamada comprueba todas las frases de un tramo. Como mucho `sitios` sitios.
 */
async function mirarSitios(ctx: ContextoHerramientas, numerador: Numerador, frases: FraseRespuesta[], clases: ClaseFrase[], sitios: number): Promise<Miradas> {
  const salida: Miradas = new Map();
  const grupos = new Map<string, { prueba: Prueba; sentido: 'ver' | 'escuchar'; frases: Array<{ i: number; marca: string }> }>();
  frases.forEach((f, i) => {
    if (f.tabla) return;
    const clase = clases[i];
    const habla = clase === 'hecho' ? f.evidencias.find((id) => {
      const a = numerador.marcada(id)?.evidencia.ancla;
      return a?.tipo === 'tiempo' && !!a.hablante && f.limpia.toLowerCase().includes(a.hablante.toLowerCase());
    }) : undefined;
    if (clase !== 'visual' && clase !== 'sonora' && !habla) return;
    for (const id of habla ? [habla] : f.evidencias) {
      const m = numerador.marcada(id);
      if (!m || (m.evidencia.ancla.tipo !== 'tiempo' && !(clase === 'visual' && m.evidencia.ancla.tipo === 'pagina' && m.prueba.imagen))) continue;
      const a = m.evidencia.ancla;
      const clave = a.tipo === 'tiempo' ? `${m.evidencia.documento}|${tramoDeComprobacion(a).join('-')}` : `${m.evidencia.documento}|p${a.tipo === 'pagina' ? a.fisica : ''}`;
      const sentido = clase === 'sonora' ? 'escuchar' : 'ver';
      const g = grupos.get(clave) ?? { prueba: { ...m.prueba, evidencia: m.evidencia }, sentido, frases: [] };
      if (g.sentido !== sentido) g.sentido = 'ver'; // mirar también oye
      g.frases.push({ i, marca: id });
      grupos.set(clave, g);
    }
  });
  const lista = [...grupos.values()].sort((a, b) => b.frases.length - a.frases.length).slice(0, Math.max(0, sitios));
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(4, lista.length) }, async () => {
    while (k < lista.length) {
      const g = lista[k++]!;
      try {
        const r = await comprobarEnSitio(ctx, g.prueba, g.frases.map((x) => frases[x.i]!.limpia), g.sentido);
        if (!r) continue;
        r.forEach((v, n) => {
          const { i, marca } = g.frases[n]!;
          const m = salida.get(i) ?? {};
          m[marca] = { ...v, sentido: g.sentido };
          salida.set(i, m);
        });
      } catch (e) {
        ctx.avisos.push(`No se pudo volver a mirar: ${(e as Error).message}`);
      }
    }
  }));
  return salida;
}

/** Lo visto manda: «no» quita el respaldo, «dudoso» lo rebaja y «sí» lo confirma (salvo lo literal, que no se arregla mirando). */
function aplicarMiradas(juzgadas: FraseJuzgada[], miradas: Miradas): void {
  for (const [i, ms] of miradas) {
    const f = juzgadas[i];
    if (!f) continue;
    f.revisada = true;
    for (const [marca, v] of Object.entries(ms)) {
      const antes = f.marcas[marca];
      const verbo = v.sentido === 'ver' ? 'mirar' : 'escuchar';
      if (v.veredicto === 'no') f.marcas[marca] = { veredicto: 'no_sostiene', nota: `Al volver a ${verbo}: ${v.nota}` };
      else if (v.veredicto === 'dudoso' && antes?.veredicto === 'sostiene') f.marcas[marca] = { veredicto: 'parcial', nota: `Al volver a ${verbo}: ${v.nota}` };
      else if (v.veredicto === 'si' && antes && antes.veredicto !== 'no_sostiene') f.marcas[marca] = { veredicto: 'sostiene', nota: `Comprobado al volver a ${verbo}: ${v.nota}` };
    }
  }
}

// ---------------------------------------------------------------------------
// Corrección
// ---------------------------------------------------------------------------

const SISTEMA_CORRECCION = `Corriges frases de una respuesta académica para que cada una diga exactamente lo que prueban sus pruebas. Recibes cada frase con sus marcas [E#], el juicio de cada marca y el texto de las pruebas; a veces, otras pruebas del cuaderno [P#] que podrían servir.
Reglas:
1. Cada marca tiene que sostener ELLA SOLA la frase ENTERA en la que va. Si la frase junta datos que vienen de pruebas distintas, pártela en varias frases cortas, cada una con su marca justo detrás.
2. Ciñe cada afirmación a lo que dice su prueba. Lo que ninguna prueba dice, quítalo; si una de las otras pruebas [P#] lo sostiene entera, puedes usarla con su marca.
3. Las palabras que pongas entre «» tienen que estar copiadas tal cual de la prueba que citas. Nunca digas que alguien nombra, dice o muestra algo que no esté escrito en la prueba.
4. Lo visual y lo sonoro, solo como lo describe la prueba de lo que se vio u oyó; si al volver a mirar no se vio, quítalo.
5. Una conclusión que junta varias pruebas puede quedarse como interpretación explícita («cabe leerlo como…»), sin marca.
6. Sin páginas, folios ni minutos en el texto: el sitio lo dan las marcas. Mismo idioma, registro y ortografía impecable; rayas según la RAE.
7. Si no queda nada que se pueda sostener, devuelve el texto vacío.
Devuelve solo el texto nuevo de cada frase (puede ser más de una frase).`;

const ESQUEMA_CORRECCION = {
  type: 'object',
  properties: { frases: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, texto: { type: 'string' } }, required: ['i', 'texto'] } } },
  required: ['frases'],
};

/** Las pruebas del cuaderno que más se parecen a una frase (para sostener lo que falta). */
function candidatas(ctx: ContextoHerramientas, numerador: Numerador, f: FraseRespuesta, n = 4): Prueba[] {
  const ts = new Set(terminos(f.limpia));
  if (ts.size < 2) return [];
  const yaCitadas = new Set(f.evidencias.map((id) => numerador.marcada(id)?.prueba.id));
  return ctx.pruebas.todas()
    .filter((p) => !yaCitadas.has(p.id) && pruebaEnAmbito(ctx, p))
    .map((p) => ({ p, n: new Set(terminos(`${p.evidencia.cita ?? ''} ${p.nota ?? ''}`).filter((t) => ts.has(t))).size }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, n)
    .map((x) => x.p);
}

/** ¿Las citas literales de un texto nuevo están en las pruebas que puede citar? */
function citasEn(textoNuevo: string, permitidos: string[]): boolean {
  for (const m of textoNuevo.matchAll(/«([^«»]{12,})»/g)) if (!permitidos.some((t) => contieneLiteral(t, (m[1] as string).trim()))) return false;
  return true;
}

/**
 * Corrige las frases que no están del todo sostenidas: las parte por afirmaciones, las
 * ciñe a sus pruebas, añade pruebas del cuaderno o quita lo que nada sostiene. Devuelve el
 * Markdown nuevo y las frases que cambiaron.
 */
async function corregir(ctx: ContextoHerramientas, numerador: Numerador, markdown: string, juzgadas: FraseJuzgada[]): Promise<{ markdown: string; cambiadas: string[] }> {
  // Un modelo rápido: corregir es ceñir y partir frases, no investigar (y la latencia cuenta).
  const modelo = ctx.p.modelos.corrector ?? ctx.p.modelos.verificador ?? ctx.p.modelos.redactor ?? ctx.p.modelos.agente;
  const pendientes = juzgadas
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !f.tabla && (f.evidencias.some((id) => f.marcas[id]?.veredicto !== 'sostiene') || (!f.evidencias.length && f.clase !== 'interpretacion')));
  if (!pendientes.length) return { markdown, cambiadas: [] };
  const extra = new Map(pendientes.map(({ f, i }) => [i, candidatas(ctx, numerador, f)]));
  const lotes: Array<typeof pendientes> = [];
  for (let k = 0; k < pendientes.length; k += 8) lotes.push(pendientes.slice(k, k + 8));
  const nuevos = new Map<number, string>();
  await Promise.all(lotes.map(async (lote) => {
    const bloques = lote.map(({ f, i }) => {
      const juicio = f.evidencias.map((id) => `${id}: ${f.marcas[id]?.veredicto ?? 'sostiene'}${f.marcas[id]?.nota ? ` (${f.marcas[id]!.nota})` : ''}`).join('; ') || (f.clase === 'interpretacion' ? 'sin marcas (interpretación)' : 'afirma un hecho sin ninguna marca');
      const propias = f.evidencias.map((id) => textoDePrueba(numerador, id, 3000)).join('\n');
      const otras = (extra.get(i) ?? []).map((p) => `[${p.id}] ${recortar(p.evidencia.cita ?? '', 700)}${p.ambito && p.ambito.texto.length > (p.evidencia.cita?.length ?? 0) + 40 ? `\n   Texto de la unidad: ${recortar(p.ambito.texto, 2000)}` : ''}`).join('\n');
      return `### Frase ${i}\n${f.original}\nJuicio: ${juicio}\nSus pruebas:\n${propias || '(ninguna)'}${otras ? `\nOtras pruebas del cuaderno:\n${otras}` : ''}`;
    }).join('\n\n');
    try {
      const r = await modelo.turno({
        sistema: SISTEMA_CORRECCION,
        mensajes: [{ rol: 'usuario', partes: [{ tipo: 'texto', texto: `Idioma de la respuesta: ${ctx.idioma}.\n\n${bloques}` }] }],
        esquema: ESQUEMA_CORRECCION, temperatura: 0.2, pensamiento: 'bajo', maxTokens: 8000, ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      ctx.cuentas.apuntar(r.uso);
      for (const x of ((r.json as { frases?: Array<{ i: number; texto: string }> })?.frases ?? [])) if (lote.some((l) => l.i === x.i)) nuevos.set(x.i, String(x.texto ?? '').trim());
    } catch (e) {
      ctx.avisos.push(`La corrección de un lote falló: ${(e as Error).message}`);
    }
  }));
  let salida = markdown;
  const cambiadas: string[] = [];
  for (const { f, i } of pendientes) {
    if (!nuevos.has(i)) continue;
    let nuevo = nuevos.get(i)!;
    // Solo valen sus propias marcas y las de las pruebas que se le ofrecieron.
    const ofrecidas = new Set((extra.get(i) ?? []).map((p) => p.id));
    nuevo = nuevo.replace(/\[\s*([EP]\d+(?:\s*[,;]\s*[EP]\d+)*)\s*\]/gi, (_, c: string) => c.split(/\s*[,;]\s*/).map((x) => x.toUpperCase()).filter((x) => f.evidencias.includes(x) || ofrecidas.has(x)).map((x) => `[${x}]`).join(''));
    const textos = [...f.evidencias.map((id) => todoElTexto(numerador, id)), ...(extra.get(i) ?? []).map((p) => `${p.evidencia.cita ?? ''}\n${p.ambito?.texto ?? ''}`)];
    // Una frase nueva con una cita que no está en ninguna de sus pruebas se cae; el resto de la corrección vale.
    nuevo = oracionesDe(nuevo).filter((o) => citasEn(o, textos)).join(' ');
    if (!nuevo && nuevos.get(i)) continue; // todo lo nuevo era inventado: se queda la frase de antes (y su juicio)
    // Las pruebas nuevas entran en la numeración (y se estrechan a su cita, si la llevan).
    nuevo = numerador.sustituir(nuevo).replace(/\s+([.,;:])/g, '$1').trim();
    const pos = salida.indexOf(f.original);
    if (pos < 0) continue;
    salida = `${salida.slice(0, pos)}${nuevo}${salida.slice(pos + f.original.length)}`;
    if (nuevo) cambiadas.push(nuevo);
    f.corregida = true;
  }
  // Lo borrado deja huecos: espacios dobles y líneas de lista vacías.
  salida = salida.replace(/[ \t]{2,}/g, ' ').replace(/^\s*[-*]\s*$/gm, '').replace(/\n{3,}/g, '\n\n');
  return { markdown: salida, cambiadas };
}

export interface ResultadoVerificacion {
  /** La respuesta corregida (sin la lista de pruebas). */
  markdown: string;
  frases: FraseVerificada[];
  detalle: Array<FraseRespuesta & { veredicto: FraseVerificada['veredicto'] | 'interpretacion'; nota?: string; revisada?: boolean }>;
  /** Frases corregidas. */
  correcciones: number;
}

/**
 * Verifica y corrige: juzga cada marca frente a su frase, vuelve a mirar lo visual y lo
 * sonoro (`sitios` sitios como mucho), corrige lo que no está del todo sostenido, vuelve a
 * juzgar lo corregido y, al final, quita las marcas que siguen sin sostener nada.
 */
export async function verificar(ctx: ContextoHerramientas, numerador: Numerador, markdown: string, opciones: number | { sitios: number; corregir?: boolean }): Promise<ResultadoVerificacion> {
  const o = typeof opciones === 'number' ? { sitios: opciones, corregir: true } : { corregir: true, ...opciones };
  // Se juzga y, a la vez, se vuelve a mirar lo que parece visual o sonoro.
  const iniciales = frasesDe(markdown);
  const [juzgadasIniciales, miradas] = await Promise.all([
    juzgar(ctx, numerador, iniciales),
    mirarSitios(ctx, numerador, iniciales, iniciales.map((f) => claseProvisional(f, numerador)), o.sitios),
  ]);
  let juzgadas = juzgadasIniciales;
  aplicarMiradas(juzgadas, miradas);
  let texto = markdown;
  let correcciones = 0;
  if (o.corregir) {
    const c = await corregir(ctx, numerador, texto, juzgadas);
    texto = c.markdown;
    correcciones = juzgadas.filter((f) => f.corregida).length;
    if (correcciones) {
      // Lo corregido se vuelve a juzgar (sin volver a corregir); lo demás conserva su juicio.
      const previas = new Map(juzgadas.filter((f) => !f.corregida).map((f) => [f.original, f]));
      const frases = frasesDe(texto);
      const nuevas = frases.filter((f) => !previas.has(f.original));
      const rejuzgadas = new Map((await juzgar(ctx, numerador, nuevas)).map((f) => [f.original, f]));
      juzgadas = frases.map((f) => previas.get(f.original) ?? rejuzgadas.get(f.original) ?? { ...f, clase: 'hecho' as const, marcas: {} });
    }
  }
  // Una marca que sigue sin sostener nada se quita: citar una prueba que no dice eso es peor que no
  // citar. Si no le queda ninguna, la frase se queda sin marcas y se señala «sin prueba».
  for (const f of juzgadas) {
    const malas = f.evidencias.filter((id) => f.marcas[id]?.veredicto === 'no_sostiene');
    if (!malas.length) continue;
    if (malas.length === f.evidencias.length) f.clase = f.clase === 'interpretacion' ? 'hecho' : f.clase;
    let nueva = f.original;
    for (const id of malas) nueva = nueva.split(`[${id}]`).join('');
    const pos = texto.indexOf(f.original);
    if (pos >= 0) texto = `${texto.slice(0, pos)}${nueva.replace(/\s+([.,;:])/g, '$1')}${texto.slice(pos + f.original.length)}`;
    f.evidencias = f.evidencias.filter((id) => !malas.includes(id));
    f.original = nueva;
  }
  const detalle = juzgadas.map((f) => {
    const v = veredictoDeFrase(f);
    const notas = Object.values(f.marcas).filter((x) => x.veredicto !== 'sostiene' && x.nota).map((x) => x.nota!);
    const nota = notas[0] ?? f.nota;
    return { ...f, veredicto: v, ...(nota ? { nota } : {}), ...(f.revisada ? { revisada: true } : {}) };
  });
  const frases: FraseVerificada[] = detalle
    .filter((d) => d.veredicto !== 'interpretacion')
    .map((d) => ({ frase: d.limpia, evidencias: d.evidencias, veredicto: d.veredicto as FraseVerificada['veredicto'], ...(d.nota ? { nota: d.nota } : {}), ...(d.revisada ? { revisada: true } : {}) }));
  return { markdown: texto, frases, detalle, correcciones };
}

/** Confianza de la respuesta según la verificación. */
export function confianzaDe(frases: FraseVerificada[]): 'alta' | 'media' | 'baja' {
  const conCita = frases.filter((f) => f.evidencias.length);
  if (!conCita.length) return 'baja';
  const buenas = conCita.filter((f) => f.veredicto === 'respaldada').length;
  const malas = frases.filter((f) => f.veredicto === 'sin_respaldo' || f.veredicto === 'sin_prueba').length;
  const r = buenas / conCita.length;
  if (r >= 0.85 && malas <= 1) return 'alta';
  if (r >= 0.6) return 'media';
  return 'baja';
}

/** Marca en el texto las frases sin respaldo o sin prueba (fuera de las tablas). */
export function marcarSinPrueba(markdown: string, detalle: Array<FraseRespuesta & { veredicto: string }>): string {
  let salida = markdown;
  for (const d of detalle) {
    if (d.tabla || (d.veredicto !== 'sin_respaldo' && d.veredicto !== 'sin_prueba')) continue;
    const i = salida.indexOf(d.original);
    if (i < 0) continue;
    const fin = i + d.original.length;
    salida = `${salida.slice(0, fin)} [sin prueba]${salida.slice(fin)}`;
  }
  return salida;
}
