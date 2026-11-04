import { describe, expect, it } from 'vitest';
import type { AlmacenAmpliado } from '../src/puertos.js';
import { asegurarProxy, guardarPorTrozos, proxyRemoto, type HacerProxy } from '../src/compartido/proxy.js';
import { codificarTrama, leerTramas } from '../src/compartido/tramas.js';

/** Un flujo con estos bytes. */
const flujoDe = (xs: Uint8Array[]) => new Blob(xs as never).stream();

/** Un almacén en memoria con subidas por partes. */
function almacenFalso() {
  const datos = new Map<string, { bytes: Uint8Array; tipo?: string }>();
  const subidas = new Map<string, { clave: string; partes: Map<number, Uint8Array>; tipo?: string }>();
  const registro: string[] = [];
  let n = 0;
  const a = {
    datos, subidas, registro,
    async poner(clave: string, cuerpo: Uint8Array | string, tipo?: string) {
      registro.push(`poner ${clave}`);
      datos.set(clave, { bytes: typeof cuerpo === 'string' ? new TextEncoder().encode(cuerpo) : cuerpo, ...(tipo ? { tipo } : {}) });
    },
    async bytes(clave: string) { return datos.get(clave)?.bytes ?? null; },
    async cabecera(clave: string) { const d = datos.get(clave); return d ? { bytes: d.bytes.length, ...(d.tipo ? { tipo: d.tipo } : {}) } : null; },
    async obtener(clave: string) { const d = datos.get(clave); return d ? { cuerpo: flujoDe([d.bytes]), meta: { clave, bytes: d.bytes.length } } : null; },
    async subidaDirecta(clave: string, op: { tipo?: string }) { const id = `s${++n}`; subidas.set(id, { clave, partes: new Map(), ...(op.tipo ? { tipo: op.tipo } : {}) }); registro.push(`abrir ${clave}`); return { modo: 'partes', clave, idSubida: id }; },
    async ponerParte(_c: string, id: string, numero: number, cuerpo: Uint8Array) { subidas.get(id)!.partes.set(numero, cuerpo); registro.push(`parte ${numero}`); return `e${numero}`; },
    async completarPartes(clave: string, id: string, partes: Array<{ numero: number }>) {
      const s = subidas.get(id)!;
      const trozos = partes.map((p) => s.partes.get(p.numero)!);
      const total = new Uint8Array(trozos.reduce((t, x) => t + x.length, 0));
      let o = 0;
      for (const t of trozos) { total.set(t, o); o += t.length; }
      datos.set(clave, { bytes: total, ...(s.tipo ? { tipo: s.tipo } : {}) });
      registro.push(`completar ${clave}`);
    },
    async abortarPartes(_c: string, id: string) { subidas.delete(id); registro.push('abortar'); },
  };
  return a;
}

async function* trozos(...xs: number[][]) { for (const x of xs) yield new Uint8Array(x); }

describe('guardarPorTrozos', () => {
  it('un solo trozo va de una vez; varios, por partes en orden', async () => {
    const a = almacenFalso();
    expect(await guardarPorTrozos(a as unknown as AlmacenAmpliado, 'p/uno', 'video/mp4', trozos([1, 2]))).toBe(2);
    expect(a.registro).toEqual(['poner p/uno']);
    expect(await guardarPorTrozos(a as unknown as AlmacenAmpliado, 'p/proxy.mp4', 'video/mp4', trozos([1, 2], [3], [4, 5]))).toBe(5);
    expect([...a.datos.get('p/proxy.mp4')!.bytes]).toEqual([1, 2, 3, 4, 5]);
    expect(a.registro.slice(1)).toEqual(['abrir p/proxy.mp4', 'parte 1', 'parte 2', 'parte 3', 'completar p/proxy.mp4']);
  });

  it('si un trozo falla, aborta la subida', async () => {
    const a = almacenFalso();
    async function* rotos() { yield new Uint8Array([1]); yield new Uint8Array([2]); throw new Error('corte'); }
    await expect(guardarPorTrozos(a as unknown as AlmacenAmpliado, 'p/x', 'video/mp4', rotos())).rejects.toThrow('corte');
    expect(a.registro.at(-1)).toBe('abortar');
    expect(a.datos.has('p/x')).toBe(false);
  });
});

