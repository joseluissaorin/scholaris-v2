/**
 * Un servidor de la API v2 en memoria: un `fetch` que responde las rutas del
 * contrato con el corpus de demostración. La web usa el MISMO cliente tipado de
 * `@scholaris/contrato` contra la API real o contra esto; nada más cambia.
 * Solo se carga cuando no hay API (desarrollo, demostraciones, capturas).
 */
import { anclaACita, type Ancla, type MetadatosDocumento, type Progreso, type Resultado, type TipoEntrada } from '@scholaris/nucleo';
import type {
  Ajustes, Alerta, Biblioteca, Buscar, ClaveApi, ConfigPublica, Cuaderno, DetalleAutocita, DetalleDocumento, EventoBusqueda,
  EventoRespuesta, EventoTiempoReal, GrafoCitas, InstantaneaCorpus, MapaConceptos, PropuestaCita, ResultadoVista, ResumenDocumento,
  SeccionVista, Tarea, Tarjeta, UnidadVista, Vigilante, Concepto, Yo, EstiloCsl, MiembrosGrupo, Responder,
} from '@scholaris/contrato';
import { anclaDe, BIBLIOTECAS, DOCUMENTOS, textoDe, type DocDemo } from './corpus';

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
  { id: 'c-panoptico', titulo: 'Panóptico y plataformas', cuerpo: '', tarjetas: 4, creado: hace(60 * 24 * 9), actualizado: hace(60 * 5) },
  { id: 'c-duelo', titulo: 'Escritura abyecta del duelo', cuerpo: '', tarjetas: 3, creado: hace(60 * 24 * 30), actualizado: hace(60 * 26) },
];
const tarjetas = new Map<string, Tarjeta[]>();
const tarjeta = (cuaderno: string, i: number, doc: string, orden: number, extra: Partial<Tarjeta> = {}): Tarjeta => {
  const d = docs.get(doc)!;
  const ancla = anclaDe(d, orden);
  const texto = d.fijos[orden] ?? textoDe(d, orden).split('\n\n')[0]!;
  return { id: `t-${cuaderno}-${i}`, tipo: 'fragmento', documento: doc, objetivo: `f-${doc}-${orden}-0`, contenido: {}, cita: { texto, etiqueta: anclaACita(ancla), citaCorta: citaCorta(d.meta, ancla) }, posicion: i, huerfana: false, creada: hace(60 * (40 - i)), ...extra };
};
tarjetas.set('c-panoptico', [
  tarjeta('c-panoptico', 0, 'd-foucault', 207), tarjeta('c-panoptico', 1, 'd-foucault', 208),
  { id: 't-c-panoptico-n', tipo: 'nota', contenido: { texto: 'Contrastar con la «vigilancia de plataforma»: ¿se interioriza igual la mirada cuando nadie mira?' }, posicion: 2, huerfana: false, creada: hace(300) },
  tarjeta('c-panoptico', 3, 'd-web', 10),
]);
tarjetas.set('c-duelo', [tarjeta('c-duelo', 0, 'd-kristeva', 9), tarjeta('c-duelo', 1, 'd-llanos', 13), tarjeta('c-duelo', 2, 'd-clase', 13)]);

const vigilantes: Vigilante[] = [
  { id: 'v-1', nombre: 'Abyección y archivo', consulta: 'abyección en cartas y archivos personales', modo: 'al_ingerir', alertas: true, pendientes: 2, ultimaEjecucion: hace(90), ultimaConfianza: 'alta', creado: hace(60 * 24 * 20), actualizado: hace(90) },
  { id: 'v-2', nombre: 'Vigilancia sin torre', consulta: 'panóptico y plataformas digitales', modo: 'semanal', alertas: true, pendientes: 0, ultimaEjecucion: hace(60 * 24 * 3), ultimaConfianza: 'media', creado: hace(60 * 24 * 40), actualizado: hace(60 * 24 * 3) },
  { id: 'v-3', nombre: 'Machado cantado', consulta: 'poesía de Machado musicada', modo: 'manual', alertas: false, pendientes: 0, creado: hace(60 * 24 * 2), actualizado: hace(60 * 24 * 2) },
];
const alertas: Alerta[] = [
  { id: 'a-1', vigilante: 'v-1', nombreVigilante: 'Abyección y archivo', documentosNuevos: ['d-clase'], cambio: 'La sesión 7 de Teoría de la Literatura define lo abyecto como crisis del límite entre dentro y fuera (12:00).', disparadaPor: 'ingesta', creada: hace(90) },
  { id: 'a-2', vigilante: 'v-1', nombreVigilante: 'Abyección y archivo', documentosNuevos: ['d-cartas'], cambio: 'El inventario de cartas añade dos cartas sin enviar de 1936.', disparadaPor: 'ingesta', creada: hace(60 * 30) },
];

