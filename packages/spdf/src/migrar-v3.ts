/**
 * Migración de SPDF v1-v3 (Python, «ScholarisWeb») a SPDF 4.0.
 *
 * Correspondencias:
 *
 * | v3                                   | v4                                                         |
 * |--------------------------------------|------------------------------------------------------------|
 * | metadata (clave/valor)               | documentos.metadatos (autores → Autor, títulos e idioma limpios) |
 * | pages (pdf_page, book_page, conf.)   | unidades con AnclaPagina (book_page < 0 = romano)          |
 * | video_segments / audio_segments      | unidades con AnclaTiempo (y hablante)                      |
 * | chunks + chunk_contexts              | fragmentos (contexto = final de context_before)            |
 * | sections                             | secciones                                                  |
 * | embeddings (Qwen3-VL-Embedding-2B)   | vectores del espacio «qwen3-vl-embedding-2b@2048», tal cual |
 * | chunk_contexts.context_embedding     | espacio «…@2048+contexto»                                  |
 * | video_embeddings composite_segment   | espacio «…@2048+fotogramas» (fragmento)                    |
 * | video_embeddings direct_video        | figuras «tramo de vídeo» con su vector                     |
 * | images / video_frames                | figuras + blobs (y su vector, si lo había)                 |
 * | previews / media_blob                | blobs «paginas/0001.jpg» / «original»                      |
 *
 * Los folios se revisan con @scholaris/folios usando las lecturas fiables de v3
 * (confianza ≥ 0,9) y el texto de cada página: se corrigen errores de lectura y
 * deducciones sin fundamento (v3 numeraba con romanos páginas que no tenían
 * ninguna lectura). Se puede desactivar con `repararFolios: false`.
 *
 * Lo que no tiene sitio en v4 (enlaces entre modalidades, escenas, turnos de
 * palabra, huella de voz, miniaturas de figuras) se cuenta en el informe y en
 * la procedencia, para que nada se pierda sin dejar constancia.
 */

import type {
  AnclaPagina,
  AnclaTiempo,
  Autor,
  Documento,
  EspacioVectorial,
  MetadatosDocumento,
  Modalidad,
  TipoEntrada,
  ValorSQL,
} from '@scholaris/nucleo';
import { aRomano, limpiarMarcadoOCR, sha256, tiempoACadena } from '@scholaris/nucleo';
import { deducirFolios, type FolioPagina, type PaginaFolio } from '@scholaris/folios';
import { abrirBaseCruda, ArchivoSpdf, bytesSqlite, GENERADOR } from './archivo.js';
import { rellenarTextoBusqueda } from './esquema.js';
import type { SqlWasm } from './puerto.js';
import { detectarIdioma, esVacio, limpiarEspacios, limpiarTitulo, normalizarIdioma, parsearAutores } from './limpieza.js';
import { autoresPlanos } from './repositorio.js';
import { norma } from './vectores.js';

export interface OpcionesMigracion {
  /** Identificador del documento; por defecto, «doc_» + 20 caracteres de la huella del original. */
  idDocumento?: string;
  /** Revisar los folios con @scholaris/folios (por defecto, sí). */
  repararFolios?: boolean;
  /** Incrustar el original en blobs (por defecto, sí). */
  incrustarOriginal?: boolean;
  /** Conservar las miniaturas de las figuras (por defecto, no: se regeneran). */
  miniaturasFiguras?: boolean;
  bibliotecas?: string[];
}

export interface InformeMigracion {
  documento: string;
  titulo: string;
  tipo: TipoEntrada;
  versionOrigen: string;
  unidades: number;
  fragmentos: number;
  figuras: number;
  secciones: number;
  vectores: Record<string, number>;
  blobs: number;
  bytesBlobs: number;
  folios: { revisados: boolean; cambiados: number; leidos: number; deducidos: number; ninguno: number } | null;
  idioma: { v3: string | null; final: string | null };
  /** Datos de v3 sin sitio en v4 (filas por tabla o columna). */
  ignorado: Record<string, number>;
  avisos: string[];
  ms: number;
}

type Fila = Record<string, ValorSQL>;

const LECTOR_V3 = 'scholaris-v3';

const TITULOS_SECCION: Record<string, string> = {
  chapter: 'Capítulo', heading: 'Sección', subheading: 'Subsección', abstract: 'Resumen',
  introduction: 'Introducción', conclusion: 'Conclusión', bibliography: 'Bibliografía', appendix: 'Apéndice',
};

