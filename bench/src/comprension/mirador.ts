/**
 * Mirador: comprueba una afirmación visual o sonora mirando el recorte de vídeo
 * con Gemini. Necesita una copia local del vídeo (mejor un proxy ligero de 360p) y
 * ffmpeg; si no la hay, las afirmaciones visuales quedan «sin comprobar».
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Mirador } from './citas.js';
import type { ModeloJuez } from './modelo.js';

const SISTEMA = `Eres un analista de cine que comprueba citas. Recibes un recorte de una película y una frase que lo cita. Decide si lo que se ve y se oye en el recorte sostiene la frase:
"sostiene" si lo muestra con claridad; "parcial" si muestra una parte o algo parecido pero no exacto; "no_sostiene" si no aparece o se ve otra cosa.
Juzga solo por el recorte. Motivo en español, de 25 palabras como mucho.`;

const ESQUEMA = {
  type: 'object',
  properties: { veredicto: { type: 'string', enum: ['sostiene', 'parcial', 'no_sostiene'] }, motivo: { type: 'string' } },
  required: ['veredicto', 'motivo'],
};

/** Recortes de como mucho 3 minutos (lo que se cita es un tramo corto). */
const MAX_RECORTE = 180;

export function crearMirador(o: { videos: Record<string, string>; juez: ModeloJuez; dirRecortes: string }): Mirador {
  mkdirSync(o.dirRecortes, { recursive: true });
  return {
    puedeVer: (documento) => Boolean(o.videos[documento] && existsSync(o.videos[documento] as string)),
    async ver(documento, t0, t1, frase) {
      const fuente = o.videos[documento] as string;
      const a = Math.max(0, Math.floor(t0) - 2);
      const b = Math.min(a + MAX_RECORTE, Math.ceil(t1) + 2);
      const ruta = join(o.dirRecortes, `${documento}-${a}-${b}.mp4`);
      if (!existsSync(ruta)) {
        const r = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-ss', String(a), '-i', fuente, '-t', String(b - a), '-vf', 'scale=-2:360', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '48k', ruta]);
        if (r.status !== 0) throw new Error(`ffmpeg no pudo cortar ${a}-${b}: ${String(r.stderr).slice(0, 200)}`);
      }
      const res = await o.juez.json<{ veredicto: 'sostiene' | 'parcial' | 'no_sostiene'; motivo: string }>({
        sistema: SISTEMA,
        usuario: `El recorte empieza en el segundo ${a} de la película. FRASE: ${frase}`,
        esquema: ESQUEMA,
        adjunto: { mime: 'video/mp4', datos: readFileSync(ruta), fps: 2 },
      });
      return { ...res.json, usd: res.usd };
    },
  };
}
