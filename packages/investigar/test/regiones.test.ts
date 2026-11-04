/**
 * El anclaje material de las citas de Investigar: al terminar, cada cita de una
 * página con sus caracteres recibe su región (una vez por sitio), la cuenta lo
 * paga, la prueba de la que sale se vuelve a emitir con la región si es la misma
 * ancla, y la tarjeta del cuaderno la guarda. Un fallo no tumba nada.
 */
import { describe, expect, it } from 'vitest';
import type { EventoInvestigacion } from '@scholaris/contrato';
import type { AnclaMaterial, Region } from '@scholaris/nucleo';
import { investigarCompleto } from '../src/agente.js';
import type { ContextoHerramientas } from '../src/contexto.js';
import type { AnclajeInvestigar } from '../src/puertos.js';
import type { Prueba } from '../src/pruebas.js';
import { regionesDeCitas } from '../src/regiones.js';
import type { Numerador } from '../src/sintesis.js';
import { CUENTO, crearSQL, guionCompleto, ModeloGuion, puertos, sembrar } from './apoyo.js';

const REGION: Region = { x: 0.12, y: 0.4, w: 0.6, h: 0.05 };

/** Un anclaje falso: apunta lo que se le pide y cobra 0,001 $ por localización «por visión». */
function anclajeFalso(o: { region?: (orden: number, cita?: string) => Region | undefined; falla?: boolean } = {}) {
  const pedidas: Array<{ documento: string; orden: number; caracteres?: [number, number]; cita?: string; vision?: boolean }> = [];
  const fabrica = (documento: string): AnclajeInvestigar => {
    let llamadas = 0;
    return {
      async region(orden, x) {
        pedidas.push({ documento, orden, ...x });
        if (o.falla) throw new Error('sin imagen');
        if (x.vision === false) return undefined;
        llamadas++;
        return o.region ? o.region(orden, x.cita) : REGION;
      },
      uso: () => ({ modelo: 'gemini-3.8-flash', tokensEntrada: 1000 * llamadas, tokensSalida: 50 * llamadas, usd: 0.001 * llamadas, llamadas }),
    };
  };
  return { pedidas, fabrica };
}

const pagina = (fisica: number, caracteres?: [number, number]): AnclaMaterial => ({ tipo: 'pagina', fisica, impresa: String(fisica), romana: false, origen: 'leido', confianza: 1, ...(caracteres ? { caracteres } : {}) });

/** Una marca de la respuesta con su prueba, como las deja el numerador. */
function marcada(id: string, documento: string, ancla: AnclaMaterial, prueba: Partial<Prueba> = {}) {
  const texto = 'Le eché una ojeada: habiendo chocolate, había pedido fresa. Así lo conocí en Coppelia.';
  const p: Prueba = {
    id: `P${id.slice(1)}`, evidencia: { documento, ancla: prueba.evidencia?.ancla ?? ancla, modo: 'texto', unidad: `${documento}:u0` }, capa: 'literal', herramienta: 'leer',
    ambito: { unidad: `${documento}:u0`, orden: 0, texto, ancla: pagina(ancla.tipo === 'pagina' ? ancla.fisica : 1) }, ...prueba,
  };
  return { id, prueba: p, estrechada: true, evidencia: { id, documento, titulo: '', ancla, modo: 'texto' as const, capa: 'literal' as const, herramienta: 'leer', etiqueta: '', citaCorta: '' } };
}

const contexto = (anclaje?: (d: string) => AnclajeInvestigar) => ({ p: { ...(anclaje ? { anclajeMaterial: anclaje } : {}) } }) as unknown as ContextoHerramientas;

