import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  actualizarConcepto, agregadosInforme, borrarConcepto, crearConcepto, crearInforme, etiquetarTramo, fusionarConfianza,
  listarConceptos, listarInformes, listarTramos, obtenerInforme, procesarInforme,
} from '../src/conceptos/conceptos.js';
import { exportarInforme } from '../src/conceptos/exportar.js';
import { detectarIdioma, variantes } from '../src/conceptos/lengua.js';
import type { EventoProgreso } from '../src/puertos.js';
import { embebedorFalso, estanteria, juezFalso, puertos, redactorFalso, reordenadorFalso, sembrar } from './ayudas.js';

describe('lengua', () => {
  it('detecta idiomas y flexiona', () => {
    expect(detectarIdioma('El concepto de la libertad en los textos de la época')).toBe('es');
    expect(detectarIdioma('The concept of freedom in the texts of the period')).toBe('en');
    expect(variantes('mujer', 'es')).toContain('mujeres');
    expect(variantes('niño', 'es')).toEqual(expect.arrayContaining(['niños', 'niña', 'niñas']));
    expect(variantes('woman', 'en')).toContain('women');
  });
  it('fusiona confianzas', () => {
    expect(fusionarConfianza({ regla: 0.8, semantica: null, reordenacion: null, juez: null })).toBe(0.8);
    expect(fusionarConfianza({ regla: 0.8, semantica: 0.5, reordenacion: 0.5, juez: 0.05 })).toBeLessThanOrEqual(0.25);
  });
});

describe('conceptos', () => {
  it('CRUD con nombres únicos', async () => {
    const sql = await estanteria();
    const c = await crearConcepto(sql, { nombre: 'Libertad', terminos: ['libertad', 'libre'] });
    await expect(crearConcepto(sql, { nombre: 'Libertad' })).rejects.toMatchObject({ codigo: 'duplicado' });
    const c2 = await actualizarConcepto(sql, c.id, { descripcion: 'Ausencia de dominación', tipo: 'tema' });
    expect(c2.descripcion).toBe('Ausencia de dominación');
    expect(c2.usarJuez).toBe(true);
    expect(await listarConceptos(sql)).toHaveLength(1);
    await borrarConcepto(sql, c.id);
    expect(await listarConceptos(sql)).toHaveLength(0);
  });

  it('extrae tramos con léxico, semántica, reordenador y juez; agrega y exporta', async () => {
    const sql = await estanteria();
    await sembrar(sql, { id: 'arendt', titulo: 'La condición humana', autores: [['Hannah', 'Arendt']], anio: 1958, idioma: 'es',
      paginas: ['La libertad política es la capacidad de actuar con otros.', 'Los hombres libres se reúnen en el espacio público.', 'La cocina de la casa era grande.'] });
    await sembrar(sql, { id: 'berlin', titulo: 'Two Concepts of Liberty', autores: [['Isaiah', 'Berlin']], anio: 1958, idioma: 'en',
      paginas: ['Negative liberty is the absence of interference.', 'Positive freedom means self-mastery.'] });
    const redactor = redactorFalso((texto) => {
      if (texto.includes('léxico en inglés')) return { lemas: ['liberty', 'freedom'], variantes: ['liberties'], excluir: [] };
      if (texto.includes('léxico en español')) return { lemas: ['libertad', 'libre'], variantes: ['libres'], excluir: ['librería'] };
      return { texto: 'La libertad aparece como acción [1] y como ausencia de interferencia [2].' };
    });
    const juez = juezFalso((estado) => (JSON.stringify(estado).includes('cocina') ? 0.05 : 0.9));
    const p = puertos(sql, { inteligencia: { redactor, juez, embebedor: embebedorFalso(), reordenador: reordenadorFalso() } });
    const c = await crearConcepto(sql, { nombre: 'Libertad', descripcion: 'libertad política', terminos: ['libertad'], tipo: 'tema' });
    const inf = await crearInforme(sql, c.id);
    expect((await obtenerInforme(sql, inf)).estado).toBe('en_cola');
    const eventos: EventoProgreso[] = [];
    await procesarInforme(p, inf, {}, (e) => void eventos.push(e));
    const informe = await obtenerInforme(sql, inf);
    expect(informe.error).toBeUndefined();
    expect(informe.estado).toBe('listo');
    expect(informe.documentos).toBe(2);
    expect(informe.resumen).toMatch(/\(Arendt 1958, p\. 1[12]\)/);
    expect(eventos.at(-1)!.fase).toBe('fin');
    const pagina = await listarTramos(sql, inf, { limite: 50 });
    const formas = pagina.elementos.map((t) => t.texto.toLowerCase());
    expect(formas).toEqual(expect.arrayContaining(['libertad', 'libres', 'liberty', 'freedom']));
    expect(pagina.elementos.every((t) => !t.frase?.includes('cocina'))).toBe(true);
    expect(pagina.elementos[0]!.uso).toBe('definicion');
    expect(pagina.elementos[0]!.citaCorta).toMatch(/1958, p\. 1\d/);
    const ag = await agregadosInforme(sql, inf);
    expect(ag.porDocumento).toHaveLength(2);
    expect(ag.porIdioma).toMatchObject({ es: expect.any(Number), en: expect.any(Number) });
    const t = await etiquetarTramo(sql, pagina.elementos[0]!.id, 'correcto');
    expect(t.etiquetaUsuario).toBe('correcto');
    await expect(etiquetarTramo(sql, t.id, 'quizá')).rejects.toMatchObject({ codigo: 'peticion_invalida' });
    // Léxicos guardados: una segunda ejecución no vuelve a pedirlos.
    const llamadas = redactor.llamadas;
    await procesarInforme(p, await crearInforme(sql, c.id), { resumen: false });
    expect(redactor.llamadas).toBe(llamadas);
    expect(await listarInformes(sql, c.id)).toHaveLength(2);

    const csv = strFromU8((await exportarInforme(sql, inf, 'csv')).cuerpo);
    expect(csv.split('\r\n')[0]).toContain('Título');
    const xl = unzipSync((await exportarInforme(sql, inf, 'xlsx')).cuerpo);
    expect(strFromU8(xl['xl/worksheets/sheet1.xml']!)).toContain('Two Concepts of Liberty');
    expect(strFromU8((await exportarInforme(sql, inf, 'tei')).cuerpo)).toContain('<TEI');
    expect(strFromU8((await exportarInforme(sql, inf, 'bibtex')).cuerpo)).toContain('@book{arendt1958');
    expect(strFromU8((await exportarInforme(sql, inf, 'html')).cuerpo)).toContain('<mark>');
    await expect(exportarInforme(sql, inf, 'pdf')).rejects.toMatchObject({ codigo: 'peticion_invalida' });
  });

  it('marca el informe con error si no hay documentos', async () => {
    const sql = await estanteria();
    const c = await crearConcepto(sql, { nombre: 'Nada' });
    const inf = await crearInforme(sql, c.id);
    await procesarInforme(puertos(sql), inf);
    const i = await obtenerInforme(sql, inf);
    expect(i.estado).toBe('error');
    expect(i.error).toBe('No hay documentos que analizar con esos filtros.');
  });
});
