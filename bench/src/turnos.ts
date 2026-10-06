/**
 * `tsx src/turnos.ts muestra <etiqueta> [n] [semilla]`: turnos de hablante de un SPDF de audio o vídeo,
 *   con una muestra aleatoria para anotar a mano (bench/datos/salida/turnos/<etiqueta>.muestra.json).
 * `tsx src/turnos.ts puntuar <etiqueta>`: % de turnos bien atribuidos según la anotación
 *   (campo `correcto`: true/false en cada turno de la muestra).
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SALIDA } from './ingesta.js';

export interface Turno { i: number; hablante: string; t0: number; texto: string }

export function turnosDe(etiqueta: string): Turno[] {
  const db = new Database(join(SALIDA, `${etiqueta}.sqlite`), { readonly: true });
  const filas = db.prepare('SELECT ancla, texto FROM unidades ORDER BY orden').all() as Array<{ ancla: string; texto: string }>;
  const turnos: Turno[] = [];
  for (const f of filas) {
    const a = JSON.parse(f.ancla) as { t0: number; hablante?: string };
    const trozos = f.texto.split(/\n\n(?=\*\*[^*]+:\*\*)/);
    for (const tr of trozos) {
      const m = /^\*\*([^*]+):\*\*\s*([^]*)$/.exec(tr.trim());
      const hablante = m ? (m[1] as string) : a.hablante ?? '?';
      const texto = (m ? (m[2] as string) : tr).trim();
      const ultimo = turnos.at(-1);
      if (ultimo && ultimo.hablante === hablante) ultimo.texto += ' ' + texto;
      else turnos.push({ i: turnos.length, hablante, t0: a.t0, texto });
    }
  }
  return turnos;
}

function aleatorio(semilla: number) { let x = semilla; return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31); }

const dir = join(SALIDA, 'turnos');
const [orden, etiqueta, n = '25', semilla = '7'] = process.argv.slice(2);
if (orden === 'muestra' && etiqueta) {
  const turnos = turnosDe(etiqueta);
  const r = aleatorio(Number(semilla));
  const elegidos = new Set<number>();
  while (elegidos.size < Math.min(Number(n), turnos.length)) elegidos.add(Math.floor(r() * turnos.length));
  const corto = (s: string, k: number) => (s.length > k ? `${s.slice(0, k / 2)} […] ${s.slice(-k / 2)}` : s);
  const muestra = [...elegidos].sort((a, b) => a - b).map((i) => {
    const t = turnos[i] as Turno;
    return { i, t0: Math.round(t.t0), hablante: t.hablante, antes: turnos[i - 1] ? `${turnos[i - 1]?.hablante}: ${corto(turnos[i - 1]?.texto ?? '', 160)}` : '', texto: corto(t.texto, 700), despues: turnos[i + 1] ? `${turnos[i + 1]?.hablante}: ${corto(turnos[i + 1]?.texto ?? '', 160)}` : '', correcto: null as boolean | null };
  });
  mkdirSync(dir, { recursive: true });
  const ruta = join(dir, `${etiqueta}.muestra.json`);
  if (!existsSync(ruta)) writeFileSync(ruta, JSON.stringify(muestra, null, 1));
  const porHablante = new Map<string, number>();
  for (const t of turnos) porHablante.set(t.hablante, (porHablante.get(t.hablante) ?? 0) + 1);
  console.log(JSON.stringify({ turnos: turnos.length, porHablante: Object.fromEntries(porHablante), muestra: ruta }));
} else if (orden === 'puntuar' && etiqueta) {
  const m = JSON.parse(readFileSync(join(dir, `${etiqueta}.muestra.json`), 'utf8')) as Array<{ correcto: boolean | null }>;
  const anotados = m.filter((x) => x.correcto !== null);
  const bien = anotados.filter((x) => x.correcto).length;
  console.log(JSON.stringify({ etiqueta, anotados: anotados.length, bien, porcentaje: anotados.length ? Math.round((1000 * bien) / anotados.length) / 10 : null }));
} else {
  console.error('Uso: tsx src/turnos.ts muestra|puntuar <etiqueta> [n] [semilla]');
}
