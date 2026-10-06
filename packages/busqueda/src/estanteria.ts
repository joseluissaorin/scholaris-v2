/**
 * Acceso de la búsqueda a la estantería (esquema SPDF 4.0) a través del puerto SQL.
 * Solo lecturas; todas las consultas van parametrizadas.
 */
import type { Ancla, Documento, Filtros, Fragmento, MetadatosDocumento, SQL, ValorSQL } from '@scholaris/nucleo';
import { deRomano } from '@scholaris/nucleo';
import { plegar } from './texto.js';

export type DocumentoBreve = Pick<Documento, 'id' | 'tipo' | 'metadatos'>;

export interface FilaDocumento {
  id: string;
  tipo: string;
  metadatos: string;
  titulo: string | null;
  autores: string | null;
  anio: number | null;
  idioma: string | null;
}

function json<T>(s: ValorSQL | undefined, porDefecto: T): T {
  if (typeof s !== 'string' || !s) return porDefecto;
  try { return JSON.parse(s) as T; } catch { return porDefecto; }
}

export function filaADocumento(f: FilaDocumento): DocumentoBreve {
  const metadatos = json<MetadatosDocumento>(f.metadatos, { titulo: f.titulo ?? '', autores: [] });
  return { id: f.id, tipo: f.tipo as Documento['tipo'], metadatos };
}

/** Año que cuenta para filtrar y para la lógica temporal: el de la edición original si se conoce. */
export function anioDe(m: MetadatosDocumento): number | undefined {
  return m.anioOriginal ?? m.anio;
}

