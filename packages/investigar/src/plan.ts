/**
 * Antes de buscar: el catálogo de las obras que pueden intervenir (con lo que se
 * sabe de cada una: medio, lengua, extensión, comprensión disponible, entidades y
 * relaciones) y el plan (qué obras, qué pruebas, qué subpreguntas, qué lenguas).
 */
import type { PlanInvestigacion } from '@scholaris/contrato';
import { leerRelaciones } from '@scholaris/spdf';
import { tiempoACadena } from '@scholaris/nucleo';
import { entidadesDocumento } from '@scholaris/funciones';
import { recortar, rotuloDocumento, fichaDe, type ContextoHerramientas } from './contexto.js';
import { nombreIdioma } from './sintesis.js';

async function quieto<T>(f: () => Promise<T>, defecto: T): Promise<T> {
  try { return await f(); } catch { return defecto; }
}

/** Las obras candidatas: las del ámbito o, en toda la biblioteca, las que salen al buscar la pregunta y sus relacionadas. */
export async function candidatas(ctx: ContextoHerramientas, pregunta: string, maximo = 12): Promise<string[]> {
  if (ctx.ambito) return [...ctx.ambito].filter((d) => ctx.docs.has(d)).slice(0, maximo);
  if (ctx.docs.size <= maximo) return [...ctx.docs.keys()];
  const puntos = new Map<string, number>();
  const sumar = (id: string, p: number) => puntos.set(id, (puntos.get(id) ?? 0) + p);
  for (const d of await quieto(() => ctx.p.buscador.buscarDocumentos(pregunta, { limite: 6 }), [])) sumar(d.documento.id, 3 * d.puntuacion + 1);
  const r = await quieto(() => ctx.p.buscador.buscar(pregunta, { limite: 24, reordenar: false }), null);
  r?.resultados.forEach((x, i) => sumar(x.documento.id, 1 / (i + 2)));
  const base = [...puntos.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, maximo);
  for (const id of [...base]) {
    for (const rel of await quieto(() => leerRelaciones(ctx.p.sql, id), [])) {
      const otro = rel.origen === id ? rel.destino : rel.origen;
      if (!base.includes(otro) && ctx.docs.has(otro)) base.push(otro);
    }
  }
  return base.slice(0, maximo);
}

/** El catálogo en texto, para el plan y para el agente. */
export async function catalogo(ctx: ContextoHerramientas, ids: string[]): Promise<string> {
  const sql = ctx.p.sql;
  const lineas: string[] = [];
  for (const id of ids) {
    const d = ctx.docs.get(id);
    if (!d) continue;
    const [info] = await quieto(() => sql.ejecutar<{ unidades: number; duracion: number | null }>('SELECT unidades, duracion FROM documentos WHERE id = ?', id), []);
    const [c] = await quieto(() => sql.ejecutar<{ s: number; f: number; a: number }>(
      'SELECT (SELECT COUNT(*) FROM segmentos WHERE documento = ?) AS s, (SELECT COUNT(*) FROM fichas WHERE documento = ?) AS f, (SELECT COUNT(*) FROM apariciones WHERE documento = ?) AS a', id, id, id), []);
    const ents = await quieto(() => entidadesDocumento(sql, id, 12), null);
    const rels = await quieto(() => leerRelaciones(sql, id), []);
    const m = d.metadatos;
    const extension = d.tipo === 'video' || d.tipo === 'audio' ? `${info?.duracion ? tiempoACadena(info.duracion) : '¿?'} (${info?.unidades ?? '?'} tramos de transcripción)` : `${info?.unidades ?? '?'} páginas o unidades`;
    const comp = c && (c.s || c.f) ? `comprensión: ${c.s} segmentos, ${c.f} fichas, ${c.a} apariciones` : 'sin capa de comprensión todavía (solo texto, transcripción y fotogramas descritos)';
    lineas.push([
      `- ${rotuloDocumento(ctx, id)}: ${d.tipo}${m.tipoCSL ? ` (${m.tipoCSL})` : ''}${m.idioma ? `, en ${nombreIdioma(m.idioma)}` : ''}, ${extension}; ${comp}.`,
      m.editorial ? `  ${m.editorial}${m.lugar ? `, ${m.lugar}` : ''}.` : '',
      m.resumen ? `  Resumen: ${recortar(m.resumen, 300)}` : '',
      ents?.entidades.length ? `  Entidades: ${ents.entidades.map((e) => e.nombre).join(', ')}.` : '',
      rels.length ? `  Relaciones: ${rels.map((r) => `${r.tipo} ${fichaDe(ctx, r.origen === id ? r.destino : r.origen)?.titulo ?? (r.origen === id ? r.destino : r.origen)}`).join('; ')}.` : '',
    ].filter(Boolean).join('\n'));
  }
  return lineas.join('\n');
}