describe('proxy del conversor remoto', () => {
  const archivo = { nombre: 'peli.mp4', mime: 'video/mp4', tipo: 'video', bytes: 3, leer: async () => new Uint8Array([9]), flujo: async () => new Blob(['xyz']).stream() };

  it('guarda los cortes y el proxy por partes según llegan las tramas', async () => {
    const a = almacenFalso();
    let pedida = '';
    const hacer = proxyRemoto(async (r) => {
      pedida = r.url;
      return new Response(flujoDe([
        codificarTrama({ tipo: 'parte', id: 'proxy.cortes.json', mime: 'application/json' }, new TextEncoder().encode(JSON.stringify({ cortes: [1.5, 8], umbral: 0.3 }))),
        codificarTrama({ tipo: 'trozo', id: 'proxy.mp4', mime: 'video/mp4', desde: 0, total: 4 }, new Uint8Array([1, 2])),
        codificarTrama({ tipo: 'trozo', id: 'proxy.mp4', mime: 'video/mp4', desde: 2, total: 4 }, new Uint8Array([3, 4])),
        codificarTrama({ tipo: 'fin', bytes: 4 }),
      ]));
    });
    const r = await hacer(archivo, 'video', { almacen: a as unknown as AlmacenAmpliado, prefijo: 'u/x/d/y/' });
    expect(pedida).toContain('/proxy?tipo=video');
    expect(r).toEqual({ clave: 'u/x/d/y/proxy.mp4', bytes: 4, mime: 'video/mp4', cortes: 2 });
    expect([...a.datos.get('u/x/d/y/proxy.mp4')!.bytes]).toEqual([1, 2, 3, 4]);
    expect(JSON.parse(new TextDecoder().decode(a.datos.get('u/x/d/y/proxy.cortes.json')!.bytes)).cortes).toEqual([1.5, 8]);
  });

  it('un error del conversor o un proxy incompleto no dejan nada a medias', async () => {
    const a = almacenFalso();
    const conError = proxyRemoto(async () => new Response(flujoDe([codificarTrama({ tipo: 'trozo', id: 'proxy.mp4' }, new Uint8Array([1])), codificarTrama({ tipo: 'trozo', id: 'proxy.mp4' }, new Uint8Array([1])), codificarTrama({ tipo: 'error', mensaje: 'ffmpeg' })])));
    await expect(conError(archivo, 'video', { almacen: a as unknown as AlmacenAmpliado, prefijo: 'p/' })).rejects.toThrow('ffmpeg');
    expect(a.datos.has('p/proxy.mp4')).toBe(false);
    const incompleto = proxyRemoto(async () => new Response(flujoDe([codificarTrama({ tipo: 'trozo', id: 'proxy.mp4' }, new Uint8Array([1])), codificarTrama({ tipo: 'fin', bytes: 9 })])));
    await expect(incompleto(archivo, 'video', { almacen: a as unknown as AlmacenAmpliado, prefijo: 'q/' })).rejects.toThrow('incompleto');
    const mal = proxyRemoto(async () => new Response('no', { status: 500 }));
    await expect(mal(archivo, 'video', { almacen: a as unknown as AlmacenAmpliado, prefijo: 'r/' })).rejects.toThrow('500');
  });

  it('leerTramas junta tramas grandes que llegan en muchos pedazos', async () => {
    const grande = new Uint8Array(300_000).map((_, i) => i % 251);
    const t = codificarTrama({ tipo: 'trozo', id: 'proxy.mp4' }, grande);
    const flujo = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < t.length; i += 1000) c.enqueue(t.slice(i, i + 1000)); c.close(); } });
    const vistas: Uint8Array[] = [];
    for await (const { datos } of leerTramas(flujo)) vistas.push(datos);
    expect(vistas.length).toBe(1);
    expect(vistas[0]!.length).toBe(300_000);
    expect(vistas[0]![299_999]).toBe(299_999 % 251);
  });
});

describe('asegurarProxy', () => {
  it('no rehace un proxy que ya existe, lo hace si falta y nada si no es un medio', async () => {
    const a = almacenFalso();
    await a.poner('p/original.mp4', new Uint8Array([1, 2, 3]), 'video/mp4');
    const llamadas: string[] = [];
    const hacerProxy: HacerProxy = async (archivo, tipo, { almacen, prefijo }) => {
      llamadas.push(`${tipo}:${archivo.nombre}:${archivo.bytes}`);
      await almacen.poner(`${prefijo}proxy.mp4`, new Uint8Array([7]), 'video/mp4');
      return { clave: `${prefijo}proxy.mp4`, bytes: 1, mime: 'video/mp4', cortes: 0 };
    };
    const ctx = { almacen: a as unknown as AlmacenAmpliado, hacerProxy };
    const doc = { prefijo: 'p/', original: 'p/original.mp4', mime: 'video/mp4', tipo: 'video', nombre: 'peli.mp4' };
    expect(await asegurarProxy(ctx, doc)).toMatchObject({ bytes: 1 });
    expect(await asegurarProxy(ctx, doc)).toMatchObject({ existia: true });
    expect(llamadas).toEqual(['video:peli.mp4:3']);
    await asegurarProxy(ctx, doc, { forzar: true });
    expect(llamadas.length).toBe(2);
    expect(await asegurarProxy(ctx, { ...doc, tipo: 'pdf' })).toBeNull();
    expect(await asegurarProxy({ almacen: ctx.almacen }, { ...doc, prefijo: 'otro/' })).toBeNull();
  });
});
