/**
 * Un servidor de la API v2 en memoria: un `fetch` que responde las rutas del
 * contrato con el corpus de demostración. La web usa el MISMO cliente tipado de
 * `@scholaris/contrato` contra la API real o contra esto; nada más cambia.
 * Solo se carga cuando no hay API (desarrollo, demostraciones, capturas).
 */
import { anclaACita, elegirPasaje, type Ancla, type MetadatosDocumento, type Progreso, type Resultado, type TipoEntrada } from '@scholaris/nucleo';
import type {
  Ajustes, Alerta, Biblioteca, Buscar, ClaveApi, ConfigPublica, Cuaderno, DetalleAutocita, DetalleDocumento, EventoBusqueda,
  EventoRespuesta, EventoTiempoReal, GrafoCitas, InstantaneaCorpus, MapaConceptos, PropuestaCita, ResultadoVista, ResumenDocumento,
  SeccionVista, Tarea, Tarjeta, UnidadVista, Vigilante, Concepto, Yo, EstiloCsl, MiembrosGrupo, Responder,
  Entidad, MencionEntidad, TipoEntidad,
} from '@scholaris/contrato';
import { anclaDe, BIBLIOTECAS, DOCUMENTOS, LIBRO_EN_CURSO, textoDe, type DocDemo } from './corpus';

export const configSimulada: ConfigPublica = {
  modo: 'local', version: '2.0.0-demo', requiereAutenticacion: false,
  funciones: { conversionServidor: true, youtube: true, mcp: true, inferbox: false, subidaPorPartes: true },
  limites: { bytesMaximos: 4 * 1024 ** 3, tamParte: 16 * 1024 ** 2 },
};

// ---------------------------------------------------------------------------
// Estado en memoria
// ---------------------------------------------------------------------------

const docs = new Map<string, DocDemo & { estado: 'listo' | 'procesando' | 'error'; leidas?: number; tarea?: string; borrado?: boolean }>();
for (const d of DOCUMENTOS) docs.set(d.id, { ...d, estado: 'listo' });
const bibliotecas: Biblioteca[] = BIBLIOTECAS.map((b) => ({ ...b, documentos: 0, actualizada: b.creada, propietario: 'yo', permiso: 'propietario', compartida: b.id === 'b-clases' }));

const ahora = () => new Date().toISOString();
const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const cuadernos: Cuaderno[] = [
  { id: 'c-panoptico', titulo: 'El inspector invisible', cuerpo: '', tarjetas: 4, creado: hace(60 * 24 * 9), actualizado: hace(60 * 5) },
  { id: 'c-carcel', titulo: 'Escribir desde la cárcel', cuerpo: '', tarjetas: 3, creado: hace(60 * 24 * 30), actualizado: hace(60 * 26) },
];
const tarjetas = new Map<string, Tarjeta[]>();
/** El párrafo de la unidad que contiene `contiene` (o el primero que no sea un título). */
function parrafoDe(d: DocDemo, orden: number, contiene?: string): string {
  const ps = textoDe(d, orden).split('\n\n').filter((p) => !p.startsWith('#'));
  return (contiene ? ps.find((p) => p.includes(contiene)) : undefined) ?? ps.find((p) => p.length > 40) ?? ps[0] ?? '';
}
const tarjeta = (cuaderno: string, i: number, doc: string, orden: number, contiene?: string, extra: Partial<Tarjeta> = {}): Tarjeta => {
  const d = docs.get(doc)!;
  const ancla = anclaDe(d, orden);
  const texto = parrafoDe(d, orden, contiene);
  return { id: `t-${cuaderno}-${i}`, tipo: 'fragmento', documento: doc, objetivo: `f-${doc}-${orden}-0`, contenido: {}, cita: { texto, etiqueta: anclaACita(ancla), citaCorta: citaCorta(d.meta, ancla) }, posicion: i, huerfana: false, creada: hace(60 * (40 - i)), ...extra };
};
tarjetas.set('c-panoptico', [
  tarjeta('c-panoptico', 0, 'd-panoptico', 4), tarjeta('c-panoptico', 1, 'd-panoptico', 12),
  { id: 't-c-panoptico-n', tipo: 'nota', contenido: { texto: 'Comparar la «apparent omnipresence of the inspector» de Bentham con los guardas de la torre de Segismundo: ¿quién vigila a quién?' }, posicion: 2, huerfana: false, creada: hace(300) },
  tarjeta('c-panoptico', 3, 'd-vida-sueno', 13, 'Este es Clotaldo'),
]);
tarjetas.set('c-carcel', [tarjeta('c-carcel', 0, 'd-consolatio', 1), tarjeta('c-carcel', 1, 'd-quijote', 5, 'carcel'), tarjeta('c-carcel', 2, 'd-vida-sueno', 6, 'mísero')]);

const vigilantes: Vigilante[] = [
  { id: 'v-1', nombre: 'La cárcel como lugar de escritura', consulta: 'cárcel, prisión y torre', modo: 'al_ingerir', alertas: true, pendientes: 2, ultimaEjecucion: hace(90), ultimaConfianza: 'alta', creado: hace(60 * 24 * 20), actualizado: hace(90) },
  { id: 'v-2', nombre: 'Ver sin ser visto', consulta: 'inspection, inspector, seeing without being seen', modo: 'semanal', alertas: true, pendientes: 0, ultimaEjecucion: hace(60 * 24 * 3), ultimaConfianza: 'media', creado: hace(60 * 24 * 40), actualizado: hace(60 * 24 * 3) },
  { id: 'v-3', nombre: 'Golondrinas y olvido', consulta: 'Bécquer: memoria y olvido', modo: 'manual', alertas: false, pendientes: 0, creado: hace(60 * 24 * 2), actualizado: hace(60 * 24 * 2) },
];
const alertas: Alerta[] = [
  { id: 'a-1', vigilante: 'v-1', nombreVigilante: 'La cárcel como lugar de escritura', documentosNuevos: ['d-vida-sueno'], cambio: 'La grabación de «La vida es sueño» trae a Segismundo encadenado en la torre: «¡Ay mísero de mí! ¡Ay infelice!» (escena II).', disparadaPor: 'ingesta', creada: hace(90) },
  { id: 'a-2', vigilante: 'v-1', nombreVigilante: 'La cárcel como lugar de escritura', documentosNuevos: ['d-quijote'], cambio: 'En el prólogo del Quijote de 1608, Cervantes compara su libro con un hijo engendrado «en vna carcel».', disparadaPor: 'ingesta', creada: hace(60 * 30) },
];

const historial: EventoBusqueda[] = [
  ['¿qué delito cometió Segismundo al nacer?', 'respuesta', 'conceptual', 6, 'alta', 1200, true],
  ['carcel', 'busqueda', 'literal', 5, undefined, 140, false],
  ['inspector lodge', 'busqueda', 'conceptual', 9, undefined, 180, false],
  ['¿cómo presenta Cervantes su libro en el prólogo?', 'respuesta', 'conceptual', 7, 'media', 1900, false],
  ['vuelva usted mañana', 'busqueda', 'literal', 4, undefined, 95, true],
  ['oscuras golondrinas', 'busqueda', 'literal', 1, undefined, 70, false],
].map(([consulta, tipo, intencion, resultados, confianza, ms, fijado], i) => ({
  id: `h-${i}`, consulta: consulta as string, tipo: tipo as EventoBusqueda['tipo'], intencion: intencion as EventoBusqueda['intencion'], resultados: resultados as number,
  ...(confianza ? { confianza: confianza as 'alta' } : {}), estado: 'ok', ms: ms as number, fijado: fijado as boolean, oculto: false, cuando: hace(60 * (i * 7 + 2)),
}));

const claves: ClaveApi[] = [
  { id: 'k-1', nombre: 'Claude (MCP)', prefijo: 'sk_sch_7f3a', alcances: ['lectura', 'mcp'], creada: hace(60 * 24 * 12), ultimoUso: hace(45) },
  { id: 'k-2', nombre: 'Cuaderno de Python', prefijo: 'sk_sch_c021', alcances: ['lectura', 'escritura'], creada: hace(60 * 24 * 60), ultimoUso: hace(60 * 24 * 8) },
];
const ajustes: Ajustes = {
  preferencias: { idioma: 'es', estiloCita: 'apa', idiomaCitas: 'es-ES', reordenar: true, usarClavesPropias: false, tema: 'sistema' },
  claves: [{ proveedor: 'gemini', final: 'x9Qa', guardada: hace(60 * 24 * 5) }],
};
let grabacion = { activa: true, desde: hace(60 * 24 * 200) };
const conceptos: Concepto[] = [
  { id: 'k-carcel', nombre: 'Cárcel', descripcion: 'La prisión y la torre en el corpus, en castellano y en inglés.', terminos: ['cárcel', 'carcel', 'prisión', 'prison'], ultimoInforme: 'i-1', creado: hace(60 * 24 * 14), actualizado: hace(60 * 24) },
  { id: 'k-vigilancia', nombre: 'Vigilancia', terminos: ['inspection', 'inspector', 'vigilantes', 'guardas'], creado: hace(60 * 24 * 40), actualizado: hace(60 * 24 * 6) },
];

const autocitas = new Map<string, DetalleAutocita>();

// ---------------------------------------------------------------------------
// Tiempo real simulado
// ---------------------------------------------------------------------------

const oyentes = new Set<(e: EventoTiempoReal) => void>();
const emitir = (e: EventoTiempoReal) => oyentes.forEach((o) => o(e));
export function escucharSimulado(o: (e: EventoTiempoReal) => void) {
  oyentes.add(o);
  queueMicrotask(() => o({ tipo: 'hola', usuario: 'yo' }));
  return () => oyentes.delete(o);
}

