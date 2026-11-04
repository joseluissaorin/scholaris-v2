/**
 * Regresiones de la verificación con textos inventados (ninguno es de una obra real):
 * frases que juntan varias afirmaciones, nombres que la prueba no trae, sonidos y
 * gestos que no se ven ni se oyen al volver a mirar.
 */
import { describe, expect, it } from 'vitest';
import type { Ancla } from '@scholaris/nucleo';
import type { ContextoHerramientas } from '../src/contexto.js';
import { Contabilidad, type PeticionModelo } from '../src/modelo.js';
import { CuadernoPruebas, type Ambito } from '../src/pruebas.js';
import { Numerador } from '../src/sintesis.js';
import { comprobacionesLiterales, frasesDe, marcaEnMedio, nombradosEn, partirPorMarcas, verificar } from '../src/verificacion.js';
import { ModeloGuion, textoDe } from './apoyo.js';

const pagina = (fisica: number, impresa: string): Ancla => ({ tipo: 'pagina', fisica, impresa, romana: false, origen: 'leido', confianza: 1 });

const PAGINA_1 = 'Marta llegó al puerto al amanecer. Llevaba una maleta azul y un sombrero de paja.';
const PAGINA_2 = 'En la taberna, el viejo Tomás contaba historias de barcos hundidos.';
const TRAMO = '**Marta:** No pienso volver a esa casa. **Luis:** Pues yo sí.';

function ctxCon(guion: (p: PeticionModelo) => { texto?: string; json?: unknown }) {
  const pruebas = new CuadernoPruebas();
  const amb = (unidad: string, orden: number, texto: string, ancla: Ancla): Ambito => ({ unidad, orden, texto, ancla });
  pruebas.registrar({ evidencia: { documento: 'novela', ancla: pagina(1, '7'), cita: PAGINA_1, modo: 'texto', unidad: 'u1' }, capa: 'literal', herramienta: 'leer', ambito: amb('u1', 0, PAGINA_1, pagina(1, '7')) });
  pruebas.registrar({ evidencia: { documento: 'novela', ancla: pagina(2, '8'), cita: PAGINA_2, modo: 'texto', unidad: 'u2' }, capa: 'literal', herramienta: 'leer', ambito: amb('u2', 1, PAGINA_2, pagina(2, '8')) });
  const tiempo: Ancla = { tipo: 'tiempo', t0: 100, t1: 110, hablante: 'Marta' };
  pruebas.registrar({ evidencia: { documento: 'pelicula', ancla: tiempo, cita: TRAMO, modo: 'audio', unidad: 'v1' }, capa: 'literal', herramienta: 'leer', ambito: amb('v1', 0, TRAMO, tiempo) });
  const modelo = new ModeloGuion((p) => guion(p));
  const ctx = {
    p: { modelos: { agente: modelo }, medios: { fuente: async () => ({ uri: 'files/peli', mime: 'video/mp4' }), imagen: async () => null } },
    pruebas, docs: new Map([
      ['novela', { id: 'novela', tipo: 'libro', metadatos: { titulo: 'La maleta azul', autores: [{ nombre: 'Ana', apellidos: 'Ruiz' }], anio: 2001, idioma: 'es' } }],
      ['pelicula', { id: 'pelicula', tipo: 'video', metadatos: { titulo: 'El puerto', autores: [{ nombre: 'Juan', apellidos: 'Mora' }], anio: 2005, idioma: 'es' } }],
    ]),
    fichas: new Map(), ambito: null, filtros: {}, notas: [], cuentas: new Contabilidad(), segundosVer: 300, resultadosPorBusqueda: 6, idioma: 'es', alPrueba: () => undefined, avisos: [],
  } as unknown as ContextoHerramientas;
  return { ctx, modelo };
}

