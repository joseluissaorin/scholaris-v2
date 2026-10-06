/**
 * Rehacer el enlace y la fusión de entidades de toda la biblioteca sin volver
 * a extraer: las menciones (con su forma escrita y el nombre canónico que dio
 * el redactor) se quedan; se deshacen las fusiones, se reasignan las menciones
 * cuya forma no puede nombrar a su entidad, se rehacen los alias, se averigua
 * qué personas son personajes de ficción (una llamada barata por cada 120),
 * se vuelve a enlazar con Wikidata (de la caché casi siempre) y a resolver con
 * las reglas de ahora, y se tejen otra vez las aristas.
 */

import type { Redactor, SQL } from '@scholaris/nucleo';
import type { TipoEntidad } from '@scholaris/contrato';
import { ahora, num } from '../util.js';
import { fijarAjuste, leerAjuste } from '../ajustes.js';
import { claveEntidad, contextoMencion, formaCompatible } from './normalizar.js';
import { DESCRIPCION_FICCION, obtenerEntidad, recontar, resolverBiblioteca, textoBusqueda } from './resolver.js';
import { enlazarWikidata, type OpcionesWikidata } from './wikidata.js';
import { fraseValida, reconstruirAristasDocumento } from './aristas.js';
import { tokensAprox, usdAprox, type UsoLote } from './extraer.js';

export const ESQUEMA_FICCION = {
  type: 'object',
  properties: { f: { type: 'array', items: { type: 'integer' } } },
  required: ['f'],
} as const;

export const SISTEMA_FICCION = `Recibes una lista numerada de personas nombradas en documentos de una biblioteca, cada una con el título del documento y un trozo del pasaje. Devuelve en «f» los números de las que son personajes de ficción (de una novela, un cuento, una obra de teatro, un mito o una leyenda), aunque estén inspirados en alguien real. Las personas reales (autores, músicos, entrevistados, figuras históricas) no van. Si dudas, no lo incluyas. Responde solo con el JSON.`;

/** Decide qué personas sin clasificar son personajes de ficción. Devuelve cuántas se clasificaron. */
export async function clasificarFiccion(sql: SQL, redactor: Redactor, lote = 120): Promise<{ clasificadas: number; ficticias: number; uso: UsoLote }> {
  const uso: UsoLote = { tokensEntrada: 0, tokensSalida: 0, llamadas: 0 };
  const pendientes = await sql.ejecutar<{ id: string; nombre: string }>(
    "SELECT id, nombre FROM entidades WHERE tipo = 'persona' AND fusionada_en IS NULL AND n_menciones > 0 AND ficticia IS NULL ORDER BY n_menciones DESC",
  );
  let clasificadas = 0, ficticias = 0;
  for (let i = 0; i < pendientes.length; i += lote) {
    const grupo = pendientes.slice(i, i + lote);
    const lineas: string[] = [];
    for (const [j, e] of grupo.entries()) {
      const [m] = await sql.ejecutar<{ texto: string; ini: number; fin: number; titulo: string | null }>(
        `SELECT f.texto, m.ini, m.fin, d.titulo FROM menciones m JOIN fragmentos f ON f.id = m.fragmento JOIN documentos d ON d.id = m.documento
          WHERE m.entidad = ? LIMIT 1`, e.id,
      );
      const pasaje = m ? contextoMencion(m.texto, num(m.ini), num(m.fin), 90).replace(/[⟦⟧]/g, '') : '';
      lineas.push(`[${j + 1}] ${e.nombre} · «${m?.titulo ?? ''}» · ${pasaje}`);
    }
    const texto = lineas.join('\n');
    uso.llamadas++;
    uso.tokensEntrada += tokensAprox(SISTEMA_FICCION) + tokensAprox(texto);
    let indices: number[] = [];
    try {
      const r = await redactor.generar<{ f: unknown }>({
        sistema: SISTEMA_FICCION, mensajes: [{ rol: 'usuario', partes: [{ texto }] }],
        esquema: ESQUEMA_FICCION as unknown as Record<string, unknown>, calidad: 'rapida', temperatura: 0, maxTokens: 1024,
      });
      uso.tokensSalida += tokensAprox(r.texto ?? '');
      indices = Array.isArray(r.json?.f) ? (r.json!.f as unknown[]).map((x) => Math.trunc(num(x)) - 1) : [];
    } catch {
      // Sin respuesta, se quedan sin clasificar (y sin enlazar: si hay duda, no).
      continue;
    }
    const si = new Set(indices);
    for (const [j, e] of grupo.entries()) {
      const f = si.has(j) ? 1 : 0;
      await sql.ejecutar(
        `UPDATE entidades SET ficticia = ?, descripcion = CASE WHEN ? = 1 THEN ? ELSE descripcion END WHERE id = ?`,
        f, f, DESCRIPCION_FICCION, e.id,
      );
      clasificadas++;
      ficticias += f;
    }
  }
  return { clasificadas, ficticias, uso };
}

