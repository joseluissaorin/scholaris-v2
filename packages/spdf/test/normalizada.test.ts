/**
 * SPDF 4.1: la capa de ortografía modernizada (`fragmentos.texto_busqueda`),
 * su migración desde 4.0 y la búsqueda léxica que la usa.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Documento, Fragmento, SQL, ValorSQL } from '@scholaris/nucleo';
import { describe, expect, it } from 'vitest';
import { abrirSpdf, crearSpdf } from '../src/archivo.js';
import { aplicarEsquema, rellenarTextoBusqueda, VERSION_SPDF } from '../src/esquema.js';
import { buscarTexto, escribirFragmentos, leerClave } from '../src/repositorio.js';

const ESQUEMA_40 = readFileSync(join(import.meta.dirname, '../esquema/v4.0.sql'), 'utf8');

function puertoNode(db: DatabaseSync, opciones: { sinPragma?: boolean } = {}): SQL {
  const puerto: SQL = {
    async ejecutar<T>(consulta: string, ...p: ValorSQL[]): Promise<T[]> {
      if (opciones.sinPragma && /^\s*PRAGMA/i.test(consulta)) throw new Error('not authorized');
      const st = db.prepare(consulta);
      const params = p.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v)) as Array<string | number | null | Uint8Array>;
      if (/^\s*(SELECT|PRAGMA|WITH)/i.test(consulta)) return st.all(...params) as T[];
      st.run(...params);
      return [];
    },
    async transaccion<T>(fn: (sql: SQL) => Promise<T>): Promise<T> {
      db.exec('SAVEPOINT t');
      try { const r = await fn(puerto); db.exec('RELEASE t'); return r; } catch (e) { db.exec('ROLLBACK TO t'); db.exec('RELEASE t'); throw e; }
    },
  };
  return puerto;
}

const pagina = (fisica: number) => ({ tipo: 'pagina' as const, fisica, impresa: String(fisica), romana: false, origen: 'leido' as const, confianza: 1 });

function documento(id: string, idioma: string, anio?: number): Documento {
  return {
    id, tipo: 'pdf', metadatos: { titulo: id, autores: [], idioma, ...(anio ? { anio } : {}) },
    estado: 'listo', huella: id, original: '', mime: 'application/pdf', bytes: 1, unidades: 1, creado: 'x', actualizado: 'x', bibliotecas: [],
  };
}

// Versos de «El casamiento en la muerte» (Lope), tal como están en el SPDF del banco.
const LOPE = [
  'No estoy muy enamorado;\nque es pequeño el corazon,\ny un Padre con su prision\ntiene lo mas ocupado.',
  'Y assi, dice Brabonèl,\ny en lo que te ama Aragon,\nque no ha de haver ocasion\nen que no te acuerdes de èl.',
  '*Al.* Mi Exercito, y el tuyo dando al viẽto\nlas Vanderas cruzadas, y las Lunas,\ntomaràn de este Valle el hondo assiento.',
  'tengo por bien, q̃ en mis Vanderas ande\npor armas, por blason, y por trofeo. La muger de mi Padre, aora, con su honrra.',
];
const MODERNO = [
  'La mujer del padre volvió ahora con su honra intacta, y así lo contó Bruno en la biografía.',
  'Johnny Carter toca el saxo en París; el corazón le late como un reloj roto.',
];

function fragmentos(doc: string, textos: string[]): Fragmento[] {
  return textos.map((texto, i) => ({ id: `${doc}-${i}`, documento: doc, unidad: `${doc}-u`, orden: i, texto, contexto: '', seccion: [], ancla: pagina(i + 1) }));
}

/** Una base 4.0 de verdad (el guion histórico), con fragmentos ya indexados. */
async function base40(ruta = ':memory:'): Promise<{ db: DatabaseSync; sql: SQL }> {
  const db = new DatabaseSync(ruta);
  db.exec(ESQUEMA_40);
  db.exec("INSERT INTO spdf(clave, valor) VALUES ('spdf_version', '4.0')");
  const sql = puertoNode(db, { sinPragma: true });
  await sql.ejecutar(
    `INSERT INTO documentos (id, tipo, metadatos, huella, original, mime, bytes, creado, actualizado, titulo, idioma)
     VALUES ('lope', 'pdf', ?, 'h', '', 'application/pdf', 1, 'x', 'x', 'El casamiento en la muerte', 'es'),
            ('cortazar', 'pdf', ?, 'h2', '', 'application/pdf', 1, 'x', 'x', 'El perseguidor', 'es')`,
    JSON.stringify({ titulo: 'El casamiento en la muerte', autores: [], idioma: 'es' }),
    JSON.stringify({ titulo: 'El perseguidor', autores: [], idioma: 'es', anio: 1959 }),
  );
  for (const [doc, textos] of [['lope', LOPE], ['cortazar', MODERNO]] as const) {
    textos.forEach((t, i) => db.prepare(`INSERT INTO fragmentos (id, documento, unidad, orden, texto, contexto, seccion, ancla) VALUES (?, ?, 'u', ?, ?, '', '[]', '{}')`).run(`${doc}-${i}`, doc, i, t));
  }
  return { db, sql };
}