const ESQUEMA_PLAN = {
  type: 'object',
  properties: {
    enfoque: { type: 'string', description: 'Una o dos frases: cómo se va a responder.' },
    documentos: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, papel: { type: 'string', description: 'Qué aporta a la pregunta.' } }, required: ['id', 'papel'] } },
    subpreguntas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pregunta: { type: 'string' },
          pruebas: { type: 'array', items: { type: 'string', enum: ['literal', 'visual', 'sonora', 'estructural', 'comparativa'] } },
          documentos: { type: 'array', items: { type: 'string' } },
        },
        required: ['pregunta', 'pruebas'],
      },
    },
    idiomas: { type: 'array', items: { type: 'string' }, description: 'Lenguas (códigos) en que hay que buscar.' },
    idiomaRespuesta: { type: 'string', description: 'Código de la lengua de la pregunta.' },
  },
  required: ['enfoque', 'documentos', 'subpreguntas', 'idiomas', 'idiomaRespuesta'],
};

const SISTEMA_PLAN = `Planificas una investigación sobre la biblioteca de un usuario antes de buscar. Lees la pregunta y el catálogo de obras candidatas y decides:
- qué obras intervienen (por su id) y qué papel tiene cada una;
- en qué subpreguntas se descompone la pregunta (de dos a seis, concretas, en el orden en que conviene investigarlas);
- qué clase de prueba necesita cada una: literal (lo que dice el texto o el diálogo), visual (lo que se ve: planos, encuadre, gestos, objetos), sonora (música, silencio, voces), estructural (dónde está en la obra, cómo se ordena) o comparativa (lo que cambia entre dos obras);
- en qué lenguas hay que buscar y en cuál se responde (la de la pregunta).
No respondas a la pregunta. Escribe en español.`;

export async function planificar(ctx: ContextoHerramientas, pregunta: string, catalogoTexto: string, memoria: string, idioma: string): Promise<PlanInvestigacion> {
  const r = await ctx.p.modelos.agente.turno({
    sistema: SISTEMA_PLAN,
    mensajes: [{ rol: 'usuario', partes: [{ tipo: 'texto', texto: `PREGUNTA: ${pregunta}\n\nOBRAS CANDIDATAS:\n${catalogoTexto || '(ninguna)'}${memoria ? `\n\nLO QUE YA HAY EN LA MEMORIA:\n${recortar(memoria, 3000)}` : ''}` }] }],
    esquema: ESQUEMA_PLAN, pensamiento: 'bajo', temperatura: 0.3, maxTokens: 4000, ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  ctx.cuentas.apuntar(r.uso);
  const j = (r.json ?? {}) as Partial<{ enfoque: string; documentos: Array<{ id: string; papel: string }>; subpreguntas: Array<{ pregunta: string; pruebas: string[]; documentos?: string[] }>; idiomas: string[]; idiomaRespuesta: string }>;
  const valido = (id: string) => ctx.docs.has(id) && (!ctx.ambito || ctx.ambito.has(id));
  const PRUEBAS = ['literal', 'visual', 'sonora', 'estructural', 'comparativa'] as const;
  return {
    enfoque: String(j.enfoque ?? '').trim() || 'Reunir pruebas en las obras que intervienen y responder parte por parte.',
    documentos: (j.documentos ?? []).filter((d) => valido(String(d.id))).map((d) => ({ id: d.id, titulo: ctx.docs.get(d.id)!.metadatos.titulo, papel: String(d.papel ?? '') })),
    subpreguntas: (j.subpreguntas ?? []).slice(0, 8).map((s) => ({
      pregunta: String(s.pregunta ?? ''),
      pruebas: (s.pruebas ?? []).filter((x): x is (typeof PRUEBAS)[number] => (PRUEBAS as readonly string[]).includes(x)),
      ...(s.documentos?.filter(valido).length ? { documentos: s.documentos.filter(valido) } : {}),
    })).filter((s) => s.pregunta),
    idiomas: (j.idiomas ?? []).map(String).filter(Boolean).slice(0, 6),
    idiomaRespuesta: String(j.idiomaRespuesta || idioma).slice(0, 5),
  };
}
