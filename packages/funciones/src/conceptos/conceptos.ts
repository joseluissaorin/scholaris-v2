/**
 * Conceptos: informes de un concepto a lo largo de la biblioteca.
 *
 * Tubería (port ligero de la versión en Python, sin spaCy ni WordNet):
 *  1. Vector del concepto (nombre, descripción y términos) con el embebedor, y
 *     similitud con el vector de cada fragmento ya guardado en la estantería.
 *  2. Léxico por idioma: los términos del usuario y, si hay redactor, un léxico
 *     generado una vez por (concepto, idioma) y guardado (lemas, variantes,
 *     falsos amigos). Más plurales y género básicos por reglas.
 *  3. Tramos: cada aparición léxica con su frase; y los fragmentos muy
 *     cercanos sin aparición léxica, como tramos «semánticos» (temas abstractos).
 *  4. Reordenador sobre las frases, y juez sobre los tramos dudosos: ¿se
 *     refiere al concepto?, ¿qué uso es (definición, aplicación, crítica, mención)?
 *  5. Confianza fusionada, filtro y guardado; resumen opcional con el redactor.
 */

import { anclaACita, bytesAVector, coseno, enParalelo, nuevoId, normalizarVector, sha256, type Ancla, type Filtros, type SQL } from '@scholaris/nucleo';
import type { AgregadosConcepto, Concepto, InformeConcepto, NuevoConcepto, Pagina, TramoConcepto } from '@scholaris/contrato';
import { condicionDocumentos } from '../buscador-local.js';
import { depurarMarcas } from '../cuadernos.js';
import { citaCorta, leerDocumentos } from '../estanteria.js';
import type { AlProgreso, PuertosFunciones } from '../puertos.js';
import { aBytes, aJSON, ahora, deJSON, ErrorFunciones, limitar, marcas, noEncontrado, num, numONulo, recortar, texto, una } from '../util.js';
import { detectarIdioma, fraseEn, frases, NOMBRES_IDIOMAS, normalizar, tokenizar, variantes } from './lengua.js';

export type TipoConcepto = 'tema' | 'entidad' | 'profesion' | 'parentesco' | 'lugar' | 'tiempo' | 'genero' | 'lexico';
export type UsoConcepto = 'definicion' | 'aplicacion' | 'critica' | 'mencion';
export const USOS: readonly UsoConcepto[] = ['definicion', 'aplicacion', 'critica', 'mencion'];

export interface NuevoConceptoCompleto extends NuevoConcepto {
  tipo?: TipoConcepto;
  /** Solo para conceptos de género: femenino, masculino o cualquiera. */
  genero?: 'fem' | 'masc' | 'cualquiera';
  usarJuez?: boolean;
  minConfianza?: number;
  umbralSemantico?: number;
  /** Generar léxicos por idioma con el redactor (por defecto, sí). */
  lexicoAutomatico?: boolean;
}

export interface ConceptoCompleto extends Concepto {
  tipo: TipoConcepto;
  genero: 'fem' | 'masc' | 'cualquiera';
  usarJuez: boolean;
  minConfianza: number;
  umbralSemantico: number;
  lexicoAutomatico: boolean;
}

const TIPOS: readonly TipoConcepto[] = ['tema', 'entidad', 'profesion', 'parentesco', 'lugar', 'tiempo', 'genero', 'lexico'];