export interface ResultadoReparacion {
  reasignadas: number;
  creadas: number;
  clasificadas: number;
  ficticias: number;
  enlazadas: number;
  consultasWikidata: number;
  fusiones: number;
  documentos: number;
  usdEstimado: number;
  ms: number;
}

/**
 * Rehace la fase de enlace y fusión de toda la biblioteca. Idempotente: dos
 * veces seguidas dejan lo mismo (la segunda sin llamadas nuevas).
 */
export async function rehacerEnlacesEntidades(sql: SQL, redactor: Redactor | undefined, o: { wikidata?: false | OpcionesWikidata } = {}): Promise<ResultadoReparacion> {
  const t0 = Date.now();
  // 1. Fuera las fusiones: cada fila vuelve a ser ella misma.
  await sql.ejecutar('UPDATE entidades SET fusionada_en = NULL');
  await sql.ejecutar("UPDATE entidades SET ficticia = 1 WHERE tipo = 'persona' AND descripcion = ?", DESCRIPCION_FICCION);

  // 2. Cada mención, a la entidad de su nombre canónico; si su forma no puede
  //    nombrarla («Dédée» como forma de Johnny Carter), a la entidad de esa forma.
  const combinaciones = await sql.ejecutar<{ tipo: TipoEntidad; normalizado: string; texto: string }>('SELECT DISTINCT tipo, normalizado, texto FROM menciones');
  let reasignadas = 0, creadas = 0;
  const antes = num((await sql.ejecutar<{ n: number }>('SELECT COUNT(*) AS n FROM entidades'))[0]?.n);
  for (const c of combinaciones) {
    const propia = formaCompatible(c.texto, c.normalizado, c.tipo);
    const nombre = propia ? c.normalizado : c.texto.replace(/\s+/g, ' ').trim();
    const [fila] = await sql.ejecutar<{ id: string }>('SELECT id FROM entidades WHERE tipo = ? AND clave = ?', c.tipo, claveEntidad(nombre, c.tipo));
    const id = fila?.id ?? (await obtenerEntidad(sql, c.tipo, nombre, [], null));
    const [cambio] = await sql.ejecutar<{ n: number }>('SELECT COUNT(*) AS n FROM menciones WHERE tipo = ? AND normalizado = ? AND texto = ? AND entidad <> ?', c.tipo, c.normalizado, c.texto, id);
    if (num(cambio?.n)) {
      await sql.ejecutar('UPDATE menciones SET entidad = ? WHERE tipo = ? AND normalizado = ? AND texto = ?', id, c.tipo, c.normalizado, c.texto);
      reasignadas += num(cambio?.n);
    }
  }
  creadas = num((await sql.ejecutar<{ n: number }>('SELECT COUNT(*) AS n FROM entidades'))[0]?.n) - antes;

  // 3. Alias = las formas escritas de sus menciones que pueden nombrarla; enlaces de Wikidata, de cero.
  const filas = await sql.ejecutar<{ id: string; tipo: TipoEntidad; clave: string; nombre: string; ficticia: number | null }>('SELECT id, tipo, clave, nombre, ficticia FROM entidades');
  const formas = new Map<string, Set<string>>();
  for (const f of await sql.ejecutar<{ entidad: string; texto: string }>('SELECT DISTINCT entidad, texto FROM menciones')) {
    (formas.get(f.entidad) ?? formas.set(f.entidad, new Set()).get(f.entidad)!).add(f.texto.replace(/\s+/g, ' ').trim());
  }
  const t = ahora();
  for (const e of filas) {
    const alias = [...(formas.get(e.id) ?? [])].filter((x) => x.toLowerCase() !== e.nombre.toLowerCase() && formaCompatible(x, e.nombre, e.tipo)).slice(0, 30);
    await sql.ejecutar(
      `UPDATE entidades SET alias = ?, busqueda = ?, wikidata = NULL, wikidata_visto = 0,
         descripcion = CASE WHEN ficticia = 1 THEN ? ELSE NULL END, actualizada = ? WHERE id = ?`,
      JSON.stringify(alias), textoBusqueda(e.clave, alias), DESCRIPCION_FICCION, t, e.id,
    );
  }
  await recontar(sql);

  // 4. ¿Personaje o persona real? Solo las que no se sabe (las antiguas).
  let clasificadas = 0, ficticias = 0, usd = 0;
  if (redactor) {
    const r = await clasificarFiccion(sql, redactor);
    clasificadas = r.clasificadas; ficticias = r.ficticias; usd += usdAprox(r.uso);
  }

  // 5. Aristas (las pistas de Wikidata las usan), Wikidata, resolución y aristas otra vez.
  const documentos = (await sql.ejecutar<{ documento: string }>('SELECT DISTINCT documento FROM menciones')).map((f) => f.documento);
  for (const d of documentos) await reconstruirAristasDocumento(sql, d);
  let enlazadas = 0, consultas = 0;
  if (o.wikidata !== false) {
    let previas = Infinity;
    for (let vuelta = 0; vuelta < 20; vuelta++) {
      const w = await enlazarWikidata(sql, { maximo: 400, ...(o.wikidata ?? {}) });
      enlazadas += w.enlazadas; consultas += w.consultadas;
      const quedan = num((await sql.ejecutar<{ n: number }>(
        "SELECT COUNT(*) AS n FROM entidades WHERE fusionada_en IS NULL AND wikidata IS NULL AND wikidata_visto = 0 AND tipo IN ('persona','obra','lugar','organizacion','evento') AND (n_menciones >= 2 OR n_documentos >= 2)",
      ))[0]?.n);
      // Sin avance (Wikidata caído o sin red): se deja para otra pasada.
      if (!quedan || quedan >= previas) break;
      previas = quedan;
    }
  }
  const resolucion = await resolverBiblioteca(sql);
  for (const d of documentos) await reconstruirAristasDocumento(sql, d);
  await recontar(sql);
  // Relaciones con nombre: fuera las de entidades que ya no existen como tales
  // y las que no nombran a las dos con sus nombres de ahora.
  const relaciones = await sql.ejecutar<{ a: string; b: string; etiqueta: string | null; na: string | null; nb: string | null; ok: number }>(
    `SELECT r.a, r.b, r.etiqueta, ea.nombre AS na, eb.nombre AS nb,
            (ea.fusionada_en IS NULL AND eb.fusionada_en IS NULL AND ea.n_menciones > 0 AND eb.n_menciones > 0) AS ok
       FROM entidades_relaciones r LEFT JOIN entidades ea ON ea.id = r.a LEFT JOIN entidades eb ON eb.id = r.b`,
  );
  for (const r of relaciones) {
    if (!num(r.ok) || !r.na || !r.nb || (r.etiqueta && !fraseValida(r.etiqueta, r.na, r.nb))) {
      await sql.ejecutar('DELETE FROM entidades_relaciones WHERE a = ? AND b = ?', r.a, r.b);
    }
  }
  return {
    reasignadas, creadas, clasificadas, ficticias, enlazadas, consultasWikidata: consultas, fusiones: resolucion.fusiones,
    documentos: documentos.length, usdEstimado: Math.round(usd * 1e5) / 1e5, ms: Date.now() - t0,
  };
}


