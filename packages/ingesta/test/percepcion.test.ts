import { describe, expect, it } from 'vitest';
import type { PersonaPercibida } from '@scholaris/nucleo';
import {
  aSegundos, clavesProxy, cortesDe, ErrorPresupuesto, ErrorSinProxy, fuenteGemini, fusionarEscenas, fusionarPlanos, fusionarSonidos, hablantesDe, interpretarEscenasFfmpeg,
  marca, normalizarVentana, partirVentana, percibirMedio, regionDeCaja, repartoDeWikidata, repartoInicial, transcripcionDeVentana, turnosDe, Unificador, ventana, ventanasDe,
  type AlmacenTrabajo, type FicheroRemoto, type Mirada, type PeticionMirar, type PuertoFicheros, type Vidente,
} from '../src/index.js';

describe('ventanas', () => {
  it('cubre la obra con solape y los tramos propios tilan sin huecos', () => {
    const vs = ventanasDe(1000, 480, 30);
    expect(vs.map((v) => [v.t0, v.t1])).toEqual([[0, 480], [450, 1000]]);
    expect(vs[0]!.propioDesde).toBe(0);
    expect(vs[0]!.propioHasta).toBe(vs[1]!.propioDesde);
    expect(vs.at(-1)!.propioHasta).toBe(1000);
  });

  it('suma a la última un resto corto en vez de dejarlo solo', () => {
    expect(ventanasDe(980, 480, 30).length).toBe(2);
    expect(ventanasDe(1450, 480, 30).map((v) => v.t0)).toEqual([0, 450, 900]);
    expect(ventanasDe(1500, 480, 30).map((v) => v.t0)).toEqual([0, 450, 900, 1350]);
    expect(ventanasDe(0)).toEqual([]);
  });

  it('parte una ventana en dos mitades con solape y reparte su tramo propio', () => {
    const [a, b] = partirVentana(ventana(450, 930, 465, 915), 30);
    expect(a.t0).toBe(450);
    expect(b.t1).toBe(930);
    expect(a.t1).toBeGreaterThan(b.t0);
    expect(a.propioHasta).toBe(b.propioDesde);
    expect([a.propioDesde, b.propioHasta]).toEqual([465, 915]);
  });

  it('marca y lee marcas en varios formatos', () => {
    expect(marca(3725.44)).toBe('1:02:05.4');
    expect(aSegundos('1:02:05.4')).toBeCloseTo(3725.4);
    expect(aSegundos('02:05')).toBe(125);
    expect(aSegundos('125.5s')).toBe(125.5);
    expect(aSegundos(12)).toBe(12);
    expect(aSegundos('nada')).toBeNaN();
  });
});

describe('transcripción', () => {
  // Palabras: «¿No había otro lugar?» (4) + «El lugar no importa.» (4); cs alterna inicio y duración en centésimas.
  const unidad = {
    texto: '**Vivian:** ¿No había otro lugar?\n\n**David:** El lugar no importa.',
    t0: 10, t1: 14, palabras: { v: 1 as const, t0: 10, cs: [0, 20, 20, 20, 40, 20, 60, 30, 200, 20, 220, 20, 240, 20, 260, 30] },
  };

  it('saca una frase por turno con el instante de su primera palabra', () => {
    const ts = turnosDe([unidad]);
    expect(ts).toEqual([
      { t0: 10, t1: 10.9, hablante: 'Vivian', texto: '¿No había otro lugar?' },
      { t0: 12, t1: 12.9, hablante: 'David', texto: 'El lugar no importa.' },
    ]);
    expect(transcripcionDeVentana(ts, 11, 20)).toBe('[0:00:12.0] David: El lugar no importa.');
    expect(hablantesDe(ts)).toEqual(['Vivian', 'David']);
  });

  it('sin palabras reparte el tiempo de la unidad y usa su hablante', () => {
    const ts = turnosDe([{ texto: 'Apaga la luz. Ya.', t0: 100, t1: 104, hablante: 'Vivian' }]);
    expect(ts.map((t) => [t.t0, t.hablante, t.texto])).toEqual([[100, 'Vivian', 'Apaga la luz.'], [103, 'Vivian', 'Ya.']]);
  });
});

