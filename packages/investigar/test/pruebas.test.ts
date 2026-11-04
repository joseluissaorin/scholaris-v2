import { describe, expect, it } from 'vitest';
import type { Ancla } from '@scholaris/nucleo';
import { compactar, listaPruebas, traducciones } from '../src/agente.js';
import { segundosDe, tramoDe, type ContextoHerramientas } from '../src/contexto.js';
import type { MensajeAgente } from '../src/modelo.js';
import { presupuestoDe } from '../src/puertos.js';
import { CuadernoPruebas, estrechar, hablanteEn, puntosDeCodigo, type Prueba } from '../src/pruebas.js';
import { afinar, citaPrevia, Numerador } from '../src/sintesis.js';
import { confianzaDe, frasesDe, marcarSinPrueba, oracionesDe } from '../src/verificacion.js';
import { instantesDe, regionDeCaja } from '../src/vision.js';

const pagina = (fisica: number, impresa: string): Ancla => ({ tipo: 'pagina', fisica, impresa, romana: false, origen: 'leido', confianza: 1 });

function prueba(texto: string, ancla: Ancla, extra: Partial<Prueba> = {}): Prueba {
  return {
    id: 'P1', capa: 'literal', herramienta: 'leer',
    evidencia: { documento: 'd', ancla, cita: texto.slice(0, 50), modo: ancla.tipo === 'tiempo' ? 'audio' : 'texto', unidad: 'u' },
    ambito: { unidad: 'u', orden: 0, texto, ancla }, ...extra,
  };
}

describe('estrechar una prueba a su cita', () => {
  it('en una página: caracteres en puntos de código (con tildes y signos fuera del plano básico)', () => {
    const texto = '𝔄 Vino hasta mi mesa. Le eché una ojeada: habiendo chocolate, había pedido fresa. Así lo conocí.';
    const e = estrechar(prueba(texto, pagina(2, '4')), '«habiendo chocolate, había pedido fresa»');
    expect(e).not.toBeNull();
    const [a, b] = e!.ancla.caracteres!;
    expect(Array.from(texto).slice(a, b).join('')).toBe('habiendo chocolate, había pedido fresa.');
    expect(e!.ancla).toMatchObject({ tipo: 'pagina', fisica: 2 });
    expect(puntosDeCodigo('𝔄b', 2)).toBe(1);
  });

  it('en un medio: los segundos de esas palabras y su hablante', () => {
    const texto = '**Vivian:** Apaga la luz. **Diego:** Me encanta la fresa. Es lo único bueno.';
    const palabras = { v: 1, t0: 100, cs: Array.from({ length: 12 }, (_, i) => [i * 100, 100]).flat() };
    const p = prueba(texto, { tipo: 'tiempo', t0: 100, t1: 112, hablante: 'Vivian' });
    p.ambito!.palabras = palabras;
    const e = estrechar(p, 'Me encanta la fresa');
    expect(e!.ancla).toMatchObject({ tipo: 'tiempo', t0: 103, t1: 107, hablante: 'Diego' });
    expect(e!.cita).toBe('Me encanta la fresa.');
    expect(hablanteEn(texto, texto.indexOf('Apaga'))).toBe('Vivian');
  });

  it('sin ámbito, solo si la cita está en la prueba; si no está, null', () => {
    const p: Prueba = { id: 'P2', capa: 'percepcion', herramienta: 'ver', evidencia: { documento: 'd', ancla: { tipo: 'tiempo', t0: 1, t1: 2, instante: 1 }, cita: 'Plano medio de Diego con la copa.', modo: 'video' } };
    expect(estrechar(p, 'Diego con la copa')).not.toBeNull();
    expect(estrechar(p, 'nada que ver')).toBeNull();
    expect(estrechar(prueba('Texto de la página.', pagina(1, '1')), 'otra cosa distinta')).toBeNull();
  });
});

describe('cuaderno de pruebas', () => {
  it('marca P1, P2… y no repite la misma prueba', () => {
    const c = new CuadernoPruebas();
    const e = { documento: 'd', ancla: pagina(1, '1'), cita: 'Hola', modo: 'texto' as const, fragmento: 'f' };
    const a = c.registrar({ evidencia: e, capa: 'literal', herramienta: 'buscar' });
    const b = c.registrar({ evidencia: { ...e }, capa: 'literal', herramienta: 'leer', nota: 'otra vez' });
    const d = c.registrar({ evidencia: { ...e, ancla: pagina(2, '2') }, capa: 'literal', herramienta: 'leer' });
    expect([a.prueba.id, b.prueba.id, d.prueba.id]).toEqual(['P1', 'P1', 'P2']);
    expect(b.nueva).toBe(false);
    expect(c.obtener('p1')?.nota).toBe('otra vez');
  });
});