const tareas = new Map<string, Tarea>();

/** Simula el Workflow de ingesta: fases y unidades legibles a ritmo creíble. */
function simularIngesta(documento: string, tarea: string, unidades: number, rapido = 1) {
  const fases: Array<Progreso['fase']> = ['lectura', 'folios', 'metadatos', 'estructura', 'contexto', 'vectores', 'indexado', 'listo'];
  const inicio = Date.now();
  let leidas = 0;
  const d = docs.get(documento);
  const t: Tarea = { id: tarea, tipo: 'ingesta', estado: 'procesando', documento, creada: ahora(), actualizada: ahora() };
  tareas.set(tarea, t);
  const paso = Math.max(1, Math.round(unidades / 28));
  const tick = () => {
    if (!docs.has(documento) || t.estado === 'cancelada') return;
    if (leidas < unidades) {
      const desde = leidas + 1;
      leidas = Math.min(unidades, leidas + paso);
      if (d) d.leidas = leidas;
      emitir({ tipo: 'unidades', tarea, documento, desde: desde - 1, hasta: leidas - 1 });
      const p: Progreso = { tarea, documento, fase: 'lectura', avance: leidas / unidades, total: 0.75 * (leidas / unidades), unidadesListas: leidas, transcurrido: Date.now() - inicio, mensaje: `Leyendo ${leidas} de ${unidades}` };
      t.progreso = p;
      emitir({ tipo: 'progreso', progreso: p });
      setTimeout(tick, 260 / rapido);
      return;
    }
    const resto = fases.slice(1);
    resto.forEach((fase, i) => setTimeout(() => {
      const p: Progreso = { tarea, documento, fase, avance: 1, total: 0.75 + (0.25 * (i + 1)) / resto.length, unidadesListas: unidades, transcurrido: Date.now() - inicio };
      t.progreso = p;
      emitir({ tipo: 'progreso', progreso: p });
      emitir({ tipo: 'fase', tarea, documento, fase });
      if (fase === 'listo') {
        if (d) { d.estado = 'listo'; delete d.leidas; delete d.tarea; }
        indice = null;
        t.estado = 'listo'; t.terminada = ahora();
        emitir({ tipo: 'fin', tarea, documento, estado: 'listo' });
      }
    }, (i + 1) * 420 / rapido));
  };
  setTimeout(tick, 300);
}

// Un libro ya procesándose al abrir la demo («On the Origin of Species», 1859): así se ve la ingesta en vivo.
docs.set(LIBRO_EN_CURSO.id, { ...LIBRO_EN_CURSO, creado: ahora(), estado: 'procesando', leidas: 0, tarea: 'tarea-origen' });
simularIngesta(LIBRO_EN_CURSO.id, 'tarea-origen', LIBRO_EN_CURSO.unidades, 0.5);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function autoresCorto(m: MetadatosDocumento) {
  const ap = m.autores.map((x) => x.apellidos);
  return ap.length > 2 ? `${ap[0]} et al.` : ap.join(' y ');
}

function citaCorta(m: MetadatosDocumento, ancla: Ancla) {
  const anio = m.anioOriginal && m.anio && m.anioOriginal !== m.anio ? `${m.anioOriginal}/${m.anio}` : String(m.anio ?? 's. f.');
  const loc = anclaACita(ancla);
  return `(${autoresCorto(m)}, ${anio}, ${loc})`;
}

function resumen(d: DocDemo & { estado: string; leidas?: number; tarea?: string }): ResumenDocumento {
  return {
    id: d.id, tipo: d.tipo, estado: d.estado as ResumenDocumento['estado'], titulo: d.meta.titulo,
    autores: d.meta.autores.map((x) => `${x.nombre} ${x.apellidos}`).join(', '), anio: d.meta.anioOriginal ?? d.meta.anio, idioma: d.meta.idioma,
    unidades: d.unidades, ...(d.duracion ? { duracion: d.duracion } : {}), bytes: d.bytes, creado: d.creado, actualizado: d.creado, bibliotecas: d.bibliotecas,
    ...(d.tarea ? { tarea: d.tarea } : {}),
  };
}

function detalle(d: DocDemo & { estado: string; tarea?: string }): DetalleDocumento {
  return {
    id: d.id, tipo: d.tipo, metadatos: d.meta, estado: d.estado as DetalleDocumento['estado'], huella: 'demo', original: `demo/${d.id}`, mime: d.mime, bytes: d.bytes,
    unidades: d.unidades, ...(d.duracion ? { duracion: d.duracion } : {}), creado: d.creado, actualizado: d.creado, bibliotecas: d.bibliotecas,
    espacios: [{ id: 'gemini-embedding-2@1536', proveedor: 'google', modelo: 'gemini-embedding-2', dims: 1536, normalizado: true, modalidades: ['texto', 'imagen'] }],
    cuentas: { fragmentos: fragmentosDe(d), secciones: d.secciones.length, figuras: d.figuras?.length ?? 0 },
    ...(d.tarea ? { tarea: d.tarea } : {}),
  };
}

/** Párrafos de un documento (lo que la búsqueda indexa como fragmentos). */
function fragmentosDe(d: DocDemo): number {
  let n = 0;
  for (let o = 1; o <= d.unidades; o++) n += textoDe(d, o).split('\n\n').filter((p) => p.trim() && !p.startsWith('#')).length;
  return n;
}

function unidad(d: DocDemo, orden: number): UnidadVista {
  const ancla = anclaDe(d, orden);
  return { id: `u-${d.id}-${orden}`, orden: orden - 1, ancla, etiqueta: anclaACita(ancla), texto: textoDe(d, orden), lector: d.tipo === 'pdf' ? 'capa-de-texto' : d.tipo === 'audio' || d.tipo === 'video' ? 'whisper-large-v3-turbo' : 'gemini-flash', confianza: 0.96 };
}

const normalizar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const VACIAS = new Set('el la los las un una unos unas de del al y o u a en que se no es por con para su sus lo como qué cual cuál mas más pero sin sobre entre hay ha he este esta esto ese esa'.split(' '));

interface Pieza { d: DocDemo; orden: number; parrafo: number; texto: string; norm: string }
let indice: Pieza[] | null = null;
function piezas(): Pieza[] {
  if (indice) return indice;
  indice = [];
  for (const d of docs.values()) {
    if (d.estado !== 'listo' || d.borrado) continue;
    for (let o = 1; o <= d.unidades; o++) {
      textoDe(d, o).split('\n\n').filter((p) => !p.startsWith('#')).forEach((p, i) => indice!.push({ d, orden: o, parrafo: i, texto: p, norm: normalizar(p) }));
    }
  }
  return indice;
}

function buscarEn(q: string, filtros: Buscar['filtros'] = {}, k = 20): ResultadoVista[] {
  const terminos = normalizar(q).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2 && !VACIAS.has(t));
  if (!terminos.length) return [];
  const raices = terminos.map((t) => t.slice(0, Math.max(4, t.length - 2)));
  const vistos = new Map<string, { p: Pieza; s: number }>();
  // Peso por rareza (IDF): «panóptico» pesa más que «tiene».
  const todas = piezas();
  const idf = raices.map((r) => Math.log(1 + todas.length / (1 + todas.filter((p) => p.norm.includes(r)).length)));
  for (const p of todas) {
    if (filtros.documentos?.length && !filtros.documentos.includes(p.d.id)) continue;
    if (filtros.tipos?.length && !filtros.tipos.includes(p.d.tipo)) continue;
    if (filtros.bibliotecas?.length && !p.d.bibliotecas.some((b) => filtros.bibliotecas!.includes(b))) continue;
    let s = 0;
    raices.forEach((r, i) => { const n = p.norm.split(r).length - 1; if (n) s += (1 + Math.log(1 + n)) * idf[i]!; });
    if (!s) continue;
    s *= 0.5 + (0.5 * raices.filter((r) => p.norm.includes(r)).length) / raices.length;
    const clave = `${p.d.id}-${p.orden}`;
    const prev = vistos.get(clave);
    if (!prev || prev.s < s) vistos.set(clave, { p, s });
  }
  const orden = [...vistos.values()].sort((x, y) => y.s - x.s).slice(0, k);
  const max = orden[0]?.s ?? 1;
  return orden.map(({ p, s }) => {
    const ancla = anclaDe(p.d, p.orden);
    const resaltado = p.texto.replace(/[\p{L}\p{M}]+/gu, (w) => (raices.some((r) => normalizar(w).startsWith(r)) ? `<mark>${w}</mark>` : w));
    // El pasaje: las oraciones con coincidencias (el mismo criterio que la API, con las raíces de la demostración).
    const tramos = [...p.texto.matchAll(/[\p{L}\p{M}]+/gu)].filter((m) => raices.some((r) => normalizar(m[0]).startsWith(r))).map((m) => ({ desde: m.index, hasta: m.index + m[0].length, termino: raices.find((r) => normalizar(m[0]).startsWith(r)) ?? m[0] }));
    const pasaje = elegirPasaje(p.texto, tramos);
    const sec = [...p.d.secciones].reverse().find((x) => x.unidad <= p.orden);
    const r: ResultadoVista = {
      fragmento: { id: `f-${p.d.id}-${p.orden}-${p.parrafo}`, documento: p.d.id, unidad: `u-${p.d.id}-${p.orden}`, orden: p.parrafo, texto: p.texto, contexto: `De «${p.d.meta.titulo}»${sec ? `, ${sec.titulo}` : ''}.`, seccion: sec ? [sec.titulo] : [], ancla },
      documento: { id: p.d.id, tipo: p.d.tipo, metadatos: p.d.meta }, puntuacion: s / max, vias: s / max > 0.6 ? ['lexica', 'densa'] : ['densa'], resaltado, ...(pasaje.texto ? { pasaje } : {}),
      etiqueta: anclaACita(ancla), citaCorta: citaCorta(p.d.meta, ancla),
    };
    return r;
  });
}