describe('normalización de una ventana', () => {
  const u = () => new Unificador([{ nombre: 'Diego', actor: 'Jorge Perugorría' }, { nombre: 'David', actor: 'Vladimir Cruz' }]);

  it('convierte cajas 0-1000 en regiones y descarta las imposibles', () => {
    expect(regionDeCaja([100, 200, 600, 700])).toEqual({ x: 0.2, y: 0.1, w: 0.5, h: 0.5 });
    expect(regionDeCaja([0.1, 0.2, 0.6, 0.7])).toEqual({ x: 0.2, y: 0.1, w: 0.5, h: 0.5 });
    expect(regionDeCaja([10, 10, 10, 10])).toBeUndefined();
    expect(regionDeCaja('x')).toBeUndefined();
  });

  it('desplaza las marcas contadas desde el inicio de la ventana y recorta a la ventana', () => {
    const v = ventana(600, 780, 600, 780);
    const n = normalizarVentana(v, {
      escenas: [{ inicio: '0:00:00', fin: '0:03:00', titulo: 'Coppelia', personas: ['Jorge Perugorría', 'David Álvarez'], accion: 'Se conocen.' }],
      planos: [{ inicio: '0:00:05', fin: '0:00:12', escala: 'primer plano', dominante: 'Diego', personas: [{ nombre: 'Diego', caja: [0, 0, 1000, 500], instante: '0:00:08' }], objetos: [], descripcion: 'Diego.' }],
      sonidos: [], dialogos: [{ t: '0:00:09', hablante: 'diego', texto: 'Me encanta la fresa.' }], reparto: [],
    }, u());
    expect(n.desplazada).toBe(true);
    expect(n.escenas[0]).toMatchObject({ t0: 600, t1: 780, personas: ['Diego', 'David'] });
    expect(n.planos[0]).toMatchObject({ t0: 605, t1: 612, composicion: 'Domina el encuadre: Diego.' });
    expect(n.planos[0]!.personas[0]).toEqual({ nombre: 'Diego', region: { x: 0, y: 0, w: 0.5, h: 1 }, instante: 608 });
    expect(n.dialogos[0]).toEqual({ t: 609, hablante: 'Diego', texto: 'Me encanta la fresa.' });
  });

  it('deja las marcas absolutas como vienen y pone el instante dentro del plano', () => {
    const v = ventana(600, 780, 600, 780);
    const n = normalizarVentana(v, { escenas: [], planos: [{ inicio: '0:10:05', fin: '0:10:10', escala: 'plano medio', personas: [{ nombre: 'X', caja: [0, 0, 500, 500], instante: '0:20:00' }], descripcion: '' }], sonidos: [{ inicio: '0:10:00', fin: '0:15:00', clase: 'rara', descripcion: 'm' }] }, u());
    expect(n.desplazada).toBe(false);
    expect(n.planos[0]!.personas[0]!.instante).toBe(607.5);
    expect(n.sonidos[0]).toMatchObject({ t0: 600, t1: 780, clase: 'otro' });
  });
});