function contexto(): ContextoHerramientas {
  const pruebas = new CuadernoPruebas();
  const texto = 'Vino hasta mi mesa. Habiendo chocolate, había pedido fresa. Así lo conocí en Coppelia.';
  pruebas.registrar({ evidencia: { documento: 'd', ancla: pagina(2, '4'), cita: texto, modo: 'texto', fragmento: 'f1', unidad: 'u' }, capa: 'literal', herramienta: 'buscar', ambito: { unidad: 'u', orden: 1, texto, ancla: pagina(2, '4') } });
  pruebas.registrar({ evidencia: { documento: 'd', ancla: pagina(2, '4'), cita: texto, modo: 'texto', unidad: 'u' }, capa: 'literal', herramienta: 'leer', ambito: { unidad: 'u', orden: 1, texto, ancla: pagina(2, '4') } });
  return {
    pruebas, docs: new Map([['d', { id: 'd', tipo: 'libro', metadatos: { titulo: 'El lobo', autores: [{ nombre: 'Senel', apellidos: 'Paz' }], anio: 1994, anioOriginal: 1991, idioma: 'es' } }]]),
    fichas: new Map(), ambito: null, filtros: {}, notas: [], avisos: [], idioma: 'es', segundosVer: 300, resultadosPorBusqueda: 6, alPrueba: () => undefined,
  } as unknown as ContextoHerramientas;
}

describe('numerar las citas', () => {
  it('E1, E2… por orden de aparición; la misma cita por dos pruebas es una sola evidencia; las inventadas se quitan', () => {
    const ctx = contexto();
    const n = new Numerador(ctx);
    const md = n.sustituir('Primero «había pedido fresa» [P1]. Lo mismo «había pedido fresa» [P2]. Y la página entera [P2]. Inventada [P9].');
    expect(md).toBe('Primero «había pedido fresa» [E1]. Lo mismo «había pedido fresa» [E1]. Y la página entera [E2]. Inventada .');
    expect(n.descartadas).toEqual(['P9']);
    const e1 = n.evidencia('E1')!;
    expect(e1.cita).toBe('había pedido fresa.');
    expect(e1.ancla.caracteres).toBeDefined();
    expect(e1).toMatchObject({ id: 'E1', prueba: 'P1', titulo: 'El lobo', etiqueta: 'p. 4', citaCorta: '(Paz, 1991/1994, p. 4)' });
    expect(n.evidencia('E2')!.ancla.caracteres).toBeUndefined();
  });

  it('las marcas con localizador dentro valen igual y el localizador se quita', () => {
    const n = new Numerador(contexto());
    expect(n.sustituir('Uno [P1, p. 4]. Dos [P2: pág. 4; P1]. Tres [P1 p. 3]. Nada [Pxx].')).toBe('Uno [E1]. Dos [E1]. Tres [E1]. Nada [Pxx].');
  });

  it('una cita que no está en la prueba queda anotada', () => {
    const n = new Numerador(contexto());
    n.sustituir('Dice «algo que no está» [P1].');
    expect(n.literalesNoEncontrados).toEqual([{ cita: 'algo que no está', prueba: 'P1' }]);
  });

  it('una página citada sin cita literal se estrecha a las oraciones que sostienen la frase', () => {
    const ctx = contexto();
    const relleno = 'Era una tarde cualquiera en la ciudad y nadie esperaba nada. '.repeat(6);
    const texto = `${relleno}Diego le pidió a David que no dejara de ser revolucionario. ${relleno}`;
    ctx.pruebas.registrar({ evidencia: { documento: 'd', ancla: pagina(9, '17'), cita: texto.slice(0, 80), modo: 'texto', unidad: 'u9' }, capa: 'literal', herramienta: 'leer', ambito: { unidad: 'u9', orden: 8, texto, ancla: pagina(9, '17') } });
    const n = new Numerador(ctx);
    const md = n.sustituir('Diego le pide a David que siga siendo revolucionario [P3].');
    expect(afinar(n, ctx, md)).toBe(1);
    const e = n.evidencia('E1')!;
    expect(e.cita).toBe('Diego le pidió a David que no dejara de ser revolucionario.');
    expect(Array.from(texto).slice(...e.ancla.caracteres!).join('')).toBe(e.cita);
  });

  it('citaPrevia reconoce la cita justo antes de la marca', () => {
    expect(citaPrevia('dijo «hola, amigo» ')).toBe('hola, amigo');
    expect(citaPrevia('dijo «hola» y más cosas ')).toBeNull();
  });
});

