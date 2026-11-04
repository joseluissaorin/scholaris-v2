/**
 * Las herramientas de lectura del agente: buscar, leer, mapa, entidad, citas,
 * relaciones y alinear. Cada una devuelve texto para el modelo con las pruebas
 * marcadas («[P7]») y apunta esas pruebas en el cuaderno de la investigación.
 * Ver y escuchar están en vision.ts; recordar y anotar, en memoria.ts.
 */
import { buscarEnCapas, evidenciaDeResultado, modoDeAncla, type FiltrosCapas } from '@scholaris/busqueda';
import type { Ancla, AnclaMaterial, Evidencia, TipoSegmento } from '@scholaris/nucleo';
import { anclaACita, enLista, tiempoACadena } from '@scholaris/nucleo';
import { leerAlineaciones, leerApariciones, leerFichas, leerRelaciones, leerSegmento, leerSegmentos } from '@scholaris/spdf';
import { buscarEntidades, caminoEntidades, detalleNodo, entidadesDocumento, fichaEntidad, lineaTemporalEntidad, vecinosEntidad } from '@scholaris/funciones';
import {
  apuntar, documentosDisponibles, fallo, fichaDe, lineaPrueba, recortar, resolverDocumento, rotuloDocumento, segundosDe, texto, tramoDe,
  type ContextoHerramientas, type Herramienta, type ResultadoHerramienta,
} from './contexto.js';
import { leerUnidades, unidadesDeTramo, type Ambito } from './pruebas.js';

const TIPOS_SEGMENTO: TipoSegmento[] = ['obra', 'parte', 'capitulo', 'apartado', 'secuencia', 'escena', 'plano', 'acto', 'cuadro', 'poema', 'estrofa', 'tema', 'bloque', 'intervencion', 'diapositiva', 'tabla', 'folio', 'articulo', 'otro'];

const TRAMO_PAGINAS = { type: 'object', description: 'Páginas físicas (la «pág. física» de las pruebas), ambas incluidas.', properties: { desde: { type: 'integer' }, hasta: { type: 'integer' } }, required: ['desde', 'hasta'] };
const TRAMO_TIEMPO = { type: 'object', description: 'Tramo en segundos desde el inicio (o «H:MM:SS»).', properties: { desde: { type: 'string' }, hasta: { type: 'string' } }, required: ['desde', 'hasta'] };

/** Sin errores de tablas que no existen: una capa vacía no es un fallo. */
async function quieto<T>(f: () => Promise<T>, defecto: T): Promise<T> {
  try { return await f(); } catch { return defecto; }
}

/**
 * Tramos de un audio o un vídeo sin transcripción (de al menos `minimo` segundos), dentro
 * de `tramo` si se da: el principio, el final y los huecos entre unidades. Allí puede
 * haber diálogo que la ingesta no recogió (o solo música): nada se da por ausente sin mirarlo.
 */
export async function huecosTranscripcion(sql: ContextoHerramientas['p']['sql'], documento: string, tramo?: [number, number], minimo = 60): Promise<Array<[number, number]>> {
  const [d] = await sql.ejecutar<{ tipo: string; duracion: number | null }>('SELECT tipo, duracion FROM documentos WHERE id = ?', documento);
  if (!d || (d.tipo !== 'video' && d.tipo !== 'audio')) return [];
  const us = await sql.ejecutar<{ t0: number; t1: number }>('SELECT t0, t1 FROM unidades WHERE documento = ? AND t0 IS NOT NULL ORDER BY t0', documento);
  const fin = d.duracion ?? us.at(-1)?.t1 ?? 0;
  const huecos: Array<[number, number]> = [];
  let cursor = 0;
  for (const u of us) {
    if (u.t0 - cursor >= minimo) huecos.push([cursor, u.t0]);
    cursor = Math.max(cursor, u.t1);
  }
  if (fin - cursor >= minimo) huecos.push([cursor, fin]);
  if (!tramo) return huecos;
  return huecos.filter(([a, b]) => a < tramo[1] && b > tramo[0]).map(([a, b]) => [Math.max(a, tramo[0]), Math.min(b, tramo[1])] as [number, number]).filter(([a, b]) => b - a >= Math.min(minimo, 20));
}

/** El ámbito (la unidad) de las pruebas que salen de fragmentos o unidades. */
async function ambitos(ctx: ContextoHerramientas, unidades: string[]): Promise<Map<string, Ambito & { imagen: string | null }>> {
  return quieto(() => leerUnidades(ctx.p.sql, unidades), new Map());
}

