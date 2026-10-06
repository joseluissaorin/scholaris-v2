/**
 * Perspectivas (insights): lo que el historial y la biblioteca dicen juntos.
 *
 *  - Arqueología: documentos olvidados (abiertos hace tiempo, o nunca, que
 *    vuelven a salir en tus búsquedas) y la línea temporal de tus temas.
 *  - Huecos: temas que buscas y la biblioteca no responde bien, con la
 *    referencia huérfana que podría cubrirlos.
 *  - Recomendaciones: documentos de los grupos del mapa sobre los que buscas
 *    pero que no has abierto, y obras que tu biblioteca cita y no tienes.
 *    A diferencia de la versión anterior, se compara de verdad cada consulta
 *    con el centroide de cada grupo (reducido igual que el mapa).
 */

import { bytesAVector, type SQL } from '@scholaris/nucleo';
import type { Arqueologia, Hueco, Recomendacion } from '@scholaris/contrato';
import { grabacionActiva } from './ajustes.js';
import { leerDocumentos } from './estanteria.js';
import { referenciasHuerfanas } from './grafo/grafo.js';
import { kMedias, reducir } from './mapa/algebra.js';
import { centroidesMapa } from './mapa/construir.js';
import { aBytes, ahora, deJSON, haceDias, limitar, normalizarClave, num, recortar, texto } from './util.js';

interface ConsultaConVector { id: string; consulta: string; intencion: string | null; creada: string; espacio: string | null; vector: Float32Array | null; resultados: number; confianza: string | null; estado: string }

async function consultas(sql: SQL, desde?: string): Promise<ConsultaConVector[]> {
  const filas = await sql.ejecutar(
    `SELECT id, consulta, intencion, creada, espacio, vector, n_resultados, confianza, estado FROM historial
     WHERE redactada = 0 ${desde ? 'AND creada >= ?' : ''} ORDER BY creada`,
    ...(desde ? [desde] : []),
  );
  return filas.map((f) => {
    const b = aBytes(f.vector);
    return {
      id: String(f.id), consulta: String(f.consulta), intencion: texto(f.intencion), creada: String(f.creada),
      espacio: texto(f.espacio), vector: b ? bytesAVector(b) : null, resultados: num(f.n_resultados),
      confianza: texto(f.confianza), estado: String(f.estado),
    };
  });
}

/** Agrupa consultas por su vector (o, sin vectores, por palabras comunes). */
function agruparConsultas(qs: ConsultaConVector[], kMax = 4): ConsultaConVector[][] {
  if (qs.length <= 1) return qs.length ? [qs] : [];
  const conVector = qs.filter((q) => q.vector);
  const dims = conVector[0]?.vector?.length ?? 0;
  if (conVector.length >= 2 && conVector.every((q) => q.vector!.length === dims)) {
    const X = new Float32Array(conVector.length * dims);
    conVector.forEach((q, i) => X.set(q.vector!, i * dims));
    const k = Math.max(1, Math.min(kMax, Math.floor(conVector.length / 3) || 1));
    const km = kMedias(X, conVector.length, dims, k);
    const grupos: ConsultaConVector[][] = Array.from({ length: km.k }, () => []);
    conVector.forEach((q, i) => grupos[km.etiquetas[i]!]!.push(q));
    const sinVector = qs.filter((q) => !q.vector);
    if (sinVector.length) grupos.push(sinVector);
    return grupos.filter((g) => g.length).sort((a, b) => b.length - a.length);
  }
  // Sin vectores: unión por palabras significativas compartidas.
  const grupos: Array<{ palabras: Set<string>; qs: ConsultaConVector[] }> = [];
  for (const q of qs) {
    const ps = new Set(normalizarClave(q.consulta).split(' ').filter((p) => p.length > 3));
    const g = grupos.find((x) => [...ps].some((p) => x.palabras.has(p)));
    if (g) { g.qs.push(q); ps.forEach((p) => g.palabras.add(p)); } else grupos.push({ palabras: ps, qs: [q] });
  }
  return grupos.map((g) => g.qs).sort((a, b) => b.length - a.length);
}

function moda<T>(xs: T[]): T | null {
  const c = new Map<T, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  let mejor: T | null = null, n = 0;
  for (const [x, k] of c) if (k > n) { mejor = x; n = k; }
  return mejor;
}

function cubeta(iso: string, tipo: 'dia' | 'semana' | 'mes'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'desconocida';
  if (tipo === 'dia') return iso.slice(0, 10);
  if (tipo === 'mes') return iso.slice(0, 7);
  // Semana ISO.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const inicio = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((t.getTime() - inicio.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-S${String(semana).padStart(2, '0')}`;
}

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export interface ArqueologiaCompleta extends Arqueologia {
  linea: Array<{ cubeta: string; consultas: number; temas: Array<{ tamano: number; consultas: string[]; intencion: string | null }> }>;
}

