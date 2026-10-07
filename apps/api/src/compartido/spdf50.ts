/**
 * SPDF 5.0, el estándar abierto (https://spdf.joseluissaorin.com), con la
 * biblioteca `spdf-format`. La estantería sigue en 4.1: esto solo traduce en la frontera.
 *
 * - Exportar: un documento de la estantería → un .spdf 5.0 (SQLite sin comprimir, nombres
 *   en inglés, metadatos CSL-JSON), escrito con `SpdfWriter` sobre el mismo motor
 *   sqlite-wasm que ya usa el Worker. Las anclas y la ficha se traducen con las mismas
 *   funciones que la biblioteca usa para leer el legado 4.x (las que pasa la batería de
 *   conformidad).
 * - Importar: un .spdf 5.0 → un SPDF 4.1 en memoria, que después sigue el camino de
 *   siempre (`importarSpdf`).
 *
 * `spdf-format` aún no está en npm: va como tarball versionado en `vendor/` (ver
 * `vendor/LEEME.md`).
 */
import type { Ancla, Autor, Documento, EspacioVectorial, Figura, Fragmento, MetadatosDocumento, TipoEntrada } from '@scholaris/nucleo';
import {
  autoresPlanos, crearSpdf, leerEspacios, leerFiguras, leerProcedencia, leerSecciones, leerUnidades, leerVectores, motor,
  type ArchivoSpdf, type UnidadSpdf,
} from '@scholaris/spdf';
import {
  SpdfWriter, mapLegacyAnchor, mapLegacyKind, mapLegacyMetadata, openSpdf, type Anchor, type CslItem, type CslName, type SqlEngine,
} from 'spdf-format/core';
import { wasmEngine } from 'spdf-format/wasm';
import type { PuertosUsuario } from '../puertos.js';
import { claveDe } from '../rutas/util.js';
import { prefijoDocumento } from '../rutas/subidas.js';

/** Tipo de medio del SPDF 5.0 (especificación §24; registro en la IANA en preparación). */
export const MEDIO_SPDF_50 = 'application/vnd.spdf+sqlite3';

let motorSpdf: Promise<SqlEngine> | null = null;

/** El motor de `spdf-format` sobre el sqlite-wasm ya preparado (también en workerd). */
export function motorSpdf50(): Promise<SqlEngine> {
  return (motorSpdf ??= motor().then((sqlite3) => wasmEngine({ sqlite3 })));
}

/** ¿Es un SPDF 5.x? SQLite sin comprimir con application_id «SPDF» (desplazamiento 68 de la cabecera). */
export function esSpdf50(b: Uint8Array): boolean {
  if (b.length < 100) return false;
  const cabecera = 'SQLite format 3\u0000';
  for (let i = 0; i < cabecera.length; i++) if (b[i] !== cabecera.charCodeAt(i)) return false;
  return b[68] === 0x53 && b[69] === 0x50 && b[70] === 0x44 && b[71] === 0x46;
}

// ---------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------

export interface OpcionesSpdf50 {
  /** Incrustar los binarios (páginas, figuras y, si `originales`, el original). */
  incrustar: boolean;
  originales?: boolean;
  vectores?: boolean;
  /** Tope de bytes incrustados (memoria del Worker). */
  maxIncrustado: number;
}

const MODALIDAD: Record<string, string> = { texto: 'text', imagen: 'image', audio: 'audio', video: 'video', pdf: 'pdf' };
const OBJETIVO: Record<string, 'fragment' | 'unit' | 'figure'> = { fragmento: 'fragment', unidad: 'unit', figura: 'figure' };

