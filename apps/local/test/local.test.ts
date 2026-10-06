/**
 * Pruebas de la versión local en Node: el mismo contrato que la nube, con
 * SQLite, sqlite-vec, el disco y la cola reanudable. Inteligencia falsa.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearCliente, subirFichero, ErrorApi } from '@scholaris/contrato';
import type { PaqueteConversion } from '@scholaris/imprenta';
import { crearServidorLocal, type ServidorLocal } from '../src/servidor.js';
import { driverNode } from '../src/principal.js';
import { inteligenciaFalsa } from './falsos.js';

let s: ServidorLocal;
let datos: string;
const TOKEN = 'token-local-de-pruebas';

/** fetch que entra directamente en el servidor, sin red. */
const fetchLocal: typeof fetch = async (entrada, init) => s.fetch(new Request(entrada as string, init));
const api = () => crearCliente({ base: 'http://localhost:8799', token: TOKEN, fetch: fetchLocal });

beforeAll(async () => {
  datos = mkdtempSync(join(tmpdir(), 'scholaris-local-'));
  s = await crearServidorLocal({
    datos, puerto: 8799, driver: driverNode,
    entorno: { SCHOLARIS_TOKEN: TOKEN, SCHOLARIS_SIN_VERIFICACION: '1' },
    fabricaInteligencia: () => inteligenciaFalsa(),
  });
  // Las URLs firmadas apuntan a http://localhost:8799: el fetch global también entra aquí.
  globalThis.fetch = fetchLocal;
});

afterAll(() => { s.cerrar(); rmSync(datos, { recursive: true, force: true }); });

describe('versión local', () => {
  it('configuración y token de instancia', async () => {
    const c = await api().config();
    expect(c.modo).toBe('local');
    expect(c.requiereAutenticacion).toBe(true);
    const sinToken = crearCliente({ base: 'http://localhost:8799', fetch: fetchLocal });
    await expect(sinToken.auth.yo()).rejects.toBeInstanceOf(ErrorApi);
    const yo = await api().auth.yo();
    expect(yo.via).toBe('local');
    expect(yo.cuotas.documentos.limite).toBeNull();
  });

  it('subida → cola local → búsqueda con sqlite-vec', async () => {
    const c = api();
    const original = new Blob(['# Letter II\n\nThe building is circular.']);
    const sub = await c.subidas.crear({ nombre: 'ensayo.md', mime: 'text/markdown', bytes: original.size, metadatos: { anio: 1791 } });
    await subirFichero(c, sub.subida, sub.original, original);
    let parrafo = 0;
    const paquete: PaqueteConversion = {
      version: 1, tipo: 'documento', origen: { nombre: 'ensayo.md', mime: 'text/markdown', bytes: original.size, huella: 'h' },
      metadatos: { titulo: 'Panopticon; or, the Inspection-House', autores: [{ nombre: 'Jeremy', apellidos: 'Bentham' }] }, unidades: 3,
      contenido: {
        clase: 'documento', formato: 'markdown', notas: [], paginasImpresas: [], esquema: [],
        // Bentham, «Panopticon; or, the Inspection-House» (1791), cartas II y V, literal de Wikisource:
        // https://en.wikisource.org/wiki/Panopticon_or_the_Inspection-House
        bloques: ['The building is circular.', 'The apartment of the inspector occupies the centre; you may call it if you please the inspector’s lodge.', 'The essence of it consists, then, in the centrality of the inspector’s situation, combined with the wellknown and most effectual contrivances for seeing without being seen.']
          .map((texto) => ({ tipo: 'parrafo' as const, texto, ruta: ['Letter II'], parrafo: ++parrafo })),
      },
      partes: [], reserva: null, avisos: [], entorno: 'navegador', tiempos: {},
    };
    const rec = await c.subidas.recursos(sub.subida, { recursos: [{ ruta: 'paquete.json', mime: 'application/json' }] });
    await subirFichero(c, sub.subida, rec.recursos[0]!.subida, new Blob([JSON.stringify(paquete)]));
    const ing = await c.subidas.ingestar(sub.subida, { paquete: 'paquete.json' });
    await s.cola.vaciar();
    const t = await c.tareas.obtener(ing.tarea);
    expect(t.error).toBeUndefined();
    expect(t.estado).toBe('listo');
    const d = await c.documentos.obtener(ing.documento);
    expect(d.metadatos.anio).toBe(1791);
    const r = await c.busqueda.buscar({ consulta: 'apartment of the inspector' });
    expect(r.resultados[0]?.fragmento.texto).toMatch(/apartment of the inspector/);
    expect(r.resultados[0]?.vias).toContain('densa');
    // Exportar e importar .spdf en Node.
    const spdf = await c.documentos.spdf(ing.documento);
    const imp = await c.documentos.importar(spdf);
    expect(imp.documento).not.toBe(ing.documento);
  });

  it('cupones en SQLite: el usuario local administra, el lote vale una vez y la concesión se ve en /auth/yo', async () => {
    const c = api();
    expect((await c.auth.yo()).admin).toBe(true);
    const lote = await c.admin.crearLote({ cantidad: 2, plan: 'pro', lote: 'Local', nota: 'Pruebas' });
    expect(lote.codigos).toHaveLength(2);
    const canje = await c.cupones.canjear(lote.codigos[0]!.toLowerCase());
    expect(canje.concesion).toMatchObject({ origen: 'cupon', plan: 'pro' });
    expect((await c.auth.yo()).concesion?.origen).toBe('cupon');
    await expect(c.cupones.canjear(lote.codigos[0]!)).rejects.toMatchObject({ codigo: 'conflicto' });
    await expect(c.cupones.canjear(lote.codigos[1]!)).rejects.toMatchObject({ codigo: 'conflicto' });
    expect((await c.admin.lotes()).find((l) => l.lote === 'Local')).toMatchObject({ total: 2, canjeados: 1 });
  });

  it('el billete del WebSocket se verifica y da el canal del usuario', async () => {
    const b = await api().tiempoReal.billete('t123');
    expect(await s.canalDeBillete(b.billete)).toBe('tarea:local:t123');
    expect(await s.canalDeBillete('falso.x')).toBeNull();
    const recibidos: string[] = [];
    const quitar = s.tiempoReal.suscribir('usuario:otro', (e) => recibidos.push(e.tipo));
    await s.tiempoReal.emisorDe('otro').emitir('usuario:otro', { tipo: 'fin', tarea: 't123', estado: 'listo' });
    quitar();
    expect(recibidos).toEqual(['fin']);
  });
});