describe('regiones de las citas', () => {
  it('una localización por sitio, con la cita literal de la unidad; la prueba con la misma ancla también la recibe', async () => {
    const a = anclajeFalso();
    const misma = marcada('E1', CUENTO, pagina(2, [20, 58]));
    const otra = marcada('E2', CUENTO, pagina(2, [20, 58]), { evidencia: { documento: CUENTO, ancla: pagina(2), modo: 'texto' } });
    const tiempo = marcada('E3', CUENTO, { tipo: 'tiempo', t0: 1, t1: 2 });
    const entera = marcada('E4', CUENTO, pagina(2));
    const yaTiene = marcada('E5', CUENTO, { ...pagina(2, [0, 10]), region: { x: 0, y: 0, w: 1, h: 1 } });
    const numerador = { marcadas: [misma, otra, tiempo, entera, yaTiene] } as unknown as Numerador;
    const r = await regionesDeCitas(contexto(a.fabrica), numerador);
    expect(a.pedidas).toEqual([{ documento: CUENTO, orden: 0, caracteres: [20, 58], cita: 'habiendo chocolate, había pedido fresa', vision: true }]);
    expect(r).toMatchObject({ candidatas: 2, regiones: 2, uso: { usd: 0.001, llamadas: 1, modelo: 'gemini-3.8-flash' } });
    expect(misma.evidencia.ancla).toMatchObject({ caracteres: [20, 58], region: REGION });
    expect(otra.evidencia.ancla).toMatchObject({ region: REGION });
    // La prueba de E1 tiene la misma ancla: se vuelve a emitir con la región; la de E2 es la página entera y no.
    expect(r.pruebas.map((p) => p.id)).toEqual(['P1']);
    expect((misma.prueba.evidencia.ancla as AnclaMaterial).region).toEqual(REGION);
    expect((otra.prueba.evidencia.ancla as AnclaMaterial).region).toBeUndefined();
    expect((tiempo.evidencia.ancla as AnclaMaterial).region).toBeUndefined();
    expect((entera.evidencia.ancla as AnclaMaterial).region).toBeUndefined();
    expect((yaTiene.evidencia.ancla as AnclaMaterial).region).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('sin presupuesto no mira; si el anclaje falla o no hay puerto, las citas se quedan con sus caracteres', async () => {
    const sinVision = anclajeFalso();
    const m1 = marcada('E1', CUENTO, pagina(2, [20, 58]));
    const r1 = await regionesDeCitas(contexto(sinVision.fabrica), { marcadas: [m1] } as unknown as Numerador, { vision: () => false });
    expect(sinVision.pedidas[0]!.vision).toBe(false);
    expect(r1.regiones).toBe(0);
    expect(r1.uso.usd).toBe(0);

    const roto = anclajeFalso({ falla: true });
    const m2 = marcada('E1', CUENTO, pagina(2, [20, 58]));
    await expect(regionesDeCitas(contexto(roto.fabrica), { marcadas: [m2] } as unknown as Numerador)).resolves.toMatchObject({ candidatas: 1, regiones: 0 });
    expect((m2.evidencia.ancla as AnclaMaterial).region).toBeUndefined();

    const m3 = marcada('E1', CUENTO, pagina(2, [20, 58]));
    expect((await regionesDeCitas(contexto(), { marcadas: [m3] } as unknown as Numerador)).candidatas).toBe(0);
  });

  it('de punta a punta: la cita del cuento llega al final y al cuaderno con su región, y se paga', async () => {
    const sql = crearSQL();
    await sembrar(sql);
    const a = anclajeFalso();
    const eventos: EventoInvestigacion[] = [];
    const fin = await investigarCompleto({ ...puertos(sql, new ModeloGuion(guionCompleto())), anclajeMaterial: a.fabrica }, '¿Cómo cambia Coppelia entre el cuento y la película?', { profundidad: 'normal' }, (e) => eventos.push(e));
    // Solo las citas de página: la del cuento, estrechada a sus palabras.
    expect(a.pedidas.length).toBe(1);
    expect(a.pedidas[0]).toMatchObject({ documento: CUENTO, cita: expect.stringMatching(/^habiendo chocolate, había pedido fresa/) });
    const cuento = fin.evidencias.find((e) => e.documento === CUENTO)!;
    expect(cuento.ancla).toMatchObject({ tipo: 'pagina', fisica: 2, caracteres: a.pedidas[0]!.caracteres, region: REGION });
    expect(fin.evidencias.filter((e) => e.documento !== CUENTO).every((e) => e.ancla.tipo !== 'pagina')).toBe(true);
    // La verificación sigue siendo lo penúltimo.
    expect(eventos.at(-2)?.tipo).toBe('verificacion');
    // La tarjeta del cuaderno guarda la evidencia con su región (de ahí la recupera «recordar»).
    const filas = await sql.ejecutar<{ contenido: string }>('SELECT contenido FROM cuadernos_tarjetas WHERE documento = ?', CUENTO);
    const guardada = filas.map((f) => JSON.parse(f.contenido) as { evidencia?: { ancla?: AnclaMaterial } }).find((c) => c.evidencia?.ancla?.region);
    expect(guardada?.evidencia?.ancla?.region).toEqual(REGION);
    // El coste incluye la localización: lo mismo sin anclaje cuesta 0,001 $ y una llamada menos.
    const otra = crearSQL();
    await sembrar(otra);
    const sinAnclaje = await investigarCompleto(puertos(otra, new ModeloGuion(guionCompleto())), '¿Cómo cambia Coppelia entre el cuento y la película?', { profundidad: 'normal' });
    expect((sinAnclaje.evidencias.find((e) => e.documento === CUENTO)!.ancla as AnclaMaterial).region).toBeUndefined();
    expect(fin.coste.usd).toBeCloseTo(sinAnclaje.coste.usd + 0.001, 4);
    expect(fin.coste.llamadas).toBe(sinAnclaje.coste.llamadas + 1);
  });
});
