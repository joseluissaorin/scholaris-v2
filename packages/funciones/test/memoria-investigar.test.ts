import { describe, expect, it } from 'vitest';
import { borrarTarjeta, crearCuaderno, crearTarjeta, guardarSintesis, listarSintesis } from '../src/cuadernos.js';
import { aplicarEsquemaFunciones } from '../src/esquema.js';
import { estanteria, puertos, sembrar } from './ayudas.js';

// Senel Paz, «El lobo, el bosque y el hombre nuevo» (1991), arranque (copia de prueba).
const PAZ = {
  id: 'paz',
  titulo: 'El lobo, el bosque y el hombre nuevo',
  autores: [['Senel', 'Paz']] as Array<[string, string]>,
  anio: 1991,
  paginas: ['Ismael y yo salimos del bar y nos despedimos, lo siento David pero ya son las dos, y me quedé con aquella necesidad de conversar.'],
};

const buscarMemoria = async (sql: Awaited<ReturnType<typeof estanteria>>, q: string) =>
  sql.ejecutar<{ objeto: string; clase: string }>('SELECT objeto, clase FROM cuadernos_fts WHERE cuadernos_fts MATCH ? ORDER BY rank', q);

describe('memoria de las investigaciones (cuadernos_fts y síntesis guardadas)', () => {
  it('indexa cuadernos, tarjetas y síntesis, y los olvida al borrarlos', async () => {
    const sql = await estanteria();
    await sembrar(sql, PAZ);
    const p = puertos(sql);
    const c = await crearCuaderno(sql, { titulo: 'Investigación: Coppelia en el cuento', cuerpo: 'Helado y amistad' });
    const t = await crearTarjeta(p, c.id, { tipo: 'nota', contenido: { texto: 'Hipótesis: la heladería funciona como umbral.' } });
    expect((await buscarMemoria(sql, 'umbral')).map((x) => x.objeto)).toEqual([t.id]);
    expect((await buscarMemoria(sql, 'coppelia')).map((x) => x.clase)).toEqual(['cuaderno']);
    await borrarTarjeta(sql, c.id, t.id);
    expect(await buscarMemoria(sql, 'umbral')).toEqual([]);
  });

  it('guarda una síntesis ya redactada que solo cita tarjetas citables', async () => {
    const sql = await estanteria();
    await sembrar(sql, PAZ);
    const p = puertos(sql);
    const c = await crearCuaderno(sql, { titulo: 'Investigación' });
    const [u] = await sql.ejecutar<{ id: string }>('SELECT id FROM unidades WHERE documento = ? ORDER BY orden LIMIT 1', 'paz');
    await crearTarjeta(p, c.id, { tipo: 'unidad', objetivo: u!.id });
    await crearTarjeta(p, c.id, { tipo: 'nota', contenido: { texto: 'nota' } });
    const s = await guardarSintesis(sql, c.id, { peticion: '¿Dónde empieza?', cuerpo: 'Empieza en el bar [1] y no en el cine [2].', confianza: 'alta', modelo: 'prueba' });
    expect(s.texto).toBe('Empieza en el bar [1] y no en el cine.');
    expect(s.citas).toHaveLength(1);
    expect(s.marcasDescartadas).toBe(1);
    expect((await listarSintesis(sql, c.id))[0]?.id).toBe(s.id);
    expect((await buscarMemoria(sql, 'bar')).some((x) => x.objeto === s.id)).toBe(true);
  });

  it('al crear el índice sobre una base con cuadernos, los incluye', async () => {
    const sql = await estanteria();
    await crearCuaderno(sql, { titulo: 'Fresa y chocolate' });
    sql.db.exec('DROP TABLE cuadernos_fts');
    await aplicarEsquemaFunciones(sql);
    expect((await buscarMemoria(sql, 'fresa')).length).toBe(1);
  });
});