async function apuntarEvidencias(ctx: ContextoHerramientas, evidencias: Evidencia[], meta: { capa: 'literal' | 'comprension' | 'percepcion' | 'memoria'; herramienta: string; nota?: string }): Promise<string[]> {
  const us = await ambitos(ctx, evidencias.map((e) => e.unidad ?? '').filter(Boolean));
  const ids: string[] = [];
  for (const e of evidencias) {
    if (ctx.ambito && !ctx.ambito.has(e.documento)) continue;
    const u = e.unidad ? us.get(e.unidad) : undefined;
    const p = apuntar(ctx, e, { ...meta, ...(u ? { ambito: u } : {}), ...(u?.imagen ? { imagen: u.imagen } : {}) });
    ids.push(p.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// buscar
// ---------------------------------------------------------------------------

const buscar: Herramienta = {
  declaracion: {
    nombre: 'buscar',
    descripcion: 'Busca en la biblioteca, en la capa literal (pasajes del texto, la transcripción y los fotogramas descritos) y en la de comprensión (fichas de análisis de escenas, capítulos, personajes y obras, con sus pruebas). Busca por sentido en cualquier lengua; entre comillas, la frase exacta. Devuelve pruebas marcadas [P#].',
    parametros: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Qué buscar: una idea, una frase o un nombre. Mejor concreto («Diego ofrece helado de fresa a David en Coppelia») que vago.' },
        documentos: { type: 'array', items: { type: 'string' }, description: 'Ids de documento (o títulos) donde buscar.' },
        capa: { type: 'string', enum: ['literal', 'comprension', 'ambas'], description: 'Por defecto, ambas.' },
        idioma: { type: 'string', description: 'Solo documentos en esta lengua (es, en, fr…).' },
        paginas: TRAMO_PAGINAS,
        tiempo: TRAMO_TIEMPO,
        entidad: { type: 'string', description: 'Solo donde aparece esta entidad (nombre o id del grafo).' },
        tipo_segmento: { type: 'string', enum: TIPOS_SEGMENTO, description: 'Solo fichas de segmentos de este tipo.' },
        k: { type: 'integer', minimum: 1, maximum: 12, description: 'Resultados (6).' },
      },
      required: ['consulta'],
    },
  },
  async ejecutar(args, ctx) {
    const consulta = texto(args.consulta);
    if (!consulta) return fallo('Falta «consulta».');
    let documentos: string[] | undefined;
    if (Array.isArray(args.documentos) && args.documentos.length) {
      documentos = [...new Set(args.documentos.map((d) => resolverDocumento(ctx, d)).filter((d): d is string => !!d))];
      if (!documentos.length) return fallo(`No conozco esos documentos. Disponibles: ${documentosDisponibles(ctx)}`);
    } else if (ctx.filtros.documentos?.length) documentos = ctx.filtros.documentos;
    else if (ctx.documentosPlan?.length) documentos = ctx.documentosPlan;
    const enPlan = !Array.isArray(args.documentos) && !ctx.filtros.documentos?.length && !!ctx.documentosPlan?.length;
    const filtros: FiltrosCapas = { ...ctx.filtros, ...(documentos ? { documentos } : {}) };
    if (texto(args.idioma)) filtros.idiomas = [texto(args.idioma)];
    const paginas = tramoDe(args.paginas);
    if (paginas) filtros.paginas = paginas;
    const tiempo = tramoDe(args.tiempo, segundosDe);
    if (tiempo) filtros.tiempo = tiempo;
    if (texto(args.entidad)) {
      const e = await quieto(() => buscarEntidades(ctx.p.sql, { q: texto(args.entidad), limite: 1 }), null);
      const id = e?.elementos[0]?.id ?? texto(args.entidad);
      filtros.entidad = id;
    }
    if (TIPOS_SEGMENTO.includes(texto(args.tipo_segmento) as TipoSegmento)) filtros.tipoSegmento = texto(args.tipo_segmento) as TipoSegmento;
    const capa = texto(args.capa);
    const capas = capa === 'literal' ? ['literal' as const] : capa === 'comprension' ? ['comprension' as const] : ['literal' as const, 'comprension' as const];
    const k = Math.min(12, Math.max(1, Math.round(Number(args.k) || ctx.resultadosPorBusqueda)));
    const r = await buscarEnCapas(ctx.p.buscador, consulta, { capas, filtros, limite: k });
    // Una búsqueda vacía no prueba que algo no esté: la transcripción puede tener huecos.
    const medios = (documentos ?? [...ctx.docs.keys()]).filter((d) => ['video', 'audio'].includes(ctx.docs.get(d)?.tipo ?? ''));
    const huecos: string[] = [];
    for (const d of medios.slice(0, 4)) {
      const hs = await quieto(() => huecosTranscripcion(ctx.p.sql, d, filtros.tiempo), []);
      if (hs.length) huecos.push(`${fichaDe(ctx, d)?.titulo ?? d}: ${hs.slice(0, 8).map(([a, b]) => `${tiempoACadena(a)}-${tiempoACadena(b)}`).join(', ')}`);
    }
    const avisoHuecos = huecos.length ? `\nOjo: la transcripción no cubre estos tramos (puede faltar diálogo): ${huecos.join('; ')}. Lo que no sale aquí puede estar ahí: míralo o escúchalo antes de dar nada por ausente.` : '';
    const nota = enPlan ? `(Buscado en las obras del plan; pasa «documentos» para buscar en otras.)\n` : '';
    if (!r.resultados.length) {
      return { texto: `${nota}Sin resultados para «${consulta}»${filtros.paginas || filtros.tiempo ? ' en ese tramo' : ''}. Prueba otras palabras, otra lengua o lee el tramo con «leer». No concluyas que no está.${avisoHuecos}`, resumen: 'sin resultados', pruebas: [] };
    }
    const lineas: string[] = [];
    const nuevas: string[] = [];
    const us = await ambitos(ctx, r.resultados.flatMap((x) => (x.capa === 'literal' ? [x.resultado.fragmento.unidad] : [])));
    let literales = 0, fichas = 0;
    for (const x of r.resultados) {
      if (x.capa === 'literal') {
        literales++;
        const e = evidenciaDeResultado(x.resultado);
        const u = us.get(x.resultado.fragmento.unidad);
        const p = apuntar(ctx, e, { capa: 'literal', herramienta: 'buscar', ...(u ? { ambito: u } : {}), ...(u?.imagen ? { imagen: u.imagen } : {}) });
        nuevas.push(p.id);
        const contexto = x.resultado.pasaje?.texto && x.resultado.fragmento.texto.length > x.resultado.pasaje.texto.length + 40
          ? `\n  contexto: ${recortar(x.resultado.fragmento.texto, 700)}` : '';
        lineas.push(`${lineaPrueba(ctx, p, 500)}${contexto}`);
      } else {
        fichas++;
        const f = x.ficha;
        const donde = x.segmento ? ` · ${x.segmento.tipo} «${x.segmento.titulo}», ${anclaACita(x.segmento.ancla, x.segmento.anclaFin)}` : '';
        const ids = await apuntarEvidencias(ctx, x.evidencias.slice(0, 6), { capa: 'comprension', herramienta: 'buscar', nota: `Prueba de la ficha «${f.clase}»${x.segmento ? ` de «${x.segmento.titulo}»` : ''}` });
        nuevas.push(...ids);
        lineas.push(`[ficha ${f.clase}, lente ${f.lente}] ${f.documento ? rotuloDocumento(ctx, f.documento) : 'biblioteca'}${donde}\n${recortar(f.texto, 900)}\n  pruebas de la ficha: ${ids.length ? ids.join(', ') : 'ninguna'} (la ficha es análisis: cita sus pruebas, no la ficha)`);
      }
    }
    return { texto: `${nota}${lineas.join('\n\n')}${filtros.tiempo ? avisoHuecos : ''}`, resumen: `${literales} pasajes${fichas ? ` y ${fichas} fichas` : ''}`, pruebas: nuevas };
  },
};

// ---------------------------------------------------------------------------
// leer
// ---------------------------------------------------------------------------

const MAX_LEER = 14_000;

const leer: Herramienta = {
  declaracion: {
    nombre: 'leer',
    descripcion: 'Lee entero un tramo de un documento: páginas (físicas), un tramo de tiempo de un audio o un vídeo (la transcripción con sus hablantes), un segmento de su estructura o la unidad de un fragmento. Cada página o tramo es una prueba [P#]; al redactar, cita las palabras exactas entre comillas delante de la marca para anclar justo esas palabras.',
    parametros: {
      type: 'object',
      properties: {
        documento: { type: 'string', description: 'Id (o título) del documento.' },
        paginas: TRAMO_PAGINAS,
        tiempo: TRAMO_TIEMPO,
        segmento: { type: 'string', description: 'Id de un segmento (de «mapa»).' },
        fragmento: { type: 'string', description: 'Id de un fragmento.' },
        fotogramas: { type: 'boolean', description: 'En vídeo, incluir los fotogramas descritos del tramo.' },
      },
      required: ['documento'],
    },
  },
  async ejecutar(args, ctx) {
    const doc = resolverDocumento(ctx, args.documento);
    if (!doc) return fallo(`No conozco ese documento. Disponibles: ${documentosDisponibles(ctx)}`);
    const sql = ctx.p.sql;
    let tramo: { orden?: [number, number]; paginas?: [number, number]; tiempo?: [number, number] } | null = null;
    const seg = texto(args.segmento) ? await quieto(() => leerSegmento(sql, texto(args.segmento)), null) : null;
    if (seg) {
      const us = await leerUnidades(sql, [seg.unidadDesde, seg.unidadHasta]);
      const a = us.get(seg.unidadDesde)?.orden, b = us.get(seg.unidadHasta)?.orden;
      if (seg.ancla.tipo === 'tiempo') tramo = { tiempo: [seg.ancla.t0, seg.anclaFin?.tipo === 'tiempo' ? seg.anclaFin.t1 : seg.ancla.t1] };
      else if (a !== undefined) tramo = { orden: [a, b ?? a] };
    } else if (texto(args.fragmento)) {
      const [f] = await sql.ejecutar<{ unidad: string }>('SELECT unidad FROM fragmentos WHERE id = ? AND documento = ?', texto(args.fragmento), doc);
      if (f) { const u = (await leerUnidades(sql, [f.unidad])).get(f.unidad); if (u) tramo = { orden: [u.orden, u.orden] }; }
    }
    const paginas = tramoDe(args.paginas);
    const tiempo = tramoDe(args.tiempo, segundosDe);
    if (!tramo && tiempo) tramo = { tiempo: [tiempo[0], Math.min(tiempo[1], tiempo[0] + 900)] };
    if (!tramo && paginas) tramo = { paginas: [paginas[0], Math.min(paginas[1], paginas[0] + 9)] };
    if (!tramo) return fallo('Indica «paginas», «tiempo», «segmento» o «fragmento».');
    const unidades = await unidadesDeTramo(sql, doc, tramo, 40);
    if (!unidades.length) return { texto: 'Ese tramo no existe o está vacío.', resumen: 'tramo vacío', pruebas: [] };
    const lineas: string[] = [];
    const nuevas: string[] = [];
    let usados = 0;
    const tipoDoc = ctx.docs.get(doc)?.tipo;
    for (const u of unidades) {
      if (usados > MAX_LEER) { lineas.push(`(Se corta aquí: quedan ${unidades.length - lineas.length} unidades; pide un tramo más corto.)`); break; }
      const cuerpo = u.texto.length > 5000 ? `${u.texto.slice(0, 5000)}…` : u.texto;
      usados += cuerpo.length;
      const e: Evidencia = { documento: doc, ancla: u.ancla as AnclaMaterial, cita: u.texto.length > 600 ? `${u.texto.slice(0, 600)}…` : u.texto, modo: modoDeAncla(u.ancla, tipoDoc), unidad: u.unidad };
      const p = apuntar(ctx, e, { capa: 'literal', herramienta: 'leer', ambito: u, ...(u.imagen ? { imagen: u.imagen } : {}) });
      nuevas.push(p.id);
      const a = u.ancla;
      const donde = a.tipo === 'pagina' ? `${anclaACita(a)} (pág. física ${a.fisica})` : anclaACita(a);
      lineas.push(`[${p.id}] ${donde}\n${cuerpo || '(sin texto)'}`);
    }
    if (args.fotogramas === true && tramo.tiempo) {
      const figs = await quieto(() => sql.ejecutar<{ id: string; unidad: string; imagen: string; descripcion: string | null; pie: string | null; ancla: string }>(
        `SELECT id, unidad, imagen, descripcion, pie, ancla FROM figuras WHERE documento = ? AND json_extract(ancla, '$.t0') BETWEEN ? AND ? ORDER BY json_extract(ancla, '$.t0') LIMIT 30`,
        doc, tramo.tiempo![0], tramo.tiempo![1]), []);
      for (const g of figs) {
        const a = JSON.parse(g.ancla) as Ancla;
        const desc = [g.pie, g.descripcion].filter(Boolean).join('. ');
        if (!desc || a.tipo !== 'tiempo') continue;
        const p = apuntar(ctx, { documento: doc, ancla: { tipo: 'tiempo', t0: a.t0, t1: a.t1, instante: a.t0 }, cita: desc, modo: 'imagen', unidad: g.unidad, figura: g.id }, { capa: 'literal', herramienta: 'leer', imagen: g.imagen, nota: 'Fotograma descrito en la ingesta' });
        nuevas.push(p.id);
        lineas.push(`[${p.id}] fotograma ${tiempoACadena(a.t0)}: ${recortar(desc, 300)}`);
      }
    }
    if (tramo.tiempo) {
      const hs = await quieto(() => huecosTranscripcion(sql, doc, tramo!.tiempo, 30), []);
      if (hs.length) lineas.push(`(Sin transcripción en ${hs.map(([a, b]) => `${tiempoACadena(a)}-${tiempoACadena(b)}`).join(', ')}: puede faltar diálogo; míralo o escúchalo.)`);
    }
    return { texto: `${rotuloDocumento(ctx, doc)}\n\n${lineas.join('\n\n')}`, resumen: `${unidades.length} unidades de ${fichaDe(ctx, doc)?.titulo ?? doc}`, pruebas: nuevas };
  },
};

// ---------------------------------------------------------------------------
// mapa
// ---------------------------------------------------------------------------

const mapa: Herramienta = {
  declaracion: {
    nombre: 'mapa',
    descripcion: 'El mapa de un documento: ficha bibliográfica, estructura (partes, capítulos, escenas con sus páginas o minutos), la ficha global de comprensión si la hay, sus entidades principales y, en vídeo, la línea de tiempo de la transcripción y de los fotogramas descritos. Úsalo para orientarte antes de leer.',
    parametros: { type: 'object', properties: { documento: { type: 'string', description: 'Id (o título) del documento.' } }, required: ['documento'] },
  },
  async ejecutar(args, ctx) {
    const doc = resolverDocumento(ctx, args.documento);
    if (!doc) return fallo(`No conozco ese documento. Disponibles: ${documentosDisponibles(ctx)}`);
    const sql = ctx.p.sql;
    const d = ctx.docs.get(doc)!;
    const m = d.metadatos;
    const [info] = await sql.ejecutar<{ unidades: number; duracion: number | null }>('SELECT unidades, duracion FROM documentos WHERE id = ?', doc);
    const partes: string[] = [];
    partes.push(`${rotuloDocumento(ctx, doc)}: ${d.tipo}${m.idioma ? `, en ${m.idioma}` : ''}${info?.duracion ? `, ${tiempoACadena(info.duracion)}` : ''}, ${info?.unidades ?? '?'} unidades.${m.editorial ? ` ${m.editorial}${m.lugar ? `, ${m.lugar}` : ''}.` : ''}${m.resumen ? `\nResumen: ${recortar(m.resumen, 500)}` : ''}`);
    const globales = await quieto(() => leerFichas(sql, { documento: doc, objetivo: 'documento' }), []);
    for (const g of globales.slice(0, 2)) partes.push(`Ficha ${g.clase} (lente ${g.lente}):\n${recortar(g.texto, 2500)}`);
    const segmentos = await quieto(() => leerSegmentos(sql, doc, { nivelMaximo: 3 }), []);
    if (segmentos.length) {
      partes.push(`Estructura (${segmentos.length} segmentos):\n${segmentos.slice(0, 80).map((s) => `${'  '.repeat(Math.max(0, s.nivel - 1))}- ${s.tipo} «${s.titulo}» [${s.id}] ${anclaACita(s.ancla, s.anclaFin)}${s.resumen ? `: ${recortar(s.resumen, 140)}` : ''}`).join('\n')}`);
    } else {
      const secciones = await quieto(() => sql.ejecutar<{ titulo: string; nivel: number; unidad_desde: string }>('SELECT titulo, nivel, unidad_desde FROM secciones WHERE documento = ? ORDER BY rowid LIMIT 80', doc), []);
      if (secciones.length) partes.push(`Índice:\n${secciones.map((s) => `${'  '.repeat(Math.max(0, s.nivel - 1))}- ${s.titulo}`).join('\n')}`);
      // Sin estructura: la línea de lectura (primeras palabras de cada página o tramo).
      const unidades = await unidadesDeTramo(sql, doc, { orden: [0, 400] }, 400);
      const paso = Math.max(1, Math.ceil(unidades.length / 60));
      const linea = unidades.filter((_, i) => i % paso === 0).map((u) => {
        const a = u.ancla;
        const donde = a.tipo === 'pagina' ? `pág. física ${a.fisica} (${anclaACita(a)})` : anclaACita(a);
        return `- ${donde}: ${recortar(u.texto.replace(/\*\*([^*]+):\*\*/g, '$1:').replace(/\s+/g, ' '), 110)}`;
      });
      if (linea.length) partes.push(`Recorrido (${unidades.length} unidades${paso > 1 ? `, una de cada ${paso}` : ''}):\n${linea.join('\n')}`);
    }
    if (d.tipo === 'video' || d.tipo === 'audio') {
      const hs = await quieto(() => huecosTranscripcion(sql, doc), []);
      if (hs.length) partes.push(`Tramos sin transcripción (de un minuto o más; puede faltar diálogo o ser solo música, compruébalo con «ver» o «escuchar»): ${hs.map(([a, b]) => `${tiempoACadena(a)}-${tiempoACadena(b)}`).join(', ')}.`);
    }
    if (d.tipo === 'video') {
      const figs = await quieto(() => sql.ejecutar<{ descripcion: string | null; ancla: string }>(`SELECT descripcion, ancla FROM figuras WHERE documento = ? ORDER BY json_extract(ancla, '$.t0')`, doc), []);
      if (figs.length) {
        const paso = Math.max(1, Math.ceil(figs.length / 50));
        partes.push(`Fotogramas descritos (${figs.length}${paso > 1 ? `, uno de cada ${paso}` : ''}; para citarlos, «leer» con fotogramas o «ver»):\n${figs.filter((_, i) => i % paso === 0).map((g) => {
          const a = JSON.parse(g.ancla) as Ancla;
          return `- ${a.tipo === 'tiempo' ? tiempoACadena(a.t0) : ''}: ${recortar(g.descripcion ?? '', 120)}`;
        }).join('\n')}`);
      }
    }
    const ents = await quieto(() => entidadesDocumento(sql, doc, 18), null);
    if (ents?.entidades.length) partes.push(`Entidades principales: ${ents.entidades.map((e) => `${e.nombre} (${e.tipo}, ${e.aqui})`).join('; ')}`);
    const rels = await quieto(() => leerRelaciones(sql, doc), []);
    if (rels.length) partes.push(`Relaciones con otras obras: ${rels.map((r) => `${r.tipo} ${rotuloDocumento(ctx, r.origen === doc ? r.destino : r.origen)}${r.nota ? ` (${recortar(r.nota, 120)})` : ''}`).join('; ')}`);
    return { texto: partes.join('\n\n'), resumen: `mapa de ${m.titulo}${segmentos.length ? ` (${segmentos.length} segmentos)` : ''}`, pruebas: [] };
  },
};

// ---------------------------------------------------------------------------
// entidad
// ---------------------------------------------------------------------------

const limpiarContexto = (s: string) => s.replace(/[⟦⟧]/g, '').replace(/^…|…$/g, '').trim();

const entidad: Herramienta = {
  declaracion: {
    nombre: 'entidad',
    descripcion: 'Una persona, personaje, lugar, obra, objeto o concepto del grafo de la biblioteca: sus menciones en cada documento (con su página o su minuto, como pruebas), dónde aparece en imagen o en voz, sus vecinos (con quién aparece y qué relación), su línea temporal y el camino que la une con otra entidad.',
    parametros: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre o alias («Coppelia», «Diego», «Lezama»).' },
        id: { type: 'string' },
        documento: { type: 'string', description: 'Solo sus menciones en este documento.' },
        camino_hacia: { type: 'string', description: 'Otra entidad: el camino más fuerte entre las dos.' },
        linea: { type: 'boolean', description: 'Incluir la línea temporal.' },
      },
    },
  },
  async ejecutar(args, ctx) {
    const sql = ctx.p.sql;
    let id = texto(args.id);
    if (!id) {
      const nombre = texto(args.nombre);
      if (!nombre) return fallo('Indica «nombre» o «id».');
      const r = await quieto(() => buscarEntidades(sql, { q: nombre, limite: 5 }), null);
      if (!r) return fallo('El grafo de entidades no está disponible en esta biblioteca.');
      if (!r.elementos.length) return { texto: `No hay ninguna entidad «${nombre}» en el grafo. Búscala con «buscar».`, resumen: 'no está en el grafo', pruebas: [] };
      id = r.elementos[0]!.id;
    }
    const doc = texto(args.documento) ? resolverDocumento(ctx, args.documento) : null;
    let ficha;
    try { ficha = await fichaEntidad(sql, id, { porDocumento: doc ? 10 : 5 }); } catch (e) { return fallo((e as Error).message); }
    const lineas: string[] = [`${ficha.nombre} (${ficha.tipo}${ficha.descripcion ? `, ${ficha.descripcion}` : ''}${ficha.wikidata ? `, Wikidata ${ficha.wikidata}` : ''}) [${ficha.id}]: ${ficha.menciones} menciones en ${ficha.documentos} documentos.${ficha.alias.length ? ` Alias: ${ficha.alias.join(', ')}.` : ''}`];
    const nuevas: string[] = [];
    const porDoc = ficha.porDocumento.filter((x) => (!doc || x.documento === doc) && (!ctx.ambito || ctx.ambito.has(x.documento)));
    const frags = porDoc.flatMap((x) => x.menciones.map((m) => m.fragmento));
    const unidadDe = new Map<string, string>();
    for (let i = 0; i < frags.length; i += 90) {
      const l = enLista(frags.slice(i, i + 90));
      for (const f of await sql.ejecutar<{ id: string; unidad: string }>(`SELECT id, unidad FROM fragmentos WHERE id IN ${l.sql}`, l.param)) unidadDe.set(f.id, f.unidad);
    }
    const us = await ambitos(ctx, [...unidadDe.values()]);
    for (const x of porDoc) {
      lineas.push(`\nEn ${rotuloDocumento(ctx, x.documento)}: ${x.total} menciones.`);
      for (const m of x.menciones) {
        const u = us.get(unidadDe.get(m.fragmento) ?? '');
        const cita = limpiarContexto(m.contexto);
        const p = apuntar(ctx, { documento: x.documento, ancla: m.ancla as AnclaMaterial, cita, modo: modoDeAncla(m.ancla, ctx.docs.get(x.documento)?.tipo), fragmento: m.fragmento, ...(u ? { unidad: u.unidad } : {}) },
          { capa: 'literal', herramienta: 'entidad', ...(u ? { ambito: u } : {}), ...(u?.imagen ? { imagen: u.imagen } : {}), nota: `Mención de ${ficha.nombre}` });
        nuevas.push(p.id);
        lineas.push(`[${p.id}] ${m.etiqueta}: «${recortar(cita, 300)}»`);
      }
    }
    const aps = await quieto(() => leerApariciones(sql, { entidad: ficha.id, ...(doc ? { documento: doc } : {}), limite: 14 }), []);
    if (aps.length) {
      lineas.push('\nApariciones (imagen, voz, página):');
      for (const a of aps) {
        if (ctx.ambito && !ctx.ambito.has(a.documento)) continue;
        const modo = a.ancla.region && a.ancla.tipo === 'tiempo' ? 'video' : a.ancla.region ? 'imagen' : modoDeAncla(a.ancla, ctx.docs.get(a.documento)?.tipo);
        const p = apuntar(ctx, { documento: a.documento, ancla: a.ancla, ...(a.anclaFin ? { anclaFin: a.anclaFin } : {}), cita: `${ficha.nombre} ${a.rol}: ${a.forma}`, modo }, { capa: 'comprension', herramienta: 'entidad', nota: `Aparición (${a.rol}) de ${ficha.nombre}` });
        nuevas.push(p.id);
        lineas.push(lineaPrueba(ctx, p, 200));
      }
    }
    const vecinos = ficha.vecinos.length ? ficha.vecinos : await quieto(() => vecinosEntidad(sql, ficha.id, 10), []);
    if (vecinos.length) lineas.push(`\nVecinos: ${vecinos.slice(0, 12).map((v) => `${v.entidad.nombre}${v.relacion ? ` («${v.relacion}»)` : ''}`).join('; ')}`);
    if (args.linea === true) {
      const l = await quieto(() => lineaTemporalEntidad(sql, ficha.id, 20), null);
      if (l?.elementos.length) lineas.push(`\nLínea temporal: ${l.elementos.slice(0, 15).map((x) => `${x.anio ?? 's. f.'} ${x.titulo}, ${x.etiqueta}`).join('; ')}`);
    }
    const hacia = texto(args.camino_hacia);
    if (hacia) {
      const otro = (await quieto(() => buscarEntidades(sql, { q: hacia, limite: 1 }), null))?.elementos[0];
      if (!otro) lineas.push(`\nNo encuentro «${hacia}» en el grafo.`);
      else {
        const c = await quieto(() => caminoEntidades(sql, ficha.id, otro.id), { pasos: [] });
        if (!c.pasos.length) lineas.push(`\nNo hay camino entre ${ficha.nombre} y ${otro.nombre}.`);
        else {
          lineas.push(`\nCamino hasta ${otro.nombre}: ${c.pasos.map((x) => x.entidad.nombre).join(' → ')}`);
          for (const paso of c.pasos) {
            if (!paso.via) continue;
            const p = apuntar(ctx, { documento: paso.via.documento, ancla: paso.via.ancla as AnclaMaterial, cita: limpiarContexto(paso.via.contexto), modo: 'texto', fragmento: paso.via.fragmento }, { capa: 'literal', herramienta: 'entidad', nota: `Enlace hacia ${paso.entidad.nombre}${paso.via.relacion ? `: ${paso.via.relacion}` : ''}` });
            nuevas.push(p.id);
            lineas.push(`[${p.id}] ${paso.via.etiqueta} → ${paso.entidad.nombre}${paso.via.relacion ? ` («${paso.via.relacion}»)` : ''}: «${recortar(limpiarContexto(paso.via.contexto), 240)}»`);
          }
        }
      }
    }
    return { texto: lineas.join('\n'), resumen: `${ficha.nombre}: ${ficha.menciones} menciones${aps.length ? `, ${aps.length} apariciones` : ''}`, pruebas: nuevas };
  },
};

