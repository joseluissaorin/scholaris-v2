import { describe, expect, it } from 'vitest';
import { anclarPasaje, elegirPasaje, enmascarar, oraciones, ubicarPasaje, type Tramo } from '../src/index.js';

/** Las oraciones de un texto, como cadenas. */
const frases = (t: string) => oraciones(t).map((o) => t.slice(o.desde, o.hasta));

/** Coincidencias de unas palabras (sin tildes ni mayúsculas), como las da la búsqueda. */
function tramos(texto: string, palabras: string[]): Tramo[] {
  const plano = [...texto].map((c) => (c.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()[0] ?? c)).join('');
  const salida: Tramo[] = [];
  for (const p of palabras) {
    const re = new RegExp(`(?<![\\p{L}])${p}[\\p{L}]{0,3}(?![\\p{L}])`, 'gu');
    for (const m of plano.matchAll(re)) salida.push({ desde: m.index, hasta: m.index + m[0].length, termino: p });
  }
  return salida;
}

// Balzac, «Le Chef-d'œuvre inconnu» (1831-1837), dominio público. El fragmento entero,
// como lo guarda la estantería: varios párrafos, y el pie en el del medio.
const BALZAC = [
  '— Le vieux lansquenet se joue de nous, dit Poussin en revenant devant le prétendu tableau. Je ne vois là que des couleurs confusément amassées et contenues par une multitude de lignes bizarres qui forment une muraille de peinture.',
  '— Nous nous trompons, voyez ?... reprit Porbus.',
  'En s\'approchant, ils aperçurent dans un coin de la toile le bout d\'un pied nu qui sortait de ce chaos de couleurs, de tons, de nuances indécises, espèce de brume sans forme ; mais un pied délicieux, un pied vivant ! Ils restèrent pétrifiés d\'admiration devant ce fragment échappé à une incroyable, à une lente et progressive destruction. Ce pied apparaissait là comme le torse de quelque Vénus en marbre de Paros qui surgirait parmi les décombres d\'une ville incendiée.',
  '— Il y a une femme là-dessous, s\'écria Porbus en faisant remarquer à Poussin les couches de couleurs que le vieux peintre avait successivement superposées en croyant perfectionner sa peinture.',
].join('\n\n');

