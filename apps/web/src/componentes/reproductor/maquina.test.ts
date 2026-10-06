import { describe, expect, it } from 'vitest';
import { estadoDe, INICIAL, MAX_INTENTOS, MEDIA_ERR, puntoDePartida, transicion, velocidadVecina, type Banderas, type Evento } from './maquina';

/** Aplica una serie de eventos y devuelve las banderas y las acciones pedidas. */
function correr(eventos: Evento[], desde: Banderas = INICIAL) {
  let b = desde;
  const acciones: unknown[] = [];
  for (const e of eventos) {
    const r = transicion(b, e);
    b = r.banderas;
    if (r.accion) acciones.push(r.accion);
  }
  return { b, estado: estadoDe(b), acciones };
}

describe('máquina del reproductor', () => {
  it('carga, queda lista y suena', () => {
    expect(correr([]).estado).toBe('vacio');
    expect(correr([{ tipo: 'cargar' }]).estado).toBe('cargando');
    expect(correr([{ tipo: 'cargar' }, { tipo: 'metadatos' }]).estado).toBe('listo');
    expect(correr([{ tipo: 'cargar' }, { tipo: 'metadatos' }, { tipo: 'pedirSonar' }]).estado).toBe('esperando');
    expect(correr([{ tipo: 'cargar' }, { tipo: 'metadatos' }, { tipo: 'pedirSonar' }, { tipo: 'avanza' }]).estado).toBe('sonando');
  });

  it('pedir sonar antes de los metadatos: suena en cuanto llegan', () => {
    const r = correr([{ tipo: 'cargar' }, { tipo: 'pedirSonar' }]);
    expect(r.estado).toBe('cargando');
    expect(r.b.quiere).toBe(true);
    expect(correr([{ tipo: 'metadatos' }, { tipo: 'datos' }, { tipo: 'avanza' }], r.b).estado).toBe('sonando');
  });

  it('esperar datos a mitad y retomar', () => {
    const sonando = correr([{ tipo: 'cargar' }, { tipo: 'metadatos' }, { tipo: 'pedirSonar' }, { tipo: 'avanza' }]).b;
    const r = correr([{ tipo: 'espera' }], sonando);
    expect(r.estado).toBe('esperando');
    expect(correr([{ tipo: 'datos' }, { tipo: 'avanza' }], r.b).estado).toBe('sonando');
  });

  it('un salto se ve como «buscando» y vuelve a lo que había', () => {
    const sonando = correr([{ tipo: 'cargar' }, { tipo: 'metadatos' }, { tipo: 'pedirSonar' }, { tipo: 'avanza' }]).b;
    expect(correr([{ tipo: 'buscar' }], sonando).estado).toBe('buscando');
    expect(correr([{ tipo: 'buscar' }, { tipo: 'buscado' }], sonando).estado).toBe('sonando');
    const pausado = correr([{ tipo: 'pedirPausa' }], sonando).b;
    expect(correr([{ tipo: 'buscar' }, { tipo: 'buscado' }], pausado).estado).toBe('listo');
  });

  it('al terminar queda «terminado» y reproducir vuelve a sonar', () => {
    const fin = correr([{ tipo: 'cargar' }, { tipo: 'metadatos' }, { tipo: 'pedirSonar' }, { tipo: 'avanza' }, { tipo: 'fin' }]);
    expect(fin.estado).toBe('terminado');
    expect(correr([{ tipo: 'pedirSonar' }], fin.b).estado).toBe('esperando');
  });

  it('un error de red a mitad renueva la URL enseguida y luego con espera creciente', () => {
    const sonando = correr([{ tipo: 'cargar' }, { tipo: 'metadatos' }, { tipo: 'pedirSonar' }, { tipo: 'avanza' }]).b;
    const r = correr([
      { tipo: 'error', codigo: MEDIA_ERR.RED }, { tipo: 'cargar' },
      { tipo: 'error', codigo: MEDIA_ERR.RED }, { tipo: 'cargar' },
      { tipo: 'error', codigo: MEDIA_ERR.RED },
    ], sonando);
    expect(r.acciones).toEqual([{ tipo: 'renovar', esperaMs: 0 }, { tipo: 'renovar', esperaMs: 500 }, { tipo: 'renovar', esperaMs: 1000 }]);
    // La intención de sonar sobrevive a las recargas.
    expect(r.b.quiere).toBe(true);
    expect(r.estado).toBe('cargando');
  });

  it('al volver a sonar se olvidan los reintentos', () => {
    const sonando = correr([{ tipo: 'cargar' }, { tipo: 'metadatos' }, { tipo: 'pedirSonar' }, { tipo: 'avanza' }]).b;
    const r = correr([{ tipo: 'error', codigo: MEDIA_ERR.RED }, { tipo: 'cargar' }, { tipo: 'metadatos' }, { tipo: 'avanza' }], sonando);
    expect(r.b.intentos).toBe(0);
    expect(r.estado).toBe('sonando');
  });

  it('se rinde tras los reintentos y «Reintentar» empieza de cero', () => {
    let b = correr([{ tipo: 'cargar' }, { tipo: 'metadatos' }, { tipo: 'pedirSonar' }, { tipo: 'avanza' }]).b;
    for (let i = 0; i < MAX_INTENTOS; i++) b = correr([{ tipo: 'error', codigo: MEDIA_ERR.RED }, { tipo: 'cargar' }], b).b;
    const r = correr([{ tipo: 'error', codigo: MEDIA_ERR.RED }], b);
    expect(r.estado).toBe('error');
    expect(r.b.error?.tipo).toBe('agotado');
    const otra = correr([{ tipo: 'reintentar' }], r.b);
    expect(otra.acciones).toEqual([{ tipo: 'renovar', esperaMs: 0 }]);
    expect(otra.b.intentos).toBe(0);
    expect(otra.b.error).toBeNull();
  });

  it('«no admitido» al abrir: primero se renueva (puede ser un 403 por caducidad) y luego es el formato', () => {
    const r1 = correr([{ tipo: 'cargar' }, { tipo: 'error', codigo: MEDIA_ERR.NO_ADMITIDO }]);
    expect(r1.acciones).toEqual([{ tipo: 'renovar', esperaMs: 0 }]);
    const r2 = correr([{ tipo: 'cargar' }, { tipo: 'error', codigo: MEDIA_ERR.NO_ADMITIDO }], r1.b);
    expect(r2.estado).toBe('error');
    expect(r2.b.error?.tipo).toBe('formato');
  });

  it('«no admitido» a mitad de reproducción no se confunde con el formato', () => {
    const sonando = correr([{ tipo: 'cargar' }, { tipo: 'metadatos' }, { tipo: 'pedirSonar' }, { tipo: 'avanza' }]).b;
    const r = correr([{ tipo: 'error', codigo: MEDIA_ERR.NO_ADMITIDO }, { tipo: 'cargar' }, { tipo: 'error', codigo: MEDIA_ERR.NO_ADMITIDO }], sonando);
    expect(r.b.error).toBeNull();
    expect(r.acciones).toHaveLength(2);
  });

  it('un atasco largo se trata como un corte de red; sin intención de sonar no hace nada', () => {
    const esperando = correr([{ tipo: 'cargar' }, { tipo: 'metadatos' }, { tipo: 'pedirSonar' }, { tipo: 'espera' }]).b;
    expect(correr([{ tipo: 'atasco' }], esperando).acciones).toEqual([{ tipo: 'renovar', esperaMs: 0 }]);
    const pausado = correr([{ tipo: 'cargar' }, { tipo: 'metadatos' }]).b;
    expect(correr([{ tipo: 'atasco' }], pausado).acciones).toEqual([]);
  });

  it('el aborto (cambio de fuente) no es un error', () => {
    const r = correr([{ tipo: 'cargar' }, { tipo: 'error', codigo: MEDIA_ERR.ABORTADO }]);
    expect(r.acciones).toEqual([]);
    expect(r.estado).toBe('cargando');
  });

  it('una pausa del sistema (auriculares, imagen dentro de imagen) quita la intención', () => {
    const sonando = correr([{ tipo: 'cargar' }, { tipo: 'metadatos' }, { tipo: 'pedirSonar' }, { tipo: 'avanza' }]).b;
    const r = correr([{ tipo: 'pausa' }], sonando);
    expect(r.estado).toBe('listo');
    expect(r.b.quiere).toBe(false);
  });
});

