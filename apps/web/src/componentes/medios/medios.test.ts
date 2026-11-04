import { describe, expect, it } from 'vitest';
import { porcentajeCubierto } from './revision';
import { estadosDelLote } from './biblioteca';
import { porComprender } from '../comprension/biblioteca';
import { huecosDeRevision } from '../../datos/medios';

describe('la transcripción revisada y el trabajo de la biblioteca', () => {
  it('el porcentaje cubierto de lo que suena', () => {
    expect(porcentajeCubierto({ activo: 2400, cubierto: 2300 })).toBe(96);
    expect(porcentajeCubierto({ activo: 0, cubierto: 0 })).toBeNull();
    expect(porcentajeCubierto(undefined)).toBeNull();
    expect(porcentajeCubierto({ activo: 100, cubierto: 130 })).toBe(100);
  });

  it('los huecos que quedan: los de después de aplicar, si los hay', () => {
    const antes = { activo: 1, cubierto: 1, huecos: 2, segundosSinTexto: 0, palabrasRotas: 0, lista: [{ t0: 1, t1: 2, motivo: 'sin_texto' as const, activo: 1 }, { t0: 5, t1: 6, motivo: 'sin_texto' as const, activo: 1 }] };
    const despues = { ...antes, huecos: 1, lista: [antes.lista[1]!] };
    expect(huecosDeRevision({ documento: 'd', aplicada: 'x', tarea: null, avisosDocumento: [], cobertura: { antes, despues } })).toHaveLength(1);
    expect(huecosDeRevision({ documento: 'd', aplicada: null, tarea: null, avisosDocumento: [], cobertura: { antes } })).toHaveLength(2);
    expect(huecosDeRevision(null)).toEqual([]);
  });

  it('cada medio del lote: en cola, trabajando o hecho', () => {
    const lote = { documentos: [{ documento: 'a', titulo: 'A' }, { documento: 'b', titulo: 'B' }, { documento: 'c', titulo: 'C' }], lanzado: '' };
    expect(estadosDelLote(lote, new Set(['b']), new Set(['a', 'b'])).map((x) => x.estado)).toEqual(['hecho', 'trabajando', 'cola']);
  });

  it('lo que falta por comprender: listo y ni hecho ni en marcha', () => {
    const d = (id: string, estado: 'listo' | 'procesando') => ({ id, estado, tipo: 'pdf' as const, titulo: id, autores: '', unidades: 3, bytes: 1, creado: '', actualizado: '', bibliotecas: [] });
    expect(porComprender([d('a', 'listo'), d('b', 'listo'), d('c', 'procesando')], new Set(['a'])).map((x) => x.id)).toEqual(['b']);
  });
});