/** Ajustes por defecto de cada tipo (heredados de la calibración de 2026-06). */
const POR_TIPO: Record<TipoConcepto, { minConfianza: number; umbralSemantico: number; pesoSemantico: number; juez: boolean }> = {
  tema: { minConfianza: 0.3, umbralSemantico: 0.3, pesoSemantico: 0.35, juez: true },
  entidad: { minConfianza: 0.45, umbralSemantico: 0.45, pesoSemantico: 0.25, juez: false },
  profesion: { minConfianza: 0.45, umbralSemantico: 0.5, pesoSemantico: 0.2, juez: false },
  parentesco: { minConfianza: 0.45, umbralSemantico: 0.5, pesoSemantico: 0.15, juez: false },
  lugar: { minConfianza: 0.45, umbralSemantico: 0.5, pesoSemantico: 0.2, juez: false },
  tiempo: { minConfianza: 0.5, umbralSemantico: 0.55, pesoSemantico: 0.15, juez: false },
  genero: { minConfianza: 0.4, umbralSemantico: 0.5, pesoSemantico: 0.2, juez: false },
  lexico: { minConfianza: 0.45, umbralSemantico: 0.6, pesoSemantico: 0.15, juez: false },
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

interface Definicion {
  descripcion?: string;
  terminos: string[];
  filtros?: Filtros;
  usarJuez?: boolean;
  minConfianza?: number;
  umbralSemantico?: number;
  lexicoAutomatico?: boolean;
}

function filaAConcepto(f: Record<string, unknown>): ConceptoCompleto {
  const d = deJSON<Definicion>(f.definicion, { terminos: [] });
  const tipo = (TIPOS.includes(String(f.tipo) as TipoConcepto) ? String(f.tipo) : 'tema') as TipoConcepto;
  const c: ConceptoCompleto = {
    id: String(f.id),
    nombre: String(f.nombre),
    terminos: d.terminos ?? [],
    creado: String(f.creado),
    actualizado: String(f.actualizado),
    tipo,
    genero: (String(f.genero) as ConceptoCompleto['genero']) || 'cualquiera',
    usarJuez: d.usarJuez ?? POR_TIPO[tipo].juez,
    minConfianza: d.minConfianza ?? POR_TIPO[tipo].minConfianza,
    umbralSemantico: d.umbralSemantico ?? POR_TIPO[tipo].umbralSemantico,
    lexicoAutomatico: d.lexicoAutomatico ?? true,
  };
  if (d.descripcion) c.descripcion = d.descripcion;
  if (d.filtros) c.filtros = d.filtros;
  if (f.ultimo_informe) c.ultimoInforme = String(f.ultimo_informe);
  return c;
}

const SELECT_CONCEPTO = `SELECT c.*, (SELECT i.id FROM conceptos_informes i WHERE i.concepto = c.id ORDER BY i.iniciado DESC LIMIT 1) AS ultimo_informe FROM conceptos c`;

function validarConcepto(n: Partial<NuevoConceptoCompleto>, parcial: boolean) {
  if (!parcial || n.nombre !== undefined) {
    if (typeof n.nombre !== 'string' || !n.nombre.trim()) throw new ErrorFunciones('peticion_invalida', 'El concepto necesita un nombre.');
    if (n.nombre.length > 120) throw new ErrorFunciones('peticion_invalida', 'El nombre no puede pasar de 120 caracteres.');
  }
  if (n.terminos !== undefined && (!Array.isArray(n.terminos) || n.terminos.some((t) => typeof t !== 'string'))) {
    throw new ErrorFunciones('peticion_invalida', 'Los términos deben ser una lista de textos.');
  }
  if (n.tipo !== undefined && !TIPOS.includes(n.tipo)) throw new ErrorFunciones('peticion_invalida', `Tipo de concepto desconocido: «${n.tipo}».`);
}

function definicionDe(n: Partial<NuevoConceptoCompleto>, previa: Definicion = { terminos: [] }): Definicion {
  const d: Definicion = { ...previa };
  if (n.descripcion !== undefined) d.descripcion = n.descripcion;
  if (n.terminos !== undefined) d.terminos = [...new Set(n.terminos.map((t) => t.trim()).filter(Boolean))].slice(0, 200);
  if (n.filtros !== undefined) d.filtros = n.filtros;
  if (n.usarJuez !== undefined) d.usarJuez = n.usarJuez;
  if (n.minConfianza !== undefined) d.minConfianza = Math.max(0, Math.min(1, n.minConfianza));
  if (n.umbralSemantico !== undefined) d.umbralSemantico = Math.max(0, Math.min(1, n.umbralSemantico));
  if (n.lexicoAutomatico !== undefined) d.lexicoAutomatico = n.lexicoAutomatico;
  return d;
}

export async function crearConcepto(sql: SQL, n: NuevoConceptoCompleto): Promise<ConceptoCompleto> {
  validarConcepto(n, false);
  if (await una(sql, 'SELECT 1 AS x FROM conceptos WHERE nombre = ?', n.nombre.trim())) {
    throw new ErrorFunciones('duplicado', `Ya tienes un concepto llamado «${n.nombre.trim()}».`, 409);
  }
  const id = nuevoId('k');
  const t = ahora();
  await sql.ejecutar(
    'INSERT INTO conceptos (id, nombre, tipo, genero, definicion, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, n.nombre.trim(), n.tipo ?? 'tema', n.genero ?? 'cualquiera', JSON.stringify(definicionDe(n)), t, t,
  );
  return obtenerConcepto(sql, id);
}

export async function listarConceptos(sql: SQL): Promise<ConceptoCompleto[]> {
  return (await sql.ejecutar(`${SELECT_CONCEPTO} ORDER BY c.actualizado DESC`)).map(filaAConcepto);
}

export async function obtenerConcepto(sql: SQL, id: string): Promise<ConceptoCompleto> {
  const f = await una(sql, `${SELECT_CONCEPTO} WHERE c.id = ?`, id);
  if (!f) throw noEncontrado('ese concepto');
  return filaAConcepto(f);
}

export async function actualizarConcepto(sql: SQL, id: string, n: Partial<NuevoConceptoCompleto>): Promise<ConceptoCompleto> {
  const f = await una(sql, 'SELECT * FROM conceptos WHERE id = ?', id);
  if (!f) throw noEncontrado('ese concepto');
  validarConcepto(n, true);
  if (n.nombre !== undefined && (await una(sql, 'SELECT 1 AS x FROM conceptos WHERE nombre = ? AND id <> ?', n.nombre.trim(), id))) {
    throw new ErrorFunciones('duplicado', `Ya tienes un concepto llamado «${n.nombre.trim()}».`, 409);
  }
  const d = definicionDe(n, deJSON<Definicion>(f.definicion, { terminos: [] }));
  await sql.ejecutar(
    'UPDATE conceptos SET nombre = ?, tipo = ?, genero = ?, definicion = ?, actualizado = ? WHERE id = ?',
    n.nombre?.trim() ?? String(f.nombre), n.tipo ?? String(f.tipo), n.genero ?? String(f.genero), JSON.stringify(d), ahora(), id,
  );
  // Cambian los términos o la descripción: los léxicos generados ya no valen.
  if (n.terminos !== undefined || n.descripcion !== undefined || n.nombre !== undefined) await sql.ejecutar('DELETE FROM conceptos_lexicos WHERE concepto = ?', id);
  return obtenerConcepto(sql, id);
}

export async function borrarConcepto(sql: SQL, id: string): Promise<void> {
  await obtenerConcepto(sql, id);
  await sql.transaccion(async (tx) => {
    await tx.ejecutar('DELETE FROM conceptos_etiquetas WHERE span IN (SELECT s.id FROM conceptos_spans s JOIN conceptos_informes i ON i.id = s.informe WHERE i.concepto = ?)', id);
    await tx.ejecutar('DELETE FROM conceptos_spans WHERE informe IN (SELECT id FROM conceptos_informes WHERE concepto = ?)', id);
    await tx.ejecutar('DELETE FROM conceptos_informes WHERE concepto = ?', id);
    await tx.ejecutar('DELETE FROM conceptos_lexicos WHERE concepto = ?', id);
    await tx.ejecutar('DELETE FROM conceptos WHERE id = ?', id);
  });
}

// ---------------------------------------------------------------------------
// Léxicos
// ---------------------------------------------------------------------------

export interface LexicoConcepto {
  lemas: string[];
  variantes: string[];
  excluir: string[];
}

function sanear(xs: unknown): string[] {
  if (typeof xs === 'string') xs = xs.split(',');
  if (!Array.isArray(xs)) return [];
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const x of xs) {
    const s = String(x ?? '').trim();
    if (!s || s.length > 60 || vistos.has(s.toLowerCase())) continue;
    vistos.add(s.toLowerCase());
    salida.push(s);
  }
  return salida.slice(0, 150);
}