/** Marcadores «?, ?, ?» para una lista IN. */
export function marcadores(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

export class Estanteria {
  private docs?: { cuando: number; filas: DocumentoBreve[]; porId: Map<string, DocumentoBreve> };
  private columnasDoc?: Set<string>;

  constructor(
    readonly sql: SQL,
    private opciones: {
      /** Resuelve bibliotecas → documentos si la estantería las guarda fuera de `documentos`. */
      documentosDeBibliotecas?: (bibliotecas: string[]) => Promise<string[]>;
      /** Validez de la caché de documentos (ms). */
      ttlDocumentos?: number;
    } = {},
  ) {}

  /** Olvida la caché de documentos (tras una ingesta o un borrado). */
  invalidar(): void { this.docs = undefined; }

  /** Todos los documentos listos, con caché corta: la estantería de un usuario cabe en memoria. */
  async documentos(): Promise<{ filas: DocumentoBreve[]; porId: Map<string, DocumentoBreve> }> {
    const ttl = this.opciones.ttlDocumentos ?? 30_000;
    if (this.docs && Date.now() - this.docs.cuando < ttl) return this.docs;
    const filas = (await this.sql.ejecutar<FilaDocumento>(
      `SELECT id, tipo, metadatos, titulo, autores, anio, idioma FROM documentos WHERE estado = 'listo' OR estado IS NULL`,
    )).map(filaADocumento);
    this.docs = { cuando: Date.now(), filas, porId: new Map(filas.map((d) => [d.id, d])) };
    return this.docs;
  }

  /** Apellidos de autores y idiomas presentes: contexto para entender consultas. */
  async contexto(): Promise<{ autores: string[]; idiomas: string[] }> {
    const { filas } = await this.documentos();
    const autores = new Set<string>(), idiomas = new Set<string>();
    for (const d of filas) {
      for (const a of [...d.metadatos.autores, ...(d.metadatos.editores ?? [])]) if (a.apellidos) autores.add(a.apellidos);
      if (d.metadatos.idioma) idiomas.add(d.metadatos.idioma.toLowerCase().slice(0, 2));
    }
    return { autores: [...autores], idiomas: [...idiomas] };
  }

  private async tieneColumna(nombre: string): Promise<boolean> {
    if (!this.columnasDoc) {
      try {
        const filas = await this.sql.ejecutar<{ name: string }>(`SELECT name FROM pragma_table_info('documentos')`);
        this.columnasDoc = new Set(filas.map((f) => f.name));
      } catch { this.columnasDoc = new Set(); }
    }
    return this.columnasDoc.has(nombre);
  }

  /**
   * Conjunto de documentos que cumplen los filtros de nivel documento, o null si
   * no hay ninguno de esos filtros (todo vale).
   */
  async documentosPermitidos(filtros: Filtros): Promise<Set<string> | null> {
    const hay = filtros.documentos?.length || filtros.bibliotecas?.length || filtros.tipos?.length || filtros.autores?.length
      || filtros.idiomas?.length || filtros.anioDesde !== undefined || filtros.anioHasta !== undefined;
    if (!hay) return null;
    const { filas } = await this.documentos();
    let enBibliotecas: Set<string> | null = null;
    if (filtros.bibliotecas?.length) {
      if (this.opciones.documentosDeBibliotecas) enBibliotecas = new Set(await this.opciones.documentosDeBibliotecas(filtros.bibliotecas));
      else if (await this.tieneColumna('bibliotecas')) {
        const fs = await this.sql.ejecutar<{ id: string; bibliotecas: string | null }>(`SELECT id, bibliotecas FROM documentos`);
        enBibliotecas = new Set(fs.filter((f) => json<string[]>(f.bibliotecas, []).some((b) => filtros.bibliotecas!.includes(b))).map((f) => f.id));
      }
    }
    const autores = filtros.autores?.map((a) => plegar(a).trim()).filter(Boolean);
    const idiomas = filtros.idiomas?.map((i) => i.toLowerCase().slice(0, 2));
    const permitidos = new Set<string>();
    for (const d of filas) {
      const m = d.metadatos;
      if (filtros.documentos?.length && !filtros.documentos.includes(d.id)) continue;
      if (enBibliotecas && !enBibliotecas.has(d.id)) continue;
      if (filtros.tipos?.length && !filtros.tipos.includes(d.tipo)) continue;
      if (idiomas?.length && !idiomas.includes((m.idioma ?? '').toLowerCase().slice(0, 2))) continue;
      const anio = anioDe(m);
      if (filtros.anioDesde !== undefined && (anio === undefined || anio < filtros.anioDesde)) continue;
      if (filtros.anioHasta !== undefined && (anio === undefined || anio > filtros.anioHasta)) continue;
      if (autores?.length) {
        const nombres = [...m.autores, ...(m.editores ?? [])].map((a) => plegar(`${a.nombre} ${a.apellidos}`));
        if (!autores.some((a) => nombres.some((n) => n.includes(a)))) continue;
      }
      permitidos.add(d.id);
    }
    return permitidos;
  }

  /** Búsqueda léxica BM25 sobre fragmentos_fts. `match` ya viene escapado (texto.consultaFts). */
  async lexica(match: string, k: number, permitidos: Set<string> | null): Promise<Array<{ id: string; puntos: number }>> {
    if (permitidos && permitidos.size === 0) return [];
    const params: ValorSQL[] = [match];
    let filtro = '';
    if (permitidos && permitidos.size <= 500) {
      filtro = ` AND f.documento IN (${marcadores(permitidos.size)})`;
      params.push(...permitidos);
    }
    params.push(permitidos && permitidos.size > 500 ? k * 4 : k);
    const filas = await this.sql.ejecutar<{ id: string; documento: string; puntos: number }>(
      `SELECT f.id AS id, f.documento AS documento, bm25(fragmentos_fts, 1.0, 0.35, 0.6) AS puntos
         FROM fragmentos_fts JOIN fragmentos f ON f.rowid = fragmentos_fts.rowid
        WHERE fragmentos_fts MATCH ?${filtro}
        ORDER BY puntos LIMIT ?`,
      ...params,
    );
    return filas.filter((f) => !permitidos || permitidos.has(f.documento)).slice(0, k).map((f) => ({ id: f.id, puntos: -f.puntos }));
  }

  /** Carga fragmentos por id, en el orden pedido, descartando los que no existan. */
  async fragmentos(ids: string[]): Promise<Map<string, Fragmento>> {
    const salida = new Map<string, Fragmento>();
    for (let i = 0; i < ids.length; i += 200) {
      const lote = ids.slice(i, i + 200);
      if (!lote.length) continue;
      const filas = await this.sql.ejecutar<{ id: string; documento: string; unidad: string; orden: number; texto: string; contexto: string; seccion: string | null; ancla: string; ancla_fin: string | null }>(
        `SELECT id, documento, unidad, orden, texto, contexto, seccion, ancla, ancla_fin FROM fragmentos WHERE id IN (${marcadores(lote.length)})`,
        ...lote,
      );
      for (const f of filas) {
        const anclaFin = json<Ancla | null>(f.ancla_fin, null);
        salida.set(f.id, {
          id: f.id, documento: f.documento, unidad: f.unidad, orden: Number(f.orden), texto: f.texto,
          contexto: f.contexto ?? '', seccion: json<string[]>(f.seccion, []), ancla: json<Ancla>(f.ancla, { tipo: 'imagen' }),
          ...(anclaFin ? { anclaFin } : {}),
        });
      }
    }
    return salida;
  }

  /** Fragmentos (id, unidad, orden) de unas unidades: para traducir aciertos visuales. */
  async fragmentosDeUnidades(unidades: string[]): Promise<Array<{ id: string; unidad: string; orden: number }>> {
    if (!unidades.length) return [];
    return this.sql.ejecutar<{ id: string; unidad: string; orden: number }>(
      `SELECT id, unidad, orden FROM fragmentos WHERE unidad IN (${marcadores(unidades.length)}) ORDER BY orden`,
      ...unidades,
    );
  }

  async figuras(ids: string[]): Promise<Array<{ id: string; documento: string; unidad: string; pie: string | null; descripcion: string | null; ancla: Ancla }>> {
    if (!ids.length) return [];
    const filas = await this.sql.ejecutar<{ id: string; documento: string; unidad: string; pie: string | null; descripcion: string | null; ancla: string }>(
      `SELECT id, documento, unidad, pie, descripcion, ancla FROM figuras WHERE id IN (${marcadores(ids.length)})`,
      ...ids,
    );
    return filas.map((f) => ({ ...f, ancla: json<Ancla>(f.ancla, { tipo: 'imagen' }) }));
  }

  async unidadesExisten(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const filas = await this.sql.ejecutar<{ id: string; documento: string }>(`SELECT id, documento FROM unidades WHERE id IN (${marcadores(ids.length)})`, ...ids);
    return new Map(filas.map((f) => [f.id, f.documento]));
  }

  /** Vector guardado de un objetivo en un espacio (para «más como esto»). */
  async vector(objetivo: 'fragmento' | 'unidad' | 'figura', id: string, espacio: string): Promise<Uint8Array | null> {
    const filas = await this.sql.ejecutar<{ valores: Uint8Array | ArrayBuffer }>(
      `SELECT valores FROM vectores WHERE objetivo = ? AND id = ? AND espacio = ?`, objetivo, id, espacio,
    );
    const v = filas[0]?.valores;
    if (!v) return null;
    return v instanceof Uint8Array ? v : new Uint8Array(v);
  }

  /**
   * «Ir a la página X»: busca la unidad cuyo folio impreso es X (o, si no hay
   * folio impreso, la página física X) en un documento.
   */
  async paginaImpresa(documento: string, folio: string): Promise<{ unidad: string; ancla: Ancla; fragmento?: string } | null> {
    const f = folio.trim();
    let filas = await this.sql.ejecutar<{ id: string; ancla: string }>(
      `SELECT id, ancla FROM unidades WHERE documento = ? AND lower(impresa) = lower(?) ORDER BY orden LIMIT 1`, documento, f,
    );
    if (!filas.length && /^\d+$/.test(f)) {
      // Sin folio impreso: se interpreta como página física.
      filas = await this.sql.ejecutar<{ id: string; ancla: string }>(
        `SELECT id, ancla FROM unidades WHERE documento = ? AND json_extract(ancla, '$.fisica') = ? ORDER BY orden LIMIT 1`, documento, Number(f),
      );
    }
    if (!filas.length && deRomano(f) === null && /^\d+$/.test(f)) {
      // Folios con prefijo («A-3») o páginas que no llevan número: la más cercana por orden de folio arábigo.
      const todas = await this.sql.ejecutar<{ id: string; ancla: string; impresa: string | null }>(
        `SELECT id, ancla, impresa FROM unidades WHERE documento = ? AND impresa IS NOT NULL ORDER BY orden`, documento,
      );
      const n = Number(f);
      let mejor: { id: string; ancla: string } | undefined, dist = Infinity;
      for (const u of todas) {
        const v = Number(u.impresa);
        if (Number.isFinite(v) && v <= n && n - v < dist) { dist = n - v; mejor = u; }
      }
      if (mejor && dist <= 2) filas = [mejor];
    }
    const u = filas[0];
    if (!u) return null;
    const fr = await this.sql.ejecutar<{ id: string }>(`SELECT id FROM fragmentos WHERE unidad = ? ORDER BY orden LIMIT 1`, u.id);
    return { unidad: u.id, ancla: json<Ancla>(u.ancla, { tipo: 'imagen' }), ...(fr[0] ? { fragmento: fr[0].id } : {}) };
  }
}
