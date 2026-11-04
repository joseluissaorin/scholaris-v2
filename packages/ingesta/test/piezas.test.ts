import { describe, expect, it } from 'vitest';
import { escribirOggOpus, leerOgg } from '@scholaris/imprenta';
import type { Transcriptor } from '@scholaris/nucleo';
import { MIME_YOUTUBE, muestrasPaqueteOpus, partirAudio, recortarAudio, recortarOggOpus, recortarWav } from '../src/pasos/piezas.js';
import { transcribirTramo } from '../src/pasos/medios.js';

/** Un Ogg/Opus falso de `segundos` s: paquetes CELT de 20 ms (TOC 0xF8) con su número dentro. */
function oggDe(segundos: number): Uint8Array {
  const n = Math.round(segundos * 50);
  const paquetes = Array.from({ length: n }, (_, i) => Uint8Array.from([0xf8, i & 0xff, (i >> 8) & 0xff, (i >> 16) & 0xff]));
  return escribirOggOpus(paquetes, paquetes.map(() => 960), { muestreo: 16000 });
}

/** Segundos de audio de un Ogg/Opus por sus paquetes. */
function duracionOgg(b: Uint8Array): number {
  return leerOgg(b).slice(2).reduce((s, p) => s + muestrasPaqueteOpus(p), 0) / 48000;
}

/** El número del primer paquete de audio (para saber dónde empieza el recorte). */
const primerPaquete = (b: Uint8Array) => { const p = leerOgg(b)[2]!; return p[1]! | (p[2]! << 8) | (p[3]! << 16); };