describe('frases y verificación', () => {
  it('no parte las oraciones dentro de una cita', () => {
    expect(oracionesDe('Diego confiesa: «Yo andaba con Germán. Y apostamos.» [E8] Después se abrazan [E9]. Fin del análisis.')).toEqual([
      'Diego confiesa: «Yo andaba con Germán. Y apostamos.» [E8]', 'Después se abrazan [E9].', 'Fin del análisis.',
    ]);
  });

  it('saca las frases sin encabezados ni la lista de pruebas, con sus marcas y las filas de tabla', () => {
    const md = '### Apartado\n\nUna frase con su cita bien larga [E1]. Otra frase sin ninguna cita en absoluto.\n\n| A | B |\n|---|---|\n| celda con una cita bastante larga | sí [E2] |\n\n## Pruebas\n\n- [E1] algo';
    const fs = frasesDe(md);
    expect(fs.map((f) => f.evidencias)).toEqual([['E1'], [], ['E2']]);
    expect(fs[2]!.tabla).toBe(true);
    const marcado = marcarSinPrueba(md, [{ ...fs[1]!, veredicto: 'sin_prueba' }, { ...fs[2]!, veredicto: 'sin_prueba' }]);
    expect(marcado).toContain('en absoluto. [sin prueba]');
    expect(marcado).toContain('| sí [E2] |');
  });

  it('confianza según lo respaldado', () => {
    const f = (veredicto: 'respaldada' | 'parcial' | 'sin_respaldo' | 'sin_prueba', ev = ['E1']) => ({ frase: 'x', evidencias: ev, veredicto });
    expect(confianzaDe([f('respaldada'), f('respaldada'), f('respaldada')])).toBe('alta');
    expect(confianzaDe([f('respaldada'), f('respaldada'), f('parcial')])).toBe('media');
    expect(confianzaDe([f('sin_respaldo'), f('parcial')])).toBe('baja');
    expect(confianzaDe([f('sin_prueba', [])])).toBe('baja');
  });

  it('traducciones detrás de las marcas y lista de pruebas', () => {
    const t = traducciones('«Me encanta la fresa» [E3] («I love strawberry»). Otra [E4] (trad.: «hello»).');
    expect(t.get('E3')).toBe('I love strawberry');
    expect(t.get('E4')).toBe('hello');
    const l = listaPruebas([{ id: 'E1', documento: 'd', titulo: 'T', ancla: pagina(2, '4'), modo: 'texto', capa: 'literal', herramienta: 'leer', etiqueta: 'p. 4', citaCorta: '(Paz, 1994, p. 4)', cita: 'hola', traduccion: 'hello' }], 'en');
    expect(l).toBe('\n\n## Evidence\n\n- [E1] Paz, 1994, p. 4, *T*: «hola» («hello»)');
  });
});

describe('visión', () => {
  it('caja 0-1000 → región en fracciones; cajas imposibles, nada', () => {
    expect(regionDeCaja([100, 200, 600, 700])).toEqual({ x: 0.2, y: 0.1, w: 0.5, h: 0.5 });
    expect(regionDeCaja([1, 2, 3])).toBeUndefined();
    expect(regionDeCaja([500, 500, 500, 500])).toBeUndefined();
  });

  it('instantes absolutos; si el modelo contó desde el tramo, se desplazan; lo de fuera se descarta', () => {
    const abs = instantesDe([{ desde: '10:00', hasta: '10:04' }, { desde: '3:00:00' }], 590, 650);
    expect(abs.map((x) => [x.a, x.b])).toEqual([[600, 604]]);
    const rel = instantesDe([{ desde: '0:10' }, { desde: '0:40', hasta: '0:50' }], 590, 650);
    expect(rel.map((x) => [x.a, x.b])).toEqual([[600, 600], [630, 640]]);
  });
});

describe('argumentos y presupuesto', () => {
  it('segundos y tramos en cualquier forma', () => {
    expect(segundosDe('1:02:03')).toBe(3723);
    expect(segundosDe('9:50')).toBe(590);
    expect(segundosDe(12.5)).toBe(12.5);
    expect(tramoDe({ desde: '10:00', hasta: '9:00' }, segundosDe)).toEqual([540, 600]);
    expect(tramoDe([3, 5])).toEqual([3, 5]);
    expect(tramoDe('nada')).toBeUndefined();
  });

  it('la petición solo baja el presupuesto, y el plan lo recorta', () => {
    expect(presupuestoDe({}).pasos).toBe(16);
    expect(presupuestoDe({ profundidad: 'exhaustiva', presupuesto: { pasos: 100 } }).pasos).toBe(32);
    expect(presupuestoDe({ profundidad: 'exhaustiva', tope: { pasos: 10, usd: 0.3 } })).toMatchObject({ pasos: 10, usd: 0.3 });
    expect(presupuestoDe({ presupuesto: { segundos: 30 } }).segundos).toBe(30);
  });

  it('compactar resume las respuestas viejas de las herramientas', () => {
    const grande = 'x'.repeat(50_000);
    const mensajes: MensajeAgente[] = [];
    for (let i = 0; i < 6; i++) {
      mensajes.push({ rol: 'modelo', partes: [{ tipo: 'llamada', nombre: 'leer', args: {} }], crudo: { firma: i } });
      mensajes.push({ rol: 'usuario', partes: [{ tipo: 'respuesta', nombre: 'leer', contenido: { resultado: grande, resumen: `r${i}`, pruebas: [`P${i}`] } }] });
    }
    compactar(mensajes, 160_000, 2);
    const tam = JSON.stringify(mensajes).length;
    expect(tam).toBeLessThan(170_000);
    const primera = mensajes[1]!.partes[0] as unknown as { contenido: { resultado: string } };
    expect(primera.contenido.resultado).toContain('r0');
    expect((mensajes[11]!.partes[0] as unknown as { contenido: { resultado: string } }).contenido.resultado).toBe(grande);
    expect(mensajes[0]!.crudo).toEqual({ firma: 0 });
  });
});
