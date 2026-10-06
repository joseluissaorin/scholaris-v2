/**
 * Repara los audios y vídeos que ya estaban en una biblioteca: pone delante
 * el índice de los MP4 que lo tienen al final (para que suenen al instante) y
 * avisa de los códecs que algún navegador no reproduce.
 *
 *   tsx src/reparar-medios.ts [base] [--seco]
 *
 * Usa la clave personal de ~/.scholaris-prueba.key (o SCHOLARIS_CLAVE).
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { DiagnosticoMedio, MedioPreparado, Pagina, ResumenDocumento } from '@scholaris/contrato';

const args = process.argv.slice(2);
const seco = args.includes('--seco');
const base = (args.find((a) => !a.startsWith('--')) ?? 'https://scholaris-v2.jlsf2005.workers.dev').replace(/\/$/, '');
const clave = process.env.SCHOLARIS_CLAVE ?? readFileSync(`${homedir()}/.scholaris-prueba.key`, 'utf8').trim();
const cab = { authorization: `Bearer ${clave}`, 'content-type': 'application/json' };

async function pedir<T>(ruta: string, metodo = 'GET'): Promise<T> {
  const r = await fetch(`${base}/api/v2${ruta}`, { method: metodo, headers: cab, ...(metodo === 'POST' ? { body: '{}' } : {}) });
  if (!r.ok) throw new Error(`${metodo} ${ruta}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

let cursor: string | undefined;
const medios: ResumenDocumento[] = [];
do {
  const p = await pedir<Pagina<ResumenDocumento>>(`/documentos?limite=100&tipo=audio&tipo=video${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  medios.push(...p.elementos.filter((d) => d.tipo === 'audio' || d.tipo === 'video'));
  cursor = p.siguiente ?? undefined;
} while (cursor);

console.log(`${medios.length} audios y vídeos en ${base}${seco ? ' (en seco)' : ''}`);
for (const d of medios) {
  const nombre = `${d.titulo.slice(0, 50)} (${d.id})`;
  try {
    const diag = await pedir<DiagnosticoMedio>(`/documentos/${d.id}/medio/diagnostico`);
    const codecs = diag.codecs.join(', ') || '—';
    const aviso = diag.dudosos.length ? `  ¡ojo! ${diag.dudosos.join(', ')} no se reproduce en todos los navegadores` : '';
    if (!diag.mp4 || diag.rapido || seco) { console.log(`  ${diag.mp4 ? (diag.rapido ? 'rápido   ' : 'LENTO    ') : 'no es MP4'} ${nombre} · ${codecs}${aviso}`); continue; }
    const r = await pedir<MedioPreparado>(`/documentos/${d.id}/medio/preparar`, 'POST');
    console.log(`  ${r.estado.padEnd(9)} ${nombre} · ${codecs}${r.ms != null ? ` · ${(r.ms / 1000).toFixed(1)} s` : ''}${aviso}`);
  } catch (e) {
    console.log(`  error     ${nombre}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
