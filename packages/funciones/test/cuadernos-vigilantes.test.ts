import { describe, expect, it } from 'vitest';
import { buscadorLocal } from '../src/buscador-local.js';
import {
  actualizarTarjeta,
  borrarCuaderno,
  crearCuaderno,
  crearTarjeta,
  depurarMarcas,
  listarCuadernos,
  listarSintesis,
  listarTarjetas,
  ordenarTarjetas,
  reverificarCuaderno,
  sintetizar,
} from '../src/cuadernos.js';
import {
  clasificarCambio,
  crearVigilante,
  ejecutarVigilante,
  listarAlertas,
  listarVigilantes,
  marcarAlertaVista,
  vigilarIngesta,
} from '../src/vigilantes.js';
import { embebedorFalso, estanteria, juezFalso, puertos, redactorFalso, sembrar } from './ayudas.js';

// Bentham, «Panopticon; or, the Inspection-House» (1791), cartas V y II, literal de Wikisource:
// https://en.wikisource.org/wiki/Panopticon_or_the_Inspection-House (los folios son los de esta copia de prueba).
const BENTHAM = {
  id: 'bentham',
  titulo: 'Panopticon; or, the Inspection-House',
  autores: [['Jeremy', 'Bentham']] as Array<[string, string]>,
  anio: 1791,
  paginas: [
    'The essence of it consists, then, in the centrality of the inspector’s situation, combined with the wellknown and most effectual contrivances for seeing without being seen.',
    'The building is circular.',
  ],
};

// Cervantes, «Don Quijote», primera parte, cap. VIII: https://www.gutenberg.org/cache/epub/2000/pg2000.txt
const QUIJOTE = {
  id: 'quijote',
  titulo: 'El ingenioso hidalgo don Quijote de la Mancha',
  autores: [['Miguel de', 'Cervantes']] as Array<[string, string]>,
  anio: 1605,
  paginas: ['En esto, descubrieron treinta o cuarenta molinos de viento que hay en aquel campo; y, así como don Quijote los vio, dijo a su escudero:'],
};

describe('buscador local', () => {
  it('fusiona léxico y denso y respeta los filtros', async () => {
    const sql = await estanteria();
    await sembrar(sql, BENTHAM);
    await sembrar(sql, QUIJOTE);
    const b = buscadorLocal(sql, embebedorFalso());
    const r = await b.buscar({ consulta: 'seeing without being seen', k: 5 });
    expect(r.resultados[0]!.fragmento.id).toBe('bentham-f1');
    expect(r.resultados[0]!.vias).toContain('lexica');
    const filtrado = await b.buscar({ consulta: 'molinos de viento', filtros: { anioHasta: 1700 }, k: 5 });
    expect(filtrado.resultados.length).toBeGreaterThan(0);
    expect(filtrado.resultados.every((x) => x.documento.id === 'quijote')).toBe(true);
  });
});

