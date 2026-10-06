/**
 * Juego de citas: afirmaciones como las escribiría alguien en un trabajo, con
 * los pasajes que las respaldan (oro) y afirmaciones sin respaldo en la
 * biblioteca (negativas: falsas, contradichas o ajenas). Mide la autocita y la
 * verificación: precisión y exhaustividad de las citas, citas indebidas en las
 * negativas y citas inventadas (deben ser 0).
 *
 *   pnpm bench calidad citas-proponer     borrador (Gemini) → bench/datos/calidad/citas-propuestas.json
 *   pnpm bench calidad citas-juzgar       amplía el oro con el pool y dos jueces → bench/calidad/citas.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { anclaACita, enParalelo, type Ancla, type Fragmento } from '@scholaris/nucleo';
import { autocitar, verificarAfirmacion } from '@scholaris/citas';
import { contieneLiteral } from '@scholaris/busqueda';
import { CORPUS, DIR_DATOS_CALIDAD, mapaDocumentos } from './estanteria.js';
import { RUTA_CITAS } from './juego.js';
import { buscadorPara, montar, SISTEMAS, type Montaje } from './montaje.js';
import { montarJueces } from './juzgar.js';

export interface AfirmacionBanco {
  id: string;
  texto: string;
  /** «apoyo»: la biblioteca la respalda; «negativa»: no debe citarse nada. */
  tipo: 'apoyo' | 'negativa';
  /** Por qué es negativa: falsa (contradicha por el documento) o ajena (no está en la biblioteca). */
  motivo?: string;
  documentos: string[];
  /** Fragmentos que la respaldan directamente. */
  oro: string[];
  /** Fragmentos relacionados que no la respaldan (para medir la precisión del juez). */
  negativos: string[];
  /** Además del oro, se aceptan citas a la misma página o tramo que un fragmento de oro. */
}

const RUTA_PROPUESTAS = join(DIR_DATOS_CALIDAD, 'citas-propuestas.json');

const SISTEMA_PROPONER = `Preparas el banco de pruebas de un sistema que inserta citas en trabajos académicos. Recibes UN documento en fragmentos con su id.
Escribe afirmaciones como frases de un ensayo o un TFG en español (o en inglés si el documento es inglés y te lo pido), parafraseando con tus palabras, NUNCA copiando frases del documento:
- "apoyo": afirmaciones que el documento respalda directamente; da los ids de los fragmentos que las respaldan (1-3).
- "negativa": afirmaciones plausibles sobre el mismo autor o tema que el documento NO respalda: o bien lo contradicen (cambia un dato, una fecha, una postura), o bien tratan algo que no aparece. En "motivo" pon «contradicha» o «ajena».
Reparte las afirmaciones por todo el documento.`;

const ESQUEMA_PROPONER = {
  type: 'object',
  properties: {
    afirmaciones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          texto: { type: 'string' }, tipo: { type: 'string', enum: ['apoyo', 'negativa'] },
          motivo: { type: 'string' }, fragmentos: { type: 'array', items: { type: 'string' } },
        },
        required: ['texto', 'tipo', 'fragmentos'],
      },
    },
  },
  required: ['afirmaciones'],
};

/** Afirmaciones por documento: las de corpus.json («citas»). */
const PLAN: Record<string, { apoyo: number; negativa: number; idioma: string }> = Object.fromEntries(CORPUS.filter((d) => d.citas).map((d) => [d.corto, d.citas!]));

export async function proponerCitas(): Promise<void> {
  const m = montar();
  const docs = mapaDocumentos(m.sql.bd);
  const salida: Array<Record<string, unknown>> = [];
  await Promise.all([...docs].map(async ([id, d]) => {
    const p = PLAN[d.corto];
    if (!p) return;
    const frags = m.sql.bd.prepare('SELECT id, texto, ancla FROM fragmentos WHERE documento = ? ORDER BY orden').all(id) as Array<{ id: string; texto: string; ancla: string }>;
    const cuerpo = frags.map((f) => `[${f.id}] (${anclaACita(JSON.parse(f.ancla) as Ancla)})\n${f.texto}`).join('\n\n');
    const r = await m.redactor.generar<{ afirmaciones: Array<{ texto: string; tipo: 'apoyo' | 'negativa'; motivo?: string; fragmentos: string[] }> }>({
      sistema: SISTEMA_PROPONER,
      mensajes: [{ rol: 'usuario', partes: [{ texto: `Documento: «${d.titulo}» (${d.autores}, ${d.anio ?? 's. f.'}, ${d.tipo}). Escribe ${p.apoyo} afirmaciones de apoyo y ${p.negativa} negativas, en ${p.idioma === 'en' ? 'inglés' : 'español'}.\n\n${cuerpo}` }] }],
      esquema: ESQUEMA_PROPONER, temperatura: 0.6, maxTokens: 8000, calidad: 'alta',
    });
    const validos = new Set(frags.map((f) => f.id));
    for (const a of r.json?.afirmaciones ?? []) salida.push({ ...a, documento: d.corto, fragmentos: a.fragmentos.filter((x) => validos.has(x)) });
  }));
  writeFileSync(RUTA_PROPUESTAS, JSON.stringify(salida, null, 1));
  console.error(`${salida.length} afirmaciones → ${RUTA_PROPUESTAS}`);
}

