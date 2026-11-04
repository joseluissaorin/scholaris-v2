/**
 * La memoria de las investigaciones, con lo que ya existe en @scholaris/funciones:
 * - «recordar» busca en el historial (preguntas y respuestas anteriores) y en los
 *   cuadernos (sus tarjetas verificadas, notas e hipótesis y sus síntesis, por
 *   `cuadernos_fts`); las tarjetas con pasaje y ancla vuelven como pruebas;
 * - «anotar» guarda hallazgos, hipótesis y cabos sueltos;
 * - al terminar, la pregunta queda en el historial y la investigación en un
 *   cuaderno: cada prueba citada es una tarjeta verificada (pasaje literal, ancla y
 *   huella, que «reverificar» comprueba), las notas son tarjetas de tipo nota, y la
 *   respuesta es una síntesis que solo cita esas tarjetas.
 */
import type { Ancla, AnclaMaterial, Evidencia, Filtros } from '@scholaris/nucleo';
import type { EvidenciaInvestigacion, FraseVerificada, PlanInvestigacion } from '@scholaris/contrato';
import { crearCuaderno, crearTarjeta, guardarSintesis, listarTarjetas, obtenerCuaderno, registrarBusqueda, type PuertosFunciones } from '@scholaris/funciones';
import { modoDeAncla } from '@scholaris/busqueda';
import { apuntar, fallo, lineaPrueba, recortar, texto, type ContextoHerramientas, type Herramienta, type Nota } from './contexto.js';
import { leerUnidades } from './pruebas.js';

/** Consulta FTS5 amplia y segura: cada palabra entre comillas, unidas con OR. */
export function consultaAmplia(q: string): string | null {
  const palabras = [...new Set((q.normalize('NFC').match(/[\p{L}\p{N}]+/gu) ?? []).filter((p) => p.length > 2).map((p) => p.toLowerCase()))].slice(0, 24);
  return palabras.length ? palabras.map((p) => `"${p}"`).join(' OR ') : null;
}

interface FilaTarjeta { id: string; cuaderno: string; tipo: string; documento: string | null; objetivo: string | null; ancla: string | null; ancla_fin: string | null; pasaje: string | null; cita: string | null; contenido: string; estado: string }