// ---------------------------------------------------------------------------
// Respuestas HTTP
// ---------------------------------------------------------------------------

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = async (cuerpo: unknown, ms = 60 + Math.random() * 90, estado = 200) => { await espera(ms); return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } }); };
const error = (estado: number, codigo: string, mensaje: string) => json({ error: { codigo, mensaje } }, 40, estado);
const ok = () => json({ ok: true }, 50);

function sse(eventos: AsyncIterable<unknown>): Response {
  const cod = new TextEncoder();
  const flujo = new ReadableStream<Uint8Array>({
    async start(c) {
      for await (const e of eventos) c.enqueue(cod.encode(`data: ${JSON.stringify(e)}\n\n`));
      c.close();
    },
  });
  return new Response(flujo, { headers: { 'content-type': 'text/event-stream' } });
}

async function* responder(p: Responder): AsyncGenerator<EventoRespuesta> {
  const t0 = Date.now();
  await espera(220);
  const res = buscarEn(p.consulta, p.filtros, 8);
  yield { tipo: 'resultados', resultados: res, intencion: 'conceptual' };
  if (!res.length) {
    yield { tipo: 'texto', delta: 'No encuentro en tu biblioteca pasajes que respondan a esa pregunta. Prueba con otras palabras o amplía los filtros.' };
    yield { tipo: 'fin', ms: Date.now() - t0, confianza: 'baja' };
    return;
  }
  const usados = res.slice(0, Math.min(3, res.length));
  // Cada frase es una cita literal del pasaje, con su autor (o su personaje) y su obra.
  const frases = usados.map((r, i) => {
    const doc = r.documento.metadatos;
    const { quien, texto } = extracto(r.fragmento.texto, p.consulta);
    const voz = quien ? `${quien}, en «${doc.titulo}»` : `${autoresCorto(doc)}, en «${doc.titulo}»`;
    return `${i === 0 ? '' : i === 1 ? 'Además, ' : 'Y '}${voz}: «${texto}» [${i + 1}]`;
  });
  for (const [i, r] of usados.entries()) {
    yield { tipo: 'cita', n: i + 1, fragmento: r.fragmento.id, documento: r.documento.id, etiqueta: r.etiqueta, citaCorta: r.citaCorta, respaldo: 0.92 - i * 0.07 };
  }
  const texto = frases.join(' ');
  for (const trozo of texto.match(/\S+\s*/g) ?? []) {
    await espera(18 + Math.random() * 30);
    yield { tipo: 'texto', delta: trozo };
  }
  yield { tipo: 'fin', ms: Date.now() - t0, confianza: usados.length > 2 ? 'alta' : 'media', evento: `h-${Date.now()}` };
}

/**
 * Un trozo literal del pasaje: la frase que contiene algún término de la consulta (o la
 * primera), sin tocar una letra; «[…]» marca lo que se omite. En las transcripciones de
 * teatro devuelve también el personaje que habla.
 */
function extracto(pasaje: string, consulta = ''): { quien?: string; texto: string } {
  const turno = /^\*\*([^*\n]+):\*\*\s*/.exec(pasaje);
  const limpio = (turno ? pasaje.slice(turno[0].length) : pasaje).replace(/\s*\n\s*/g, ' ');
  const frases = limpio.match(/[^.!?;:]+[.!?;:]+[»”)]?|[^.!?;:]+$/g) ?? [limpio];
  const raices = normalizar(consulta).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2 && !VACIAS.has(t)).map((t) => t.slice(0, Math.max(4, t.length - 2)));
  const k = Math.max(0, frases.findIndex((f) => raices.some((r) => normalizar(f).includes(r))));
  let texto = frases[k]!.trim();
  if (texto.length > 320) texto = `${texto.slice(0, 300).replace(/\s+\S*$/, '')} […]`;
  if (k > 0) texto = `[…] ${texto}`;
  return { ...(turno ? { quien: turno[1] } : {}), texto };
}