/** Léxico de un concepto en un idioma: guardado, o generado con el redactor (y guardado). */
export async function lexicoPara(p: PuertosFunciones, c: ConceptoCompleto, idioma: string): Promise<LexicoConcepto | null> {
  const f = await una(p.sql, 'SELECT lexico FROM conceptos_lexicos WHERE concepto = ? AND idioma = ?', c.id, idioma);
  if (f) return deJSON<LexicoConcepto>(f.lexico, { lemas: [], variantes: [], excluir: [] });
  const redactor = p.inteligencia?.redactor;
  if (!redactor || !c.lexicoAutomatico) return null;
  const lengua = NOMBRES_IDIOMAS[idioma] ?? idioma;
  const genero = c.tipo === 'genero' && c.genero !== 'cualquiera'
    ? `\nGénero objetivo: ${c.genero === 'fem' ? 'femenino (mujeres)' : 'masculino (hombres)'}; incluye las formas de ese género.` : '';
  try {
    const r = await redactor.generar<{ lemas: string[]; variantes: string[]; excluir: string[] }>({
      sistema: 'Generas léxicos compactos para buscar conceptos en textos académicos. Respondes solo con JSON.',
      mensajes: [{
        rol: 'usuario',
        partes: [{
          texto:
            `Genera un léxico en ${lengua} para el concepto «${c.nombre}».\n` +
            `Descripción: ${c.descripcion ?? c.nombre}\nTipo: ${c.tipo}\nTérminos de partida: ${c.terminos.join(', ') || c.nombre}${genero}\n\n` +
            `Devuelve: «lemas» (palabras y expresiones en ${lengua} que nombran el concepto, en forma base), «variantes» ` +
            '(formas flexionadas o grafías antiguas que un lematizador podría no reconocer) y «excluir» (palabras que parecen ' +
            'del concepto pero no lo son: falsos amigos, usos figurados frecuentes). Como mucho 35 elementos por lista, en minúsculas ' +
            'salvo nombres propios, escritos en la grafía nativa del idioma.',
        }],
      }],
      esquema: {
        type: 'object',
        properties: { lemas: { type: 'array', items: { type: 'string' } }, variantes: { type: 'array', items: { type: 'string' } }, excluir: { type: 'array', items: { type: 'string' } } },
        required: ['lemas', 'variantes', 'excluir'],
      },
      temperatura: 0.2,
      calidad: 'rapida',
    });
    const j = r.json ?? deJSON<{ lemas?: unknown; variantes?: unknown; excluir?: unknown }>(r.texto, {}) as { lemas?: unknown; variantes?: unknown; excluir?: unknown };
    const lex: LexicoConcepto = { lemas: sanear(j.lemas), variantes: sanear(j.variantes), excluir: sanear(j.excluir) };
    if (!lex.lemas.length && !lex.variantes.length) return null;
    await p.sql.ejecutar(
      `INSERT INTO conceptos_lexicos (concepto, idioma, lexico, origen, creado) VALUES (?, ?, ?, 'redactor', ?)
       ON CONFLICT(concepto, idioma) DO UPDATE SET lexico = excluded.lexico, origen = excluded.origen, creado = excluded.creado`,
      c.id, idioma, JSON.stringify(lex), ahora(),
    );
    return lex;
  } catch {
    return null;
  }
}

interface Forma { lema: string; tipo: 'termino' | 'lema' | 'variante'; regla: number }

/** Diccionario forma normalizada → lema; las expresiones de varias palabras van aparte. */
function construirBuscador(c: ConceptoCompleto, lex: LexicoConcepto | null, idioma: string | null) {
  const simples = new Map<string, Forma>();
  const compuestas: Array<{ partes: string[]; forma: Forma }> = [];
  const excluir = new Set((lex?.excluir ?? []).map(normalizar));
  const anadir = (s: string, tipo: Forma['tipo'], regla: number, flexionar: boolean) => {
    const base = s.trim();
    if (!base) return;
    const forma: Forma = { lema: base.toLowerCase(), tipo, regla };
    const n = normalizar(base);
    if (n.includes(' ')) { compuestas.push({ partes: n.split(/\s+/), forma }); return; }
    for (const v of flexionar ? variantes(base, idioma) : [n]) {
      if (excluir.has(v)) continue;
      const previa = simples.get(v);
      if (!previa || previa.regla < regla) simples.set(v, v === n ? forma : { ...forma, regla: regla - 0.05 });
    }
  };
  for (const t of [c.nombre, ...c.terminos]) anadir(t, 'termino', 0.8, true);
  for (const t of lex?.lemas ?? []) anadir(t, 'lema', 0.7, true);
  for (const t of lex?.variantes ?? []) anadir(t, 'variante', 0.6, false);
  return { simples, compuestas, excluir };
}

// ---------------------------------------------------------------------------
// Informes
// ---------------------------------------------------------------------------

export interface OpcionesInforme {
  biblioteca?: string;
  documentos?: string[];
  usarReordenador?: boolean;
  usarJuez?: boolean;
  /** Máximo de tramos que se mandan al juez (coste). */
  maxJuez?: number;
  resumen?: boolean;
}

function filaAInforme(f: Record<string, unknown>): InformeConcepto & { fase?: string; avance: number } {
  const i: InformeConcepto & { fase?: string; avance: number } = {
    id: String(f.id),
    concepto: String(f.concepto),
    estado: (String(f.estado) === 'en_marcha' ? 'procesando' : String(f.estado) === 'hecho' ? 'listo' : String(f.estado)) as InformeConcepto['estado'],
    tramos: num(f.n_spans),
    documentos: num(f.n_documentos),
    creado: String(f.iniciado),
    avance: num(f.avance),
  };
  const m = deJSON<{ resumen?: string }>(f.manifiesto, {});
  if (m.resumen) i.resumen = m.resumen;
  if (f.error) i.error = String(f.error);
  if (f.terminado) i.terminado = String(f.terminado);
  if (f.fase) i.fase = String(f.fase);
  return i;
}