export async function arqueologia(sql: SQL, o: { dias?: number; cubeta?: 'dia' | 'semana' | 'mes'; olvidoDias?: number } = {}): Promise<ArqueologiaCompleta> {
  const dias = limitar(o.dias, 1, 3650, 180);
  const qs = await consultas(sql, haceDias(dias));
  // Línea temporal de temas.
  const porCubeta = new Map<string, ConsultaConVector[]>();
  for (const q of qs) {
    const c = cubeta(q.creada, o.cubeta ?? 'mes');
    porCubeta.set(c, [...(porCubeta.get(c) ?? []), q]);
  }
  const linea = [...porCubeta.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([c, lista]) => ({
    cubeta: c,
    consultas: lista.length,
    temas: agruparConsultas(lista).map((g) => ({ tamano: g.length, consultas: g.slice(0, 5).map((q) => q.consulta), intencion: moda(g.map((q) => q.intencion).filter(Boolean)) })),
  }));

  // Documentos olvidados.
  const olvido = haceDias(limitar(o.olvidoDias, 1, 3650, 60));
  const aperturas = new Map<string, string>();
  for (const f of await sql.ejecutar('SELECT documento, max(abierta) AS u FROM insights_aperturas GROUP BY documento')) aperturas.set(String(f.documento), String(f.u));
  const recientes = new Map<string, number>(); // documento → veces que sale en búsquedas recientes
  for (const f of await sql.ejecutar('SELECT resultados FROM historial WHERE redactada = 0 AND creada >= ?', haceDias(30))) {
    for (const r of deJSON<Array<{ documento: string }>>(f.resultados, [])) recientes.set(r.documento, (recientes.get(r.documento) ?? 0) + 1);
  }
  const docs = await leerDocumentos(sql);
  const creados = new Map<string, string>();
  for (const f of await sql.ejecutar('SELECT id, creado FROM documentos')) creados.set(String(f.id), String(f.creado));
  const olvidados: Array<Arqueologia['olvidados'][number] & { peso: number }> = [];
  for (const d of docs.values()) {
    const ultima = aperturas.get(d.id);
    const veces = recientes.get(d.id) ?? 0;
    if (ultima && ultima < olvido) {
      olvidados.push({
        documento: d.id, titulo: d.titulo, ultimaApertura: ultima, peso: 2 + veces,
        motivo: veces
          ? `Lo abriste por última vez el ${fecha(ultima)} y ha vuelto a salir ${veces === 1 ? 'una vez' : `${veces} veces`} en tus búsquedas del último mes.`
          : `No lo abres desde el ${fecha(ultima)}.`,
      });
    } else if (!ultima && (creados.get(d.id) ?? ahora()) < olvido) {
      olvidados.push({
        documento: d.id, titulo: d.titulo, peso: 1 + veces,
        motivo: veces
          ? `Lo añadiste el ${fecha(creados.get(d.id)!)}, nunca lo has abierto y sale en tus búsquedas recientes.`
          : `Lo añadiste el ${fecha(creados.get(d.id)!)} y nunca lo has abierto.`,
      });
    }
  }
  olvidados.sort((a, b) => b.peso - a.peso);
  return { olvidados: olvidados.slice(0, 50).map(({ peso: _p, ...x }) => x), linea };
}

export interface HuecoCompleto extends Hueco {
  ejemplos: string[];
  referencia?: string;
}

export async function huecos(sql: SQL, o: { dias?: number } = {}): Promise<HuecoCompleto[]> {
  const qs = (await consultas(sql, haceDias(limitar(o.dias, 1, 3650, 180))))
    .filter((q) => q.confianza === 'baja' || q.estado === 'error' || q.resultados === 0);
  if (!qs.length) return [];
  const huerfanas = await referenciasHuerfanas(sql, { limite: 200 });
  return agruparConsultas(qs, 8).slice(0, 20).map((g) => {
    const palabras = new Set(g.flatMap((q) => normalizarClave(q.consulta).split(' ').filter((p) => p.length > 3)));
    // Tema: la consulta que más palabras comparte con el resto del grupo.
    const tema = [...g].sort((a, b) => {
      const pa = normalizarClave(a.consulta).split(' ').filter((p) => palabras.has(p)).length;
      const pb = normalizarClave(b.consulta).split(' ').filter((p) => palabras.has(p)).length;
      return pb - pa || a.consulta.length - b.consulta.length;
    })[0]!.consulta;
    const ref = huerfanas.find((h) => normalizarClave(h.referencia).split(' ').filter((p) => palabras.has(p)).length >= 2);
    const h: HuecoCompleto = {
      tema: recortar(tema, 120),
      consultas: g.length,
      resultadosMedios: Math.round((g.reduce((s, q) => s + q.resultados, 0) / g.length) * 10) / 10,
      ejemplos: [...new Set(g.map((q) => q.consulta))].slice(0, 5),
      sugerencia: ref
        ? `Te falta «${recortar(ref.referencia, 140)}», que ${ref.citadaPor.length === 1 ? 'cita un documento' : `citan ${ref.citadaPor.length} documentos`} de tu biblioteca.`
        : 'Tus búsquedas sobre este tema no encuentran respuestas seguras: conviene añadir fuentes.',
    };
    if (ref) h.referencia = ref.doi ?? ref.referencia;
    return h;
  });
}

