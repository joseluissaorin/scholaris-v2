/** Une clases condicionales. Sin dependencias: el sistema no necesita más. */
export function cx(...partes: Array<string | false | null | undefined | 0>): string {
  return partes.filter(Boolean).join(' ');
}
