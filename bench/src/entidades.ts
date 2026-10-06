/**
 * `tsx src/entidades.ts`: el grafo de entidades sobre una biblioteca real
 * (las entrevistas de A fondo, El perseguidor, The Discarded Image, Lope y
 * Attention), con el redactor rápido de verdad y Wikidata de verdad. Mide
 * coste, tiempo y calidad, y deja la estantería en
 * bench/datos/salida/entidades-biblioteca.sqlite.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { SQL, ValorSQL } from '@scholaris/nucleo';
import { crearInteligencia } from '@scholaris/proveedores';
import {
  aplicarEsquemaFunciones, buscarEntidades, caminoEntidades, entidadesDocumento, extraerEntidadesDocumento, fichaEntidad,
  lineaTemporalEntidad, type PuertosFunciones,
} from '../../packages/funciones/src/index.js';
import { cargarEntorno } from './entorno.js';
import { RAIZ, SALIDA } from './ingesta.js';

const LIBROS = ['cortazar-afondo', 'serrano', 'cortazar1959persegui', 'discarded', 'el-casamiento-en-la-', 'attention_2017'];
const DESTINO = join(SALIDA, 'entidades-biblioteca.sqlite');

function sqlDe(db: Database.Database): SQL {
  const aP = (v: ValorSQL) => (v instanceof Uint8Array ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : v);
  let profundidad = 0;
  const sql: SQL = {
    async ejecutar<T>(consulta: string, ...p: ValorSQL[]): Promise<T[]> {
      const st = db.prepare(consulta);
      if (st.reader) return st.all(...p.map(aP)) as T[];
      st.run(...p.map(aP));
      return [];
    },
    async transaccion<T>(fn: (s: SQL) => Promise<T>): Promise<T> {
      if (profundidad > 0) return fn(sql);
      profundidad++;
      db.exec('BEGIN');
      try { const r = await fn(sql); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { profundidad--; }
    },
  };
  return sql;
}

function columnas(db: Database.Database, esquema: string, tabla: string): string[] {
  return (db.prepare(`PRAGMA ${esquema}.table_info(${tabla})`).all() as Array<{ name: string }>).map((c) => c.name);
}

/** Copia documentos, unidades y fragmentos de cada SPDF del banco a una sola estantería. */
function montarBiblioteca(nueva: boolean): Database.Database {
  if (nueva && existsSync(DESTINO)) rmSync(DESTINO);
  const db = new Database(DESTINO);
  db.exec(readFileSync(join(RAIZ, '..', 'packages', 'spdf', 'esquema', 'v4.0.sql'), 'utf8'));
  for (const libro of LIBROS) {
    const origen = join(SALIDA, `${libro}.sqlite`);
    db.exec(`ATTACH DATABASE '${origen}' AS o`);
    for (const t of ['documentos', 'unidades', 'secciones', 'fragmentos']) {
      const comunes = columnas(db, 'o', t).filter((c) => columnas(db, 'main', t).includes(c) && !(t === 'fragmentos' && c === 'n'));
      db.exec(`INSERT OR IGNORE INTO main.${t} (${comunes.join(', ')}) SELECT ${comunes.join(', ')} FROM o.${t}`);
    }
    db.exec('DETACH DATABASE o');
  }
  return db;
}

const usd = (x: number) => `$${x.toFixed(4)}`;

