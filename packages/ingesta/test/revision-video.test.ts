import { describe, expect, it } from 'vitest';
import type { Transcriptor } from '@scholaris/nucleo';
import { instantesDePalabras } from '@scholaris/spdf';
import {
  aplicarCorrecciones, hablantesDeDialogos, coberturaTranscripcion, frasesUbicadas, marca, palabrasDeUnidad, palabrasDeUnidades, revisarHablantesVentana, revisarTranscripcionConVideo,
  subventanasDe, transcribirConVideo, Unificador, ventana,
  type AlmacenTrabajo, type CorreccionTranscripcion, type Mirada, type PeticionMirar, type UnidadMedio, type Vidente,
} from '../src/index.js';

/** Una unidad con palabras de 0,4 s cada 0,5 s desde `t0`. */
function unidad(orden: number, texto: string, t0: number, rotas = false): UnidadMedio {
  const n = texto.replace(/\*\*[^*]+:\*\*/g, ' ').split(/\s+/).filter(Boolean).length;
  const cs = Array.from({ length: n }, (_, i) => (rotas ? [0, 1] : [i * 50, 40])).flat();
  return { orden, texto, t0, t1: t0 + (rotas ? 0.01 : n * 0.5), palabras: { v: 1, t0, cs } };
}

function trabajoEnMemoria(): AlmacenTrabajo & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return { datos, async leer(c) { return datos.get(c) ?? null; }, async escribir(c, t) { datos.set(c, t); } };
}

function videnteFalso(responder: (p: PeticionMirar) => unknown): Vidente & { llamadas: PeticionMirar[] } {
  const llamadas: PeticionMirar[] = [];
  return {
    nombre: 'falso:modelo-r', llamadas,
    async mirar(p): Promise<Mirada> {
      llamadas.push(p);
      const json = responder(p);
      if (json instanceof Error) throw json;
      return { texto: JSON.stringify(json), json, modelo: p.modelo ?? 'modelo-r', fin: 'STOP', tokensEntrada: 10, tokensSalida: 5, ms: 1, usd: 0.01 };
    },
  };
}

describe('palabras y frases', () => {
  const u = unidad(3, '**Diego:** Me encanta la fresa. ¿Y a ti?\n\n**David:** Lejos.', 100);

  it('las palabras llevan su hablante, su índice y su instante', () => {
    const ws = palabrasDeUnidad(u, 3);
    expect(ws.map((w) => [w.i, w.texto, w.hablante])).toEqual([[0, 'Me', 'Diego'], [1, 'encanta', 'Diego'], [2, 'la', 'Diego'], [3, 'fresa.', 'Diego'], [4, '¿Y', 'Diego'], [5, 'a', 'Diego'], [6, 'ti?', 'Diego'], [7, 'Lejos.', 'David']]);
    expect(ws[7]).toMatchObject({ unidad: 3, t0: 103.5, t1: 103.9 });
  });

  it('las frases se cortan en fin de frase, en cambio de hablante y de unidad', () => {
    const fs = frasesUbicadas(palabrasDeUnidades([u, unidad(4, 'Sin marcas aquí', 110)]));
    expect(fs.map((f) => [f.unidad, f.palabras, f.hablante ?? null, f.texto])).toEqual([
      [3, [0, 4], 'Diego', 'Me encanta la fresa.'], [3, [4, 7], 'Diego', '¿Y a ti?'], [3, [7, 8], 'David', 'Lejos.'], [4, [0, 3], null, 'Sin marcas aquí'],
    ]);
  });
});