// ---------------------------------------------------------------------------
// citas
// ---------------------------------------------------------------------------

const citas: Herramienta = {
  declaracion: {
    nombre: 'citas',
    descripcion: 'El grafo de citas de un documento: qué obras de la biblioteca cita o menciona y cuáles lo citan, con su bibliografía.',
    parametros: { type: 'object', properties: { documento: { type: 'string' } }, required: ['documento'] },
  },
  async ejecutar(args, ctx) {
    const doc = resolverDocumento(ctx, args.documento);
    if (!doc) return fallo(`No conozco ese documento. Disponibles: ${documentosDisponibles(ctx)}`);
    const n = await quieto(() => detalleNodo(ctx.p.sql, doc), null);
    if (!n) return { texto: 'El grafo de citas no tiene este documento (no se ha construido o no cita nada).', resumen: 'sin grafo de citas', pruebas: [] };
    const lineas = [
      `Cita a: ${n.cita.length ? n.cita.map((c) => `${rotuloDocumento(ctx, c.documento)}${c.etiquetas.length ? ` (${c.etiquetas.join(', ')})` : ''}`).join('; ') : 'ninguna obra de la biblioteca'}.`,
      `Citado por: ${n.citadoEn.length ? n.citadoEn.map((c) => rotuloDocumento(ctx, c.documento)).join('; ') : 'ninguna obra de la biblioteca'}.`,
    ];
    if (n.bibliografia.length) lineas.push(`Bibliografía (${n.bibliografia.length}):\n${n.bibliografia.slice(0, 25).map((b) => `- ${recortar(b.texto, 200)}${b.resuelto ? ` → ${rotuloDocumento(ctx, b.resuelto)}` : ''}`).join('\n')}`);
    return { texto: lineas.join('\n'), resumen: `cita ${n.cita.length}, citado por ${n.citadoEn.length}`, pruebas: [] };
  },
};