describe('fusión entre ventanas', () => {
  const u = new Unificador([]);
  const v1 = ventana(0, 480, 0, 465), v2 = ventana(450, 960, 465, 960);
  const plano = (t0: number, t1: number, d = '') => ({ inicio: String(t0), fin: String(t1), escala: 'plano medio', personas: [], descripcion: d });

  it('funde el plano repetido en el solape y deja los planos contiguos', () => {
    const a = normalizarVentana(v1, { planos: [plano(0, 400, 'a'), plano(400.6, 470, 'b'), plano(470, 480, 'c-cortado')] }, u);
    const b = normalizarVentana(v2, { planos: [plano(450, 470.2, 'b-cortado'), plano(470.2, 500, 'c'), plano(500, 960, 'd')] }, u);
    const ps = fusionarPlanos([a, b]);
    expect(ps.map((p) => [p.t0, p.t1, p.descripcion])).toEqual([[0, 400.6, 'a'], [400.6, 470.2, 'b'], [470.2, 500, 'c'], [500, 960, 'd']]);
  });

  it('ajusta los límites a los cortes detectados cercanos', () => {
    const a = normalizarVentana(ventana(0, 100, 0, 100), { planos: [plano(0, 10.6), plano(10.6, 30), plano(30, 100)] }, u);
    const ps = fusionarPlanos([a], [10.2, 29.5, 80]);
    expect(ps.map((p) => [p.t0, p.t1])).toEqual([[0, 10.2], [10.2, 29.5], [29.5, 100]]);
    expect(fusionarPlanos([a], [10.2, 29.5], false).map((p) => p.t0)).toEqual([0, 10.6, 30]);
  });

  it('une la escena partida por el corte de ventana y tila la obra', () => {
    const avisos: string[] = [];
    const a = normalizarVentana(v1, { escenas: [{ inicio: '0', fin: '300', titulo: 'Posada', personas: ['David', 'Vivian'], accion: 'A.' }, { inicio: '300', fin: '480', titulo: 'Coppelia', lugar: 'Coppelia', personas: ['Diego'], accion: 'B.' }] }, u);
    const b = normalizarVentana(v2, { escenas: [{ inicio: '450', fin: '700', titulo: 'En Coppelia', lugar: 'Coppelia', personas: ['Diego', 'David'], accion: 'C.' }, { inicio: '710', fin: '960', titulo: 'Guarida', personas: ['Diego'], accion: 'D.' }] }, u);
    const es = fusionarEscenas([a, b], 960, avisos);
    expect(es.map((e) => [e.t0, e.t1, e.titulo])).toEqual([[0, 300, 'Posada'], [300, 710, 'Coppelia'], [710, 960, 'Guarida']]);
    expect(es[1]!.personas).toEqual(['Diego', 'David']);
    expect(es[1]!.accion).toBe('B. C.');
    expect(avisos).toEqual([]);
  });

  it('rellena un hueco largo sin escena y lo avisa', () => {
    const avisos: string[] = [];
    const a = normalizarVentana(ventana(0, 200, 0, 200), { escenas: [{ inicio: '0', fin: '50', titulo: 'A', personas: [], accion: '' }, { inicio: '150', fin: '200', titulo: 'B', personas: [], accion: '' }] }, u);
    const es = fusionarEscenas([a], 200, avisos);
    expect(es.map((e) => e.titulo)).toEqual(['A', 'Tramo sin escena identificada', 'B']);
    expect(avisos.length).toBe(1);
  });

  it('una música que cruza el corte de ventana es una sola', () => {
    const a = normalizarVentana(v1, { sonidos: [{ inicio: '400', fin: '480', clase: 'musica', diegetico: false, descripcion: 'Tema' }] }, u);
    const b = normalizarVentana(v2, { sonidos: [{ inicio: '450', fin: '600', clase: 'musica', diegetico: false, descripcion: 'Tema principal', obra: 'Vitier' }] }, u);
    expect(fusionarSonidos([a, b])).toEqual([{ t0: 400, t1: 600, clase: 'musica', diegetico: false, descripcion: 'Tema principal', obra: 'Vitier' }]);
  });
});

describe('reparto', () => {
  it('unifica nombres por nombre, actor y nombre de pila', () => {
    const u = new Unificador([{ nombre: 'Diego', actor: 'Jorge Perugorría' }, { nombre: 'David' }]);
    expect(u.canonico('diego')).toBe('Diego');
    expect(u.canonico('Jorge Perugorria')).toBe('Diego');
    expect(u.canonico('David Álvarez')).toBe('David');
    expect(u.canonico('Diego (el artista)')).toBe('Diego');
    expect(u.canonico('Camarero de Coppelia')).toBe('Camarero de Coppelia');
    expect(u.canonico('camarero de coppelia')).toBe('Camarero de Coppelia');
  });

  it('suma los hablantes de la transcripción al reparto dado', () => {
    expect(repartoInicial([{ nombre: 'Diego', actor: 'Jorge Perugorría' }], ['Diego', 'Nancy']).map((p) => p.nombre)).toEqual(['Diego', 'Nancy']);
  });

  it('lee el reparto de Wikidata (P161 con P453 o P4633)', async () => {
    const http = async () => ({ ok: true, status: 200, json: async () => ({ results: { bindings: [
      { actorLabel: { value: 'Jorge Perugorría' }, personajeLabel: { value: 'Diego' } },
      { actorLabel: { value: 'Mirta Ibarra' }, papel: { value: 'Nancy' } },
      { actorLabel: { value: 'Marilyn Solaya' } },
      { actorLabel: { value: 'Q123' } },
    ] } }) });
    const r = await repartoDeWikidata('Q1128290', http);
    expect(r).toEqual<PersonaPercibida[]>([
      { nombre: 'Diego', ficticia: true, actor: 'Jorge Perugorría' },
      { nombre: 'Nancy', ficticia: true, actor: 'Mirta Ibarra' },
      { nombre: 'Marilyn Solaya', actor: 'Marilyn Solaya' },
    ]);
    expect(await repartoDeWikidata('no', http)).toEqual([]);
  });
});