describe('cuadernos', () => {
  it('crea tarjetas con citas verificadas, ordena y reverifica', async () => {
    const sql = await estanteria();
    await sembrar(sql, BENTHAM);
    const p = puertos(sql, { inteligencia: { juez: juezFalso(() => 0.8) } });
    const c = await crearCuaderno(sql, { titulo: 'Inspección' });
    const t1 = await crearTarjeta(p, c.id, { tipo: 'fragmento', objetivo: 'bentham-f1', contenido: { afirmacion: 'El inspector ve sin ser visto.' } });
    expect(t1.cita).toEqual({ texto: BENTHAM.paginas[0], etiqueta: 'p. 11', citaCorta: 'Bentham 1791, p. 11' });
    expect(t1.respaldo).toBe(0.8);
    const t2 = await crearTarjeta(p, c.id, { tipo: 'nota', contenido: { texto: 'Relacionar con la carta II.' } });
    const t3 = await crearTarjeta(p, c.id, { tipo: 'unidad', objetivo: 'bentham-u2' });
    await ordenarTarjetas(sql, c.id, [t3.id, t1.id]);
    expect((await listarTarjetas(sql, c.id)).map((t) => t.id)).toEqual([t3.id, t1.id, t2.id]);
    await actualizarTarjeta(p, c.id, t2.id, { posicion: 0 });
    expect((await listarTarjetas(sql, c.id))[0]!.id).toBe(t2.id);
    expect((await listarCuadernos(sql))[0]!.tarjetas).toBe(3);

    await sql.ejecutar("UPDATE fragmentos SET texto = 'Texto corregido de prueba.' WHERE id = 'bentham-f1'");
    await sql.ejecutar("DELETE FROM unidades WHERE id = 'bentham-u2'");
    const rev = await reverificarCuaderno(p, c.id);
    const porId = new Map(rev.map((t) => [t.id, t]));
    expect(porId.get(t1.id)!.estado).toBe('cambiada');
    expect(porId.get(t1.id)!.cita!.texto).toBe('Texto corregido de prueba.');
    expect(porId.get(t1.id)!.contenido.pasajeAnterior).toBe(BENTHAM.paginas[0]);
    expect(porId.get(t3.id)!.huerfana).toBe(true);
    await expect(crearTarjeta(p, c.id, { tipo: 'fragmento', objetivo: 'no-existe' })).rejects.toMatchObject({ codigo: 'no_encontrado' });
  });

  it('sintetiza citando solo las tarjetas y descarta marcas inventadas', async () => {
    const sql = await estanteria();
    await sembrar(sql, BENTHAM);
    const redactor = redactorFalso(() => ({ texto: 'El inspector lo ve todo [1] desde el centro de un edificio circular [2]. Además [7].', confianza: 'alta' }));
    const p = puertos(sql, { inteligencia: { redactor } });
    const c = await crearCuaderno(sql, { titulo: 'Arquitectura' });
    const a = await crearTarjeta(p, c.id, { tipo: 'fragmento', objetivo: 'bentham-f1' });
    const b = await crearTarjeta(p, c.id, { tipo: 'fragmento', objetivo: 'bentham-f2' });
    const s = await sintetizar(p, c.id, 'Resume la idea de inspección.');
    expect(s.texto).toBe('El inspector lo ve todo [1] desde el centro de un edificio circular [2]. Además.');
    expect(s.citas).toEqual([
      { n: 1, tarjeta: a.id, fragmento: 'bentham-f1', etiqueta: 'Bentham 1791, p. 11' },
      { n: 2, tarjeta: b.id, fragmento: 'bentham-f2', etiqueta: 'Bentham 1791, p. 12' },
    ]);
    expect(s.marcasDescartadas).toBe(1);
    expect(await listarSintesis(sql, c.id)).toHaveLength(1);
    await borrarCuaderno(sql, c.id);
    expect(await listarCuadernos(sql)).toHaveLength(0);
  });

  it('depura marcas múltiples', () => {
    expect(depurarMarcas('a [1, 9] b [3;2]', new Set([1, 2, 3]))).toEqual({ texto: 'a [1] b [3, 2]', usadas: [1, 2, 3], descartadas: 1 });
  });
});

describe('vigilantes', () => {
  it('avisa cuando un documento nuevo entra en los resultados', async () => {
    const sql = await estanteria();
    await sembrar(sql, QUIJOTE);
    const emitidos: unknown[] = [];
    const p = puertos(sql, {
      inteligencia: { embebedor: embebedorFalso() },
      emisor: { emitir: async (canal, e) => void emitidos.push([canal, e]) },
    });
    const v = await crearVigilante(sql, { nombre: 'Casa de inspección', consulta: 'inspection-house prisoners cells', modo: 'al_ingerir' });
    expect(await ejecutarVigilante(p, v.id)).toBeNull(); // primera vez: fija la línea base
    expect(await ejecutarVigilante(p, v.id)).toBeNull(); // nada nuevo
    // Carta XVI del «Panopticon» (Wikisource, enlace arriba).
    await sembrar(sql, { ...BENTHAM, paginas: ['In the penitentiary inspection-house, the prisoners were to lie, as they were to eat, to work, to pray, and to do every thing, in their cells, and nowhere else.'] });
    const alertas = await vigilarIngesta(p, 'bentham');
    expect(alertas).toHaveLength(1);
    expect(alertas[0]!.documentosNuevos).toEqual(['bentham']);
    expect(alertas[0]!.disparadaPor).toBe('ingesta');
    expect(emitidos).toHaveLength(1);
    expect((await listarVigilantes(sql))[0]!.pendientes).toBe(1);
    await marcarAlertaVista(sql, alertas[0]!.id);
    expect(await listarAlertas(sql, { pendientes: true })).toHaveLength(0);
  });

  it('clasifica los cambios de respuesta', () => {
    expect(clasificarCambio('a', 'baja', 'a', 'alta')).toBe('confianza_sube');
    expect(clasificarCambio('a', 'alta', 'b', 'alta')).toBe('respuesta_cambia');
    expect(clasificarCambio(null, null, null, null)).toBe('sin_cambios');
  });
});
