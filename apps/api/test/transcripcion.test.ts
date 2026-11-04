/**
 * La transcripción completa de los medios en la plataforma: el Workflow de
 * ingesta la completa antes de consolidar (paso «transcripcion»), y una revisión
 * se aplica a un medio que ya existe (POST /documentos/:id/transcripcion/revisar,
 * fase «transcripcion» del Workflow), con la inteligencia falsa de las pruebas.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { importJWK, SignJWT } from 'jose';
import { escribirOggOpus } from '@scholaris/imprenta';
import type { PaqueteConversion } from '@scholaris/imprenta';
import type { RevisionTranscripcion } from '@scholaris/ingesta';
import { JWK_PRIVADA } from './clave-prueba.js';
import type { AlmacenAmpliado } from '../src/puertos.js';
import { puertosRevision } from '../src/compartido/transcripcion.js';
import { estimarMedio, preciosHora } from '../src/compartido/medios-existentes.js';

const BASE = 'https://scholaris.prueba/api/v2';

async function token(sub: string, extra: Record<string, unknown> = {}): Promise<string> {
  const clave = await importJWK(JWK_PRIVADA, 'RS256');
  return new SignJWT({ email: `${sub}@prueba.es`, name: sub, ...extra })
    .setProtectedHeader({ alg: 'RS256', kid: 'prueba' })
    .setSubject(sub).setIssuer('https://clerk.prueba').setIssuedAt().setExpirationTime('10m')
    .sign(clave);
}

async function api(ruta: string, o: { token?: string; metodo?: string; cuerpo?: unknown } = {}) {
  const h: Record<string, string> = {};
  if (o.token) h.authorization = `Bearer ${o.token}`;
  let body: BodyInit | undefined;
  if (o.cuerpo !== undefined) { body = JSON.stringify(o.cuerpo); h['content-type'] = 'application/json'; }
  const r = await SELF.fetch(ruta.startsWith('http') ? ruta : `${BASE}${ruta}`, { method: o.metodo ?? (o.cuerpo !== undefined ? 'POST' : 'GET'), headers: h, body });
  const tipo = r.headers.get('content-type') ?? '';
  return { estado: r.status, cuerpo: (tipo.includes('json') ? await r.json() : await r.text()) as any };
}

async function esperarTarea(t: string, tarea: string, ms = 50_000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const r = await api(`/tareas/${tarea}`, { token: t });
    if (r.cuerpo.estado === 'listo' || r.cuerpo.estado === 'error') return r.cuerpo;
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error('La tarea no terminó a tiempo');
}

/** Habla de A en [desde, hasta): una palabra cada 0,5 s y frases de diez. */
function habla(desde: number, hasta: number, prefijo: string, hablante: string) {
  const ws: Array<{ texto: string; t0: number; t1: number; hablante: string }> = [];
  let k = 0;
  for (let t = desde; t + 0.4 <= hasta; t += 0.5, k++) ws.push({ texto: `${prefijo}${k}${k % 10 === 9 ? '.' : ''}`, t0: t, t1: t + 0.4, hablante });
  return ws;
}

function paqueteAudio(duracion: number): PaqueteConversion {
  return {
    version: 1, tipo: 'audio', origen: { nombre: 'entrevista.ogg', mime: 'audio/ogg', bytes: 100, huella: 'h-entrevista' },
    metadatos: { titulo: 'Entrevista de prueba' }, unidades: 1, duracion,
    contenido: { clase: 'medio', duracion, audio: { muestreo: 16000, canales: 1, formato: 'opus', mime: 'audio/ogg', tramos: [{ n: 1, t0: 0, t1: duracion, propioDesde: 0, propioHasta: duracion, parte: 'audio/0001.ogg' }] }, video: null },
    partes: [{ id: 'audio/0001.ogg', clase: 'audio', mime: 'audio/ogg', bytes: 100, unidad: 1, t0: 0, t1: duracion }],
    reserva: null, avisos: [], entorno: 'navegador', tiempos: {},
  } as unknown as PaqueteConversion;
}

