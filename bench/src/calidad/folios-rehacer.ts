/**
 * `pnpm bench calidad folios-rehacer [--simular]`: recalcula los folios de las
 * fuentes congeladas del banco (bench/datos/calidad/fuentes) desde sus unidades
 * guardadas, con `rehacerFolios` de @scholaris/spdf, sin volver a leer nada y
 * sin cambiar los identificadores de fragmento (los juicios siguen valiendo).
 * Guarda una copia «.antes-folios.sqlite» de cada fuente la primera vez.
 * Después hay que reconstruir la estantería: `pnpm bench calidad estanteria`.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQL, ValorSQL } from '@scholaris/nucleo';
import { rehacerFolios } from '@scholaris/spdf';
import { DIR_DATOS_CALIDAD } from './estanteria.js';
import { CORTO, SPDF_BANCO } from './estanteria.js';

function puerto(bd: DatabaseSync): SQL {
  const p: SQL = {
    async ejecutar<T>(c: string, ...v: ValorSQL[]) {
      const st = bd.prepare(c);
      const args = v.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x)) as Array<string | number | null | Uint8Array>;
      if (/^\s*(SELECT|PRAGMA|WITH)/i.test(c)) return st.all(...args) as T[];
      st.run(...args);
      return [];
    },
    async transaccion<T>(fn: (s: SQL) => Promise<T>) { bd.exec('BEGIN'); try { const r = await fn(p); bd.exec('COMMIT'); return r; } catch (e) { bd.exec('ROLLBACK'); throw e; } },
  };
  return p;
}

export async function foliosRehacer(args: string[]): Promise<void> {
  const simular = args.includes('--simular');
  for (const etiqueta of SPDF_BANCO) {
    const ruta = join(DIR_DATOS_CALIDAD, 'fuentes', `${etiqueta}.sqlite`);
    if (!existsSync(ruta)) { console.error(`${etiqueta}: no hay fuente congelada`); continue; }
    const copia = ruta.replace(/\.sqlite$/, '.antes-folios.sqlite');
    if (!simular && !existsSync(copia)) copyFileSync(ruta, copia);
    const bd = new DatabaseSync(ruta);
    try {
      const sql = puerto(bd);
      for (const { id } of await sql.ejecutar<{ id: string }>('SELECT id FROM documentos')) {
        const r = await rehacerFolios(sql, id, { simular });
        console.log(`${(CORTO[etiqueta] ?? etiqueta).padEnd(12)} ${r.unidades} págs.  folios cambiados ${r.cambiadas}  anclas ${r.actualizadas}  fragmentos ${r.fragmentos}  figuras ${r.figuras}  (${r.fuente ?? '—'})${r.cambios.length ? `\n   ${r.cambios.slice(0, 12).join('; ')}` : ''}`);
      }
    } finally {
      bd.close();
    }
  }
}
