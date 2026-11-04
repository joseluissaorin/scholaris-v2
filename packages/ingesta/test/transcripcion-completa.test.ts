import { describe, expect, it } from 'vitest';
import type { PaqueteConversion } from '@scholaris/imprenta';
import type { Embebedor, PalabraTranscrita, Transcriptor } from '@scholaris/nucleo';
import {
  completarTranscripcion, ejecutarIngesta, reescribirTranscripcion, unidadesDePalabras, palabrasTranscritas, aplicarCorrecciones, comprobarRevision,
  type AlmacenTrabajo, type CorreccionTranscripcion, type Mirada, type PeticionMirar, type PuertosRevision, type Vidente,
} from '../src/index.js';
import { baseReal, embebedorFalso, inteligenciaFalsa, redactorFalso } from './fakes.js';

const marca = (t: number) => `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** Habla seguida en [desde, hasta): una palabra cada 0,5 s y frases de diez palabras. */
function habla(desde: number, hasta: number, prefijo: string, hablante?: string): PalabraTranscrita[] {
  const ws: PalabraTranscrita[] = [];
  let k = 0;
  for (let t = desde; t + 0.4 <= hasta; t += 0.5, k++) ws.push({ texto: `${prefijo}${k}${k % 10 === 9 ? '.' : ''}`, t0: t, t1: t + 0.4, ...(hablante ? { hablante } : {}) });
  return ws;
}

function paqueteMedio(duracion: number): PaqueteConversion {
  return {
    version: 1, tipo: 'video', origen: { nombre: 'pelicula.mp4', mime: 'video/mp4', bytes: 1000, huella: 'h' },
    metadatos: { titulo: 'Película de prueba' }, unidades: 1, duracion,
    contenido: { clase: 'medio', duracion, audio: { muestreo: 16000, canales: 1, formato: 'opus', mime: 'audio/ogg', tramos: [{ n: 1, t0: 0, t1: duracion, propioDesde: 0, propioHasta: duracion, parte: 'audio/0001.ogg' }] }, video: null },
    partes: [], reserva: null, avisos: [], entorno: 'node', tiempos: {},
  } as PaqueteConversion;
}

function trabajoEnMemoria(): AlmacenTrabajo & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return { datos, async leer(c) { return datos.get(c) ?? null; }, async escribir(c, t) { datos.set(c, t); } };
}

/** Un modelo que, mirando el proxy, oye lo que se dice en [desde, hasta]: el «diálogo perdido» de 60 a 120 s. */
function videnteQueOye(): Vidente & { llamadas: PeticionMirar[] } {
  const llamadas: PeticionMirar[] = [];
  return {
    nombre: 'falso:flash', llamadas,
    async mirar(p): Promise<Mirada> {
      llamadas.push(p);
      const segmentos = [];
      for (let t = Math.max(60, Math.ceil(p.desde ?? 0)); t + 4 <= Math.min(120, p.hasta ?? 0); t += 5) segmentos.push({ inicio: marca(t), fin: marca(t + 4), hablante: 'Diego', texto: `perdida ${t} dicha.` });
      const json = { segmentos };
      return { texto: JSON.stringify(json), json, modelo: 'flash', fin: 'STOP', tokensEntrada: 100, tokensSalida: 50, ms: 1, usd: 0.012 };
    },
  };
}

/** El transcriptor de la ingesta: se salta el tramo de 60 a 120 s (lo que hacía con los trozos de 10 min). */
const asrConHueco: Transcriptor = {
  nombre: 'asr-con-hueco',
  async transcribir() { return { texto: '', palabras: [...habla(0, 60, 'a', 'H0'), ...habla(120, 180, 'b', 'H1')] }; },
};

describe('completar la transcripción antes de consolidar', () => {
  it('rellena el hueco que suena, consolida con él y deja la revisión aplicada', async () => {
    const { sql, filas } = await baseReal();
    const trabajo = trabajoEnMemoria();
    const vidente = videnteQueOye();
    let revision: Awaited<ReturnType<typeof completarTranscripcion>> | null = null;
    let llamadasPrimera = -1;
    const puertos: PuertosRevision = { vidente, fuente: async () => ({ uri: 'files/proxy', mime: 'video/mp4' }), trabajo };
    await ejecutarIngesta(paqueteMedio(180), {
      inteligencia: inteligenciaFalsa({ transcriptor: asrConHueco, redactor: redactorFalso(() => ({ titulo: 'Película de prueba', autores: [] })) }),
      fuente: { async parte() { return { bytes: new Uint8Array(1), mime: 'audio/ogg' }; } },
      sql,
    }, {
      documentoId: 'doc1', sinVerificacion: true, atribuirHablantes: false, revisarTranscripcion: false,
      antesDeConsolidar: async (ctx) => {
        revision = await completarTranscripcion(ctx, puertos, { duracion: 180, actividad: [[0, 180]] });
        // Un reintento del paso no vuelve a pagar nada: cada llamada quedó grabada.
        llamadasPrimera = vidente.llamadas.length;
        await completarTranscripcion(ctx, puertos, { duracion: 180, actividad: [[0, 180]] });
      },
    });
    expect(revision).not.toBeNull();
    const r = revision!;
    // Antes: 60 s con sonido y sin palabras. Después: cubierto.
    expect(r.revision.cobertura.huecos.some((h) => h.motivo === 'sin_texto' && h.t0 <= 62 && h.t1 >= 118)).toBe(true);
    expect(r.revision.coberturaFinal!.huecos.filter((h) => h.motivo === 'sin_texto').reduce((s, h) => s + h.activo, 0)).toBeLessThan(8);
    expect(r.revision.aplicada).toBeTruthy();
    expect(r.resumen).toMatchObject({ mapaVoz: true, conVideo: true, hablantesRevisados: false });
    expect(vidente.llamadas.length).toBeGreaterThan(0);
    expect(vidente.llamadas.every((l) => (l.hasta ?? 0) - (l.desde ?? 0) <= 75.01)).toBe(true);
    // La consolidación usó la transcripción completada: el diálogo perdido está en las unidades, en su sitio.
    const us = await filas<{ texto: string; t0: number; t1: number }>('SELECT texto, t0, t1 FROM unidades WHERE documento = ? ORDER BY orden', 'doc1');
    const todo = us.map((u) => u.texto).join(' ');
    expect(todo).toContain('perdida 60 dicha.');
    expect(todo).toContain('perdida 110 dicha.');
    expect(todo).toContain('a0');
    expect(todo).toContain('b0');
    const conPerdida = us.find((u) => u.texto.includes('perdida 90'))!;
    expect(conPerdida.t0).toBeLessThanOrEqual(90);
    expect(conPerdida.t1).toBeGreaterThanOrEqual(90);
    expect(vidente.llamadas.length).toBe(llamadasPrimera);
  });

  it('sin proxy, los huecos van a la reserva con el audio recortado y sin etiquetas de diarización', async () => {
    const { sql, filas } = await baseReal();
    const pedidos: Array<[number, number]> = [];
    const reserva: PuertosRevision['reserva'] = {
      transcriptor: { nombre: 'reserva', async transcribir(a) { return { texto: '', palabras: habla(a.desplazamiento ?? 0, (a.desplazamiento ?? 0) + 30, 'r', 'H7').filter((w) => w.t0 >= 60 && w.t1 <= 120) }; } },
      async audio(t0, t1) { pedidos.push([t0, t1]); return { bytes: new Uint8Array(1), mime: 'audio/ogg', desplazamiento: t0 }; },
      hablantes: true,
    };
    await ejecutarIngesta(paqueteMedio(180), {
      inteligencia: inteligenciaFalsa({ transcriptor: asrConHueco, redactor: redactorFalso(() => ({ titulo: 'Película de prueba', autores: [] })) }),
      fuente: { async parte() { return { bytes: new Uint8Array(1), mime: 'audio/ogg' }; } },
      sql,
    }, {
      documentoId: 'doc2', sinVerificacion: true, atribuirHablantes: false, revisarTranscripcion: false,
      antesDeConsolidar: (ctx) => completarTranscripcion(ctx, { trabajo: trabajoEnMemoria(), reserva }, { duracion: 180 }),
    });
    // Sin mapa de la voz, el hueco de 60 s se ve como silencio largo de la transcripción.
    expect(pedidos.length).toBeGreaterThan(0);
    expect(pedidos.every(([a, b]) => b - a <= 77.01)).toBe(true);
    const us = await filas<{ texto: string }>('SELECT texto FROM unidades WHERE documento = ? ORDER BY orden', 'doc2');
    const todo = us.map((u) => u.texto).join(' ');
    expect(todo).toMatch(/\br\d+/);
    expect(todo).not.toContain('H7');
  });
});

describe('reescribir la transcripción de un documento que ya existe', () => {
  it('rehace unidades y fragmentos, conserva lo que no cambia y solo vectoriza lo nuevo', async () => {
    const { sql, filas } = await baseReal();
    await ejecutarIngesta(paqueteMedio(180), {
      inteligencia: inteligenciaFalsa({ transcriptor: asrConHueco, redactor: redactorFalso(() => ({ titulo: 'Película de prueba', autores: [] })) }),
      fuente: { async parte() { return { bytes: new Uint8Array(1), mime: 'audio/ogg' }; } },
      sql,
    }, { documentoId: 'doc3', sinVerificacion: true, atribuirHablantes: false, revisarTranscripcion: false });
    const fragAntes = await filas<{ id: string; texto: string }>('SELECT id, texto FROM fragmentos WHERE documento = ? ORDER BY orden', 'doc3');
    const unidades = (await filas<{ orden: number; texto: string; t0: number; t1: number; palabras: string; ancla: string }>('SELECT orden, texto, t0, t1, palabras, ancla FROM unidades WHERE documento = ? ORDER BY orden', 'doc3'))
      .map((u) => ({ orden: Number(u.orden), texto: u.texto, t0: u.t0, t1: u.t1, palabras: JSON.parse(u.palabras), ...((JSON.parse(u.ancla) as { hablante?: string }).hablante ? { hablante: (JSON.parse(u.ancla) as { hablante: string }).hablante } : {}) }));
    // La revisión: lo que faltaba y quién dice la última frase del final.
    const ultima = unidades.at(-1)!;
    const ws = palabrasTranscritas([ultima]);
    const correcciones: CorreccionTranscripcion[] = [
      { tipo: 'hueco', t0: 60, t1: 120, segmentos: [{ t0: 61, t1: 64, hablante: 'Diego', texto: 'Esto se había perdido.' }, { t0: 90, t1: 93, hablante: 'David', texto: 'Y esto también.' }], fuente: 'flash', confianza: 0.85 },
      { tipo: 'hablante', unidad: ultima.orden, palabras: [ws.length - 10, ws.length], t0: 175, t1: 180, texto: ws.slice(-10).map((w) => w.texto).join(' '), de: 'H1', a: 'Nancy', confianza: 0.9, fuente: 'argon' },
    ];
    expect(comprobarRevision(unidades, { correcciones }).fraccion).toBe(1);
    const nuevas = palabrasTranscritas(aplicarCorrecciones(unidades, correcciones));
    let vectorizadas = 0;
    const embebedor: Embebedor = { ...embebedorFalso, async vectorizar(piezas, tarea) { vectorizadas += piezas.length; return embebedorFalso.vectorizar(piezas, tarea); } };
    const borrados: string[] = [];
    const r = await reescribirTranscripcion({
      sql, inteligencia: { embebedor, redactor: redactorFalso(() => ({ contextos: [] })) },
      indice: { async insertar() { /* nada */ }, async borrar(_e, ids) { borrados.push(...ids); } },
    }, 'doc3', nuevas, { detalle: { revision: 'prueba' } });
    const us = await filas<{ texto: string; orden: number; ancla: string }>('SELECT texto, orden, ancla FROM unidades WHERE documento = ? ORDER BY orden', 'doc3');
    const todo = us.map((u) => u.texto).join(' ');
    expect(todo).toContain('Esto se había perdido.');
    expect(todo).toContain('**Nancy:**');
    expect(us.map((u) => Number(u.orden))).toEqual(us.map((_, i) => i));
    const fragDespues = await filas<{ id: string; texto: string }>('SELECT id, texto FROM fragmentos WHERE documento = ? ORDER BY orden', 'doc3');
    expect(r.fragmentos.total).toBe(fragDespues.length);
    // Lo que no cambió conserva el id; lo nuevo, y solo lo nuevo, se vectoriza.
    const iguales = fragDespues.filter((f) => fragAntes.some((a) => a.id === f.id && a.texto === f.texto));
    expect(iguales.length).toBe(r.fragmentos.conservados);
    expect(r.fragmentos.conservados).toBeGreaterThan(0);
    expect(r.fragmentos.nuevos).toBeGreaterThan(0);
    expect(vectorizadas).toBe(r.fragmentos.nuevos);
    expect(borrados.length).toBe(r.fragmentos.borrados);
    const vs = await filas<{ id: string }>("SELECT id FROM vectores WHERE documento = ? AND objetivo = 'fragmento'", 'doc3');
    expect(new Set(vs.map((v) => v.id))).toEqual(new Set(fragDespues.map((f) => f.id)));
    const pr = await filas<{ detalle: string }>("SELECT detalle FROM procedencia WHERE documento = ? AND proveedor = 'transcripcion-revisada'", 'doc3');
    expect(pr).toHaveLength(1);
    expect(JSON.parse(pr[0]!.detalle)).toMatchObject({ revision: 'prueba' });
    // Volver a aplicarla con las mismas palabras no cambia nada ni vectoriza más.
    const antes = vectorizadas;
    const r2 = await reescribirTranscripcion({ sql, inteligencia: { embebedor, redactor: redactorFalso(() => ({})) } }, 'doc3', nuevas);
    expect(r2.fragmentos.nuevos).toBe(0);
    expect(vectorizadas).toBe(antes);
  });

  it('unidadesDePalabras corta como la consolidación', () => {
    const us = unidadesDePalabras([...habla(0, 100, 'x', 'A')]);
    expect(us.length).toBeGreaterThan(1);
    expect(us[0]).toMatchObject({ orden: 0, hablante: 'A' });
  });
});