describe('cortes de ffmpeg', () => {
  it('lee las puntuaciones de metadata=print y quita los cortes dobles', () => {
    const salida = 'frame:0 pts:1 pts_time:8.375\nlavfi.scene_score=0.269\nframe:1 pts:2 pts_time:79.54\nlavfi.scene_score=0.56\nframe:2 pts:3 pts_time:79.58\nlavfi.scene_score=0.61\nframe:3 pts:4 pts_time:90\nlavfi.scene_score=0.31\n';
    const r = interpretarEscenasFfmpeg(salida, 0.3);
    expect(r.cortes).toEqual([79.58, 90]);
    expect(r.candidatos?.length).toBe(4);
    expect(cortesDe(r.candidatos!, 0.2)).toEqual([8.375, 79.58, 90]);
  });

  it('las claves del proxy cuelgan del prefijo del documento', () => {
    expect(clavesProxy('u/x/d/y/')).toEqual({ proxy: 'u/x/d/y/proxy.mp4', cortes: 'u/x/d/y/proxy.cortes.json', voz: 'u/x/d/y/proxy.voz.json', gemini: 'u/x/d/y/proxy.gemini.json' });
  });
});

// ---------------------------------------------------------------------------
// percibirMedio con dobles
// ---------------------------------------------------------------------------

function trabajoEnMemoria(): AlmacenTrabajo & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return { datos, async leer(c) { return datos.get(c) ?? null; }, async escribir(c, t) { datos.set(c, t); } };
}

/** Un vidente que responde una escena y un plano por ventana, con marcas absolutas. */
function videnteFalso(opciones: { fallar?: (p: PeticionMirar) => string | null } = {}): Vidente & { llamadas: PeticionMirar[] } {
  const llamadas: PeticionMirar[] = [];
  return {
    nombre: 'falso:modelo-x', llamadas,
    async mirar(p): Promise<Mirada> {
      llamadas.push(p);
      const error = opciones.fallar?.(p);
      if (error === 'MAX_TOKENS') return { texto: '{"escenas": [', modelo: 'modelo-x', fin: 'MAX_TOKENS', tokensEntrada: 10, tokensSalida: 10, ms: 1, usd: 0.01 };
      if (error) throw new Error(error);
      const a = p.desde ?? 0, b = p.hasta ?? 0;
      return {
        texto: '', modelo: 'modelo-x', fin: 'STOP', tokensEntrada: 100, tokensSalida: 50, ms: 5, usd: 0.1,
        json: {
          escenas: [{ inicio: marca(a), fin: marca(b), titulo: `Escena ${a}`, personas: [`Extra ${a}`], accion: 'Hablan.' }],
          planos: [{ inicio: marca(a), fin: marca(b), escala: 'plano medio', personas: [{ nombre: 'Diego', caja: [0, 0, 1000, 1000], instante: marca((a + b) / 2) }], objetos: [], descripcion: 'Diego.' }],
          sonidos: [], dialogos: [], reparto: [{ nombre: 'Diego', descripcionVisual: `Visto en ${a}` }],
        },
      };
    },
  };
}

const opcionesBase = {
  documento: 'd1', duracion: 1000, medio: 'video' as const, lente: 'cine' as const,
  unidades: [{ texto: '**Diego:** Me encanta la fresa.', t0: 10, t1: 12 }],
};