const SELECT_INFORME = `SELECT i.*, (SELECT count(DISTINCT documento) FROM conceptos_spans s WHERE s.informe = i.id) AS n_documentos FROM conceptos_informes i`;

export async function obtenerInforme(sql: SQL, id: string) {
  const f = await una(sql, `${SELECT_INFORME} WHERE i.id = ?`, id);
  if (!f) throw noEncontrado('ese informe');
  return filaAInforme(f);
}

export async function listarInformes(sql: SQL, concepto: string) {
  await obtenerConcepto(sql, concepto);
  return (await sql.ejecutar(`${SELECT_INFORME} WHERE i.concepto = ? ORDER BY i.iniciado DESC`, concepto)).map(filaAInforme);
}

/** Crea el informe en cola. La extracción la hace `procesarInforme`. */
export async function crearInforme(sql: SQL, concepto: string): Promise<string> {
  await obtenerConcepto(sql, concepto);
  const id = nuevoId('i');
  await sql.ejecutar("INSERT INTO conceptos_informes (id, concepto, estado, iniciado, fase) VALUES (?, ?, 'en_cola', ?, 'en_cola')", id, concepto, ahora());
  return id;
}

interface Candidato {
  fragmento: string;
  documento: string;
  unidad: string;
  texto: string;
  ancla: Ancla | null;
  anclaFin: Ancla | null;
  idioma: string | null;
  semantica: number | null;
}

interface Tramo {
  c: Candidato;
  texto: string;
  lema: string;
  ini: number;
  fin: number;
  frase: string;
  fraseIni: number;
  fraseFin: number;
  tipo: string;
  regla: number;
  reordenacion: number | null;
  juez: number | null;
  uso: UsoConcepto | null;
  confianza: number;
}

const sigmoide = (x: number) => 1 / (1 + Math.exp(-x));

/** Fusiona las señales en una confianza 0-1 (los pesos ausentes se reparten). */
export function fusionarConfianza(t: { regla: number; semantica: number | null; reordenacion: number | null; juez: number | null }, pesoSemantico = 0.2): number {
  const partes: Array<[number, number]> = [[0.55, t.regla]];
  if (t.semantica !== null) partes.push([pesoSemantico, Math.max(0, Math.min(1, t.semantica))]);
  if (t.reordenacion !== null) partes.push([0.2, Math.max(0, Math.min(1, t.reordenacion))]);
  if (t.juez !== null) partes.push([0.35, t.juez]);
  const w = partes.reduce((s, [p]) => s + p, 0);
  let c = partes.reduce((s, [p, v]) => s + p * v, 0) / w;
  // Un juez que dice claramente que no hunde el tramo.
  if (t.juez !== null && t.juez < 0.2) c = Math.min(c, 0.25);
  return Math.round(c * 1000) / 1000;
}