describe('cobertura', () => {
  const us = [unidad(0, 'uno dos tres cuatro', 10), unidad(1, 'cinco seis', 60), unidad(2, 'siete ocho nueve', 80, true)];

  it('con actividad: lo que suena sin palabras; y las unidades con el tiempo roto', () => {
    const c = coberturaTranscripcion(us, { duracion: 100, actividad: [[10, 13], [20, 40], [60, 61.5], [79, 82]] });
    expect(c.huecos.filter((h) => h.motivo === 'sin_texto').map((h) => [h.t0, h.t1])).toEqual([[20, 40], [79, 82]]);
    expect(c.huecos.find((h) => h.motivo === 'tiempos_rotos')).toMatchObject({ t0: 80 });
    expect(c.palabrasRotas).toBe(3);
    expect(c.activo).toBe(27.5);
  });

  it('sin actividad: solo los silencios de transcripción largos', () => {
    const c = coberturaTranscripcion(us.slice(0, 2), { duracion: 100 });
    expect(c.huecos.map((h) => [h.t0, h.t1])).toEqual([[13.1, 58.8], [62.1, 100]]);
  });

  it('subventanas: junta lo cercano y parte lo largo', () => {
    expect(subventanasDe([{ t0: 10, t1: 20 }, { t0: 25, t1: 30 }, { t0: 100, t1: 260 }], 300, 75)).toEqual([
      { t0: 8, t1: 32 }, { t0: 98, t1: 152.67 }, { t0: 152.67, t1: 207.33 }, { t0: 207.33, t1: 262 },
    ]);
  });
});

describe('transcribir viendo el proxy', () => {
  it('pide el tramo con marcas absolutas y desplaza las que vengan desde el inicio del tramo', async () => {
    const v = videnteFalso(() => ({ segmentos: [{ inicio: '0:00:01', fin: '0:00:03', hablante: 'Germán', enCuadro: true, texto: 'Son mías.' }, { inicio: '0:00:04', texto: '' }] }));
    const r = await transcribirConVideo(v, { uri: 'f', mime: 'video/mp4' }, { t0: 3900, t1: 3960 }, { reparto: [{ nombre: 'Germán' }], contexto: '[1:04:55] Diego: …' });
    expect(v.llamadas[0]).toMatchObject({ desde: 3900, hasta: 3960 });
    expect(v.llamadas[0]!.texto).toContain('entre 1:05:00.0 y 1:06:00.0');
    expect(r.segmentos).toEqual([{ t0: 3901, t1: 3903, hablante: 'Germán', enCuadro: true, texto: 'Son mías.' }]);
  });
});

describe('hablantes por ventanas', () => {
  it('propone el hablante que se ve y el desfase de una frase mal colocada', async () => {
    const us = [unidad(0, '**Diego:** Las esculturas son mías. **David:** Germán.', 3900), unidad(1, '**Vivian:** ¿No había otro lugar?', 1)];
    const frases = frasesUbicadas(palabrasDeUnidades(us));
    const v = videnteFalso(() => ({ frases: [
      { n: 0, hablante: 'Germán', enCuadro: 'si' }, { n: 1, hablante: 'Diego', enCuadro: 'no' },
      { n: 2, hablante: 'Vivian', enCuadro: 'si', inicio: '0:01:40.3' },
    ] }));
    const r = await revisarHablantesVentana(v, { uri: 'f', mime: 'video/mp4' }, ventana(0, 4000, 0, 4000), frases, { reparto: [], unificador: new Unificador([{ nombre: 'Germán' }]), documento: 'd1' });
    expect(v.llamadas[0]!.texto).toContain(`[2] ${marca(1)} Vivian: ¿No había otro lugar?`);
    expect(r.correcciones).toEqual<CorreccionTranscripcion[]>([
      { tipo: 'hablante', unidad: 0, palabras: [0, 4], t0: 3900, t1: 3901.9, texto: 'Las esculturas son mías.', de: 'Diego', a: 'Germán', enCuadro: true, confianza: 0.9, fuente: 'modelo-r', evidencia: { documento: 'd1', ancla: { tipo: 'tiempo', t0: 3900, t1: 3901.9, hablante: 'Germán' }, cita: 'Las esculturas son mías.', modo: 'video' } },
      { tipo: 'hablante', unidad: 0, palabras: [4, 5], t0: 3902, t1: 3902.4, texto: 'Germán.', de: 'David', a: 'Diego', enCuadro: false, confianza: 0.7, fuente: 'modelo-r', evidencia: { documento: 'd1', ancla: { tipo: 'tiempo', t0: 3902, t1: 3902.4, hablante: 'Diego' }, cita: 'Germán.', modo: 'video' } },
      { tipo: 'desfase', unidad: 1, palabras: [0, 4], texto: '¿No había otro lugar?', de: 1, a: 100.3, confianza: 0.7, fuente: 'modelo-r' },
    ]);
  });
});

