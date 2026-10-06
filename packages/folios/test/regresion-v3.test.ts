/**
 * Regresión con los SPDF v3 reales (bench/datos, no versionado): se toman las
 * lecturas que v3 dio por buenas (confianza ≥ 0,9) como lo que «dijo el
 * lector», más el texto de cada página, y se comprueba que los folios salen
 * coherentes, incluidos los errores de lectura que v3 dejó pasar.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { enteroARomano } from '../src/candidatos.js';
import { deducirFolios } from '../src/folios.js';
import type { PaginaFolio } from '../src/tipos.js';

const DIR = join(import.meta.dirname, '../../../bench/datos/spdf-v3');
const hay = existsSync(DIR);
const tmp = hay ? mkdtempSync(join(tmpdir(), 'folios-v3-')) : '';
afterAll(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

interface PaginaV3 { pdf_page: number; book_page: number; confidence: number; text: string }

function paginasV3(nombre: string): PaginaV3[] {
  const ruta = join(tmp, `${nombre}.db`);
  writeFileSync(ruta, gunzipSync(readFileSync(join(DIR, `${nombre}.spdf`))));
  const db = new DatabaseSync(ruta, { readOnly: true });
  const filas = db.prepare('SELECT pdf_page, book_page, confidence, text FROM pages ORDER BY pdf_page').all() as unknown as PaginaV3[];
  db.close();
  return filas;
}

const folioV3 = (bp: number) => (bp < 0 ? enteroARomano(-bp) : String(bp));

function comoLector(filas: PaginaV3[]): PaginaFolio[] {
  return filas.map((f) => ({
    fisica: f.pdf_page,
    folio: f.confidence >= 0.9 && f.book_page !== 0 ? folioV3(f.book_page) : null,
    texto: f.text,
    vacia: !f.text.trim(),
  }));
}

describe.skipIf(!hay)('regresión con SPDF v3 reales', () => {
  it('The Discarded Image: corrige las lecturas erróneas de v3 y numera con desplazamiento 13', () => {
    const filas = paginasV3('the_discarded_image_an_introduction_t_z_library_sk,_1lib_sk,');
    const r = deducirFolios(comoLector(filas));
    const de = (fisica: number) => r.paginas.find((p) => p.fisica === fisica);
    // Lecturas buenas de v3 se respetan
    for (const [f, esperado] of [[26, '13'], [30, '17'], [58, '45'], [120, '107'], [181, '168'], [236, '223']] as const) {
      expect(de(f)?.impresa, `física ${f}`).toBe(esperado);
    }
    // Errores de v3: 78 → «5» (el pie dice «65 / LDI»), 94 → «8» (el pie dice «6 8I LDI»), 13 → «13»
    expect(de(78)?.impresa).toBe('65');
    expect(de(94)?.impresa).toBe('81');
    expect(de(13)?.impresa).not.toBe('13');
    // Preliminares en romanos
    expect(de(11)).toMatchObject({ impresa: 'viii', romana: true });
    expect(de(12)).toMatchObject({ impresa: 'ix', romana: true });
    // Todo el cuerpo con desplazamiento 13
    for (let f = 26; f <= 236; f++) expect(de(f)?.impresa, `física ${f}`).toBe(String(f - 13));
  });

  it('El perseguidor: folio = página física, como dijo v3', () => {
    const filas = paginasV3('cortazar1959perseguidor');
    const r = deducirFolios(comoLector(filas));
    for (const p of r.paginas) expect(p.impresa).toBe(String(p.fisica));
  });

  it('Attention Is All You Need: los números del pie («11», «12») anclan 1-15', () => {
    const filas = paginasV3('attention_2017').map((f) => ({ ...f, confidence: 0 })); // sin lecturas de v3
    const r = deducirFolios(comoLector(filas));
    expect(r.paginas.find((p) => p.fisica === 11)).toMatchObject({ impresa: '11', origen: 'leido' });
    for (const p of r.paginas) expect(p.impresa).toBe(String(p.fisica));
  });

  it('El casamiento en la muerte (1753): sin lecturas fiables no se inventan folios romanos', () => {
    const filas = paginasV3('el-casamiento-en-la-muerte-y-hechos-de-bernardo-del-carpio-comedia-famosa');
    const r = deducirFolios(comoLector(filas));
    // v3 había puesto i…xxiii a las 24 primeras páginas con confianza 0,7: aquí no.
    expect(r.paginas.filter((p) => p.romana)).toHaveLength(0);
  });
});