/** Ejecuta la extracción de un informe y la guarda. No lanza: marca el informe con error. */
export async function procesarInforme(p: PuertosFunciones, informe: string, o: OpcionesInforme = {}, alProgreso?: AlProgreso): Promise<void> {
  const { sql } = p;
  const t0 = Date.now();
  const fila = await una(sql, 'SELECT concepto FROM conceptos_informes WHERE id = ?', informe);
  if (!fila) throw noEncontrado('ese informe');
  const c = await obtenerConcepto(sql, String(fila.concepto));
  const ajustes = POR_TIPO[c.tipo];
  const fase = async (nombre: string, avance: number, mensaje: string, detalle?: Record<string, unknown>) => {
    await sql.ejecutar("UPDATE conceptos_informes SET estado = 'en_marcha', fase = ?, avance = ? WHERE id = ?", nombre, avance, informe);
    if (alProgreso) await alProgreso({ fase: nombre, estado: 'avance', mensaje, avance, ms: Date.now() - t0, ...(detalle ? { detalle } : {}) });
  };
  try {
    // 1. Fragmentos de la biblioteca (con los filtros del concepto y del informe).
    await fase('cargar', 0.02, 'Cargando los fragmentos de la biblioteca.');
    const filtros: Filtros = { ...(c.filtros ?? {}) };
    if (o.biblioteca) filtros.bibliotecas = [o.biblioteca];
    if (o.documentos?.length) filtros.documentos = o.documentos;
    const { donde, p: params } = condicionDocumentos(filtros);
    const docsIdioma = new Map<string, string | null>();
    for (const f of await sql.ejecutar(`SELECT d.id, d.idioma FROM documentos d WHERE ${donde}`, ...params)) docsIdioma.set(String(f.id), texto(f.idioma));
    if (!docsIdioma.size) throw new ErrorFunciones('peticion_invalida', 'No hay documentos que analizar con esos filtros.');
    const huellaBiblioteca = await sha256([...docsIdioma.keys()].sort().join('|'));
    const candidatos: Candidato[] = [];
    let ultimo = 0;
    for (;;) {
      const lote = await sql.ejecutar('SELECT n, id, documento, unidad, texto, ancla, ancla_fin FROM fragmentos WHERE n > ? ORDER BY n LIMIT 2000', ultimo);
      if (!lote.length) break;
      for (const f of lote) {
        ultimo = num(f.n);
        const doc = String(f.documento);
        if (!docsIdioma.has(doc)) continue;
        const t = String(f.texto);
        candidatos.push({
          fragmento: String(f.id), documento: doc, unidad: String(f.unidad), texto: t,
          ancla: deJSON<Ancla | null>(f.ancla, null), anclaFin: deJSON<Ancla | null>(f.ancla_fin, null),
          idioma: docsIdioma.get(doc) ?? detectarIdioma(t), semantica: null,
        });
      }
    }
    await sql.ejecutar('UPDATE conceptos_informes SET revision = ?, n_fragmentos = ? WHERE id = ?', huellaBiblioteca, candidatos.length, informe);

    // 2. Similitud semántica con los vectores guardados.
    const embebedor = p.inteligencia?.embebedor;
    let haySemantica = false;
    if (embebedor) {
      await fase('semantica', 0.08, 'Calculando la cercanía de cada fragmento al concepto.');
      const textos = [`${c.nombre}${c.descripcion ? `: ${c.descripcion}` : ''}`, ...c.terminos.slice(0, 30)];
      const vs = await embebedor.vectorizar(textos.map((t) => ({ modalidad: 'texto' as const, texto: t })), 'consulta');
      const centro = new Float32Array(vs[0]!.length);
      // El nombre con la descripción pesa como todos los términos juntos.
      vs.forEach((v, i) => { const w = i === 0 ? Math.max(1, vs.length - 1) : 1; for (let j = 0; j < v.length; j++) centro[j]! += w * v[j]!; });
      const concepto = normalizarVector(centro);
      const porId = new Map(candidatos.map((x) => [x.fragmento, x]));
      let desde = 0;
      for (;;) {
        const lote = await sql.ejecutar(
          "SELECT rowid AS r, id, valores FROM vectores WHERE espacio = ? AND objetivo = 'fragmento' AND rowid > ? ORDER BY rowid LIMIT 2000",
          embebedor.espacio.id, desde,
        );
        if (!lote.length) break;
        for (const f of lote) {
          desde = num(f.r);
          const cand = porId.get(String(f.id));
          const b = aBytes(f.valores);
          if (!cand || !b) continue;
          cand.semantica = coseno(bytesAVector(b), concepto);
          haySemantica = true;
        }
      }
    }

    // 3. Léxicos por idioma y búsqueda de apariciones.
    const idiomas = [...new Set(candidatos.map((x) => x.idioma ?? 'und'))].slice(0, 8);
    await fase('lexico', 0.15, `Preparando el léxico del concepto (${idiomas.length === 1 ? 'un idioma' : `${idiomas.length} idiomas`}).`, { idiomas });
    const buscadores = new Map<string, ReturnType<typeof construirBuscador>>();
    await enParalelo(idiomas, 4, async (idioma) => {
      const lex = idioma === 'und' ? null : await lexicoPara(p, c, idioma);
      buscadores.set(idioma, construirBuscador(c, lex, idioma === 'und' ? null : idioma));
    });
    await fase('extraer', 0.3, 'Buscando el concepto en los textos.');
    const tramos: Tramo[] = [];
    for (let k = 0; k < candidatos.length; k++) {
      const cand = candidatos[k]!;
      const b = buscadores.get(cand.idioma ?? 'und') ?? buscadores.values().next().value!;
      const toks = tokenizar(cand.texto);
      let hallados = 0;
      for (let i = 0; i < toks.length; i++) {
        let forma: Forma | undefined;
        let fin = i;
        for (const comp of b.compuestas) {
          if (comp.partes.every((pt, j) => toks[i + j]?.norma === pt)) { forma = comp.forma; fin = i + comp.partes.length - 1; break; }
        }
        forma ??= b.simples.get(toks[i]!.norma);
        if (!forma) continue;
        const ini = toks[i]!.ini, finC = toks[fin]!.fin;
        const fr = fraseEn(cand.texto, ini, finC);
        tramos.push({
          c: cand, texto: cand.texto.slice(ini, finC), lema: forma.lema, ini, fin: finC,
          frase: cand.texto.slice(fr.ini, fr.fin).trim(), fraseIni: fr.ini, fraseFin: fr.fin,
          tipo: forma.tipo, regla: forma.regla, reordenacion: null, juez: null, uso: null, confianza: 0,
        });
        hallados++;
        i = fin;
      }
      // Sin aparición léxica pero muy cerca del concepto: tramo semántico (la frase más cargada).
      if (!hallados && cand.semantica !== null && cand.semantica >= c.umbralSemantico) {
        const fs = frases(cand.texto);
        const claves = new Set([c.nombre, ...c.terminos].flatMap((t) => normalizar(t).split(/\s+/)).filter((x) => x.length > 3));
        let mejor = fs[0] ?? { ini: 0, fin: Math.min(cand.texto.length, 280) }, mejorN = -1;
        for (const f of fs) {
          const n = tokenizar(cand.texto.slice(f.ini, f.fin)).filter((t) => claves.has(t.norma)).length;
          if (n > mejorN) { mejorN = n; mejor = f; }
        }
        tramos.push({
          c: cand, texto: recortar(cand.texto.slice(mejor.ini, mejor.fin), 80), lema: c.nombre.toLowerCase(), ini: mejor.ini, fin: mejor.fin,
          frase: cand.texto.slice(mejor.ini, mejor.fin).trim(), fraseIni: mejor.ini, fraseFin: mejor.fin,
          tipo: 'semantica', regla: Math.min(1, cand.semantica * 1.4), reordenacion: null, juez: null, uso: null, confianza: 0,
        });
      }
      if (k % 500 === 499) await fase('extraer', 0.3 + 0.3 * (k / candidatos.length), `Analizados ${k + 1} de ${candidatos.length} fragmentos.`);
    }
    await fase('extraer', 0.6, `Encontrados ${tramos.length} tramos.`, { tramos: tramos.length });

    // 4a. Reordenador sobre las frases únicas.
    const reordenador = p.inteligencia?.reordenador;
    if (reordenador && o.usarReordenador !== false && tramos.length) {
      await fase('reordenar', 0.65, 'Puntuando las frases con el reordenador.');
      const unicas = [...new Set(tramos.map((t) => t.frase))];
      const consulta = `${c.nombre}${c.descripcion ? `: ${c.descripcion}` : ''}${c.terminos.length ? ` (${c.terminos.slice(0, 6).join(', ')})` : ''}`;
      const puntos = new Map<string, number>();
      for (let i = 0; i < unicas.length; i += 64) {
        const lote = unicas.slice(i, i + 64);
        try {
          const ps = await reordenador.reordenar(consulta, lote);
          const fuera = ps.some((x) => x < 0 || x > 1);
          lote.forEach((f, j) => puntos.set(f, fuera ? sigmoide(ps[j] ?? 0) : (ps[j] ?? 0)));
        } catch {
          break;
        }
      }
      for (const t of tramos) t.reordenacion = puntos.get(t.frase) ?? null;
    }

    // 4b. Juez: ¿se refiere al concepto? ¿qué uso? Primero los más dudosos.
    const juez = p.inteligencia?.juez;
    const usarJuez = o.usarJuez ?? c.usarJuez;
    if (juez && usarJuez && tramos.length) {
      for (const t of tramos) t.confianza = fusionarConfianza({ ...t, semantica: t.c.semantica }, ajustes.pesoSemantico);
      const dudosos = [...tramos].sort((a, b) => Math.abs(a.confianza - 0.55) - Math.abs(b.confianza - 0.55)).slice(0, limitar(o.maxJuez, 0, 2000, 400));
      await fase('juzgar', 0.75, `Verificando ${dudosos.length} tramos con el juez.`, { tramos: dudosos.length });
      const lotes: Tramo[][] = [];
      for (let i = 0; i < dudosos.length; i += 10) lotes.push(dudosos.slice(i, i + 10));
      let hechos = 0;
      await enParalelo(lotes, 4, async (lote) => {
        const preguntas: Parameters<typeof juez.juzgar>[1] = {};
        const pasajes: Record<string, string> = {};
        lote.forEach((t, i) => {
          pasajes[`p${i}`] = recortar(t.frase, 600);
          preguntas[`p${i}_refiere`] = {
            tipo: 'si_no',
            instrucciones: `En el pasaje p${i}, ¿la expresión «${t.texto}» (o el pasaje entero) se refiere de verdad al concepto «${c.nombre}»${c.descripcion ? ` (${c.descripcion})` : ''}?`,
            criterios: { si: 'Se refiere al concepto tal como está definido.', no: 'Es otro sentido, un uso figurado o una coincidencia de palabras.' },
          };
          preguntas[`p${i}_uso`] = {
            tipo: 'eleccion',
            instrucciones: `¿Qué hace el pasaje p${i} con el concepto «${c.nombre}»?`,
            opciones: {
              definicion: 'Lo define o explica qué es.',
              aplicacion: 'Lo aplica o usa para analizar otra cosa.',
              critica: 'Lo discute, matiza o critica.',
              mencion: 'Solo lo menciona de pasada.',
            },
          };
        });
        try {
          const r = await juez.juzgar({ concepto: c.nombre, descripcion: c.descripcion ?? '', pasajes }, preguntas);
          lote.forEach((t, i) => {
            const a = r[`p${i}_refiere`];
            if (a?.tipo === 'si_no') t.juez = a.probabilidad;
            const u = r[`p${i}_uso`];
            if (u?.tipo === 'eleccion' && USOS.includes(u.eleccion as UsoConcepto)) t.uso = u.eleccion as UsoConcepto;
          });
        } catch {
          // Sin veredicto: el tramo se queda con las demás señales.
        }
        hechos += lote.length;
        if (alProgreso) await alProgreso({ fase: 'juzgar', estado: 'avance', mensaje: `Verificados ${hechos} de ${dudosos.length} tramos.`, avance: 0.75 + 0.15 * (hechos / dudosos.length), ms: Date.now() - t0 });
      });
    }

    // 5. Confianza final, filtro y orden.
    for (const t of tramos) t.confianza = fusionarConfianza({ ...t, semantica: haySemantica ? t.c.semantica : null }, ajustes.pesoSemantico);
    const finales = tramos.filter((t) => t.confianza >= c.minConfianza)
      .sort((a, b) => b.confianza - a.confianza || a.c.documento.localeCompare(b.c.documento) || a.ini - b.ini);

    await fase('guardar', 0.9, `Guardando ${finales.length} tramos.`);
    const docs = await leerDocumentos(sql, [...new Set(finales.map((t) => t.c.documento))]);
    await sql.transaccion(async (tx) => {
      await tx.ejecutar('DELETE FROM conceptos_spans WHERE informe = ?', informe);
      const columnas = ['id', 'informe', 'documento', 'titulo', 'autores', 'anio', 'idioma', 'fragmento', 'unidad', 'ancla', 'etiqueta', 'cita', 'texto', 'lema',
        'categoria', 'ini', 'fin', 'frase', 'frase_ini', 'frase_fin', 'tipo_coincidencia', 'regla', 'puntuacion_regla', 'semantica', 'reordenacion', 'uso',
        'veredicto', 'confianza', 'justificacion'];
      const porLote = Math.floor(99 / columnas.length);
      for (let i = 0; i < finales.length; i += porLote) {
        const lote = finales.slice(i, i + porLote);
        const valores = lote.flatMap((t) => {
          const d = docs.get(t.c.documento);
          const veredicto = t.juez === null ? null : t.juez >= 0.6 ? 'si' : t.juez <= 0.4 ? 'no' : 'dudoso';
          const justificacion = [
            t.tipo === 'semantica' ? `Cercanía semántica ${t.c.semantica?.toFixed(2)}` : `Coincidencia con «${t.lema}» (${t.tipo})`,
            t.reordenacion !== null ? `reordenador ${t.reordenacion.toFixed(2)}` : null,
            t.juez !== null ? `juez ${t.juez.toFixed(2)}` : null,
          ].filter(Boolean).join('; ');
          return [
            nuevoId('x'), informe, t.c.documento, d?.titulo ?? null, aJSON(d?.autores ?? []), d?.anio ?? null, t.c.idioma, t.c.fragmento, t.c.unidad,
            aJSON(t.c.ancla), t.c.ancla ? anclaACita(t.c.ancla, t.c.anclaFin ?? undefined) : null, d ? citaCorta(d, t.c.ancla, t.c.anclaFin) : null,
            t.texto, t.lema, c.tipo, t.ini, t.fin, t.frase, t.fraseIni, t.fraseFin, t.tipo, `${c.tipo}:${t.tipo}`, t.regla, t.c.semantica, t.reordenacion,
            t.uso, veredicto, t.confianza, justificacion,
          ];
        });
        await tx.ejecutar(`INSERT INTO conceptos_spans (${columnas.join(', ')}) VALUES ${lote.map(() => `(${marcas(columnas.length)})`).join(', ')}`, ...valores);
      }
    });

    // 6. Resumen opcional, citando solo tramos guardados.
    let resumen: string | undefined;
    const redactor = p.inteligencia?.redactor;
    if (redactor && o.resumen !== false && finales.length) {
      await fase('resumir', 0.95, 'Redactando el resumen del informe.');
      const muestra = finales.slice(0, 25);
      try {
        const r = await redactor.generar<{ texto: string }>({
          sistema: 'Eres un asistente de investigación. Escribes en español, con rigor y sin inventar. Citas los pasajes con marcas [n].',
          mensajes: [{
            rol: 'usuario',
            partes: [{
              texto: `Resume en un párrafo cómo aparece el concepto «${c.nombre}» en estos pasajes de la biblioteca (usos, autores, matices):\n\n` +
                muestra.map((t, i) => `[${i + 1}] ${docs.get(t.c.documento)?.titulo ?? ''}: «${recortar(t.frase, 400)}»`).join('\n'),
            }],
          }],
          esquema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
          temperatura: 0.3,
          calidad: p.usuario.pro ? 'alta' : 'rapida',
        });
        const { texto: limpio } = depurarMarcas(r.json?.texto ?? r.texto, new Set(muestra.map((_, i) => i + 1)));
        resumen = limpio.replace(/\[(\d+(?:, \d+)*)\]/g, (_, ns: string) => {
          const etiquetas = ns.split(', ').map((n) => { const t = muestra[Number(n) - 1]!; const d = docs.get(t.c.documento); return d ? citaCorta(d, t.c.ancla, t.c.anclaFin) : ''; }).filter(Boolean);
          return etiquetas.length ? `(${etiquetas.join('; ')})` : '';
        }).trim();
      } catch {
        resumen = undefined;
      }
    }

    const manifiesto = {
      concepto: { id: c.id, nombre: c.nombre, tipo: c.tipo, terminos: c.terminos },
      opciones: o, fragmentos: candidatos.length, tramosEncontrados: tramos.length, tramos: finales.length,
      idiomas, semantica: haySemantica, ms: Date.now() - t0, ...(resumen ? { resumen } : {}),
    };
    await sql.ejecutar(
      "UPDATE conceptos_informes SET estado = 'hecho', fase = 'hecho', avance = 1, terminado = ?, n_spans = ?, manifiesto = ? WHERE id = ?",
      ahora(), finales.length, JSON.stringify(manifiesto), informe,
    );
    if (alProgreso) await alProgreso({ fase: 'fin', estado: 'hecho', mensaje: `Informe listo: ${finales.length} tramos.`, avance: 1, ms: Date.now() - t0 });
  } catch (e) {
    const mensaje = e instanceof ErrorFunciones ? e.message : `La extracción ha fallado: ${(e as Error).message}`;
    await sql.ejecutar("UPDATE conceptos_informes SET estado = 'error', fase = 'error', error = ?, terminado = ? WHERE id = ?", mensaje, ahora(), informe);
    if (alProgreso) await alProgreso({ fase: 'error', estado: 'error', mensaje, ms: Date.now() - t0 });
  }
}

