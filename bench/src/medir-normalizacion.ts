/**
 * Mide la capa de ortografía modernizada (SPDF 4.1) sobre los SPDF del banco.
 *
 *   pnpm --filter @scholaris/bench exec tsx src/medir-normalizacion.ts
 *
 * 1. Lope («El casamiento en la muerte», grafía del s. XVIII): consultas en
 *    grafía moderna; exhaustividad y precisión antes (índice 4.0, solo el texto
 *    fiel) y después (4.1, texto fiel + capa). La verdad de cada consulta es una
 *    expresión regular, escrita a mano, con TODAS las grafías de esa palabra que
 *    aparecen en el texto fiel.
 * 2. Documentos modernos (castellano e inglés): las mismas búsquedas antes y
 *    después deben devolver exactamente lo mismo, y su capa debe quedar vacía.
 *
 * Antes y después usan el mismo motor (node:sqlite) y el mismo buscador: el
 * «antes» es la base del banco devuelta a 4.0 (sin capa, índice de tres
 * columnas); el «después», esa misma copia migrada con `aplicarEsquema` (la
 * migración automática que hace también el Durable Object).
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQL, ValorSQL } from '@scholaris/nucleo';
import { aplicarEsquema, buscarTexto } from '@scholaris/spdf';
import { Buscador, terminos } from '@scholaris/busqueda';

const DIR = join(import.meta.dirname, '../datos/salida');

function puerto(db: DatabaseSync): SQL {
  const p: SQL = {
    async ejecutar<T>(consulta: string, ...ps: ValorSQL[]): Promise<T[]> {
      if (/^\s*PRAGMA\s+user_version\s*=/i.test(consulta)) return [];
      const st = db.prepare(consulta);
      const params = ps.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v)) as Array<string | number | null | Uint8Array>;
      if (/^\s*(SELECT|PRAGMA|WITH)/i.test(consulta)) return st.all(...params) as T[];
      st.run(...params);
      return [];
    },
    async transaccion<T>(fn: (s: SQL) => Promise<T>): Promise<T> {
      db.exec('SAVEPOINT m');
      try { const r = await fn(p); db.exec('RELEASE m'); return r; } catch (e) { db.exec('ROLLBACK TO m'); db.exec('RELEASE m'); throw e; }
    },
  };
  return p;
}

const ESQUEMA_40 = readFileSync(join(import.meta.dirname, '../../packages/spdf/esquema/v4.0.sql'), 'utf8');

/**
 * Deja una base exactamente como la escribe SPDF 4.0, aunque el banco ya la
 * haya generado en 4.1: sin la columna y con el índice FTS5 de tres columnas.
 */
function aV40(db: DatabaseSync): void {
  db.exec('DROP TRIGGER IF EXISTS fragmentos_ai; DROP TRIGGER IF EXISTS fragmentos_ad; DROP TRIGGER IF EXISTS fragmentos_au; DROP TABLE IF EXISTS fragmentos_fts; DROP INDEX IF EXISTS fragmentos_sin_busqueda;');
  const columnas = (db.prepare('PRAGMA table_info(fragmentos)').all() as Array<{ name: string }>).map((c) => c.name);
  if (columnas.includes('texto_busqueda')) db.exec('ALTER TABLE fragmentos DROP COLUMN texto_busqueda');
  db.exec(ESQUEMA_40);
  db.exec("INSERT INTO fragmentos_fts(fragmentos_fts) VALUES ('rebuild')");
  db.exec("UPDATE spdf SET valor = '4.0' WHERE clave = 'spdf_version'; DELETE FROM spdf WHERE clave = 'fts_pendiente'; VACUUM;");
}

