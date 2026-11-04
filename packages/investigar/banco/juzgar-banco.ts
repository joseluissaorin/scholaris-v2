/**
 * Un subconjunto del banco de comprensión (bench/comprension) contra el agente en local:
 * cada pregunta se investiga sobre la copia local de la biblioteca (preparar.ts) y la
 * respuesta se juzga con el mismo juez y las mismas fuentes reales que el banco. Se compara
 * con el informe de producción que se le dé.
 *
 *   npx tsx packages/investigar/banco/juzgar-banco.ts --solo q01,q04 [--informe <json de producción>] [--etiqueta texto]
 *
 * El banco es privado (obras con derechos): se lee de SCHOLARIS_BANCO_COMPRENSION o de la
 * copia del banco del equipo; nada de él se escribe en el repositorio.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crearCliente } from '@scholaris/contrato';
import type { EventoInvestigacion, EvidenciaInvestigacion } from '@scholaris/contrato';
import { investigar } from '../src/agente.js';
import { abrirBD, configGemini, DATOS, DIR, montar, RESULTADOS, secreto } from './comun.js';

function opcion(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const BANCO = process.env.SCHOLARIS_BANCO_COMPRENSION ?? '/Users/joseluissaorin/Developer/sn-banco/bench/datos/comprension/banco';
const BENCH = resolve(DIR, '..', '..', '..', 'bench', 'src', 'comprension');
const VIDEO = process.env.SCHOLARIS_VIDEO_BANCO ?? '/Users/joseluissaorin/tmp/scholaris-fresa/banco/fuentes/proxy-360.mp4';

interface Veredictos { [k: string]: number }

async function principal() {
  // Los módulos del banco se cargan por su ruta (no son parte de este paquete).
  const juez = await import(join(BENCH, 'juez.js')) as { juzgarPregunta: (p: unknown, r: unknown, o: unknown) => Promise<{ puntuacion: Record<string, number>; citas: Array<{ veredicto: string; frase: string; motivo: string; cita: string; origen: string }>; trampas: Array<{ activada?: boolean; veredicto?: string }> }> };
  const modelo = await import(join(BENCH, 'modelo.js')) as { juezGemini: (o: { clave: string; modelo: string }) => unknown; juezConCache: (j: unknown, dir: string) => unknown };
  const fuentesMod = await import(join(BENCH, 'fuentes.js')) as { cargarFuentes: (api: unknown, ids: string[], dir: string, refrescar?: boolean) => Promise<unknown> };
  const miradorMod = await import(join(BENCH, 'mirador.js')) as { crearMirador: (o: unknown) => unknown };
  const banco = JSON.parse(readFileSync(join(BANCO, 'preguntas.json'), 'utf8')) as { documentos: Record<string, { titulo: string }>; preguntas: Array<{ id: string; pregunta: string; documentos: string[] }> };
  const solo = (opcion('solo') ?? 'q01').split(',');
  const preguntas = banco.preguntas.filter((p) => solo.includes(p.id));
  const etiqueta = opcion('etiqueta') ?? 'local';
  const dir = join(RESULTADOS, 'banco-comprension', etiqueta);
  mkdirSync(dir, { recursive: true });
  const gemini = configGemini().clave;
  const api = crearCliente({ base: secreto('scholaris.env', 'SCHOLARIS_URL'), token: secreto('scholaris.env', 'SCHOLARIS_CLAVE') });
  const lector = {
    documento: async (id: string) => await api.documentos.obtener(id) as unknown as { id: string; titulo?: string; tipo: string; unidades?: number; duracion?: number },
    unidades: (id: string, desde: number, hasta: number) => api.documentos.unidades(id, desde, hasta),
  };
  const dirFuentes = join(DATOS, 'comprension', 'fuentes');
  const refrescar = !existsSync(dirFuentes);
  const fuentes = await fuentesMod.cargarFuentes(lector, Object.keys(banco.documentos), dirFuentes, refrescar);
  const j = modelo.juezConCache(modelo.juezGemini({ clave: gemini, modelo: 'gemini-4-argon' }), join(DATOS, 'comprension', 'cache-juez'));
  const mirador = existsSync(VIDEO) ? miradorMod.crearMirador({ videos: { dmw21xnomjseg07mi: VIDEO }, juez: j, dirRecortes: join(DATOS, 'comprension', 'recortes') }) : undefined;
  const titulos = Object.fromEntries(Object.entries(banco.documentos).map(([k, v]) => [k, v.titulo]));
  const produccion = opcion('informe') ? JSON.parse(readFileSync(opcion('informe')!, 'utf8')) as { detalle: Array<{ pregunta: { id: string }; respuesta: { usd?: number; ms: number }; juicio: { puntuacion: Record<string, number>; citas: Array<{ veredicto: string }>; trampas: Array<{ activada?: boolean; veredicto?: string }> } }> } : null;
  const sql = abrirBD();
  const filas: string[] = ['| pregunta | sistema | nota | acierto | exhaust. | sostiene | parcial | no sostiene | inventadas | trampas | $ | s |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  const totales: Record<string, Veredictos> = {};
  const contar = (sistema: string, citas: Array<{ veredicto: string }>) => {
    const t = (totales[sistema] ??= {});
    for (const c of citas) t[c.veredicto] = (t[c.veredicto] ?? 0) + 1;
  };
  for (const p of preguntas) {
    const ruta = join(dir, `${p.id}.respuesta.json`);
    let r: { markdown: string; citas: unknown[]; ms: number; usd?: number; avisos?: string[]; error?: string; modo: string; preguntaId: string; fecha: string };
    if (existsSync(ruta)) r = JSON.parse(readFileSync(ruta, 'utf8'));
    else {
      const puertos = montar(sql, { agente: 'gemini-4-argon', vision: 'gemini-3.8-flash', verificador: 'gemini-3.8-flash' });
      const t0 = Date.now();
      let fin: Extract<EventoInvestigacion, { tipo: 'fin' }> | null = null;
      let error: string | undefined;
      for await (const e of investigar(puertos, p.pregunta, { profundidad: 'normal', cuaderno: false, sinHistorial: true })) {
        if (e.tipo === 'paso') console.error(`  ${p.id} paso ${e.n} ${e.herramienta} → ${e.resumen}`);
        if (e.tipo === 'fin') fin = e;
        if (e.tipo === 'error') error = e.mensaje;
      }
      const evidencias: EvidenciaInvestigacion[] = fin?.evidencias ?? [];
      r = {
        modo: 'investigar', preguntaId: p.id, markdown: fin?.markdown ?? '', ms: Date.now() - t0, fecha: new Date().toISOString(),
        citas: evidencias.map((ev) => ({ id: ev.id, documento: ev.documento, ancla: ev.ancla, ...(ev.anclaFin ? { anclaFin: ev.anclaFin } : {}), etiqueta: ev.etiqueta, ...(ev.cita ? { texto: ev.cita } : {}), ...(ev.fragmento ? { fragmento: ev.fragmento } : {}), modo: ev.modo })),
        ...(fin ? { usd: fin.coste.usd, avisos: fin.avisos } : {}), ...(error ? { error } : {}),
      };
      writeFileSync(ruta, JSON.stringify(r, null, 1));
    }
    const juicio = await juez.juzgarPregunta(p, r, { juez: j, fuentes, titulos, ...(mirador ? { mirador } : {}) });
    writeFileSync(join(dir, `${p.id}.juicio.json`), JSON.stringify(juicio, null, 1));
    contar('local', juicio.citas);
    const fila = (sistema: string, pu: Record<string, number>, citas: Array<{ veredicto: string }>, trampas: Array<{ activada?: boolean; veredicto?: string }>, usd?: number, ms?: number) => {
      const v = (k: string) => citas.filter((c) => c.veredicto === k).length;
      const activadas = trampas.filter((t) => t.activada || t.veredicto === 'activada').length;
      return `| ${p.id} | ${sistema} | ${(pu.nota ?? 0).toFixed(1)} | ${((pu.acierto ?? 0) * 100).toFixed(0)} % | ${((pu.exhaustividad ?? 0) * 100).toFixed(0)} % | ${v('sostiene')} | ${v('parcial')} | ${v('no_sostiene')} | ${v('inventada')} | ${activadas} | ${usd?.toFixed(3) ?? '-'} | ${ms ? Math.round(ms / 1000) : '-'} |`;
    };
    const pr = produccion?.detalle.find((d) => d.pregunta.id === p.id);
    if (pr) { filas.push(fila('producción', pr.juicio.puntuacion, pr.juicio.citas, pr.juicio.trampas, pr.respuesta.usd, pr.respuesta.ms)); contar('producción', pr.juicio.citas); }
    filas.push(fila('local', juicio.puntuacion, juicio.citas, juicio.trampas, r.usd, r.ms));
    console.error(filas.slice(-2).join('\n'));
  }
  const resumen = Object.entries(totales).map(([s, t]) => {
    const n = Object.values(t).reduce((a, b) => a + b, 0);
    return `${s}: ${n} citas; ${Object.entries(t).map(([k, x]) => `${k} ${x} (${((x / n) * 100).toFixed(1)} %)`).join(', ')}`;
  });
  const salida = `${filas.join('\n')}\n\n${resumen.join('\n')}\n`;
  writeFileSync(join(dir, 'resumen.md'), salida);
  console.log(salida);
}

principal().catch((e) => { console.error(e); process.exit(1); });
