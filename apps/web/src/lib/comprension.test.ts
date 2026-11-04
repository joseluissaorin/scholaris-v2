import { describe, expect, it } from 'vitest';
import type { Ficha, Segmento } from '@scholaris/nucleo';
import type { AparicionVista } from '@scholaris/contrato';
import {
  agruparApariciones, arbolDeSegmentos, avanceComprension, construirPelicula, contextoDeCaracteres, cuentaCorrespondencias, cuentaLegible, enCuadro, enInstante,
  etiquetaAncla, geometriaRecorte, indiceEnTramos, ladosPara, partirPorCaracteres, rasgosPlano, regionConHolgura, resumenRoles, temasDeFicha, tramoDe, verboRelacion,
} from './comprension';

const seg = (id: string, tipo: Segmento['tipo'], orden: number, padre: string | null, t0?: number, t1?: number): Segmento => ({
  id, documento: 'd', padre, nivel: padre ? 2 : 1, orden, tipo, titulo: id, unidadDesde: 'u1', unidadHasta: 'u1', origen: 'modelo', confianza: 1,
  ancla: t0 != null ? { tipo: 'tiempo', t0, t1: t1 ?? t0 } : { tipo: 'pagina', fisica: orden + 1, impresa: String(orden + 1), romana: false, origen: 'leido', confianza: 1 },
});
const ap = (id: string, entidad: string, nombre: string, tipo: string, rol: AparicionVista['rol'], ancla: AparicionVista['ancla']): AparicionVista => ({ id, entidad, documento: 'd', nombre, tipo, rol, ancla, forma: nombre, confianza: 1 });

describe('anclas', () => {
  it('el tramo de un medio, con su ancla de cierre', () => {
    expect(tramoDe({ ancla: { tipo: 'tiempo', t0: 10, t1: 20 } })).toEqual([10, 20]);
    expect(tramoDe({ ancla: { tipo: 'tiempo', t0: 10, t1: 20 }, anclaFin: { tipo: 'tiempo', t0: 50, t1: 64 } })).toEqual([10, 64]);
    expect(tramoDe({ ancla: { tipo: 'pagina', fisica: 3, impresa: '3', romana: false, origen: 'leido', confianza: 1 } })).toBeNull();
  });

  it('la etiqueta: página, tramo y, con región, el fotograma', () => {
    expect(etiquetaAncla({ tipo: 'pagina', fisica: 14, impresa: '14', romana: false, origen: 'leido', confianza: 1 })).toBe('p. 14');
    expect(etiquetaAncla({ tipo: 'tiempo', t0: 3723, t1: 3790 })).toBe('1:02:03-1:03:10');
    expect(etiquetaAncla({ tipo: 'tiempo', t0: 3723, t1: 3790, instante: 3730, region: { x: 0, y: 0, w: 0.5, h: 0.5 } })).toBe('1:02:10');
  });

  it('busca el tramo de un instante y respeta los huecos', () => {
    const t = [[0, 10], [10, 25], [40, 60]] as const;
    expect(indiceEnTramos(t, 0)).toBe(0);
    expect(indiceEnTramos(t, 24.9)).toBe(1);
    expect(indiceEnTramos(t, 30)).toBe(-1);
    expect(indiceEnTramos(t, 59)).toBe(2);
    expect(indiceEnTramos(t, 60)).toBe(-1);
    expect(indiceEnTramos([], 5)).toBe(-1);
  });

  it('parte un texto por puntos de código (no por unidades UTF-16)', () => {
    expect(partirPorCaracteres('«Té» con canela', [1, 3])).toEqual(['«', 'Té', '» con canela']);
    expect(partirPorCaracteres('a𝄞b', [1, 2])).toEqual(['a', '𝄞', 'b']);
    expect(partirPorCaracteres('corto', [3, 99])).toEqual(['cor', 'to', '']);
    const [pre, dentro, post] = contextoDeCaracteres(`${'palabra '.repeat(30)}AQUÍ${' otra'.repeat(30)}`, [240, 244], 20);
    expect(dentro).toBe('AQUÍ');
    expect(pre.startsWith('…')).toBe(true);
    expect(post.endsWith('…')).toBe(true);
  });
});