describe('oraciones', () => {
  it('parte por puntos, exclamaciones e interrogaciones, también con espacio delante (francés)', () => {
    const fs = frases(BALZAC);
    expect(fs).toContain('En s\'approchant, ils aperçurent dans un coin de la toile le bout d\'un pied nu qui sortait de ce chaos de couleurs, de tons, de nuances indécises, espèce de brume sans forme ; mais un pied délicieux, un pied vivant !');
    expect(fs).toContain('Ils restèrent pétrifiés d\'admiration devant ce fragment échappé à une incroyable, à une lente et progressive destruction.');
  });

  it('¿? y ¡! en español: una pregunta seguida de minúscula sigue la oración', () => {
    expect(frases('¿Qué gigantes? dijo Sancho Panza. ¡Aquellos que allí ves! Son molinos.')).toEqual([
      '¿Qué gigantes? dijo Sancho Panza.', '¡Aquellos que allí ves!', 'Son molinos.',
    ]);
    expect(frases('Era tarde; ¡pero un pie delicioso, un pie vivo! Permanecieron petrificados.')).toEqual([
      'Era tarde; ¡pero un pie delicioso, un pie vivo!', 'Permanecieron petrificados.',
    ]);
  });

  it('rayas de diálogo: el inciso del narrador no corta, la réplica sí', () => {
    expect(frases('—¿Vienes? —preguntó ella—. Te espero abajo. —Sí, ahora bajo.')).toEqual([
      '—¿Vienes? —preguntó ella—.', 'Te espero abajo.', '—Sí, ahora bajo.',
    ]);
  });

  it('abreviaturas e iniciales no cierran oración; «etc.» ante mayúscula sí', () => {
    expect(frases('El Sr. García lo dice en la p. 23 y en las pp. 40-41, cf. el cap. 3 de J. L. Borges. Después calló.')).toEqual([
      'El Sr. García lo dice en la p. 23 y en las pp. 40-41, cf. el cap. 3 de J. L. Borges.', 'Después calló.',
    ]);
    expect(frases('Traía libros, cartas, etc. Luego se fue. Nació en el 30 a. C. y murió joven.')).toEqual([
      'Traía libros, cartas, etc.', 'Luego se fue.', 'Nació en el 30 a. C. y murió joven.',
    ]);
  });

  it('puntos suspensivos: cierran ante mayúscula, no ante minúscula', () => {
    expect(frases('Esperaba... Y no vino nadie. Quería decir… pero no supo qué.')).toEqual([
      'Esperaba...', 'Y no vino nadie.', 'Quería decir… pero no supo qué.',
    ]);
  });

  it('texto antiguo (Quijote, 1605): grafías viejas y comas largas', () => {
    const t = 'En vn lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que viuia vn hidalgo de los de lança en aſtillero, adarga antigua, rozin flaco, y galgo corredor. Vna olla de algo mas vaca que carnero, ſalpicon las mas noches, duelos y quebrantos los Sabados, lantejas los Viernes, algun palomino de añadidura los Domingos, conſumian las tres partes de ſu hazienda.';
    expect(frases(t)).toHaveLength(2);
    const p = elegirPasaje(t, tramos(t, ['palomino']));
    expect(p.texto.startsWith('Vna olla')).toBe(true);
    expect(p.texto.endsWith('hazienda.')).toBe(true);
  });

  it('transcripciones: cada turno es un bloque y las marcas no llegan al texto', () => {
    const t = '**Entrevistador:** ¿Cómo empezó todo? **Serrat:** Empezó en el barrio del Poble-sec. Yo tenía quince años y una guitarra prestada.';
    const fs = oraciones(t).map((o) => t.slice(o.desde, o.hasta));
    expect(fs).toEqual(['¿Cómo empezó todo?', 'Empezó en el barrio del Poble-sec.', 'Yo tenía quince años y una guitarra prestada.']);
    const p = elegirPasaje(t, tramos(t, ['guitarra']));
    expect(p.texto).toBe('Yo tenía quince años y una guitarra prestada.');
    // Corta, se acompaña de su vecina del mismo turno.
    expect(elegirPasaje(t, tramos(t, ['guitarra']), { minPalabras: 12 }).texto).toBe('Empezó en el barrio del Poble-sec. Yo tenía quince años y una guitarra prestada.');
    expect(p.texto).not.toContain('*');
    // Nunca cruza a otro turno, aunque la oración sea corta.
    expect(elegirPasaje(t, tramos(t, ['empezo'])).texto).not.toContain('Entrevistador');
  });

  it('la máscara conserva las posiciones', () => {
    const t = '![](page=0,bbox=[1, 2, 3, 4])\n\n## Título\n\n**Ana:** Hola.';
    const m = enmascarar(t).texto;
    expect(m).toHaveLength(t.length);
    expect(m).not.toMatch(/[*#!]/);
  });
});

describe('elegirPasaje', () => {
  it('Balzac: la oración del pie, entera, y no el fragmento', () => {
    const p = elegirPasaje(BALZAC, tramos(BALZAC, ['pied', 'sortait']));
    expect(p.texto).toBe('En s\'approchant, ils aperçurent dans un coin de la toile le bout d\'un pied nu qui sortait de ce chaos de couleurs, de tons, de nuances indécises, espèce de brume sans forme ; mais un pied délicieux, un pied vivant !');
    expect(BALZAC.slice(p.desde, p.hasta)).toBe(p.texto);
    expect(p.texto.split(/\s+/).length).toBeLessThan(80);
  });

  it('sin coincidencias (solo por sentido): la primera oración entera de la ventana', () => {
    const p = elegirPasaje(BALZAC, [], { foco: [BALZAC.indexOf('En s\'approchant') - 20, BALZAC.indexOf('En s\'approchant') + 260] });
    expect(p.texto.startsWith('En s\'approchant')).toBe(true);
    expect(p.texto.endsWith('!')).toBe(true);
  });

  it('una oración corta se acompaña de la vecina, sin pasar de tres ni del tope', () => {
    const t = 'Llovía. El viejo pintor miró el lienzo. Nadie dijo nada durante un rato largo. Al fin habló Porbus.';
    const p = elegirPasaje(t, tramos(t, ['lienzo']), { minPalabras: 12 });
    expect(p.texto).toBe('El viejo pintor miró el lienzo. Nadie dijo nada durante un rato largo.');
  });

  it('une las vecinas que también responden', () => {
    const t = 'Habló del panóptico. La torre ve sin ser vista y el preso es visto sin ver nunca a quien le mira desde arriba. La torre es el poder. Luego cambió de tema por completo y habló de otras cosas durante horas.';
    const p = elegirPasaje(t, tramos(t, ['torre']));
    expect(p.texto).toBe('La torre ve sin ser vista y el preso es visto sin ver nunca a quien le mira desde arriba. La torre es el poder.');
  });

  it('una oración larguísima se parte por cláusulas, nunca a media cláusula', () => {
    const relleno = Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(' ');
    const t = `Primero ${relleno}; después vino el pie desnudo que salía del caos; y al final ${relleno}.`;
    const p = elegirPasaje(t, tramos(t, ['pie']));
    expect(p.texto).toBe('después vino el pie desnudo que salía del caos;');
  });

  it('los versos se citan separados por barras', () => {
    const t = 'Volverán las oscuras golondrinas\nen tu balcón sus nidos a colgar,\ny otra vez con el ala a sus cristales\njugando llamarán.';
    expect(elegirPasaje(t, tramos(t, ['golondrinas'])).texto).toBe('Volverán las oscuras golondrinas / en tu balcón sus nidos a colgar, / y otra vez con el ala a sus cristales / jugando llamarán.');
  });

  it('no elige un título', () => {
    const t = '## El pie\n\nUn pie desnudo salía del cuadro. Nadie lo esperaba.';
    expect(elegirPasaje(t, tramos(t, ['pie'])).texto).toBe('Un pie desnudo salía del cuadro. Nadie lo esperaba.');
  });
});

describe('ubicarPasaje y anclarPasaje', () => {
  it('encuentra el pasaje sin contar blancos, tildes, marcas ni guiones de fin de línea', () => {
    const pagina = 'Texto anterior.\n\nEn s\'appro-\nchant, ils aperçurent **dans** un coin';
    const r = ubicarPasaje(pagina, 'En s\'approchant, ils aperçurent dans un coin');
    expect(r).not.toBeNull();
    expect(pagina.slice(r![0], r![1]).startsWith('En s\'appro')).toBe(true);
  });

  it('la página es la de las oraciones, no la del principio del fragmento', () => {
    const p20 = { tipo: 'pagina' as const, fisica: 20, impresa: '20', romana: false, origen: 'leido' as const, confianza: 1 };
    const p21 = { ...p20, fisica: 21, impresa: '21' };
    const unidades = [
      { orden: 19, ancla: p20, texto: 'Final de la página veinte. Primera parte de una frase que' },
      { orden: 20, ancla: p21, texto: 'sigue aquí. Un pie desnudo salía del cuadro. Más texto.' },
    ];
    const frag = { ancla: p20, anclaFin: p21 };
    const solo21 = anclarPasaje({ texto: 'Un pie desnudo salía del cuadro.', desde: 0, hasta: 0 }, frag, unidades);
    expect(solo21.ancla).toEqual(p21);
    expect(solo21.anclaFin).toBeUndefined();
    const cruza = anclarPasaje({ texto: 'Primera parte de una frase que sigue aquí.', desde: 0, hasta: 0 }, frag, unidades);
    expect(cruza.ancla).toEqual(p20);
    expect(cruza.anclaFin).toEqual(p21);
  });

  it('audio: el segundo de la primera palabra del pasaje', () => {
    const ancla = { tipo: 'tiempo' as const, t0: 100, t1: 110 };
    // «**Ana:** Hola a todos. Hoy hablamos del pie.»: 7 palabras, una por segundo.
    const cs = Array.from({ length: 7 }, (_, i) => [i * 100, 80]).flat();
    const u = { orden: 3, ancla, texto: '**Ana:** Hola a todos. Hoy hablamos del pie.', palabras: { v: 1, t0: 100, cs } };
    const p = anclarPasaje({ texto: 'Hoy hablamos del pie.', desde: 0, hasta: 0 }, { ancla }, [u]);
    expect(p.ancla).toEqual({ tipo: 'tiempo', t0: 103, t1: 106.8 });
  });
});

describe('ubicarPasajeEnUnidad', () => {
  const pasaje = 'Primera parte de una frase que sigue aquí en la otra página y acaba bien.';
  it('entero, su principio al final de una página o su final al principio de la siguiente', async () => {
    const { ubicarPasajeEnUnidad } = await import('../src/index.js');
    const a = 'Texto previo. Primera parte de una frase que sigue';
    const b = 'aquí en la otra página y acaba bien. Y luego más.';
    expect(ubicarPasajeEnUnidad(`x. ${pasaje} y.`, pasaje)?.parte).toBe('entero');
    const pa = ubicarPasajeEnUnidad(a, pasaje)!;
    expect(pa.parte).toBe('principio');
    expect(a.slice(pa.desde, pa.hasta)).toBe('Primera parte de una frase que sigue');
    const pb = ubicarPasajeEnUnidad(b, pasaje)!;
    expect(pb.parte).toBe('final');
    expect(b.slice(pb.desde, pb.hasta)).toBe('aquí en la otra página y acaba bien.');
    expect(ubicarPasajeEnUnidad('Nada que ver con esto, de verdad, en absoluto.', pasaje)).toBeNull();
  });
});
