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

const FOUCAULT = {
  id: 'foucault',
  titulo: 'Vigilar y castigar',
  autores: [['Michel', 'Foucault']] as Array<[string, string]>,
  anio: 1975,
  paginas: ['El panóptico es una máquina de disociar la pareja ver y ser visto.', 'La disciplina fabrica cuerpos sometidos y ejercitados, cuerpos dóciles.'],
};

describe('buscador local', () => {
  it('fusiona léxico y denso y respeta los filtros', async () => {
    const sql = await estanteria();
    await sembrar(sql, FOUCAULT);
    await sembrar(sql, { id: 'arendt', titulo: 'Eichmann en Jerusalén', autores: [['Hannah', 'Arendt']], anio: 1963, paginas: ['La banalidad del mal no es una teoría.'] });
    const b = buscadorLocal(sql, embebedorFalso());
    const r = await b.buscar({ consulta: 'panóptico', k: 5 });
    expect(r.resultados[0]!.fragmento.id).toBe('foucault-f1');
    expect(r.resultados[0]!.vias).toContain('lexica');
    const filtrado = await b.buscar({ consulta: 'banalidad del mal', filtros: { anioHasta: 1970 }, k: 5 });
    expect(filtrado.resultados.every((x) => x.documento.id === 'arendt')).toBe(true);
  });
});

describe('cuadernos', () => {
  it('crea tarjetas con citas verificadas, ordena y reverifica', async () => {
    const sql = await estanteria();
    await sembrar(sql, FOUCAULT);
    const p = puertos(sql, { inteligencia: { juez: juezFalso(() => 0.8) } });
    const c = await crearCuaderno(sql, { titulo: 'Disciplina' });
    const t1 = await crearTarjeta(p, c.id, { tipo: 'fragmento', objetivo: 'foucault-f1', contenido: { afirmacion: 'El panóptico separa ver y ser visto.' } });
    expect(t1.cita).toEqual({ texto: FOUCAULT.paginas[0], etiqueta: 'p. 11', citaCorta: 'Foucault 1975, p. 11' });
    expect(t1.respaldo).toBe(0.8);
    const t2 = await crearTarjeta(p, c.id, { tipo: 'nota', contenido: { texto: 'Relacionar con Deleuze.' } });
    const t3 = await crearTarjeta(p, c.id, { tipo: 'unidad', objetivo: 'foucault-u2' });
    await ordenarTarjetas(sql, c.id, [t3.id, t1.id]);
    expect((await listarTarjetas(sql, c.id)).map((t) => t.id)).toEqual([t3.id, t1.id, t2.id]);
    await actualizarTarjeta(p, c.id, t2.id, { posicion: 0 });
    expect((await listarTarjetas(sql, c.id))[0]!.id).toBe(t2.id);
    expect((await listarCuadernos(sql))[0]!.tarjetas).toBe(3);

    await sql.ejecutar("UPDATE fragmentos SET texto = 'El panóptico (texto corregido).' WHERE id = 'foucault-f1'");
    await sql.ejecutar("DELETE FROM unidades WHERE id = 'foucault-u2'");
    const rev = await reverificarCuaderno(p, c.id);
    const porId = new Map(rev.map((t) => [t.id, t]));
    expect(porId.get(t1.id)!.estado).toBe('cambiada');
    expect(porId.get(t1.id)!.cita!.texto).toBe('El panóptico (texto corregido).');
    expect(porId.get(t1.id)!.contenido.pasajeAnterior).toBe(FOUCAULT.paginas[0]);
    expect(porId.get(t3.id)!.huerfana).toBe(true);
    await expect(crearTarjeta(p, c.id, { tipo: 'fragmento', objetivo: 'no-existe' })).rejects.toMatchObject({ codigo: 'no_encontrado' });
  });

  it('sintetiza citando solo las tarjetas y descarta marcas inventadas', async () => {
    const sql = await estanteria();
    await sembrar(sql, FOUCAULT);
    const redactor = redactorFalso(() => ({ texto: 'El poder disciplinario vigila [1] y fabrica cuerpos dóciles [2]. Además [7].', confianza: 'alta' }));
    const p = puertos(sql, { inteligencia: { redactor } });
    const c = await crearCuaderno(sql, { titulo: 'Poder' });
    const a = await crearTarjeta(p, c.id, { tipo: 'fragmento', objetivo: 'foucault-f1' });
    const b = await crearTarjeta(p, c.id, { tipo: 'fragmento', objetivo: 'foucault-f2' });
    const s = await sintetizar(p, c.id, 'Resume la idea de disciplina.');
    expect(s.texto).toBe('El poder disciplinario vigila [1] y fabrica cuerpos dóciles [2]. Además.');
    expect(s.citas).toEqual([
      { n: 1, tarjeta: a.id, fragmento: 'foucault-f1', etiqueta: 'Foucault 1975, p. 11' },
      { n: 2, tarjeta: b.id, fragmento: 'foucault-f2', etiqueta: 'Foucault 1975, p. 12' },
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
    await sembrar(sql, FOUCAULT);
    const emitidos: unknown[] = [];
    const p = puertos(sql, {
      inteligencia: { embebedor: embebedorFalso() },
      emisor: { emitir: async (canal, e) => void emitidos.push([canal, e]) },
    });
    const v = await crearVigilante(sql, { nombre: 'Panóptico', consulta: 'panóptico vigilancia', modo: 'al_ingerir' });
    expect(await ejecutarVigilante(p, v.id)).toBeNull(); // primera vez: fija la línea base
    expect(await ejecutarVigilante(p, v.id)).toBeNull(); // nada nuevo
    await sembrar(sql, { id: 'bentham', titulo: 'El panóptico', autores: [['Jeremy', 'Bentham']], anio: 1791, paginas: ['El panóptico: una casa de inspección y vigilancia.'] });
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
