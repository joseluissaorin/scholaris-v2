/**
 * La versión local con varias personas (SCHOLARIS_USUARIOS): compartir,
 * aceptar, seguir, copiar sin duplicar bytes, enlaces sin cuenta y paquetes
 * .scholaris, sobre SQLite y el disco. Inteligencia falsa.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearCliente, importarPaquete, subirFichero, type ClienteScholaris } from '@scholaris/contrato';
import type { PaqueteConversion } from '@scholaris/imprenta';
import { crearServidorLocal, type ServidorLocal } from '../src/servidor.js';
import { driverNode } from '../src/principal.js';
import { inteligenciaFalsa } from './falsos.js';

let s: ServidorLocal;
let datos: string;
const BASE = 'http://localhost:8798';
const fetchLocal: typeof fetch = async (entrada, init) => s.fetch(new Request(entrada as string, init));
const como = (token: string) => crearCliente({ base: BASE, token, fetch: fetchLocal });

beforeAll(async () => {
  datos = mkdtempSync(join(tmpdir(), 'scholaris-bibliotecas-'));
  s = await crearServidorLocal({
    datos, puerto: 8798, driver: driverNode,
    entorno: { SCHOLARIS_USUARIOS: 'token-de-ana-123:ana:ana@casa.es:Ana Ruiz;token-de-luis-456:luis:luis@casa.es:Luis Gil', SCHOLARIS_SIN_VERIFICACION: '1' },
    fabricaInteligencia: () => inteligenciaFalsa(),
  });
  globalThis.fetch = fetchLocal;
});

afterAll(() => { s.cerrar(); rmSync(datos, { recursive: true, force: true }); });

function bytesEn(dir: string): number {
  let t = 0;
  try {
    for (const n of readdirSync(dir)) {
      const f = join(dir, n);
      const st = statSync(f);
      t += st.isDirectory() ? bytesEn(f) : st.size;
    }
  } catch { /* no existe */ }
  return t;
}

async function ingerir(c: ClienteScholaris, nombre: string, textos: string[], biblioteca?: string): Promise<string> {
  const original = new Blob([textos.join('\n\n')]);
  const sub = await c.subidas.crear({ nombre: `${nombre}.md`, mime: 'text/markdown', bytes: original.size, huella: `h-${nombre}`, ...(biblioteca ? { bibliotecas: [biblioteca] } : {}) });
  await subirFichero(c, sub.subida, sub.original, original);
  let parrafo = 0;
  const paquete: PaqueteConversion = {
    version: 1, tipo: 'documento', origen: { nombre, mime: 'text/markdown', bytes: original.size, huella: `h-${nombre}` },
    metadatos: { titulo: nombre, autores: [{ nombre: 'Ana', apellidos: 'Ruiz' }] }, unidades: textos.length,
    contenido: { clase: 'documento', formato: 'markdown', notas: [], paginasImpresas: [], esquema: [], bloques: textos.map((texto) => ({ tipo: 'parrafo' as const, texto, ruta: [nombre], parrafo: ++parrafo })) },
    partes: [], reserva: null, avisos: [], entorno: 'navegador', tiempos: {},
  };
  const rec = await c.subidas.recursos(sub.subida, { recursos: [{ ruta: 'paquete.json', mime: 'application/json' }] });
  await subirFichero(c, sub.subida, rec.recursos[0]!.subida, new Blob([JSON.stringify(paquete)]));
  const ing = await c.subidas.ingestar(sub.subida, { paquete: 'paquete.json' });
  await s.cola.vaciar();
  expect((await c.tareas.obtener(ing.tarea)).estado).toBe('listo');
  return ing.documento;
}

describe('bibliotecas compartidas en local', () => {
  it('dos personas: invitar, aceptar, seguir, copiar sin duplicar, enlace y paquete', async () => {
    const ana = como('token-de-ana-123');
    const luis = como('token-de-luis-456');
    expect((await ana.auth.yo()).usuario.nombre).toBe('Ana Ruiz');
    await expect(crearCliente({ base: BASE, fetch: fetchLocal }).auth.yo()).rejects.toThrow();

    const bib = await ana.bibliotecas.crear({ nombre: 'Tesis', derechos: 'cc_by' });
    const d1 = await ingerir(ana, 'capitulo-uno', ['La memoria colectiva se construye en los archivos.'], bib.id);
    await ingerir(ana, 'notas-privadas', ['Esto es solo de Ana.']);

    const inv = await ana.bibliotecas.compartir(bib.id, { correo: 'luis@casa.es', permiso: 'lectura' });
    expect(inv.estado).toBe('pendiente');
    const bandeja = await luis.invitaciones.listar();
    expect(bandeja[0]?.de.nombre).toBe('Ana Ruiz');
    await luis.invitaciones.aceptar(bandeja[0]!.id);
    const dentro = luis.compartida(bib.id);
    expect((await dentro.documentos.listar()).elementos.map((d) => d.id)).toEqual([d1]);
    const r = await luis.busqueda.conjunta({ consulta: 'memoria colectiva', alcance: 'seguidas' });
    expect(r.resultados[0]?.origen).toMatchObject({ propia: false, nombre: 'Tesis', de: 'Ana Ruiz' });

    // Copiar: ningún byte nuevo en el almacén de Luis.
    const antes = bytesEn(join(datos, 'almacen', 'u', 'luis'));
    const copia = await luis.copias.copiarTodo({ origen: { biblioteca: bib.id } });
    expect(copia.copiados).toHaveLength(1);
    expect(bytesEn(join(datos, 'almacen', 'u', 'luis'))).toBe(antes);
    const mia = await luis.documentos.obtener(copia.copiados[0]!.documento);
    expect(mia.original).toMatch(/^u\/ana\//);
    const url = (await luis.documentos.original(mia.id)).url;
    expect((await fetchLocal(url)).status).toBe(200);

    // Enlace sin cuenta (derechos abiertos: sin confirmación).
    const e = await ana.enlaces.crear({ biblioteca: bib.id });
    const anonimo = crearCliente({ base: BASE, fetch: fetchLocal }).publico(e.token);
    expect((await anonimo.documentos.listar()).elementos).toHaveLength(1);
    await ana.enlaces.revocar(e.id);
    await expect(anonimo.documentos.listar()).rejects.toThrow(/ya no funciona/);

    // Paquete: Ana lo exporta y Luis lo importa (repetido: ya tenía la copia).
    const paquete = new Uint8Array(await (await ana.bibliotecas.paquete(bib.id)).arrayBuffer());
    const imp = await importarPaquete(luis, paquete, { nombre: 'Tesis (paquete)' });
    expect(imp.repetidos).toHaveLength(1);
    expect(imp.fallidos).toEqual([]);

    // Dejar de seguir.
    await luis.seguidas.dejar(bib.id);
    await expect(dentro.documentos.listar()).rejects.toThrow();
  });
});