const CSL: Record<string, string> = {
  article: 'article-journal', journal: 'article-journal', book: 'book', inbook: 'chapter', incollection: 'chapter',
  chapter: 'chapter', phdthesis: 'thesis', mastersthesis: 'thesis', thesis: 'thesis', inproceedings: 'paper-conference',
  conference: 'paper-conference', techreport: 'report', report: 'report', interview: 'interview', webpage: 'webpage',
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Bytes de un SPDF v1-v3 (gzip o SQLite) → bytes de un SPDF 4.x actual (gzip). */
export async function migrarV3aV4(bytesV3: Uint8Array | ArrayBuffer, opciones: OpcionesMigracion = {}): Promise<Uint8Array> {
  const { archivo } = await migrarBaseV3(bytesV3, opciones);
  try {
    return archivo.exportar();
  } finally {
    archivo.cerrar();
  }
}

/** Igual, pero devuelve el fichero abierto y el informe. */
export async function migrarBaseV3(bytesV3: Uint8Array | ArrayBuffer, opciones: OpcionesMigracion = {}): Promise<{ archivo: ArchivoSpdf; informe: InformeMigracion }> {
  const t0 = Date.now();
  const crudos = bytesSqlite(bytesV3);
  const { db: dbV3, sql: v3 } = await abrirBaseCruda(crudos);
  let archivo: ArchivoSpdf | null = null;
  try {
    archivo = await ArchivoSpdf.crear({ generador: GENERADOR });
    const m = new Migracion(v3, archivo, opciones);
    archivo.db.exec('BEGIN');
    try {
      await m.ejecutar(crudos);
      archivo.db.exec('COMMIT');
      // Capa de ortografía modernizada (SPDF 4.1) de los fragmentos migrados.
      await rellenarTextoBusqueda(archivo.sql);
    } catch (e) {
      archivo.db.exec('ROLLBACK');
      throw e;
    }
    m.informe.ms = Date.now() - t0;
    return { archivo, informe: m.informe };
  } catch (e) {
    archivo?.cerrar();
    throw e;
  } finally {
    v3.liberar();
    dbV3.close();
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const txt = (v: ValorSQL | undefined): string => (v === null || v === undefined ? '' : String(v));
/** Texto de página, tramo o fragmento: sin el marcado de imágenes y alineación que dejó la OCR de la v1. */
const textoLimpio = (v: ValorSQL | undefined): string => limpiarMarcadoOCR(txt(v));
const num = (v: ValorSQL | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const bytesDe = (v: ValorSQL | undefined): Uint8Array | null => {
  if (v instanceof Uint8Array) return v.length ? v : null;
  if (v instanceof ArrayBuffer) return v.byteLength ? new Uint8Array(v) : null;
  return null;
};

/** Tipo MIME de una imagen por sus primeros bytes. */
export function mimeImagen(b: Uint8Array, defecto = 'image/jpeg'): string {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  return defecto;
}

const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function contarPatron(b: Uint8Array, patron: string): number {
  const p = Array.from(patron, (c) => c.charCodeAt(0));
  const primero = p[0] as number;
  let n = 0;
  for (let i = b.indexOf(primero); i >= 0 && i <= b.length - p.length; i = b.indexOf(primero, i + 1)) {
    let ok = true;
    for (let k = 1; k < p.length; k++) if (b[i + k] !== p[k]) { ok = false; break; }
    if (ok) n++;
  }
  return n;
}

/**
 * ¿PDF escaneado? Sin fuentes y con imágenes, o con al menos una imagen por
 * página y pocas fuentes (las bibliotecas digitales añaden una línea de texto
 * a cada página escaneada).
 */
export function pareceEscaneado(pdf: Uint8Array, paginas: number): boolean {
  const fuentes = contarPatron(pdf, '/Font');
  const imagenes = contarPatron(pdf, '/Image');
  if (fuentes === 0 && imagenes > 0) return true;
  const n = Math.max(1, paginas);
  return imagenes >= 0.9 * n && fuentes < 3 * n;
}

/** Las últimas palabras de un texto, cortando por palabra: «…y entonces llegó». */
export function colaDeTexto(s: string, max = 240): string {
  const t = limpiarEspacios(s);
  if (t.length <= max) return t;
  const corte = t.slice(-max);
  const i = corte.indexOf(' ');
  return `…${i >= 0 && i < 40 ? corte.slice(i + 1) : corte}`;
}

function isoConZona(s: string): string {
  if (!s) return new Date().toISOString();
  const t = s.includes('T') ? s : s.replace(' ', 'T');
  return /[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`;
}

function anclaDeV3(fisica: number, bp: number | null, conf: number): AnclaPagina {
  if (!bp) return { tipo: 'pagina', fisica, impresa: null, romana: false, origen: 'ninguno', confianza: 0 };
  return {
    tipo: 'pagina',
    fisica,
    impresa: bp < 0 ? aRomano(-bp) : String(bp),
    romana: bp < 0,
    origen: conf >= 0.9 ? 'leido' : 'deducido',
    confianza: Math.max(0, Math.min(1, conf)),
  };
}

// ---------------------------------------------------------------------------
// La migración
// ---------------------------------------------------------------------------

interface UnidadMigrada {
  id: string;
  orden: number;
  ancla: AnclaPagina | AnclaTiempo;
  t0?: number;
  t1?: number;
  pdf?: number;
}

class Migracion {
  readonly informe: InformeMigracion;
  private readonly s: SqlWasm;
  private tablas = new Set<string>();
  private meta: Record<string, string> = {};
  private id = '';
  private unidades: UnidadMigrada[] = [];
  private unidadPorPdf = new Map<number, UnidadMigrada>();
  private unidadPorPagina = new Map<number, UnidadMigrada>();
  private fragmentoPorChunk = new Map<number, string>();
  private espacioBase: EspacioVectorial | null = null;
  private espaciosCreados = new Set<string>();
  private fotogramas: Array<{ t: number; clave: string }> = [];

  constructor(private readonly v3: SqlWasm, private readonly archivo: ArchivoSpdf, private readonly opciones: OpcionesMigracion) {
    this.s = archivo.sqlSync;
    this.informe = {
      documento: '', titulo: '', tipo: 'pdf', versionOrigen: '?', unidades: 0, fragmentos: 0, figuras: 0, secciones: 0,
      vectores: {}, blobs: 0, bytesBlobs: 0, folios: null, idioma: { v3: null, final: null }, ignorado: {}, avisos: [], ms: 0,
    };
  }

  private filas<T = Fila>(consulta: string, ...p: ValorSQL[]): T[] {
    return this.v3.ejecutarSync<T>(consulta, p);
  }

  private columnas(tabla: string): Set<string> {
    if (!this.tablas.has(tabla)) return new Set();
    return new Set(this.filas<{ name: string }>(`PRAGMA table_info("${tabla}")`).map((f) => f.name));
  }

  private cuenta(tabla: string, donde = ''): number {
    if (!this.tablas.has(tabla)) return 0;
    const [f] = this.filas<{ n: number }>(`SELECT count(*) AS n FROM "${tabla}" ${donde}`);
    return f?.n ?? 0;
  }

  private ignorar(clave: string, n: number): void {
    if (n > 0) this.informe.ignorado[clave] = (this.informe.ignorado[clave] ?? 0) + n;
  }

  private blob(clave: string, mime: string, datos: Uint8Array): void {
    this.s.ejecutarSync('INSERT OR REPLACE INTO blobs (clave, mime, datos) VALUES (?, ?, ?)', [clave, mime, datos]);
    this.informe.blobs++;
    this.informe.bytesBlobs += datos.byteLength;
  }

  private espacio(sufijo: '' | '+contexto' | '+fotogramas', modalidades: Modalidad[]): string | null {
    const base = this.espacioBase;
    if (!base) return null;
    const id = `${base.id}${sufijo}`;
    if (!this.espaciosCreados.has(id)) {
      this.s.ejecutarSync(
        `INSERT OR REPLACE INTO espacios (id, proveedor, modelo, version, dims, normalizado, modalidades, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, base.proveedor, base.modelo, sufijo ? `${base.version ?? 'v3'}${sufijo}` : (base.version ?? null), base.dims, base.normalizado ? 1 : 0,
          JSON.stringify(sufijo === '+fotogramas' ? ['texto', 'imagen'] : modalidades), new Date().toISOString()],
      );
      this.espaciosCreados.add(id);
    }
    return id;
  }

  private vector(objetivo: 'fragmento' | 'unidad' | 'figura', id: string, espacio: string | null, datos: Uint8Array | null): void {
    if (!espacio || !datos || !this.espacioBase) return;
    if (datos.byteLength !== this.espacioBase.dims * 4) {
      this.ignorar(`vectores con dimensiones distintas de ${this.espacioBase.dims}`, 1);
      return;
    }
    this.s.ejecutarSync('INSERT OR REPLACE INTO vectores (objetivo, id, espacio, documento, valores) VALUES (?, ?, ?, ?, ?)', [objetivo, id, espacio, this.id, datos]);
    this.informe.vectores[espacio] = (this.informe.vectores[espacio] ?? 0) + 1;
  }

  async ejecutar(crudos: Uint8Array): Promise<void> {
    this.tablas = new Set(this.filas<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((f) => f.name));
    if (this.tablas.has('metadata')) {
      for (const f of this.filas('SELECT key, value FROM metadata')) this.meta[txt(f.key)] = txt(f.value);
    }
    const meta = this.meta;
    this.informe.versionOrigen = meta.schema_version || '?';
    const medio = (meta.media_type || 'pdf').toLowerCase();
    const esMedio = medio === 'video' || medio === 'audio';

    // --- Original -------------------------------------------------------
    const original = this.tablas.has('media_blob')
      ? this.filas('SELECT data, mime_type, original_filename, original_size, sha256_hash FROM media_blob ORDER BY id LIMIT 1')[0]
      : undefined;
    const datosOriginal = original ? bytesDe(original.data) : null;
    let huella = txt(original?.sha256_hash) || meta.source_hash?.replace(/^sha256:/, '') || '';
    if (!/^[0-9a-f]{64}$/i.test(huella)) huella = await sha256(datosOriginal ?? crudos);
    huella = huella.toLowerCase();
    this.id = this.opciones.idDocumento ?? `doc_${huella.slice(0, 20)}`;
    this.informe.documento = this.id;

    // --- Espacio vectorial base ------------------------------------------
    this.prepararEspacio();

    // --- Unidades --------------------------------------------------------
    const paginas = this.tablas.has('pages') ? this.leerPaginas() : [];
    let tipo: TipoEntrada;
    if (medio === 'video') tipo = 'video';
    else if (medio === 'audio') tipo = 'audio';
    else if (medio === 'image' || medio === 'imagen') tipo = 'imagen';
    else if (medio === 'pdf') tipo = datosOriginal && pareceEscaneado(datosOriginal, paginas.length) ? 'pdf_escaneado' : 'pdf';
    else tipo = 'documento';
    this.informe.tipo = tipo;

    if (esMedio) this.unidadesDeMedio(paginas, medio);
    else this.unidadesDePaginas(paginas);
    this.informe.unidades = this.unidades.length;

    // --- Secciones, fragmentos, figuras ------------------------------------
    const rutas = this.secciones(esMedio);
    this.fragmentos(esMedio, rutas);
    this.figuras(esMedio);

    // --- Documento ---------------------------------------------------------
    const textoMuestra = paginas.map((p) => textoLimpio(p.text)).join('\n').slice(0, 60000);
    const metadatos = this.metadatos(textoMuestra);
    this.informe.titulo = metadatos.titulo;
    const duracion = esMedio ? this.duracion() : undefined;
    const ahora = new Date().toISOString();
    const mime = txt(original?.mime_type) || (tipo === 'pdf' || tipo === 'pdf_escaneado' ? 'application/pdf' : tipo === 'video' ? 'video/mp4' : tipo === 'audio' ? 'audio/mpeg' : 'application/octet-stream');
    const doc: Documento = {
      id: this.id,
      tipo,
      metadatos,
      estado: 'listo',
      huella,
      original: '',
      mime,
      bytes: num(original?.original_size) ?? datosOriginal?.byteLength ?? 0,
      unidades: this.unidades.length,
      creado: isoConZona(meta.created_at ?? ''),
      actualizado: ahora,
      bibliotecas: this.opciones.bibliotecas ?? [],
    };
    if (duracion !== undefined) doc.duracion = duracion;
    this.s.ejecutarSync(
      `INSERT INTO documentos (id, tipo, metadatos, estado, huella, original, mime, bytes, unidades, duracion, creado, actualizado,
         bibliotecas, titulo, autores, anio, idioma) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [doc.id, doc.tipo, JSON.stringify(doc.metadatos), doc.estado, doc.huella, doc.original, doc.mime, doc.bytes, doc.unidades,
        doc.duracion ?? null, doc.creado, doc.actualizado, JSON.stringify(doc.bibliotecas), metadatos.titulo, autoresPlanos(metadatos) || null,
        metadatos.anio ?? null, metadatos.idioma ?? null],
    );

    if (datosOriginal && this.opciones.incrustarOriginal !== false) this.blob('original', mime, datosOriginal);
    else if (datosOriginal) this.informe.avisos.push('El original no se ha incrustado (incrustarOriginal: false): hay que subirlo al almacén aparte.');
    else this.informe.avisos.push('El SPDF v3 no traía el original.');

    // --- Lo que no tiene sitio en v4 -------------------------------------
    this.ignorar('cross_modal_links', this.cuenta('cross_modal_links'));
    this.ignorar('scenes', this.cuenta('scenes'));
    this.ignorar('audio_scenes', this.cuenta('audio_scenes'));
    this.ignorar('speaker_turns', this.cuenta('speaker_turns'));
    this.ignorar('model_checkpoint', this.cuenta('model_checkpoint'));
    this.ignorar('speakers.voice_embedding', this.cuenta('speakers', 'WHERE voice_embedding IS NOT NULL'));
    this.ignorar('sections.embedding', this.cuenta('sections', 'WHERE embedding IS NOT NULL'));
    this.ignorar('chunk_contexts.context_after', this.cuenta('chunk_contexts', "WHERE context_after IS NOT NULL AND context_after <> ''"));
    if (!this.opciones.miniaturasFiguras) this.ignorar('images.thumbnail', this.cuenta('images'));

    // --- Clave/valor y procedencia --------------------------------------
    const kv: Array<[string, string]> = [
      ['migrado_de', `spdf ${this.informe.versionOrigen}`],
      ['migrado', ahora],
      ['huella_original', huella],
    ];
    if (meta.citation_key) kv.push(['v3_clave_cita', meta.citation_key]);
    if (meta.page_numbering_strategy) kv.push(['v3_estrategia_folios', meta.page_numbering_strategy]);
    for (const [k, v] of kv) this.s.ejecutarSync('INSERT OR REPLACE INTO spdf (clave, valor) VALUES (?, ?)', [k, v]);

    this.s.ejecutarSync('INSERT INTO procedencia (documento, fase, proveedor, detalle, ms, cuando) VALUES (?, ?, ?, ?, ?, ?)', [
      this.id, 'migracion', LECTOR_V3,
      JSON.stringify({
        version_origen: this.informe.versionOrigen,
        metadatos_v3: meta,
        folios: this.informe.folios,
        ignorado: this.informe.ignorado,
        avisos: this.informe.avisos,
      }),
      null, ahora,
    ]);
  }

  // -------------------------------------------------------------------------

  private prepararEspacio(): void {
    let dims = Number(this.meta.embedding_dim) || 0;
    let muestra: Uint8Array | null = null;
    if (this.tablas.has('embeddings')) {
      const [f] = this.filas('SELECT vector FROM embeddings LIMIT 1');
      muestra = bytesDe(f?.vector);
    }
    if (!muestra && this.tablas.has('video_embeddings')) {
      const [f] = this.filas('SELECT vector FROM video_embeddings LIMIT 1');
      muestra = bytesDe(f?.vector);
    }
    if (!dims && muestra) dims = muestra.byteLength / 4;
    if (!dims || !muestra) return;
    const modelo = this.meta.embedding_model || 'Qwen/Qwen3-VL-Embedding-2B';
    const slug = (modelo.split('/').pop() ?? modelo).toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
    const n = norma(new Float32Array(muestra.slice().buffer));
    const modalidades: Modalidad[] = ['texto', 'imagen'];
    if (this.cuenta('video_embeddings', "WHERE embedding_type = 'direct_video'") > 0) modalidades.push('video');
    this.espacioBase = {
      id: `${slug}@${dims}`,
      proveedor: 'inferbox',
      modelo,
      version: 'v3',
      dims,
      normalizado: Math.abs(n - 1) < 1e-3,
      modalidades,
    };
    this.espacio('', modalidades);
  }

  private leerPaginas(): Fila[] {
    const cols = this.columnas('pages');
    const conf = cols.has('confidence') ? 'confidence' : '1 AS confidence';
    const bp = cols.has('book_page') ? 'book_page' : '0 AS book_page';
    return this.filas(`SELECT id, pdf_page, ${bp}, text, ${conf} FROM pages ORDER BY pdf_page, id`);
  }

  private unidadesDePaginas(paginas: Fila[]): void {
    const previas = new Map<number, Uint8Array>();
    if (this.tablas.has('previews')) {
      for (const f of this.filas('SELECT pdf_page, thumbnail FROM previews')) {
        const b = bytesDe(f.thumbnail);
        const p = num(f.pdf_page);
        if (b && p !== null) previas.set(p, b);
      }
    }
    // Anclas de v3 y, si se pide, revisión con @scholaris/folios.
    const anclasV3 = paginas.map((p, i) => anclaDeV3(i + 1, num(p.book_page), num(p.confidence) ?? 0));
    let anclas = anclasV3;
    if (this.opciones.repararFolios !== false && paginas.length) {
      const entrada: PaginaFolio[] = paginas.map((p, i) => {
        const a = anclasV3[i] as AnclaPagina;
        return { fisica: i + 1, folio: a.origen === 'leido' ? a.impresa : null, texto: textoLimpio(p.text), vacia: !textoLimpio(p.text).trim() };
      });
      const r = deducirFolios(entrada);
      const lecturasV3 = anclasV3.filter((a) => a.origen === 'leido').length;
      let cambiados = 0;
      anclas = anclasV3.map((a, i) => {
        const f = r.paginas[i] as FolioPagina;
        let nueva: AnclaPagina = a;
        if (r.estrategia === 'ninguno' && lecturasV3 === 0) {
          // v3 numeró sin haber leído nada: no se conserva lo inventado.
          nueva = { tipo: 'pagina', fisica: a.fisica, impresa: null, romana: false, origen: 'ninguno', confianza: 0 };
        } else if (f.origen === 'leido' || (f.origen === 'deducido' && f.confianza >= 0.8) || f.tipoPagina === 'lamina' || f.tipoPagina === 'portada') {
          nueva = { tipo: 'pagina', fisica: a.fisica, impresa: f.impresa, romana: f.romana, origen: f.origen, confianza: f.confianza };
        }
        if (nueva.impresa !== a.impresa) cambiados++;
        return nueva;
      });
      this.informe.folios = {
        revisados: true,
        cambiados,
        leidos: anclas.filter((a) => a.origen === 'leido').length,
        deducidos: anclas.filter((a) => a.origen === 'deducido').length,
        ninguno: anclas.filter((a) => a.origen === 'ninguno').length,
      };
      if (cambiados) this.informe.avisos.push(`Folios: ${cambiados} página(s) corregidas respecto a v3.`);
      for (const av of r.avisos) this.informe.avisos.push(`Folios: ${av}`);
    }

    paginas.forEach((p, i) => {
      // El contrato numera las unidades desde 0 (la página física 1 es la unidad 0); el id conserva el número de v3.
      const orden = i;
      const pdf = num(p.pdf_page) ?? i + 1;
      const ancla = { ...(anclas[i] as AnclaPagina), fisica: i + 1 };
      const id = `${this.id}:u${i + 1}`;
      const u: UnidadMigrada = { id, orden, ancla, pdf };
      let miniatura: string | null = null;
      const prev = previas.get(pdf);
      if (prev) {
        const mime = mimeImagen(prev);
        miniatura = `paginas/${String(pdf).padStart(4, '0')}.${EXTENSION[mime] ?? 'jpg'}`;
        this.blob(miniatura, mime, prev);
      }
      this.s.ejecutarSync(
        `INSERT INTO unidades (id, documento, orden, ancla, texto, lector, confianza, impresa, miniatura) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, this.id, orden, JSON.stringify(ancla), textoLimpio(p.text), LECTOR_V3, 1, ancla.impresa, miniatura],
      );
      this.unidades.push(u);
      if (!this.unidadPorPdf.has(pdf)) this.unidadPorPdf.set(pdf, u);
      const pid = num(p.id);
      if (pid !== null) this.unidadPorPagina.set(pid, u);
    });
  }

  private unidadesDeMedio(paginas: Fila[], medio: string): void {
    const hablantes = new Map<number, string>();
    if (this.tablas.has('speakers')) {
      for (const f of this.filas('SELECT id, name FROM speakers')) {
        const id = num(f.id);
        if (id !== null) hablantes.set(id, txt(f.name) || `Hablante ${id + 1}`);
      }
    }
    // Fotogramas: se guardan antes para poder asignar imagen a cada tramo.
    if (this.tablas.has('video_frames')) {
      for (const f of this.filas('SELECT id, timestamp_ms, thumbnail FROM video_frames ORDER BY timestamp_ms')) {
        const b = bytesDe(f.thumbnail);
        if (!b) continue;
        const mime = mimeImagen(b);
        const clave = `fotogramas/${txt(f.id)}.${EXTENSION[mime] ?? 'jpg'}`;
        this.blob(clave, mime, b);
        this.fotogramas.push({ t: (num(f.timestamp_ms) ?? 0) / 1000, clave });
      }
    }
    const preferida = medio === 'audio' ? ['audio_segments', 'video_segments'] : ['video_segments', 'audio_segments'];
    let segmentos: Fila[] = [];
    for (const t of preferida) {
      if (this.cuenta(t) > 0) {
        segmentos = this.filas(`SELECT id, start_ms, end_ms, text, speaker_id, confidence FROM "${t}" ORDER BY start_ms, id`);
        break;
      }
    }
    const tramos: Array<{ t0: number; t1: number; texto: string; hablante?: string; confianza: number }> = [];
    if (segmentos.length) {
      for (const s of segmentos) {
        const sp = num(s.speaker_id);
        const c = num(s.confidence) ?? 0;
        const tr: { t0: number; t1: number; texto: string; hablante?: string; confianza: number } = {
          t0: (num(s.start_ms) ?? 0) / 1000, t1: (num(s.end_ms) ?? 0) / 1000, texto: textoLimpio(s.text), confianza: c > 0 ? c : 0.5,
        };
        if (sp !== null) tr.hablante = hablantes.get(sp) ?? `Hablante ${sp + 1}`;
        tramos.push(tr);
      }
    } else {
      // Sin segmentos: las «páginas» de v3 (ventanas de ~30 s) son las unidades.
      const tiempos = this.tiemposDeChunks();
      for (const p of paginas) {
        const t = tiempos.porPagina.get(num(p.id) ?? -1);
        tramos.push({ t0: t?.[0] ?? 0, t1: t?.[1] ?? 0, texto: textoLimpio(p.text), confianza: 0.5 });
      }
      this.informe.avisos.push('Sin segmentos de transcripción: las unidades son las ventanas de v3.');
    }
    tramos.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
    tramos.forEach((tr, i) => {
      const orden = i;
      const ancla: AnclaTiempo = { tipo: 'tiempo', t0: tr.t0, t1: tr.t1 };
      if (tr.hablante) ancla.hablante = tr.hablante;
      const id = `${this.id}:u${i + 1}`;
      const imagen = this.fotogramas.find((f) => f.t >= tr.t0 && f.t < Math.max(tr.t1, tr.t0 + 0.001))?.clave ?? null;
      this.s.ejecutarSync(
        `INSERT INTO unidades (id, documento, orden, ancla, texto, lector, confianza, t0, t1, imagen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, this.id, orden, JSON.stringify(ancla), tr.texto, `${LECTOR_V3}:transcripcion`, tr.confianza, tr.t0, tr.t1, imagen],
      );
      this.unidades.push({ id, orden, ancla, t0: tr.t0, t1: tr.t1 });
    });
  }

  /** Tiempos de cada chunk y de cada página de v3 (chunks.start_ms o media_segments). */
  private tiemposDeChunks(): { porChunk: Map<number, [number, number]>; porPagina: Map<number, [number, number]> } {
    const porChunk = new Map<number, [number, number]>();
    const porPagina = new Map<number, [number, number]>();
    const ms = new Map<number, [number, number]>();
    if (this.tablas.has('media_segments')) {
      for (const f of this.filas('SELECT chunk_id, start_time, end_time FROM media_segments')) {
        const c = num(f.chunk_id);
        if (c !== null) ms.set(c, [num(f.start_time) ?? 0, num(f.end_time) ?? 0]);
      }
    }
    if (this.tablas.has('chunks')) {
      const cols = this.columnas('chunks');
      const conTiempo = cols.has('start_ms');
      for (const f of this.filas(`SELECT id, page_id ${conTiempo ? ', start_ms, end_ms' : ''} FROM chunks`)) {
        const c = num(f.id);
        if (c === null) continue;
        const a = conTiempo ? num(f.start_ms) : null, b = conTiempo ? num(f.end_ms) : null;
        const t: [number, number] | undefined = a !== null && b !== null ? [a / 1000, b / 1000] : ms.get(c);
        if (!t) continue;
        porChunk.set(c, t);
        const pg = num(f.page_id);
        if (pg !== null) {
          const prev = porPagina.get(pg);
          porPagina.set(pg, prev ? [Math.min(prev[0], t[0]), Math.max(prev[1], t[1])] : t);
        }
      }
    }
    return { porChunk, porPagina };
  }

  private unidadEnTiempo(t0: number, t1: number): UnidadMigrada | undefined {
    let mejor: UnidadMigrada | undefined;
    let solape = -Infinity;
    for (const u of this.unidades) {
      const a = u.t0 ?? 0, b = u.t1 ?? a;
      const s = Math.min(b, Math.max(t1, t0 + 0.001)) - Math.max(a, t0);
      const v = s > 0 ? s : -Math.abs(a - t0) - 1e6;
      if (v > solape) { solape = v; mejor = u; }
    }
    return mejor;
  }

  /** Secciones de v3 → v4. Devuelve la ruta de títulos de cada sección (id v3 → ruta). */
  private secciones(esMedio: boolean): { porId: Map<number, string[]>; lista: Array<{ id: number; ruta: string[]; desde: number; hasta: number; nivel: number }> } {
    const porId = new Map<number, string[]>();
    const lista: Array<{ id: number; ruta: string[]; desde: number; hasta: number; nivel: number }> = [];
    if (!this.tablas.has('sections')) return { porId, lista };
    const filas = this.filas('SELECT id, parent_id, section_type, title, start_page, end_page, start_ms, end_ms, summary_text FROM sections ORDER BY id');
    const porV3 = new Map(filas.map((f) => [num(f.id) as number, f]));
    const titulo = (f: Fila) => limpiarEspacios(txt(f.title)) || TITULOS_SECCION[txt(f.section_type)] || 'Sección';
    const ruta = (f: Fila, vistos = new Set<number>()): string[] => {
      const id = num(f.id) as number;
      if (vistos.has(id)) return [titulo(f)];
      vistos.add(id);
      const padre = num(f.parent_id);
      const pf = padre !== null ? porV3.get(padre) : undefined;
      return pf ? [...ruta(pf, vistos), titulo(f)] : [titulo(f)];
    };
    for (const f of filas) {
      const id = num(f.id) as number;
      const r = ruta(f);
      porId.set(id, r);
      let desde: UnidadMigrada | undefined, hasta: UnidadMigrada | undefined;
      let a: number, b: number;
      if (esMedio) {
        a = (num(f.start_ms) ?? 0) / 1000; b = (num(f.end_ms) ?? 0) / 1000;
        desde = this.unidadEnTiempo(a, a); hasta = this.unidadEnTiempo(b, b);
      } else {
        a = num(f.start_page) ?? 1; b = num(f.end_page) ?? a;
        desde = this.unidadPorPdf.get(a) ?? this.unidades[0]; hasta = this.unidadPorPdf.get(b);
      }
      if (!desde) continue;
      const padre = num(f.parent_id);
      this.s.ejecutarSync(
        'INSERT INTO secciones (id, documento, padre, nivel, titulo, unidad_desde, unidad_hasta, resumen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [`${this.id}:s${id}`, this.id, padre !== null && porV3.has(padre) ? `${this.id}:s${padre}` : null, r.length, r[r.length - 1] as string,
          desde.id, hasta?.id ?? null, esVacio(f.summary_text) ? null : txt(f.summary_text)],
      );
      lista.push({ id, ruta: r, desde: a, hasta: b, nivel: r.length });
      this.informe.secciones++;
    }
    return { porId, lista };
  }

  private fragmentos(esMedio: boolean, rutas: ReturnType<Migracion['secciones']>): void {
    if (!this.tablas.has('chunks')) return;
    const contextos = new Map<number, Fila>();
    if (this.tablas.has('chunk_contexts')) {
      for (const f of this.filas('SELECT chunk_id, context_before, context_embedding, section_id FROM chunk_contexts')) {
        const c = num(f.chunk_id);
        if (c !== null) contextos.set(c, f);
      }
    }
    const cols = this.columnas('chunks');
    const sel = ['id', 'page_id', 'chunk_index', 'text', cols.has('pdf_page') ? 'pdf_page' : 'NULL AS pdf_page'].join(', ');
    const chunks = this.filas(`SELECT ${sel} FROM chunks`);
    const tiempos = esMedio ? this.tiemposDeChunks() : null;
    const clave = (f: Fila): [number, number, number] => {
      const id = num(f.id) ?? 0;
      if (esMedio) return [tiempos?.porChunk.get(id)?.[0] ?? 0, num(f.chunk_index) ?? 0, id];
      const u = this.unidadPorPdf.get(num(f.pdf_page) ?? -1) ?? this.unidadPorPagina.get(num(f.page_id) ?? -1);
      return [u ? u.orden : -1, num(f.chunk_index) ?? 0, id];
    };
    chunks.sort((a, b) => {
      const x = clave(a), y = clave(b);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
    const seccionDe = (chunkId: number, posicion: number): string[] => {
      const ctx = contextos.get(chunkId);
      const sid = ctx ? num(ctx.section_id) : null;
      if (sid !== null && rutas.porId.has(sid)) return rutas.porId.get(sid) as string[];
      // La sección más profunda que contiene la posición (página o segundo).
      let mejor: { ruta: string[]; nivel: number } | null = null;
      for (const s of rutas.lista) {
        if (posicion >= s.desde && posicion <= s.hasta && (!mejor || s.nivel > mejor.nivel)) mejor = { ruta: s.ruta, nivel: s.nivel };
      }
      return mejor?.ruta ?? [];
    };
    const contextoBase = this.espacio('', this.espacioBase?.modalidades ?? ['texto']);
    let orden = 0;
    for (const c of chunks) {
      const chunkId = num(c.id) as number;
      let unidad: UnidadMigrada | undefined;
      let ancla: AnclaPagina | AnclaTiempo;
      let posicion: number;
      if (esMedio) {
        const t = tiempos?.porChunk.get(chunkId) ?? [0, 0];
        unidad = this.unidadEnTiempo(t[0], t[1]);
        const a: AnclaTiempo = { tipo: 'tiempo', t0: t[0], t1: t[1] };
        // Hablante si todos los tramos que cubre el fragmento son de la misma persona.
        const voces = new Set(this.unidades.filter((u) => (u.t0 ?? 0) < t[1] && (u.t1 ?? 0) > t[0]).map((u) => (u.ancla as AnclaTiempo).hablante));
        if (voces.size === 1) { const [h] = [...voces]; if (h) a.hablante = h; }
        ancla = a;
        posicion = t[0];
      } else {
        unidad = this.unidadPorPdf.get(num(c.pdf_page) ?? -1) ?? this.unidadPorPagina.get(num(c.page_id) ?? -1) ?? this.unidades[0];
        ancla = (unidad?.ancla as AnclaPagina) ?? { tipo: 'pagina', fisica: 1, impresa: null, romana: false, origen: 'ninguno', confianza: 0 };
        posicion = unidad?.pdf ?? 1;
      }
      if (!unidad) continue;
      orden++;
      const id = `${this.id}:f${chunkId}`;
      const ctx = contextos.get(chunkId);
      const contexto = ctx && !esVacio(ctx.context_before) ? colaDeTexto(txt(ctx.context_before)) : '';
      this.s.ejecutarSync(
        'INSERT INTO fragmentos (id, documento, unidad, orden, texto, contexto, seccion, ancla) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, this.id, unidad.id, orden, textoLimpio(c.text), contexto, JSON.stringify(seccionDe(chunkId, posicion)), JSON.stringify(ancla)],
      );
      this.fragmentoPorChunk.set(chunkId, id);
      if (ctx) this.vector('fragmento', id, this.espacio('+contexto', ['texto']), bytesDe(ctx.context_embedding));
    }
    this.informe.fragmentos = orden;

    // Vectores de texto de los fragmentos
    if (this.tablas.has('embeddings')) {
      for (const f of this.filas('SELECT chunk_id, vector FROM embeddings')) {
        const id = this.fragmentoPorChunk.get(num(f.chunk_id) ?? -1);
        if (id) this.vector('fragmento', id, contextoBase, bytesDe(f.vector));
        else this.ignorar('embeddings sin fragmento', 1);
      }
    }
    // Vectores compuestos (transcripción + fotogramas) de los fragmentos de vídeo
    if (this.tablas.has('video_embeddings')) {
      for (const f of this.filas("SELECT chunk_id, vector FROM video_embeddings WHERE embedding_type = 'composite_segment'")) {
        const id = this.fragmentoPorChunk.get(num(f.chunk_id) ?? -1);
        if (id) this.vector('fragmento', id, this.espacio('+fotogramas', ['texto', 'imagen']), bytesDe(f.vector));
        else this.ignorar('video_embeddings compuestos sin fragmento', 1);
      }
    }
  }

  private figuras(esMedio: boolean): void {
    const base = this.espacio('', this.espacioBase?.modalidades ?? ['texto']);
    const insertar = (id: string, unidad: string, imagen: string, descripcion: string | null, ancla: unknown) => {
      this.s.ejecutarSync(
        'INSERT INTO figuras (id, documento, unidad, imagen, pie, descripcion, ancla) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, this.id, unidad, imagen, null, descripcion, JSON.stringify(ancla)],
      );
      this.informe.figuras++;
    };
    // Imágenes de páginas
    if (this.tablas.has('images')) {
      const filas = this.filas('SELECT id, pdf_page, mime_type, full_image, thumbnail, ocr_text, description, embedding FROM images ORDER BY pdf_page, image_index, id');
      for (const f of filas) {
        const datos = bytesDe(f.full_image) ?? bytesDe(f.thumbnail);
        if (!datos) { this.ignorar('images sin datos', 1); continue; }
        const v3id = txt(f.id);
        const mime = txt(f.mime_type) || mimeImagen(datos);
        const clave = `figuras/${v3id}.${EXTENSION[mime] ?? 'jpg'}`;
        this.blob(clave, mime, datos);
        if (this.opciones.miniaturasFiguras) {
          const mini = bytesDe(f.thumbnail);
          if (mini) this.blob(`figuras/${v3id}-mini.${EXTENSION[mimeImagen(mini)] ?? 'jpg'}`, mimeImagen(mini), mini);
        }
        const u = this.unidadPorPdf.get(num(f.pdf_page) ?? -1) ?? this.unidades[0];
        if (!u) continue;
        const partes = [esVacio(f.description) ? '' : limpiarEspacios(txt(f.description)), esVacio(f.ocr_text) ? '' : `Texto en la imagen: ${limpiarEspacios(txt(f.ocr_text))}`].filter(Boolean);
        const id = `${this.id}:i${v3id}`;
        insertar(id, u.id, clave, partes.join('\n\n') || null, u.ancla);
        this.vector('figura', id, base, bytesDe(f.embedding));
      }
    }
    if (!esMedio) return;
    // Fotogramas clave
    if (this.tablas.has('video_frames')) {
      for (const f of this.filas('SELECT id, timestamp_ms, thumbnail, scene_description, embedding FROM video_frames ORDER BY timestamp_ms')) {
        const b = bytesDe(f.thumbnail);
        if (!b) continue;
        const t = (num(f.timestamp_ms) ?? 0) / 1000;
        const clave = `fotogramas/${txt(f.id)}.${EXTENSION[mimeImagen(b)] ?? 'jpg'}`;
        const u = this.unidadEnTiempo(t, t);
        if (!u) continue;
        const id = `${this.id}:k${txt(f.id)}`;
        insertar(id, u.id, clave, esVacio(f.scene_description) ? `Fotograma en ${tiempoACadena(t)}` : limpiarEspacios(txt(f.scene_description)), { tipo: 'tiempo', t0: t, t1: t });
        this.vector('figura', id, base, bytesDe(f.embedding));
      }
    }
    // Vectores del vídeo directo: tramos visuales con su instante
    if (this.tablas.has('video_embeddings')) {
      for (const f of this.filas("SELECT id, vector, start_ms, end_ms FROM video_embeddings WHERE embedding_type = 'direct_video' ORDER BY start_ms")) {
        const t0 = (num(f.start_ms) ?? 0) / 1000, t1 = (num(f.end_ms) ?? 0) / 1000;
        const u = this.unidadEnTiempo(t0, t1);
        if (!u) continue;
        const medio = (t0 + t1) / 2;
        let imagen = '';
        let mejor = Infinity;
        for (const fr of this.fotogramas) {
          const d = Math.abs(fr.t - medio);
          if (d < mejor) { mejor = d; imagen = fr.clave; }
        }
        const id = `${this.id}:v${txt(f.id)}`;
        insertar(id, u.id, imagen, `Tramo de vídeo ${tiempoACadena(t0)}-${tiempoACadena(t1)}`, { tipo: 'tiempo', t0, t1 });
        this.vector('figura', id, base, bytesDe(f.vector));
      }
    }
  }

  private duracion(): number | undefined {
    const d = Number(this.meta.duration_seconds);
    if (Number.isFinite(d) && d > 0) return d;
    for (const t of ['video_metadata', 'audio_metadata']) {
      if (this.cuenta(t) > 0) {
        const [f] = this.filas(`SELECT duration_ms FROM "${t}" LIMIT 1`);
        const ms = num(f?.duration_ms);
        if (ms) return ms / 1000;
      }
    }
    const fin = Math.max(0, ...this.unidades.map((u) => u.t1 ?? 0));
    return fin || undefined;
  }

  private metadatos(muestra: string): MetadatosDocumento {
    const m = this.meta;
    const procedencia: NonNullable<MetadatosDocumento['procedencia']> = {};
    const fuente = /user/i.test(m.extraction_source ?? '') ? 'usuario' : 'lectura';
    const conf = (k: string) => {
      const c = Number(m[`${k}_confidence`]);
      return Number.isFinite(c) ? c : null;
    };
    const anotar = (campo: string, clave: string) => {
      const c = conf(clave);
      if (c !== null && c > 0) procedencia[campo] = { fuente, confianza: c };
    };

    const tituloBruto = !esVacio(m.title) ? (m.title as string) : (m.source_filename ?? 'Sin título');
    const titulo = limpiarTitulo(tituloBruto) || 'Sin título';
    if (titulo !== limpiarEspacios(tituloBruto)) this.informe.avisos.push(`Título limpiado: «${limpiarEspacios(tituloBruto)}» → «${titulo}».`);
    const autores: Autor[] = parsearAutores(m.authors);
    const md: MetadatosDocumento = { titulo, autores };
    anotar('titulo', 'title');
    if (autores.length) anotar('autores', 'authors');

    const anio = Number.parseInt(m.year ?? '', 10);
    if (Number.isFinite(anio) && anio > 0 && anio <= new Date().getFullYear() + 1) { md.anio = anio; anotar('anio', 'year'); }

    const idiomaV3 = normalizarIdioma(m.language);
    this.informe.idioma.v3 = idiomaV3;
    let idioma = idiomaV3;
    const det = detectarIdioma(muestra);
    if (det && det.idioma !== idiomaV3) {
      const deV3 = idiomaV3 ? det.puntos[idiomaV3] ?? 0 : 0;
      const delDetectado = det.puntos[det.idioma] ?? 0;
      if (!idiomaV3 || delDetectado >= 2 * deV3) {
        idioma = det.idioma;
        procedencia.idioma = { fuente: 'lectura', confianza: det.confianza };
        this.informe.avisos.push(`Idioma corregido: v3 decía «${m.language ?? ''}», el texto es «${det.idioma}».`);
      }
    } else if (idioma) anotar('idioma', 'language');
    if (idioma) md.idioma = idioma;
    this.informe.idioma.final = idioma;

    const doi = (m.doi ?? '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
    if (/^10\.\d{4,9}\/\S+$/.test(doi)) { md.doi = doi; anotar('doi', 'doi'); }
    if (/^https?:\/\//.test(m.url ?? '')) md.url = (m.url as string).trim();
    if (!esVacio(m.abstract)) { md.resumen = limpiarEspacios(m.abstract as string); anotar('resumen', 'abstract'); }
    if (!esVacio(m.publisher)) md.editorial = limpiarEspacios(m.publisher as string);
    if (!esVacio(m.journal)) md.revista = limpiarEspacios(m.journal as string);
    if (!esVacio(m.volume)) md.volumen = limpiarEspacios(m.volume as string);
    if (!esVacio(m.issue)) md.numero = limpiarEspacios(m.issue as string);
    if (!esVacio(m.pages)) md.paginas = limpiarEspacios(m.pages as string);
    if (!esVacio(m.isbn)) md.isbn = limpiarEspacios(m.isbn as string);
    const csl = CSL[(m.entry_type ?? '').toLowerCase()];
    if (csl) md.tipoCSL = csl;
    if (Object.keys(procedencia).length) md.procedencia = procedencia;
    return md;
  }
}
