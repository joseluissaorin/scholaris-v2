/** La salida HTML de citeproc convertida a texto, Markdown o tramos con formato (para DOCX). */

export interface Tramo {
  texto: string;
  cursiva?: boolean;
  negrita?: boolean;
  versalitas?: boolean;
  superindice?: boolean;
  subindice?: boolean;
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodificarEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

/** HTML de citeproc → tramos con formato. Los bloques (div) se separan con un espacio. */
export function htmlATramos(html: string): Tramo[] {
  const tramos: Tramo[] = [];
  const pila: Array<Partial<Tramo> & { etiqueta: string }> = [];
  const estado = (): Omit<Tramo, 'texto'> => {
    const e: Omit<Tramo, 'texto'> = {};
    for (const p of pila) {
      if (p.cursiva !== undefined) e.cursiva = p.cursiva;
      if (p.negrita !== undefined) e.negrita = p.negrita;
      if (p.versalitas !== undefined) e.versalitas = p.versalitas;
      if (p.superindice) e.superindice = true;
      if (p.subindice) e.subindice = true;
    }
    return e;
  };
  const empujar = (texto: string) => {
    if (!texto) return;
    const e = estado();
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.cursiva === e.cursiva && ultimo.negrita === e.negrita && ultimo.versalitas === e.versalitas && ultimo.superindice === e.superindice && ultimo.subindice === e.subindice) ultimo.texto += texto;
    else tramos.push({ texto, ...e });
  };
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi)) {
    if (m[4] !== undefined) { empujar(decodificarEntidades(m[4]).replace(/\s*\n\s*/g, ' ')); continue; }
    const cierre = m[1] === '/', etiqueta = (m[2] as string).toLowerCase(), attrs = (m[3] ?? '').toLowerCase();
    if (etiqueta === 'br') { empujar(' '); continue; }
    if (cierre) {
      const i = pila.map((p) => p.etiqueta).lastIndexOf(etiqueta);
      if (i !== -1) pila.splice(i);
      if (etiqueta === 'div' && tramos.length && !/\s$/.test(tramos[tramos.length - 1]!.texto)) empujar(' ');
      continue;
    }
    const p: Partial<Tramo> & { etiqueta: string } = { etiqueta };
    if (etiqueta === 'i' || etiqueta === 'em') p.cursiva = true;
    if (etiqueta === 'b' || etiqueta === 'strong') p.negrita = true;
    if (etiqueta === 'sup') p.superindice = true;
    if (etiqueta === 'sub') p.subindice = true;
    if (/font-style:\s*italic/.test(attrs)) p.cursiva = true;
    if (/font-style:\s*normal/.test(attrs)) p.cursiva = false;
    if (/font-weight:\s*bold/.test(attrs)) p.negrita = true;
    if (/font-weight:\s*normal/.test(attrs)) p.negrita = false;
    if (/font-variant:\s*small-caps/.test(attrs)) p.versalitas = true;
    if (/font-variant:\s*normal/.test(attrs)) p.versalitas = false;
    if (/vertical-align:\s*sup/.test(attrs)) p.superindice = true;
    pila.push(p);
  }
  // Recorta espacios de los extremos.
  if (tramos[0]) tramos[0].texto = tramos[0].texto.replace(/^\s+/, '');
  const u = tramos[tramos.length - 1];
  if (u) u.texto = u.texto.replace(/\s+$/, '');
  return tramos.filter((t) => t.texto);
}

export function htmlATexto(html: string): string {
  return htmlATramos(html).map((t) => t.texto).join('');
}

function escaparMd(s: string): string {
  return s.replace(/([\\*_`])/g, '\\$1');
}

export function htmlAMarkdown(html: string): string {
  return htmlATramos(html).map((t) => {
    let s = escaparMd(t.texto);
    const pre = s.match(/^\s*/)![0], post = s.match(/\s*$/)![0];
    s = s.trim();
    if (!s) return pre + post;
    if (t.negrita) s = `**${s}**`;
    if (t.cursiva) s = `*${s}*`;
    if (t.superindice) s = `<sup>${s}</sup>`;
    return pre + s + post;
  }).join('');
}
