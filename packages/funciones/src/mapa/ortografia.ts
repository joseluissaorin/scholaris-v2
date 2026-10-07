/**
 * Las tildes que un modelo rápido a veces se come al nombrar un tema
 * («Teatro aureo y epopeya carolingia»). Es una red barata, no un corrector:
 * solo toca palabras sin ninguna tilde que, escritas así, son siempre una falta
 * en un rótulo español (sustantivos y adjetivos de título; nada de formas
 * verbales que se escriban igual sin tilde). Y solo si el rótulo es español.
 */

const PALABRAS: Record<string, string> = {
  academica: 'académica', academicas: 'académicas', academico: 'académico', academicos: 'académicos',
  analisis: 'análisis', antropologia: 'antropología', arqueologia: 'arqueología', aureo: 'áureo', aurea: 'áurea',
  biografia: 'biografía', biologia: 'biología', catolica: 'católica', catolico: 'católico',
  cientifica: 'científica', cientificas: 'científicas', cientifico: 'científico', cientificos: 'científicos',
  clasica: 'clásica', clasicas: 'clásicas', clasico: 'clásico', clasicos: 'clásicos',
  comica: 'cómica', comico: 'cómico', critica: 'crítica', criticas: 'críticas', critico: 'crítico',
  democratica: 'democrática', dramatica: 'dramática', dramatico: 'dramático',
  economia: 'economía', economica: 'económica', economico: 'económico', energia: 'energía',
  epica: 'épica', epico: 'épico', epoca: 'época', epocas: 'épocas', estetica: 'estética', estetico: 'estético',
  etica: 'ética', fenomenologia: 'fenomenología', filologia: 'filología', filosofia: 'filosofía', filosofica: 'filosófica', filosofico: 'filosófico',
  fisica: 'física', fisico: 'físico', fonetica: 'fonética', geografia: 'geografía', genero: 'género', generos: 'géneros',
  gotica: 'gótica', gotico: 'gótico', gramatica: 'gramática', heroe: 'héroe', heroes: 'héroes',
  hispanica: 'hispánica', hispanico: 'hispánico', historica: 'histórica', historicas: 'históricas', historico: 'histórico', historicos: 'históricos',
  iberica: 'ibérica', iberico: 'ibérico', iconografia: 'iconografía', ideologia: 'ideología', linguistica: 'lingüística', linguistico: 'lingüístico',
  lirica: 'lírica', lirico: 'lírico', logica: 'lógica', matematica: 'matemática', matematicas: 'matemáticas',
  medica: 'médica', medico: 'médico', metafisica: 'metafísica', metodo: 'método', metodos: 'métodos', metodologia: 'metodología',
  mistica: 'mística', mitica: 'mítica', mitologia: 'mitología', musica: 'música',
  narratologia: 'narratología', optica: 'óptica', pedagogia: 'pedagogía', poetica: 'poética', poeticas: 'poéticas',
  politica: 'política', politicas: 'políticas', politico: 'político', politicos: 'políticos', practica: 'práctica', practicas: 'prácticas',
  psicologia: 'psicología', publica: 'pública', publico: 'público', quimica: 'química', retorica: 'retórica',
  romantica: 'romántica', romantico: 'romántico', satira: 'sátira', semantica: 'semántica', semiotica: 'semiótica',
  simbolica: 'simbólica', simbolico: 'simbólico', simbolo: 'símbolo', simbolos: 'símbolos', sintesis: 'síntesis',
  sociologia: 'sociología', tecnica: 'técnica', tecnicas: 'técnicas', tecnologia: 'tecnología', teologia: 'teología',
  teoria: 'teoría', teorias: 'teorías', tipografia: 'tipografía', tragica: 'trágica', tragico: 'trágico', transito: 'tránsito',
  unica: 'única', utopia: 'utopía', vision: 'visión', poesia: 'poesía', epistemologia: 'epistemología', genesis: 'génesis',
  arabe: 'árabe', arabes: 'árabes', rapida: 'rápida', basica: 'básica', basicos: 'básicos', organica: 'orgánica', dinamica: 'dinámica',
  sistematica: 'sistemática', automatica: 'automática', automatico: 'automático', atomica: 'atómica', electronica: 'electrónica',
  canonica: 'canónica',
};

/** ¿Parece un rótulo en español? Palabras vacías o una eñe; sin eso, no se toca. */
function pareceEspanol(t: string): boolean {
  return /[ñáéíóúü¿¡]/i.test(t) || /(^|\s)(y|de|del|la|las|el|los|en|entre|sobre|para|con|sin)(\s|$)/i.test(t);
}

/** Respeta mayúsculas: «Aureo» → «Áureo», «AUREO» → «ÁUREO». */
function conCaja(original: string, correcta: string): string {
  if (original === original.toUpperCase()) return correcta.toUpperCase();
  if (original[0] === original[0]!.toUpperCase()) return correcta[0]!.toUpperCase() + correcta.slice(1);
  return correcta;
}

/**
 * Pone las tildes que faltan en un rótulo español. Las terminaciones en «-cion» (singular)
 * siempre la llevan: «traduccion» → «traducción»; los plurales en «-ciones», nunca.
 */
export function tildarRotulo(t: string): string {
  if (!t || !pareceEspanol(t)) return t;
  return t.replace(/[\p{L}]+/gu, (p) => {
    if (/[áéíóúü]/i.test(p)) return p;
    const min = p.toLowerCase();
    const fija = PALABRAS[min];
    if (fija && fija !== min) return conCaja(p, fija);
    if (min.length > 5 && min.endsWith('cion')) return conCaja(p, `${min.slice(0, -4)}ción`);
    return p;
  });
}