const recordar: Herramienta = {
  declaracion: {
    nombre: 'recordar',
    descripcion: 'Busca en la memoria: preguntas y respuestas anteriores del historial, y los cuadernos de investigaciones pasadas (pruebas verificadas, hallazgos, hipótesis y síntesis). Las pruebas verificadas vuelven como [P#] citables. Úsalo al principio para no repetir trabajo.',
    parametros: { type: 'object', properties: { consulta: { type: 'string', description: 'De qué se trata.' } }, required: ['consulta'] },
  },
  async ejecutar(args, ctx) {
    const q = consultaAmplia(texto(args.consulta));
    if (!q) return fallo('Falta «consulta».');
    const sql = ctx.p.sql;
    const lineas: string[] = [];
    const nuevas: string[] = [];
    try {
      const hs = await sql.ejecutar<{ id: string; tipo: string; consulta: string; respuesta: string | null; confianza: string | null; creada: string }>(
        `SELECT h.id, h.tipo, h.consulta, h.respuesta, h.confianza, h.creada FROM historial_fts JOIN historial h ON h.n = historial_fts.rowid
          WHERE historial_fts MATCH ? AND h.estado = 'ok' ORDER BY rank LIMIT 5`, q);
      for (const h of hs) {
        lineas.push(`Historial (${h.tipo}, ${h.creada.slice(0, 10)}${h.confianza ? `, confianza ${h.confianza}` : ''}): «${recortar(h.consulta, 200)}»${h.respuesta ? `\n  Respuesta entonces: ${recortar(h.respuesta.replace(/\n+/g, ' '), 700)}` : ''}`);
      }
    } catch { /* sin historial */ }
    try {
      const filas = await sql.ejecutar<{ objeto: string; clase: string; cuaderno: string }>(
        'SELECT objeto, clase, cuaderno FROM cuadernos_fts WHERE cuadernos_fts MATCH ? ORDER BY rank LIMIT 14', q);
      const titulos = new Map<string, string>();
      const tituloDe = async (id: string) => {
        if (!titulos.has(id)) titulos.set(id, await obtenerCuaderno(sql, id).then((c) => c.titulo).catch(() => ''));
        return titulos.get(id) ?? '';
      };
      const tarjetas = filas.filter((f) => f.clase === 'tarjeta').map((f) => f.objeto);
      const porId = new Map<string, FilaTarjeta>();
      for (const id of tarjetas) {
        const [t] = await sql.ejecutar<FilaTarjeta>('SELECT id, cuaderno, tipo, documento, objetivo, ancla, ancla_fin, pasaje, cita, contenido, estado FROM cuadernos_tarjetas WHERE id = ?', id);
        if (t) porId.set(id, t);
      }
      const unidades = await leerUnidades(sql, [...porId.values()].filter((t) => t.tipo === 'unidad' && t.objetivo).map((t) => t.objetivo!)).catch(() => new Map());
      for (const f of filas) {
        const c = await tituloDe(f.cuaderno);
        if (f.clase === 'cuaderno') { lineas.push(`Cuaderno «${c}» [${f.cuaderno}]`); continue; }
        if (f.clase === 'sintesis') {
          const [s] = await sql.ejecutar<{ peticion: string; cuerpo: string; confianza: string | null }>('SELECT peticion, cuerpo, confianza FROM cuadernos_sintesis WHERE id = ?', f.objeto);
          if (s) lineas.push(`Síntesis del cuaderno «${c}» («${recortar(s.peticion, 160)}»${s.confianza ? `, confianza ${s.confianza}` : ''}): ${recortar(s.cuerpo.replace(/\n+/g, ' '), 900)}`);
          continue;
        }
        const t = porId.get(f.objeto);
        if (!t) continue;
        const contenido = (() => { try { return JSON.parse(t.contenido) as Record<string, unknown>; } catch { return {}; } })();
        if (t.tipo === 'nota' || !t.pasaje || !t.documento || !t.ancla || t.estado === 'huerfana') {
          const nota = texto(contenido.texto) || texto(contenido.comentario);
          if (nota) lineas.push(`Nota (${texto(contenido.clase) || 'nota'}) del cuaderno «${c}»: ${recortar(nota, 500)}`);
          continue;
        }
        if (ctx.ambito && !ctx.ambito.has(t.documento)) continue;
        const guardada = contenido.evidencia as Partial<EvidenciaInvestigacion> | undefined;
        const ancla = (guardada?.ancla ?? JSON.parse(t.ancla)) as AnclaMaterial;
        const fin = guardada?.anclaFin ?? (t.ancla_fin ? (JSON.parse(t.ancla_fin) as Ancla) : undefined);
        const e: Evidencia = {
          documento: t.documento, ancla, ...(fin ? { anclaFin: fin as AnclaMaterial } : {}),
          cita: guardada?.cita ?? recortar(t.pasaje, 600), modo: guardada?.modo ?? modoDeAncla(ancla, ctx.docs.get(t.documento)?.tipo),
          ...(t.tipo === 'fragmento' && t.objetivo ? { fragmento: t.objetivo } : {}), ...(t.tipo === 'unidad' && t.objetivo ? { unidad: t.objetivo } : {}),
          ...(t.tipo === 'figura' && t.objetivo ? { figura: t.objetivo } : {}),
        };
        const u = t.tipo === 'unidad' && t.objetivo ? unidades.get(t.objetivo) : undefined;
        const p = apuntar(ctx, e, { capa: 'memoria', herramienta: 'recordar', ...(u ? { ambito: u } : {}), nota: `Tarjeta${t.estado === 'cambiada' ? ' (el pasaje cambió desde entonces)' : ''} del cuaderno «${c}»${texto(contenido.frase) ? `: ${recortar(texto(contenido.frase), 200)}` : ''}` });
        nuevas.push(p.id);
        lineas.push(lineaPrueba(ctx, p, 400));
      }
    } catch { /* sin cuadernos o sin índice */ }
    if (!lineas.length) return { texto: 'No hay nada en la memoria sobre esto.', resumen: 'memoria vacía', pruebas: [] };
    return { texto: lineas.join('\n\n'), resumen: `${lineas.length} recuerdos${nuevas.length ? `, ${nuevas.length} pruebas verificadas` : ''}`, pruebas: nuevas };
  },
};

const anotar: Herramienta = {
  declaracion: {
    nombre: 'anotar',
    descripcion: 'Apunta en el cuaderno de la investigación un hallazgo, una hipótesis o algo pendiente, con las pruebas [P#] que lo sostienen. Lo apuntado guía la redacción y queda en la memoria.',
    parametros: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['hallazgo', 'hipotesis', 'pendiente'] },
        texto: { type: 'string' },
        pruebas: { type: 'array', items: { type: 'string' } },
      },
      required: ['tipo', 'texto'],
    },
  },
  async ejecutar(args, ctx) {
    const t = texto(args.texto);
    if (!t) return fallo('Falta «texto».');
    const tipo = (['hallazgo', 'hipotesis', 'pendiente'] as const).find((x) => x === args.tipo) ?? 'hallazgo';
    const pruebas = Array.isArray(args.pruebas) ? (args.pruebas as unknown[]).map((x) => String(x).replace(/[[\]\s]/g, '').toUpperCase()).filter((x) => ctx.pruebas.obtener(x)) : [];
    ctx.notas.push({ tipo, texto: t, pruebas });
    return { texto: `Anotado (${tipo}).`, resumen: `${tipo}: ${recortar(t, 120)}`, pruebas: [] };
  },
};

