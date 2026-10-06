/**
 * Castellano de los siglos XVI-XVIII → clave de búsqueda.
 *
 * La salida no es «ortografía moderna» palabra por palabra sino una clave
 * ortográfico-fonética que se aplica IGUAL al texto y a la consulta. Así no hace
 * falta adivinar en qué dirección iba cada alternancia: «Vandera» y «bandera»,
 * «hazer» y «hacer», «muger» y «mujer», «honrra» y «honra», «cauallo» y
 * «caballo» acaban en la misma clave. Lo que de verdad cambió de forma (y no
 * solo de grafía) va en listas: «dixo» → dijo, «agora» → ahora, «fee» → fe,
 * «mesmo» → mismo, «desta» → de esta, «truxo» → trajo…
 *
 * Orden: lista de palabras → ſ leída como f → prefijos (x → j, ch griega,
 * f- → h-, latinismos) → reglas generales (ph, th, qu+a/o, sc, y, u/v, b/v, h,
 * g/j, c/z, rr, n/m, consonantes dobles).
 */

import { compilarPrefijos, solo, type PalabraNormalizada } from './comun.js';

/** Formas arcaicas frecuentes → forma moderna (antes de plegar). */
export const PALABRAS_ES: Record<string, string> = {
  // formas que cambiaron
  fee: 'fe', agora: 'ahora', aguora: 'ahora',
  mesmo: 'mismo', mesma: 'misma', mesmos: 'mismos', mesmas: 'mismas',
  proprio: 'propio', propria: 'propia', proprios: 'propios', proprias: 'propias', propriedad: 'propiedad',
  ansi: 'asi', ansimesmo: 'asimismo', ansimismo: 'asimismo', assimesmo: 'asimismo', asimesmo: 'asimismo', otrosi: 'otrosi',
  estonces: 'entonces', entonce: 'entonces',
  truxo: 'trajo', truxe: 'traje', truxeron: 'trajeron', truxera: 'trajera', truxesse: 'trajese', truxiste: 'trajiste',
  trujo: 'trajo', truje: 'traje', trujeron: 'trajeron', trujera: 'trajera', trujese: 'trajese', trujiste: 'trajiste',
  vido: 'vio', vee: 've', veer: 'ver', seer: 'ser', vees: 'ves', veen: 'ven',
  sotil: 'sutil', sotiles: 'sutiles', sotileza: 'sutileza',
  cobdicia: 'codicia', cudicia: 'codicia', cobdiciar: 'codiciar', cibdad: 'ciudad', cibdades: 'ciudades',
  dubda: 'duda', dubdas: 'dudas', dubdar: 'dudar',
  licion: 'leccion', liciones: 'lecciones', quistion: 'cuestion', quistiones: 'cuestiones',
  vuessa: 'vuestra', vuesa: 'vuestra', vuessas: 'vuestras', vuesas: 'vuestras', vuessamerced: 'vuestra merced', vuesamerced: 'vuestra merced',
  mill: 'mil', ovo: 'hubo', hobo: 'hubo', ovieron: 'hubieron',
  complir: 'cumplir', complido: 'cumplido', complida: 'cumplida',
  escuro: 'oscuro', escura: 'oscura', escuros: 'oscuros', escuras: 'oscuras', escuridad: 'oscuridad',
  cativo: 'cautivo', cativa: 'cautiva', cativos: 'cautivos', cativas: 'cautivas', cativerio: 'cautiverio', cautiuerio: 'cautiverio',
  dotor: 'doctor', dotores: 'doctores', dotrina: 'doctrina', dotrinas: 'doctrinas',
  conceto: 'concepto', concetos: 'conceptos', efeto: 'efecto', efetos: 'efectos', efetuar: 'efectuar',
  perfeto: 'perfecto', perfeta: 'perfecta', perfetos: 'perfectos', perfetas: 'perfectas', perfecion: 'perfeccion', perficion: 'perfeccion',
  acetar: 'aceptar', aceto: 'acepto', preceto: 'precepto', precetos: 'preceptos',
  coluna: 'columna', colunas: 'columnas', solene: 'solemne', solenes: 'solemnes',
  dino: 'digno', dina: 'digna', dinos: 'dignos', dinas: 'dignas', indino: 'indigno', indina: 'indigna',
  malino: 'maligno', malina: 'maligna', sinificar: 'significar', sinifica: 'significa', manifico: 'magnifico', manifica: 'magnifica',
  otubre: 'octubre',
  fixo: 'fijo', fixa: 'fija', lexos: 'lejos', relox: 'reloj', coxo: 'cojo', coxa: 'coja', oxo: 'ojo', oxos: 'ojos', exe: 'eje', exes: 'ejes',
  // contracciones
  desta: 'de esta', deste: 'de este', desto: 'de esto', destas: 'de estas', destos: 'de estos',
  dessa: 'de esa', desso: 'de eso', dessas: 'de esas', dessos: 'de esos', desa: 'de esa', deso: 'de eso', desas: 'de esas', desos: 'de esos',
  della: 'de ella', dello: 'de ello', dellas: 'de ellas', dellos: 'de ellos',
  daquel: 'de aquel', daquella: 'de aquella', daquello: 'de aquello', daquellos: 'de aquellos', daquellas: 'de aquellas',
  dalli: 'de alli', dalla: 'de alla', daqui: 'de aqui', destotro: 'de este otro', destotra: 'de esta otra',
  // f- antigua → h-
  fecho: 'hecho', fechos: 'hechos', ferir: 'herir', ferido: 'herido', ferida: 'herida', feridos: 'heridos', feridas: 'heridas',
  fasta: 'hasta', facer: 'hacer', fuyr: 'huir', fuir: 'huir',
  // ch griega
  charidad: 'caridad', chaos: 'caos', choro: 'coro', choros: 'coros', monarcha: 'monarca', monarchas: 'monarcas',
  monarchia: 'monarquia', patriarcha: 'patriarca', patriarchas: 'patriarcas', achiles: 'aquiles', achilles: 'aquiles',
  chimera: 'quimera', chimeras: 'quimeras', machina: 'maquina', machinas: 'maquinas', archangel: 'arcangel', archangeles: 'arcangeles',
  character: 'caracter', characteres: 'caracteres', cholera: 'colera', eucharistia: 'eucaristia', anachoreta: 'anacoreta', anachoretas: 'anacoretas',
  // ſ leída como f
  fiempre: 'siempre', fobre: 'sobre', fiendo: 'siendo', fido: 'sido', fus: 'sus', fer: 'ser',
};