/** Juicio por marcas: `malas` dice qué pares (frase, marca) no sostienen entera la frase. */
function juicio(t: string, malas: (frase: string, marca: string) => 'parcial' | 'no_sostiene' | null, clase: (frase: string) => string = () => 'hecho') {
  const frases = [...t.matchAll(/^(\d+)\. (.*?)(?: \[marcas: ([^\]]+)\]| \[sin marcas\])$/gm)];
  return { frases: frases.map((m) => ({ i: Number(m[1]), clase: m[3] ? clase(m[2]!) : 'interpretacion', marcas: (m[3] ? m[3].split(/,\s*/) : []).map((marca) => ({ marca, veredicto: malas(m[2]!, marca) ?? 'sostiene', nota: 'falta algo' })) })) };
}

describe('verificación por marcas y corrección', () => {
  it('una frase que junta dos datos de dos pruebas se parte en dos frases, cada una con su marca', async () => {
    let correcciones = 0;
    const { ctx } = ctxCon((p) => {
      const t = textoDe(p);
      if (p.sistema?.startsWith('Corriges')) {
        correcciones++;
        expect(t).toContain('E1: parcial');
        return { json: { frases: [{ i: Number(/### Frase (\d+)/.exec(t)![1]), texto: 'Marta llega al puerto con una maleta azul [E1]. En la taberna, Tomás cuenta historias de barcos [E2].' }] } };
      }
      // Antes de corregir, cada marca sostiene solo media frase; después, cada frase entera.
      return { json: juicio(t, (frase) => (frase.includes('taberna') && frase.includes('maleta') ? 'parcial' : null)) };
    });
    const n = new Numerador(ctx);
    const md = n.sustituir('Marta llega al puerto con una maleta azul y en la taberna Tomás cuenta historias de barcos [P1, P2].');
    const v = await verificar(ctx, n, md, { sitios: 0 });
    expect(correcciones).toBe(1);
    expect(v.correcciones).toBe(1);
    expect(v.markdown).toBe('Marta llega al puerto con una maleta azul [E1]. En la taberna, Tomás cuenta historias de barcos [E2].');
    expect(v.frases.map((f) => f.veredicto)).toEqual(['respaldada', 'respaldada']);
  });

  it('lo que nada sostiene se quita, y la corrección puede usar otra prueba del cuaderno', async () => {
    const { ctx } = ctxCon((p) => {
      const t = textoDe(p);
      if (p.sistema?.startsWith('Corriges')) {
        expect(t).toContain('Otras pruebas del cuaderno:\n[P2]');
        return { json: { frases: [{ i: 0, texto: 'Tomás cuenta historias de barcos hundidos [P2]. Una cita inventada: «palabras que no existen en ninguna prueba» [E1].' }] } };
      }
      return { json: juicio(t, (_f, marca) => (marca === 'E1' ? 'no_sostiene' : null)) };
    });
    const n = new Numerador(ctx);
    const md = n.sustituir('El viejo Tomás cuenta historias de barcos hundidos en la taberna [P1].');
    const v = await verificar(ctx, n, md, { sitios: 0 });
    // La frase nueva con una cita que no está en sus pruebas se cae; la otra, con la prueba del cuaderno, se queda.
    expect(v.markdown).toBe('Tomás cuenta historias de barcos hundidos [E2].');
    expect(v.frases.map((f) => f.veredicto)).toEqual(['respaldada']);
  });

  it('si todo lo corregido es inventado, se queda la frase de antes, señalada', async () => {
    const { ctx } = ctxCon((p) => {
      const t = textoDe(p);
      if (p.sistema?.startsWith('Corriges')) return { json: { frases: [{ i: 0, texto: 'Tomás dice «palabras que no existen en ninguna prueba» [E1].' }] } };
      return { json: juicio(t, () => 'no_sostiene') };
    });
    const n = new Numerador(ctx);
    const v = await verificar(ctx, n, n.sustituir('El viejo Tomás cuenta historias en la plaza [P1].'), { sitios: 0 });
    // Sin ninguna prueba que la sostenga, la frase pierde su marca (y el agente la señala «sin prueba»).
    expect(v.markdown).toBe('El viejo Tomás cuenta historias en la plaza.');
    expect(v.frases[0]).toMatchObject({ veredicto: 'sin_prueba', evidencias: [] });
  });

  it('una cita puesta con la marca de otra página pasa a la prueba donde está de verdad', () => {
    const { ctx } = ctxCon(() => ({ texto: '' }));
    const n = new Numerador(ctx);
    expect(n.sustituir('Tomás «contaba historias de barcos hundidos» [P1].')).toBe('Tomás «contaba historias de barcos hundidos» [E1].');
    expect(n.evidencia('E1')).toMatchObject({ etiqueta: 'p. 8', cita: 'contaba historias de barcos hundidos.', prueba: 'P2' });
    expect(n.reanclados).toBe(1);
  });

  it('las citas nuevas entran en la numeración', async () => {
    const { ctx } = ctxCon((p) => {
      const t = textoDe(p);
      if (p.sistema?.startsWith('Corriges')) return { json: { frases: [{ i: 0, texto: 'Tomás cuenta «historias de barcos hundidos» [P2].' }] } };
      return { json: juicio(t, (frase, marca) => (marca === 'E1' && frase.includes('Tomás') ? 'no_sostiene' : null)) };
    });
    const n = new Numerador(ctx);
    const v = await verificar(ctx, n, n.sustituir('Tomás cuenta historias en el puerto [P1].'), { sitios: 0 });
    expect(v.markdown).toBe('Tomás cuenta «historias de barcos hundidos» [E2].');
    expect(n.evidencia('E2')!.cita).toBe('historias de barcos hundidos.');
    expect(n.evidencia('E2')!.ancla.caracteres).toBeDefined();
  });
});

describe('frases con muchas marcas', () => {
  it('una frase con tres marcas se corrige siempre, aunque el juez la dé por buena', async () => {
    let corregida = false;
    const { ctx } = ctxCon((p) => {
      const t = textoDe(p);
      if (p.sistema?.startsWith('Corriges')) {
        corregida = true;
        expect(t).toContain('hay que partirla');
        return { json: { frases: [{ i: 0, texto: 'Marta llega al puerto [E1]. Tomás cuenta historias [E2]. Marta no piensa volver [E3].' }] } };
      }
      return { json: juicio(t, () => null) };
    });
    const n = new Numerador(ctx);
    const v = await verificar(ctx, n, n.sustituir('Marta llega al puerto, Tomás cuenta historias y Marta no piensa volver [P1][P2][P3].'), { sitios: 0 });
    expect(corregida).toBe(true);
    expect(v.markdown).toBe('Marta llega al puerto [E1]. Tomás cuenta historias [E2]. Marta no piensa volver [E3].');
  });
});

describe('marcas en medio de la frase', () => {
  it('se reconocen (la traducción entre paréntesis detrás de la marca no cuenta)', () => {
    expect(marcaEnMedio('Se ve la calle [E1], gente en la acera [E2] y un mural [E3].')).toBe(true);
    expect(marcaEnMedio('Dice «hola» [E1] («hello») y se va [E1].')).toBe(false);
    expect(marcaEnMedio('Marta llega al puerto [E1][E2].')).toBe(false);
  });

  it('si la corrección no las arregla, la frase se parte en una frase por marca', () => {
    expect(partirPorMarcas('Se ve la calle a través del follaje [E1], gente caminando por la acera [E2] y un mural pintado [E3], seguidos de un rótulo [E4].'))
      .toBe('Se ve la calle a través del follaje [E1]. Gente caminando por la acera [E2]. Un mural pintado [E3]. Un rótulo [E4].');
  });

  it('una frase con una marca en medio se corrige siempre', async () => {
    let corregida = false;
    const { ctx } = ctxCon((p) => {
      const t = textoDe(p);
      if (p.sistema?.startsWith('Corriges')) {
        corregida = true;
        // El corrector falla y la deja igual: entra la partición a mano.
        return { json: { frases: [{ i: 0, texto: /### Frase 0\n(.*)/.exec(t)![1] }] } };
      }
      return { json: juicio(t, () => null) };
    });
    const n = new Numerador(ctx);
    const v = await verificar(ctx, n, n.sustituir('Marta llega al puerto [P1], y Tomás cuenta historias en la taberna [P2].'), { sitios: 0 });
    expect(corregida).toBe(true);
    expect(v.markdown).toBe('Marta llega al puerto [E1]. Tomás cuenta historias en la taberna [E2].');
  });
});

describe('lo que se nombra tiene que estar escrito', () => {
  it('reconoce siglas y nombres detrás de «nombra», «menciona», «dice»', () => {
    expect(nombradosEn('La película nombra explícitamente la UMAP en ese diálogo.')).toEqual(['UMAP']);
    expect(nombradosEn('El narrador menciona a Lorenzo Vidal y a la ONU.')).toEqual(['ONU', 'Lorenzo Vidal']);
    expect(nombradosEn('Marta vuelve al puerto.')).toEqual([]);
  });

  it('una frase que dice que se nombra algo que la prueba no trae: la marca no la sostiene', () => {
    const { ctx } = ctxCon(() => ({ texto: '' }));
    const n = new Numerador(ctx);
    const [f] = frasesDe(n.sustituir('En la escena, Marta nombra explícitamente la CNT al negarse a volver [P3].'));
    expect(comprobacionesLiterales(f!, n)).toEqual({ E1: { veredicto: 'no_sostiene', nota: '«CNT» no aparece escrito ni dicho en esta prueba.' } });
    const [g] = frasesDe(n.sustituir('Marta dice que no piensa volver a esa casa, y Luis le contesta [P3].'));
    expect(comprobacionesLiterales(g!, n)).toEqual({});
  });
});

describe('lo visual y lo sonoro se vuelve a mirar', () => {
  it('un sonido que no se oye al volver a escuchar: la frase se corrige y lo inventado desaparece', async () => {
    let miradas = 0;
    const { ctx } = ctxCon((p) => {
      const t = textoDe(p);
      if (JSON.stringify(p.esquema ?? {}).includes('juicios')) {
        miradas++;
        expect(p.mensajes[0]!.partes[0]).toMatchObject({ tipo: 'medio', uri: 'files/peli', desde: 98, hasta: 112 });
        expect(t).toContain('escucha con atención');
        return { json: { juicios: [{ n: 1, veredicto: 'no', nota: 'No suena ningún disco: solo voces.' }] } };
      }
      if (p.sistema?.startsWith('Corriges')) {
        expect(t).toContain('Al volver a escuchar: No suena ningún disco');
        return { json: { frases: [{ i: 0, texto: 'Marta se niega a volver a la casa [E1].' }] } };
      }
      return { json: juicio(t, () => null, (frase) => (/disco|música/.test(frase) ? 'sonora' : 'hecho')) };
    });
    const n = new Numerador(ctx);
    const v = await verificar(ctx, n, n.sustituir('Mientras suena un disco de ópera, Marta se niega a volver a la casa [P3].'), { sitios: 4 });
    expect(miradas).toBe(1);
    expect(v.markdown).toBe('Marta se niega a volver a la casa [E1].');
    expect(v.frases[0]!.veredicto).toBe('respaldada');
  });

  it('sin presupuesto de sitios no se mira nada', async () => {
    let miradas = 0;
    const { ctx } = ctxCon((p) => {
      if (JSON.stringify(p.esquema ?? {}).includes('juicios')) { miradas++; return { json: { juicios: [] } }; }
      return { json: juicio(textoDe(p), () => null, () => 'visual') };
    });
    const n = new Numerador(ctx);
    await verificar(ctx, n, n.sustituir('Marta aparece en primer plano junto a la puerta [P3].'), { sitios: 0 });
    expect(miradas).toBe(0);
  });
});
