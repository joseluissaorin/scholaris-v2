/**
 * Mapa de conceptos: agrupa los vectores de la biblioteca (fragmentos y
 * figuras, opcionalmente unidades), los dibuja en 2D y pone nombre a cada
 * grupo con una llamada al redactor por grupo. La ejecución nueva sustituye a
 * la activa de golpe, en una transacción: nunca se ve un mapa a medias.
 *
 * Coste en Node con 20 000 vectores de 1536 dimensiones: unos 2-3 s sin
 * contar las etiquetas (que van en paralelo).
 */

import { anclaACita, bytesAVector, enParalelo, nuevoId, vectorABytes, type Ancla, type SQL } from '@scholaris/nucleo';
import type { GrupoMapa, MapaConceptos, MetaMapa, MiembrosGrupo, PuntoMapa } from '@scholaris/contrato';
import { documentosFiltrados } from '../buscador-local.js';
import { leerDocumentos } from '../estanteria.js';
import type { AlProgreso, PuertosFunciones } from '../puertos.js';
import { aBytes, ahora, ceder, deJSON, ErrorFunciones, marcas, num, recortar, texto, una } from '../util.js';
import { ajustarPCA, dist2, elegirK, elegirReduccion, kMedias, muestraEstratificada, proyectarPCA, reducir, type Reduccion } from './algebra.js';
import { grafoDifuso, normalizarDisposicion, optimizarDisposicion, vecinosAproximados } from './umap.js';

export type ObjetivoMapa = 'fragmento' | 'unidad' | 'figura';

export interface OpcionesMapa {
  biblioteca?: string;
  /** Espacio vectorial; por defecto el del embebedor, o el que más vectores tenga. */
  espacio?: string;
  objetivos?: ObjetivoMapa[];
  /** Dimensiones tras la reducción (recorte o proyección). */
  dimsReducidas?: number;
  /** Componentes principales para agrupar y buscar vecinos. */
  componentes?: number;
  /** Número de grupos (por defecto, según el tamaño). */
  k?: number;
  /** Puntos que se dibujan con UMAP; el resto se coloca junto a sus vecinos. */
  muestra?: number;
  /** Etiquetar con el redactor (por defecto, si hay redactor). */
  etiquetar?: boolean;
  /** Idioma de las etiquetas. */
  idioma?: string;
  epocas?: number;
}

export interface ResultadoConstruccion extends MetaMapa {
  ejecucion: string;
  grupos: number;
  puntos: number;
  muestreados: number;
  ms: number;
  tiempos: Record<string, number>;
}

const MAX_PARAMETROS = 99;

/** INSERT por lotes respetando el límite de parámetros de D1 y del Durable Object (100). */
async function insertarLotes(sql: SQL, tabla: string, columnas: string[], filas: unknown[][]) {
  const porLote = Math.max(1, Math.floor(MAX_PARAMETROS / columnas.length));
  const fila = `(${marcas(columnas.length)})`;
  for (let i = 0; i < filas.length; i += porLote) {
    const lote = filas.slice(i, i + porLote);
    await sql.ejecutar(
      `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES ${lote.map(() => fila).join(', ')}`,
      ...(lote.flat() as Array<string | number | null | Uint8Array>),
    );
  }
}