/** Prefijos: x → j en las palabras donde la x antigua era /x/ (hoy j), f- → h-, latinismos. */
export const PREFIJOS_ES: Record<string, string> = {
  // x → j
  dix: 'dij', predix: 'predij', contradix: 'contradij', bendix: 'bendij', maldix: 'maldij',
  trax: 'traj', trux: 'traj', atrax: 'atraj', retrax: 'retraj', dex: 'dej',
  abax: 'abaj', debax: 'debaj', bax: 'baj', cax: 'caj', rox: 'roj', quex: 'quej', exerc: 'ejerc', exempl: 'ejempl',
  alex: 'alej', flox: 'floj', aflox: 'afloj', embax: 'embaj', quix: 'quij', texer: 'tejer', texid: 'tejid', texed: 'tejed',
  xabon: 'jabon', xarab: 'jarab', ximen: 'jimen', xerez: 'jerez', oxal: 'ojal', lisonx: 'lisonj', mexor: 'mejor',
  dibux: 'dibuj', enxut: 'enjut', exido: 'ejido', axen: 'ajen', mux: 'muj', paxar: 'pajar',
  tixer: 'tijer', vexez: 'vejez', hixo: 'hijo', hixa: 'hija', mexill: 'mejill', consex: 'consej', luxur: 'lujur',
  // f- → h-
  fabl: 'habl', fermos: 'hermos', fiz: 'hiz', foja: 'hoja', fambr: 'hambr', fierr: 'hierr', faz: 'haz',
  folg: 'holg', fembr: 'hembr', fidalg: 'hidalg', fuyend: 'huyend',
  // latinismos y grupos cultos
  obscur: 'oscur', subst: 'sust', subscri: 'suscri', sancti: 'santi', sanct: 'sant', escript: 'escrit', script: 'escrit',
  receb: 'recib', rescib: 'recib', resceb: 'recib', escrev: 'escrib', escreu: 'escrib', succed: 'suced', success: 'suces',
  accept: 'acept', excell: 'excel', illustr: 'ilustr', intellig: 'intelig', colleg: 'coleg', colloc: 'coloc', assumpt: 'asunt',
  psych: 'psic', mechan: 'mecan', technic: 'tecnic',
};

const prefijosEs = compilarPrefijos(PREFIJOS_ES);

/** Excepciones a «f ante t es una ſ mal leída». */
const RE_FT_LEGITIMA = /^(?:naft|aft[ao]s?$|dift|oftalm|soft|loft|kraft|ft)/;

/**
 * Arreglos de la ſ (s larga) leída como f por el OCR o el transcriptor:
 * «efte», «mifmo», «afsi», «vengarfe». La f castellana no va nunca delante de
 * s, m, p, c, q, y casi nunca delante de t.
 */
export function arreglarSLarga(w: string): string {
  if (!w.includes('f')) return w;
  let s = w;
  if (/f[smpcq]/.test(s)) s = s.replace(/f(?=[smpcq])/g, 's');
  if (s.includes('ft') && !RE_FT_LEGITIMA.test(s)) s = s.replace(/f(?=t)/g, 's');
  // -rfe enclítico: vengarfe, hazerfe, partirfe
  if (s.length > 4 && s.endsWith('rfe')) s = `${s.slice(0, -2)}se`;
  return s;
}