describe('punto de partida y velocidades', () => {
  it('el instante pedido manda; si no, se retoma lo guardado si es útil', () => {
    expect(puntoDePartida(4016, { t: 900 }, 7327)).toEqual({ t: 4016, retomado: false });
    expect(puntoDePartida(undefined, { t: 900 }, 7327)).toEqual({ t: 900, retomado: true });
    expect(puntoDePartida(undefined, { t: 4 }, 7327)).toEqual({ t: 0, retomado: false });
    expect(puntoDePartida(undefined, { t: 7320 }, 7327)).toEqual({ t: 0, retomado: false });
    expect(puntoDePartida(0, { t: 900 }, 7327)).toEqual({ t: 900, retomado: true });
    expect(puntoDePartida(undefined, null, undefined)).toEqual({ t: 0, retomado: false });
  });

  it('[ y ] recorren las velocidades sin salirse', () => {
    expect(velocidadVecina(1, 1)).toBe(1.25);
    expect(velocidadVecina(1, -1)).toBe(0.75);
    expect(velocidadVecina(3, 1)).toBe(3);
    expect(velocidadVecina(0.5, -1)).toBe(0.5);
    expect(velocidadVecina(1.1, 1)).toBe(1.25);
    expect(velocidadVecina(1.1, -1)).toBe(1);
  });
});
