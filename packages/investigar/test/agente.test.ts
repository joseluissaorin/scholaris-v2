import { describe, expect, it, vi } from 'vitest';
import type { EventoInvestigacion } from '@scholaris/contrato';
import { listarSintesis, listarTarjetas } from '@scholaris/funciones';
import { investigar, investigarCompleto } from '../src/agente.js';
import { CUENTO, crearSQL, guionCompleto, ModeloGuion, PELICULA, puertos, sembrar, textoDe } from './apoyo.js';

async function todo(gen: AsyncGenerator<EventoInvestigacion>): Promise<EventoInvestigacion[]> {
  const xs: EventoInvestigacion[] = [];
  for await (const e of gen) xs.push(e);
  return xs;
}

describe('investigar', () => {
  it('planifica, investiga con herramientas, redacta con pruebas materiales, verifica y guarda la memoria', async () => {
    const sql = crearSQL();
    await sembrar(sql);
    const modelo = new ModeloGuion(guionCompleto());
    const eventos = await todo(investigar(puertos(sql, modelo), '¿Cómo cambia Coppelia entre el cuento y la película?', { profundidad: 'normal' }));
    const tipos = eventos.map((e) => e.tipo);
    expect(tipos[0]).toBe('inicio');
    expect(tipos.indexOf('plan')).toBeGreaterThan(tipos.indexOf('paso'));
    expect(tipos.indexOf('texto')).toBeGreaterThan(tipos.lastIndexOf('paso'));
    expect(tipos.at(-2)).toBe('verificacion');
    expect(tipos.at(-1)).toBe('fin');

    // El plan solo nombra obras que existen y clases de prueba válidas.
    const plan = eventos.find((e) => e.tipo === 'plan');
    if (plan?.tipo !== 'plan') throw new Error('sin plan');
    expect(plan.plan.documentos.map((d) => d.id)).toEqual([CUENTO, PELICULA]);
    expect(plan.plan.subpreguntas[1]!.pruebas).toEqual(['visual']);

    // Pasos: recordar (automático) y los del agente, en orden; las pruebas llegan como eventos P#.
    const pasos = eventos.filter((e) => e.tipo === 'paso') as Array<Extract<EventoInvestigacion, { tipo: 'paso' }>>;
    expect(pasos.map((p) => p.herramienta)).toEqual(['recordar', 'mapa', 'buscar', 'leer', 'ver', 'anotar']);
    expect(pasos.every((p) => !p.error)).toBe(true);
    const evidencias = eventos.filter((e) => e.tipo === 'evidencia') as Array<Extract<EventoInvestigacion, { tipo: 'evidencia' }>>;
    expect(evidencias.length).toBeGreaterThan(3);
    expect(evidencias.every((e) => /^P\d+$/.test(e.evidencia.id))).toBe(true);
    // Lo que se vio: un instante, una región y la URI real (no un ancla inventada).
    const vista = evidencias.find((e) => e.evidencia.herramienta === 'ver' && e.evidencia.modo === 'video');
    expect(vista?.evidencia.ancla).toMatchObject({ tipo: 'tiempo', t0: 600, instante: 600, region: { x: 0.3, y: 0.1, w: 0.4, h: 0.8 } });
    const oida = evidencias.find((e) => e.evidencia.herramienta === 'ver' && e.evidencia.capa === 'literal');
    expect(oida?.evidencia.ancla).toMatchObject({ tipo: 'tiempo', hablante: 'Diego' });
    expect(oida?.evidencia.cita).toContain('Me encanta la fresa');
    const pagina = evidencias.find((e) => e.evidencia.documento === CUENTO);
    expect(pagina?.evidencia.imagenUrl).toMatch(/^https:\/\/img\/doc-cuento\/paginas\//);

    // El modelo de visión recibió el tramo recortado del vídeo.
    const peticionVer = modelo.peticiones.find((p) => JSON.stringify(p.esquema ?? {}).includes('observaciones'))!;
    expect(peticionVer.mensajes[0]!.partes[0]).toMatchObject({ tipo: 'medio', uri: 'https://archivos/fresa', desde: 590, hasta: 645 });
    expect(textoDe(peticionVer)).toContain('Me encanta la fresa');

    // La respuesta: marcas E1… en el texto, sin la inventada, y la cita estrechada a sus caracteres.
    const textos = eventos.filter((e) => e.tipo === 'texto') as Array<Extract<EventoInvestigacion, { tipo: 'texto' }>>;
    const enFlujo = textos.map((t) => t.delta).join('');
    expect(enFlujo).toContain('[E1]');
    expect(enFlujo).not.toMatch(/\[P\d+\]/);
    expect(Object.assign({}, ...textos.map((t) => t.marcas ?? {}))).toMatchObject({ E1: expect.stringMatching(/^P\d+$/) });
    const fin = eventos.at(-1);
    if (fin?.tipo !== 'fin') throw new Error('sin fin');
    expect(fin.markdown).toContain('## Pruebas');
    expect(fin.markdown).not.toContain('P999');
    // La tabla resume sin marcas (una fila se juzga entera): la página que solo citaba la tabla ya no es prueba.
    expect(fin.evidencias.map((e) => e.id)).toEqual(['E1', 'E2', 'E3']);
    expect(fin.markdown).toContain('| Cuento | marca a Diego |');
    const e1 = fin.evidencias[0]!;
    expect(e1).toMatchObject({ documento: CUENTO, etiqueta: 'p. 4', citaCorta: '(Paz, 1991/1994, p. 4)' });
    expect(e1.cita).toBe('habiendo chocolate, había pedido fresa.');
    expect(e1.ancla.caracteres).toBeDefined();
    expect(fin.avisos.some((a) => /marcas/.test(a))).toBe(true);
    expect(fin.fuentes.map((f) => f.documento).sort()).toEqual([CUENTO, PELICULA].sort());
    expect(fin.coste.pasos).toBe(6);
    expect(fin.coste.usd).toBeGreaterThan(0);

    // La verificación volvió a mirar la frase visual.
    const v = eventos.find((e) => e.tipo === 'verificacion');
    if (v?.tipo !== 'verificacion') throw new Error('sin verificación');
    expect(v.frases.some((f) => f.revisada)).toBe(true);
    expect(fin.confianza).toBe('alta');

    // La memoria: un cuaderno con una tarjeta verificada por prueba, la nota y la síntesis; y el historial.
    expect(fin.cuaderno).toBeDefined();
    const tarjetas = await listarTarjetas(sql, fin.cuaderno!);
    expect(tarjetas.filter((t) => t.cita).length).toBe(3);
    expect(tarjetas.find((t) => t.tipo === 'nota')?.contenido).toMatchObject({ clase: 'hallazgo' });
    expect(tarjetas.find((t) => t.tipo === 'tramo')).toBeDefined();
    const [s] = await listarSintesis(sql, fin.cuaderno!);
    expect(s!.texto).toMatch(/\[1\]/);
    expect(s!.texto).not.toContain('## Pruebas');
    const [h] = await sql.ejecutar<{ tipo: string; respuesta: string }>('SELECT tipo, respuesta FROM historial');
    expect(h).toMatchObject({ tipo: 'investigacion' });
  });

  it('la segunda investigación recuerda las pruebas de la primera', async () => {
    const sql = crearSQL();
    await sembrar(sql);
    await investigarCompleto(puertos(sql, new ModeloGuion(guionCompleto())), 'Coppelia y la fresa en el cuento y la película');
    const r = await investigarCompleto(puertos(sql, new ModeloGuion(guionCompleto())), '¿Qué significa la fresa en Coppelia?', { cuaderno: false, sinHistorial: true });
    const recordar = r.pasos[0]!;
    expect(recordar.herramienta).toBe('recordar');
    expect(recordar.evidencias.length).toBeGreaterThan(0);
  });

  it('respeta el presupuesto de pasos y responde aunque se corte', async () => {
    const sql = crearSQL();
    await sembrar(sql);
    let llamadas = 0;
    const modelo = new ModeloGuion((p, n) => {
      const g = guionCompleto()(p, n);
      if (p.herramientas?.length) { llamadas++; return { llamadas: [{ nombre: 'buscar', args: { consulta: 'fresa' } }, { nombre: 'buscar', args: { consulta: 'Coppelia' } }] }; }
      return g;
    });
    const r = await investigarCompleto(puertos(sql, modelo), 'fresa', { presupuesto: { pasos: 3 }, cuaderno: false, sinHistorial: true });
    expect(r.pasos.filter((p) => p.herramienta === 'buscar')).toHaveLength(3);
    expect(llamadas).toBe(2);
    expect(r.avisos.some((a) => /presupuesto/.test(a))).toBe(true);
  });

  it('sin medios, «ver» no está entre las herramientas; un error de herramienta no tumba la investigación', async () => {
    const sql = crearSQL();
    await sembrar(sql);
    let vio = false;
    const modelo = new ModeloGuion((p, n) => {
      if (p.herramientas?.length) {
        vio = p.herramientas.some((h) => h.nombre === 'ver');
        if (!p.mensajes.some((m) => m.partes.some((x) => x.tipo === 'respuesta'))) return { llamadas: [{ nombre: 'leer', args: { documento: 'no existe', paginas: { desde: 1, hasta: 2 } } }, { nombre: 'buscar', args: { consulta: 'fresa' } }] };
        return { texto: 'Listo.' };
      }
      return guionCompleto()(p, n);
    });
    const r = await investigarCompleto(puertos(sql, modelo, false), 'fresa', { cuaderno: false, sinHistorial: true });
    expect(vio).toBe(false);
    expect(r.pasos.find((p) => p.herramienta === 'leer')?.error).toMatch(/No conozco ese documento/);
  });

  it('dentro del ámbito de los filtros no aparecen otras obras', async () => {
    const sql = crearSQL();
    await sembrar(sql);
    const r = await investigarCompleto(puertos(sql, new ModeloGuion(guionCompleto())), 'fresa', { filtros: { documentos: [CUENTO] }, cuaderno: false, sinHistorial: true });
    expect(r.evidencias.every((e) => e.documento === CUENTO)).toBe(true);
    expect(r.plan?.documentos.map((d) => d.id)).toEqual([CUENTO]);
  });
});

describe('una redacción vacía o cortada nunca llega a «fin»', () => {
  /** El guion completo, pero la redacción falla las primeras `fallos` veces de la forma indicada. */
  function conRedaccionFallida(fallos: number, forma: 'vacia' | 'cortada' | 'error') {
    const base = guionCompleto();
    let redacciones = 0;
    const modelo = new ModeloGuion(base);
    const original = modelo.flujo.bind(modelo);
    modelo.flujo = async function* (p) {
      // La redacción es la única petición sin esquema ni herramientas.
      if (!p.esquema && !p.herramientas?.length && redacciones++ < fallos) {
        if (forma === 'error') throw new Error('el flujo se cortó');
        if (forma === 'cortada') { yield { delta: 'En el cuento, Diego llega a la mesa del narrador y pide fresa, pero el texto se corta aquí sin' }; yield { uso: { modelo: 'guion', entrada: 1, salida: 1, cache: 0, usd: 0, ms: 1 }, fin: 'MAX_TOKENS' }; return; }
        yield { uso: { modelo: 'guion', entrada: 1, salida: 0, cache: 0, usd: 0, ms: 1 }, fin: 'STOP' };
        return;
      }
      yield* original(p);
    };
    return { modelo, redacciones: () => redacciones };
  }

  for (const forma of ['vacia', 'cortada', 'error'] as const) {
    it(`si la primera sale ${forma}, se vuelve a escribir y la interfaz descarta lo recibido`, async () => {
      const sql = crearSQL();
      await sembrar(sql);
      const { modelo, redacciones } = conRedaccionFallida(1, forma);
      const avisos: string[] = [];
      const espia = vi.spyOn(console, 'error').mockImplementation((x: unknown) => { avisos.push(String(x)); });
      const eventos = await todo(investigar(puertos(sql, modelo), '¿Cómo cambia Coppelia?', { cuaderno: false, sinHistorial: true }));
      espia.mockRestore();
      expect(redacciones()).toBe(2);
      expect(eventos.some((e) => e.tipo === 'texto' && e.reinicio)).toBe(true);
      const fin = eventos.at(-1);
      expect(fin?.tipo).toBe('fin');
      if (fin?.tipo === 'fin') expect(fin.markdown).toContain('[E1]');
      expect(avisos.some((a) => JSON.parse(a).que === 'investigar_redaccion_fallida')).toBe(true);
    });
  }

  it('si falla en todos los intentos, termina en error (sin «fin») y lo deja escrito en el registro', async () => {
    const sql = crearSQL();
    await sembrar(sql);
    const { modelo, redacciones } = conRedaccionFallida(99, 'vacia');
    const avisos: string[] = [];
    const espia = vi.spyOn(console, 'error').mockImplementation((x: unknown) => { avisos.push(String(x)); });
    const eventos = await todo(investigar(puertos(sql, modelo), '¿Cómo cambia Coppelia?', { cuaderno: false }));
    espia.mockRestore();
    // Con un solo modelo para todo, el redactor se intenta dos veces.
    expect(redacciones()).toBe(2);
    expect(eventos.some((e) => e.tipo === 'fin')).toBe(false);
    expect(eventos.at(-1)).toMatchObject({ tipo: 'error', mensaje: expect.stringMatching(/vacía o cortada/) });
    expect(avisos.map((a) => { try { return JSON.parse(a).que; } catch { return ''; } })).toContain('investigar_sin_respuesta');
    // Queda en el historial como error, no como respuesta.
    const [h] = await sql.ejecutar<{ estado: string }>('SELECT estado FROM historial');
    expect(h?.estado).toBe('error');
  });

  it('con un redactor propio, el tercer intento es con otro modelo', async () => {
    const sql = crearSQL();
    await sembrar(sql);
    const p = puertos(sql, new ModeloGuion(guionCompleto()));
    const roto = new ModeloGuion(() => ({ texto: '' }));
    Object.defineProperty(roto, 'nombre', { value: 'redactor-roto' });
    p.modelos.redactor = roto;
    const eventos = await todo(investigar(p, '¿Cómo cambia Coppelia?', { cuaderno: false, sinHistorial: true }));
    expect(roto.peticiones.filter((x) => !x.esquema && !x.herramientas?.length)).toHaveLength(2);
    expect(eventos.at(-1)?.tipo).toBe('fin');
  });
});
