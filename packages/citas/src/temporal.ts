/**
 * Lógica temporal de las citas, en código y no en el modelo (lo recomienda la
 * propia documentación de Jev: nada de comparar fechas con un modelo). Portada de
 * autocite_service.py (TEMPORAL_KEYWORDS, NOTABLE_SCHOLARS_YEARS, términos
 * modernos y regla de aplicación de marco) y afinada:
 *
 * - El año de la fuente es el de la obra original (`anioOriginal`), no el de la
 *   edición: una traducción de 2002 de un libro de 1975 piensa en 1975.
 * - La cronología inversa solo se aplica a lo que va DESPUÉS de la palabra clave
 *   («Lewis anticipó a Kuhn»: Kuhn es el objeto), y solo si el sujeto es la
 *   fuente (su autor aparece antes de la palabra clave, o no aparece nadie).
 * - Con palabras de dependencia hacia atrás («se basó en», «built upon») y un
 *   año del objeto posterior a la fuente, la cita es imposible: un libro de 1964
 *   no puede basarse en uno de 1967.
 */
import type { RelacionCita } from '@scholaris/nucleo';

type Direccion = 'adelante' | 'atras';
type Fuerza = 'fuerte' | 'moderada' | 'debil';

/** Frase → (dirección, fuerza). «adelante»: la fuente influyó en lo posterior. */
export const CLAVES_TEMPORALES: Record<string, [Direccion, Fuerza]> = {
  // inglés, hacia delante
  anticipated: ['adelante', 'fuerte'], foreshadowed: ['adelante', 'fuerte'], preceded: ['adelante', 'fuerte'], predated: ['adelante', 'fuerte'],
  'laid the groundwork': ['adelante', 'fuerte'], 'paved the way': ['adelante', 'fuerte'], influenced: ['adelante', 'moderada'], 'led to': ['adelante', 'moderada'],
  inspired: ['adelante', 'moderada'], 'gave rise to': ['adelante', 'moderada'], 'set the stage': ['adelante', 'moderada'], 'was a precursor to': ['adelante', 'fuerte'],
  prefigured: ['adelante', 'fuerte'], 'would later become': ['adelante', 'moderada'], 'later developed into': ['adelante', 'moderada'],
  'eventually evolved into': ['adelante', 'moderada'], 'planted the seeds': ['adelante', 'moderada'],
  // inglés, hacia atrás
  'was based on': ['atras', 'moderada'], 'built upon': ['atras', 'moderada'], 'builds on': ['atras', 'moderada'], 'extended the work of': ['atras', 'moderada'],
  'drew on': ['atras', 'moderada'], 'derived from': ['atras', 'moderada'], 'rooted in': ['atras', 'moderada'], 'traces back to': ['atras', 'moderada'],
  'originated from': ['atras', 'moderada'], 'can be traced to': ['atras', 'moderada'], 'responded to': ['atras', 'moderada'], 'criticized': ['atras', 'debil'],
  // español, hacia delante
  anticipó: ['adelante', 'fuerte'], anticipa: ['adelante', 'fuerte'], precedió: ['adelante', 'fuerte'], 'sentó las bases': ['adelante', 'fuerte'], 'abrió camino': ['adelante', 'fuerte'],
  'abrió el camino': ['adelante', 'fuerte'], 'influyó en': ['adelante', 'moderada'], 'condujo a': ['adelante', 'moderada'], inspiró: ['adelante', 'moderada'],
  'dio origen a': ['adelante', 'moderada'], prefiguró: ['adelante', 'fuerte'], 'allanó el camino': ['adelante', 'fuerte'], 'fue precursor de': ['adelante', 'fuerte'],
  'fue precursora de': ['adelante', 'fuerte'],
  // español, hacia atrás
  'se basó en': ['atras', 'moderada'], 'se basa en': ['atras', 'moderada'], 'se fundamentó en': ['atras', 'moderada'], 'derivó de': ['atras', 'moderada'],
  'tiene sus raíces en': ['atras', 'moderada'], 'se remonta a': ['atras', 'moderada'], 'responde a': ['atras', 'debil'], 'respondió a': ['atras', 'moderada'],
  'criticó': ['atras', 'moderada'], 'critica a': ['atras', 'moderada'], 'retomó': ['atras', 'moderada'], 'siguiendo a': ['atras', 'moderada'],
  // francés
  'a anticipé': ['adelante', 'fuerte'], 'a précédé': ['adelante', 'fuerte'], 'a jeté les bases': ['adelante', 'fuerte'], 'a ouvert la voie': ['adelante', 'fuerte'],
  'a influencé': ['adelante', 'moderada'], 'a conduit à': ['adelante', 'moderada'], 'a inspiré': ['adelante', 'moderada'], 'a donné naissance à': ['adelante', 'moderada'],
  'a préfiguré': ['adelante', 'fuerte'], "s'est fondé sur": ['atras', 'moderada'], "s'est appuyé sur": ['atras', 'moderada'], 'dérivé de': ['atras', 'moderada'],
  'trouve ses racines dans': ['atras', 'moderada'], 'remonte à': ['atras', 'moderada'],
  // italiano
  'ha anticipato': ['adelante', 'fuerte'], 'ha preceduto': ['adelante', 'fuerte'], 'ha gettato le basi': ['adelante', 'fuerte'], 'ha aperto la strada': ['adelante', 'fuerte'],
  'ha influenzato': ['adelante', 'moderada'], 'ha portato a': ['adelante', 'moderada'], 'ha ispirato': ['adelante', 'moderada'], 'ha dato origine a': ['adelante', 'moderada'],
  'ha prefigurato': ['adelante', 'fuerte'], 'si è basato su': ['atras', 'moderada'], 'derivato da': ['atras', 'moderada'], 'affonda le radici in': ['atras', 'moderada'],
  'risale a': ['atras', 'moderada'],
};