const historial: EventoBusqueda[] = [
  ['¿qué efecto produce el panóptico en el detenido?', 'respuesta', 'conceptual', 6, 'alta', 1200, true],
  ['abyección cadáver', 'busqueda', 'literal', 14, undefined, 140, false],
  ['Machado música Serrat', 'busqueda', 'conceptual', 9, undefined, 180, false],
  ['rizoma frente a árbol', 'respuesta', 'conceptual', 7, 'media', 1900, false],
  ['cartas sin enviar 1936', 'busqueda', 'factual', 4, undefined, 95, true],
  ['Sísifo dichoso', 'busqueda', 'literal', 2, undefined, 70, false],
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
  { id: 'k-abyeccion', nombre: 'Abyección', descripcion: 'Usos del concepto de Kristeva en el corpus.', terminos: ['abyecto', 'abyección', 'abject'], ultimoInforme: 'i-1', creado: hace(60 * 24 * 14), actualizado: hace(60 * 24) },
  { id: 'k-vigilancia', nombre: 'Vigilancia', terminos: ['vigilar', 'panóptico', 'mirada'], creado: hace(60 * 24 * 40), actualizado: hace(60 * 24 * 6) },
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
      emitir({ tipo: 'unidades', tarea, documento, desde, hasta: leidas });
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
        t.estado = 'listo'; t.terminada = ahora();
        emitir({ tipo: 'fin', tarea, documento, estado: 'listo' });
      }
    }, (i + 1) * 420 / rapido));
  };
  setTimeout(tick, 300);
}

// Un libro ya procesándose al abrir la demo: así se ve la ingesta en vivo.
{
  const id = 'd-sexualidad';
  docs.set(id, {
    id, tipo: 'pdf_escaneado', unidades: 212, romanas: 0, sinFolio: 4, estado: 'procesando', leidas: 0, tarea: 'tarea-sexualidad',
    meta: { titulo: 'Historia de la sexualidad 1', subtitulo: 'La voluntad de saber', autores: [{ nombre: 'Michel', apellidos: 'Foucault' }], anio: 2005, anioOriginal: 1976, editorial: 'Siglo XXI', idioma: 'es', tipoCSL: 'book' },
    secciones: [{ titulo: 'I. Nosotros, los victorianos', nivel: 1, unidad: 5 }, { titulo: 'II. La hipótesis represiva', nivel: 1, unidad: 15 }, { titulo: 'IV. El dispositivo de sexualidad', nivel: 1, unidad: 79 }],
    banco: ['Lejos de silenciar el sexo, la modernidad lo ha puesto a hablar sin descanso.', 'El dispositivo de sexualidad no reprime: incita, multiplica, clasifica.', 'Donde hay poder hay resistencia, y esta nunca está en posición de exterioridad.'],
    fijos: {}, bibliotecas: [], creado: ahora(), bytes: 72_000_000, mime: 'application/pdf',
  });
  simularIngesta(id, 'tarea-sexualidad', 212, 0.5);
}

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
    cuentas: { fragmentos: d.unidades * 3, secciones: d.secciones.length, figuras: Math.floor(d.unidades / 40) },
    ...(d.tarea ? { tarea: d.tarea } : {}),
  };
}

