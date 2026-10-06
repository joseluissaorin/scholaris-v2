/**
 * Juicios de relevancia «plata»: cada par (consulta, pasaje) del pool lo juzgan
 * dos modelos independientes con la misma rúbrica 0-3 (Gemini 3.8 Flash y
 * DeepSeek V4 Pro por OpenRouter). Si discrepan en 2 puntos o más, o si
 * discrepan cruzando la frontera de «relevante» (1 frente a 2), adjudica un
 * tercero (Gemini Pro) viendo los dos motivos. Si no, la nota es la media.
 *
 *   pnpm bench calidad juzgar [--solo q001,q002] [--sin-segundo] [--rejuzgar]
 *
 * Las consultas «pagina» no se juzgan: su relevancia sale de la regla
 * (fragmentos que cubren la página pedida).
 */
import { readFileSync } from 'node:fs';
import { anclaACita, enParalelo, type Ancla } from '@scholaris/nucleo';
import { ContadorUso, crearGemini, crearOpenRouter } from '@scholaris/proveedores';
import type { Redactor } from '@scholaris/nucleo';
import { cargarEntorno } from '../entorno.js';
import { abrirEstanteria, mapaDocumentos } from './estanteria.js';
import { cargarConsultas, cargarJuicios, guardarJuicios, type Consulta, type Juicios } from './juego.js';
import { redactorConCache } from './montaje.js';
import { RUTA_POOL, type Pool } from './pool.js';

export const RUBRICA = `Eres un evaluador experto de relevancia para el banco de pruebas de un buscador académico (humanidades, filología, ciencia). Para cada pasaje decides cuánto le sirve a quien escribió la consulta. Escala:
3 = Responde directamente: contiene la respuesta, el dato, la frase citada o el pasaje exacto que se busca (si la consulta pregunta «qué dice X de Y», el pasaje recoge a X hablando de Y).
2 = Relevante: trata el asunto de la consulta y aporta información útil o parte de la respuesta; alguien que investiga ese tema querría verlo.
1 = Marginal: comparte tema, personaje u obra, o menciona de pasada lo buscado, pero no ayuda a responder.
0 = Nada que ver.
Reglas:
- El idioma no importa: un pasaje en inglés puede responder a una consulta en español y al revés. La grafía antigua o los errores de OCR tampoco.
- Si la consulta restringe autor, año, época o tipo de documento («en Lewis», «antes de 1960», «en entrevistas de 1977», «vídeos»), un pasaje de un documento que NO cumple la restricción vale como mucho 1.
- Consultas entre comillas «…»: 3 solo si el pasaje contiene esa frase (admitiendo variantes de grafía); si no la contiene pero trata lo mismo, como mucho 2.
- Juzga solo por el contenido del pasaje y los datos del documento que se te dan; no premies que el pasaje repita palabras de la consulta si no trata lo que se pregunta.
- Sé coherente: el mismo tipo de pasaje recibe la misma nota en todas las consultas.
Devuelve JSON: {"juicios":[{"id":"P1","nota":0-3,"motivo":"≤ 15 palabras"}...]} con TODOS los pasajes.`;

const ESQUEMA = {
  type: 'object',
  properties: {
    juicios: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, nota: { type: 'integer' }, motivo: { type: 'string' } }, required: ['id', 'nota', 'motivo'] },
    },
  },
  required: ['juicios'],
};

const ADJUDICACION = `${RUBRICA}

Ahora eres el árbitro: dos evaluadores dieron notas distintas a estos pasajes; ves sus notas y motivos. Decide tú la nota correcta con la misma escala.`;

interface Pasaje { id: string; texto: string; doc: string }

export interface Jueces { primero: Redactor; segundo?: Redactor; arbitro: Redactor; contador: ContadorUso }

export function montarJueces(o: { segundo?: boolean } = {}): Jueces {
  const env = cargarEntorno(['gemini', 'openrouter']);
  const contador = new ContadorUso();
  const g = crearGemini({ clave: env.GEMINI_API_KEY!, contador, concurrencia: 24, timeoutMs: 120_000 } as never);
  const or = crearOpenRouter({ clave: env.OPENROUTER_API_KEY!, contador, concurrencia: 24, timeoutMs: 180_000 } as never);
  return {
    primero: redactorConCache(g.redactor({ modeloAlto: 'gemini-3.8-flash' }), 'juez-gemini'),
    ...(o.segundo !== false ? { segundo: redactorConCache(or.redactor({ modeloAlto: 'deepseek/deepseek-v4-pro' }), 'juez-deepseek') } : {}),
    arbitro: redactorConCache(g.redactor({ modeloAlto: 'gemini-pro-latest' }), 'juez-arbitro'),
    contador,
  };
}

