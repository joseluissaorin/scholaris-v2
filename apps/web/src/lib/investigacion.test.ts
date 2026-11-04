import { describe, expect, it } from 'vitest';
import type { EventoInvestigacion, EvidenciaInvestigacion } from '@scholaris/contrato';
import { aplicarEvento, citasJuntas, costeLegible, duracionLegible, estadoInicial, etiquetaHerramienta, markdownConCitas, pruebasCitadas, pruebasSinCitar, resumirEntrada, type EstadoInvestigacion } from './investigacion';

const prueba = (id: string, extra: Partial<EvidenciaInvestigacion> = {}): EvidenciaInvestigacion => ({
  id, documento: 'd-cuento', titulo: 'Der Sandmann', ancla: { tipo: 'pagina', fisica: 3, impresa: '3', romana: false, origen: 'leido', confianza: 1 },
  modo: 'texto', capa: 'literal', herramienta: 'buscar', etiqueta: 'p. 3', citaCorta: '(Hoffmann, 1816, p. 3)', ...extra,
});

function correr(eventos: EventoInvestigacion[]): EstadoInvestigacion {
  return eventos.reduce((e, ev) => aplicarEvento(e, ev, 1000), estadoInicial('¿Qué es Coppelia?', 0));
}

describe('el estado de una investigación', () => {
  const p1 = prueba('P1');
  const p2 = prueba('P2', { documento: 'd-pelicula', ancla: { tipo: 'tiempo', t0: 60, t1: 70, region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, instante: 64 }, modo: 'video', capa: 'percepcion', herramienta: 'ver', etiqueta: '1:00-1:10' });
  const base: EventoInvestigacion[] = [
    { tipo: 'inicio', id: 'i-1', modelo: 'm', presupuesto: { pasos: 20, segundos: 300, usd: 1 } },
    { tipo: 'plan', plan: { enfoque: 'Comparar', documentos: [], subpreguntas: [], idiomas: ['es'], idiomaRespuesta: 'es' } },
    { tipo: 'paso', n: 1, herramienta: 'buscar', entrada: { consulta: 'Coppelia' }, resumen: '8 pasajes', ms: 300, evidencias: ['P1'] },
    { tipo: 'evidencia', evidencia: p1 },
    { tipo: 'evidencia', evidencia: p2 },
    { tipo: 'texto', delta: 'Es una autómata [E1]', marcas: { E1: 'P1' } },
    { tipo: 'texto', delta: ' y en el cine otra cosa [E2].', marcas: { E2: 'P2' } },
  ];

  it('las fases avanzan con los eventos', () => {
    expect(correr(base.slice(0, 1)).fase).toBe('planificando');
    expect(correr(base.slice(0, 2)).fase).toBe('investigando');
    const e = correr(base);
    expect(e.fase).toBe('escribiendo');
    expect(e.texto).toBe('Es una autómata [E1] y en el cine otra cosa [E2].');
    expect(e.pasos).toHaveLength(1);
    expect(e.pruebas.map((p) => p.id)).toEqual(['P1', 'P2']);
  });

  it('si la redacción vuelve a empezar («reinicio»), se descarta lo recibido y sus marcas', () => {
    const e = correr([...base, { tipo: 'texto', delta: '', reinicio: true }, { tipo: 'texto', delta: 'Otra versión [E1].', marcas: { E1: 'P2' } }]);
    expect(e.texto).toBe('Otra versión [E1].');
    expect(e.marcas).toEqual({ E1: 'P2' });
  });

  it('mientras se escribe, cada marca lleva a su prueba por las «marcas» del texto', () => {
    const m = pruebasCitadas(correr(base));
    expect(m.get('E1')?.id).toBe('P1');
    expect(m.get('E2')?.documento).toBe('d-pelicula');
  });

  it('al final mandan las pruebas de «fin», y se sabe cuáles no se citaron', () => {
    const p3 = prueba('P3', { ancla: { tipo: 'pagina', fisica: 9, impresa: '9', romana: false, origen: 'leido', confianza: 1 } });
    const e = correr([...base, { tipo: 'evidencia', evidencia: p3 }, {
      tipo: 'fin', markdown: 'Final [E1].', evidencias: [{ ...p2, id: 'E1', prueba: 'P2' }], fuentes: [], confianza: 'alta',
      coste: { usd: 0.1, tokensEntrada: 1, tokensSalida: 1, llamadas: 1, pasos: 1, ms: 1, modelo: 'm' }, avisos: [], ms: 1000,
    }]);
    expect(e.fase).toBe('hecho');
    expect(e.terminada).toBe(1000);
    expect(pruebasCitadas(e).get('E1')?.prueba).toBe('P2');
    expect(pruebasSinCitar(e).map((p) => p.id)).toEqual(['P1', 'P3']);
    // Después del final no entra nada más, salvo una verificación rezagada.
    expect(aplicarEvento(e, { tipo: 'texto', delta: 'más' }).texto).toBe(e.texto);
    expect(aplicarEvento(e, { tipo: 'verificacion', frases: [], respaldadas: 3, total: 4 }).verificacion?.respaldadas).toBe(3);
  });

  it('un paso repetido (mismo n) se sustituye', () => {
    const e = correr([...base, { tipo: 'paso', n: 1, herramienta: 'buscar', entrada: {}, resumen: 'otro', ms: 1, evidencias: [] }]);
    expect(e.pasos).toHaveLength(1);
    expect(e.pasos[0]!.resumen).toBe('otro');
  });

  it('un error cierra la investigación', () => {
    const e = correr([...base, { tipo: 'error', mensaje: 'Se acabó el presupuesto.' }]);
    expect(e.fase).toBe('error');
    expect(e.error).toBe('Se acabó el presupuesto.');
  });
});

