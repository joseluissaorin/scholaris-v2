import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { unzipSync } from 'fflate';
import { rutasFunciones, type PuertosFunciones } from '../src/index.js';
import { embebedorFalso, estanteria, juezFalso, puertos, redactorFalso, reordenadorFalso, sembrar } from './ayudas.js';

/** Un entorno como el de la plataforma: más variables que las que pedimos. */
type EntornoPlataforma = { Bindings: { X: string }; Variables: { funciones: PuertosFunciones; usuario: { id: string }; otra: number } };

async function montar(extra: Partial<PuertosFunciones> = {}) {
  const sql = await estanteria();
  await sembrar(sql, { id: 'foucault', titulo: 'Vigilar y castigar', autores: [['Michel', 'Foucault']], anio: 1975,
    paginas: ['El panóptico es una máquina de ver sin ser visto.', 'La disciplina fabrica cuerpos dóciles.', 'La prisión y la vigilancia.'] });
  const p = puertos(sql, {
    inteligencia: {
      embebedor: embebedorFalso(), reordenador: reordenadorFalso(), juez: juezFalso(),
      redactor: redactorFalso((t) => (t.includes('léxico') ? { lemas: ['panóptico'], variantes: [], excluir: [] } : t.includes('Pasajes representativos') ? { etiqueta: 'Vigilancia' } : { texto: 'Síntesis [1].', confianza: 'media' })),
    },
    ...extra,
  });
  const raiz = new Hono<EntornoPlataforma>();
  raiz.use('*', async (c, next) => { c.set('funciones', p); c.set('usuario', { id: 'u1' }); c.set('otra', 1); await next(); });
  const api = new Hono<EntornoPlataforma>();
  rutasFunciones(api);
  raiz.route('/api/v2', api);
  const pedir = async (metodo: string, ruta: string, cuerpo?: unknown, cabeceras: Record<string, string> = {}) => {
    const r = await raiz.request(`/api/v2${ruta}`, {
      method: metodo, headers: { ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...cabeceras },
      ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
    });
    const tipo = r.headers.get('content-type') ?? '';
    return { estado: r.status, tipo, cuerpo: tipo.includes('json') ? await r.json() : tipo.includes('event-stream') || tipo.startsWith('text') ? await r.text() : new Uint8Array(await r.arrayBuffer()) } as { estado: number; tipo: string; cuerpo: any };
  };
  return { sql, p, pedir };
}