// ---------------------------------------------------------------------------
// Lectura de tramos
// ---------------------------------------------------------------------------

export interface TramoCompleto extends TramoConcepto {
  citaCorta?: string;
  lema?: string;
  frase?: string;
  idioma?: string;
  tipoCoincidencia?: string;
  semantica?: number;
  reordenacion?: number;
  veredicto?: string;
  justificacion?: string;
  ini?: number;
  fin?: number;
  anio?: number;
}

function filaATramo(f: Record<string, unknown>): TramoCompleto {
  const t: TramoCompleto = {
    id: String(f.id),
    informe: String(f.informe),
    documento: String(f.documento),
    titulo: String(f.titulo ?? ''),
    fragmento: String(f.fragmento ?? ''),
    texto: String(f.texto),
    etiqueta: String(f.etiqueta ?? ''),
    puntuacion: num(f.confianza),
  };
  const opc: Array<[keyof TramoCompleto, unknown]> = [
    ['uso', f.uso], ['etiquetaUsuario', f.etiqueta_usuario], ['citaCorta', f.cita], ['lema', f.lema], ['frase', f.frase],
    ['idioma', f.idioma], ['tipoCoincidencia', f.tipo_coincidencia], ['veredicto', f.veredicto], ['justificacion', f.justificacion],
  ];
  for (const [k, v] of opc) if (v !== null && v !== undefined && v !== '') (t as unknown as Record<string, unknown>)[k] = String(v);
  for (const [k, v] of [['semantica', f.semantica], ['reordenacion', f.reordenacion], ['ini', f.ini], ['fin', f.fin], ['anio', f.anio]] as const) {
    const n = numONulo(v);
    if (n !== null) (t as unknown as Record<string, unknown>)[k] = n;
  }
  return t;
}