function wavDe(segundos: number, muestreo = 16000): Uint8Array {
  const n = segundos * muestreo;
  const out = new Uint8Array(44 + n * 2);
  const v = new DataView(out.buffer);
  const poner = (o: number, s: string) => { for (let k = 0; k < 4; k++) out[o + k] = s.charCodeAt(k); };
  poner(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); poner(8, 'WAVE'); poner(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, muestreo, true); v.setUint32(28, muestreo * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  poner(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, i % 30000, true);
  return out;
}

describe('muestrasPaqueteOpus', () => {
  it('lee la duración del byte TOC', () => {
    expect(muestrasPaqueteOpus(Uint8Array.from([0xf8]))).toBe(960); // CELT 20 ms, una trama
    expect(muestrasPaqueteOpus(Uint8Array.from([0x08]))).toBe(960); // SILK 20 ms
    expect(muestrasPaqueteOpus(Uint8Array.from([0x18]))).toBe(2880); // SILK 60 ms
    expect(muestrasPaqueteOpus(Uint8Array.from([0xf9]))).toBe(1920); // dos tramas de 20 ms
    expect(muestrasPaqueteOpus(Uint8Array.from([0xfb, 0x03]))).toBe(2880); // código 3: tres tramas
  });
});

describe('recortes sin decodificar', () => {
  it('recorta un Ogg/Opus en límites de paquete, con uno de más al principio para asentarse', () => {
    const ogg = oggDe(60);
    const r = recortarOggOpus(ogg, 10, 20)!;
    expect(r.inicio).toBeCloseTo(9.98, 2);
    expect(r.fin).toBeCloseTo(20, 2);
    expect(duracionOgg(r.bytes)).toBeCloseTo(10.02, 2);
    expect(primerPaquete(r.bytes)).toBe(499);
  });
  it('recorta un WAV y conserva su formato', () => {
    const r = recortarWav(wavDe(10), 2, 5)!;
    expect(r.inicio).toBe(2);
    expect(r.fin).toBe(5);
    expect(r.bytes.length).toBe(44 + 3 * 16000 * 2);
    expect(new DataView(r.bytes.buffer).getInt16(44, true)).toBe(32000 % 30000);
  });
  it('un tramo de YouTube se recorta en su JSON', () => {
    const audio = { bytes: new TextEncoder().encode(JSON.stringify({ url: 'https://youtu.be/x', t0: 600, t1: 1200 })), mime: MIME_YOUTUBE };
    const r = recortarAudio(audio, 600, 700, 760)!;
    expect(JSON.parse(new TextDecoder().decode(r.bytes))).toEqual({ url: 'https://youtu.be/x', t0: 700, t1: 760 });
    expect(r.desplazamiento).toBe(700);
  });
  it('lo que no sabe recortar devuelve null (el tramo va entero)', () => {
    expect(recortarAudio({ bytes: new Uint8Array(10), mime: 'audio/mpeg' }, 0, 10, 20)).toBeNull();
    expect(partirAudio({ bytes: new Uint8Array(1), mime: 'audio/ogg' }, { t0: 0, t1: 600 })).toBeNull();
  });
});

describe('partirAudio', () => {
  it('parte un tramo de 10 min en cuatro piezas con solape cuyos tramos propios lo cubren sin repetir', () => {
    const piezas = partirAudio({ bytes: oggDe(602), mime: 'audio/ogg' }, { t0: 598, t1: 1200 })!;
    expect(piezas).toHaveLength(4);
    for (let k = 0; k < piezas.length; k++) {
      const p = piezas[k]!;
      expect(duracionOgg(p.bytes)).toBeCloseTo(p.t1 - p.t0, 1);
      expect(p.t1 - p.t0).toBeLessThan(160);
      if (k) {
        // Solape de unos 5 s con la anterior y la frontera en su mitad.
        expect(piezas[k - 1]!.t1 - p.t0).toBeGreaterThan(4.9);
        expect(p.propioDesde).toBe(piezas[k - 1]!.propioHasta);
        expect(p.propioDesde).toBeGreaterThan(p.t0);
        expect(p.propioDesde).toBeLessThan(piezas[k - 1]!.t1);
      }
    }
    expect(piezas[0]!.t0).toBe(598);
    expect(piezas.at(-1)!.t1).toBeCloseTo(1200, 2);
  });
  it('un tramo corto no se parte', () => {
    expect(partirAudio({ bytes: oggDe(120), mime: 'audio/ogg' }, { t0: 0, t1: 120 })).toBeNull();
  });
});

describe('transcribirTramo por piezas', () => {
  it('transcribe cada pieza, casa los hablantes por el solape y no repite ni pierde palabras', async () => {
    const llamadas: Array<{ desplazamiento: number; segundos: number }> = [];
    // Un transcriptor que oye una palabra por segundo, con la etiqueta de su diarización (cada pieza numera a su manera).
    const asr: Transcriptor = {
      nombre: 'asr',
      async transcribir(a) {
        const d = a.desplazamiento ?? 0, segundos = duracionOgg(a.bytes);
        llamadas.push({ desplazamiento: d, segundos });
        const palabras = [];
        for (let t = Math.ceil(d); t + 0.5 <= d + segundos; t++) palabras.push({ texto: `w${t}`, t0: t, t1: t + 0.5, hablante: (t < 900) === (llamadas.length % 2 === 0) ? 'H0' : 'H1' });
        return { texto: '', palabras };
      },
    };
    const r = await transcribirTramo(
      { n: 2, t0: 598, t1: 1200, propioDesde: 600, propioHasta: 1200, parte: 'audio/0002.ogg' },
      { async parte() { return { bytes: oggDe(602), mime: 'audio/ogg' }; } },
      asr, { concurrenciaPiezas: 1 },
    );
    expect(llamadas).toHaveLength(4);
    expect(Math.max(...llamadas.map((l) => l.segundos))).toBeLessThan(160);
    const ts = r.palabras.map((p) => p.t0);
    expect(ts).toEqual(Array.from({ length: 600 }, (_, i) => 600 + i));
    expect(r.solape?.map((p) => p.t0)).toEqual([598, 599]);
    // Las etiquetas de cada pieza se casan con las de la anterior: a un lado y a otro de 900 s, una sola voz.
    expect(new Set(r.palabras.filter((p) => p.t0 < 900).map((p) => p.hablante)).size).toBe(1);
    expect(new Set(r.palabras.filter((p) => p.t0 >= 900).map((p) => p.hablante)).size).toBe(1);
    expect(r.procedencia.detalle).toMatchObject({ piezas: 4 });
  });
  it('con pieza 0, el tramo va entero', async () => {
    let n = 0;
    const asr: Transcriptor = { nombre: 'asr', async transcribir() { n++; return { texto: '', palabras: [{ texto: 'hola', t0: 700, t1: 700.5 }] }; } };
    await transcribirTramo({ n: 2, t0: 598, t1: 1200, propioDesde: 600, propioHasta: 1200, parte: 'a' }, { async parte() { return { bytes: oggDe(602), mime: 'audio/ogg' }; } }, asr, { pieza: 0 });
    expect(n).toBe(1);
  });
});
