/**
 * Reprocesar sustituye, no suma. En producción, el reintento de una película
 * dejó dos transcripciones superpuestas (los ids de los fragmentos salen del
 * texto, y la revisión de la transcripción lo cambia) y el doble de fotogramas
 * (sus ids son nuevos en cada ingesta).
 */
import { describe, expect, it } from 'vitest';
import { ejecutarIngesta } from '../src/orquestador.js';
import { baseReal, fuenteFalsa, inteligenciaFalsa, paginaPdf, paquetePdf } from './fakes.js';

const texto = (n: number, version: string) => Array.from({ length: 30 }, (_, i) => `Frase ${i} de la página ${n}, ${version}, sobre la heladería Coppelia.`).join(' ');

describe('reprocesar un documento', () => {
  it('quita los fragmentos, las unidades y las figuras de la ingesta anterior', async () => {
    const { sql, filas } = await baseReal();
    const n = async (q: string) => Number((await filas<{ n: number }>(q, 'doc'))[0]?.n);
    const puertos = { inteligencia: inteligenciaFalsa(), fuente: fuenteFalsa, sql };

    const primera = await ejecutarIngesta(paquetePdf([1, 2, 3, 4, 5].map((f) => paginaPdf(f, texto(f, 'primera versión')))), puertos, { sinVerificacion: true, documentoId: 'doc' });
    expect(await n('SELECT count(*) AS n FROM fragmentos WHERE documento = ?')).toBe(primera.fragmentos.length);
    // Una figura de la ingesta anterior, con su vector.
    await sql.ejecutar("INSERT INTO figuras (id, documento, unidad, imagen, descripcion, ancla) VALUES ('fg-vieja', 'doc', 'doc:u0', 'x.png', 'vieja', '{}')");
    const [espacio] = await filas<{ id: string }>('SELECT id FROM espacios LIMIT 1');
    await sql.ejecutar("INSERT INTO vectores (id, documento, objetivo, espacio, valores) VALUES ('fg-vieja', 'doc', 'figura', ?, ?)", espacio!.id, new Uint8Array(16));

    // Segunda ingesta: otro texto (como una transcripción revisada) y una página menos.
    const segunda = await ejecutarIngesta(paquetePdf([1, 2, 3, 4].map((f) => paginaPdf(f, texto(f, 'segunda versión')))), puertos, { sinVerificacion: true, documentoId: 'doc' });
    const ids = (await filas<{ id: string; texto: string }>('SELECT id, texto FROM fragmentos WHERE documento = ?', 'doc'));
    expect(ids.length).toBe(segunda.fragmentos.length);
    expect(ids.some((f) => f.texto.includes('primera versión'))).toBe(false);
    expect(await n('SELECT count(*) AS n FROM unidades WHERE documento = ?')).toBe(4);
    expect(await n("SELECT count(*) AS n FROM figuras WHERE documento = ? AND id = 'fg-vieja'")).toBe(0);
    expect(await n("SELECT count(*) AS n FROM vectores WHERE documento = ? AND id = 'fg-vieja'")).toBe(0);
    // Ningún vector de fragmento huérfano.
    expect(await n("SELECT count(*) AS n FROM vectores v WHERE v.documento = ? AND v.objetivo = 'fragmento' AND NOT EXISTS (SELECT 1 FROM fragmentos f WHERE f.id = v.id)")).toBe(0);
  });
});