/** Las reglas generales: la clave ortográfico-fonética de una palabra. */
export function plegarEs(w: string): string {
  let s = w;
  if (s.includes('h')) {
    if (s.includes('ph')) s = s.replace(/ph/g, 'f');
    if (s.includes('th')) s = s.replace(/th/g, 't');
    if (s.includes('ch')) s = s.replace(/ch(?=[rl])/g, 'c');
  }
  if (s.includes('qu')) s = s.replace(/qu(?=[ao])/g, 'cu').replace(/quen(?=[tc])/g, 'cuen').replace(/^quest/, 'cuest');
  if (s.includes('sc')) s = s.replace(/^sc(?=[ei])/, 'c').replace(/([aeiou])sc(?=[ei])/g, '$1c');
  s = s.replace(/^s(?=[bcdfgjklmnpqrtvz])/, 'es');
  // y vocálica → i (rey, muy, traygo, reyno); la consonántica (yo, mayor) se queda.
  if (s.includes('y')) s = s.replace(/y(?![aeiou])/g, 'i');
  // i/j y u/v por posición: iuez → juez, vn → un, cauallo → cavallo.
  s = s.replace(/^i(?=[aeou])/, 'j');
  s = s.replace(/^v(?=[^aeiou])/, 'u');
  if (s.includes('u')) s = s.replace(/([aeiou])u(?=[aeiou])/g, '$1v');
  // Fusiones fonéticas: b/v, h muda, g/j ante e/i, c/z ante e/i.
  if (s.includes('v')) s = s.replace(/v/g, 'b');
  if (s.includes('h')) s = s.replace(/(?<!c)h/g, '');
  if (s.includes('g')) s = s.replace(/g(?=[ei])/g, 'j');
  if (s.includes('c')) s = s.replace(/c(?=[ei])/g, 'z');
  if (s.includes('rr')) s = s.replace(/(^|[nls])rr/g, '$1r');
  if (s.includes('n')) s = s.replace(/n(?=[pb])/g, 'm');
  // Consonantes dobles (assi, effecto, summa, innocente); cc, ll y rr se conservan.
  s = s.replace(/([sfmptbdgn])\1+/g, '$1');
  return s;
}

/** Normaliza una palabra castellana (ya en minúsculas y sin diacríticos salvo la ñ). */
export function palabraEs(w: string): PalabraNormalizada {
  if (w.length === 0 || /^\d+$/.test(w)) return solo(w);
  let s = PALABRAS_ES[w];
  if (s === undefined) {
    const arreglada = arreglarSLarga(w);
    s = PALABRAS_ES[arreglada] ?? prefijosEs(arreglada);
  }
  if (s.includes(' ')) return solo(s.split(' ').map(plegarEs).join(' '));
  return solo(plegarEs(s));
}

// ---------------------------------------------------------------------------
// Detección de ortografía antigua
// ---------------------------------------------------------------------------

/** Señales de imprenta antigua en el texto original (en minúsculas, NFC). */
const RE_SENALES_ES = new RegExp(
  [
    'ſ', 'q̃', '[ãẽĩõũ]', '[àèìòù]', 'ç',
    // -sse / -ssen / -ssemos: imperfecto de subjuntivo antiguo
    '\\p{L}+ss(?:e|en|emos|es)(?![\\p{L}])',
    // palabras-testigo
    '(?<![\\p{L}])(?:assi|ansi|quando|qual|quales|quanto|quanta|quantos|quantas|quatro|dixo|dixe|dixeron|muger|mugeres|agora|aora|desta|deste|destos|destas|dello|della|dellos|mesmo|mesma|hazer|haze|hazen|hazia|dezir|dize|dizen|dezia|vn|vna|vnos|vnas|avia|havia|avian|havian|aver|haver|huvo|uvo|proprio|propria|traygo|reyno|reyna|ayre|oyr|essa|esso|esse|essos|essas|excesso|sucesso|exercito|exemplo|baxo|dexar|dexo|quexa|fee|vuessa|vuesa|cuydado|cuydar|christiano|christiana|christo|iusticia|iuez|aqueste|aquesta|aquesto|fazer|fizo|fasta|vido|truxo|trujo|estonces)(?![\\p{L}])',
  ].join('|'),
  'gu',
);

/** Proporción de señales de ortografía antigua por palabra (0-1). */
export function senalesEs(texto: string): { senales: number; palabras: number } {
  const t = texto.normalize('NFC').toLowerCase();
  const palabras = (t.match(/\p{L}+/gu) ?? []).length;
  const senales = (t.match(RE_SENALES_ES) ?? []).length;
  return { senales, palabras };
}