describe('revisión entera', () => {
  const us = [unidad(0, '**Diego:** Vamos a buscar los libros.', 10), unidad(1, '**David:** No.', 300)];
  const opciones = { documento: 'd1', duracion: 400, unidades: us, actividad: [[10, 13], [100, 130], [300, 301]] as Array<[number, number]>, prefijoTrabajo: 'r/' };

  const responder = (p: PeticionMirar) => (p.esquema.properties as Record<string, unknown>).segmentos
    ? { segmentos: p.desde! < 130 && p.hasta! > 100 ? [{ inicio: marca(110), fin: marca(112), hablante: 'Nancy', texto: 'Ay, Diego, qué bonito.' }, { inicio: marca(11), fin: marca(12), texto: 'Vamos a buscar los libros.' }] : [] }
    : { frases: [{ n: 0, hablante: 'Diego', enCuadro: 'si' }, { n: 1, hablante: 'Diego', enCuadro: 'si' }] };

  it('rellena los huecos, corrige hablantes y no repite lo grabado', async () => {
    const trabajo = trabajoEnMemoria();
    const v = videnteFalso(responder);
    const r = await revisarTranscripcionConVideo({ vidente: v, fuente: async () => ({ uri: 'f', mime: 'video/mp4' }), trabajo }, opciones);
    expect(r.cobertura.huecos.map((h) => [h.t0, h.t1])).toEqual([[100, 130]]);
    expect(r.correcciones.map((c) => c.tipo)).toEqual(['hueco', 'hablante']);
    expect(r.correcciones[0]).toMatchObject({ tipo: 'hueco', segmentos: [{ t0: 110, t1: 112, hablante: 'Nancy', texto: 'Ay, Diego, qué bonito.' }] });
    expect(r.correcciones[1]).toMatchObject({ tipo: 'hablante', unidad: 1, de: 'David', a: 'Diego' });
    expect(r.coste.llamadas).toBe(2);
    const otra = videnteFalso(responder);
    const r2 = await revisarTranscripcionConVideo({ vidente: otra, fuente: async () => ({ uri: 'f', mime: 'video/mp4' }), trabajo }, opciones);
    expect(otra.llamadas.length).toBe(0);
    expect(r2.correcciones).toEqual(r.correcciones);
  });

  it('si el modelo falla en un hueco, entra la reserva con el audio del tramo', async () => {
    const v = videnteFalso((p) => ((p.esquema.properties as Record<string, unknown>).segmentos ? new Error('HTTP 500') : { frases: [] }));
    const pedidos: Array<[number, number]> = [];
    const transcriptor: Transcriptor = { nombre: 'whisper', async transcribir(a) { return { texto: 'hola', palabras: [{ texto: 'Hola,', t0: (a.desplazamiento ?? 0) + 10, t1: (a.desplazamiento ?? 0) + 10.4 }, { texto: 'Nancy.', t0: (a.desplazamiento ?? 0) + 10.5, t1: (a.desplazamiento ?? 0) + 11 }] }; } };
    const r = await revisarTranscripcionConVideo({
      vidente: v, fuente: async () => ({ uri: 'f', mime: 'video/mp4' }), trabajo: trabajoEnMemoria(),
      reserva: { transcriptor, async audio(t0, t1) { pedidos.push([t0, t1]); return { bytes: new Uint8Array([1]), mime: 'audio/wav', desplazamiento: t0 }; } },
    }, opciones);
    expect(pedidos).toEqual([[98, 132]]);
    expect(r.correcciones[0]).toMatchObject({ tipo: 'hueco', fuente: 'whisper', confianza: 0.75, segmentos: [{ t0: 108, t1: 109, texto: 'Hola, Nancy.' }] });
  });
});