/** Sube un audio con su paquete e ingiere; devuelve el documento ya listo. */
async function subirAudio(t: string, audio: unknown): Promise<string> {
  const original = new TextEncoder().encode('OggS-falso');
  const s = await api('/subidas', { token: t, cuerpo: { nombre: 'entrevista.ogg', mime: 'audio/ogg', bytes: original.byteLength } });
  await SELF.fetch(s.cuerpo.original.url, { method: 'PUT', body: original, headers: s.cuerpo.original.cabeceras });
  const rec = await api(`/subidas/${s.cuerpo.subida}/recursos`, { token: t, cuerpo: { recursos: [{ ruta: 'paquete.json', mime: 'application/json' }, { ruta: 'audio/0001.ogg', mime: 'audio/ogg' }] } });
  await SELF.fetch(rec.cuerpo.recursos[0].subida.url, { method: 'PUT', body: JSON.stringify(paqueteAudio(180)), headers: { 'content-type': 'application/json' } });
  await SELF.fetch(rec.cuerpo.recursos[1].subida.url, { method: 'PUT', body: JSON.stringify(audio), headers: { 'content-type': 'audio/ogg' } });
  const ing = await api(`/subidas/${s.cuerpo.subida}/ingestar`, { token: t, cuerpo: { paquete: 'paquete.json' } });
  expect(ing.estado).toBe(202);
  const fin = await esperarTarea(t, ing.cuerpo.tarea);
  expect(fin.estado).toBe('listo');
  return ing.cuerpo.documento as string;
}

const textoDe = async (t: string, id: string) => ((await api(`/documentos/${id}/unidades?desde=0&hasta=99`, { token: t })).cuerpo as Array<{ texto: string }>).map((u) => u.texto).join(' ');

