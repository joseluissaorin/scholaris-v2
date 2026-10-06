import { limpiarMarcadoOCR, separarHablantes } from '@scholaris/nucleo';
/**
 * Texto de un pasaje listo para enseñar en una línea o en un extracto: sin
 * marcas de Markdown, con el LaTeX de los artículos convertido en algo legible
 * y con los puntos suspensivos de imprenta.
 */
const LATEX: Array<[RegExp, string]> = [
  [/\\(?:mathrm|mathbf|mathit|text|textbf|textit|operatorname)\{([^{}]*)\}/g, '$1'],
  [/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)'],
  [/\\sqrt\{([^{}]*)\}/g, '√($1)'],
  [/\\tag\{[^{}]*\}/g, ''],
  [/\\(left|right)/g, ''],
  [/\\cdot/g, '·'], [/\\times/g, '×'], [/\\in\b/g, '∈'], [/\\leq?/g, '≤'], [/\\geq?/g, '≥'],
  [/\^\{([^{}]*)\}/g, '^$1'], [/_\{([^{}]*)\}/g, '_$1'],
  [/\\([{}%$&_#])/g, '$1'],
];

const GRIEGAS: Record<string, string> = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', lambda: 'λ', mu: 'μ', sigma: 'σ', theta: 'θ', pi: 'π', omega: 'ω' };

function latexATexto(t: string): string {
  let s = t.replace(/\\(alpha|beta|gamma|delta|epsilon|lambda|mu|sigma|theta|pi|omega)\b/g, (_, g: string) => GRIEGAS[g] ?? g);
  for (let i = 0; i < 3; i++) for (const [re, r] of LATEX) s = s.replace(re, r as string);
  return s.replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '');
}

export function textoLimpio(t: string): string {
  // Marcas de hablante («**Nombre:**», también partidas por un corte): en texto plano, «Nombre: ».
  const { texto, hablantes } = separarHablantes(limpiarMarcadoOCR(t));
  let conNombres = texto;
  for (const h of [...hablantes].reverse()) conNombres = `${conNombres.slice(0, h.pos)}${h.nombre}: ${conNombres.slice(h.pos)}`;
  return conNombres
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => ` ${latexATexto(m)} `)
    .replace(/\$([^$\n]{1,200})\$/g, (_, m: string) => latexATexto(m))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(«])\*([^*\n]+)\*(?=[\s.,;:)»]|$)/g, '$1$2')
    .replace(/\*+/g, '')
    .replace(/\.\.\./g, '…')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