describe('aplicarCorrecciones', () => {
  const us = [unidad(0, '**Vivian:** ¿No había otro lugar?', 1), unidad(1, '**Diego:** Las esculturas son mías. **David:** Germán.', 3900), unidad(2, 'a b c', 4000, true)];

  it('cambia marcas, mueve desfases, añade huecos, sustituye las rotas y no duplica', () => {
    const cs: CorreccionTranscripcion[] = [
      { tipo: 'hablante', unidad: 1, palabras: [0, 4], t0: 3900, t1: 3902, texto: '', de: 'Diego', a: 'Germán', confianza: 0.9, fuente: 'm' },
      { tipo: 'hablante', unidad: 1, palabras: [4, 5], t0: 3902, t1: 3902.4, texto: '', de: 'David', a: 'Diego', confianza: 0.7, fuente: 'm' },
      { tipo: 'desfase', unidad: 0, palabras: [0, 4], texto: '', de: 1, a: 100.3, confianza: 0.7, fuente: 'm' },
      // Lo mismo que ya está tras mover el desfase: no se añade otra vez.
      { tipo: 'hueco', t0: 98, t1: 120, segmentos: [{ t0: 100.4, t1: 101.5, hablante: 'Vivian', texto: '¿Y no había otro lugar?' }, { t0: 110, t1: 112, hablante: 'Nancy', texto: 'Ay, Diego.' }], fuente: 'm', confianza: 0.85 },
      { tipo: 'hueco', t0: 4000, t1: 4010, segmentos: [{ t0: 4001, t1: 4003, hablante: 'Nancy', texto: 'Hola otra vez.' }], reemplaza: [2], fuente: 'm', confianza: 0.8 },
      { tipo: 'hablante', unidad: 0, palabras: [0, 4], t0: 1, t1: 2, texto: '', de: 'Vivian', a: 'Nadie', confianza: 0.5, fuente: 'm' },
    ];
    const r = aplicarCorrecciones(us, cs);
    expect(r.map((u) => [u.orden, u.t0, u.texto])).toEqual([
      [0, 100.3, '**Vivian:** ¿No había otro lugar?'],
      [1, 110, '**Nancy:** Ay, Diego.'],
      [2, 3900, '**Germán:** Las esculturas son mías.\n\n**Diego:** Germán.'],
      [3, 4001, '**Nancy:** Hola otra vez.'],
    ]);
    expect(instantesDePalabras(r[0]!.palabras!)[0]).toEqual([100.3, 100.7]);
    expect(r[2]!.hablante).toBe('Diego');
  });

  it('sin correcciones, las unidades salen tal cual', () => {
    expect(aplicarCorrecciones(us, [])).toEqual(us);
  });
});

describe('hablantes de las frases clave', () => {
  it('toma el hablante de la transcripción revisada, casando por tiempo y texto', () => {
    const us = [unidad(0, '**Germán:** Las esculturas son mías, ¿oíste? **Diego:** Germán.', 3893)];
    const p = {
      documento: 'd', modelo: 'm', version: 'v', duracion: 4000, avisos: [], reparto: [{ nombre: 'Germán' }, { nombre: 'Diego' }],
      escenas: [{ t0: 3800, t1: 3950, titulo: 'E', personas: [], accion: '', sonido: [], planos: [], dialogoClave: [
        { t: 3893.5, hablante: 'Diego', texto: '¡Las esculturas son mías, ¿oíste?' }, { t: 3896, hablante: 'Diego', texto: 'Germán.' }, { t: 3920, hablante: 'Nancy', texto: 'Otra cosa distinta.' },
      ] }],
    };
    const r = hablantesDeDialogos(p, us);
    expect(r.cambios).toBe(1);
    expect(r.percepcion.escenas[0]!.dialogoClave.map((d) => d.hablante)).toEqual(['Germán', 'Diego', 'Nancy']);
  });
});