async function main() {
  const nueva = !process.argv.includes('--seguir');
  const db = montarBiblioteca(nueva);
  const sql = sqlDe(db);
  await aplicarEsquemaFunciones(sql);
  const env = cargarEntorno();
  const ia = crearInteligencia(env);
  const p: PuertosFunciones = { sql, usuario: { id: 'banco' }, inteligencia: { redactor: ia.redactor } };
  const docs = db.prepare('SELECT id, titulo, tipo, anio, unidades, (SELECT SUM(length(texto)) FROM fragmentos f WHERE f.documento = d.id) AS caracteres FROM documentos d').all() as Array<{ id: string; titulo: string; tipo: string; anio: number | null; unidades: number; caracteres: number }>;
  const informe: Record<string, unknown>[] = [];
  for (const d of docs) {
    const antes = ia.contador.total();
    const t0 = Date.now();
    const r = await extraerEntidadesDocumento(p, d.id, { concurrencia: 6 });
    const despues = ia.contador.total();
    const real = { usd: despues.usd - antes.usd, entrada: despues.tokensEntrada - antes.tokensEntrada, salida: despues.tokensSalida - antes.tokensSalida, llamadas: despues.llamadas - antes.llamadas };
    const fila = {
      documento: d.titulo, tipo: d.tipo, unidades: d.unidades, caracteres: d.caracteres, lotes: r.lotes, estado: r.estado,
      entidades: r.entidades, menciones: r.menciones, segundos: Math.round((Date.now() - t0) / 100) / 10,
      usdReal: Math.round(real.usd * 1e5) / 1e5, usdEstimado: r.usdEstimado, tokensEntrada: real.entrada, tokensSalida: real.salida, llamadas: real.llamadas,
      usdPor300Paginas: d.tipo.startsWith('pdf') ? Math.round((real.usd / Math.max(1, d.unidades)) * 300 * 1e4) / 1e4 : null,
      ...(r.error ? { error: r.error } : {}),
    };
    informe.push(fila);
    console.log(`${d.titulo.slice(0, 40).padEnd(40)} ${String(r.lotes).padStart(3)} lotes · ${String(r.entidades).padStart(4)} entidades · ${String(r.menciones).padStart(5)} menciones · ${fila.segundos} s · ${usd(real.usd)} (estimado ${usd(r.usdEstimado)})${r.error ? ` · ERROR ${r.error}` : ''}`);
  }

  // Lo que se quería ver: Charlie Parker entre la entrevista y El perseguidor.
  const salida: Record<string, unknown> = { documentos: informe };
  const buscar = async (q: string, tipo?: string) => (await buscarEntidades(sql, { q, ...(tipo ? { tipo } : {}), limite: 5 })).elementos;
  const parker = (await buscar('charlie parker', 'persona'))[0];
  if (parker) {
    const f = await fichaEntidad(sql, parker.id, { porDocumento: 4 });
    salida.charlieParker = {
      nombre: f.nombre, wikidata: f.wikidata, descripcion: f.descripcion, alias: f.alias, documentos: f.documentos, menciones: f.menciones,
      porDocumento: f.porDocumento.map((d) => ({ titulo: d.titulo, total: d.total, menciones: d.menciones.map((m) => `${m.etiqueta} · ${m.contexto}`) })),
      vecinos: f.vecinos.slice(0, 10).map((v) => `${v.entidad.nombre} (${v.peso}${v.relacion ? `; ${v.relacion}` : ''})`),
    };
    console.log('\nCharlie Parker:', JSON.stringify(salida.charlieParker, null, 2));
  }
  const cortazar = (await buscar('julio cortazar', 'persona'))[0];
  const johnny = (await buscar('johnny carter', 'persona'))[0];
  if (cortazar && johnny) {
    const c = await caminoEntidades(sql, cortazar.id, johnny.id);
    salida.caminoCortazarJohnny = c.pasos.map((x) => `${x.entidad.nombre}${x.via ? ` ← ${x.via.titulo}, ${x.via.etiqueta}${x.via.relacion ? ` (${x.via.relacion})` : ''}` : ''}`);
    console.log('\nCamino Cortázar → Johnny Carter:', salida.caminoCortazarJohnny);
    const l = await lineaTemporalEntidad(sql, cortazar.id);
    salida.lineaCortazar = l.elementos.slice(0, 8).map((x) => `${x.anio ?? 's. f.'}${x.fecha ? ` [${x.fecha}]` : ''} · ${x.titulo} ${x.etiqueta}`);
  }
  const dedee = (await buscar('dedee', 'persona'))[0];
  if (parker && dedee) {
    salida.caminoParkerDedee = (await caminoEntidades(sql, parker.id, dedee.id)).pasos.map((x) => `${x.entidad.nombre}${x.via ? ` ← ${x.via.titulo}, ${x.via.etiqueta}${x.via.relacion ? ` («${x.via.relacion}»)` : ''}` : ''}`);
    console.log('Camino Charlie Parker → Dédée:', salida.caminoParkerDedee);
  }
  const lope = (await buscar('lope', 'persona'))[0];
  if (lope && cortazar) salida.caminoLopeCortazar = (await caminoEntidades(sql, lope.id, cortazar.id)).pasos.map((x) => x.entidad.nombre);
  salida.topPorDocumento = Object.fromEntries(await Promise.all(docs.map(async (d) => [d.titulo, (await entidadesDocumento(sql, d.id, 10)).entidades.map((e) => `${e.nombre} [${e.tipo}${e.wikidata ? ` ${e.wikidata}` : ''}] ×${e.aqui}`)])));
  salida.compartidas = (db.prepare("SELECT nombre, tipo, n_documentos, n_menciones, wikidata FROM entidades WHERE fusionada_en IS NULL AND n_documentos >= 2 AND tipo <> 'fecha' ORDER BY n_documentos DESC, n_menciones DESC LIMIT 40").all());
  salida.totales = db.prepare(`SELECT
      (SELECT COUNT(*) FROM entidades WHERE fusionada_en IS NULL AND n_menciones > 0) AS entidades,
      (SELECT COUNT(*) FROM entidades WHERE fusionada_en IS NOT NULL) AS fusionadas,
      (SELECT COUNT(*) FROM entidades WHERE fusionada_en IS NULL AND wikidata IS NOT NULL) AS conWikidata,
      (SELECT COUNT(*) FROM entidades_wikidata) AS consultasWikidata,
      (SELECT COUNT(*) FROM menciones) AS menciones,
      (SELECT COUNT(*) FROM (SELECT DISTINCT a, b FROM aristas_entidades)) AS aristas,
      (SELECT COUNT(*) FROM entidades_relaciones WHERE etiqueta IS NOT NULL) AS relaciones`).get();
  salida.porTipo = db.prepare('SELECT tipo, COUNT(*) AS n FROM entidades WHERE fusionada_en IS NULL AND n_menciones > 0 GROUP BY tipo ORDER BY n DESC').all();
  salida.relaciones = (db.prepare('SELECT ea.nombre AS a, r.etiqueta, eb.nombre AS b FROM entidades_relaciones r JOIN entidades ea ON ea.id = r.a JOIN entidades eb ON eb.id = r.b WHERE r.etiqueta IS NOT NULL LIMIT 40').all() as Array<{ a: string; etiqueta: string; b: string }>).map((x) => x.etiqueta);
  salida.fusiones = db.prepare('SELECT p.nombre AS forma, g.nombre AS en FROM entidades p JOIN entidades g ON g.id = p.fusionada_en LIMIT 60').all();
  salida.uso = ia.contador.detalle();
  writeFileSync(join(SALIDA, 'entidades.informe.json'), JSON.stringify(salida, null, 2));
  console.log('\nTotales:', salida.totales, '\nInforme en', join(SALIDA, 'entidades.informe.json'));
}

main().catch((e) => { console.error(e); process.exit(1); });
