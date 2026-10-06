/**
 * Utilidades del banco en vivo (solo Node: aquí sí se usan fs y child_process).
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ = join(AQUI, '..', '..', '..');
export const ORIGINALES = join(RAIZ, 'bench', 'datos', 'originales');
export const SALIDA = join(AQUI, 'resultados');
mkdirSync(SALIDA, { recursive: true });

/** Lee `CLAVE=valor` de ~/.claude/.secrets/<fichero>.env sin imprimir nada. */
export function secreto(fichero: string, clave: string): string | undefined {
  if (process.env[clave]) return process.env[clave];
  const ruta = join(homedir(), '.claude', '.secrets', `${fichero}.env`);
  if (!existsSync(ruta)) return undefined;
  for (const l of readFileSync(ruta, 'utf8').split('\n')) {
    const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && m[1] === clave) return m[2];
  }
  return undefined;
}

/** Token OAuth de wrangler (para la API REST de Workers AI). */
export function tokenWrangler(): string | undefined {
  for (const ruta of [join(homedir(), '.wrangler', 'config', 'default.toml'), join(homedir(), 'Library', 'Preferences', '.wrangler', 'config', 'default.toml')]) {
    if (!existsSync(ruta)) continue;
    const t = readFileSync(ruta, 'utf8');
    const tok = t.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
    const exp = t.match(/^expiration_time\s*=\s*"([^"]+)"/m)?.[1];
    if (tok && (!exp || Date.parse(exp) > Date.now() + 60_000)) return tok;
  }
  return undefined;
}

export function leerBytes(ruta: string): Uint8Array {
  return new Uint8Array(readFileSync(ruta));
}

export function guardar(nombre: string, datos: unknown): void {
  writeFileSync(join(SALIDA, nombre), typeof datos === 'string' ? datos : JSON.stringify(datos, null, 1));
}

// ---------------------------------------------------------------------------
// Métricas de calidad
// ---------------------------------------------------------------------------

export function normalizarComparacion(t: string): string {
  return t
    .replace(/\[\^[^\]]*\]/g, '')
    .replace(/[*_#`>|]/g, '')
    .replace(/ſ/g, 's')
    .replace(/-\n/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distancia de edición (Levenshtein) con dos filas. */
export function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Uint32Array(b.length + 1);
  let cur = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const coste = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + coste);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length] as number;
}

/** CER sin espacios ni mayúsculas: lo que importa es cada letra. */
export function cer(hipotesis: string, referencia: string): number {
  const h = normalizarComparacion(hipotesis).replace(/ /g, '');
  const r = normalizarComparacion(referencia).replace(/ /g, '');
  return distancia(h, r) / Math.max(1, r.length);
}

/** F1 de palabras (multiconjunto), para comparar con la capa de texto de un PDF digital. */
export function f1Palabras(hipotesis: string, referencia: string): { p: number; r: number; f1: number } {
  const pal = (t: string) => normalizarComparacion(t).replace(/[^\p{L}\p{N} ]/gu, ' ').split(' ').filter((w) => w.length > 1);
  const h = pal(hipotesis), r = pal(referencia);
  const cuenta = new Map<string, number>();
  for (const w of r) cuenta.set(w, (cuenta.get(w) ?? 0) + 1);
  let ok = 0;
  for (const w of h) { const c = cuenta.get(w) ?? 0; if (c > 0) { ok++; cuenta.set(w, c - 1); } }
  const p = h.length ? ok / h.length : 0, rr = r.length ? ok / r.length : 0;
  return { p, r: rr, f1: p + rr ? (2 * p * rr) / (p + rr) : 0 };
}

export function tabla(cabecera: string[], filas: Array<Array<string | number>>): string {
  const fmt = (v: string | number) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(v < 0.01 && v !== 0 ? 5 : 3)) : v);
  return [`| ${cabecera.join(' | ')} |`, `|${cabecera.map(() => '---').join('|')}|`, ...filas.map((f) => `| ${f.map(fmt).join(' | ')} |`)].join('\n');
}
