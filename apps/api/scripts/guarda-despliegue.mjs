#!/usr/bin/env node
/**
 * Guarda de despliegue: solo se despliega lo que ya está en origin/main.
 * Aborta si el árbol tiene cambios sin commitear o si HEAD no contiene
 * origin/main (alguien subió algo después y se perdería). Si HEAD va por
 * delante de origin/main, avisa: hay que subirlo para que el siguiente
 * despliegue no lo pise. Salida de emergencia: SCHOLARIS_DESPLIEGUE_FORZADO=1.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** La decisión, sin git: para probarla. */
export function decidirDespliegue({ sucio, igual, contiene, forzado }) {
  if (forzado) return { ok: true, aviso: 'Despliegue FORZADO (SCHOLARIS_DESPLIEGUE_FORZADO=1): se salta la guarda.' };
  if (sucio) return { ok: false, motivo: 'Hay cambios sin commitear: despliega desde un worktree limpio del main actual.' };
  if (!contiene) return { ok: false, motivo: 'HEAD no contiene origin/main: actualiza (git fetch && git rebase origin/main) antes de desplegar, o pisarías lo que otro ya subió.' };
  if (!igual) return { ok: true, aviso: 'HEAD va por delante de origin/main: súbelo (git push) para que el siguiente despliegue no lo pise.' };
  return { ok: true };
}

function git(...args) { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const forzado = process.env.SCHOLARIS_DESPLIEGUE_FORZADO === '1';
  let sucio = false, igual = false, contiene = false;
  if (!forzado) {
    git('fetch', '--quiet', 'origin', 'main');
    sucio = git('status', '--porcelain', '--untracked-files=no') !== '';
    const head = git('rev-parse', 'HEAD'), remoto = git('rev-parse', 'origin/main');
    igual = head === remoto;
    try { execFileSync('git', ['merge-base', '--is-ancestor', remoto, head]); contiene = true; } catch { contiene = false; }
    console.log(`guarda: HEAD ${head.slice(0, 7)} · origin/main ${remoto.slice(0, 7)}`);
  }
  const d = decidirDespliegue({ sucio, igual, contiene, forzado });
  if (d.aviso) console.warn(`guarda: ${d.aviso}`);
  if (!d.ok) { console.error(`guarda: NO se despliega. ${d.motivo}`); process.exit(1); }
}