describe('transcripción completa de los medios', () => {
  it('la ingesta rellena antes de consolidar lo que el transcriptor se saltó, y una revisión de fuera se aplica después', async () => {
    const t = await token('user_transcripcion', { fea: 'u:scholaris' });
    // El transcriptor se salta de 60 a 120 s; lo oye a la segunda (la reserva de la revisión, con el audio del tramo).
    const audio = { palabras: [...habla(0, 60, 'a', 'H0'), ...habla(120, 180, 'b', 'H1')], ocultas: habla(62, 118, 'oculta', 'H5') };
    const id = await subirAudio(t, audio);
    const texto = await textoDe(t, id);
    expect(texto).toContain('a0');
    expect(texto).toContain('b0');
    expect(texto).toContain('oculta10');

    // La revisión quedó guardada y marcada como aplicada (ya está en las unidades).
    const rev = await api(`/documentos/${id}/transcripcion/revision`, { token: t });
    expect(rev.estado).toBe(200);
    expect(rev.cuerpo.aplicada).toBeTruthy();
    expect(rev.cuerpo.correcciones.huecos).toBeGreaterThan(0);
    expect(rev.cuerpo.cobertura.despues.segundosSinTexto).toBeLessThan(rev.cuerpo.cobertura.antes.segundosSinTexto);
    // Aplicarla otra vez no hace nada.
    const otra = await api(`/documentos/${id}/transcripcion/revisar`, { token: t, cuerpo: {} });
    expect(otra.estado).toBe(202);
    await esperarTarea(t, otra.cuerpo.tarea);
    expect(await textoDe(t, id)).toBe(texto);

    // Una revisión hecha fuera (la de la percepción): quién dice la primera frase.
    const unidades = (await api(`/documentos/${id}/unidades?desde=0&hasta=0`, { token: t })).cuerpo as Array<{ texto: string }>;
    const primeras = unidades[0]!.texto.replace(/\*\*[^*]+:\*\*/g, ' ').split(/\s+/).filter(Boolean).slice(0, 10);
    const revision: RevisionTranscripcion = {
      documento: id, version: 'revision-1', modelo: 'externa', avisos: [],
      cobertura: { activo: 180, cubierto: 180, huecos: [], palabrasRotas: 0, palabras: 0 },
      coste: { usd: 0, llamadas: 0, tokensEntrada: 0, tokensSalida: 0, ms: 0, grabadas: 0 },
      correcciones: [{ tipo: 'hablante', unidad: 0, palabras: [0, 10], t0: 0, t1: 5, texto: primeras.join(' '), a: 'Nancy', confianza: 0.9, fuente: 'argon' }],
    };
    const sim = await api(`/documentos/${id}/transcripcion/revisar`, { token: t, cuerpo: { revision, simular: true } });
    expect(sim.estado).toBe(200);
    expect(sim.cuerpo.lanzada).toBe(false);
    const r = await api(`/documentos/${id}/transcripcion/revisar`, { token: t, cuerpo: { revision } });
    expect(r.estado).toBe(202);
    expect((await esperarTarea(t, r.cuerpo.tarea)).estado).toBe('listo');
    const despues = await textoDe(t, id);
    expect(despues).toContain('**Nancy:**');
    expect(despues).toContain('oculta10');
    const d = await api(`/documentos/${id}`, { token: t });
    expect(d.cuerpo.estado).toBe('listo');

    // Una revisión que no es de estas unidades no se aplica (y el documento sigue igual).
    const mala = { ...revision, correcciones: [{ ...revision.correcciones[0]!, texto: 'esto no lo dice nadie' }] };
    const m = await api(`/documentos/${id}/transcripcion/revisar`, { token: t, cuerpo: { revision: mala } });
    const tm = await esperarTarea(t, m.cuerpo.tarea);
    expect(tm.estado).toBe('listo');
    expect(await textoDe(t, id)).toBe(despues);

    // Errores claros.
    expect((await api('/documentos/no-existe/transcripcion/revisar', { token: t, cuerpo: {} })).estado).toBe(404);
    expect((await api(`/documentos/${id}/transcripcion/revisar`, { token: t, cuerpo: { revision: { correcciones: 'no' } } })).estado).toBe(400);

    // La biblioteca: sin «confirmar», solo la estimación.
    const est = await api('/transcripcion/revisar', { token: t, cuerpo: {} });
    expect(est.estado).toBe(200);
    expect(est.cuerpo.lanzada).toBe(false);
    const per = await api('/medios/percibir', { token: t, cuerpo: { documentos: [id] } });
    expect(per.estado).toBe(200);
    expect(per.cuerpo.documentos[0]).toMatchObject({ documento: id, hara: expect.arrayContaining(['proxy', 'percepcion']) });
    expect(per.cuerpo.usd).toBeGreaterThan(0);
    // Con «confirmar», se encola y sale la tarea (dos a la vez como mucho); al cerrar, el documento sigue listo.
    const lanz = await api('/transcripcion/revisar', { token: t, cuerpo: { confirmar: true, rehacer: true, documentos: [id] } });
    expect(lanz.estado).toBe(202);
    expect(lanz.cuerpo.lanzados).toHaveLength(1);
    expect((await esperarTarea(t, lanz.cuerpo.lanzados[0].tarea)).estado).toBe('listo');
    expect((await api(`/documentos/${id}`, { token: t })).cuerpo.estado).toBe('listo');
    // Un tope por debajo de la estimación no lanza nada.
    const caro = await api('/medios/percibir', { token: t, cuerpo: { confirmar: true, documentos: [id], presupuestoUsd: 0.01 } });
    expect(caro.estado).toBe(409);
  });
});

function almacenFalso() {
  const datos = new Map<string, { bytes: Uint8Array; tipo?: string }>();
  return {
    datos,
    async poner(clave: string, cuerpo: Uint8Array | string, tipo?: string) { datos.set(clave, { bytes: typeof cuerpo === 'string' ? new TextEncoder().encode(cuerpo) : cuerpo, ...(tipo ? { tipo } : {}) }); },
    async bytes(clave: string) { return datos.get(clave)?.bytes ?? null; },
    async cabecera(clave: string) { const d = datos.get(clave); return d ? { bytes: d.bytes.length, ...(d.tipo ? { tipo: d.tipo } : {}) } : null; },
    async existe(clave: string) { return datos.has(clave); },
  };
}