/**
 * Versión de las reglas de enlace y fusión. Cuando sube, cada biblioteca se
 * repara sola una vez (la primera vez que se mira el estado de las entidades,
 * en el barrido diario o tras una ingesta), sin volver a extraer.
 * 2: personajes de ficción, formas compatibles y obras por autor y año.
 */
export const VERSION_ENLACES = 2;
const CLAVE_VERSION = 'entidades_enlaces_version';
const CLAVE_EN_MARCHA = 'entidades_enlaces_en_marcha';

export async function enlacesAlDia(sql: SQL): Promise<boolean> {
  const hay = num((await sql.ejecutar<{ n: number }>('SELECT COUNT(*) AS n FROM menciones'))[0]?.n);
  if (!hay) return true;
  if (num(await leerAjuste(sql, CLAVE_VERSION), 1) >= VERSION_ENLACES) return true;
  // Sin marca: si todas las personas saben ya si son personajes, la biblioteca
  // se hizo con las reglas de ahora (se apunta y listo); si no, es anterior.
  const antiguas = num((await sql.ejecutar<{ n: number }>("SELECT COUNT(*) AS n FROM entidades WHERE tipo = 'persona' AND ficticia IS NULL AND fusionada_en IS NULL AND n_menciones > 0"))[0]?.n);
  if (!antiguas) { await fijarAjuste(sql, CLAVE_VERSION, String(VERSION_ENLACES)); return true; }
  return false;
}

/** Repara la biblioteca si sus enlaces son de una versión anterior. Devuelve el resultado o null si no hacía falta. */
export async function ponerAlDiaEnlaces(sql: SQL, redactor: Redactor | undefined, o: { wikidata?: false | OpcionesWikidata } = {}): Promise<ResultadoReparacion | null> {
  if (await enlacesAlDia(sql)) return null;
  // Un cerrojo con caducidad: dos peticiones a la vez no reparan dos veces.
  const enMarcha = await leerAjuste(sql, CLAVE_EN_MARCHA);
  if (enMarcha && Date.now() - Date.parse(enMarcha) < 10 * 60_000) return null;
  await fijarAjuste(sql, CLAVE_EN_MARCHA, ahora());
  try {
    const r = await rehacerEnlacesEntidades(sql, redactor, o);
    await fijarAjuste(sql, CLAVE_VERSION, String(VERSION_ENLACES));
    return r;
  } finally {
    await fijarAjuste(sql, CLAVE_EN_MARCHA, null);
  }
}
