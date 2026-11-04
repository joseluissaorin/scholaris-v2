import { describe, expect, it } from 'vitest';
import type { Ancla, Redactor } from '@scholaris/nucleo';
import { anclarMaterial, buscarCita, cajasPrincipales, describirFiguras, esqueleto, regionPorLineas, regionPorVision, textoEn, type AlmacenTrabajo, type FiguraConAncla, type LineaPagina } from '../src/index.js';

const pagina: Ancla = { tipo: 'pagina', fisica: 3, impresa: '6', romana: false, origen: 'leido', confianza: 1 };

function cacheEnMemoria(): AlmacenTrabajo & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return { datos, async leer(c) { return datos.get(c) ?? null; }, async escribir(c, t) { datos.set(c, t); } };
}

function redactorCajas(json: unknown): Redactor & { llamadas: Array<Parameters<Redactor['generar']>[0]> } {
  const llamadas: Array<Parameters<Redactor['generar']>[0]> = [];
  return { nombre: 'falso', llamadas, async generar<T>(p: Parameters<Redactor['generar']>[0]) { llamadas.push(p); return { texto: JSON.stringify(json), json: json as T }; } };
}

describe('caracteres de una cita', () => {
  it('cuenta en puntos de código NFC (un emoji o una letra astral cuentan uno)', () => {
    const texto = 'Él dijo 𝔄 «me encanta la fresa» y se fue.';
    const r = buscarCita(texto, 'me encanta la fresa')!;
    expect(r.confianza).toBe(1);
    expect(textoEn(texto, r.caracteres)).toBe('me encanta la fresa');
    expect(r.caracteres[0]).toBe(Array.from('Él dijo 𝔄 «').length);
  });

  it('encuentra la cita sin mayúsculas, tildes, guiones de corte ni Markdown', () => {
    const texto = 'cualquier cálculo razo-\nnable aconsejaba dejar el **helado** y salir pitando';
    const r = buscarCita(texto, 'Cualquier calculo razonable aconsejaba dejar el helado')!;
    expect(r.confianza).toBe(0.95);
    expect(textoEn(texto, r.caracteres)).toBe('cualquier cálculo razo-\nnable aconsejaba dejar el **helado');
  });

  it('con erratas en medio, por el principio y el final; null si no está', () => {
    const texto = 'Pero en esa época ya yo no hacía cálculos razonables, como a veces nos pasa.';
    const r = buscarCita(texto, 'Pero en esa época ya yo no hacia calculos rasonables, como a veces nos pasa')!;
    expect(r.confianza).toBe(0.75);
    expect(textoEn(texto, r.caracteres)).toBe('Pero en esa época ya yo no hacía cálculos razonables, como a veces nos pasa');
    expect(buscarCita(texto, 'Lezama Lima y el barroco')).toBeNull();
  });

  it('el esqueleto lleva cada letra a su punto de código', () => {
    const e = esqueleto('Á-b c');
    expect(e).toEqual({ s: 'abc', pos: [0, 2, 4] });
  });
});

describe('región por la capa de texto', () => {
  const lineas: LineaPagina[] = [
    { texto: 'Primera línea del cuerpo que no', x: 0.1, y: 0.1, w: 0.8, h: 0.02 },
    { texto: 'importa. La cita empieza aquí y', x: 0.1, y: 0.13, w: 0.8, h: 0.02 },
    { texto: 'sigue en esta línea entera para', x: 0.1, y: 0.16, w: 0.8, h: 0.02 },
    { texto: 'acabar aquí. Y luego más texto.', x: 0.1, y: 0.19, w: 0.8, h: 0.02 },
  ];

  it('une las líneas que ocupa la cita y recorta la primera y la última', () => {
    const r = regionPorLineas(lineas, 'La cita empieza aquí y sigue en esta línea entera para acabar aquí.')!;
    expect(r.lineas).toEqual([1, 2, 3]);
    expect(r.region.y).toBeCloseTo(0.13);
    expect(r.region.y + r.region.h).toBeCloseTo(0.21);
    // La cita empieza a mitad de la segunda línea, pero la tercera es entera: la caja va de borde a borde.
    expect(r.region.x).toBeCloseTo(0.1);
    expect(r.region.w).toBeCloseTo(0.8);
  });

  it('en una sola línea, solo el trozo de la cita', () => {
    const r = regionPorLineas(lineas, 'La cita empieza aquí')!;
    expect(r.lineas).toEqual([1]);
    expect(r.region.x).toBeGreaterThan(0.3);
    expect(r.region.x + r.region.w).toBeCloseTo(0.868);
    expect(regionPorLineas(lineas, 'nada de esto')).toBeNull();
  });
});