/** Limpia etiquetas del modelo: paréntesis sin cerrar, listas colgadas, puntuación final. */
export function pulirEtiqueta(s: string): string {
  let t = (s ?? '').replace(/^["«“'\s]+|["»”'\s]+$/g, '').trim();
  if (!t) return t;
  const a = t.lastIndexOf('('), c = t.lastIndexOf(')');
  if (a > c) t = t.slice(0, a).replace(/[\s,;:-]+$/, '');
  t = t.replace(/[\s,;:.-]+$/, '');
  return t.length > 80 ? recortar(t, 80) : t;
}

async function elegirEspacio(sql: SQL, p: PuertosFunciones, o: OpcionesMapa) {
  const id = o.espacio ?? p.inteligencia?.embebedor?.espacio.id ?? null;
  let fila = id ? await una(sql, 'SELECT id, modelo, dims FROM espacios WHERE id = ?', id) : null;
  if (!fila) {
    fila = await una(
      sql,
      `SELECT e.id, e.modelo, e.dims FROM espacios e JOIN (SELECT espacio, count(*) AS n FROM vectores GROUP BY espacio) v ON v.espacio = e.id ORDER BY v.n DESC LIMIT 1`,
    );
  }
  if (!fila) throw new ErrorFunciones('peticion_invalida', 'La biblioteca todavía no tiene vectores con los que dibujar el mapa.');
  return { id: String(fila.id), modelo: texto(fila.modelo) ?? '', dims: num(fila.dims) };
}

/** Construye el mapa y lo deja activo. Lanza `ErrorFunciones` si no hay datos suficientes. */
export async function construirMapa(p: PuertosFunciones, o: OpcionesMapa = {}, alProgreso?: AlProgreso): Promise<ResultadoConstruccion> {
  const { sql } = p;
  const t0 = Date.now();
  const tiempos: Record<string, number> = {};
  let marca = t0;
  const cronometrar = (fase: string) => { const t = Date.now(); tiempos[fase] = t - marca; marca = t; };
  const emitir = async (fase: string, estado: 'inicio' | 'avance' | 'hecho', mensaje: string, avance: number, detalle?: Record<string, unknown>) => {
    if (alProgreso) await alProgreso({ fase, estado, mensaje, avance, ms: Date.now() - t0, ...(detalle ? { detalle } : {}) });
  };
  const ejecucion = nuevoId('m');
  await emitir('inicio', 'inicio', 'Empieza la construcción del mapa de conceptos.', 0);

  // 1. Recoger y reducir los vectores, por páginas.
  const espacio = await elegirEspacio(sql, p, o);
  const reduccion: Reduccion = elegirReduccion(espacio, o.dimsReducidas ?? 256);
  const D = reduccion.dims;
  const objetivos = o.objetivos ?? ['fragmento', 'figura'];
  const permitidos = o.biblioteca ? await documentosFiltrados(sql, { bibliotecas: [o.biblioteca] }) : null;
  const total = num((await una(sql, `SELECT count(*) AS n FROM vectores WHERE espacio = ? AND objetivo IN (${marcas(objetivos.length)})`, espacio.id, ...objetivos))?.n);
  let X = new Float32Array(Math.max(1, total) * D);
  const ids: string[] = [];
  const docs: string[] = [];
  const tipos: ObjetivoMapa[] = [];
  let ultimo = 0;
  await emitir('recoger', 'inicio', 'Recogiendo los vectores de la biblioteca.', 0.02, { espacio: espacio.id, total });
  for (;;) {
    const filas = await sql.ejecutar(
      `SELECT rowid AS r, objetivo, id, documento, valores FROM vectores
       WHERE espacio = ? AND objetivo IN (${marcas(objetivos.length)}) AND rowid > ? ORDER BY rowid LIMIT 2000`,
      espacio.id, ...objetivos, ultimo,
    );
    if (!filas.length) break;
    for (const f of filas) {
      ultimo = num(f.r);
      const doc = String(f.documento);
      if (permitidos && !permitidos.has(doc)) continue;
      const b = aBytes(f.valores);
      if (!b) continue;
      const n = ids.length;
      if ((n + 1) * D > X.length) { const nuevo = new Float32Array(X.length * 2); nuevo.set(X); X = nuevo; }
      reducir(bytesAVector(b), reduccion, X.subarray(n * D, (n + 1) * D));
      ids.push(String(f.id));
      docs.push(doc);
      tipos.push(String(f.objetivo) as ObjetivoMapa);
    }
    await emitir('recoger', 'avance', `Leídos ${ids.length} vectores.`, 0.02 + 0.13 * Math.min(1, ids.length / Math.max(1, total)));
  }
  const n = ids.length;
  if (n < 8) {
    throw new ErrorFunciones('peticion_invalida', `Hacen falta al menos 8 elementos con vectores para dibujar el mapa (hay ${n}).`);
  }
  cronometrar('recoger');
  const mezclaTotal: Record<string, number> = {};
  for (const t of tipos) mezclaTotal[t] = (mezclaTotal[t] ?? 0) + 1;
  await emitir('recoger', 'hecho', `Recogidos ${n} vectores.`, 0.15, { puntos: n, modalidades: mezclaTotal });

  // 2. PCA.
  const m = Math.min(o.componentes ?? 32, D, n - 1);
  const pca = ajustarPCA(X, n, D, m);
  const Y = proyectarPCA(X, n, pca);
  cronometrar('pca');
  await emitir('reducir', 'hecho', `Reducidas a ${m} componentes principales.`, 0.25);
  await ceder();

  // 3. k-medias.
  const k = Math.max(2, Math.min(o.k ?? elegirK(n), n));
  await emitir('agrupar', 'inicio', `Agrupando en ${k} grupos.`, 0.25, { k });
  const km = kMedias(Y, n, m, k);
  cronometrar('agrupar');
  await emitir('agrupar', 'hecho', `Agrupados en ${k} grupos.`, 0.4, { inercia: km.inercia, iteraciones: km.iteraciones });
  await ceder();

  // 4. Disposición 2D: UMAP sobre una muestra estratificada.
  const muestra = muestraEstratificada(km.etiquetas, k, o.muestra ?? 8000);
  const ns = muestra.length;
  const Ys = new Float32Array(ns * m);
  const etS = new Int32Array(ns);
  for (let s = 0; s < ns; s++) { const i = muestra[s]!; Ys.set(Y.subarray(i * m, i * m + m), s * m); etS[s] = km.etiquetas[i]!; }
  await emitir('proyectar', 'inicio', `Dibujando ${ns} puntos en 2D.`, 0.4, { muestra: ns, total: n });
  const K = Math.min(15, ns - 1);
  const vec = vecinosAproximados(Ys, ns, m, etS, km.centroides, k, K);
  const grafo = grafoDifuso(vec.indices, vec.distancias, ns, K);
  cronometrar('vecinos');
  const xyS = new Float32Array(ns * 2);
  const escala0 = Math.sqrt(pca.varianzas[0] ?? 1) || 1, escala1 = Math.sqrt(pca.varianzas[1] ?? 1) || 1;
  for (let s = 0; s < ns; s++) {
    xyS[2 * s] = (Ys[s * m]! / escala0) * 3;
    xyS[2 * s + 1] = (m > 1 ? Ys[s * m + 1]! / escala1 : 0) * 3;
  }
  optimizarDisposicion(xyS, ns, grafo, o.epocas ? { epocas: o.epocas } : {});
  normalizarDisposicion(xyS, ns);
  cronometrar('umap');
  await emitir('proyectar', 'hecho', 'Disposición 2D lista.', 0.6);
  await ceder();

  // 5. Los puntos no muestreados se colocan junto a sus vecinos muestreados del mismo grupo.
  const xy = new Float32Array(n * 2);
  const proyectado = new Uint8Array(n);
  const posMuestra = new Int32Array(n).fill(-1);
  for (let s = 0; s < ns; s++) { const i = muestra[s]!; posMuestra[i] = s; xy[2 * i] = xyS[2 * s]!; xy[2 * i + 1] = xyS[2 * s + 1]!; proyectado[i] = 1; }
  if (ns < n) {
    const deGrupo: number[][] = Array.from({ length: k }, () => []);
    for (let s = 0; s < ns; s++) if (deGrupo[etS[s]!]!.length < 128) deGrupo[etS[s]!]!.push(s);
    for (let i = 0; i < n; i++) {
      if (posMuestra[i]! >= 0) continue;
      const cands = deGrupo[km.etiquetas[i]!]!;
      const mejores: Array<[number, number]> = [];
      for (const s of cands) {
        const dd = dist2(Y, i, Ys, s, m);
        if (mejores.length < 3) { mejores.push([dd, s]); mejores.sort((a, b) => a[0] - b[0]); }
        else if (dd < mejores[2]![0]) { mejores[2] = [dd, s]; mejores.sort((a, b) => a[0] - b[0]); }
      }
      let sx = 0, sy = 0, sw = 0;
      for (const [dd, s] of mejores) { const w = 1 / (Math.sqrt(dd) + 1e-6); sx += w * xyS[2 * s]!; sy += w * xyS[2 * s + 1]!; sw += w; }
      xy[2 * i] = sw ? sx / sw : 0;
      xy[2 * i + 1] = sw ? sy / sw : 0;
    }
  }
  cronometrar('colocar');

  // 6. Resumen por grupo: tamaño, mezcla, documentos, centro 2D, centroide reducido.
  const tamanos = new Int32Array(k);
  const cx = new Float64Array(k), cy = new Float64Array(k);
  const centroideRed = new Float64Array(k * D);
  const distancia = new Float32Array(n);
  const mezcla: Array<Record<string, number>> = Array.from({ length: k }, () => ({}));
  const porDoc: Array<Map<string, number>> = Array.from({ length: k }, () => new Map());
  for (let i = 0; i < n; i++) {
    const c = km.etiquetas[i]!;
    tamanos[c]!++;
    cx[c]! += xy[2 * i]!; cy[c]! += xy[2 * i + 1]!;
    for (let j = 0; j < D; j++) centroideRed[c * D + j]! += X[i * D + j]!;
    distancia[i] = Math.sqrt(dist2(Y, i, km.centroides, c, m));
    mezcla[c]![tipos[i]!] = (mezcla[c]![tipos[i]!] ?? 0) + 1;
    porDoc[c]!.set(docs[i]!, (porDoc[c]!.get(docs[i]!) ?? 0) + 1);
  }
  const grupos = Array.from({ length: k }, (_, c) => {
    const cen = new Float32Array(D);
    let nn = 0;
    for (let j = 0; j < D; j++) { cen[j] = centroideRed[c * D + j]!; nn += cen[j]! ** 2; }
    nn = Math.sqrt(nn) || 1;
    for (let j = 0; j < D; j++) cen[j]! /= nn;
    return {
      indice: c,
      tamano: tamanos[c]!,
      x: tamanos[c] ? cx[c]! / tamanos[c]! : 0,
      y: tamanos[c] ? cy[c]! / tamanos[c]! : 0,
      mezcla: mezcla[c]!,
      documentos: [...porDoc[c]!.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d]) => d),
      centroide: cen,
      etiqueta: `Grupo ${c + 1}`,
      confianza: 0,
      descripcion: null as string | null,
    };
  });

  // 7. Etiquetas: una llamada al redactor por grupo, en paralelo.
  const redactor = p.inteligencia?.redactor;
  if (redactor && o.etiquetar !== false) {
    await emitir('etiquetar', 'inicio', `Poniendo nombre a ${k} grupos.`, 0.65, { k, modelo: redactor.nombre });
    const porGrupo: number[][] = Array.from({ length: k }, () => []);
    for (let i = 0; i < n; i++) porGrupo[km.etiquetas[i]!]!.push(i);
    const cercanos = porGrupo.map((g) => g.sort((a, b) => distancia[a]! - distancia[b]!).slice(0, 8));
    const textos = await leerTextos(sql, cercanos.flat().map((i) => ({ objetivo: tipos[i]!, id: ids[i]! })));
    let hechos = 0;
    await enParalelo(grupos, 6, async (g) => {
      const muestras = cercanos[g.indice]!.map((i) => {
        const t = textos.get(`${tipos[i]}:${ids[i]}`) ?? '';
        const marca = tipos[i] === 'figura' ? '[figura]' : tipos[i] === 'unidad' ? '[página]' : '[texto]';
        return `${marca} ${recortar(t, 300)}`;
      }).filter((s) => s.length > 10);
      if (!muestras.length) return;
      try {
        const r = await redactor.generar<{ etiqueta: string; descripcion?: string }>({
          sistema:
            `Pones nombre a grupos temáticos de una biblioteca académica. Responde en ${o.idioma === 'en' ? 'inglés' : 'español'} ` +
            'con una etiqueta breve (de dos a seis palabras, sin punto final, como un título de sección) y una descripción de una frase.',
          mensajes: [{ rol: 'usuario', partes: [{ texto: `Pasajes representativos del grupo:\n\n${muestras.map((s, j) => `${j + 1}. ${s}`).join('\n')}` }] }],
          esquema: {
            type: 'object',
            properties: { etiqueta: { type: 'string' }, descripcion: { type: 'string' } },
            required: ['etiqueta'],
          },
          temperatura: 0.2,
          maxTokens: 120,
          calidad: 'rapida',
        });
        const etiqueta = pulirEtiqueta(r.json?.etiqueta ?? r.texto);
        if (etiqueta) { g.etiqueta = etiqueta; g.confianza = 0.8; }
        if (r.json?.descripcion) g.descripcion = r.json.descripcion.trim();
      } catch {
        g.confianza = 0;
      }
      hechos++;
      await emitir('etiquetar', 'avance', `Grupo ${g.indice + 1}: ${g.etiqueta}`, 0.65 + 0.25 * (hechos / k), { indice: g.indice, etiqueta: g.etiqueta, tamano: g.tamano });
    });
    cronometrar('etiquetar');
    await emitir('etiquetar', 'hecho', 'Grupos con nombre.', 0.9);
  }

  // 8. Guardar y activar en una transacción.
  await emitir('guardar', 'inicio', 'Guardando el mapa.', 0.9);
  const ms = Date.now() - t0;
  await sql.transaccion(async (tx) => {
    await insertarLotes(
      tx, 'mapa_grupos',
      ['ejecucion', 'indice', 'etiqueta', 'confianza', 'descripcion', 'tamano', 'mezcla', 'documentos', 'x', 'y', 'centroide'],
      grupos.map((g) => [ejecucion, g.indice, g.etiqueta, g.confianza, g.descripcion, g.tamano, JSON.stringify(g.mezcla), JSON.stringify(g.documentos), g.x, g.y, vectorABytes(g.centroide)]),
    );
    const filas: unknown[][] = [];
    for (let i = 0; i < n; i++) {
      filas.push([ejecucion, km.etiquetas[i]!, tipos[i]!, ids[i]!, docs[i]!, Math.round(xy[2 * i]! * 1e5) / 1e5, Math.round(xy[2 * i + 1]! * 1e5) / 1e5, Math.round(distancia[i]! * 1e5) / 1e5, proyectado[i]!]);
    }
    await insertarLotes(tx, 'mapa_puntos', ['ejecucion', 'grupo', 'objetivo', 'id', 'documento', 'x', 'y', 'distancia', 'proyectado'], filas);
    await tx.ejecutar(
      `INSERT INTO mapa_meta (id, ejecucion_activa, construido, n_grupos, n_puntos, n_proyectados, ms, espacio, reduccion)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET ejecucion_activa = excluded.ejecucion_activa, construido = excluded.construido,
         n_grupos = excluded.n_grupos, n_puntos = excluded.n_puntos, n_proyectados = excluded.n_proyectados,
         ms = excluded.ms, espacio = excluded.espacio, reduccion = excluded.reduccion`,
      ejecucion, ahora(), k, n, ns, ms, espacio.id, JSON.stringify({ ...reduccion, biblioteca: o.biblioteca ?? null }),
    );
    await tx.ejecutar('DELETE FROM mapa_puntos WHERE ejecucion <> ?', ejecucion);
    await tx.ejecutar('DELETE FROM mapa_grupos WHERE ejecucion <> ?', ejecucion);
  });
  cronometrar('guardar');
  const resultado: ResultadoConstruccion = { ejecucion, construido: ahora(), grupos: k, puntos: n, muestreados: ns, ms: Date.now() - t0, tiempos };
  await emitir('fin', 'hecho', `Mapa listo: ${k} grupos, ${n} puntos.`, 1, { ...resultado });
  return resultado;
}

