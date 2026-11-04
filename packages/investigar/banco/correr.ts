/**
 * Corre el agente sobre la copia local de la biblioteca de producción con las
 * preguntas difíciles del banco y guarda lo que hace (plan, pasos, pruebas,
 * respuesta, verificación, coste) en banco/resultados/.
 *
 *   npx tsx packages/investigar/banco/correr.ts --modelo gemini-4-argon --preguntas 1,3 --profundidad normal
 *
 * Opciones: --modelo (agente), --redactor, --vision, --verificador, --preguntas, --profundidad, --etiqueta, --sin-medios.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventoInvestigacion } from '@scholaris/contrato';
import { investigarCompleto } from '../src/agente.js';
import { abrirBD, montar, RESULTADOS } from './comun.js';
import { PREGUNTAS } from './preguntas.js';

function opcion(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export interface Corrida {
  pregunta: string;
  modelo: string;
  fin: Awaited<ReturnType<typeof investigarCompleto>> | null;
  verificacion: Extract<EventoInvestigacion, { tipo: 'verificacion' }> | null;
  error?: string;
  ms: number;
}

export async function correr(modelo: string, numeros: number[], o: { profundidad?: 'rapida' | 'normal' | 'exhaustiva'; redactor?: string; vision?: string; verificador?: string; sinMedios?: boolean; etiqueta?: string } = {}): Promise<Corrida[]> {
  mkdirSync(RESULTADOS, { recursive: true });
  const sql = abrirBD();
  const salida: Corrida[] = [];
  for (const n of numeros) {
    const pregunta = PREGUNTAS[n - 1];
    if (!pregunta) continue;
    const p = montar(sql, { agente: modelo, ...(o.redactor ? { redactor: o.redactor } : {}), ...(o.vision ? { vision: o.vision } : {}), verificador: o.verificador ?? 'gemini-3.8-flash' });
    if (o.sinMedios) delete p.medios;
    const t0 = Date.now();
    let verificacion: Corrida['verificacion'] = null;
    let texto = '';
    console.error(`\n=== [${modelo}] P${n}: ${pregunta}`);
    try {
      const fin = await investigarCompleto(p, pregunta, { profundidad: o.profundidad ?? 'normal', cuaderno: false, sinHistorial: true }, (e) => {
        if (e.tipo === 'plan') console.error(`plan: ${e.plan.enfoque}\n${e.plan.subpreguntas.map((s) => `  - ${s.pregunta} [${s.pruebas.join(', ')}]`).join('\n')}`);
        if (e.tipo === 'paso') console.error(`paso ${e.n} ${e.herramienta} ${JSON.stringify(e.entrada).slice(0, 160)} → ${e.resumen}${e.error ? ` (ERROR ${e.error.slice(0, 100)})` : ''} [${e.ms} ms]`);
        if (e.tipo === 'texto') texto += e.delta;
        if (e.tipo === 'verificacion') { verificacion = e; console.error(`verificación: ${e.respaldadas}/${e.total} respaldadas`); }
        if (e.tipo === 'error') console.error(`ERROR: ${e.mensaje}`);
      });
      console.error(`fin: ${fin.evidencias.length} pruebas citadas, confianza ${fin.confianza}, ${fin.coste.usd.toFixed(3)} $, ${(fin.ms / 1000).toFixed(0)} s, ${fin.coste.pasos} pasos`);
      salida.push({ pregunta, modelo, fin, verificacion, ms: Date.now() - t0 });
    } catch (e) {
      console.error(`FALLO: ${(e as Error).stack}`);
      salida.push({ pregunta, modelo, fin: null, verificacion, error: (e as Error).message, ms: Date.now() - t0 });
    }
    const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const base = join(RESULTADOS, `${sello}-${o.etiqueta ?? modelo}-p${n}`);
    writeFileSync(`${base}.json`, JSON.stringify(salida.at(-1), null, 2));
    const c = salida.at(-1)!;
    if (c.fin) {
      writeFileSync(`${base}.md`, [
        `# ${pregunta}`, `Modelo: ${modelo} · ${c.fin.coste.usd.toFixed(3)} $ · ${(c.fin.ms / 1000).toFixed(0)} s · ${c.fin.coste.pasos} pasos · confianza ${c.fin.confianza}`,
        c.fin.markdown,
        `## Verificación\n${(c.verificacion?.frases ?? []).filter((f) => f.veredicto !== 'respaldada').map((f) => `- ${f.veredicto}: ${f.frase}${f.nota ? ` (${f.nota})` : ''}`).join('\n') || 'Todas respaldadas.'}`,
        `## Pasos\n${c.fin.pasos.map((x) => `- ${x.n}. ${x.herramienta} ${JSON.stringify(x.entrada)} → ${x.resumen}`).join('\n')}`,
        c.fin.avisos.length ? `## Avisos\n${c.fin.avisos.map((a) => `- ${a}`).join('\n')}` : '',
      ].join('\n\n'));
    }
    void texto;
  }
  return salida;
}

if (process.argv[1] && /correr\.ts$/.test(process.argv[1])) {
  const modelo = opcion('modelo') ?? 'gemini-3.1-pro-preview';
  const numeros = (opcion('preguntas') ?? '1').split(',').map(Number).filter(Boolean);
  const profundidad = (opcion('profundidad') ?? 'normal') as 'rapida' | 'normal' | 'exhaustiva';
  correr(modelo, numeros, {
    profundidad, ...(opcion('redactor') ? { redactor: opcion('redactor')! } : {}), ...(opcion('vision') ? { vision: opcion('vision')! } : {}),
    ...(opcion('verificador') ? { verificador: opcion('verificador')! } : {}), ...(opcion('etiqueta') ? { etiqueta: opcion('etiqueta')! } : {}), sinMedios: process.argv.includes('--sin-medios'),
  }).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