describe('rutas', () => {
  it('historial: lista, estadísticas, fijar, 404 con el formato del contrato', async () => {
    const { registrarBusqueda } = await import('../src/historial.js');
    const m = await montar();
    const { pedir } = m;
    const id = await registrarBusqueda(m.p.sql, { consulta: 'panóptico', eventos: [{ ms: 0, etapa: 'resultados', datos: { tipo: 'resultados' } }] });
    expect((await m.pedir('GET', '/historial')).cuerpo.elementos).toHaveLength(1);
    expect((await m.pedir('GET', '/historial/estadisticas?rango=todo')).cuerpo.total).toBe(1);
    expect((await m.pedir('POST', `/historial/${id}/fijar`, { fijado: true })).cuerpo).toEqual({ ok: true });
    expect((await m.pedir('GET', '/historial?fijados=1')).cuerpo.elementos).toHaveLength(1);
    const rep = await m.pedir('GET', `/historial/${id}/reproducir`);
    expect(rep.cuerpo).toContain('event: resultados');
    expect((await m.pedir('POST', `/historial/${id}/repetir`)).cuerpo).toEqual({ consulta: 'panóptico' });
    const no = await pedir('GET', '/historial/nada');
    expect(no.estado).toBe(404);
    expect(no.cuerpo).toEqual({ error: { codigo: 'no_encontrado', mensaje: 'No existe esa búsqueda en el historial.' } });
    expect((await pedir('POST', '/historial/x/fijar', {})).cuerpo.error.codigo).toBe('peticion_invalida');
  });

  it('cuadernos: tarjetas, orden y síntesis', async () => {
    const { pedir } = await montar();
    const c = (await pedir('POST', '/cuadernos', { titulo: 'Poder' })).cuerpo;
    const t = await pedir('POST', `/cuadernos/${c.id}/tarjetas`, { tipo: 'fragmento', objetivo: 'foucault-f1' });
    expect(t.estado).toBe(201);
    expect(t.cuerpo.cita.citaCorta).toBe('Foucault 1975, p. 11');
    const s = await pedir('POST', `/cuadernos/${c.id}/sintesis`, { instrucciones: 'Resume.' });
    expect(s.cuerpo.citas).toHaveLength(1);
    expect((await pedir('GET', `/cuadernos/sintesis/${s.cuerpo.id}`)).cuerpo.texto).toBe('Síntesis [1].');
    expect((await pedir('GET', `/cuadernos/${c.id}/sintesis`)).cuerpo).toHaveLength(1);
    expect((await pedir('POST', `/cuadernos/${c.id}/reverificar`)).cuerpo.tarjetas[0].estado).toBe('verificada');
    expect((await pedir('GET', '/cuadernos')).cuerpo[0].tarjetas).toBe(1);
  });

  it('vigilantes y alertas', async () => {
    const emitidos: unknown[] = [];
    const { pedir } = await montar({ emisor: { emitir: async (_c, e) => void emitidos.push(e) } });
    const v = (await pedir('POST', '/vigilantes', { nombre: 'Panóptico', consulta: 'panóptico', modo: 'al_ingerir' })).cuerpo;
    expect((await pedir('POST', `/vigilantes/${v.id}/ejecutar`)).cuerpo).toEqual({ nada: true });
    expect((await pedir('PATCH', `/vigilantes/${v.id}`, { modo: 'cada hora' })).estado).toBe(400);
    expect((await pedir('GET', '/alertas?pendientes=1')).cuerpo).toEqual([]);
  });

  it('conceptos: ejecutar en línea, en segundo plano y por SSE; exportar', async () => {
    const pendientes: Promise<unknown>[] = [];
    const { pedir } = await montar({ enSegundoPlano: (pr) => void pendientes.push(pr) });
    const k = (await pedir('POST', '/conceptos', { nombre: 'Panóptico', terminos: ['panóptico', 'vigilancia'] })).cuerpo;
    const r = await pedir('POST', `/conceptos/${k.id}/ejecutar`, {});
    expect(r.estado).toBe(202);
    await Promise.all(pendientes);
    const inf = (await pedir('GET', `/conceptos/informes/${r.cuerpo.informe}`)).cuerpo;
    expect(inf.estado).toBe('listo');
    const tramos = (await pedir('GET', `/conceptos/informes/${r.cuerpo.informe}/tramos?limite=1`)).cuerpo;
    expect(tramos.elementos).toHaveLength(1);
    expect(tramos.total).toBeGreaterThanOrEqual(2);
    expect(tramos.siguiente).toBe('1');
    expect((await pedir('GET', `/conceptos/informes/${r.cuerpo.informe}/agregados`)).cuerpo.porDocumento[0].documento).toBe('foucault');
    const csv = await pedir('GET', `/conceptos/informes/${r.cuerpo.informe}/exportar?formato=csv`);
    expect(csv.tipo).toContain('text/csv');
    const flujo = await pedir('POST', `/conceptos/${k.id}/ejecutar`, {}, { accept: 'text/event-stream' });
    expect(flujo.cuerpo).toContain('event: progreso');
    expect(flujo.cuerpo).toContain('event: fin');
    expect((await pedir('GET', `/conceptos/${k.id}/informes`)).cuerpo).toHaveLength(2);
    const et = await pedir('POST', `/conceptos/tramos/${tramos.elementos[0].id}/etiqueta`, { etiqueta: 'correcto' });
    expect(et.cuerpo.etiquetaUsuario).toBe('correcto');
  });

  it('mapa, grafo, perspectivas, corpus y privacidad', async () => {
    const { pedir } = await montar();
    const m = await pedir('POST', '/mapa/construir', { k: 2 });
    expect(m.cuerpo).toContain('event: error'); // solo 3 fragmentos: hace falta un mínimo de 8
    expect(m.cuerpo).toContain('Hacen falta al menos 8 elementos');
    expect((await pedir('GET', '/mapa')).cuerpo).toEqual({ meta: {}, grupos: [], puntos: [] });
    expect((await pedir('POST', '/grafo/reconstruir')).cuerpo).toMatchObject({ nodos: 0, aristas: 0 });
    expect((await pedir('GET', '/grafo/nodos/foucault')).cuerpo.titulo).toBe('Vigilar y castigar');
    expect((await pedir('GET', '/perspectivas/recomendaciones')).cuerpo).toEqual([]);
    expect((await pedir('POST', '/perspectivas/abierto', { documento: 'foucault' })).cuerpo).toEqual({ ok: true });
    expect((await pedir('GET', '/corpus/kpis')).cuerpo.documentos).toBe(1);
    expect((await pedir('POST', '/privacidad/grabacion', { activa: false })).cuerpo.activa).toBe(false);
    const zip = await pedir('GET', '/privacidad/exportar');
    expect(zip.tipo).toBe('application/zip');
    expect(Object.keys(unzipSync(zip.cuerpo))).toContain('LEEME.txt');
    expect((await pedir('POST', '/privacidad/purgar', { confirmar: 'si' })).estado).toBe(400);
    expect((await pedir('POST', '/privacidad/purgar', { confirmar: 'BORRAR' })).cuerpo.borrados.documentos).toBe(1);
  });
});
