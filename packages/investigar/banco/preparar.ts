/**
 * Prepara la copia local de la biblioteca de producción para el banco de
 * Investigar (solo lectura sobre producción):
 *   1. descarga el SPDF 4.2 de cada documento (texto, transcripción, fotogramas,
 *      vectores, imágenes y la capa de comprensión, vacía hoy);
 *   2. lo vuelca en una estantería local con el esquema SPDF 4.2 y el de funciones;
 *   3. copia el grafo de entidades de esos documentos (entidades y menciones por
 *      la API) y rehace sus aristas.
 *
 *   npx tsx packages/investigar/banco/preparar.ts
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { aplicarEsquema } from '@scholaris/spdf';
import { aplicarEsquemaFunciones, reconstruirAristasDocumento, textoBusqueda } from '@scholaris/funciones';
import { abrirBD, api, BD, CUENTO, DATOS, PELICULA, secreto } from './comun.js';

const DOCUMENTOS = [CUENTO, PELICULA];
const TABLAS = ['documentos', 'unidades', 'secciones', 'fragmentos', 'figuras', 'espacios', 'vectores', 'segmentos', 'fichas', 'apariciones', 'relaciones', 'alineaciones'];

const clave = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

async function principal() {
  mkdirSync(DATOS, { recursive: true });
  if (existsSync(BD)) rmSync(BD);
  const sql = abrirBD();
  await aplicarEsquema(sql, { generador: 'banco-investigar' });
  await aplicarEsquemaFunciones(sql);
  sql.bd.exec('CREATE TABLE IF NOT EXISTS banco_blobs (documento TEXT NOT NULL, clave TEXT NOT NULL, mime TEXT NOT NULL, datos BLOB NOT NULL, PRIMARY KEY (documento, clave))');
  const base = `${secreto('scholaris.env', 'SCHOLARIS_URL').replace(/\/+$/, '')}/api/v2`;
  const token = secreto('scholaris.env', 'SCHOLARIS_CLAVE');
  for (const d of DOCUMENTOS) {
    const ruta = join(DATOS, `${d}.spdf.sqlite`);
    if (!existsSync(ruta)) {
      const r = await fetch(`${base}/documentos/${d}/spdf`, { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`SPDF de ${d}: ${r.status}`);
      let b = new Uint8Array(await r.arrayBuffer());
      if (b[0] === 0x1f && b[1] === 0x8b) b = new Uint8Array(gunzipSync(b));
      writeFileSync(ruta, b);
    }
    sql.bd.exec(`ATTACH DATABASE '${ruta.replace(/'/g, "''")}' AS s`);
    for (const t of TABLAS) {
      const destino = new Set((sql.bd.prepare(`PRAGMA main.table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name));
      const origen = (sql.bd.prepare(`PRAGMA s.table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
      // «n» es la clave interna de las tablas con FTS: se renumera en la copia.
      const cols = origen.filter((c) => destino.has(c) && c !== 'n');
      if (!cols.length) continue;
      const lista = cols.map((c) => `"${c}"`).join(', ');
      sql.bd.exec(`INSERT OR IGNORE INTO main.${t} (${lista}) SELECT ${lista} FROM s.${t}`);
    }
    sql.bd.exec(`INSERT OR REPLACE INTO main.banco_blobs (documento, clave, mime, datos) SELECT '${d}', clave, mime, datos FROM s.blobs WHERE clave NOT LIKE 'original%'`);
    sql.bd.exec('DETACH DATABASE s');
    console.log(`${d}: ${(sql.bd.prepare('SELECT COUNT(*) AS n FROM fragmentos WHERE documento = ?').get(d) as { n: number }).n} fragmentos`);
  }

  // El grafo de entidades de esos documentos.
  const pedir = api();
  const ahora = new Date().toISOString();
  const entidades = new Map<string, { id: string; nombre: string; tipo: string; alias: string[]; descripcion?: string; wikidata?: string }>();
  for (const d of DOCUMENTOS) {
    const r = await pedir<{ entidades: Array<{ id: string; nombre: string; tipo: string; alias: string[]; descripcion?: string; wikidata?: string }> }>(`/entidades/documentos/${d}`);
    for (const e of r.entidades) entidades.set(e.id, e);
  }
  const frags = new Map((sql.bd.prepare('SELECT id, documento, orden, texto, ancla FROM fragmentos').all() as Array<{ id: string; documento: string; orden: number; texto: string; ancla: string }>).map((f) => [f.id, f]));
  let menciones = 0;
  for (const e of entidades.values()) {
    const k = clave(e.nombre);
    sql.bd.prepare(`INSERT OR IGNORE INTO entidades (id, tipo, clave, nombre, alias, busqueda, wikidata, descripcion, creada, actualizada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(e.id, e.tipo, k, e.nombre, JSON.stringify(e.alias ?? []), textoBusqueda(k, e.alias ?? []), e.wikidata ?? null, e.descripcion ?? null, ahora, ahora);
    for (const d of DOCUMENTOS) {
      const p = await pedir<{ elementos: Array<{ id: string; fragmento: string; texto: string; contexto: string; ancla: unknown }> }>(`/entidades/${e.id}/menciones?documento=${d}&limite=500`).catch(() => ({ elementos: [] }));
      for (const m of p.elementos) {
        const f = frags.get(m.fragmento);
        if (!f) continue;
        // La API da el contexto con la mención entre ⟦ ⟧: con él se recupera su posición en el fragmento.
        const antes = (m.contexto.split('⟦')[0] ?? '').replace(/^…/, '');
        let ini = antes ? f.texto.indexOf(antes.slice(-30)) : -1;
        ini = ini >= 0 ? f.texto.indexOf(m.texto, ini) : f.texto.indexOf(m.texto);
        if (ini < 0) ini = 0;
        sql.bd.prepare('INSERT OR IGNORE INTO menciones (id, entidad, documento, fragmento, orden, texto, normalizado, tipo, ini, fin, ancla) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(m.id, e.id, d, m.fragmento, f.orden, m.texto, e.nombre, e.tipo, ini, ini + m.texto.length, f.ancla);
        menciones++;
      }
    }
  }
  sql.bd.exec(`UPDATE entidades SET n_menciones = (SELECT COUNT(*) FROM menciones m WHERE m.entidad = entidades.id),
    n_documentos = (SELECT COUNT(DISTINCT documento) FROM menciones m WHERE m.entidad = entidades.id)`);
  for (const d of DOCUMENTOS) {
    sql.bd.prepare(`INSERT OR REPLACE INTO entidades_trabajos (documento, estado, iniciado, actualizado) VALUES (?, 'hecho', ?, ?)`).run(d, ahora, ahora);
    await reconstruirAristasDocumento(sql, d);
  }
  console.log(`${entidades.size} entidades, ${menciones} menciones`);
  writeFileSync(join(DATOS, 'preparado.json'), JSON.stringify({ cuando: ahora, documentos: DOCUMENTOS, entidades: entidades.size, menciones }, null, 2));
  void readFileSync;
}

principal().catch((e) => { console.error(e); process.exit(1); });
