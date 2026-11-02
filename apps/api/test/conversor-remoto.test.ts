import { describe, expect, it } from 'vitest';
import { conversorRemoto, recortadorRemoto } from '../src/compartido/conversor-remoto.js';
import { codificarTrama, leerTramas } from '../src/compartido/tramas.js';

/** Un flujo que entrega las tramas y sigue abierto, como la respuesta del Container. */
function flujoAbierto(tramas: Uint8Array[]) {
  const estado = { cancelado: false };
  const flujo = new ReadableStream<Uint8Array>({
    start(c) { for (const t of tramas) c.enqueue(t); },
    cancel() { estado.cancelado = true; },
  });
  return { flujo, estado };
}

const archivo = { nombre: 'a.pdf', mime: 'application/pdf', flujo: async () => new Blob(['x']).stream() } as never;

describe('cliente del conversor: nunca deja la respuesta abierta', () => {
  it('cierra el flujo al recibir la trama fin', async () => {
    const { flujo, estado } = flujoAbierto([codificarTrama({ tipo: 'fin', paquete: { tipo: 'pdf' } })]);
    const paquete = await conversorRemoto(async () => new Response(flujo))(archivo, async () => undefined);
    expect(paquete).toEqual({ tipo: 'pdf' });
    expect(estado.cancelado).toBe(true);
  });

  it('cierra el flujo si el conversor informa de un error', async () => {
    const { flujo, estado } = flujoAbierto([codificarTrama({ tipo: 'error', mensaje: 'mal' })]);
    await expect(conversorRemoto(async () => new Response(flujo))(archivo, async () => undefined)).rejects.toThrow('mal');
    expect(estado.cancelado).toBe(true);
  });

  it('cierra el flujo si guardar una parte falla', async () => {
    const { flujo, estado } = flujoAbierto([codificarTrama({ tipo: 'parte', id: 'p', mime: 'image/jpeg' }, new Uint8Array([1]))]);
    await expect(conversorRemoto(async () => new Response(flujo))(archivo, async () => { throw new Error('R2'); })).rejects.toThrow('R2');
    expect(estado.cancelado).toBe(true);
  });

  it('cierra la respuesta de un estado de error, en la conversión y en el recorte', async () => {
    const conversion = flujoAbierto([]);
    await expect(conversorRemoto(async () => new Response(conversion.flujo, { status: 500 }))(archivo, async () => undefined)).rejects.toThrow('500');
    expect(conversion.estado.cancelado).toBe(true);
    const recorte = flujoAbierto([]);
    const r = await recortadorRemoto(async () => new Response(recorte.flujo, { status: 422 }))({ bytes: new Uint8Array([1]), mime: 'image/jpeg' }, { x: 0, y: 0, w: 1, h: 1 });
    expect(r).toBeNull();
    expect(recorte.estado.cancelado).toBe(true);
  });

  it('leerTramas sigue entregando todas las tramas de un flujo que termina', async () => {
    const flujo = new Blob([codificarTrama({ tipo: 'parte', id: 'a' }, new Uint8Array([7])), codificarTrama({ tipo: 'fin' })]).stream();
    const vistas: string[] = [];
    for await (const { cabecera } of leerTramas(flujo)) vistas.push(cabecera.tipo);
    expect(vistas).toEqual(['parte', 'fin']);
  });
});
