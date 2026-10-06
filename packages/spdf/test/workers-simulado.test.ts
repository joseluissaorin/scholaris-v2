/**
 * Simula workerd en Node: compilar WebAssembly a partir de bytes está
 * prohibido. El motor debe arrancar solo con módulos ya compilados (el
 * sqlite3.wasm y los puentes de wasm/puentes), como en Cloudflare Workers.
 *
 * (Vitest aísla cada fichero de pruebas: el motor se carga aquí por primera vez.)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { abrirSpdf, crearSpdf } from '../src/archivo.js';
import { bytesPuente, clavePuente, configurarMotor } from '../src/motor.js';

const W = WebAssembly as unknown as { Module: typeof WebAssembly.Module; compile: typeof WebAssembly.compile; instantiate: typeof WebAssembly.instantiate };
const Original = { Module: W.Module, compile: W.compile, instantiate: W.instantiate };

// Lo que en Workers llega compilado por wrangler:
const ruta = join(dirname(createRequire(import.meta.url).resolve('@sqlite.org/sqlite-wasm/package.json')), 'dist/sqlite3.wasm');
const moduloWasm = new Original.Module(readFileSync(ruta));
const dirPuentes = join(import.meta.dirname, '../wasm/puentes');
const puentes = Object.fromEntries(readdirSync(dirPuentes).map((f) => [f.replace('.wasm', ''), new Original.Module(readFileSync(join(dirPuentes, f)))]));

// Desde aquí, como en workerd: nada de compilar bytes.
const prohibido = () => { throw new WebAssembly.CompileError('WebAssembly.Module(): Wasm code generation disallowed by embedder'); };
let intentos = 0;
W.Module = function () { intentos++; prohibido(); } as unknown as typeof WebAssembly.Module;
W.compile = (async () => { intentos++; prohibido(); }) as unknown as typeof WebAssembly.compile;
W.instantiate = ((a: unknown, b?: WebAssembly.Imports) => {
  if (a instanceof Original.Module) return Original.instantiate(a, b);
  intentos++;
  return Promise.reject(new WebAssembly.CompileError('Wasm code generation disallowed by embedder'));
}) as typeof WebAssembly.instantiate;
afterAll(() => { W.Module = Original.Module; W.compile = Original.compile; W.instantiate = Original.instantiate; });

describe('motor sin compilación en tiempo de ejecución (como workerd)', () => {
  it('los puentes en disco son los que genera sqlite-wasm', () => {
    for (const r of ['i', 'v'] as const) {
      for (let n = 0; n <= 6; n++) {
        const enDisco = new Uint8Array(readFileSync(join(dirPuentes, `${r}${n}.wasm`)));
        expect(enDisco).toEqual(bytesPuente(r, n));
        expect(clavePuente(enDisco)).toBe(`${r}${n}`);
      }
    }
    expect(clavePuente(new Uint8Array(readFileSync(ruta)).subarray(0, 64))).toBeNull();
  });

  it('arranca con módulos precompilados y funciona: FTS5, vectores, exportar y abrir', async () => {
    configurarMotor({ moduloWasm, puentes });
    const a = await crearSpdf();
    await a.escribirDocumento({
      id: 'd', tipo: 'pdf', metadatos: { titulo: 'Prueba', autores: [] }, estado: 'listo', huella: 'h', original: '', mime: 'application/pdf',
      bytes: 1, unidades: 1, creado: 'x', actualizado: 'x', bibliotecas: [],
    });
    await a.escribirFragmentos([{ id: 'f', documento: 'd', unidad: 'u', orden: 1, texto: 'La canción del pirata', contexto: '', seccion: [], ancla: { tipo: 'pagina', fisica: 1, impresa: '7', romana: false, origen: 'leido', confianza: 1 } }]);
    const b = await abrirSpdf(a.exportar());
    a.cerrar();
    expect((await b.buscarTexto('cancion'))[0]?.resaltado).toBe('La [canción] del pirata');
    b.cerrar();
    expect(intentos).toBe(0);
  });
});