describe('región por visión', () => {
  it('pide cajas al modelo, las une y las guarda en caché', async () => {
    const redactor = redactorCajas({ encontrada: true, cajas: [[100, 50, 130, 480], [130, 50, 160, 300]] });
    const cache = cacheEnMemoria();
    const p = { redactor, cache, imagen: async () => ({ bytes: new Uint8Array([1]), mime: 'image/jpeg' }) };
    const r = await regionPorVision(p, 'paginas/0003.jpg', 'me encanta la fresa');
    expect(r?.region).toEqual({ x: 0.05, y: 0.1, w: 0.43, h: 0.06 });
    expect(r?.cajas.length).toBe(2);
    expect(redactor.llamadas[0]!.calidad).toBe('alta');
    await regionPorVision(p, 'paginas/0003.jpg', 'me encanta la fresa');
    expect(redactor.llamadas.length).toBe(1);
    expect(cache.datos.size).toBe(1);
  });

  it('en un pliego, una cita que cruza de página se queda con la página donde está casi toda', async () => {
    // Las dos últimas líneas de la página izquierda y la primera de la derecha (box_2d: ymin, xmin, ymax, xmax).
    const redactor = redactorCajas({ encontrada: true, cajas: [[880, 60, 905, 470], [905, 60, 930, 470], [70, 530, 95, 760]] });
    const r = await regionPorVision({ redactor, imagen: async () => ({ bytes: new Uint8Array([1]), mime: 'image/jpeg' }) }, 'pliego.jpg', 'una cita que cruza');
    expect(r?.region).toEqual({ x: 0.06, y: 0.88, w: 0.41, h: 0.05 });
    expect(cajasPrincipales([{ x: 0.1, y: 0.1, w: 0.3, h: 0.02 }, { x: 0.1, y: 0.12, w: 0.35, h: 0.02 }])).toHaveLength(2);
  });

  it('si no la encuentra, null (y también se recuerda)', async () => {
    const redactor = redactorCajas({ encontrada: false, cajas: [] });
    const cache = cacheEnMemoria();
    const p = { redactor, cache, imagen: async () => ({ bytes: new Uint8Array([1]), mime: 'image/jpeg' }) };
    expect(await regionPorVision(p, 'x.jpg', 'algo')).toBeNull();
    expect(await regionPorVision(p, 'x.jpg', 'algo')).toBeNull();
    expect(redactor.llamadas.length).toBe(1);
  });
});

