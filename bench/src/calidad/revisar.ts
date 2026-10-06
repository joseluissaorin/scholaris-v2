/**
 * `pnpm bench calidad revisar`: confirmar o corregir juicios a mano. Los
 * confirmados pasan de «plata» a «oro» y ya no los toca `juzgar`.
 *
 *   --consulta q012        solo esa consulta
 *   --dudosos              solo los que necesitaron árbitro o en los que los jueces discrepan
 *   --relevantes           solo los que tienen nota ≥ 2 (para cazar falsos positivos)
 *   --muestra 30           una muestra al azar de ese tamaño
 *
 * Teclas: 0-3 pone la nota; Intro confirma la que hay; s salta; a atrás; q guarda y sale.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { anclaACita, type Ancla } from '@scholaris/nucleo';
import { abrirEstanteria, mapaDocumentos } from './estanteria.js';
import { cargarConsultas, cargarJuicios, guardarJuicios, type Juicio } from './juego.js';

export async function revisar(args: string[]): Promise<void> {
  const valor = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const sql = abrirEstanteria();
  const docs = mapaDocumentos(sql.bd);
  const consultas = new Map(cargarConsultas().map((c) => [c.id, c]));
  const juicios = cargarJuicios();
  const frag = sql.bd.prepare('SELECT documento, texto, ancla, ancla_fin FROM fragmentos WHERE id = ?');
  let cola: Array<{ q: string; f: string; j: Juicio }> = [];
  for (const [q, js] of Object.entries(juicios)) {
    if (valor('--consulta') && q !== valor('--consulta')) continue;
    for (const [f, j] of Object.entries(js)) {
      if (j.fuente !== 'plata') continue;
      if (args.includes('--dudosos') && !(j.j3 !== undefined || (j.j1 !== undefined && j.j2 !== undefined && j.j1 !== j.j2))) continue;
      if (args.includes('--relevantes') && j.nota < 2) continue;
      cola.push({ q, f, j });
    }
  }
  const n = Number(valor('--muestra') ?? 0);
  if (n) cola = cola.map((x) => ({ x, r: Math.random() })).sort((a, b) => a.r - b.r).slice(0, n).map((x) => x.x);
  cola.sort((a, b) => a.q.localeCompare(b.q));
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`${cola.length} juicios por revisar. 0-3 = nota, Intro = confirmar, s = saltar, a = atrás, q = salir.\n`);
  let cambios = 0, confirmados = 0;
  for (let i = 0; i < cola.length; i++) {
    const { q, f, j } = cola[i]!;
    const c = consultas.get(q);
    const fr = frag.get(f) as { documento: string; texto: string; ancla: string; ancla_fin: string | null } | undefined;
    if (!c || !fr) continue;
    const d = docs.get(fr.documento)!;
    console.log('\n' + '─'.repeat(80));
    console.log(`[${i + 1}/${cola.length}] ${q} (${c.clases.join(', ')}): \x1b[1m${c.consulta}\x1b[0m`);
    console.log(`${d.corto}, ${anclaACita(JSON.parse(fr.ancla) as Ancla, fr.ancla_fin ? JSON.parse(fr.ancla_fin) as Ancla : undefined)}  ·  ${f}`);
    console.log(fr.texto.length > 1800 ? `${fr.texto.slice(0, 1800)}…` : fr.texto);
    console.log(`\x1b[36mnota ${j.nota}\x1b[0m (jueces ${j.j1 ?? '·'} / ${j.j2 ?? '·'}${j.j3 !== undefined ? `, árbitro ${j.j3}` : ''}): ${j.motivo ?? ''}`);
    const r = (await rl.question('> ')).trim().toLowerCase();
    if (r === 'q') break;
    if (r === 's') continue;
    if (r === 'a') { i = Math.max(-1, i - 2); continue; }
    if (/^[0-3]$/.test(r)) { if (Number(r) !== j.nota) cambios++; j.nota = Number(r); }
    j.fuente = 'oro';
    confirmados++;
    juicios[q]![f] = j;
    if (confirmados % 10 === 0) guardarJuicios(juicios);
  }
  rl.close();
  guardarJuicios(juicios);
  console.log(`\n${confirmados} confirmados (${cambios} con la nota cambiada). Guardado en bench/calidad/juicios.json.`);
}