describe('puertos de la revisión', () => {
  it('sin proxy no mira; con él, sí; la reserva recorta el tramo al hueco; voz y reparto del almacén', async () => {
    const a = almacenFalso();
    const prefijo = 'u/x/d/d1/';
    const paquetes = Array.from({ length: 50 * 600 }, (_, i) => Uint8Array.from([0xf8, i & 0xff]));
    await a.poner(`${prefijo}audio/0001.ogg`, escribirOggOpus(paquetes, paquetes.map(() => 960)), 'audio/ogg');
    await a.poner(`${prefijo}proxy.voz.json`, JSON.stringify({ tramos: [[1, 5], [10, 20]], db: -35, duracion: 600 }));
    await a.poner(`${prefijo}percepcion.json`, JSON.stringify({ reparto: [{ nombre: 'Diego' }], escenas: [] }));
    const pedidos: Array<{ desplazamiento?: number; bytes: number }> = [];
    const transcriptor = { nombre: 't', async transcribir(x: { bytes: Uint8Array; desplazamiento?: number }) { pedidos.push({ bytes: x.bytes.length, desplazamiento: x.desplazamiento }); return { texto: '', palabras: [] }; } };
    const paquete = paqueteAudio(600);
    const sin = await puertosRevision({ almacen: a as unknown as AlmacenAmpliado, transcriptor }, { prefijo, paquete });
    expect(sin.conVideo).toBe(false);
    expect(sin.puertos.vidente).toBeUndefined();
    expect(sin.actividad).toEqual([[1, 5], [10, 20]]);
    expect(sin.reparto?.[0]?.nombre).toBe('Diego');
    const audio = await sin.puertos.reserva!.audio(300, 360);
    expect(audio!.desplazamiento).toBeGreaterThan(299);
    expect(audio!.desplazamiento).toBeLessThanOrEqual(300);
    expect(audio!.bytes.length).toBeLessThan(a.datos.get(`${prefijo}audio/0001.ogg`)!.bytes.length / 5);
    await a.poner(`${prefijo}proxy.mp4`, new Uint8Array(10), 'video/mp4');
    const con = await puertosRevision({ almacen: a as unknown as AlmacenAmpliado, gemini: { clave: 'k' }, transcriptor }, { prefijo, paquete });
    expect(con.conVideo).toBe(true);
    expect(con.puertos.vidente?.nombre).toContain('gemini');
  });

  it('la estimación dice qué haría y lo que cuesta (Argon dobla el 1-12-2026)', async () => {
    expect(preciosHora(Date.parse('2026-11-04')).percepcion).toBe(2.6);
    expect(preciosHora(Date.parse('2026-12-02')).percepcion).toBe(5.2);
    const a = almacenFalso();
    const sql = {
      async ejecutar(q: string) {
        if (/FROM documentos/.test(q)) return [{ id: 'd1', tipo: 'video', titulo: 'Película', estado: 'listo', huella: 'h', original: '', mime: 'video/mp4', bytes: 1, unidades: 1, creado: '', actualizado: '', bibliotecas: '[]', duracion: 7200, metadatos: JSON.stringify({ titulo: 'Película', autores: [] }) }];
        return [];
      },
    };
    const e = await estimarMedio({ almacen: a as unknown as AlmacenAmpliado, sql: sql as never }, { id: 'd1', prefijo: 'u/x/d/d1/' }, { percepcion: true, hablantes: true, ahora: Date.parse('2026-11-04') });
    expect(e!.hara).toEqual(['proxy', 'percepcion', 'huecos', 'hablantes', 'reescritura']);
    expect(e!.usd).toBeCloseTo(2 * (2.6 + 0.6 + 0.96), 1);
  });
});