/** Un documento de la estantería como SPDF 5.0. */
export async function armarSpdf50(p: PuertosUsuario, d: Documento, o: OpcionesSpdf50): Promise<{ bytes: Uint8Array; omitidos: number }> {
  const engine = await motorSpdf50();
  const unidades = (await leerUnidades(p.sql, d.id)).slice().sort((a, b) => a.orden - b.orden || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const secciones = await leerSecciones(p.sql, d.id);
  const fragmentos = await p.sql.ejecutar<{ n: number; id: string; unidad: string; orden: number; texto: string; contexto: string; seccion: string | null; ancla: string; ancla_fin: string | null; texto_busqueda: string | null }>(
    'SELECT n, id, unidad, orden, texto, contexto, seccion, ancla, ancla_fin, texto_busqueda FROM fragmentos WHERE documento = ? ORDER BY orden, n', d.id,
  );
  const figuras = await leerFiguras(p.sql, d.id);
  const w = await SpdfWriter.create({ engine, generator: `scholaris-nube/${p.config.version}` });
  try {
    // Binarios: el original primero y después páginas y figuras, de 16 en 16, hasta el tope.
    const prefijo = prefijoDocumento(p.usuario.id, d.id);
    const mimes = new Map<string, string>();
    if (d.original && o.originales !== false) mimes.set(d.original, d.mime);
    for (const u of unidades) {
      if (u.imagen) mimes.set(u.imagen, 'image/jpeg');
      if (u.miniatura) mimes.set(u.miniatura, 'image/webp');
    }
    for (const g of figuras) if (g.imagen) mimes.set(g.imagen, 'image/jpeg');
    const incrustados = new Map<string, string>();
    if (o.incrustar) {
      const claves = [...mimes.keys()].sort((x, y) => Number(y === d.original) - Number(x === d.original));
      let usados = 0;
      let lleno = false;
      for (let i = 0; i < claves.length && !lleno; i += 16) {
        const leidos = await Promise.all(claves.slice(i, i + 16).map(async (clave) => ({ clave, bytes: await p.almacen.bytes(claveDe(p.usuario.id, d.id, clave)).catch(() => null) })));
        for (const { clave, bytes } of leidos) {
          if (!bytes) continue;
          if (usados + bytes.byteLength > o.maxIncrustado) { lleno = true; continue; }
          const rel = !clave.startsWith('u/') ? clave : clave.startsWith(prefijo) ? clave.slice(prefijo.length) : clave.split('/').pop()!;
          if (!incrustados.has(clave)) {
            await w.addBlob(rel, mimes.get(clave) ?? 'application/octet-stream', bytes);
            incrustados.set(clave, rel);
            usados += bytes.byteLength;
          }
        }
      }
    }
    const ref = (clave?: string | null): string | null => (clave && incrustados.has(clave) ? `blob:${incrustados.get(clave)}` : null);

    await w.setDocument({
      id: d.id,
      kind: mapLegacyKind(d.tipo),
      metadata: mapLegacyMetadata(d.metadatos, d.tipo),
      source_sha256: d.huella,
      source_ref: ref(d.original),
      mime: d.mime,
      bytes: d.bytes,
      unit_count: unidades.length,
      duration: d.duracion ?? null,
      created: d.creado,
      updated: d.actualizado,
      title: d.metadatos.titulo || null,
      authors: autoresPlanos(d.metadatos) || null,
      year: d.metadatos.anio ?? null,
      language: d.metadatos.idioma ?? null,
      rights: null,
    });
    await w.addUnits(unidades.map((u: UnidadSpdf, i) => {
      const anchor = mapLegacyAnchor(u.ancla);
      const a = anchor as Anchor & { printed?: string | null; t0?: number; t1?: number };
      return {
        id: u.id,
        ord: i + 1,
        anchor,
        text: u.texto ?? '',
        notes: u.notas?.length ? u.notas : null,
        header: u.cabecera ?? null,
        footer: u.pie ?? null,
        image: ref(u.imagen),
        thumbnail: ref(u.miniatura),
        reader: u.lector,
        confidence: u.confianza,
        printed: a.type === 'page' || a.type === 'section' ? (a.printed ?? null) : null,
        t0: a.type === 'time' ? (a.t0 ?? null) : null,
        t1: a.type === 'time' ? (a.t1 ?? null) : null,
        words: u.palabras ?? null,
      };
    }));
    await w.addSections(secciones.map((s) => ({
      id: s.id, parent: s.padre ?? null, level: s.nivel, title: s.titulo, unit_from: s.unidadDesde, unit_to: s.unidadHasta ?? null, summary: s.resumen ?? null,
    })));
    const json = (x: string | null) => { if (x === null || x === undefined || x === '') return null; try { return JSON.parse(x) as unknown; } catch { return null; } };
    await w.addFragments(fragmentos.map((f) => ({
      n: Number(f.n),
      id: f.id,
      unit: f.unidad,
      ord: Number(f.orden),
      text: f.texto,
      context: f.contexto ?? '',
      section: (json(f.seccion) as string[] | null) ?? null,
      anchor: mapLegacyAnchor(json(f.ancla)),
      anchor_end: f.ancla_fin ? mapLegacyAnchor(json(f.ancla_fin)) : null,
      search_text: f.texto_busqueda,
    })));
    await w.addFigures(figuras.map((g) => ({
      id: g.id, unit: g.unidad, image: ref(g.imagen) ?? '', caption: g.pie ?? null, description: g.descripcion ?? null, anchor: mapLegacyAnchor(g.ancla),
    })));
    if (o.vectores !== false) {
      const usados = new Set((await p.sql.ejecutar<{ espacio: string }>('SELECT DISTINCT espacio FROM vectores WHERE documento = ?', d.id)).map((f) => f.espacio));
      for (const e of (await leerEspacios(p.sql)).filter((x) => usados.has(x.id))) {
        const id = await w.addSpace({
          id: e.id, provider: e.proveedor, model: e.modelo, version: e.version ?? null, dims: e.dims, dtype: 'f32',
          normalized: e.normalizado, truncated_from: null, modalities: e.modalidades.map((m) => MODALIDAD[m] ?? m), task_prefixes: null, created: null,
        });
        const vs = await leerVectores(p.sql, { espacio: e.id, documento: d.id });
        for (let i = 0; i < vs.length; i += 500) {
          await w.addVectors(id, vs.slice(i, i + 500).map((v) => ({ target: OBJETIVO[v.objetivo] ?? 'fragment', id: v.id, vector: v.valores })));
        }
      }
    }
    for (const e of await leerProcedencia(p.sql, d.id)) {
      await w.addProvenance({ stage: e.fase, provider: e.proveedor ?? null, model: null, detail: e.detalle ?? null, ms: e.ms ?? null, at: e.cuando ?? d.creado });
    }
    const bytes = await w.finish();
    return { bytes, omitidos: o.incrustar ? [...mimes.keys()].filter((k) => !incrustados.has(k)).length : 0 };
  } catch (e) {
    await w.abort();
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Importar: SPDF 5.0 → SPDF 4.1 en memoria
// ---------------------------------------------------------------------------

const TIPO: Record<string, TipoEntrada> = {
  pdf: 'pdf', scanned_pdf: 'pdf_escaneado', photos: 'fotos', image: 'imagen', audio: 'audio', video: 'video',
  document: 'documento', epub: 'epub', slides: 'presentacion', sheet: 'hoja', web: 'web',
};
const ORIGEN: Record<string, string> = { read: 'leido', inferred: 'deducido', epub: 'epub', none: 'ninguno' };
const FUENTE: Record<string, string> = { reading: 'lectura', user: 'usuario', colophon: 'colofon', printers: 'impresores' };
const CAMPO: Record<string, string> = {
  title: 'titulo', subtitle: 'subtitulo', 'original-title': 'tituloOriginal', author: 'autores', editor: 'editores', translator: 'traductores',
  interviewer: 'entrevistadores', issued: 'anio', 'original-date': 'anioOriginal', publisher: 'editorial', 'publisher-place': 'lugar',
  'container-title': 'revista', 'collection-title': 'coleccion', volume: 'volumen', issue: 'numero', page: 'paginas', edition: 'edicion',
  DOI: 'doi', ISBN: 'isbn', URL: 'url', language: 'idioma', type: 'tipoCSL', abstract: 'resumen', original_language: 'idiomaOriginal', undated: 'sinFecha',
};

/** Un ancla 5.0 en la forma de Scholaris (lo que no tiene equivalente se queda tal cual). */
export function anclaDe50(a: Anchor): Ancla {
  const x = a as Anchor & Record<string, unknown>;
  const extra: Record<string, unknown> = {};
  if (x.region) extra.region = x.region;
  if (x.chars) extra.chars = x.chars;
  switch (a.type) {
    case 'page':
      return { tipo: 'pagina', fisica: a.physical, impresa: a.printed ?? null, romana: !!a.roman, origen: (ORIGEN[a.source ?? 'read'] ?? 'leido') as 'leido', confianza: a.confidence ?? 1, ...(a.foliation && a.foliation !== 'page' ? { foliacion: a.foliation } : {}), ...extra } as Ancla;
    case 'time':
      return { tipo: 'tiempo', t0: a.t0, t1: a.t1, ...(a.speaker ? { hablante: a.speaker } : {}), ...extra } as Ancla;
    case 'section':
      return { tipo: 'seccion', ruta: a.path, parrafo: a.paragraph ?? 0, ...(a.printed !== undefined ? { impresa: a.printed } : {}), ...extra } as Ancla;
    case 'slide':
      return { tipo: 'diapositiva', n: a.n, ...extra } as Ancla;
    case 'sheet':
      return { tipo: 'hoja', hoja: a.sheet, filaDesde: a.row_from, filaHasta: a.row_to, ...extra } as Ancla;
    case 'web':
      return { tipo: 'web', url: a.url, ruta: a.path ?? [], parrafo: a.paragraph ?? 0, consultada: a.accessed ?? '', ...extra } as Ancla;
    case 'image':
      return { tipo: 'imagen', ...extra } as Ancla;
    case 'verse':
      // Scholaris no tiene versos: una sección con el verso, que se sigue citando bien.
      return { tipo: 'seccion', ruta: [a.line_to && a.line_to !== a.line_from ? `vv. ${a.line_from}-${a.line_to}` : `v. ${a.line_from}`], parrafo: a.line_from, ...(a.printed ? { impresa: a.printed } : {}), verso: { desde: a.line_from, hasta: a.line_to ?? a.line_from }, ...extra } as unknown as Ancla;
    case 'canonical':
      return { tipo: 'seccion', ruta: [a.ref], parrafo: 0, canonica: { esquema: a.scheme, ref: a.ref }, ...extra } as unknown as Ancla;
    default:
      return { tipo: 'imagen', ...extra } as Ancla;
  }
}

function persona(n: CslName, orcid: Record<string, string>): Autor {
  const apellidos = [n['non-dropping-particle'], n.family ?? n.literal ?? ''].filter(Boolean).join(' ');
  const nombre = n.given ?? '';
  const id = orcid[nombre ? `${n.family ?? ''}, ${nombre}` : n.family ?? n.literal ?? ''];
  return { nombre, apellidos, ...(id ? { orcid: id } : {}) };
}

const texto = (v: unknown): string | undefined => (v === undefined || v === null || v === '' ? undefined : String(v));

/** La ficha CSL-JSON (+ extensión `spdf`) en la forma de Scholaris. */
export function metadatosDe50(m: CslItem): MetadatosDocumento {
  const ext = (m.spdf ?? {}) as Record<string, unknown>;
  const orcid = (ext.orcid ?? {}) as Record<string, string>;
  const subtitulo = texto(ext.subtitle);
  let titulo = String(m.title ?? '');
  if (subtitulo) titulo = texto(m['title-short']) ?? (titulo.endsWith(`: ${subtitulo}`) ? titulo.slice(0, -subtitulo.length - 2) : titulo);
  const personas = (xs: CslName[] | undefined) => (Array.isArray(xs) ? xs.map((n) => persona(n, orcid)) : undefined);
  const partes = m.issued?.['date-parts']?.[0];
  const anio = typeof partes?.[0] === 'number' ? partes[0] : Number.isFinite(Number(partes?.[0])) && partes?.[0] !== undefined ? Number(partes[0]) : undefined;
  const original = m['original-date']?.['date-parts']?.[0]?.[0];
  const md: MetadatosDocumento = { titulo, autores: personas(m.author) ?? [] };
  const poner = <K extends keyof MetadatosDocumento>(k: K, v: MetadatosDocumento[K] | undefined) => { if (v !== undefined) md[k] = v; };
  poner('subtitulo', subtitulo);
  poner('tituloOriginal', texto(m['original-title']));
  poner('editores', personas(m.editor));
  poner('traductores', personas(m.translator));
  poner('entrevistadores', personas(m.interviewer));
  if (anio !== undefined && Number.isFinite(anio)) md.anio = anio;
  if (partes && partes.length > 1) md.fecha = partes.map((x, i) => (i === 0 ? String(x) : String(x).padStart(2, '0'))).join('-');
  if (original !== undefined && Number.isFinite(Number(original))) md.anioOriginal = Number(original);
  poner('editorial', texto(m.publisher));
  poner('lugar', texto(m['publisher-place']));
  const contenedor = texto(m['container-title']);
  if (contenedor) {
    if (String(m.type).startsWith('article')) md.revista = contenedor;
    else md.contenedor = contenedor;
  }
  poner('coleccion', texto(m['collection-title']));
  poner('volumen', texto(m.volume));
  poner('numero', texto(m.issue));
  poner('paginas', texto(m.page));
  poner('edicion', texto(m.edition));
  poner('doi', texto(m.DOI));
  poner('isbn', texto(m.ISBN));
  poner('url', texto(m.URL));
  poner('idioma', texto(m.language));
  poner('tipoCSL', texto(m.type));
  poner('resumen', texto(m.abstract));
  poner('idiomaOriginal', texto(ext.original_language));
  const sinFecha = ext.undated as { from?: number; to?: number; basis?: string } | undefined;
  if (sinFecha && typeof sinFecha === 'object') {
    md.sinFecha = { fundamento: sinFecha.basis ?? '', ...(sinFecha.from !== undefined ? { desde: sinFecha.from } : {}), ...(sinFecha.to !== undefined ? { hasta: sinFecha.to } : {}) };
  }
  const proc = ext.provenance as Record<string, { source?: string; confidence?: number }> | undefined;
  if (proc && typeof proc === 'object') {
    const p: Record<string, { fuente: string; confianza: number }> = {};
    for (const [k, v] of Object.entries(proc)) p[CAMPO[k] ?? k] = { fuente: FUENTE[v?.source ?? ''] ?? v?.source ?? '', confianza: v?.confidence ?? 0 };
    md.procedencia = p as MetadatosDocumento['procedencia'];
  }
  return md;
}

/** Un .spdf 5.0 como SPDF 4.1 en memoria (para el importador de siempre). */
export async function archivoDesde50(bytes: Uint8Array, generador: string): Promise<{ archivo: ArchivoSpdf; avisos: string[] }> {
  const engine = await motorSpdf50();
  const doc = await openSpdf(bytes, { engine });
  const avisos: string[] = [];
  const a = await crearSpdf({ generador });
  try {
    const d = doc.document;
    const sinBlob = (x: string | null | undefined) => (x ? (x.startsWith('blob:') ? x.slice(5) : x) : undefined);
    for (const b of await doc.blobs()) {
      const full = await doc.blob(b.key);
      if (full) await a.ponerBlob(full.key, full.mime, full.data);
    }
    await a.escribirDocumento({
      id: d.id, tipo: TIPO[d.kind] ?? 'documento', metadatos: metadatosDe50(d.metadata), estado: 'listo', huella: d.source_sha256,
      original: sinBlob(d.source_ref) ?? '', mime: d.mime, bytes: d.bytes, unidades: d.unit_count,
      ...(d.duration !== null ? { duracion: d.duration } : {}), creado: d.created, actualizado: d.updated, bibliotecas: [],
    });
    const unidades = await doc.units();
    await a.escribirUnidades(unidades.map((u) => {
      const x: UnidadSpdf = {
        id: u.id, documento: d.id, orden: u.ord - 1, ancla: anclaDe50(u.anchor), texto: u.text, lector: u.reader, confianza: u.confidence,
      };
      if (u.notes?.length) x.notas = u.notes;
      if (u.header) x.cabecera = u.header;
      if (u.footer) x.pie = u.footer;
      const img = sinBlob(u.image);
      if (img) x.imagen = img;
      const mini = sinBlob(u.thumbnail);
      if (mini) x.miniatura = mini;
      if (u.words) x.palabras = u.words as UnidadSpdf['palabras'];
      return x;
    }));
    await a.escribirSecciones((await doc.sections()).map((s) => ({
      id: s.id, documento: d.id, padre: s.parent, nivel: s.level, titulo: s.title, unidadDesde: s.unit_from, unidadHasta: s.unit_to, resumen: s.summary,
    })));
    await a.escribirFragmentos((await doc.fragments()).map((f): Fragmento => ({
      id: f.id, documento: d.id, unidad: f.unit, orden: f.ord, texto: f.text, contexto: f.context, seccion: f.section ?? [], ancla: anclaDe50(f.anchor),
      ...(f.anchor_end ? { anclaFin: anclaDe50(f.anchor_end) } : {}),
      ...(f.search_text !== null ? { textoBusqueda: f.search_text } : {}),
    })));
    await a.escribirFiguras((await doc.figures()).map((g): Figura => ({
      id: g.id, documento: d.id, unidad: g.unit, imagen: sinBlob(g.image) ?? '', ancla: anclaDe50(g.anchor),
      ...(g.caption ? { pie: g.caption } : {}), ...(g.description ? { descripcion: g.description } : {}),
    })));
    const inverso = Object.fromEntries(Object.entries(MODALIDAD).map(([k, v]) => [v, k]));
    for (const s of await doc.spaces()) {
      const e: EspacioVectorial = {
        id: s.id, proveedor: s.provider, modelo: s.model, dims: s.dims, normalizado: s.normalized,
        modalidades: s.modalities.map((m) => inverso[m] ?? m) as EspacioVectorial['modalidades'], ...(s.version ? { version: s.version } : {}),
      };
      await a.escribirEspacio(e);
      if (s.dtype !== 'f32') avisos.push(`El espacio ${s.id} venía en ${s.dtype}: se guarda como f32.`);
      const objetivo = { fragment: 'fragmento', unit: 'unidad', figure: 'figura' } as const;
      const vs = await doc.vectors(s.id);
      for (let i = 0; i < vs.length; i += 500) {
        await a.escribirVectores(vs.slice(i, i + 500).map((v) => ({ objetivo: objetivo[v.target], id: v.id, espacio: s.id, documento: d.id, valores: v.vector })));
      }
    }
    for (const e of await doc.provenance()) {
      const detalle = e.model ? { ...(e.detail && typeof e.detail === 'object' ? (e.detail as Record<string, unknown>) : e.detail !== null ? { valor: e.detail } : {}), modelo: e.model } : e.detail;
      await a.registrarProcedencia({ documento: d.id, fase: e.stage, proveedor: e.provider, detalle, ms: e.ms, cuando: e.at });
    }
    return { archivo: a, avisos };
  } catch (e) {
    a.cerrar();
    throw e;
  } finally {
    await doc.close();
  }
}