describe('anclarMaterial', () => {
  const texto = 'Pero en esa época ya yo no hacía cálculos razonables.';

  it('PDF digital: caracteres y región por la capa', async () => {
    const r = await anclarMaterial({ lineas: async () => [{ texto: 'Pero en esa época ya yo no hacía cálculos', x: 0.1, y: 0.5, w: 0.8, h: 0.02 }, { texto: 'razonables.', x: 0.1, y: 0.53, w: 0.2, h: 0.02 }] },
      { orden: 2, texto, ancla: pagina }, { cita: 'ya yo no hacía cálculos razonables' });
    expect(r.metodo).toBe('capa');
    expect(r.ancla).toMatchObject({ tipo: 'pagina', fisica: 3, caracteres: [18, 52] });
    expect(r.texto).toBe('ya yo no hacía cálculos razonables');
    expect(r.ancla.region?.y).toBeCloseTo(0.5);
  });

  it('escaneado: región por visión con la imagen de la unidad', async () => {
    const redactor = redactorCajas({ encontrada: true, cajas: [[500, 100, 520, 900]] });
    const r = await anclarMaterial({ lineas: async () => null, redactor, imagen: async () => ({ bytes: new Uint8Array([1]), mime: 'image/jpeg' }) },
      { orden: 2, texto, ancla: pagina, imagen: 'paginas/0003.jpg' }, { cita: 'cálculos razonables' });
    expect(r.metodo).toBe('vision');
    expect(r.ancla.region).toEqual({ x: 0.1, y: 0.5, w: 0.8, h: 0.02 });
    expect(r.ancla.caracteres).toEqual([33, 52]);
  });

  it('con caracteres dados y sin imagen, solo caracteres; en tiempo, nunca región', async () => {
    const r = await anclarMaterial({}, { orden: 2, texto, ancla: pagina }, { caracteres: [0, 4] });
    expect(r).toMatchObject({ metodo: 'ninguno', texto: 'Pero', ancla: { caracteres: [0, 4] } });
    const t = await anclarMaterial({}, { orden: 0, texto: 'Hola, David.', ancla: { tipo: 'tiempo', t0: 1, t1: 3 } }, { cita: 'David' });
    expect(t.ancla).toEqual({ tipo: 'tiempo', t0: 1, t1: 3, caracteres: [6, 11] });
  });
});

describe('descripción de fotogramas', () => {
  it('los fotogramas van aparte, con lenguaje de cine, la transcripción alrededor y calidad alta', async () => {
    const llamadas: Array<Parameters<Redactor['generar']>[0]> = [];
    const redactor: Redactor = {
      nombre: 'falso',
      async generar<T>(p: Parameters<Redactor['generar']>[0]) {
        llamadas.push(p);
        const n = p.mensajes[0]!.partes.filter((x) => 'bytes' in x).length;
        const json = { figuras: Array.from({ length: n }, (_, i) => ({ n: i + 1, descripcion: `Descripción ${i + 1}` })) };
        return { texto: JSON.stringify(json), json: json as T };
      },
    };
    const figuras: FiguraConAncla[] = [
      { id: 'f1', unidad: 0, fisica: 1, t: 600, parte: 'fotogramas/0001.jpg', ancla: { tipo: 'tiempo', t0: 600, t1: 600 } },
      { id: 'f2', unidad: 1, fisica: 2, parte: 'paginas/0002.jpg', ancla: pagina },
    ];
    const n = await describirFiguras(figuras, { parte: async (k) => ({ bytes: new TextEncoder().encode(k), mime: 'image/jpeg' }) }, redactor, {
      contexto: '«Fresa y chocolate»',
      unidades: [{ texto: '**Diego:** Me encanta la fresa.', t0: 590, t1: 592 }, { texto: '**David:** Lejos.', t0: 900, t1: 901 }],
    });
    expect(n).toBe(2);
    const cine = llamadas.find((l) => l.calidad === 'alta')!;
    const textos = cine.mensajes[0]!.partes.flatMap((x) => ('texto' in x ? [x.texto] : [])).join('\n');
    expect(cine.sistema).toContain('analista de cine');
    expect(textos).toContain('[0:09:50.0] Diego: Me encanta la fresa.');
    expect(textos).not.toContain('Lejos');
    expect(textos).toContain('Personas que hablan en la obra: Diego, David.');
    expect(llamadas.find((l) => l.calidad === 'rapida')!.sistema).toContain('documentos y vídeos');
    expect(figuras.map((f) => f.descripcion)).toEqual(['Descripción 1', 'Descripción 1']);
  });
});
