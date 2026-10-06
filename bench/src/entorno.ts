/** Claves de API del banco: se leen de ~/.claude/.secrets/*.env y nunca se imprimen. */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function cargarEntorno(ficheros = ['gemini', 'openrouter', 'typesafe']): Record<string, string> {
  const env: Record<string, string> = {};
  for (const f of ficheros) {
    const ruta = join(homedir(), '.claude', '.secrets', `${f}.env`);
    if (!existsSync(ruta)) continue;
    for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea);
      if (m) env[m[1] as string] = (m[2] as string).replace(/^["']|["']$/g, '');
    }
  }
  // Lo que ya esté en el entorno del proceso manda.
  for (const [k, v] of Object.entries(process.env)) if (v && /^(GEMINI|OPENROUTER|TYPESAFE|CLOUDFLARE|INFERBOX)_/.test(k)) env[k] = v;
  return env;
}