export interface FiltrosTramos {
  limite?: number;
  cursor?: string;
  confianzaMinima?: number;
  documento?: string;
  idioma?: string;
  uso?: string;
  lema?: string;
  tipoCoincidencia?: string;
  orden?: 'confianza' | 'documento' | 'anio';
}

export async function listarTramos(sql: SQL, informe: string, f: FiltrosTramos = {}): Promise<Pagina<TramoCompleto>> {
  await obtenerInforme(sql, informe);
  const limite = limitar(f.limite, 1, 2000, 200);
  const desde = Math.max(0, num(f.cursor, 0));
  const donde = ['informe = ?'];
  const p: Array<string | number> = [informe];
  if (f.confianzaMinima !== undefined) { donde.push('confianza >= ?'); p.push(f.confianzaMinima); }
  if (f.documento) { donde.push('documento = ?'); p.push(f.documento); }
  if (f.idioma) { donde.push('idioma = ?'); p.push(f.idioma); }
  if (f.uso) { donde.push('uso = ?'); p.push(f.uso); }
  if (f.lema) { donde.push('lema = ?'); p.push(f.lema); }
  if (f.tipoCoincidencia) { donde.push('tipo_coincidencia = ?'); p.push(f.tipoCoincidencia); }
  const orden = { confianza: 'confianza DESC, documento, ini', documento: 'documento, ini', anio: 'anio, documento, ini' }[f.orden ?? 'confianza'];
  const w = donde.join(' AND ');
  const total = num((await una(sql, `SELECT count(*) AS n FROM conceptos_spans WHERE ${w}`, ...p))?.n);
  const filas = await sql.ejecutar(`SELECT * FROM conceptos_spans WHERE ${w} ORDER BY ${orden} LIMIT ? OFFSET ?`, ...p, limite, desde);
  const pagina: Pagina<TramoCompleto> = { elementos: filas.map(filaATramo), total };
  if (desde + filas.length < total) pagina.siguiente = String(desde + filas.length);
  return pagina;
}