const ids = (r: Array<{ fragmento: Fragmento }>) => r.map((x) => x.fragmento.id).sort();

describe('SPDF 4.1: texto_busqueda', () => {
  it('escribirFragmentos calcula la capa con el idioma y la época del documento', async () => {
    const a = await crearSpdf();
    await a.escribirDocumento(documento('lope', 'es'));
    await a.escribirDocumento(documento('cortazar', 'es', 1959));
    await a.escribirDocumento(documento('virgilio', 'la'));
    await a.escribirFragmentos(fragmentos('lope', LOPE));
    await a.escribirFragmentos(fragmentos('cortazar', MODERNO));
    await a.escribirFragmentos(fragmentos('virgilio', ['Arma virumque cano, Troiae qui primus ab oris']));
    const filas = await a.sql.ejecutar<{ id: string; texto_busqueda: string }>('SELECT id, texto_busqueda FROM fragmentos ORDER BY n');
    const capa = new Map(filas.map((f) => [f.id, f.texto_busqueda]));
    expect(capa.get('lope-1')).toContain('asi dize');
    expect(capa.get('lope-3')).toContain('que en mis banderas');
    expect(capa.get('cortazar-0')).toBe('');
    expect(capa.get('virgilio-0')).toContain('uirum que');
    // El texto fiel no se toca.
    expect((await a.leerFragmento('lope-1'))?.texto).toBe(LOPE[1]);
    a.cerrar();
  });

  it('una capa explícita manda sobre el cálculo', async () => {
    const a = await crearSpdf();
    await a.escribirDocumento(documento('d', 'en'));
    await a.escribirFragmentos([{ ...fragmentos('d', ['plain text'])[0] as Fragmento, textoBusqueda: 'clave especial' }]);
    expect((await a.buscarTexto('especial')).map((r) => r.fragmento.id)).toEqual(['d-0']);
    a.cerrar();
  });

  it('la búsqueda en grafía moderna encuentra el texto antiguo; el resaltado es del texto fiel', async () => {
    const a = await crearSpdf();
    await a.escribirDocumento(documento('lope', 'es'));
    await a.escribirDocumento(documento('cortazar', 'es', 1959));
    await a.escribirFragmentos(fragmentos('lope', LOPE));
    await a.escribirFragmentos(fragmentos('cortazar', MODERNO));
    // Solo en el texto fiel, «así» no encuentra «assi».
    expect(ids(await a.buscarTexto('texto : "asi"', { crudo: true }))).toEqual(['cortazar-0']);
    expect(ids(await a.buscarTexto('así'))).toEqual(['cortazar-0', 'lope-1']);
    expect(ids(await a.buscarTexto('mujer'))).toEqual(['cortazar-0', 'lope-3']);
    expect(ids(await a.buscarTexto('honra'))).toEqual(['cortazar-0', 'lope-3']);
    expect(ids(await a.buscarTexto('ahora'))).toEqual(['cortazar-0', 'lope-3']);
    expect(ids(await a.buscarTexto('banderas ejército', { modo: 'todas' }))).toEqual(['lope-2']);
    expect(ids(await a.buscarTexto('corazón'))).toEqual(['cortazar-1', 'lope-0']);
    // Frase: la literal sigue en el texto fiel, y la normalizada encuentra la antigua.
    expect(ids(await a.buscarTexto('pequeño el corazon', { modo: 'frase', normalizada: false }))).toEqual(['lope-0']);
    expect(ids(await a.buscarTexto('y así dice', { modo: 'frase' }))).toEqual(['lope-1']);
    const r = await a.buscarTexto('asiento');
    expect(r[0]?.resaltado).toContain('assiento');
    a.cerrar();
  });

  it('el documento moderno no recibe ruido de las variantes antiguas', async () => {
    const a = await crearSpdf();
    await a.escribirDocumento(documento('cortazar', 'es', 1959));
    await a.escribirFragmentos(fragmentos('cortazar', ['Echo de menos el ruido del bar.', 'Es un hecho: la ola rompió.']));
    // «hecho» y «echo» comparten clave antigua, pero en un texto moderno no se mezclan.
    expect(ids(await a.buscarTexto('hecho'))).toEqual(['cortazar-1']);
    expect(ids(await a.buscarTexto('hola'))).toEqual([]);
    a.cerrar();
  });
});