function autocitar(texto: string, estilo: string): DetalleAutocita {
  const parrafos = texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const propuestas: PropuestaCita[] = [];
  parrafos.forEach((p, i) => {
    const frases = p.match(/[^.!?]+[.!?]+/g) ?? [p];
    frases.forEach((f) => {
      const [mejor] = buscarEn(f, {}, 1);
      if (!mejor || mejor.puntuacion < 0.2) return;
      const desde = p.indexOf(f);
      const tipos = ['APOYO_DIRECTO', 'APLICACION_DE_MARCO', 'CONTEXTO'] as const;
      const respaldo = Math.min(0.97, 0.62 + (hashCorto(f) % 35) / 100);
      const otras = buscarEn(f, {}, 3).slice(1);
      propuestas.push({
        id: `p-${i}-${desde}`, parrafo: i, desde, hasta: desde + f.trim().length, afirmacion: f.trim(),
        cita: { fragmento: mejor.fragmento.id, documento: mejor.documento.id, ancla: mejor.fragmento.ancla, relacion: tipos[hashCorto(f) % 3]!, respaldo, pasaje: mejor.fragmento.texto },
        textoCita: estilo.startsWith('chicago-note') ? `${mejor.documento.metadatos.autores[0]?.nombre} ${mejor.documento.metadatos.autores[0]?.apellidos}, ${mejor.documento.metadatos.titulo}, ${anclaACita(mejor.fragmento.ancla).replace('p. ', '')}.` : mejor.citaCorta,
        alternativas: otras.map((o) => ({ fragmento: o.fragmento.id, documento: o.documento.id, ancla: o.fragmento.ancla, relacion: 'CONTEXTO', respaldo: 0.55, pasaje: o.fragmento.texto })),
      });
    });
  });
  const usados = [...new Set(propuestas.map((p) => p.cita.documento))].map((id) => docs.get(id)!.meta);
  return {
    id: `ac-${Date.now()}`, titulo: parrafos[0]?.slice(0, 48) ?? 'Texto', estado: 'listo', citas: propuestas.length, creada: ahora(), texto, parrafos, propuestas, estilo,
    bibliografia: usados.map((m) => `${m.autores.map((x) => `${x.apellidos}, ${x.nombre.charAt(0)}.`).join(' y ')} (${m.anio ?? 's. f.'}). ${m.titulo}${m.subtitulo ? `. ${m.subtitulo}` : ''}. ${m.editorial ?? m.revista ?? ''}.`),
  };
}
function hashCorto(t: string) { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

const ESTILOS: EstiloCsl[] = [
  { id: 'apa', titulo: 'APA 7.ª edición', formato: 'autor-fecha' },
  { id: 'chicago-author-date', titulo: 'Chicago 17.ª (autor-fecha)', formato: 'autor-fecha' },
  { id: 'chicago-note-bibliography', titulo: 'Chicago 17.ª (notas y bibliografía)', formato: 'nota' },
  { id: 'modern-language-association', titulo: 'MLA 9.ª edición', formato: 'autor-fecha' },
  { id: 'harvard-cite-them-right', titulo: 'Harvard', formato: 'autor-fecha' },
  { id: 'iso690-author-date-es', titulo: 'UNE-ISO 690 (autor-fecha)', formato: 'autor-fecha' },
  { id: 'iso690-numeric-es', titulo: 'UNE-ISO 690 (numérico)', formato: 'numérico' },
  { id: 'revista-de-filologia-espanola', titulo: 'Revista de Filología Española', formato: 'autor-fecha' },
  { id: 'ieee', titulo: 'IEEE', formato: 'numérico' },
];

function mapa(): MapaConceptos {
  const grupos = [
    ['El inspector y la casa de inspección', 0.28, 0.32, ['d-panoptico']], ['La torre y la cárcel', 0.7, 0.3, ['d-vida-sueno', 'd-consolatio']],
    ['Libros de caballerías', 0.62, 0.68, ['d-quijote']], ['El viajero perdido', 0.22, 0.72, ['d-marianela']],
    ['Golondrinas y olvido', 0.46, 0.86, ['d-rimas']], ['La carrera espacial', 0.86, 0.56, ['d-rice']],
    ['Vuelva usted mañana', 0.44, 0.12, ['d-larra']],
  ] as const;
  const r = (() => { let s = 7; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; })();
  const puntos: MapaConceptos['puntos'] = [];
  grupos.forEach(([, x, y, ds], g) => {
    const n = 40 + Math.floor(r() * 70);
    for (let i = 0; i < n; i++) {
      const ang = r() * Math.PI * 2, rad = Math.sqrt(r()) * 0.09;
      puntos.push({ grupo: g, documento: ds[i % ds.length]!, objetivo: 'fragmento', id: `p${g}-${i}`, x: x + Math.cos(ang) * rad, y: y + Math.sin(ang) * rad * 0.85 });
    }
  });
  return {
    meta: { construido: hace(60 * 24), grupos: grupos.length, puntos: puntos.length, ms: 8400 },
    grupos: grupos.map(([etiqueta, x, y, ds], i) => ({ indice: i, etiqueta, confianzaEtiqueta: 0.8, tamano: puntos.filter((p) => p.grupo === i).length, modalidades: { texto: 1 }, documentosPrincipales: [...ds], x, y })),
    puntos,
  };
}

/**
 * Ninguna obra de la demo cita a otra (Cervantes no cita a Boecio ni Kennedy a Bentham),
 * así que el grafo de citas está vacío y lo que sí citan va en «Referencias sin documento».
 */
function grafo(): GrafoCitas {
  return { nodos: [], aristas: [], construido: hace(60 * 30) };
}

function corpus(): InstantaneaCorpus {
  const lista = [...docs.values()].filter((d) => !d.borrado);
  const porTipo: Record<string, number> = {}, porDecada: Record<string, number> = {}, porIdioma: Record<string, number> = {};
  for (const d of lista) {
    porTipo[d.tipo] = (porTipo[d.tipo] ?? 0) + 1;
    if (d.meta.idioma) porIdioma[d.meta.idioma] = (porIdioma[d.meta.idioma] ?? 0) + 1;
    const anio = d.meta.anioOriginal ?? d.meta.anio;
    if (anio) { const k = String(Math.floor(anio / 10) * 10); porDecada[k] = (porDecada[k] ?? 0) + 1; }
  }
  return {
    documentos: lista.length, unidades: lista.reduce((s, d) => s + d.unidades, 0), fragmentos: lista.reduce((s, d) => s + fragmentosDe(d), 0), figuras: lista.reduce((s, d) => s + (d.figuras?.length ?? 0), 0),
    segundosDeMedio: lista.reduce((s, d) => s + (d.duracion ?? 0), 0), bytes: lista.reduce((s, d) => s + d.bytes, 0), refrescado: hace(20),
    porIdioma, porTipo, porAnio: {}, porDecada,
  };
}

// ---------------------------------------------------------------------------
// El enrutador
// ---------------------------------------------------------------------------

type Manejador = (m: RegExpMatchArray, cuerpo: any, q: URLSearchParams) => Promise<Response> | Response;
const rutas: Array<[string, RegExp, Manejador]> = [];
const ruta = (metodo: string, patron: string, fn: Manejador) => rutas.push([metodo, new RegExp(`^${patron.replace(/:(\w+)/g, '([^/]+)')}$`), fn]);

ruta('GET', '/config', () => json(configSimulada, 5));
ruta('GET', '/salud', () => json({ ok: true, version: configSimulada.version }, 5));
ruta('GET', '/auth/yo', () => json({
  usuario: { id: 'yo', correo: 'jl@joseluissaorin.com', nombre: 'José Luis Saorín' }, plan: 'pro', funciones: ['scholaris'], via: 'local',
  cuotas: { documentos: { usados: docs.size, limite: null }, paginasMes: { usados: 1_284, limite: 10_000 }, busquedasDia: { usados: 37, limite: null }, autocitasMes: { usados: 6, limite: 200 }, bytes: { usados: 2_100_000_000, limite: 50_000_000_000 } },
} satisfies Yo));

ruta('GET', '/documentos', (_m, _c, q) => {
  let lista = [...docs.values()].filter((d) => !d.borrado);
  const b = q.get('biblioteca'); if (b) lista = lista.filter((d) => d.bibliotecas.includes(b));
  const tipos = q.getAll('tipo'); if (tipos.length) lista = lista.filter((d) => tipos.includes(d.tipo));
  const texto = q.get('q'); if (texto) { const n = normalizar(texto); lista = lista.filter((d) => normalizar(`${d.meta.titulo} ${d.meta.autores.map((x) => x.apellidos).join(' ')}`).includes(n)); }
  lista.sort((x, y) => y.creado.localeCompare(x.creado));
  return json({ elementos: lista.map(resumen), total: lista.length });
});
ruta('GET', '/documentos/:id', (m) => { const d = docs.get(m[1]!); return d && !d.borrado ? json(detalle(d)) : error(404, 'no_encontrado', 'Ese documento no existe.'); });
ruta('PATCH', '/documentos/:id/metadatos', (m, c) => {
  const d = docs.get(m[1]!); if (!d) return error(404, 'no_encontrado', 'Ese documento no existe.');
  const proc = { ...(d.meta.procedencia ?? {}) };
  for (const k of Object.keys(c)) proc[k] = { fuente: 'usuario', confianza: 1 };
  d.meta = { ...d.meta, ...c, procedencia: proc }; indice = null;
  return json(detalle(d));
});
ruta('DELETE', '/documentos/:id', (m) => { const d = docs.get(m[1]!); if (d) d.borrado = true; indice = null; return ok(); });
ruta('POST', '/documentos/:id/restaurar', (m) => { const d = docs.get(m[1]!); if (d) d.borrado = false; indice = null; return ok(); });
ruta('GET', '/documentos/:id/unidades', (m, _c, q) => {
  const d = docs.get(m[1]!); if (!d) return error(404, 'no_encontrado', 'Ese documento no existe.');
  const tope = d.estado === 'procesando' ? (d.leidas ?? 0) : d.unidades;
  // Como la API real: órdenes desde 0.
  const desde = Math.max(1, Number(q.get('desde') ?? 0) + 1), hasta = Math.min(tope, Number(q.get('hasta') ?? desde + 18) + 1);
  const out: UnidadVista[] = [];
  for (let o = desde; o <= hasta; o++) out.push(unidad(d, o));
  return json(out, 70 + Math.random() * 80);
});
ruta('GET', '/documentos/:id/folios', (m) => {
  const d = docs.get(m[1]!); if (!d) return error(404, 'no_encontrado', 'Ese documento no existe.');
  return json({ folios: Array.from({ length: d.unidades }, (_, i) => { const a = anclaDe(d, i + 1); return { orden: i, ...(a.tipo === 'pagina' ? { fisica: a.fisica, impresa: a.impresa, origen: a.origen, confianza: a.confianza } : a.tipo === 'tiempo' ? { impresa: null, t0: a.t0 } : a.tipo === 'seccion' ? { impresa: a.impresa ?? null } : { impresa: null }) }; }) });
});
ruta('GET', '/documentos/:id/secciones', (m) => {
  const d = docs.get(m[1]!); if (!d) return error(404, 'no_encontrado', 'Ese documento no existe.');
  return json(d.secciones.map((s, i): SeccionVista => ({ id: `s-${i}`, nivel: s.nivel, titulo: s.titulo, unidadDesde: s.unidad - 1 })));
});
ruta('GET', '/documentos/:id/figuras', (m) => {
  const d = docs.get(m[1]!); if (!d?.figuras) return json([]);
  // Solo ilustraciones que existen en la obra (el diagrama de Darwin).
  return json(d.figuras.map((f, i) => { const a = anclaDe(d, f.unidad); return { id: `fig-${i}`, unidad: f.unidad - 1, imagenUrl: '', pie: `Figura ${i + 1}. ${f.pie}`, ancla: a, etiqueta: anclaACita(a) }; }));
});
ruta('GET', '/documentos/:id/original', () => json({ url: '' }));
ruta('GET', '/documentos/:id/cita', (m, _c, q) => {
  const d = docs.get(m[1]!)!; const md = d.meta;
  const aut = md.autores.map((x) => `${x.apellidos}, ${x.nombre}`).join(' y ');
  const estilo = q.get('estilo') ?? 'apa';
  const texto = estilo.startsWith('modern') ? `${aut}. ${md.titulo}. ${md.editorial ?? md.revista ?? ''}, ${md.anio ?? 's. f.'}.` : `${aut} (${md.anio ?? 's. f.'}). ${md.titulo}${md.subtitulo ? `. ${md.subtitulo}` : ''}. ${md.editorial ?? md.revista ?? ''}.`;
  return json({ texto, html: texto });
});

ruta('POST', '/documentos/importar', () => json({ documento: 'd-panoptico', versionOrigen: 300, avisos: [] }));

ruta('GET', '/bibliotecas', () => json(bibliotecas.map((b) => ({ ...b, documentos: [...docs.values()].filter((d) => !d.borrado && d.bibliotecas.includes(b.id)).length }))));
ruta('POST', '/bibliotecas', (_m, c) => { const b: Biblioteca = { id: `b-${Date.now()}`, nombre: c.nombre, color: c.color, documentos: 0, creada: ahora(), actualizada: ahora(), propietario: 'yo', permiso: 'propietario', compartida: false }; bibliotecas.push(b); return json(b); });
ruta('POST', '/bibliotecas/:id/documentos', (m, c) => { for (const id of c.documentos as string[]) { const d = docs.get(id); if (d && !d.bibliotecas.includes(m[1]!)) d.bibliotecas = [...d.bibliotecas, m[1]!]; } return json(bibliotecas.find((b) => b.id === m[1])); });
ruta('DELETE', '/bibliotecas/:id/documentos/:doc', (m) => { const d = docs.get(m[2]!); if (d) d.bibliotecas = d.bibliotecas.filter((b) => b !== m[1]); return json(bibliotecas.find((b) => b.id === m[1])); });
ruta('DELETE', '/bibliotecas/:id', (m) => { const i = bibliotecas.findIndex((b) => b.id === m[1]); if (i >= 0) bibliotecas.splice(i, 1); return ok(); });

ruta('POST', '/busqueda', async (_m, c: Buscar & { __sse?: boolean }) => {
  if (c.__sse) {
    // Como la API: primero el orden de la fusión (aquí, algo desordenado) y luego el definitivo.
    const t = Date.now();
    const r = buscarEn(c.consulta, c.filtros, c.k ?? 20);
    const pre = [...r];
    for (let i = 0; i + 2 < pre.length; i += 3) [pre[i], pre[i + 2]] = [pre[i + 2]!, pre[i]!];
    return sse((async function* () {
      await espera(120);
      yield { tipo: 'preliminar', resultados: pre, ms: Date.now() - t };
      await espera(650);
      yield { tipo: 'final', respuesta: { resultados: r, intencion: 'conceptual', ms: Date.now() - t } };
    })());
  } const t = Date.now(); const r = buscarEn(c.consulta, c.filtros, c.k ?? 20); await espera(90 + Math.random() * 120); return json({ resultados: r, intencion: 'conceptual', ms: Date.now() - t + 40 }, 0); });
ruta('POST', '/busqueda/similares', (_m, c) => {
  const [doc, orden] = String(c.fragmento ?? '').replace(/^f-/, '').split(/-(\d+)-\d+$/);
  const d = doc ? docs.get(doc) : undefined;
  const base = d ? textoDe(d, Number(orden)).split('\n\n').filter((p) => !p.startsWith('#'))[0] ?? '' : String(c.texto ?? '');
  return json({ resultados: buscarEn(base, c.filtros, 10).filter((r) => r.fragmento.id !== c.fragmento), ms: 140 });
});
ruta('POST', '/busqueda/responder', (_m, c) => sse(responder(c)));

ruta('POST', '/citas/autocita', async (_m, c) => { const det = autocitar(c.texto ?? '', c.estilo ?? 'apa'); autocitas.set(det.id, det); await espera(500); return json({ tarea: `t-${det.id}`, autocita: det.id }, 0); });
ruta('GET', '/citas/autocita/:id', (m) => json(autocitas.get(m[1]!)));
ruta('PATCH', '/citas/autocita/:id', (m, c) => { const det = autocitas.get(m[1]!)!; for (const x of c.decisiones) { const p = det.propuestas.find((y) => y.id === x.propuesta); if (p) p.decision = x.decision; } return json(det); });
ruta('GET', '/citas/autocita/:id/exportar', async (m, _c, q) => {
  const det = autocitas.get(m[1]!)!;
  const formato = q.get('formato') ?? 'md';
  const parrafos = det.parrafos.map((p, i) => {
    const citas = det.propuestas.filter((x) => x.parrafo === i && x.decision === 'aceptada').sort((a, b) => b.hasta - a.hasta);
    let t = p;
    for (const c of citas) t = `${t.slice(0, c.hasta)} ${c.textoCita}${t.slice(c.hasta)}`;
    return t;
  });
  const cuerpo = `${parrafos.join('\n\n')}\n\n${formato === 'md' ? '## Bibliografía' : 'Bibliografía'}\n\n${det.bibliografia.join('\n\n')}\n`;
  await espera(300);
  return new Response(new Blob([cuerpo], { type: 'text/markdown' }));
});
ruta('GET', '/citas/estilos', (_m, _c, q) => { const n = normalizar(q.get('q') ?? ''); return json(ESTILOS.filter((e) => normalizar(e.titulo).includes(n))); });
ruta('POST', '/citas/extraer-texto', () => json({ texto: '', parrafos: [] }));
ruta('POST', '/citas/subir', (_m, _c, q) => json({ clave: `u/yo/citas/${Date.now()}`, nombre: q.get('nombre') ?? 'texto.docx', caduca: hace(-60 * 24 * 7), texto: 'En la demostración no se lee el DOCX: pega el texto.', parrafos: ['En la demostración no se lee el DOCX: pega el texto.'] }));
ruta('POST', '/documentos/:id/reintentar', (m) => { const d = docs.get(m[1]!); if (d) { d.estado = 'procesando'; d.tarea = `tarea-${d.id}`; simularIngesta(d.id, d.tarea, d.unidades || 10, 1.4); } return json({ documento: m[1], tarea: `tarea-${m[1]}` }); });
ruta('GET', '/bibliotecas/:id/miembros', (m) => json([{ usuario: 'yo', correo: 'jl@joseluissaorin.com', permiso: 'propietario', pendiente: false, desde: hace(60 * 24 * 30) }, ...(m[1] === 'b-clases' ? [{ usuario: 'u-lectura', correo: 'grupo-de-lectura@example.org', permiso: 'edicion', pendiente: false, desde: hace(60 * 24 * 5) }] : [])]));
ruta('POST', '/bibliotecas/:id/compartir', (_m, c) => json({ correo: c.correo, permiso: c.permiso, pendiente: true, desde: ahora() }));

ruta('GET', '/historial', () => json({ elementos: historial.filter((h) => !h.oculto), total: historial.length }));
ruta('POST', '/historial/:id/fijar', (m, c) => { const h = historial.find((x) => x.id === m[1]); if (h) h.fijado = c.fijado; return ok(); });
ruta('DELETE', '/historial/:id', (m) => { const i = historial.findIndex((x) => x.id === m[1]); if (i >= 0) historial.splice(i, 1); return ok(); });

ruta('GET', '/cuadernos', () => json(cuadernos.map((c) => ({ ...c, tarjetas: tarjetas.get(c.id)?.length ?? 0 }))));
ruta('POST', '/cuadernos', (_m, c) => { const n: Cuaderno = { id: `c-${Date.now()}`, titulo: c.titulo, cuerpo: '', tarjetas: 0, creado: ahora(), actualizado: ahora() }; cuadernos.unshift(n); tarjetas.set(n.id, []); return json(n); });
ruta('GET', '/cuadernos/:id/tarjetas', (m) => json(tarjetas.get(m[1]!) ?? []));
ruta('POST', '/cuadernos/:id/tarjetas', (m, c) => {
  const lista = tarjetas.get(m[1]!) ?? [];
  let cita: Tarjeta['cita'];
  if (c.objetivo && c.documento) {
    const d = docs.get(c.documento)!; const orden = Number(String(c.objetivo).split('-').at(-2));
    const a = anclaDe(d, orden);
    cita = { texto: (c.contenido?.texto as string) ?? textoDe(d, orden).split('\n\n')[0]!, etiqueta: anclaACita(a), citaCorta: citaCorta(d.meta, a) };
  }
  const t: Tarjeta = { id: `t-${Date.now()}`, tipo: c.tipo, documento: c.documento, objetivo: c.objetivo, contenido: c.contenido ?? {}, ...(cita ? { cita } : {}), posicion: lista.length, huerfana: false, creada: ahora() };
  lista.push(t); tarjetas.set(m[1]!, lista);
  const cu = cuadernos.find((x) => x.id === m[1]); if (cu) cu.actualizado = ahora();
  return json(t);
});
ruta('DELETE', '/cuadernos/:id/tarjetas/:t', (m) => { tarjetas.set(m[1]!, (tarjetas.get(m[1]!) ?? []).filter((t) => t.id !== m[2])); return ok(); });
ruta('POST', '/cuadernos/:id/sintesis', async (m, c) => {
  const lista = (tarjetas.get(m[1]!) ?? []).filter((t) => t.cita);
  await espera(900);
  const texto = lista.length
    ? `${lista.length === 1 ? 'Este cuaderno reúne un pasaje' : `Este cuaderno reúne ${lista.length} pasajes`}: ${lista.map((t, i) => { const e = extracto(t.cita!.texto); return `${e.quien ? `${e.quien}: ` : ''}«${e.texto}» [${i + 1}]`; }).join('; ')}.`
    : 'Este cuaderno aún no tiene pasajes que sintetizar.';
  return json({ id: `s-${Date.now()}`, cuaderno: m[1], instrucciones: c.instrucciones, texto, citas: lista.map((t, i) => ({ n: i + 1, tarjeta: t.id, etiqueta: t.cita!.etiqueta })), creada: ahora() }, 0);
});

ruta('GET', '/vigilantes', () => json(vigilantes));
ruta('POST', '/vigilantes', (_m, c) => { const v: Vigilante = { id: `v-${Date.now()}`, nombre: c.nombre, consulta: c.consulta, modo: c.modo ?? 'al_ingerir', alertas: c.alertas ?? true, pendientes: 0, creado: ahora(), actualizado: ahora() }; vigilantes.unshift(v); return json(v); });
ruta('PATCH', '/vigilantes/:id', (m, c) => { const v = vigilantes.find((x) => x.id === m[1])!; Object.assign(v, c, { actualizado: ahora() }); return json(v); });
ruta('DELETE', '/vigilantes/:id', (m) => { const i = vigilantes.findIndex((x) => x.id === m[1]); if (i >= 0) vigilantes.splice(i, 1); return ok(); });
ruta('POST', '/vigilantes/:id/ejecutar', async (m) => { const v = vigilantes.find((x) => x.id === m[1])!; v.ultimaEjecucion = ahora(); await espera(700); return json({ nada: true }, 0); });
ruta('GET', '/alertas', () => json(alertas));
ruta('POST', '/alertas/:id/visto', (m) => { const a = alertas.find((x) => x.id === m[1]); if (a) { a.vista = ahora(); const v = vigilantes.find((x) => x.id === a.vigilante); if (v) v.pendientes = Math.max(0, v.pendientes - 1); } return ok(); });

ruta('GET', '/conceptos', () => json(conceptos));
ruta('POST', '/conceptos', (_m, c) => { const k: Concepto = { id: `k-${Date.now()}`, nombre: c.nombre, terminos: c.terminos ?? [], creado: ahora(), actualizado: ahora() }; conceptos.push(k); return json(k); });
ruta('GET', '/mapa', () => json(mapa()));
ruta('GET', '/mapa/grupos/:i', (m) => {
  const g = mapa().grupos[Number(m[1])]!;
  const res = buscarEn(g.etiqueta ?? '', { documentos: g.documentosPrincipales }, 6);
  // Si la etiqueta no está en la lengua del texto (Bentham, Boecio), van los primeros pasajes.
  const miembros = res.length
    ? res.map((r) => ({ documento: r.documento.id, titulo: r.documento.metadatos.titulo, objetivo: 'fragmento', id: r.fragmento.id, texto: r.fragmento.texto, etiqueta: r.etiqueta }))
    : (g.documentosPrincipales ?? []).flatMap((id) => { const d = docs.get(id)!; return [1, 2, 3].map((o) => ({ documento: id, titulo: d.meta.titulo, objetivo: 'fragmento', id: `f-${id}-${o}-0`, texto: parrafoDe(d, o), etiqueta: anclaACita(anclaDe(d, o)) })); }).slice(0, 6);
  return json({ indice: g.indice, miembros } satisfies MiembrosGrupo);
});
ruta('POST', '/mapa/construir', () => sse((async function* () {
  const fases = ['Reuniendo pasajes', 'Reduciendo dimensiones', 'Agrupando', 'Poniendo nombre a los temas'];
  for (const [i, f] of fases.entries()) { await espera(450); yield { fase: f, avance: (i + 1) / fases.length, mensaje: `${f}…` }; }
  yield { fin: { ...mapa().meta, construido: ahora() } };
})()));
ruta('POST', '/conceptos/:id/ejecutar', (m) => json({ informe: `i-${Date.now()}`, tarea: `t-${m[1]}` }));
ruta('POST', '/busqueda/multilingue', async (_m, c: Buscar) => { await espera(300); return json({ resultados: buscarEn(c.consulta, c.filtros, c.k ?? 20), ms: 380, traducciones: [{ idioma: 'en', consulta: c.consulta }, { idioma: 'fr', consulta: c.consulta }] }, 0); });
ruta('POST', '/privacidad/purgar', () => json({ borrados: { documentos: docs.size, historial: historial.length } }));
ruta('POST', '/auth/borrar', () => ok());
ruta('GET', '/grafo', () => json(grafo()));
ruta('POST', '/grafo/reconstruir', async () => { await espera(600); return json({ nodos: 0, aristas: 0, ms: 600 }, 0); });

// --- Entidades (personas, lugares y obras): un grafo pequeño escrito a mano --
// Cada contexto es un trozo literal del pasaje de esa unidad, con la mención entre ⟦⟧.
// Los identificadores de Wikidata se han comprobado uno a uno.
type EntDemo = { id: string; nombre: string; tipo: TipoEntidad; descripcion?: string; wikidata?: string; alias?: string[]; en: Array<[string, number, string]> };
const ENTIDADES_DEMO: EntDemo[] = [
  { id: 'e-cervantes', nombre: 'Miguel de Cervantes', tipo: 'persona', descripcion: 'novelista español (1547-1616)', wikidata: 'Q5682', alias: ['Miguel de Ceruantes', 'Ceruantes'], en: [['d-quijote', 1, 'Compueſto por ⟦Miguel de Ceruantes⟧'], ['d-quijote', 2, 'compueſto por ⟦Miguel de Ceruantes⟧ Saauedra: taſſarõ cada pliego del dicho libro']] },
  { id: 'e-cuesta', nombre: 'Juan de la Cuesta', tipo: 'persona', descripcion: 'impresor madrileño del Siglo de Oro', wikidata: 'Q3187850', alias: ['Iuan de la Cueſta'], en: [['d-quijote', 1, 'EN MADRID, Por ⟦Iuan de la Cueſta⟧.']] },
  { id: 'e-bejar', nombre: 'Duque de Béjar', tipo: 'persona', descripcion: 'destinatario de la dedicatoria de la primera parte del Quijote', alias: ['DVQVE DE BEIAR'], en: [['d-quijote', 1, 'DIRIGIDO AL ⟦DVQVE DE BEIAR⟧']] },
  { id: 'e-dulcinea', nombre: 'Dulcinea del Toboso', tipo: 'persona', descripcion: 'personaje del Quijote', alias: ['Dulcinea del Toboſo', 'Dulcinea'], en: [['d-quijote', 18, 'vino a llamarla ⟦Dulcinea del Toboſo⟧'], ['d-quijote', 20, 'O Princeſa ⟦Dulcinea⟧, ſeñora deſte cautiuo cora']] },
  { id: 'e-rocinante', nombre: 'Rocinante', tipo: 'persona', descripcion: 'el caballo de don Quijote', alias: ['Rozinante'], en: [['d-quijote', 17, 'al fin le vino a llamar ⟦Rozinante⟧'], ['d-quijote', 19, 'ſobio ſobre ⟦Rozinante⟧']] },
  { id: 'e-amadis', nombre: 'Amadís de Gaula', tipo: 'persona', descripcion: 'caballero protagonista del libro de caballerías del mismo nombre', alias: ['Amadis de Gaula', 'Amadis'], en: [['d-quijote', 15, 'Palmerin de Ingalaterra, ò ⟦Amadis de Gaula⟧'], ['d-quijote', 17, 'el valeroſo ⟦Amadis⟧, no ſolo ſe auia contentado']] },
  { id: 'e-montiel', nombre: 'Campo de Montiel', tipo: 'lugar', descripcion: 'comarca de La Mancha', alias: ['campo de Montiel'], en: [['d-quijote', 12, 'del diſtrito del ⟦campo de Montiel⟧'], ['d-quijote', 20, 'el antiguo, y conocido ⟦campo de Montiel⟧']] },
  { id: 'e-horacio', nombre: 'Horacio', tipo: 'persona', descripcion: 'poeta latino (65-8 a. C.)', en: [['d-quijote', 9, 'citar à ⟦Horacio⟧, o a quien lo dixo']] },
  { id: 'e-madrid', nombre: 'Madrid', tipo: 'lugar', wikidata: 'Q2807', alias: ['MADRID'], en: [['d-quijote', 1, 'EN ⟦MADRID⟧, Por Iuan de la Cueſta.'], ['d-larra', 6, 'veo lo que hay que ver en ⟦Madrid⟧'], ['d-larra', 7, 'quince meses de estancia en ⟦Madrid⟧']] },
  { id: 'e-valladolid', nombre: 'Valladolid', tipo: 'lugar', wikidata: 'Q8356', en: [['d-quijote', 2, 'di la preſente en ⟦Valladolid⟧, a veynte dias del mes de']] },
  { id: 'e-paris', nombre: 'París', tipo: 'lugar', wikidata: 'Q90', alias: ['Paris'], en: [['d-larra', 4, 'proyectos vastos concebidos en ⟦Paris⟧ de invertir aquí sus cuantiosos caudales']] },
  { id: 'e-sans-delai', nombre: 'Monsieur Sans-délai', tipo: 'persona', descripcion: 'personaje de «Vuelva usted mañana»', alias: ['Sans-délai'], en: [['d-larra', 7, 'Al llegar aquí monsieur ⟦Sans-délai⟧, traté de reprimir una carcajada']] },
  { id: 'e-polonia', nombre: 'Polonia', tipo: 'lugar', wikidata: 'Q36', en: [['d-vida-sueno', 1, 'Mal, ⟦Polonia⟧, recibes']] },
  { id: 'e-clotaldo', nombre: 'Clotaldo', tipo: 'persona', descripcion: 'personaje de «La vida es sueño», alcaide de la torre', en: [['d-vida-sueno', 8, '¿Es ⟦Clotaldo⟧?'], ['d-vida-sueno', 13, 'Este es ⟦Clotaldo⟧, mi alcaide.']] },
  { id: 'e-carcel', nombre: 'Cárcel', tipo: 'concepto', descripcion: 'la prisión, en castellano y en inglés', alias: ['carcel', 'cárcel', 'prision', 'prisons'], en: [['d-quijote', 5, 'bien como quien ſe engendrô en vna ⟦carcel⟧'], ['d-vida-sueno', 5, 'Una ⟦prision⟧ oscura,'], ['d-vida-sueno', 13, 'Que han quebrantado la ⟦cárcel⟧...'], ['d-panoptico', 3, 'the purposes of perpetual ⟦prisons⟧ in the room of death']] },
  { id: 'e-lazaro', nombre: 'Lázaro', tipo: 'persona', descripcion: 'personaje del Evangelio de Juan, resucitado por Jesús', en: [['d-rimas', 3, 'Y una voz, como ⟦Lázaro⟧, espera']] },
  { id: 'e-socrates', nombre: 'Sócrates', tipo: 'persona', descripcion: 'filósofo griego (c. 470-399 a. C.)', alias: ['Socrates', 'Socratis'], en: [['d-consolatio', 7, 'praeceptor eius ⟦Socrates⟧ iniustae uictoriam mortis'], ['d-consolatio', 8, 'nec ⟦Socratis⟧ uenenum']] },
  { id: 'e-platon', nombre: 'Platón', tipo: 'persona', descripcion: 'filósofo griego (c. 427-347 a. C.)', alias: ['Platonis'], en: [['d-consolatio', 7, 'ante nostri ⟦Platonis⟧ aetatem'], ['d-consolatio', 10, 'hanc sententiam ⟦Platonis⟧ ore sanxisti']] },
  { id: 'e-golfin', nombre: 'Teodoro Golfín', tipo: 'persona', descripcion: 'personaje de «Marianela»', alias: ['Golfín'], en: [['d-marianela', 4, 'Aquí tienes, ⟦Teodoro Golfín⟧, el resultado de tu']] },
  { id: 'e-socartes', nombre: 'Socartes', tipo: 'lugar', descripcion: 'las minas imaginarias de «Marianela»', en: [['d-marianela', 3, 'he de llegar a las famosas minas de ⟦Socartes⟧']] },
  { id: 'e-houston', nombre: 'Houston', tipo: 'lugar', wikidata: 'Q16555', en: [['d-rice', 4, 'this city of ⟦Houston⟧, this state of Texas']] },
  { id: 'e-rice', nombre: 'Universidad Rice', tipo: 'organizacion', wikidata: 'Q842909', alias: ['Rice'], en: [['d-rice', 9, 'Why does ⟦Rice⟧ play Texas?'], ['d-rice', 12, 'Technical institutions, such as ⟦Rice⟧, will reap the harvest of these gains.']] },
  { id: 'e-bradford', nombre: 'William Bradford', tipo: 'persona', descripcion: 'gobernador de la colonia de Plymouth (1590-1657)', en: [['d-rice', 4, '⟦William Bradford⟧, speaking in 1630 of the founding of the']] },
  { id: 'e-mallory', nombre: 'George Mallory', tipo: 'persona', descripcion: 'alpinista británico (1886-1924), murió en el Everest', en: [['d-rice', 16, 'the great British explorer ⟦George Mallory⟧, who was to die on Mount Everest']] },
  { id: 'e-wallace', nombre: 'Alfred Russel Wallace', tipo: 'persona', descripcion: 'naturalista británico (1823-1913)', alias: ['Mr. Wallace'], en: [['d-origen', 3, 'as ⟦Mr. Wallace⟧, who is now studying the natural history of the Malay archipelago']] },
  { id: 'e-lyell', nombre: 'Charles Lyell', tipo: 'persona', descripcion: 'geólogo británico (1797-1875)', alias: ['Sir Charles Lyell'], en: [['d-origen', 3, 'forward it to ⟦Sir Charles Lyell⟧, who sent it to the Linnean Society']] },
];
const CO_DEMO: Array<[string, string, number, string?]> = [
  ['e-cervantes', 'e-cuesta', 4.6, 'Juan de la Cuesta imprimió la edición de 1608'], ['e-cervantes', 'e-bejar', 3.8, 'Cervantes dedica el libro al duque de Béjar'],
  ['e-cuesta', 'e-madrid', 2.4, 'La edición de 1608 se imprimió en Madrid'], ['e-cervantes', 'e-valladolid', 1.6, 'La tasa del libro se firmó en Valladolid'],
  ['e-dulcinea', 'e-rocinante', 2.2], ['e-rocinante', 'e-montiel', 1.4], ['e-amadis', 'e-rocinante', 1.2], ['e-cervantes', 'e-horacio', 0.8],
  ['e-cervantes', 'e-carcel', 1.1, 'El prólogo compara el libro con un hijo engendrado en una cárcel'],
  ['e-madrid', 'e-paris', 1.3], ['e-madrid', 'e-sans-delai', 2.6], ['e-paris', 'e-sans-delai', 1.9],
  ['e-clotaldo', 'e-polonia', 1.2], ['e-clotaldo', 'e-carcel', 2.8, 'Clotaldo es el alcaide de la torre que sirve de cárcel'],
  ['e-socrates', 'e-platon', 3.1, 'Sócrates fue maestro de Platón'], ['e-golfin', 'e-socartes', 3.3, 'Teodoro Golfín busca las minas de Socartes'],
  ['e-houston', 'e-rice', 2.7], ['e-bradford', 'e-houston', 0.9], ['e-mallory', 'e-rice', 0.7],
  ['e-wallace', 'e-lyell', 2.9, 'La memoria de Wallace llegó a la Sociedad Linneana a través de Lyell'],
];
function entidadDemo(e: EntDemo): Entidad {
  return { id: e.id, nombre: e.nombre, tipo: e.tipo, alias: e.alias ?? [], ...(e.descripcion ? { descripcion: e.descripcion } : {}), ...(e.wikidata ? { wikidata: e.wikidata } : {}), menciones: e.en.length, documentos: new Set(e.en.map((x) => x[0])).size };
}
function mencionDemo(e: EntDemo, [doc, orden, contexto]: [string, number, string], i: number): MencionEntidad {
  const d = docs.get(doc)!;
  const ancla = anclaDe(d, Math.min(orden, d.unidades));
  return { id: `${e.id}-m${i}`, documento: doc, fragmento: `${doc}-f${orden}`, unidad: orden - 1, ancla, etiqueta: anclaACita(ancla), texto: contexto.match(/⟦(.+?)⟧/)?.[1] ?? e.nombre, contexto };
}
const vecinosDemo = (id: string) => CO_DEMO.filter(([a, b]) => a === id || b === id).map(([a, b, peso, relacion]) => ({ otro: a === id ? b : a, peso, relacion }));
const entPorId = (id: string) => ENTIDADES_DEMO.find((e) => e.id === id);
ruta('GET', '/entidades', (_m, _c, q) => {
  const n = normalizar(q.get('q') ?? ''); const tipo = q.get('tipo');
  const lista = ENTIDADES_DEMO.filter((e) => (!tipo || e.tipo === tipo) && (!n || normalizar([e.nombre, ...(e.alias ?? [])].join(' ')).includes(n))).map(entidadDemo).sort((a, b) => b.documentos - a.documentos);
  return json({ elementos: lista, total: lista.length });
});
ruta('GET', '/entidades/estado', () => json({ documentos: [], entidades: ENTIDADES_DEMO.length, menciones: ENTIDADES_DEMO.reduce((s, e) => s + e.en.length, 0), aristas: CO_DEMO.length }));
ruta('POST', '/entidades/reanudar', () => json({ reanudados: [] }));
ruta('GET', '/entidades/camino', (_m, _c, q) => {
  const desde = q.get('desde') ?? '', hasta = q.get('hasta') ?? '';
  const previo = new Map<string, string | null>([[desde, null]]); const cola = [desde];
  while (cola.length && !previo.has(hasta)) { const x = cola.shift()!; for (const v of vecinosDemo(x)) if (!previo.has(v.otro)) { previo.set(v.otro, x); cola.push(v.otro); } }
  if (!previo.has(hasta)) return json({ pasos: [] });
  const lista: string[] = []; for (let x: string | null = hasta; x; x = previo.get(x) ?? null) lista.unshift(x);
  return json({ pasos: lista.map((id, i) => {
    const e = entPorId(id)!; if (!i) return { entidad: entidadDemo(e) };
    const v = vecinosDemo(lista[i - 1]!).find((x) => x.otro === id)!; const m = mencionDemo(e, e.en[0]!, 0);
    return { entidad: entidadDemo(e), via: { peso: v.peso, ...(v.relacion ? { relacion: v.relacion } : {}), documento: m.documento, titulo: docs.get(m.documento)!.meta.titulo, fragmento: m.fragmento, ancla: m.ancla, etiqueta: m.etiqueta, contexto: m.contexto } };
  }) });
});
ruta('GET', '/entidades/documentos/:documento/lector', (m) => {
  const es = ENTIDADES_DEMO.filter((e) => e.en.some((x) => x[0] === m[1]));
  return json({ documento: m[1], entidades: Object.fromEntries(es.map((e) => { const x = entidadDemo(e); return [e.id, { nombre: x.nombre, tipo: x.tipo, documentos: x.documentos, menciones: x.menciones, ...(x.descripcion ? { descripcion: x.descripcion } : {}) }]; })),
    formas: es.flatMap((e) => [e.nombre, ...(e.alias ?? [])].map((texto) => ({ texto, entidad: e.id, unidades: e.en.filter((x) => x[0] === m[1]).map((x) => x[1] - 1) }))) });
});
ruta('GET', '/entidades/documentos/:documento', (m) => json({ documento: m[1], entidades: ENTIDADES_DEMO.filter((e) => e.en.some((x) => x[0] === m[1])).map((e) => ({ ...entidadDemo(e), aqui: e.en.filter((x) => x[0] === m[1]).length })) }));
ruta('GET', '/entidades/:id', (m) => {
  const e = entPorId(m[1]!); if (!e) return error(404, 'no_encontrado', 'No existe esa entidad.');
  const porDoc = [...new Set(e.en.map((x) => x[0]))].map((doc) => { const d = docs.get(doc)!; const ms = e.en.filter((x) => x[0] === doc).map((x, i) => mencionDemo(e, x, i));
    return { documento: doc, titulo: d.meta.titulo, autores: autoresCorto(d.meta), ...(d.meta.anio ? { anio: d.meta.anio } : {}), tipo: d.tipo, total: ms.length, menciones: ms }; });
  return json({ ...entidadDemo(e), porDocumento: porDoc, vecinos: vecinosDemo(e.id).map((v) => ({ entidad: entidadDemo(entPorId(v.otro)!), peso: v.peso, documentos: 1, ...(v.relacion ? { relacion: v.relacion } : {}) })) });
});
ruta('GET', '/entidades/:id/vecinos', (m) => {
  const ids = new Set([m[1]!, ...vecinosDemo(m[1]!).map((v) => v.otro)]);
  return json({ centro: m[1], nodos: [...ids].map((id) => entidadDemo(entPorId(id)!)), aristas: CO_DEMO.filter(([a, b]) => ids.has(a) && ids.has(b)).map(([desde, hacia, peso, relacion]) => ({ desde, hacia, peso, ...(relacion ? { relacion } : {}) })) });
});
ruta('GET', '/entidades/:id/linea', (m) => {
  const e = entPorId(m[1]!); if (!e) return error(404, 'no_encontrado', 'No existe esa entidad.');
  return json({ entidad: entidadDemo(e), elementos: e.en.map((x, i) => { const mm = mencionDemo(e, x, i); const d = docs.get(x[0])!; const anio = d.meta.anioOriginal ?? d.meta.anio;
    return { ...(anio ? { anio } : {}), documento: mm.documento, titulo: d.meta.titulo, fragmento: mm.fragmento, ancla: mm.ancla, etiqueta: mm.etiqueta, contexto: mm.contexto }; }).sort((a, b) => (a.anio ?? 1e9) - (b.anio ?? 1e9)) });
});

// Lo que las obras de la demo citan o mencionan de verdad y no está en la biblioteca.
ruta('GET', '/grafo/huerfanas', () => json([
  { referencia: 'Horacio. Odas, I, 4.', citadaPor: ['d-quijote'] },
  { referencia: 'Wallace, A. R. (1858). On the Tendency of Varieties to Depart Indefinitely from the Original Type. Journal of the Proceedings of the Linnean Society, 3.', anio: 1858, citadaPor: ['d-origen'] },
  { referencia: 'Bradford, W. Of Plymouth Plantation.', citadaPor: ['d-rice'] },
]));
ruta('GET', '/perspectivas/arqueologia', () => json({ olvidados: [
  { documento: 'd-consolatio', titulo: 'De philosophiae consolatione', ultimaApertura: hace(60 * 24 * 96), motivo: 'No lo abres desde junio, y tus búsquedas sobre la cárcel lo rozan: Boecio lo escribió preso, a la espera de su ejecución.' },
  { documento: 'd-marianela', titulo: 'Marianela', ultimaApertura: hace(60 * 24 * 64), motivo: 'Lo subiste en agosto y no has pasado del primer capítulo.' },
] }));
ruta('GET', '/perspectivas/huecos', () => json([
  { tema: 'Foucault y el panoptismo', consultas: 5, resultadosMedios: 0.4, sugerencia: 'Ninguno de tus documentos lo trata: «Vigilar y castigar» (1975) no es de dominio público, tendrías que subir tu ejemplar.' },
  { tema: 'Segismundo fuera de la torre', consultas: 3, resultadosMedios: 1.2, sugerencia: 'Solo tienes la transcripción de la primera jornada de «La vida es sueño».' },
]));
ruta('GET', '/perspectivas/recomendaciones', () => json([
  { titulo: 'Boecio, «De philosophiae consolatione», libros II a V', motivo: 'Tienes solo el libro I; en el II, Filosofía habla por boca de la Fortuna.' },
  { titulo: 'Pedro Calderón de la Barca, «La vida es sueño», jornadas segunda y tercera', motivo: 'Están en la misma grabación de LibriVox y completarían tu transcripción.' },
  { titulo: 'Miguel de Cervantes, «Segunda parte del ingenioso caballero don Quijote de la Mancha» (1615)', motivo: 'De la primera parte tienes los preliminares y los dos primeros capítulos.' },
]));
ruta('POST', '/perspectivas/abierto', () => ok());
ruta('GET', '/corpus/kpis', () => json(corpus()));
ruta('GET', '/corpus/instantanea', () => json(corpus()));
ruta('POST', '/corpus/instantanea/refrescar', () => json(corpus(), 600));

ruta('GET', '/claves', () => json(claves.filter((k) => !k.revocada)));
ruta('POST', '/claves', (_m, c) => { const id = `k-${Date.now()}`; const secreto = `sk_sch_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 18)}`; const k: ClaveApi = { id, nombre: c.nombre, prefijo: secreto.slice(0, 11), alcances: c.alcances ?? ['lectura'], creada: ahora() }; claves.unshift(k); return json({ ...k, secreto }); });
ruta('DELETE', '/claves/:id', (m) => { const k = claves.find((x) => x.id === m[1]); if (k) k.revocada = ahora(); return ok(); });
ruta('POST', '/claves/:id/restaurar', (m) => { const k = claves.find((x) => x.id === m[1]); if (k) delete k.revocada; return ok(); });
ruta('GET', '/ajustes', () => json(ajustes));
ruta('PATCH', '/ajustes', (_m, c) => { Object.assign(ajustes.preferencias, c); return json(ajustes); });
ruta('PUT', '/ajustes/claves/:p', (m, c) => { ajustes.claves = [...ajustes.claves.filter((k) => k.proveedor !== m[1]), { proveedor: m[1] as 'gemini', final: String(c.clave).slice(-4), guardada: ahora() }]; return json(ajustes); });
ruta('DELETE', '/ajustes/claves/:p', (m) => { ajustes.claves = ajustes.claves.filter((k) => k.proveedor !== m[1]); return json(ajustes); });
ruta('GET', '/privacidad/grabacion', () => json(grabacion));
ruta('POST', '/privacidad/grabacion', (_m, c) => { grabacion = { activa: c.activa, desde: ahora() }; return json(grabacion); });
ruta('GET', '/privacidad/exportar', async () => { await espera(500); return new Response(new Blob([JSON.stringify({ documentos: [...docs.keys()], historial, cuadernos }, null, 2)], { type: 'application/json' })); });
ruta('DELETE', '/privacidad/historial', () => { const n = historial.length; historial.splice(0); return json({ borrados: { historial: n } }); });

ruta('GET', '/tareas', () => json([...tareas.values()].filter((t) => t.estado === 'procesando' || t.estado === 'en_cola')));
ruta('DELETE', '/tareas/:id', (m) => { const t = tareas.get(m[1]!); if (t) t.estado = 'cancelada'; if (t?.documento) { const d = docs.get(t.documento); if (d) d.borrado = true; } return ok(); });

// Subidas: se aceptan sin guardar bytes; la ingesta se simula.
const subidas = new Map<string, { documento: string; nombre: string; tipo: TipoEntrada; bytes: number; mime: string; unidades: number }>();
ruta('POST', '/subidas', (_m, c) => {
  const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, documento = `d-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const tipo: TipoEntrada = c.tipo ?? 'documento';
  subidas.set(id, { documento, nombre: c.nombre, tipo, bytes: c.bytes, mime: c.mime, unidades: c.metadatos?.unidades ?? 0 });
  return json({ subida: id, documento, tipo, original: { modo: 'simple', clave: `simulado/${documento}`, url: 'simulado:' }, prefijo: `u/yo/d/${documento}/` }, 80);
});
ruta('POST', '/subidas/:id/recursos', (_m, c) => json({ recursos: c.recursos.map((r: { ruta: string }) => ({ ruta: r.ruta, clave: r.ruta, subida: { modo: 'simple', clave: r.ruta, url: 'simulado:' } })) }, 30));
ruta('POST', '/subidas/:id/ingestar', (m, c) => {
  const s = subidas.get(m[1]!); if (!s) return error(404, 'no_encontrado', 'Esa subida no existe.');
  const unidades = (c.manifiesto?.unidades as number | undefined) ?? (s.unidades || estimarUnidades(s.tipo, s.bytes));
  const tarea = `tarea-${s.documento}`;
  const titulo = s.nombre.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  docs.set(s.documento, {
    id: s.documento, tipo: s.tipo, unidades, estado: 'procesando', leidas: 0, tarea, ...(s.tipo === 'audio' || s.tipo === 'video' ? { duracion: unidades * 60 } : {}),
    meta: { titulo: titulo.charAt(0).toUpperCase() + titulo.slice(1), autores: [], idioma: 'es' }, secciones: [], pasajes: ['Texto leído de la página en la demostración.', 'Cada fragmento conserva su ancla: página impresa o segundo exacto.'],
    bibliotecas: [], creado: ahora(), bytes: s.bytes, mime: s.mime,
  });
  simularIngesta(s.documento, tarea, unidades, 1.4);
  return json({ documento: s.documento, tarea });
});
ruta('POST', '/subidas/url', (_m, c) => {
  const documento = `d-${Date.now().toString(36)}`, tarea = `tarea-${documento}`;
  const tipo: TipoEntrada = /youtu/.test(c.url) ? 'video' : 'web';
  docs.set(documento, { id: documento, tipo, unidades: tipo === 'web' ? 14 : 30, ...(tipo === 'video' ? { duracion: 1800 } : {}), estado: 'procesando', leidas: 0, tarea, meta: { titulo: c.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60), autores: [], url: c.url }, secciones: [], pasajes: ['Párrafo extraído de la página web.'], bibliotecas: [], creado: ahora(), bytes: 0, mime: 'text/html' });
  simularIngesta(documento, tarea, tipo === 'web' ? 14 : 30, 1.2);
  return json({ documento, tarea });
});
ruta('DELETE', '/subidas/:id', () => ok());
ruta('POST', '/tiempo-real/billete', () => json({ billete: 'demo', url: 'simulado:', caduca: ahora() }));

function estimarUnidades(tipo: TipoEntrada, bytes: number) {
  if (tipo === 'pdf') return Math.max(4, Math.min(600, Math.round(bytes / 90_000)));
  if (tipo === 'pdf_escaneado') return Math.max(4, Math.min(600, Math.round(bytes / 350_000)));
  if (tipo === 'audio' || tipo === 'video') return Math.max(3, Math.min(120, Math.round(bytes / 1_000_000)));
  return Math.max(2, Math.min(60, Math.round(bytes / 20_000)));
}

/** El `fetch` que se le pasa a `crearCliente`. */
export async function fetchSimulado(entrada: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url, location.origin);
  const camino = url.pathname.replace(/^\/api\/v2/, '');
  const metodo = (init.method ?? 'GET').toUpperCase();
  let cuerpo: unknown;
  if (typeof init.body === 'string') { try { cuerpo = JSON.parse(init.body); } catch { cuerpo = init.body; } }
  const aceptar = new Headers(init.headers).get('accept') ?? '';
  if (aceptar.includes('text/event-stream') && cuerpo && typeof cuerpo === 'object') (cuerpo as { __sse?: boolean }).__sse = true;
  for (const [m, re, fn] of rutas) {
    if (m !== metodo) continue;
    const coincide = camino.match(re);
    if (coincide) return fn(coincide, cuerpo ?? {}, url.searchParams);
  }
  return error(404, 'no_encontrado', `Ruta no simulada: ${metodo} ${camino}`);
}

export type { Resultado };