describe('percibirMedio', () => {
  it('ve la obra por ventanas, funde y cuenta el coste', async () => {
    const vidente = videnteFalso();
    const trabajo = trabajoEnMemoria();
    const progresos: number[] = [];
    let subidas = 0;
    const r = await percibirMedio({ vidente, trabajo, fuente: async () => { subidas++; return { uri: 'files/1', mime: 'video/mp4' }; }, alProgreso: (p) => { progresos.push(p.hechas); } }, opcionesBase);
    expect(vidente.llamadas.map((l) => [l.desde, l.hasta])).toEqual([[0, 480], [450, 1000]]);
    expect(vidente.llamadas[1]!.texto).toContain('Visto en 0');
    expect(vidente.llamadas[0]!.texto).toContain('Me encanta la fresa.');
    expect(subidas).toBe(1);
    expect(r.escenas.length).toBe(2);
    expect(r.escenas[0]!.planos.length).toBe(1);
    expect(r.escenas.at(-1)!.t1).toBe(1000);
    expect(r.reparto.map((p) => p.nombre)).toEqual(['Diego']);
    expect(r.coste).toMatchObject({ llamadas: 2, grabadas: 0, tokensEntrada: 200 });
    expect(r.coste.usd).toBeCloseTo(0.2);
    expect(r.modelo).toBe('modelo-x');
    expect(progresos).toEqual([1, 2]);
    expect(trabajo.datos.size).toBe(2);
  });

  it('es idempotente: la segunda vez no llama al modelo ni sube nada', async () => {
    const trabajo = trabajoEnMemoria();
    await percibirMedio({ vidente: videnteFalso(), trabajo, fuente: async () => ({ uri: 'f', mime: 'video/mp4' }) }, opcionesBase);
    const otra = videnteFalso();
    let subidas = 0;
    const r = await percibirMedio({ vidente: otra, trabajo, fuente: async () => { subidas++; return { uri: 'f', mime: 'video/mp4' }; } }, opcionesBase);
    expect(otra.llamadas.length).toBe(0);
    expect(subidas).toBe(0);
    expect(r.coste).toMatchObject({ llamadas: 0, grabadas: 2, usd: 0 });
    expect(r.escenas.length).toBe(2);
  });

  it('reanuda: solo repite la ventana que falló', async () => {
    const trabajo = trabajoEnMemoria();
    const r1 = await percibirMedio({ vidente: videnteFalso({ fallar: (p) => (p.desde === 450 ? 'HTTP 500' : null) }), trabajo, fuente: async () => ({ uri: 'f', mime: 'video/mp4' }) }, opcionesBase);
    expect(r1.avisos.some((a) => a.includes('450-1000'))).toBe(true);
    const v = videnteFalso();
    const r2 = await percibirMedio({ vidente: v, trabajo, fuente: async () => ({ uri: 'f', mime: 'video/mp4' }) }, opcionesBase);
    expect(v.llamadas.map((l) => l.desde)).toEqual([450]);
    expect(r2.coste.grabadas).toBe(1);
  });

  it('parte la ventana cuya salida no cabe', async () => {
    const v = videnteFalso({ fallar: (p) => (p.desde === 450 && p.hasta === 1000 ? 'MAX_TOKENS' : null) });
    const r = await percibirMedio({ vidente: v, trabajo: trabajoEnMemoria(), fuente: async () => ({ uri: 'f', mime: 'video/mp4' }) }, opcionesBase);
    expect(v.llamadas.map((l) => [l.desde, l.hasta])).toEqual([[0, 480], [450, 1000], [450, 740], [710, 1000]]);
    expect(r.ventanas.length).toBe(3);
    expect(r.avisos.some((a) => a.includes('se partió en dos'))).toBe(true);
  });

  it('vuelve a subir el fichero si el modelo dice que ya no existe', async () => {
    let n = 0;
    const v = videnteFalso({ fallar: (p) => (p.fuente.uri === 'viejo' ? 'HTTP 403 PERMISSION_DENIED' : null) });
    const fuentes: Array<boolean | undefined> = [];
    await percibirMedio({ vidente: v, trabajo: trabajoEnMemoria(), fuente: async (o) => { fuentes.push(o?.renovar); return { uri: n++ === 0 ? 'viejo' : 'nuevo', mime: 'video/mp4' }; } }, { ...opcionesBase, duracion: 300 });
    expect(fuentes).toEqual([undefined, true]);
    expect(v.llamadas.map((l) => l.fuente.uri)).toEqual(['viejo', 'nuevo']);
  });

  it('se detiene al llegar al presupuesto y deja lo hecho grabado', async () => {
    const trabajo = trabajoEnMemoria();
    await expect(percibirMedio({ vidente: videnteFalso(), trabajo, fuente: async () => ({ uri: 'f', mime: 'video/mp4' }) }, { ...opcionesBase, duracion: 2000, presupuestoUsd: 0.05, concurrencia: 1 })).rejects.toBeInstanceOf(ErrorPresupuesto);
    expect(trabajo.datos.size).toBe(1);
  });

  it('marca quién habla en cada ventana y da los intérpretes sin papel aparte', async () => {
    const v = videnteFalso();
    await percibirMedio({ vidente: v, trabajo: trabajoEnMemoria(), fuente: async () => ({ uri: 'f', mime: 'video/mp4' }) }, {
      ...opcionesBase, unidades: [{ texto: '**Diego:** Me encanta la fresa.', t0: 10, t1: 12 }, { texto: '**Nancy:** Ay, Diego.', t0: 700, t1: 702 }],
      reparto: [{ nombre: 'Jorge Perugorría', actor: 'Jorge Perugorría' }, { nombre: 'David', ficticia: true, actor: 'Vladimir Cruz' }],
    });
    expect(v.llamadas[0]!.texto).toContain('- Diego (habla en este fragmento)');
    expect(v.llamadas[0]!.texto).toContain('- Nancy\n');
    expect(v.llamadas[0]!.texto).toContain('- David: personaje; interpretado por Vladimir Cruz');
    expect(v.llamadas[0]!.texto).toContain('Intérpretes de la obra (sin papel asignado): Jorge Perugorría.');
    expect(v.llamadas[0]!.texto).not.toContain('- Jorge Perugorría');
    expect(v.llamadas[1]!.texto).toContain('- Nancy (habla en este fragmento)');
  });

  it('lleva al personaje a quien el modelo nombra por su actor', async () => {
    const v: Vidente = {
      nombre: 'falso:m', async mirar(p) {
        const a = p.desde ?? 0, b = p.hasta ?? 0;
        return { texto: '', modelo: 'm', tokensEntrada: 1, tokensSalida: 1, ms: 1, json: {
          escenas: [{ inicio: marca(a), fin: marca(b), titulo: 'E', personas: [a === 0 ? 'Diego' : 'Jorge Perugorría'], accion: '' }],
          planos: [], sonidos: [], dialogos: [], reparto: a === 0 ? [{ nombre: 'Diego', actor: 'Jorge Perugorría' }] : [],
        } };
      },
    };
    const r = await percibirMedio({ vidente: v, trabajo: trabajoEnMemoria(), fuente: async () => ({ uri: 'f', mime: 'video/mp4' }) }, opcionesBase);
    expect(r.escenas.flatMap((e) => e.personas)).toEqual(['Diego']);
    expect(r.reparto).toEqual([{ nombre: 'Diego', actor: 'Jorge Perugorría' }]);
  });

  it('en audio no pide planos', async () => {
    const v = videnteFalso();
    await percibirMedio({ vidente: v, trabajo: trabajoEnMemoria(), fuente: async () => ({ uri: 'f', mime: 'audio/mp4' }) }, { ...opcionesBase, medio: 'audio', lente: 'podcast', duracion: 300 });
    expect(Object.keys((v.llamadas[0]!.esquema as { properties: object }).properties)).toEqual(['escenas', 'sonidos', 'dialogos', 'reparto']);
    expect(v.llamadas[0]!.sistema).toContain('No hay imagen');
  });
});