/** Autores muy citados y el año de su obra clave: fecha la mención aunque no haya año. */
export const AUTORES_NOTABLES: Record<string, number> = {
  kuhn: 1962, popper: 1934, lakatos: 1970, feyerabend: 1975, koyré: 1939, koyre: 1939, butterfield: 1949, dijksterhuis: 1950,
  wittgenstein: 1921, heidegger: 1927, derrida: 1967, foucault: 1966, rorty: 1979, rawls: 1971, quine: 1951,
  barthes: 1967, tolkien: 1937, frye: 1957, chomsky: 1957, saussure: 1916, 'de saussure': 1916,
  piaget: 1936, skinner: 1938, jung: 1921, freud: 1899, barfield: 1928, tillyard: 1942, lovejoy: 1936,
  einstein: 1905, darwin: 1859, copernicus: 1543, copérnico: 1543, galileo: 1632, newton: 1687,
  // añadidos para humanidades hispánicas y teoría
  bourdieu: 1979, habermas: 1962, benjamin: 1936, gadamer: 1960, ricoeur: 1983, bajtín: 1963, bakhtin: 1963, lacan: 1966,
  deleuze: 1968, butler: 1990, auerbach: 1946, curtius: 1948, 'menéndez pidal': 1926, unamuno: 1913, ortega: 1914,
};