describe('los pasos en una línea', () => {
  it('etiquetas en español, también para herramientas nuevas', () => {
    expect(etiquetaHerramienta('ver')).toBe('Ver');
    expect(etiquetaHerramienta('relaciones')).toBe('Relaciones');
    expect(etiquetaHerramienta('comparar')).toBe('Comparar');
  });

  it('qué, en qué obra y en qué tramo', () => {
    const titulos = (id: string) => ({ 'd-pelicula': 'Coppelia (2021)' } as Record<string, string>)[id];
    expect(resumirEntrada({ consulta: 'el helado del final', documento: 'd-pelicula', t0: 3723, t1: 3790 }, titulos)).toBe('«el helado del final» · Coppelia (2021) · 1:02:03-1:03:10');
    expect(resumirEntrada({ documentos: ['a', 'b', 'c'], desde: 3, hasta: 5 })).toBe('3 documentos · pp. 3-5');
    expect(resumirEntrada({ entidad: 'Coppelia', capa: 'comprension', exacta: true })).toBe('«Coppelia» · capa: comprension · exacta');
    expect(resumirEntrada(undefined)).toBe('');
  });
});

describe('cifras', () => {
  it('duración y coste a la española', () => {
    expect(duracionLegible(4200)).toBe('4,2 s');
    expect(duracionLegible(125_000)).toBe('2 min 5 s');
    expect(costeLegible(0.0834)).toBe('0,083 USD');
    expect(costeLegible(1.5)).toBe('1,50 USD');
    expect(costeLegible(0.004)).toBe('menos de 0,01 USD');
  });
});

describe('copiar con citas', () => {
  const m = new Map([['E1', { citaCorta: '(Hoffmann, 1816, p. 3)' }], ['E2', { citaCorta: '(Hoffmann, 1816, p. 9)' }]]);
  it('las marcas seguidas se citan juntas', () => {
    expect(citasJuntas(['E1', 'E2'], m)).toBe('(Hoffmann, 1816, p. 3; Hoffmann, 1816, p. 9)');
    expect(markdownConCitas('Es una autómata [E1][E2]. Otra [E1].', m)).toBe('Es una autómata (Hoffmann, 1816, p. 3; Hoffmann, 1816, p. 9). Otra (Hoffmann, 1816, p. 3).');
  });
  it('una marca sin prueba conocida desaparece', () => {
    expect(markdownConCitas('Algo [E9].', m)).toBe('Algo.');
  });
});

describe('respuestas incompletas y errores', () => {
  it('un error a media respuesta deja la investigación en error con lo que había (y nada más cambia luego)', async () => {
    const { aplicarEvento, estadoInicial } = await import('./investigacion');
    let e = estadoInicial('¿Qué pasa con el reloj?', 0);
    e = aplicarEvento(e, { tipo: 'inicio', id: 'i', modelo: 'm', presupuesto: { pasos: 8, segundos: 90, usd: 0.1 } }, 1);
    e = aplicarEvento(e, { tipo: 'texto', delta: 'El reloj ' }, 2);
    e = aplicarEvento(e, { tipo: 'error', mensaje: '' }, 3);
    expect(e.fase).toBe('error');
    expect(e.error).toBe('La investigación falló.');
    expect(e.texto).toBe('El reloj ');
    expect(aplicarEvento(e, { tipo: 'texto', delta: 'más' }, 4).texto).toBe('El reloj ');
  });

  it('una respuesta final con frases sin marcas: ninguna prueba citada y todas las reunidas, aparte', async () => {
    const { aplicarEvento, estadoInicial, pruebasCitadas, pruebasSinCitar } = await import('./investigacion');
    const prueba = { id: 'P1', documento: 'd', titulo: 'T', ancla: { tipo: 'pagina' as const, fisica: 3, impresa: '3', romana: false, origen: 'leido' as const, confianza: 1 }, modo: 'texto' as const, capa: 'literal' as const, herramienta: 'buscar', etiqueta: 'p. 3', citaCorta: '(T, p. 3)' };
    let e = estadoInicial('x', 0);
    e = aplicarEvento(e, { tipo: 'evidencia', evidencia: prueba }, 1);
    e = aplicarEvento(e, { tipo: 'fin', markdown: 'Una frase sin marca. Otra tampoco.', evidencias: [], fuentes: [], confianza: 'baja', coste: { usd: 0, tokensEntrada: 0, tokensSalida: 0, llamadas: 1, pasos: 1, ms: 1, modelo: 'm' }, avisos: [], ms: 1 }, 2);
    expect(e.fase).toBe('hecho');
    expect(pruebasCitadas(e).size).toBe(0);
    expect(pruebasSinCitar(e).map((p) => p.id)).toEqual(['P1']);
  });
});