// ---------------------------------------------------------------------------
// fuenteGemini
// ---------------------------------------------------------------------------

function almacenFalso(proxy: Uint8Array | null, etag = 'e1') {
  const datos = new Map<string, Uint8Array>();
  const leidos: Array<[number, number]> = [];
  return {
    datos, leidos, etag,
    async cabecera(c: string) { return c.endsWith('proxy.mp4') && proxy ? { bytes: proxy.length, tipo: 'video/mp4', etag: this.etag } : null; },
    async rango(_c: string, desde: number, hasta: number) { leidos.push([desde, hasta]); return proxy!.slice(desde, hasta + 1); },
    async bytes(c: string) { return datos.get(c) ?? null; },
    async poner(c: string, t: string) { datos.set(c, new TextEncoder().encode(t)); },
  };
}

function ficherosFalsos(): PuertoFicheros & { subidas: number; estados: Map<string, FicheroRemoto | null> } {
  const estados = new Map<string, FicheroRemoto | null>();
  const f = {
    subidas: 0, estados,
    async subirArchivoPorTrozos(o: { bytes: number; mime: string; leer(d: number, h: number): Promise<Uint8Array> }) {
      f.subidas++;
      const trozos = [];
      for (let d = 0; d < o.bytes; d += 4) trozos.push(await o.leer(d, Math.min(o.bytes, d + 4)));
      const nombre = `files/${f.subidas}`;
      const a: FicheroRemoto = { nombre, uri: `https://g/${nombre}`, mime: o.mime, estado: 'PROCESSING', bytes: trozos.reduce((n, t) => n + t.length, 0) };
      estados.set(nombre, { ...a, estado: 'ACTIVE', expira: new Date(Date.parse('2026-11-06T12:00:00Z')).toISOString() });
      return a;
    },
    async archivo(nombre: string) { return estados.get(nombre) ?? null; },
  };
  return f;
}

