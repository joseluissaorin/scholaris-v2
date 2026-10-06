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
    const original = new Blob(['# Vigilar\n\nEl panóptico de Bentham.']);
    const sub = await c.subidas.crear({ nombre: 'ensayo.md', mime: 'text/markdown', bytes: original.size, metadatos: { anio: 1975 } });
    await subirFichero(c, sub.subida, sub.original, original);
    let parrafo = 0;
    const paquete: PaqueteConversion = {
      version: 1, tipo: 'documento', origen: { nombre: 'ensayo.md', mime: 'text/markdown', bytes: original.size, huella: 'h' },
      metadatos: { titulo: 'Vigilar y castigar', autores: [{ nombre: 'Michel', apellidos: 'Foucault' }] }, unidades: 3,
      contenido: {
        clase: 'documento', formato: 'markdown', notas: [], paginasImpresas: [], esquema: [],
        bloques: ['El panóptico de Bentham es la figura arquitectónica de la vigilancia.', 'La disciplina fabrica individuos.', 'Las prisiones se parecen a las fábricas y a las escuelas.']
          .map((texto) => ({ tipo: 'parrafo' as const, texto, ruta: ['Vigilar'], parrafo: ++parrafo })),
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
    expect(d.metadatos.anio).toBe(1975);
    const r = await c.busqueda.buscar({ consulta: 'panóptico de Bentham' });
    expect(r.resultados[0]?.fragmento.texto).toMatch(/panóptico/);
    expect(r.resultados[0]?.vias).toContain('densa');
    // Exportar e importar .spdf en Node.
    const spdf = await c.documentos.spdf(ing.documento);
    const imp = await c.documentos.importar(spdf);
    expect(imp.documento).not.toBe(ing.documento);
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