// ---------------------------------------------------------------------------
// relaciones
// ---------------------------------------------------------------------------

const relaciones: Herramienta = {
  declaracion: {
    nombre: 'relaciones',
    descripcion: 'Las relaciones de un documento con otras obras de la biblioteca: adaptación, traducción, edición, versión, comentario o cita (con sus pruebas y su fuente), y las obras con las que comparte personajes o personas del grafo.',
    parametros: { type: 'object', properties: { documento: { type: 'string' } }, required: ['documento'] },
  },
  async ejecutar(args, ctx) {
    const doc = resolverDocumento(ctx, args.documento);
    if (!doc) return fallo(`No conozco ese documento. Disponibles: ${documentosDisponibles(ctx)}`);
    const sql = ctx.p.sql;
    const lineas: string[] = [];
    const nuevas: string[] = [];
    const rels = await quieto(() => leerRelaciones(sql, doc), []);
    for (const r of rels) {
      const otro = r.origen === doc ? r.destino : r.origen;
      const sentido = r.origen === doc ? `${r.tipo} →` : `← ${r.tipo}`;
      const ids = await apuntarEvidencias(ctx, r.evidencias.slice(0, 4), { capa: 'comprension', herramienta: 'relaciones', nota: `Prueba de la relación ${r.tipo}` });
      nuevas.push(...ids);
      lineas.push(`${sentido} ${rotuloDocumento(ctx, otro)} (fuente: ${r.fuente}, confianza ${r.confianza.toFixed(2)})${r.nota ? `: ${recortar(r.nota, 400)}` : ''}${ids.length ? ` · pruebas ${ids.join(', ')}` : ''}`);
    }
    const compartidas = await quieto(() => sql.ejecutar<{ otro: string; n: number; nombres: string }>(
      `SELECT m2.documento AS otro, COUNT(DISTINCT m1.entidad) AS n, group_concat(DISTINCT e.nombre) AS nombres
         FROM menciones m1 JOIN menciones m2 ON m2.entidad = m1.entidad AND m2.documento <> m1.documento
         JOIN entidades e ON e.id = m1.entidad
        WHERE m1.documento = ? AND e.tipo NOT IN ('fecha', 'concepto')
        GROUP BY m2.documento ORDER BY n DESC LIMIT 8`, doc), []);
    const visibles = compartidas.filter((c) => ctx.docs.has(c.otro) && (!ctx.ambito || ctx.ambito.has(c.otro)));
    if (visibles.length) lineas.push(`Comparte entidades con: ${visibles.map((c) => `${rotuloDocumento(ctx, c.otro)}: ${c.n} (${recortar(String(c.nombres ?? '').split(',').slice(0, 8).join(', '), 160)})`).join('; ')}`);
    const n = await quieto(() => detalleNodo(sql, doc), null);
    if (n && (n.cita.length || n.citadoEn.length)) lineas.push(`Grafo de citas: cita a ${n.cita.length}, citado por ${n.citadoEn.length} (detalle con «citas»).`);
    if (!lineas.length) lineas.push('No hay relaciones registradas para este documento.');
    return { texto: lineas.join('\n'), resumen: `${rels.length} relaciones, ${visibles.length} obras con entidades comunes`, pruebas: nuevas };
  },
};