export async function recomendaciones(sql: SQL, o: { limite?: number } = {}): Promise<Recomendacion[]> {
  const limite = limitar(o.limite, 1, 100, 20);
  const descartados = new Set((await sql.ejecutar('SELECT documento FROM insights_descartes')).map((f) => String(f.documento)));
  const abiertos = new Set((await sql.ejecutar('SELECT DISTINCT documento FROM insights_aperturas')).map((f) => String(f.documento)));
  const salida: Array<Recomendacion & { peso: number }> = [];

  // (a) Grupos del mapa cerca de lo que buscas.
  const { meta, centroides } = await centroidesMapa(sql);
  if (centroides.length && meta.reduccion && meta.espacio) {
    const qs = (await consultas(sql, haceDias(180))).filter((q) => q.vector && q.espacio === meta.espacio);
    const cerca = new Map<number, number>();
    const tmp = new Float32Array(meta.reduccion.dims);
    for (const q of qs) {
      const v = reducir(q.vector!, meta.reduccion, tmp);
      let mejor = -1, mejorS = -Infinity;
      for (const c of centroides) {
        let s = 0;
        for (let j = 0; j < v.length; j++) s += v[j]! * c.vector[j]!;
        if (s > mejorS) { mejorS = s; mejor = c.indice; }
      }
      if (mejor >= 0 && mejorS > 0.3) cerca.set(mejor, (cerca.get(mejor) ?? 0) + 1);
    }
    const docs = await leerDocumentos(sql, centroides.flatMap((c) => c.documentos));
    for (const c of centroides) {
      const n = cerca.get(c.indice) ?? 0;
      if (!n) continue;
      for (const d of c.documentos.slice(0, 3)) {
        if (abiertos.has(d) || descartados.has(d) || !docs.has(d)) continue;
        salida.push({
          documento: d, titulo: docs.get(d)!.titulo, peso: n * 10 + c.tamano / 1000,
          motivo: `Has buscado ${n === 1 ? 'una vez' : `${n} veces`} sobre «${c.etiqueta ?? `el grupo ${c.indice + 1}`}» y todavía no has abierto este documento.`,
        });
      }
    }
  }

  // (b) Obras que tu biblioteca cita y no tienes.
  for (const h of await referenciasHuerfanas(sql, { minimo: 2, limite: 20 })) {
    salida.push({
      titulo: recortar(h.referencia, 200), peso: h.citadaPor.length,
      motivo: `La citan ${h.citadaPor.length} documentos de tu biblioteca y no la tienes.`,
      referencia: h.doi ?? h.referencia,
    });
  }

  const vistos = new Set<string>();
  return salida
    .sort((a, b) => b.peso - a.peso)
    .filter((r) => { const k = r.documento ?? r.titulo; if (vistos.has(k)) return false; vistos.add(k); return true; })
    .slice(0, limite)
    .map(({ peso: _p, ...r }) => r);
}

/** Registra que el usuario ha abierto algo (respeta la grabación). */
export async function registrarApertura(sql: SQL, a: { documento: string; unidad?: string; objetivo?: 'fragmento' | 'unidad' | 'figura' | 'documento'; id?: string; superficie?: string }): Promise<boolean> {
  if (!(await grabacionActiva(sql))) return false;
  await sql.ejecutar(
    'INSERT INTO insights_aperturas (documento, objetivo, id, superficie, abierta) VALUES (?, ?, ?, ?, ?)',
    a.documento, a.objetivo ?? (a.unidad ? 'unidad' : 'documento'), a.id ?? a.unidad ?? null, a.superficie ?? 'visor', ahora(),
  );
  return true;
}

export async function descartarRecomendacion(sql: SQL, documento: string): Promise<void> {
  await sql.ejecutar(
    'INSERT INTO insights_descartes (documento, descartado) VALUES (?, ?) ON CONFLICT(documento) DO UPDATE SET descartado = excluded.descartado',
    documento, ahora(),
  );
}