export const HERRAMIENTAS_MEMORIA: Herramienta[] = [recordar, anotar];

// ---------------------------------------------------------------------------
// Guardar la investigación
// ---------------------------------------------------------------------------

export interface Investigacion {
  id: string;
  pregunta: string;
  plan: PlanInvestigacion | null;
  markdown: string;
  evidencias: EvidenciaInvestigacion[];
  frases: FraseVerificada[];
  notas: Nota[];
  confianza: 'alta' | 'media' | 'baja';
  modelo: string;
  ms: number;
}

/**
 * Deja la investigación en un cuaderno (nuevo o uno que se continúa): una tarjeta
 * por prueba citada, una nota por hallazgo o hipótesis, y la respuesta como síntesis.
 * Devuelve el id del cuaderno. Una tarjeta que ya no se puede resolver se salta.
 */
export async function guardarEnCuaderno(sql: PuertosFunciones['sql'], inv: Investigacion, cuaderno: string | undefined, usuario: { id: string; pro?: boolean }): Promise<string> {
  const pf: PuertosFunciones = { sql, usuario };
  const id = cuaderno ?? (await crearCuaderno(sql, {
    titulo: `Investigación: ${recortar(inv.pregunta, 240)}`,
    cuerpo: [
      `**Pregunta.** ${inv.pregunta}`,
      inv.plan ? `**Enfoque.** ${inv.plan.enfoque}` : '',
      inv.plan?.subpreguntas.length ? `**Subpreguntas.**\n${inv.plan.subpreguntas.map((s) => `- ${s.pregunta}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n'),
  })).id;
  const tarjetaDe = new Map<string, string>();
  for (const e of inv.evidencias) {
    const frase = inv.frases.find((f) => f.evidencias.includes(e.id));
    const contenido = { evidencia: e, investigacion: inv.id, ...(frase ? { frase: frase.frase, verificacion: frase.veredicto } : {}) };
    const a = e.ancla;
    const nueva = e.fragmento ? { tipo: 'fragmento' as const, objetivo: e.fragmento }
      : e.unidad ? { tipo: 'unidad' as const, objetivo: e.unidad }
        : e.figura ? { tipo: 'figura' as const, objetivo: e.figura }
          : a.tipo === 'tiempo' ? { tipo: 'tramo' as const, documento: e.documento, t0: a.t0, t1: Math.max(a.t0, e.anclaFin?.tipo === 'tiempo' ? e.anclaFin.t1 : a.t1) }
            : null;
    try {
      const t = nueva ? await crearTarjeta(pf, id, { ...nueva, documento: e.documento, contenido }) : await crearTarjeta(pf, id, { tipo: 'nota', contenido: { ...contenido, texto: `${e.citaCorta}: ${e.cita ?? ''}` } });
      tarjetaDe.set(e.id, t.id);
    } catch { /* lo citado ya no existe: no hay tarjeta que verificar */ }
  }
  for (const n of inv.notas) {
    await crearTarjeta(pf, id, { tipo: 'nota', contenido: { texto: n.texto, clase: n.tipo, pruebas: n.pruebas, investigacion: inv.id } }).catch(() => undefined);
  }
  // La síntesis cita las tarjetas por su número entre las citables del cuaderno.
  const citables = (await listarTarjetas(sql, id)).filter((t) => t.cita && !t.huerfana).map((t) => t.id);
  const numero = new Map([...tarjetaDe].map(([e, t]) => [e, citables.indexOf(t) + 1]));
  const cuerpo = inv.markdown
    .replace(/\n+## Pruebas[\s\S]*$/, '')
    .replace(/\[(E\d+)\]/g, (m, e: string) => { const n = numero.get(e); return n && n > 0 ? `[${n}]` : ''; });
  await guardarSintesis(sql, id, { peticion: inv.pregunta, cuerpo, confianza: inv.confianza, modelo: inv.modelo, ms: inv.ms });
  return id;
}

/** La pregunta en el historial (si la grabación está encendida). */
export async function guardarEnHistorial(sql: PuertosFunciones['sql'], inv: Investigacion, extra: { filtros?: Filtros; pro?: boolean; error?: string; eventos?: Array<{ ms: number; etapa?: string; datos: unknown }> }): Promise<string | undefined> {
  try {
    const id = await registrarBusqueda(sql, {
      tipo: 'investigacion', consulta: inv.pregunta, intencion: 'investigacion', ...(extra.filtros ? { filtros: extra.filtros } : {}), pro: !!extra.pro,
      estado: extra.error ? 'error' : 'ok', mensajeError: extra.error ?? null, nResultados: inv.evidencias.length,
      respuesta: inv.markdown.slice(0, 60_000) || null, confianza: inv.confianza, principales: [], ms: inv.ms,
      ...(extra.eventos ? { eventos: extra.eventos } : {}),
    });
    return id ?? undefined;
  } catch {
    return undefined;
  }
}