const RUBRICA_APOYO = `Evalúas si un pasaje de una biblioteca RESPALDA una afirmación de un trabajo académico, de modo que citarlo ahí sea correcto.
2 = La respalda directamente: el pasaje dice eso (aunque con otras palabras o en otro idioma).
1 = Relacionado: mismo tema, pero no establece esa afirmación concreta (o la contradice en algún dato).
0 = Nada que ver.
Devuelve JSON {"juicios":[{"id":"P1","nota":0-2,"motivo":"≤ 15 palabras"}]} con todos los pasajes.`;

/** Amplía el oro: pool de búsqueda para cada afirmación y dos jueces de respaldo. */
export async function juzgarCitas(): Promise<void> {
  const m = montar();
  const jueces = montarJueces();
  const docs = mapaDocumentos(m.sql.bd);
  const porCorto = new Map([...docs].map(([id, d]) => [d.corto, id]));
  const propuestas = JSON.parse(readFileSync(RUTA_PROPUESTAS, 'utf8')) as Array<{ texto: string; tipo: 'apoyo' | 'negativa'; motivo?: string; fragmentos: string[]; documento: string }>;
  const b = buscadorPara(m, SISTEMAS.find((s) => s.nombre === 'hibrida')!);
  const frag = m.sql.bd.prepare('SELECT texto, documento FROM fragmentos WHERE id = ?');
  const salida: AfirmacionBanco[] = [];
  await enParalelo(propuestas.map((p, i) => ({ p, i })), 8, async ({ p, i }) => {
    const r = await b.buscar(p.texto, { limite: 12, comprender: false, reordenar: false });
    const ids = [...new Set([...p.fragmentos, ...r.resultados.map((x) => x.fragmento.id)])];
    const pasajes = ids.map((id) => { const f = frag.get(id) as { texto: string; documento: string }; return `### P${ids.indexOf(id) + 1}\nDocumento: «${docs.get(f.documento)?.titulo}» (${docs.get(f.documento)?.autores})\n${f.texto.slice(0, 2500)}`; }).join('\n\n');
    const pedir = (red: typeof jueces.primero) => red.generar<{ juicios: Array<{ id: string; nota: number }> }>({
      sistema: RUBRICA_APOYO, mensajes: [{ rol: 'usuario', partes: [{ texto: `AFIRMACIÓN: ${p.texto}\n\n${pasajes}` }] }],
      esquema: { type: 'object', properties: { juicios: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, nota: { type: 'integer' }, motivo: { type: 'string' } }, required: ['id', 'nota'] } } }, required: ['juicios'] },
      temperatura: 0, maxTokens: 3000, calidad: 'alta',
    }).then((x) => new Map((x.json?.juicios ?? []).map((j) => [ids[Number(String(j.id).replace(/\D/g, '')) - 1], j.nota]))).catch(() => new Map<string | undefined, number>());
    const [a, z] = await Promise.all([pedir(jueces.primero), pedir(jueces.segundo!)]);
    const oro: string[] = [], negativos: string[] = [];
    for (const id of ids) {
      const x = a.get(id) ?? 0, y = z.get(id) ?? 0;
      if (p.tipo === 'apoyo' && (x + y >= 3 || (p.fragmentos.includes(id) && x + y >= 2))) oro.push(id);
      else if (x + y <= 2 && (x >= 1 || y >= 1)) negativos.push(id);
      else if (p.tipo === 'negativa' && x + y >= 3) oro.push(id); // una «negativa» que sí tiene respaldo: se revisa abajo
    }
    salida.push({
      id: `c${String(i + 1).padStart(3, '0')}`, texto: p.texto,
      // Una negativa con respaldo claro de los dos jueces deja de ser negativa.
      tipo: p.tipo === 'negativa' && oro.length ? 'apoyo' : p.tipo,
      ...(p.motivo && !(p.tipo === 'negativa' && oro.length) ? { motivo: p.motivo } : {}),
      documentos: [p.documento], oro, negativos: negativos.slice(0, 6),
    });
  });
  salida.sort((x, y) => x.id.localeCompare(y.id));
  const sinOro = salida.filter((s) => s.tipo === 'apoyo' && !s.oro.length);
  for (const s of sinOro) { s.tipo = 'negativa'; s.motivo = 'sin respaldo según los jueces'; }
  writeFileSync(RUTA_CITAS, JSON.stringify(salida, null, 1));
  console.error(`${salida.length} afirmaciones (${salida.filter((s) => s.tipo === 'apoyo').length} con apoyo) → ${RUTA_CITAS}; ${jueces.contador.total().usd.toFixed(2)} $`);
  void porCorto;
}