// ---------------------------------------------------------------------------
// alinear
// ---------------------------------------------------------------------------

function seSolapan(a: Ancla, finA: Ancla | undefined, b: { paginas?: [number, number]; tiempo?: [number, number] }): boolean {
  if (b.tiempo && a.tipo === 'tiempo') {
    const t1 = finA?.tipo === 'tiempo' ? finA.t1 : a.t1;
    return a.t0 < b.tiempo[1] && t1 > b.tiempo[0];
  }
  if (b.paginas && a.tipo === 'pagina') {
    const p1 = finA?.tipo === 'pagina' ? finA.fisica : a.fisica;
    return a.fisica <= b.paginas[1] && p1 >= b.paginas[0];
  }
  return !b.tiempo && !b.paginas;
}

const alinear: Herramienta = {
  declaracion: {
    nombre: 'alinear',
    descripcion: 'Lo que corresponde a un tramo (páginas, minutos o segmento) de un documento en las obras relacionadas (la película de un cuento, la traducción de un texto, otra edición), con el tipo de correspondencia (equivalente, condensado, transformado, añadido, suprimido…) y una nota de qué cambia. Si no hay alineación calculada, propone los pasajes más parecidos de la otra obra.',
    parametros: {
      type: 'object',
      properties: {
        documento: { type: 'string' },
        paginas: TRAMO_PAGINAS,
        tiempo: TRAMO_TIEMPO,
        segmento: { type: 'string' },
        con: { type: 'string', description: 'La otra obra (si no, todas las relacionadas).' },
      },
      required: ['documento'],
    },
  },
  async ejecutar(args, ctx) {
    const doc = resolverDocumento(ctx, args.documento);
    if (!doc) return fallo(`No conozco ese documento. Disponibles: ${documentosDisponibles(ctx)}`);
    const sql = ctx.p.sql;
    const con = texto(args.con) ? resolverDocumento(ctx, args.con) : null;
    let tramo: { paginas?: [number, number]; tiempo?: [number, number] } = {};
    const seg = texto(args.segmento) ? await quieto(() => leerSegmento(sql, texto(args.segmento)), null) : null;
    if (seg?.ancla.tipo === 'tiempo') tramo = { tiempo: [seg.ancla.t0, seg.anclaFin?.tipo === 'tiempo' ? seg.anclaFin.t1 : seg.ancla.t1] };
    else if (seg?.ancla.tipo === 'pagina') tramo = { paginas: [seg.ancla.fisica, seg.anclaFin?.tipo === 'pagina' ? seg.anclaFin.fisica : seg.ancla.fisica] };
    const t = tramoDe(args.tiempo, segundosDe), pg = tramoDe(args.paginas);
    if (t) tramo = { tiempo: t };
    else if (pg) tramo = { paginas: pg };
    if (!tramo.tiempo && !tramo.paginas) return fallo('Indica el tramo: «paginas», «tiempo» o «segmento».');
    const lineas: string[] = [];
    const nuevas: string[] = [];
    const todas = await quieto(() => leerAlineaciones(sql, { documento: doc }), []);
    const relevantes = todas.filter((a) => {
      const propio = a.a?.documento === doc ? a.a : a.b?.documento === doc ? a.b : undefined;
      const otro = propio === a.a ? a.b : a.a;
      if (con && otro && otro.documento !== con) return false;
      return propio ? seSolapan(propio.ancla, propio.anclaFin, tramo) : false;
    }).slice(0, 10);
    for (const a of relevantes) {
      const lados = [a.a, a.b].filter((x): x is NonNullable<typeof x> => !!x);
      const ids: string[] = [];
      for (const l of lados) {
        const us = await quieto(() => unidadesDeTramo(sql, l.documento, l.ancla.tipo === 'tiempo' ? { tiempo: [l.ancla.t0, l.anclaFin?.tipo === 'tiempo' ? l.anclaFin.t1 : l.ancla.t1] } : l.ancla.tipo === 'pagina' ? { paginas: [l.ancla.fisica, l.anclaFin?.tipo === 'pagina' ? l.anclaFin.fisica : l.ancla.fisica] } : {}, 1), []);
        const u = us[0];
        const p = apuntar(ctx, { documento: l.documento, ancla: l.ancla, ...(l.anclaFin ? { anclaFin: l.anclaFin } : {}), cita: u ? recortar(u.texto, 600) : '', modo: modoDeAncla(l.ancla, ctx.docs.get(l.documento)?.tipo), ...(u ? { unidad: u.unidad } : {}) },
          { capa: 'comprension', herramienta: 'alinear', ...(u ? { ambito: u } : {}), nota: `Lado de una alineación (${a.tipo})` });
        ids.push(p.id);
        nuevas.push(p.id);
      }
      const desc = lados.map((l, i) => `${rotuloDocumento(ctx, l.documento)} ${anclaACita(l.ancla, l.anclaFin)} [${ids[i]}]`).join(' ↔ ');
      lineas.push(`${a.tipo}: ${desc}${lados.length < 2 ? ' (el otro lado no existe)' : ''}\n  ${recortar(a.nota, 500)}`);
    }
    if (!relevantes.length) {
      // Sin alineación calculada: los pasajes más parecidos de las otras obras.
      const unidades = await unidadesDeTramo(sql, doc, tramo, 12);
      // Sin comillas: una frase entrecomillada haría que el buscador la tomara por cita literal.
      const textoTramo = unidades.map((u) => u.texto.replace(/\*\*[^*\n]{1,60}?:\*\*\s*/g, '')).join(' ').replace(/[«»“”"]/g, '').replace(/\s+/g, ' ').slice(0, 900);
      if (!textoTramo) return { texto: 'Ese tramo está vacío.', resumen: 'tramo vacío', pruebas: [] };
      const otros = con ? [con] : (ctx.documentosPlan?.length ? ctx.documentosPlan : [...ctx.docs.keys()]).filter((id) => id !== doc && (!ctx.ambito || ctx.ambito.has(id)));
      if (!otros.length) return { texto: 'No hay otras obras en el ámbito con las que alinear.', resumen: 'sin otras obras', pruebas: [] };
      const r = await buscarEnCapas(ctx.p.buscador, textoTramo, { capas: ['literal'], filtros: { documentos: otros }, limite: 5, reordenar: false });
      lineas.push(`No hay alineación calculada para este tramo. Pasajes más parecidos (por sentido, hay que comprobarlos leyendo):`);
      const us = await ambitos(ctx, r.resultados.flatMap((x) => (x.capa === 'literal' ? [x.resultado.fragmento.unidad] : [])));
      for (const x of r.resultados) {
        if (x.capa !== 'literal') continue;
        const u = us.get(x.resultado.fragmento.unidad);
        const p = apuntar(ctx, evidenciaDeResultado(x.resultado), { capa: 'literal', herramienta: 'alinear', ...(u ? { ambito: u } : {}), ...(u?.imagen ? { imagen: u.imagen } : {}), nota: 'Correspondencia por parecido (sin alinear)' });
        nuevas.push(p.id);
        lineas.push(lineaPrueba(ctx, p, 400));
      }
    }
    return { texto: lineas.join('\n'), resumen: relevantes.length ? `${relevantes.length} correspondencias` : `${nuevas.length} pasajes parecidos (sin alineación calculada)`, pruebas: nuevas };
  },
};

export const HERRAMIENTAS_LECTURA: Herramienta[] = [buscar, leer, mapa, entidad, citas, relaciones, alinear];

export type { ResultadoHerramienta };