describe('SPDF 4.0 → 4.1', () => {
  it('aplicarEsquema migra una base 4.0 (sin PRAGMA, como un Durable Object) y es idempotente', async () => {
    const { db, sql } = await base40();
    expect((await buscarTexto(sql, 'corazon', { normalizada: false })).length).toBe(2);
    await aplicarEsquema(sql, { generador: 'prueba' });
    expect(await leerClave(sql, 'spdf_version')).toBe(VERSION_SPDF);
    expect(await leerClave(sql, 'fts_pendiente')).toBeNull();
    const fts = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'fragmentos_fts'").get() as { sql: string };
    expect(fts.sql).toContain('texto_busqueda');
    const capa = db.prepare('SELECT id, texto_busqueda FROM fragmentos ORDER BY n').all() as Array<{ id: string; texto_busqueda: string | null }>;
    expect(capa.every((f) => f.texto_busqueda !== null)).toBe(true);
    expect(capa.find((f) => f.id === 'lope-1')?.texto_busqueda).toContain('asi');
    expect(capa.find((f) => f.id === 'cortazar-0')?.texto_busqueda).toBe('');
    expect(ids(await buscarTexto(sql, 'honra'))).toEqual(['cortazar-0', 'lope-3']);
    expect(ids(await buscarTexto(sql, 'corazon'))).toEqual(['cortazar-1', 'lope-0']);
    await aplicarEsquema(sql); // otra vez: nada que hacer
    expect(ids(await buscarTexto(sql, 'honra'))).toEqual(['cortazar-0', 'lope-3']);
    // Los disparadores siguen manteniendo el índice.
    await escribirFragmentos(sql, [{ ...fragmentos('lope', ['La fee del cauallero'])[0] as Fragmento, id: 'lope-9', orden: 9 }]);
    expect(ids(await buscarTexto(sql, 'fe caballero', { modo: 'todas' }))).toEqual(['lope-9']);
    db.exec("INSERT INTO fragmentos_fts(fragmentos_fts, rank) VALUES ('integrity-check', 1)");
    db.close();
  });

  it('una migración cortada a medias se termina en la siguiente apertura', async () => {
    const { db, sql } = await base40();
    // Simula un corte: columna añadida, índice viejo borrado, el nuevo creado vacío y sin reconstruir.
    db.exec("INSERT INTO spdf(clave, valor) VALUES ('fts_pendiente', '1')");
    db.exec('DROP TRIGGER fragmentos_ai; DROP TRIGGER fragmentos_ad; DROP TRIGGER fragmentos_au; DROP TABLE fragmentos_fts;');
    db.exec('ALTER TABLE fragmentos ADD COLUMN texto_busqueda TEXT');
    db.exec("CREATE VIRTUAL TABLE fragmentos_fts USING fts5(texto, contexto, seccion, texto_busqueda, content='fragmentos', content_rowid='n', tokenize='unicode61 remove_diacritics 2')");
    await aplicarEsquema(sql);
    expect(ids(await buscarTexto(sql, 'mujer'))).toEqual(['cortazar-0', 'lope-3']);
    expect(await leerClave(sql, 'fts_pendiente')).toBeNull();
    db.close();
  });

  it('abrirSpdf migra un .spdf 4.0 al abrirlo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spdf40-'));
    const { db } = await base40(join(dir, 'lope.sqlite'));
    db.close();
    const bytes = new Uint8Array(readFileSync(join(dir, 'lope.sqlite')));
    rmSync(dir, { recursive: true, force: true });
    const a = await abrirSpdf(bytes);
    expect(await a.version()).toBe(VERSION_SPDF);
    expect(ids(await a.buscarTexto('mujer'))).toEqual(['cortazar-0', 'lope-3']);
    expect(await a.comprobarIntegridad()).toEqual([]);
    a.cerrar();
  });

  it('rellenarTextoBusqueda completa lo insertado a mano', async () => {
    const a = await crearSpdf();
    await a.escribirDocumento(documento('lope', 'es', 1618));
    await a.sql.ejecutar(`INSERT INTO fragmentos (id, documento, unidad, orden, texto, contexto, seccion, ancla) VALUES ('x', 'lope', 'u', 1, 'Dixo la muger', '', '[]', '{}')`);
    expect(ids(await a.buscarTexto('dijo'))).toEqual([]);
    expect(await rellenarTextoBusqueda(a.sql)).toBe(1);
    expect(ids(await a.buscarTexto('dijo'))).toEqual(['x']);
    expect(await rellenarTextoBusqueda(a.sql)).toBe(0);
    a.cerrar();
  });
});