describe('recortes', () => {
  it('la región con aire no se sale de la imagen', () => {
    const r = regionConHolgura({ x: 0.01, y: 0.9, w: 0.2, h: 0.08 });
    expect(r.x).toBe(0);
    expect(r.y + r.h).toBeLessThanOrEqual(1);
    expect(r.w).toBeGreaterThan(0.2);
  });

  it('la geometría del recorte: proporción, posición de la imagen y dónde cae la región', () => {
    const g = geometriaRecorte({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 }, 16 / 9, 0);
    expect(g.aspecto).toBeCloseTo(16 / 9);
    expect(g.imagen).toEqual({ width: '400%', height: '400%', left: '-200%', top: '-200%' });
    expect(g.marca).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const h = geometriaRecorte({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 1, 0.5);
    expect(h.marca.x).toBeCloseTo(0.25);
    expect(h.marca.w).toBeCloseTo(0.5);
  });
});

describe('estructura', () => {
  it('arma el árbol por padre y orden, aunque lleguen desordenados', () => {
    const a = arbolDeSegmentos([seg('e2', 'escena', 3, 'p1'), seg('p1', 'parte', 0, null), seg('e1', 'escena', 1, 'p1'), seg('p2', 'parte', 4, null), seg('h', 'escena', 5, 'falta')]);
    expect(a.map((n) => n.s.id)).toEqual(['p1', 'p2', 'h']);
    expect(a[0]!.hijos.map((n) => n.s.id)).toEqual(['e1', 'e2']);
    expect(a[0]!.hijos[0]!.profundidad).toBe(1);
  });

  it('cuenta en castellano', () => {
    expect(cuentaLegible('capitulo', 1)).toBe('1 capítulo');
    expect(cuentaLegible('intervencion', 3)).toBe('3 intervenciones');
  });

  it('el avance por los pasos terminados o por el aviso en vivo', () => {
    expect(avanceComprension(null)).toEqual({ valor: 0, texto: 'En cola' });
    expect(avanceComprension({ estado: 'en_marcha', pasos: {} }).texto).toBe('Leyendo la estructura de la obra');
    const medio = avanceComprension({ estado: 'en_marcha', pasos: { estructura: { hecho: '', ms: 1, usd: 0, detalle: { lotes: 4 } }, 'fichas:0': { hecho: '', ms: 1, usd: 0 }, 'fichas:1': { hecho: '', ms: 1, usd: 0 } } });
    expect(medio.valor).toBeCloseTo(0.4);
    expect(medio.texto).toBe('Escribiendo las fichas: 2 de 4 tandas');
    expect(avanceComprension({ estado: 'en_marcha', pasos: {} }, { paso: 'global', avance: 0.75, mensaje: 'Escribiendo la ficha global de la obra' })).toEqual({ valor: 0.75, texto: 'Escribiendo la ficha global de la obra' });
    expect(avanceComprension({ estado: 'hecho', pasos: {} }).valor).toBe(1);
  });
});

describe('entidades', () => {
  const aps = [
    ap('1', 'e-ernesto', 'Ernesto', 'persona', 'visible', { tipo: 'tiempo', t0: 10, t1: 20, instante: 15, region: { x: 0, y: 0, w: 1, h: 1 } }),
    ap('2', 'e-ernesto', 'Ernesto', 'persona', 'habla', { tipo: 'tiempo', t0: 5, t1: 9 }),
    ap('3', 'e-reloj', 'El reloj de arena', 'concepto', 'nombrado', { tipo: 'tiempo', t0: 30, t1: 40 }),
    ap('4', 'e-ernesto', 'Ernesto', 'persona', 'visible', { tipo: 'tiempo', t0: 40, t1: 50 }),
  ];
  it('agrupa por entidad, en el orden del material y por número de apariciones', () => {
    const g = agruparApariciones(aps, new Set(['e-reloj']));
    expect(g.map((e) => e.id)).toEqual(['e-ernesto', 'e-reloj']);
    expect(g[0]!.apariciones.map((a) => a.id)).toEqual(['2', '1', '4']);
    expect(g[0]!.categoria).toBe('personas');
    expect(g[1]!.categoria).toBe('motivos');
    expect(resumenRoles(g[0]!)).toBe('3 apariciones: 2 en cuadro, 1 habla');
    expect(resumenRoles(g[1]!)).toBe('1 aparición');
  });

  it('los temas de la ficha global con sus apariciones (por entidad o por nombre)', () => {
    const f = { datos: { motivos: [{ nombre: 'El reloj de arena', descripcion: 'mide', entidad: 'e-reloj' }, { nombre: 'Ernesto', descripcion: 'x' }] } } as unknown as Ficha;
    const t = temasDeFicha(f, 'motivos', aps);
    expect(t[0]!.apariciones.map((a) => a.id)).toEqual(['3']);
    expect(t[1]!.entidad).toBe('e-ernesto');
    expect(temasDeFicha(undefined, 'temas', aps)).toEqual([]);
  });
});

describe('la película', () => {
  const segmentos = [
    seg('sq1', 'secuencia', 0, null, 0, 100), seg('es1', 'escena', 1, 'sq1', 0, 60), seg('es2', 'escena', 4, 'sq1', 60, 100),
    seg('pl1', 'plano', 2, 'es1', 0, 30), seg('pl2', 'plano', 3, 'es1', 30, 60),
  ];
  const fichaPlano = {
    objetivoId: 'pl2', texto: 'Plano medio.', evidencias: [{ documento: 'd', modo: 'video', cita: 'Ernesto: remueve el té', ancla: { tipo: 'tiempo', t0: 30, t1: 60, instante: 45, region: { x: 0.5, y: 0.1, w: 0.4, h: 0.8 } } }],
    datos: { escala: 'plano medio', angulacion: 'contrapicado', movimiento: 'travelling', personas: ['Ernesto', 'Tomás'], objetos: [] },
  } as unknown as Ficha;
  const p = construirPelicula(segmentos, [fichaPlano], [ap('b', 'e-bolero', 'Bolero del muelle', 'obra', 'audible', { tipo: 'tiempo', t0: 0, t1: 30 })], 120);

  it('separa secuencias, escenas, planos y sonido, cada uno con su tramo', () => {
    expect(p.secuencias.map((x) => x.id)).toEqual(['sq1']);
    expect(p.escenas.map((x) => [x.id, x.secuencia])).toEqual([['es1', 'sq1'], ['es2', 'sq1']]);
    expect(p.planos.map((x) => [x.id, x.escena])).toEqual([['pl1', 'es1'], ['pl2', 'es1']]);
    expect(p.sonido).toEqual([{ id: 'b', t0: 0, t1: 30, nombre: 'Bolero del muelle', tipo: 'obra' }]);
    expect(p.duracion).toBe(120);
  });

  it('qué hay en cada instante', () => {
    expect(enInstante(p, 45)).toEqual({ secuencia: 0, escena: 0, plano: 1 });
    expect(enInstante(p, 80)).toEqual({ secuencia: 0, escena: 1, plano: -1 });
  });

  it('quién está en cuadro y dónde, desde las pruebas de la ficha del plano', () => {
    const pl = p.planos[1]!;
    expect(pl.personas).toEqual([{ nombre: 'Ernesto', region: { x: 0.5, y: 0.1, w: 0.4, h: 0.8 }, instante: 45, nota: 'remueve el té' }, { nombre: 'Tomás' }]);
    expect(enCuadro(pl).map((x) => x.nombre)).toEqual(['Ernesto']);
    expect(rasgosPlano(pl)).toBe('Plano medio, contrapicado, travelling');
    expect(rasgosPlano({ escala: 'primer plano', angulacion: 'normal', movimiento: 'fija' })).toBe('Primer plano, cámara fija');
  });
});

describe('alineaciones y relaciones', () => {
  it('cuenta por tipo en el orden de la leyenda', () => {
    expect(cuentaCorrespondencias([{ tipo: 'transformado' }, { tipo: 'equivalente' }, { tipo: 'transformado' }, { tipo: 'anadido' }])).toEqual([['equivalente', 1], ['transformado', 2], ['anadido', 1]]);
  });

  it('el lado de cada documento', () => {
    const al = { id: 'a', relacion: 'r', orden: 0, tipo: 'equivalente' as const, nota: '', confianza: 1, a: { documento: 'peli', ancla: { tipo: 'tiempo' as const, t0: 0, t1: 1 } }, b: { documento: 'cuento', ancla: { tipo: 'tiempo' as const, t0: 0, t1: 1 } } };
    expect(ladosPara(al, 'cuento').este?.documento).toBe('cuento');
    expect(ladosPara(al, 'peli').otro?.documento).toBe('cuento');
    expect(ladosPara({ ...al, a: undefined }, 'peli')).toEqual({ otro: al.b });
  });

  it('el verbo desde cada lado', () => {
    expect(verboRelacion('adaptacion_de', 'origen')).toBe('adapta');
    expect(verboRelacion('adaptacion_de', 'destino')).toBe('está adaptada en');
  });
});

describe('dónde se está', () => {
  it('el segmento más hondo que contiene una página o un segundo', async () => {
    const { segmentoEn } = await import('./comprension');
    const pag = (fisica: number) => ({ tipo: 'pagina' as const, fisica, impresa: String(fisica), romana: false, origen: 'leido' as const, confianza: 1 });
    const segs = [
      { ...seg('p1', 'parte', 0, null), ancla: pag(1), anclaFin: pag(6) }, { ...seg('e1', 'escena', 1, 'p1'), ancla: pag(1), anclaFin: pag(3) }, { ...seg('e2', 'escena', 2, 'p1'), ancla: pag(4) },
    ];
    expect(segmentoEn(segs, { u: 2 })?.id).toBe('e1');
    expect(segmentoEn(segs, { u: 4 })?.id).toBe('e2');
    expect(segmentoEn(segs, { u: 5 })?.id).toBe('p1');
    expect(segmentoEn(segs, { u: 9 })).toBeUndefined();
    expect(segmentoEn([seg('a', 'escena', 0, null, 0, 10), seg('b', 'plano', 1, 'a', 0, 5)], { t: 3 })?.id).toBe('a');
  });
});