/** Términos modernos y el año en que aparecen: una fuente anterior no los puede respaldar directamente. */
export const TERMINOS_MODERNOS: Record<string, number> = {
  transformer: 2017, transformers: 2017, 'attention mechanism': 2015, 'mecanismo de atención': 2015, bert: 2018, gpt: 2018,
  'large language model': 2020, 'large language models': 2020, 'modelo de lenguaje grande': 2020, 'modelos de lenguaje grandes': 2020, llm: 2020, llms: 2020,
  'word embedding': 2013, 'word embeddings': 2013, word2vec: 2013, 'byte pair encoding': 2015, wordpiece: 2016, 'pre-trained model': 2018,
  'fine-tuning': 2018, 'neural machine translation': 2014, 'traducción automática neuronal': 2014, seq2seq: 2014, 'generative ai': 2022,
  'ia generativa': 2022, 'inteligencia artificial generativa': 2022, chatgpt: 2022, 'prompt engineering': 2022, rlhf: 2022, 'diffusion model': 2020,
  // más allá de la IA
  internet: 1983, 'world wide web': 1991, 'redes sociales': 2004, 'social media': 2004, smartphone: 2007, 'teléfono inteligente': 2007,
  posmodernidad: 1979, postmodernism: 1979, deconstrucción: 1967, deconstruction: 1967, 'cambio climático': 1975, 'climate change': 1975,
  globalización: 1983, globalization: 1983, biopolítica: 1976, biopolitics: 1976, 'big data': 2005, antropoceno: 2000, anthropocene: 2000,
};

export interface AnalisisTemporal {
  /** La cita es cronológicamente posible tal como está. */
  plausible: boolean;
  /** Cronología imposible: la relación pasa a IMPOSIBLE_TEMPORAL. */
  imposible: boolean;
  /** Relación que la regla sugiere en lugar de la propuesta. */
  relacionSugerida?: RelacionCita;
  /** Años de distancia entre la fuente y lo más moderno de la afirmación. */
  desfase?: number;
  aniosAfirmacion: number[];
  claves: Array<{ frase: string; direccion: Direccion; fuerza: Fuerza }>;
  banderas: string[];
  aviso?: string;
}

/** Años plausibles (1400-2099), décadas («los años 1960», «the 1990s») y rangos. */
export function extraerAnios(texto: string): number[] {
  const anios = new Set<number>();
  for (const m of texto.matchAll(/\b(1[4-9]\d{2}|20\d{2})\b/g)) anios.add(Number(m[1]));
  for (const m of texto.matchAll(/\b(1[4-9]\d|20\d)0s\b/gi)) anios.add(Number(m[1]) * 10);
  return [...anios].sort((a, b) => a - b);
}

function minus(s: string): string { return s.toLowerCase(); }

