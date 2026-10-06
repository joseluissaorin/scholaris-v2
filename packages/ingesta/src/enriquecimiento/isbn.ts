/** ISBN: limpiar, validar el dígito de control y pasar de 10 a 13. Puro. */

export function limpiarIsbn(s: string): string {
  return s.replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isbn10Valido(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
  return suma % 11 === 0;
}

export function isbn13Valido(s: string): boolean {
  if (!/^97[89]\d{10}$/.test(s)) return false;
  let suma = 0;
  for (let i = 0; i < 13; i++) suma += Number(s[i]) * (i % 2 ? 3 : 1);
  return suma % 10 === 0;
}

export function aIsbn13(s: string): string | null {
  const l = limpiarIsbn(s);
  if (isbn13Valido(l)) return l;
  if (!isbn10Valido(l)) return null;
  const base = `978${l.slice(0, 9)}`;
  let suma = 0;
  for (let i = 0; i < 12; i++) suma += Number(base[i]) * (i % 2 ? 3 : 1);
  return base + String((10 - (suma % 10)) % 10);
}

/**
 * ISBN válidos de un texto («ISBN: 84-376-0119-X», «ISBN 978-0-521-47735-2»),
 * normalizados a 13 dígitos y sin repetir. Solo los que pasan el control.
 */
export function isbnsDelTexto(texto: string): string[] {
  const salida: string[] = [];
  const re = /\bISBN(?:-1[03])?\s*(?:\(([^)]{0,40})\))?\s*[:.]?\s*((?:97[89][\s‐-]?)?(?:\d[\s‐-]?){9}[\dXx])\b/g;
  for (const m of texto.matchAll(re)) {
    const i = aIsbn13(m[2] as string);
    if (i && !salida.includes(i)) salida.push(i);
  }
  return salida;
}