export interface AgregadosCompletos extends AgregadosConcepto {
  porIdioma: Record<string, number>;
  porLema: Array<{ lema: string; n: number; confianzaMedia: number }>;
  porForma: Array<{ forma: string; n: number }>;
  porTipoCoincidencia: Record<string, number>;
  totales: { tramos: number; documentos: number; confianzaMedia: number };
}

export async function agregadosInforme(sql: SQL, informe: string): Promise<AgregadosCompletos> {
  await obtenerInforme(sql, informe);
  const reg = async (col: string) => {
    const r: Record<string, number> = {};
    for (const f of await sql.ejecutar(`SELECT coalesce(${col}, 'sin_dato') AS k, count(*) AS n FROM conceptos_spans WHERE informe = ? GROUP BY k`, informe)) r[String(f.k)] = num(f.n);
    return r;
  };
  const tot = await una(sql, 'SELECT count(*) AS n, count(DISTINCT documento) AS d, avg(confianza) AS c FROM conceptos_spans WHERE informe = ?', informe);
  return {
    porDocumento: (await sql.ejecutar('SELECT documento, max(titulo) AS titulo, count(*) AS n FROM conceptos_spans WHERE informe = ? GROUP BY documento ORDER BY n DESC', informe))
      .map((f) => ({ documento: String(f.documento), titulo: String(f.titulo ?? ''), n: num(f.n) })),
    porAnio: (await sql.ejecutar('SELECT anio, count(*) AS n FROM conceptos_spans WHERE informe = ? AND anio IS NOT NULL GROUP BY anio ORDER BY anio', informe))
      .map((f) => ({ anio: num(f.anio), n: num(f.n) })),
    porUso: await reg('uso'),
    porIdioma: await reg('idioma'),
    porLema: (await sql.ejecutar('SELECT lema, count(*) AS n, avg(confianza) AS c FROM conceptos_spans WHERE informe = ? GROUP BY lema ORDER BY n DESC LIMIT 100', informe))
      .map((f) => ({ lema: String(f.lema), n: num(f.n), confianzaMedia: Math.round(num(f.c) * 1000) / 1000 })),
    porForma: (await sql.ejecutar('SELECT lower(texto) AS forma, count(*) AS n FROM conceptos_spans WHERE informe = ? GROUP BY forma ORDER BY n DESC LIMIT 100', informe))
      .map((f) => ({ forma: String(f.forma), n: num(f.n) })),
    porTipoCoincidencia: await reg('tipo_coincidencia'),
    totales: { tramos: num(tot?.n), documentos: num(tot?.d), confianzaMedia: Math.round(num(tot?.c) * 1000) / 1000 },
  };
}

const ETIQUETAS_USUARIO = ['correcto', 'incorrecto', 'dudoso'] as const;

/** Etiqueta de aprendizaje activo sobre un tramo. */
export async function etiquetarTramo(sql: SQL, tramo: string, etiqueta: string, nota?: string): Promise<TramoCompleto> {
  if (!ETIQUETAS_USUARIO.includes(etiqueta as (typeof ETIQUETAS_USUARIO)[number])) {
    throw new ErrorFunciones('peticion_invalida', 'La etiqueta debe ser «correcto», «incorrecto» o «dudoso».');
  }
  const f = await una(sql, 'SELECT id FROM conceptos_spans WHERE id = ?', tramo);
  if (!f) throw noEncontrado('ese tramo');
  await sql.ejecutar('INSERT INTO conceptos_etiquetas (id, span, etiqueta, nota, creada) VALUES (?, ?, ?, ?, ?)', nuevoId('e'), tramo, etiqueta, nota ?? null, ahora());
  await sql.ejecutar('UPDATE conceptos_spans SET etiqueta_usuario = ? WHERE id = ?', etiqueta, tramo);
  return filaATramo((await una(sql, 'SELECT * FROM conceptos_spans WHERE id = ?', tramo))!);
}

/** Todos los tramos de un informe (para exportar). */
export async function todosLosTramos(sql: SQL, informe: string): Promise<TramoCompleto[]> {
  await obtenerInforme(sql, informe);
  return (await sql.ejecutar('SELECT * FROM conceptos_spans WHERE informe = ? ORDER BY documento, ini', informe)).map(filaATramo);
}