describe('fuenteGemini', () => {
  const reloj = () => Date.parse('2026-11-04T12:00:00Z');
  const esperar = async () => {};

  it('sube el proxy por trozos, espera a ACTIVE y guarda la caché', async () => {
    const almacen = almacenFalso(new Uint8Array(10).map((_, i) => i));
    const ficheros = ficherosFalsos();
    const f = await fuenteGemini({ almacen, ficheros, reloj, esperar }, { prefijo: 'u/a/d/b/' });
    expect(f).toMatchObject({ uri: 'https://g/files/1', mime: 'video/mp4', nombre: 'files/1' });
    expect(almacen.leidos).toEqual([[0, 3], [4, 7], [8, 9]]);
    const cache = JSON.parse(new TextDecoder().decode(almacen.datos.get('u/a/d/b/proxy.gemini.json')!));
    expect(cache).toMatchObject({ uri: 'https://g/files/1', bytes: 10, etag: 'e1', expira: '2026-11-06T12:00:00.000Z' });
  });

  it('reaprovecha el fichero mientras viva y lo vuelve a subir si caduca, cambia o desaparece', async () => {
    const almacen = almacenFalso(new Uint8Array(10));
    const ficheros = ficherosFalsos();
    await fuenteGemini({ almacen, ficheros, reloj, esperar }, { prefijo: 'p/' });
    await fuenteGemini({ almacen, ficheros, reloj, esperar }, { prefijo: 'p/' });
    expect(ficheros.subidas).toBe(1);
    // A menos de 6 h de caducar.
    await fuenteGemini({ almacen, ficheros, reloj: () => Date.parse('2026-11-06T08:00:00Z'), esperar }, { prefijo: 'p/' });
    expect(ficheros.subidas).toBe(2);
    // El proxy cambió.
    almacen.etag = 'e2';
    await fuenteGemini({ almacen, ficheros, reloj, esperar }, { prefijo: 'p/' });
    expect(ficheros.subidas).toBe(3);
    // El servidor ya no lo tiene.
    ficheros.estados.set('files/3', null);
    await fuenteGemini({ almacen, ficheros, reloj, esperar }, { prefijo: 'p/' });
    expect(ficheros.subidas).toBe(4);
    await fuenteGemini({ almacen, ficheros, reloj, esperar }, { prefijo: 'p/', renovar: true });
    expect(ficheros.subidas).toBe(5);
  });

  it('sin proxy, un error claro', async () => {
    await expect(fuenteGemini({ almacen: almacenFalso(null), ficheros: ficherosFalsos(), reloj, esperar }, { prefijo: 'p/' })).rejects.toBeInstanceOf(ErrorSinProxy);
  });
});
