/**
 * Los ids de las fichas no cabían en Vectorize (64 bytes con el espacio de nombres delante) y el
 * índice rechazaba todos sus vectores en silencio: la búsqueda semántica de la comprensión nunca
 * los tuvo. Se acortan de forma reversible; lo que aun así no quepa se dice.
 */
import { describe, expect, it } from 'vitest';
import { crearIndiceVectorize, espacioNombresDe, idDeVectorize, idParaVectorize, MAX_ID_VECTORIZE } from '../src/cloudflare/indice-vectorize';

const ns = espacioNombresDe('user_39IzzKr3u2jVRpZCOZ5kf4iByAD');
const bytes = (t: string) => new TextEncoder().encode(t).length;

describe('ids en Vectorize', () => {
  it('las fichas caben y se recuperan tal cual', () => {
    for (const id of [
      'dmv6mc53t1f8j0mno:fi:dmv6mc53t1f8j0mno:sg82:narrativa',
      'dmw21xnomjseg07mi:fi:dmw21xnomjseg07mi:pl123:plano',
      'dmw21xnomjseg07mi:fi:global:cine',
      'dmw21xnomjseg07mi:fi:ent:e1234567890abcdef',
    ]) {
      const v = idParaVectorize(ns, id);
      expect(bytes(v)).toBeLessThanOrEqual(MAX_ID_VECTORIZE);
      expect(idDeVectorize(ns, v)).toBe(id);
    }
  });

  it('los ids de siempre (fragmentos, unidades) no cambian', () => {
    expect(idParaVectorize(ns, 'dmw21xnomjseg07mi:c1h4slrb')).toBe(`${ns}.dmw21xnomjseg07mi:c1h4slrb`);
    expect(idDeVectorize(ns, `${ns}.dmw21xnomjseg07mi:u12`)).toBe('dmw21xnomjseg07mi:u12');
  });

  it('un id que aun así no cabe no se manda en silencio: falla con su motivo', async () => {
    const enviados: unknown[] = [];
    const falso = { upsert: async (v: unknown[]) => { enviados.push(...v); return { mutationId: 'x' }; } } as unknown as VectorizeIndex;
    const indice = crearIndiceVectorize(falso, { id: 'e@4', proveedor: 'p', modelo: 'm', dims: 4, normalizado: true, modalidades: ['texto'] });
    await expect(indice.insertar(ns, [{ id: `doc:${'x'.repeat(80)}`, valores: new Float32Array(4), metadatos: {} }])).rejects.toThrow(/no caben en Vectorize/);
    expect(enviados).toHaveLength(0);
    await indice.insertar(ns, [{ id: 'dmv6mc53t1f8j0mno:fi:dmv6mc53t1f8j0mno:sg82:narrativa', valores: new Float32Array(4), metadatos: {} }]);
    expect((enviados[0] as { id: string }).id).toBe(`${ns}.dmv6mc53t1f8j0mno:fi:~:sg82:narrativa`);
  });
});