function unidad(d: DocDemo, orden: number): UnidadVista {
  const ancla = anclaDe(d, orden);
  return { id: `u-${d.id}-${orden}`, orden, ancla, etiqueta: anclaACita(ancla), texto: textoDe(d, orden), lector: d.tipo === 'pdf' ? 'capa-de-texto' : d.tipo === 'audio' || d.tipo === 'video' ? 'whisper-large-v3-turbo' : 'gemini-flash', confianza: 0.96 };
}

const normalizar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const VACIAS = new Set('el la los las un una unos unas de del al y o u a en que se no es por con para su sus lo como qué cual cuál mas más pero sin sobre entre hay ha he este esta esto ese esa'.split(' '));

interface Pieza { d: DocDemo; orden: number; parrafo: number; texto: string; norm: string }
let indice: Pieza[] | null = null;
function piezas(): Pieza[] {
  if (indice) return indice;
  indice = [];
  for (const d of docs.values()) {
    if (d.id === 'd-sexualidad') continue;
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
    if (p.d.fijos[p.orden] === p.texto) s *= 1.6;
    const clave = `${p.d.id}-${p.orden}`;
    const prev = vistos.get(clave);
    if (!prev || prev.s < s) vistos.set(clave, { p, s });
  }
  const orden = [...vistos.values()].sort((x, y) => y.s - x.s).slice(0, k);
  const max = orden[0]?.s ?? 1;
  return orden.map(({ p, s }) => {
    const ancla = anclaDe(p.d, p.orden);
    const resaltado = p.texto.replace(/[\p{L}\p{M}]+/gu, (w) => (raices.some((r) => normalizar(w).startsWith(r)) ? `<mark>${w}</mark>` : w));
    const sec = [...p.d.secciones].reverse().find((x) => x.unidad <= p.orden);
    const r: ResultadoVista = {
      fragmento: { id: `f-${p.d.id}-${p.orden}-${p.parrafo}`, documento: p.d.id, unidad: `u-${p.d.id}-${p.orden}`, orden: p.parrafo, texto: p.texto, contexto: `De «${p.d.meta.titulo}»${sec ? `, ${sec.titulo}` : ''}.`, seccion: sec ? [sec.titulo] : [], ancla },
      documento: { id: p.d.id, tipo: p.d.tipo, metadatos: p.d.meta }, puntuacion: s / max, vias: s / max > 0.6 ? ['lexica', 'densa'] : ['densa'], resaltado,
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
  const frases = usados.map((r, i) => {
    const doc = r.documento.metadatos;
    const quien = autoresCorto(doc);
    const plantillas = [
      `Según ${quien}, ${minus(r.fragmento.texto)} [${i + 1}]`,
      `${quien} lo plantea de otro modo: ${minus(r.fragmento.texto)} [${i + 1}]`,
      `En la misma línea, ${minus(r.fragmento.texto)} [${i + 1}]`,
    ];
    return plantillas[i % plantillas.length]!;
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

function minus(t: string) { return t.charAt(0).toLowerCase() + t.slice(1); }

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
    ['Vigilancia y disciplina', 0.28, 0.32, ['d-foucault', 'd-web']], ['Abyección y cuerpo', 0.7, 0.3, ['d-kristeva', 'd-clase']],
    ['Archivo y duelo', 0.62, 0.68, ['d-llanos', 'd-cartas']], ['Rizoma y devenir', 0.22, 0.72, ['d-deleuze']],
    ['Absurdo y lucidez', 0.46, 0.86, ['d-camus']], ['Canción y poema', 0.86, 0.56, ['d-serrat']],
    ['Biblioteca infinita', 0.44, 0.12, ['d-borges']], ['Heterotopías', 0.4, 0.5, ['d-heterotopias', 'd-foucault']],
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

function grafo(): GrafoCitas {
  const nodo = (id: string, citas: number, citadoPor: number) => {
    const d = docs.get(id)!;
    return { documento: id, titulo: d.meta.titulo, autores: autoresCorto(d.meta), anio: d.meta.anioOriginal ?? d.meta.anio, tipo: d.tipo, citas, citadoPor };
  };
  return {
    nodos: [nodo('d-foucault', 0, 3), nodo('d-kristeva', 1, 3), nodo('d-llanos', 2, 1), nodo('d-deleuze', 1, 1), nodo('d-web', 1, 0), nodo('d-clase', 2, 0), nodo('d-heterotopias', 2, 0), nodo('d-borges', 0, 1), nodo('d-camus', 0, 0)],
    aristas: [
      { desde: 'd-web', hacia: 'd-foucault', peso: 6, unidades: [2, 9, 10] }, { desde: 'd-heterotopias', hacia: 'd-foucault', peso: 4 }, { desde: 'd-llanos', hacia: 'd-kristeva', peso: 5 },
      { desde: 'd-clase', hacia: 'd-kristeva', peso: 8 }, { desde: 'd-clase', hacia: 'd-llanos', peso: 3 }, { desde: 'd-deleuze', hacia: 'd-foucault', peso: 2 },
      { desde: 'd-kristeva', hacia: 'd-borges', peso: 1 }, { desde: 'd-heterotopias', hacia: 'd-deleuze', peso: 2 }, { desde: 'd-llanos', hacia: 'd-borges', peso: 1 },
    ],
    construido: hace(60 * 30),
  };
}

function corpus(): InstantaneaCorpus {
  const lista = [...docs.values()].filter((d) => !d.borrado);
  const porTipo: Record<string, number> = {}, porDecada: Record<string, number> = {};
  for (const d of lista) {
    porTipo[d.tipo] = (porTipo[d.tipo] ?? 0) + 1;
    const anio = d.meta.anioOriginal ?? d.meta.anio;
    if (anio) { const k = String(Math.floor(anio / 10) * 10); porDecada[k] = (porDecada[k] ?? 0) + 1; }
  }
  return {
    documentos: lista.length, unidades: lista.reduce((s, d) => s + d.unidades, 0), fragmentos: lista.reduce((s, d) => s + d.unidades * 3, 0), figuras: 41,
    segundosDeMedio: lista.reduce((s, d) => s + (d.duracion ?? 0), 0), bytes: lista.reduce((s, d) => s + d.bytes, 0), refrescado: hace(20),
    porIdioma: { es: lista.length - 2, fr: 1, la: 1 }, porTipo, porAnio: {}, porDecada,
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
  const desde = Math.max(1, Number(q.get('desde') ?? 1)), hasta = Math.min(tope, Number(q.get('hasta') ?? desde + 19));
  const out: UnidadVista[] = [];
  for (let o = desde; o <= hasta; o++) out.push(unidad(d, o));
  return json(out, 70 + Math.random() * 80);
});
ruta('GET', '/documentos/:id/folios', (m) => {
  const d = docs.get(m[1]!); if (!d) return error(404, 'no_encontrado', 'Ese documento no existe.');
  return json({ folios: Array.from({ length: d.unidades }, (_, i) => { const a = anclaDe(d, i + 1); return { orden: i + 1, ...(a.tipo === 'pagina' ? { fisica: a.fisica, impresa: a.impresa, origen: a.origen, confianza: a.confianza } : a.tipo === 'tiempo' ? { impresa: null, t0: a.t0 } : a.tipo === 'seccion' ? { impresa: a.impresa ?? null } : { impresa: null }) }; }) });
});
ruta('GET', '/documentos/:id/secciones', (m) => {
  const d = docs.get(m[1]!); if (!d) return error(404, 'no_encontrado', 'Ese documento no existe.');
  return json(d.secciones.map((s, i): SeccionVista => ({ id: `s-${i}`, nivel: s.nivel, titulo: s.titulo, unidadDesde: s.unidad })));
});
ruta('GET', '/documentos/:id/figuras', (m) => {
  const d = docs.get(m[1]!); if (!d || !['pdf', 'pdf_escaneado'].includes(d.tipo)) return json([]);
  const n = Math.floor(d.unidades / 40);
  return json(Array.from({ length: n }, (_, i) => { const u = 20 + i * 40; const a = anclaDe(d, u); return { id: `fig-${i}`, unidad: u, imagenUrl: '', pie: `Figura ${i + 1}. ${['Plano del panóptico de Bentham', 'Grabado de un suplicio', 'Horario de una escuela mutua', 'Celda individual', 'Esquema de la casa de corrección', 'Patio de la prisión', 'Tabla de clasificación'][i % 7]}`, ancla: a, etiqueta: anclaACita(a) }; }));
});
ruta('GET', '/documentos/:id/original', () => json({ url: '' }));
ruta('GET', '/documentos/:id/cita', (m, _c, q) => {
  const d = docs.get(m[1]!)!; const md = d.meta;
  const aut = md.autores.map((x) => `${x.apellidos}, ${x.nombre}`).join(' y ');
  const estilo = q.get('estilo') ?? 'apa';
  const texto = estilo.startsWith('modern') ? `${aut}. ${md.titulo}. ${md.editorial ?? md.revista ?? ''}, ${md.anio ?? 's. f.'}.` : `${aut} (${md.anio ?? 's. f.'}). ${md.titulo}${md.subtitulo ? `. ${md.subtitulo}` : ''}. ${md.editorial ?? md.revista ?? ''}.`;
  return json({ texto, html: texto });
});

ruta('POST', '/documentos/importar', () => json({ documento: 'd-foucault', versionOrigen: 300, avisos: [] }));

ruta('GET', '/bibliotecas', () => json(bibliotecas.map((b) => ({ ...b, documentos: [...docs.values()].filter((d) => !d.borrado && d.bibliotecas.includes(b.id)).length }))));
ruta('POST', '/bibliotecas', (_m, c) => { const b: Biblioteca = { id: `b-${Date.now()}`, nombre: c.nombre, color: c.color, documentos: 0, creada: ahora(), actualizada: ahora(), propietario: 'yo', permiso: 'propietario', compartida: false }; bibliotecas.push(b); return json(b); });
ruta('POST', '/bibliotecas/:id/documentos', (m, c) => { for (const id of c.documentos as string[]) { const d = docs.get(id); if (d && !d.bibliotecas.includes(m[1]!)) d.bibliotecas = [...d.bibliotecas, m[1]!]; } return json(bibliotecas.find((b) => b.id === m[1])); });
ruta('DELETE', '/bibliotecas/:id/documentos/:doc', (m) => { const d = docs.get(m[2]!); if (d) d.bibliotecas = d.bibliotecas.filter((b) => b !== m[1]); return json(bibliotecas.find((b) => b.id === m[1])); });
ruta('DELETE', '/bibliotecas/:id', (m) => { const i = bibliotecas.findIndex((b) => b.id === m[1]); if (i >= 0) bibliotecas.splice(i, 1); return ok(); });

ruta('POST', '/busqueda', async (_m, c: Buscar) => { const t = Date.now(); const r = buscarEn(c.consulta, c.filtros, c.k ?? 20); await espera(90 + Math.random() * 120); return json({ resultados: r, intencion: 'conceptual', ms: Date.now() - t + 40 }, 0); });
ruta('POST', '/busqueda/similares', (_m, c) => {
  const [doc, orden] = String(c.fragmento ?? '').replace(/^f-/, '').split(/-(\d+)-\d+$/);
  const d = doc ? docs.get(doc) : undefined;
  const base = d ? textoDe(d, Number(orden)).split('\n\n').filter((p) => !p.startsWith('#'))[0] ?? '' : String(c.texto ?? '');
  return json({ resultados: buscarEn(base, c.filtros, 10).filter((r) => r.fragmento.id !== c.fragmento), ms: 140 });
});
ruta('POST', '/busqueda/responder', (_m, c) => sse(responder(c)));

ruta('POST', '/citas/autocita', async (_m, c) => { const det = autocitar(c.texto ?? '', c.estilo ?? 'apa'); autocitas.set(det.id, det); await espera(500); return json({ tarea: det.id }, 0); });
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
    ? `${lista.map((t, i) => `${i === 0 ? 'Los pasajes reunidos coinciden en algo' : 'Además'}: ${minus(t.cita!.texto)} [${i + 1}]`).join(' ')}`
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
  return json({ indice: g.indice, miembros: res.map((r) => ({ documento: r.documento.id, titulo: r.documento.metadatos.titulo, objetivo: 'fragmento', id: r.fragmento.id, texto: r.fragmento.texto, etiqueta: r.etiqueta })) } satisfies MiembrosGrupo);
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
ruta('GET', '/grafo/huerfanas', () => json([
  { referencia: 'Bentham, J. (1791). Panopticon; or, the Inspection-House.', anio: 1791, citadaPor: ['d-foucault', 'd-web'] },
  { referencia: 'Lacan, J. (1966). Écrits.', anio: 1966, citadaPor: ['d-kristeva', 'd-clase'] },
  { referencia: 'Douglas, M. (1966). Purity and Danger.', anio: 1966, citadaPor: ['d-kristeva'] },
]));
ruta('GET', '/perspectivas/arqueologia', () => json({ olvidados: [
  { documento: 'd-deleuze', titulo: 'Mil mesetas', ultimaApertura: hace(60 * 24 * 96), motivo: 'Lo subrayaste mucho en mayo y no lo has vuelto a abrir; tres búsquedas recientes sobre «devenir» lo tocan.' },
  { documento: 'd-borges', titulo: 'Ficciones', ultimaApertura: hace(60 * 24 * 64), motivo: '«La biblioteca de Babel» responde a tu consulta sobre el archivo total.' },
] }));
ruta('GET', '/perspectivas/huecos', () => json([
  { tema: 'Didi-Huberman y la imagen-superviviente', consultas: 5, resultadosMedios: 0.4, sugerencia: 'Ninguno de tus documentos trata el tema; quizá falte «Ante el tiempo».' },
  { tema: 'Archivo queer', consultas: 3, resultadosMedios: 1.2, sugerencia: 'Solo una diapositiva lo menciona.' },
]));
ruta('GET', '/perspectivas/recomendaciones', () => json([
  { titulo: 'Arlette Farge, «La atracción del archivo»', motivo: 'Lo citan dos de tus documentos y encaja con «Archivo y duelo».' },
  { titulo: 'Mary Douglas, «Pureza y peligro»', motivo: 'Kristeva la cita en el capítulo III y la buscas como «impureza».' },
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
    meta: { titulo: titulo.charAt(0).toUpperCase() + titulo.slice(1), autores: [], idioma: 'es' }, secciones: [], banco: ['Texto leído de la página en la demostración.', 'Cada fragmento conserva su ancla: página impresa o segundo exacto.'], fijos: {},
    bibliotecas: [], creado: ahora(), bytes: s.bytes, mime: s.mime,
  });
  simularIngesta(s.documento, tarea, unidades, 1.4);
  return json({ documento: s.documento, tarea });
});
ruta('POST', '/subidas/url', (_m, c) => {
  const documento = `d-${Date.now().toString(36)}`, tarea = `tarea-${documento}`;
  const tipo: TipoEntrada = /youtu/.test(c.url) ? 'video' : 'web';
  docs.set(documento, { id: documento, tipo, unidades: tipo === 'web' ? 14 : 30, ...(tipo === 'video' ? { duracion: 1800 } : {}), estado: 'procesando', leidas: 0, tarea, meta: { titulo: c.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60), autores: [], url: c.url }, secciones: [], banco: ['Párrafo extraído de la página web.'], fijos: {}, bibliotecas: [], creado: ahora(), bytes: 0, mime: 'text/html' });
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
  for (const [m, re, fn] of rutas) {
    if (m !== metodo) continue;
    const coincide = camino.match(re);
    if (coincide) return fn(coincide, cuerpo ?? {}, url.searchParams);
  }
  return error(404, 'no_encontrado', `Ruta no simulada: ${metodo} ${camino}`);
}

export type { Resultado };