function buscarFrase(texto: string, frase: string): number {
  const re = new RegExp(`(?<![\\p{L}])${frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u');
  return texto.search(re);
}

export function detectarClaves(texto: string): Array<{ frase: string; direccion: Direccion; fuerza: Fuerza; pos: number }> {
  const t = minus(texto);
  const salida: Array<{ frase: string; direccion: Direccion; fuerza: Fuerza; pos: number }> = [];
  for (const [frase, [direccion, fuerza]] of Object.entries(CLAVES_TEMPORALES)) {
    const pos = buscarFrase(t, frase);
    if (pos !== -1) salida.push({ frase, direccion, fuerza, pos });
  }
  // Si una frase contiene a otra («a anticipé» ⊃ «anticipé»), se queda la larga.
  return salida.filter((c) => !salida.some((o) => o !== c && o.frase.length > c.frase.length && o.frase.includes(c.frase)))
    .sort((a, b) => a.pos - b.pos);
}

/** Años citados en un tramo: explícitos y de autores notables. */
function aniosDe(tramo: string, excluir: string[] = []): { anios: number[]; autores: Array<[string, number]> } {
  const t = minus(tramo);
  const anios = new Set(extraerAnios(tramo));
  const autores: Array<[string, number]> = [];
  for (const [nombre, anio] of Object.entries(AUTORES_NOTABLES)) {
    if (excluir.includes(nombre)) continue;
    if (buscarFrase(t, nombre) !== -1) { autores.push([nombre, anio]); anios.add(anio); }
  }
  return { anios: [...anios].sort((a, b) => a - b), autores };
}

/**
 * Análisis temporal determinista de una cita propuesta.
 *
 * @param afirmacion   texto de la afirmación del usuario
 * @param anioFuente   año de la obra citada (el original si se conoce)
 * @param relacion     relación propuesta
 * @param autoresFuente apellidos de los autores de la fuente (para saber quién es el sujeto)
 */
export function analizarTemporal(afirmacion: string, anioFuente: number | undefined, relacion: RelacionCita, autoresFuente: string[] = []): AnalisisTemporal {
  const r: AnalisisTemporal = { plausible: true, imposible: false, aniosAfirmacion: [], claves: [], banderas: [] };
  const claves = detectarClaves(afirmacion);
  r.claves = claves.map(({ frase, direccion, fuerza }) => ({ frase, direccion, fuerza }));
  if (anioFuente === undefined || !Number.isFinite(anioFuente)) return r;
  const fuente = anioFuente;
  const propios = autoresFuente.map(minus);
  const todos = aniosDe(afirmacion, propios);
  r.aniosAfirmacion = todos.anios;

  // 1. Desfase: la afirmación habla de algo muy posterior a la fuente.
  const futuros = todos.anios.filter((a) => a > fuente + 5);
  if (futuros.length) {
    const desfase = Math.max(...futuros) - fuente;
    r.desfase = desfase;
    r.banderas.push(`desfase_${desfase}a`);
    if (desfase > 20 && relacion === 'APOYO_DIRECTO') {
      r.plausible = false;
      r.relacionSugerida = 'APLICACION_DE_MARCO';
      r.aviso = `La fuente (${fuente}) es ${desfase} años anterior a lo que se afirma (${Math.max(...futuros)}): se trata como aplicación de marco.`;
    }
  }

  // 2. Términos modernos (anacronismos).
  const t = minus(afirmacion);
  for (const [termino, desde] of Object.entries(TERMINOS_MODERNOS)) {
    if (buscarFrase(t, termino) === -1 || fuente >= desde) continue;
    r.desfase = Math.max(r.desfase ?? 0, desde - fuente);
    r.banderas.push(`anacronismo:${termino}`);
    r.plausible = false;
    if (relacion === 'APOYO_DIRECTO') {
      r.relacionSugerida = 'APLICACION_DE_MARCO';
      r.aviso = `La fuente (${fuente}) es anterior a «${termino}» (h. ${desde}): se trata como aplicación de marco.`;
    }
  }

  // 3. Palabras temporales: quién influye en quién.
  for (const c of claves) {
    const sujeto = afirmacion.slice(0, c.pos);
    const objeto = afirmacion.slice(c.pos + c.frase.length);
    const enSujeto = aniosDe(sujeto, propios);
    const sujetoEsFuente = propios.some((p) => buscarFrase(minus(sujeto), p) !== -1) || (enSujeto.autores.length === 0 && extraerAnios(sujeto).every((a) => Math.abs(a - fuente) <= 1));
    if (!sujetoEsFuente) continue;
    const enObjeto = aniosDe(objeto, propios);
    if (c.direccion === 'adelante') {
      if (c.fuerza === 'fuerte') {
        r.banderas.push(`temporal_adelante:${c.frase}`);
        r.aviso ??= `Lenguaje temporal («${c.frase}»): comprobar la cronología.`;
      }
      // Cronología inversa: «la fuente anticipó a X», pero X es anterior o contemporáneo.
      const anteriores = enObjeto.anios.filter((a) => a <= fuente + 5);
      if (anteriores.length && c.fuerza !== 'debil') {
        const quien = enObjeto.autores.filter(([, a]) => a <= fuente + 5).map(([n]) => n[0]!.toUpperCase() + n.slice(1)).join(', ') || String(Math.min(...anteriores));
        r.banderas.push('cronologia_inversa');
        r.plausible = false;
        r.imposible = true;
        r.relacionSugerida = 'IMPOSIBLE_TEMPORAL';
        r.aviso = `Cronología imposible: «${c.frase}» supone que la fuente (${fuente}) influyó en ${quien}, que es anterior o contemporáneo (${Math.min(...anteriores)}).`;
        break;
      }
    } else {
      // Dependencia hacia atrás: «la fuente se basó en X», pero X es posterior.
      const posteriores = enObjeto.anios.filter((a) => a > fuente + 1);
      if (posteriores.length && c.fuerza !== 'debil') {
        const quien = enObjeto.autores.filter(([, a]) => a > fuente + 1).map(([n]) => n[0]!.toUpperCase() + n.slice(1)).join(', ') || String(Math.min(...posteriores));
        r.banderas.push('dependencia_imposible');
        r.plausible = false;
        r.imposible = true;
        r.relacionSugerida = 'IMPOSIBLE_TEMPORAL';
        r.aviso = `Cronología imposible: «${c.frase}» supone que la fuente (${fuente}) depende de ${quien}, que es posterior (${Math.min(...posteriores)}).`;
        break;
      }
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Afirmaciones negativas y términos clave (portados)
// ---------------------------------------------------------------------------

const PATRONES_NEGATIVOS: RegExp[] = [
  /(?:does not|doesn't|never|nowhere)\s+(?:discuss|mention|address|analy[sz]e|examine|consider)\s+(?<tema>.+)/i,
  /(?:no|notably no)\s+(?:discussion|mention|analysis|treatment)\s+(?:of|about)\s+(?<tema>.+)/i,
  /(?:absence|lack|omission)\s+of\s+(?:any\s+)?(?:discussion|mention|analysis|treatment)\s+(?:of|about)\s+(?<tema>.+)/i,
  /is\s+(?:notably|conspicuously)\s+absent/i,
  /(?:no|nunca|jamás)\s+(?:discute|menciona|aborda|analiza|examina|trata|habla de)\s+(?<tema>.+)/i,
  /(?:ausencia|falta|omisión)\s+de\s+(?:toda\s+|cualquier\s+)?(?:discusión|mención|análisis|referencia)\s+(?:a|de|sobre)\s+(?<tema>.+)/i,
  /(?:ne|n')\s*(?:discute|mentionne|aborde|analyse)\s+(?:pas|jamais|nulle part)\s+(?<tema>.+)/i,
  /(?:aucune?|absence)\s+(?:de\s+)?(?:discussion|mention|analyse)\s+(?:de|sur)\s+(?<tema>.+)/i,
  /(?:non|mai)\s+(?:discute|menziona|affronta|analizza)\s+(?<tema>.+)/i,
  /(?:nessuna?|assenza)\s+(?:di\s+)?(?:discussione|menzione|analisi)\s+(?:di|su)\s+(?<tema>.+)/i,
];

/** Si la afirmación dice que algo NO está, devuelve el tema ausente. */
export function detectarAfirmacionNegativa(afirmacion: string): string | null {
  for (const p of PATRONES_NEGATIVOS) {
    const m = afirmacion.match(p);
    if (m) return (m.groups?.tema ?? afirmacion.slice(0, 120)).trim().replace(/[.,;:!?]+$/, '');
  }
  return null;
}

/** Nombres propios y cifras de la afirmación que no aparecen en el pasaje. */
export function terminosClaveAusentes(afirmacion: string, pasaje: string): string[] {
  const p = pasaje.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const faltan: string[] = [];
  for (const frase of afirmacion.split(/(?<=[.!?])\s+/)) {
    frase.split(/\s+/).forEach((w, i) => {
      if (i === 0) return;
      const limpio = w.replace(/[^\p{L}\p{N}'-]/gu, '');
      if (limpio.length >= 3 && /^\p{Lu}/u.test(limpio) && limpio !== limpio.toUpperCase()) {
        if (!p.includes(limpio.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase())) faltan.push(limpio);
      }
    });
  }
  for (const m of afirmacion.matchAll(/\b(\d{1,3}(?:[.,]\d+)?\s?%?)(?!\d)/g)) {
    const n = (m[1] as string).trim();
    if (/^\d{4}$/.test(n)) continue;
    if (!pasaje.includes(n)) faltan.push(n);
  }
  return [...new Set(faltan)];
}