/** Una copia 4.0 de la base del banco (antes) y otra migrada a 4.1 con aplicarEsquema (después). */
async function parDeBases(nombre: string) {
  const dir = mkdtempSync(join(tmpdir(), 'norm-'));
  const rutaAntes = join(dir, `${nombre}-40.sqlite`);
  const rutaDespues = join(dir, `${nombre}-41.sqlite`);
  copyFileSync(join(DIR, `${nombre}.sqlite`), rutaAntes);
  const antes = new DatabaseSync(rutaAntes);
  aV40(antes);
  copyFileSync(rutaAntes, rutaDespues);
  const despues = new DatabaseSync(rutaDespues);
  const bytesAntes = statSync(rutaAntes).size;
  const t0 = performance.now();
  await aplicarEsquema(puerto(despues));
  const msMigracion = performance.now() - t0;
  despues.exec('VACUUM');
  const bytesDespues = statSync(rutaDespues).size;
  return {
    antes, despues, sqlAntes: puerto(antes), sqlDespues: puerto(despues), msMigracion, bytesAntes, bytesDespues,
    cerrar() { antes.close(); despues.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

// ---------------------------------------------------------------------------
// 1. Lope
// ---------------------------------------------------------------------------

/** Consulta en grafía moderna → expresión con todas las grafías del texto fiel (NFC, minúsculas). */
const CONSULTAS_LOPE: Array<{ q: string; verdad: RegExp[]; nota?: string }> = [
  { q: 'así', verdad: [/(?<!\p{L})(?:a[sſf]s?i|ansi|así|asi)(?!\p{L})/u] },
  { q: 'corazón', verdad: [/(?<!\p{L})coraz[oó]n(?!\p{L})|coraçon/u] },
  { q: 'mujer', verdad: [/(?<!\p{L})mu[gj]er(?!\p{L})/u] },
  { q: 'mujeres', verdad: [/(?<!\p{L})mu[gj]eres(?!\p{L})/u] },
  { q: 'honra', verdad: [/(?<!\p{L})h?onr+a(?!\p{L})/u] },
  { q: 'cuando', verdad: [/(?<!\p{L})(?:qu|c)ando(?!\p{L})/u] },
  { q: 'cual', verdad: [/(?<!\p{L})(?:qu|c)al(?!\p{L})/u] },
  { q: 'cuántos', verdad: [/(?<!\p{L})(?:qu|c)ant[oò]s(?!\p{L})/u] },
  { q: 'dijo', verdad: [/(?<!\p{L})di[xj]o(?!\p{L})/u] },
  { q: 'haber', verdad: [/(?<!\p{L})h?a[vb]er(?!\p{L})/u] },
  { q: 'caballeros', verdad: [/(?<!\p{L})ca[vbu]all?eros(?!\p{L})/u] },
  { q: 'banderas', verdad: [/(?<!\p{L})[bv]anderas(?!\p{L})/u] },
  { q: 'ejército', verdad: [/(?<!\p{L})e[xj][eé]rcito(?!\p{L})/u] },
  { q: 'cajas', verdad: [/(?<!\p{L})ca[xj]as(?!\p{L})/u] },
  { q: 'prisión', verdad: [/(?<!\p{L})pri[sſ]+i[oó]n(?!\p{L})/u] },
  { q: 'cristiano', verdad: [/(?<!\p{L})c(?:h)?ristiano(?!\p{L})/u] },
  { q: 'vasallos', verdad: [/(?<!\p{L})[vb]a[sſ]+allos(?!\p{L})/u] },
  { q: 'lejos', verdad: [/(?<!\p{L})le[xj]os(?!\p{L})/u] },
  { q: 'reino', verdad: [/(?<!\p{L})re[yi]no(?!\p{L})/u] },
  { q: 'fe', verdad: [/(?<!\p{L})f(?:ee|e|é)(?!\p{L})/u] },
  { q: 'acero', verdad: [/(?<!\p{L})a[cz]ero(?!\p{L})/u] },
  { q: 'Jimena', verdad: [/(?<!\p{L})[xj]imena(?!\p{L})/u] },
  { q: 'pasó', verdad: [/(?<!\p{L})pa[sſ]+[oòó](?!\p{L})/u] },
  { q: 'que', verdad: [/(?<!\p{L})(?:que|q̃|què|qué)(?!\p{L})/u], nota: 'q̃ y Què' },
  // Varias palabras: todas (AND)
  { q: 'así es la muerte', verdad: [/(?<!\p{L})(?:a[sſf]s?i|ansi|así|asi)(?!\p{L})/u, /(?<!\p{L})muerte(?!\p{L})/u] },
  { q: 'mi padre en prisión', verdad: [/(?<!\p{L})padre(?!\p{L})/u, /(?<!\p{L})pri[sſ]+i[oó]n(?!\p{L})/u] },
  { q: 'banderas del ejército', verdad: [/(?<!\p{L})[bv]anderas(?!\p{L})/u, /(?<!\p{L})e[xj][eé]rcito(?!\p{L})/u] },
  // Control: palabras que no cambiaron de grafía
  { q: 'padre', verdad: [/(?<!\p{L})padre(?!\p{L})/u] },
  { q: 'muerte', verdad: [/(?<!\p{L})muerte(?!\p{L})/u] },
  { q: 'sangre', verdad: [/(?<!\p{L})sangre(?!\p{L})/u] },
];

/** Palabras de la consulta que exige el modo «todas» (sin vacías, como el buscador). */
function palabrasConsulta(q: string): string {
  const ts = terminos(q);
  return (ts.length ? ts : terminos(q, { conVacias: true })).join(' ');
}

interface FilaLope { q: string; relevantes: number; antes: { r: number; p: number; n: number }; despues: { r: number; p: number; n: number }; top10antes: number; top10despues: number }

async function medirLope(): Promise<{ filas: FilaLope[]; info: Record<string, number> }> {
  const b = await parDeBases('el-casamiento-en-la-');
  try {
    const frags = b.antes.prepare('SELECT id, texto FROM fragmentos').all() as Array<{ id: string; texto: string }>;
    const conCapa = (b.despues.prepare("SELECT count(*) AS n FROM fragmentos WHERE texto_busqueda <> ''").get() as { n: number }).n;
    const buscadorAntes = new Buscador({ sql: b.sqlAntes });
    const buscadorDespues = new Buscador({ sql: b.sqlDespues });
    const filas: FilaLope[] = [];
    for (const { q, verdad } of CONSULTAS_LOPE) {
      const relevantes = new Set(frags.filter((f) => { const t = f.texto.normalize('NFC').toLowerCase(); return verdad.every((re) => re.test(t)); }).map((f) => f.id));
      const medir = (ids: string[]) => {
        const acierto = ids.filter((id) => relevantes.has(id)).length;
        return { r: relevantes.size ? acierto / relevantes.size : 1, p: ids.length ? acierto / ids.length : 1, n: ids.length };
      };
      const palabras = palabrasConsulta(q);
      const antes = (await buscarTexto(b.sqlAntes, palabras, { modo: 'todas', limite: 500, normalizada: false })).map((r) => r.fragmento.id);
      const despues = (await buscarTexto(b.sqlDespues, palabras, { modo: 'todas', limite: 500 })).map((r) => r.fragmento.id);
      // El buscador de verdad (vía léxica sola): ¿cuántos de los 10 primeros son relevantes?
      const top = async (bus: Buscador) => (await bus.buscar(q, { vias: ['lexica'], limite: 10 })).resultados.map((r) => r.fragmento.id);
      const t10a = (await top(buscadorAntes)).filter((id) => relevantes.has(id)).length;
      const t10d = (await top(buscadorDespues)).filter((id) => relevantes.has(id)).length;
      filas.push({ q, relevantes: relevantes.size, antes: medir(antes), despues: medir(despues), top10antes: t10a, top10despues: t10d });
    }
    return { filas, info: { fragmentos: frags.length, conCapa, msMigracion: b.msMigracion, bytesAntes: b.bytesAntes, bytesDespues: b.bytesDespues } };
  } finally {
    b.cerrar();
  }
}

// ---------------------------------------------------------------------------
// 2. Documentos modernos: nada debe cambiar
// ---------------------------------------------------------------------------

const MODERNOS = ['cortazar-afondo', 'cortazar1959persegui', 'serrano', 'attention_2017', 'discarded'];
const GENERICAS = ['mujer', 'honra', 'así es la muerte', 'cuando', 'haber', 'ahora', 'hecho', 'vida', 'corazón', 'attention heads', 'model', 'heaven', 'angels', 'ejército', 'caballero'];

/** Consultas sacadas del propio documento: las palabras de ≥ 5 letras más frecuentes y pares de ellas. */
function consultasDe(textos: string[]): string[] {
  const cuenta = new Map<string, number>();
  for (const t of textos) for (const w of terminos(t)) if (w.length >= 5) cuenta.set(w, (cuenta.get(w) ?? 0) + 1);
  const top = [...cuenta].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([w]) => w);
  const pares: string[] = [];
  for (let i = 0; i + 1 < Math.min(top.length, 20); i += 2) pares.push(`${top[i]} ${top[i + 1]}`);
  return [...top.slice(0, 25), ...pares];
}

async function medirModernos() {
  const salida: Array<{ doc: string; idioma: string; fragmentos: number; conCapa: number; consultas: number; identicas: number; distintas: string[]; bytesAntes: number; bytesDespues: number }> = [];
  for (const nombre of MODERNOS) {
    let b: Awaited<ReturnType<typeof parDeBases>>;
    try { b = await parDeBases(nombre); } catch { continue; }
    try {
      const idioma = String((b.antes.prepare('SELECT idioma FROM documentos').get() as { idioma: string } | undefined)?.idioma ?? '?');
      const textos = (b.antes.prepare('SELECT texto FROM fragmentos').all() as Array<{ texto: string }>).map((f) => f.texto);
      const conCapa = (b.despues.prepare("SELECT count(*) AS n FROM fragmentos WHERE texto_busqueda <> ''").get() as { n: number }).n;
      const ba = new Buscador({ sql: b.sqlAntes });
      const bd = new Buscador({ sql: b.sqlDespues });
      const qs = [...consultasDe(textos), ...GENERICAS];
      let identicas = 0;
      const distintas: string[] = [];
      for (const q of qs) {
        const a = (await ba.buscar(q, { vias: ['lexica'], limite: 10 })).resultados.map((r) => r.fragmento.id).join(',');
        const d = (await bd.buscar(q, { vias: ['lexica'], limite: 10 })).resultados.map((r) => r.fragmento.id).join(',');
        if (a === d) identicas++;
        else distintas.push(q);
      }
      salida.push({ doc: nombre, idioma, fragmentos: textos.length, conCapa, consultas: qs.length, identicas, distintas, bytesAntes: b.bytesAntes, bytesDespues: b.bytesDespues });
    } finally {
      b.cerrar();
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------

const pct = (x: number) => `${Math.round(x * 100)} %`;
const lope = await medirLope();
console.log(`\nLope: ${lope.info.fragmentos} fragmentos, ${lope.info.conCapa} con capa; migración ${(lope.info.msMigracion ?? 0).toFixed(0)} ms; base ${lope.info.bytesAntes} → ${lope.info.bytesDespues} bytes (tras VACUUM)`);
console.log('| Consulta | Relevantes | Exhaustividad antes | después | Precisión antes | después | Relevantes en el top 10 (buscador) antes | después |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
let sumaA = 0, sumaD = 0, relTot = 0, acA = 0, acD = 0;
for (const f of lope.filas) {
  console.log(`| ${f.q} | ${f.relevantes} | ${pct(f.antes.r)} | ${pct(f.despues.r)} | ${f.antes.n ? pct(f.antes.p) : '—'} | ${f.despues.n ? pct(f.despues.p) : '—'} | ${f.top10antes} | ${f.top10despues} |`);
  sumaA += f.antes.r; sumaD += f.despues.r; relTot += f.relevantes; acA += f.antes.r * f.relevantes; acD += f.despues.r * f.relevantes;
}
console.log(`Media de exhaustividad por consulta: ${pct(sumaA / lope.filas.length)} → ${pct(sumaD / lope.filas.length)}; micro (por pasaje): ${pct(acA / relTot)} → ${pct(acD / relTot)}`);
const modernos = await medirModernos();
console.log('\n| Documento | Idioma | Fragmentos | Con capa | Consultas | Top 10 idéntico | Bytes antes → después |');
console.log('|---|---|---:|---:|---:|---:|---:|');
for (const m of modernos) console.log(`| ${m.doc} | ${m.idioma} | ${m.fragmentos} | ${m.conCapa} | ${m.consultas} | ${m.identicas} | ${m.bytesAntes} → ${m.bytesDespues} |${m.distintas.length ? ` distintas: ${m.distintas.join('; ')}` : ''}`);