function textoPasajes(ps: Pasaje[], extra?: (p: Pasaje) => string): string {
  return ps.map((p, i) => `### P${i + 1}\nDocumento: ${p.doc}\n${p.texto.slice(0, 2600)}${extra ? `\n${extra(p)}` : ''}`).join('\n\n');
}

async function juzgarLote(r: Redactor, sistema: string, c: Consulta, ps: Pasaje[], extra?: (p: Pasaje) => string): Promise<Map<string, { nota: number; motivo: string }>> {
  const salida = new Map<string, { nota: number; motivo: string }>();
  for (let intento = 0; intento < 3 && salida.size < ps.length; intento++) {
    try {
      const res = await r.generar<{ juicios: Array<{ id: string; nota: number; motivo: string }> }>({
        sistema,
        mensajes: [{ rol: 'usuario', partes: [{ texto: `CONSULTA: ${c.consulta}${intento ? `\n(intento ${intento + 1})` : ''}\n\n${textoPasajes(ps, extra)}` }] }],
        esquema: ESQUEMA, temperatura: 0, maxTokens: 4000, calidad: 'alta',
      });
      for (const j of res.json?.juicios ?? []) {
        const k = Number(String(j.id).replace(/\D/g, '')) - 1;
        const p = ps[k];
        if (p && Number.isFinite(j.nota)) salida.set(p.id, { nota: Math.max(0, Math.min(3, Math.round(j.nota))), motivo: String(j.motivo ?? '').slice(0, 160) });
      }
    } catch (e) {
      if (intento === 2) console.error(`  ${c.id}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  return salida;
}

/** Fragmentos que cubren una página física: la relevancia de las consultas de navegación. */
export function relevantesDePagina(bd: ReturnType<typeof abrirEstanteria>['bd'], docId: string, fisica: number): string[] {
  const filas = bd.prepare('SELECT id, ancla, ancla_fin FROM fragmentos WHERE documento = ?').all(docId) as Array<{ id: string; ancla: string; ancla_fin: string | null }>;
  return filas.filter((f) => {
    const a = JSON.parse(f.ancla) as { fisica?: number };
    const b = f.ancla_fin ? (JSON.parse(f.ancla_fin) as { fisica?: number }) : a;
    return a.fisica !== undefined && a.fisica <= fisica && (b.fisica ?? a.fisica) >= fisica;
  }).map((f) => f.id);
}

export async function juzgar(args: string[]): Promise<void> {
  const rejuzgar = args.includes('--rejuzgar');
  const solo = args.includes('--solo') ? new Set(args[args.indexOf('--solo') + 1]!.split(',')) : null;
  const jueces = montarJueces({ segundo: !args.includes('--sin-segundo') });
  const sql = abrirEstanteria();
  const docs = mapaDocumentos(sql.bd);
  const porCorto = new Map([...docs].map(([id, d]) => [d.corto, id]));
  const pool = JSON.parse(readFileSync(RUTA_POOL, 'utf8')) as Pool;
  const juicios: Juicios = cargarJuicios();
  const consultas = cargarConsultas().filter((c) => !solo || solo.has(c.id));
  const frag = sql.bd.prepare('SELECT id, documento, texto, ancla, ancla_fin FROM fragmentos WHERE id = ?');

  // Consultas de navegación: por regla.
  for (const c of consultas.filter((x) => x.pagina)) {
    const doc = porCorto.get(c.pagina!.documento)!;
    juicios[c.id] = Object.fromEntries(relevantesDePagina(sql.bd, doc, c.pagina!.fisica).map((id) => [id, { nota: 3, fuente: 'regla' as const }]));
  }

  let hechas = 0, adjudicadas = 0;
  const pendientes = consultas.filter((c) => !c.pagina);
  await enParalelo(pendientes, 12, async (c) => {
    const previos = juicios[c.id] ?? {};
    // Solo pares sin juicio (con --rejuzgar, también los de plata).
    const ids = (pool[c.id]?.fragmentos ?? []).filter((id) => !previos[id] || (rejuzgar && previos[id]!.fuente === 'plata'));
    const pasajes: Pasaje[] = ids.map((id) => {
      const f = frag.get(id) as { id: string; documento: string; texto: string; ancla: string; ancla_fin: string | null };
      const d = docs.get(f.documento)!;
      const donde = anclaACita(JSON.parse(f.ancla) as Ancla, f.ancla_fin ? JSON.parse(f.ancla_fin) as Ancla : undefined);
      return { id, texto: f.texto, doc: `«${d.titulo}», ${d.autores ?? 's. a.'}, ${d.anio ?? 's. f.'} (${d.tipo}, ${d.idioma}), ${donde}` };
    });
    const lotes: Pasaje[][] = [];
    for (let i = 0; i < pasajes.length; i += 10) lotes.push(pasajes.slice(i, i + 10));
    const r1 = new Map<string, { nota: number; motivo: string }>();
    const r2 = new Map<string, { nota: number; motivo: string }>();
    await Promise.all(lotes.map(async (l) => {
      const [a, b] = await Promise.all([
        juzgarLote(jueces.primero, RUBRICA, c, l),
        jueces.segundo ? juzgarLote(jueces.segundo, RUBRICA, c, l) : Promise.resolve(new Map()),
      ]);
      for (const [k, v] of a) r1.set(k, v);
      for (const [k, v] of b) r2.set(k, v);
    }));
    // Adjudicación.
    const dudosos = pasajes.filter((p) => {
      const a = r1.get(p.id)?.nota, b = r2.get(p.id)?.nota;
      if (a === undefined || b === undefined) return false;
      return Math.abs(a - b) >= 2 || (Math.min(a, b) === 1 && Math.max(a, b) === 2);
    });
    const r3 = new Map<string, { nota: number; motivo: string }>();
    for (let i = 0; i < dudosos.length; i += 10) {
      const l = dudosos.slice(i, i + 10);
      const x = await juzgarLote(jueces.arbitro, ADJUDICACION, c, l, (p) => `Evaluador A: ${r1.get(p.id)!.nota} («${r1.get(p.id)!.motivo}»). Evaluador B: ${r2.get(p.id)!.nota} («${r2.get(p.id)!.motivo}»).`);
      for (const [k, v] of x) r3.set(k, v);
    }
    adjudicadas += r3.size;
    const salida: Juicios[string] = { ...previos };
    for (const p of pasajes) {
      const a = r1.get(p.id), b = r2.get(p.id), z = r3.get(p.id);
      if (!a && !b) continue;
      const nota = z ? z.nota : a && b ? (a.nota + b.nota) / 2 : (a ?? b)!.nota;
      salida[p.id] = {
        nota, ...(a ? { j1: a.nota } : {}), ...(b ? { j2: b.nota } : {}), ...(z ? { j3: z.nota } : {}),
        motivo: (z ?? a ?? b)!.motivo, fuente: 'plata', huella: p.texto.slice(0, 80),
      };
    }
    juicios[c.id] = salida;
    if (++hechas % 10 === 0) {
      guardarJuicios(juicios);
      console.error(`  ${hechas}/${pendientes.length} consultas; ${adjudicadas} adjudicaciones; ${jueces.contador.total().usd.toFixed(2)} $`);
    }
  });
  guardarJuicios(juicios);
  console.error(`Juicios listos: ${hechas} consultas, ${adjudicadas} adjudicaciones, ${jueces.contador.total().usd.toFixed(2)} $`);
  // Acuerdo entre jueces.
  let n = 0, iguales = 0, cerca = 0, binA = 0;
  for (const q of Object.values(juicios)) for (const j of Object.values(q)) {
    if (j.j1 === undefined || j.j2 === undefined) continue;
    n++; if (j.j1 === j.j2) iguales++; if (Math.abs(j.j1 - j.j2) <= 1) cerca++;
    if ((j.j1 >= 2) === (j.j2 >= 2)) binA++;
  }
  console.error(`Acuerdo: exacto ${(iguales / n * 100).toFixed(1)} %, ±1 ${(cerca / n * 100).toFixed(1)} %, binario (≥2) ${(binA / n * 100).toFixed(1)} % sobre ${n} pares`);
}
