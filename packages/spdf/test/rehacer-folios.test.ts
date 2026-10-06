import type { AnclaPagina, Documento } from '@scholaris/nucleo';
import { describe, expect, it } from 'vitest';
import { crearSpdf, type ArchivoSpdf } from '../src/archivo.js';
import { rehacerFolios } from '../src/folios.js';

const doc = (id: string): Documento => ({
  id, tipo: 'pdf_escaneado', metadatos: { titulo: id, autores: [] }, estado: 'listo', huella: 'h', original: '', mime: 'application/pdf',
  bytes: 1, unidades: 0, creado: 'x', actualizado: 'x', bibliotecas: [],
});
const ancla = (fisica: number, impresa: string | null, origen: AnclaPagina['origen'] = impresa ? 'leido' : 'ninguno'): AnclaPagina =>
  ({ tipo: 'pagina', fisica, impresa, romana: !!impresa && /^[ivxlc]+$/.test(impresa), origen, confianza: origen === 'leido' ? 0.99 : 0.7 });
const texto = 'palabra '.repeat(60);

/** Como El casamiento en la banca de pruebas: lecturas 8-38 = 2-32 y guardas 39-43 con folios inventados. */
async function casamiento(): Promise<ArchivoSpdf> {
  const a = await crearSpdf();
  await a.escribirDocumento(doc('cas'));
  const us: Parameters<ArchivoSpdf['escribirUnidades']>[0][number][] = [];
  for (let f = 1; f <= 43; f++) {
    const blanca = f <= 6 || f >= 39;
    const impresa = f >= 8 && f <= 38 ? String(f - 6) : f >= 39 ? String(f - 6) : null;
    const origen = f >= 8 && f <= 38 ? 'leido' : f >= 39 ? 'deducido' : 'ninguno';
    us.push({ id: `cas:u${f}`, documento: 'cas', orden: f - 1, ancla: ancla(f, impresa, origen), texto: blanca ? '' : texto, lector: 't', confianza: 1 });
  }
  await a.escribirUnidades(us);
  await a.escribirFragmentos([
    { id: 'cas:f1', documento: 'cas', unidad: 'cas:u38', orden: 1, texto: 'fin', contexto: '', seccion: [], ancla: ancla(38, '32'), anclaFin: ancla(39, '33', 'deducido') },
    { id: 'cas:f2', documento: 'cas', unidad: 'cas:u20', orden: 2, texto: 'medio', contexto: '', seccion: [], ancla: ancla(20, '14') },
  ]);
  await a.registrarProcedencia({ documento: 'cas', fase: 'folios', proveedor: 'folios+jev', detalle: { fuente: 'secuencia' } });
  return a;
}

describe('rehacerFolios', () => {
  it('deja sin folio las guardas finales y reancla los fragmentos, sin tocar sus ids', async () => {
    const a = await casamiento();
    const r = await rehacerFolios(a.sql, 'cas');
    expect(r.cambiadas).toBe(6);
    expect(r.cambios).toEqual(expect.arrayContaining(['7: — → 1', '39: 33 → —', '43: 37 → —']));
    const us = await a.leerUnidades('cas');
    expect(us.slice(38).every((u) => (u.ancla as AnclaPagina).impresa === null)).toBe(true);
    expect((us[37]!.ancla as AnclaPagina).impresa).toBe('32');
    const [f1] = await a.sql.ejecutar<{ impresa: string | null }>("SELECT impresa FROM unidades WHERE id = 'cas:u40'");
    expect(f1?.impresa).toBeNull();
    const fr = await a.leerFragmentos('cas');
    expect(fr.map((f) => f.id)).toEqual(['cas:f1', 'cas:f2']);
    expect((fr[0]!.anclaFin as AnclaPagina).impresa).toBeNull();
    expect(r.fragmentos).toBe(1);
    expect((await a.buscarTexto('fin'))[0]?.fragmento.id).toBe('cas:f1');
    const proc = await a.leerProcedencia('cas');
    expect(proc.at(-1)).toMatchObject({ fase: 'folios', proveedor: 'folios-rehacer' });
    // idempotente
    expect((await rehacerFolios(a.sql, 'cas')).actualizadas).toBe(0);
    a.cerrar();
  });

  it('si venían de las etiquetas del PDF, las reutiliza y quita la sobrecubierta', async () => {
    const a = await crearSpdf();
    await a.escribirDocumento(doc('lew'));
    const us: Parameters<ArchivoSpdf['escribirUnidades']>[0][number][] = [];
    const etiquetas = ['dj A', 'dj B', 'i', 'ii', 'iii', ...Array.from({ length: 20 }, (_, i) => String(i + 1))];
    etiquetas.forEach((e, i) => {
      const leida = i >= 5 && i % 2 === 0;
      us.push({ id: `lew:u${i + 1}`, documento: 'lew', orden: i, ancla: { ...ancla(i + 1, e, leida ? 'leido' : 'deducido'), romana: /^[ivx]+$/.test(e) }, texto, pie: leida ? e : '', lector: 't', confianza: 1 });
    });
    await a.escribirUnidades(us);
    await a.registrarProcedencia({ documento: 'lew', fase: 'folios', proveedor: 'etiquetas-pdf', detalle: {} });
    const r = await rehacerFolios(a.sql, 'lew');
    expect(r.fuente).toBe('etiquetas');
    const nuevas = (await a.leerUnidades('lew')).map((u) => (u.ancla as AnclaPagina).impresa);
    expect(nuevas).toEqual([null, null, ...etiquetas.slice(2)]);
    a.cerrar();
  });

  it('simular no escribe nada; un documento sin páginas no hace nada', async () => {
    const a = await casamiento();
    const r = await rehacerFolios(a.sql, 'cas', { simular: true });
    expect(r.cambiadas).toBe(6);
    expect(((await a.leerUnidades('cas'))[40]!.ancla as AnclaPagina).impresa).toBe('35');
    await a.escribirDocumento(doc('audio'));
    await a.escribirUnidades([{ id: 'au:1', documento: 'audio', orden: 0, ancla: { tipo: 'tiempo', t0: 0, t1: 5 }, texto: 'hola', lector: 't', confianza: 1 }]);
    expect((await rehacerFolios(a.sql, 'audio')).unidades).toBe(0);
    a.cerrar();
  });
});
