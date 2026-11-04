import { describe, expect, it } from 'vitest';
import { anclaACita } from '../src/citas-formato.js';

describe('anclaACita en audio y vídeo', () => {
  it('un tramo se cita entero, con su inicio y su final', () => {
    expect(anclaACita({ tipo: 'tiempo', t0: 724, t1: 760 })).toBe('12:04-12:40');
    expect(anclaACita({ tipo: 'tiempo', t0: 3723, t1: 3790.4 })).toBe('1:02:03-1:03:10');
  });
  it('un pasaje que cruza tramos acaba donde acaba el último', () => {
    expect(anclaACita({ tipo: 'tiempo', t0: 724, t1: 760 }, { tipo: 'tiempo', t0: 760, t1: 801 })).toBe('12:04-13:21');
  });
  it('un fotograma se cita con su segundo', () => {
    expect(anclaACita({ tipo: 'tiempo', t0: 1346, t1: 1346 })).toBe('22:26');
    expect(anclaACita({ tipo: 'tiempo', t0: 1346.2, t1: 1346.7 })).toBe('22:26');
  });
});