export interface MetricasCitas {
  afirmaciones: number;
  precision: number;
  exhaustividad: number;
  /** Citas aceptadas en afirmaciones negativas (deben ser pocas). */
  indebidas: number;
  /** Citas cuyo fragmento, ancla o evidencia no existen en la biblioteca (deben ser 0). */
  inventadas: number;
  /** Veredicto de verificarAfirmacion correcto (respaldada / sin respaldo). */
  verificacion: number;
  ms: number;
  usd: number;
}

/** Evalúa autocita y verificación sobre el juego de citas. */
export async function evaluarCitas(m: Montaje, sistema = 'completa'): Promise<MetricasCitas & { detalle: unknown[] }> {
  if (!existsSync(RUTA_CITAS)) throw new Error('Falta bench/calidad/citas.json');
  const juego = JSON.parse(readFileSync(RUTA_CITAS, 'utf8')) as AfirmacionBanco[];
  const s = SISTEMAS.find((x) => x.nombre === sistema)!;
  const buscador = buscadorPara(m, s);
  const ancla = m.sql.bd.prepare('SELECT documento, unidad, ancla, ancla_fin, texto FROM fragmentos WHERE id = ?');
  const usd0 = m.contador.total().usd;
  const t0 = performance.now();
  let tp = 0, fp = 0, conAcierto = 0, apoyos = 0, indebidas = 0, inventadas = 0, verOk = 0;
  const detalle: unknown[] = [];
  await enParalelo(juego, 6, async (a) => {
    const [ac, ver] = await Promise.all([
      autocitar(a.texto, { buscador, redactor: m.redactor, juez: m.ia.juez }),
      verificarAfirmacion(a.texto, { buscador, juez: m.ia.juez }),
    ]);
    const citas = ac.afirmaciones.flatMap((x) => x.citas).filter((c) => c.estado === 'aceptada');
    // Rango de páginas físicas de un fragmento o de una cita (las citas pueden fundir pasajes cercanos: «pp. 166-168»).
    const rango = (ini: Ancla, fin?: Ancla | null): [number, number] | null =>
      ini.tipo === 'pagina' ? [ini.fisica, fin?.tipo === 'pagina' ? fin.fisica : ini.fisica] : null;
    const oro = a.oro.map((id) => ancla.get(id) as { documento: string; unidad: string; ancla: string; ancla_fin: string | null } | undefined).filter((x) => !!x);
    let acierto = false;
    const vistas: unknown[] = [];
    for (const c of citas) {
      const f = ancla.get(c.fragmento) as { documento: string; unidad: string; ancla: string; ancla_fin: string | null; texto: string } | undefined;
      const rc = rango(c.ancla as Ancla, c.anclaFin as Ancla | undefined);
      const rf = f ? rango(JSON.parse(f.ancla) as Ancla, f.ancla_fin ? JSON.parse(f.ancla_fin) as Ancla : null) : null;
      // Inventada: el fragmento no existe, es de otro documento, la cita no cubre sus páginas
      // (o, si no es de páginas, el ancla no es la suya) o la evidencia no está literalmente en el pasaje.
      const inventada = !f || f.documento !== c.documento
        || (rc && rf ? !(rc[0] <= rf[0] && rf[1] <= rc[1]) : JSON.stringify(JSON.parse(f.ancla)) !== JSON.stringify(c.ancla))
        || (c.evidencia ? !contieneLiteral(c.pasaje || f.texto, c.evidencia) : false);
      if (inventada) inventadas++;
      const buena = !inventada && (a.oro.includes(c.fragmento) || oro.some((o) => {
        if (o.documento !== f!.documento) return false;
        if (o.unidad === f!.unidad) return true;
        const ro = rango(JSON.parse(o.ancla) as Ancla, o.ancla_fin ? JSON.parse(o.ancla_fin) as Ancla : null);
        return !!(ro && rc && ro[0] <= rc[1] && rc[0] <= ro[1]);
      }));
      if (a.tipo === 'negativa') indebidas++;
      else if (buena) { tp++; acierto = true; } else fp++;
      vistas.push({ fragmento: c.fragmento, donde: anclaACita(c.ancla as Ancla, c.anclaFin as Ancla | undefined), buena, inventada, respaldo: c.respaldo });
    }
    if (a.tipo === 'apoyo') { apoyos++; if (acierto) conAcierto++; }
    const veredictoOk = a.tipo === 'apoyo' ? ver.veredicto === 'respaldada' || ver.veredicto === 'parcial' : ver.veredicto === 'sin_respaldo' || ver.veredicto === 'contradicha';
    if (veredictoOk) verOk++;
    detalle.push({ id: a.id, tipo: a.tipo, citas: vistas, veredicto: ver.veredicto, bibliografia: ac.bibliografia });
  });
  void ({} as Fragmento);
  return {
    afirmaciones: juego.length,
    precision: tp + fp ? tp / (tp + fp) : 0,
    exhaustividad: apoyos ? conAcierto / apoyos : 0,
    indebidas, inventadas,
    verificacion: verOk / juego.length,
    ms: Math.round((performance.now() - t0) / juego.length),
    usd: m.contador.total().usd - usd0,
    detalle: detalle.sort((x, y) => String((x as { id: string }).id).localeCompare(String((y as { id: string }).id))),
  };
}