/** Textos de fragmentos, unidades y figuras, por clave «objetivo:id». */
async function leerTextos(sql: SQL, pedidos: Array<{ objetivo: ObjetivoMapa; id: string }>): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  const consultas: Record<ObjetivoMapa, string> = {
    fragmento: 'SELECT id, texto FROM fragmentos WHERE id IN',
    unidad: 'SELECT id, texto FROM unidades WHERE id IN',
    figura: "SELECT id, trim(coalesce(pie, '') || ' ' || coalesce(descripcion, '')) AS texto FROM figuras WHERE id IN",
  };
  for (const objetivo of ['fragmento', 'unidad', 'figura'] as const) {
    const lista = [...new Set(pedidos.filter((x) => x.objetivo === objetivo).map((x) => x.id))];
    for (let i = 0; i < lista.length; i += 90) {
      const lote = lista.slice(i, i + 90);
      for (const f of await sql.ejecutar(`${consultas[objetivo]} (${marcas(lote.length)})`, ...lote)) {
        salida.set(`${objetivo}:${f.id}`, String(f.texto ?? ''));
      }
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export interface MetaMapaCompleta extends MetaMapa {
  ejecucion?: string;
  espacio?: string;
  reduccion?: Reduccion & { biblioteca?: string | null };
}

export async function metaMapa(sql: SQL): Promise<MetaMapaCompleta> {
  const f = await una(sql, 'SELECT * FROM mapa_meta WHERE id = 1');
  if (!f || !f.ejecucion_activa) return {};
  const m: MetaMapaCompleta = {
    ejecucion: String(f.ejecucion_activa),
    construido: String(f.construido),
    grupos: num(f.n_grupos),
    puntos: num(f.n_puntos),
    muestreados: num(f.n_proyectados),
    ms: num(f.ms),
  };
  if (f.espacio) m.espacio = String(f.espacio);
  const r = deJSON<MetaMapaCompleta['reduccion'] | null>(f.reduccion, null);
  if (r) m.reduccion = r;
  return m;
}

export interface GrupoMapaCompleto extends GrupoMapa {
  descripcion?: string;
}

export async function gruposMapa(sql: SQL): Promise<GrupoMapaCompleto[]> {
  const meta = await metaMapa(sql);
  if (!meta.ejecucion) return [];
  const filas = await sql.ejecutar('SELECT * FROM mapa_grupos WHERE ejecucion = ? ORDER BY indice', meta.ejecucion);
  return filas.map((f) => {
    const g: GrupoMapaCompleto = {
      indice: num(f.indice),
      tamano: num(f.tamano),
      modalidades: deJSON(f.mezcla, {}),
      documentosPrincipales: deJSON(f.documentos, []),
      x: num(f.x),
      y: num(f.y),
    };
    if (f.etiqueta) g.etiqueta = String(f.etiqueta);
    if (f.confianza !== null && f.confianza !== undefined) g.confianzaEtiqueta = num(f.confianza);
    if (f.descripcion) g.descripcion = String(f.descripcion);
    return g;
  });
}

/** Centroides de los grupos activos en el espacio reducido (para comparar consultas). */
export async function centroidesMapa(sql: SQL): Promise<{ meta: MetaMapaCompleta; centroides: Array<{ indice: number; etiqueta: string | null; tamano: number; documentos: string[]; vector: Float32Array }> }> {
  const meta = await metaMapa(sql);
  if (!meta.ejecucion) return { meta, centroides: [] };
  const filas = await sql.ejecutar('SELECT indice, etiqueta, tamano, documentos, centroide FROM mapa_grupos WHERE ejecucion = ? ORDER BY indice', meta.ejecucion);
  return {
    meta,
    centroides: filas
      .filter((f) => aBytes(f.centroide))
      .map((f) => ({ indice: num(f.indice), etiqueta: texto(f.etiqueta), tamano: num(f.tamano), documentos: deJSON<string[]>(f.documentos, []), vector: bytesAVector(aBytes(f.centroide)!) })),
  };
}

export async function obtenerMapa(sql: SQL, o: { biblioteca?: string; maxPuntos?: number } = {}): Promise<MapaConceptos> {
  const meta = await metaMapa(sql);
  if (!meta.ejecucion) return { meta: {}, grupos: [], puntos: [] };
  const grupos = await gruposMapa(sql);
  const max = Math.max(100, Math.min(50_000, o.maxPuntos ?? 8000));
  const filtro = o.biblioteca ? 'AND documento IN (SELECT d.id FROM documentos d WHERE EXISTS (SELECT 1 FROM json_each(d.bibliotecas) b WHERE b.value = ?))' : '';
  const filas = await sql.ejecutar(
    `SELECT grupo, objetivo, id, documento, x, y FROM mapa_puntos WHERE ejecucion = ? ${filtro} ORDER BY proyectado DESC, distancia LIMIT ?`,
    meta.ejecucion, ...(o.biblioteca ? [o.biblioteca] : []), max,
  );
  const puntos: PuntoMapa[] = filas.map((f) => ({
    grupo: num(f.grupo), documento: String(f.documento), objetivo: String(f.objetivo) as PuntoMapa['objetivo'], id: String(f.id), x: num(f.x), y: num(f.y),
  }));
  const { ejecucion: _e, espacio: _s, reduccion: _r, ...metaPublica } = meta;
  return { meta: metaPublica, grupos, puntos };
}

export async function miembrosGrupo(sql: SQL, indice: number, limite = 100): Promise<MiembrosGrupo> {
  const meta = await metaMapa(sql);
  if (!meta.ejecucion) throw new ErrorFunciones('no_encontrado', 'Todavía no hay mapa de conceptos.', 404);
  const filas = await sql.ejecutar(
    'SELECT objetivo, id, documento FROM mapa_puntos WHERE ejecucion = ? AND grupo = ? ORDER BY distancia LIMIT ?',
    meta.ejecucion, indice, Math.max(1, Math.min(2000, limite)),
  );
  if (!filas.length && !(await una(sql, 'SELECT 1 AS x FROM mapa_grupos WHERE ejecucion = ? AND indice = ?', meta.ejecucion, indice))) {
    throw new ErrorFunciones('no_encontrado', 'No existe ese grupo en el mapa.', 404);
  }
  const documentos = await leerDocumentos(sql, filas.map((f) => String(f.documento)));
  const textos = await leerTextos(sql, filas.map((f) => ({ objetivo: String(f.objetivo) as ObjetivoMapa, id: String(f.id) })));
  const anclas = new Map<string, string>();
  const fragIds = filas.filter((f) => f.objetivo === 'fragmento').map((f) => String(f.id));
  for (let i = 0; i < fragIds.length; i += 90) {
    const lote = fragIds.slice(i, i + 90);
    for (const f of await sql.ejecutar(`SELECT id, ancla, ancla_fin FROM fragmentos WHERE id IN (${marcas(lote.length)})`, ...lote)) {
      const a = deJSON<Ancla | null>(f.ancla, null);
      if (a) anclas.set(String(f.id), anclaACita(a, deJSON<Ancla | null>(f.ancla_fin, null) ?? undefined));
    }
  }
  return {
    indice,
    miembros: filas.map((f) => {
      const id = String(f.id), objetivo = String(f.objetivo);
      const t = textos.get(`${objetivo}:${id}`);
      const e = anclas.get(id);
      return {
        documento: String(f.documento),
        titulo: documentos.get(String(f.documento))?.titulo ?? '',
        objetivo,
        id,
        ...(t ? { texto: recortar(t, 300) } : {}),
        ...(e ? { etiqueta: e } : {}),
      };
    }),
  };
}
