/**
 * Modo sin conexión de punta a punta: un PDF escaneado (solo imagen) se sube,
 * la imprenta de Node lo convierte, el lector de visión «local» (un servidor
 * falso compatible con OpenAI en 127.0.0.1) lo lee, se vectoriza, se busca y
 * se verifica una cita, con la guardia de red puesta. Se comprueba que NINGUNA
 * petición sale de la máquina: todas las URLs que pasan por fetch son locales
 * y la guardia no ha tenido que bloquear nada; y que una petición a internet
 * sí se bloquea.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { crearCliente, subirFichero } from '@scholaris/contrato';
import { esAnfitrionLocal } from '@scholaris/proveedores';
import { crearServidorLocal, type ServidorLocal } from '../src/servidor.js';
import { driverNode, imprentaNode, prepararSinConexion } from '../src/principal.js';
import { ErrorSinConexion, type GuardiaDeRed } from '../src/guardia-red.js';

const TOKEN = 'token-sin-conexion-de-pruebas';
// Bentham, «Panopticon; or, the Inspection-House» (1791), carta V, literal de Wikisource:
// https://en.wikisource.org/wiki/Panopticon_or_the_Inspection-House
const TEXTO_PAGINA = 'The essence of it consists, then, in the centrality of the inspector’s situation, combined with the wellknown and most effectual contrivances for seeing without being seen.';
let s: ServidorLocal;
let datos: string;
let ia: Server;
let urlIA = '';
let guardia: GuardiaDeRed | null = null;
const vistas: string[] = [];
const llamadasIA: Array<{ ruta: string; tipo: string }> = [];
const fetchOriginal = globalThis.fetch;

function vector(texto: string): number[] {
  const v = new Array<number>(768).fill(0);
  for (const w of texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((x) => x.length > 2)) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619) >>> 0;
    v[h % 768]! += 1;
  }
  v[0]! += 0.01;
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

/** Un «Ollama» falso: chat (visión, redactor, juez) y vectores. */
function servidorIA(): Promise<Server> {
  return new Promise((ok) => {
    const srv = createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (d) => { cuerpo += d; });
      req.on('end', () => {
        const j = cuerpo ? JSON.parse(cuerpo) as Record<string, unknown> : {};
        const responder = (x: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(x)); };
        if (req.url === '/v1/embeddings') {
          llamadasIA.push({ ruta: req.url, tipo: 'vectores' });
          return responder({ data: (j.input as string[]).map((t, index) => ({ index, embedding: vector(t) })) });
        }
        if (req.url === '/v1/chat/completions') {
          const mensajes = JSON.stringify(j.messages);
          const esquema = (j.response_format as { json_schema?: { schema?: { properties?: Record<string, unknown> } } } | undefined)?.json_schema?.schema;
          let contenido = '{}';
          let tipo = 'redactor';
          let logprobs: unknown = null;
          if (mensajes.includes('image_url')) {
            tipo = 'lector';
            const fisica = Number(/páginas físicas (\d+)/.exec(mensajes)?.[1] ?? 1);
            contenido = JSON.stringify({ paginas: [{ fisica, vacia: false, cabecera: 'PANOPTICON', folio: String(200 + fisica), titulos: [], texto: TEXTO_PAGINA, notas: [], pie: '', figuras: [], idioma: 'es', confianza: 0.95 }] });
          } else if (esquema?.properties?.respuesta) {
            tipo = 'juez';
            contenido = '{"respuesta":"A"}';
            logprobs = { content: [{ token: 'A', logprob: Math.log(0.9), top_logprobs: [{ token: 'A', logprob: Math.log(0.9) }, { token: 'B', logprob: Math.log(0.1) }] }] };
          } else if (esquema?.properties?.titulo) {
            contenido = JSON.stringify({ titulo: 'Panopticon; or, the Inspection-House', autores: [{ nombre: 'Jeremy', apellidos: 'Bentham' }], idioma: 'en', tipoCSL: 'book', anio: 1791 });
          }
          llamadasIA.push({ ruta: req.url, tipo });
          return responder({ model: j.model, choices: [{ message: { role: 'assistant', content: contenido }, finish_reason: 'stop', logprobs }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
        }
        res.writeHead(404); res.end('no');
      });
    });
    srv.listen(0, '127.0.0.1', () => ok(srv));
  });
}

/** Un PDF «escaneado» escrito a mano: una imagen JPEG por página y ninguna capa de texto. */
async function pdfEscaneado(paginas: number): Promise<Uint8Array> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const c = createCanvas(600, 900);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4ecd8'; ctx.fillRect(0, 0, 600, 900);
  ctx.fillStyle = '#222'; ctx.font = '22px serif';
  TEXTO_PAGINA.match(/.{1,45}(\s|$)/g)?.forEach((l, k) => ctx.fillText(l, 40, 80 + k * 32));
  for (let k = 0; k < 18; k++) ctx.fillRect(40, 300 + k * 30, 420 + ((k * 37) % 100), 3);
  const jpg = new Uint8Array(await c.encode('jpeg', 80));
  const partes: Uint8Array[] = [];
  const offsets: number[] = [];
  let largo = 0;
  const poner = (x: string | Uint8Array) => { const b = typeof x === 'string' ? new TextEncoder().encode(x) : x; partes.push(b); largo += b.length; };
  const objeto = (n: number, cuerpo: string | Array<string | Uint8Array>) => { offsets[n] = largo; poner(`${n} 0 obj\n`); for (const x of Array.isArray(cuerpo) ? cuerpo : [cuerpo]) poner(x); poner('\nendobj\n'); };
  poner('%PDF-1.4\n');
  const kids = Array.from({ length: paginas }, (_, i) => `${3 + i * 3} 0 R`).join(' ');
  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objeto(2, `<< /Type /Pages /Kids [${kids}] /Count ${paginas} >>`);
  for (let i = 0; i < paginas; i++) {
    const n = 3 + i * 3;
    const dibujo = 'q 600 0 0 900 0 0 cm /Im0 Do Q';
    objeto(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 900] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`);
    objeto(n + 1, [`<< /Type /XObject /Subtype /Image /Width 600 /Height 900 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, '\nendstream']);
    objeto(n + 2, `<< /Length ${dibujo.length} >>\nstream\n${dibujo}\nendstream`);
  }
  const total = 3 + paginas * 3;
  const xref = largo;
  poner(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) poner(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  poner(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const salida = new Uint8Array(largo);
  let o = 0;
  for (const b of partes) { salida.set(b, o); o += b.length; }
  return salida;
}

beforeAll(async () => {
  ia = await servidorIA();
  urlIA = `http://127.0.0.1:${(ia.address() as AddressInfo).port}`;
  datos = mkdtempSync(join(tmpdir(), 'scholaris-sin-conexion-'));
  const entorno = {
    SCHOLARIS_TOKEN: TOKEN, SCHOLARIS_SIN_CONEXION: '1', INFERENCIA_URL: urlIA, INFERENCIA_SABOR: 'ollama',
    // Claves de nube puestas a propósito: el modo sin conexión no debe usarlas.
    GEMINI_API_KEY: 'no-debe-usarse', OPENROUTER_API_KEY: 'no-debe-usarse', TYPESAFE_API_KEY: 'no-debe-usarse', CLERK_PUBLISHABLE_KEY: 'pk_test_Y2xlcmsuZWplbXBsby5jb20k',
  };
  guardia = prepararSinConexion(entorno);
  // Todo lo que pasa por fetch queda anotado; lo dirigido al propio servidor entra sin red.
  const guardado = globalThis.fetch;
  globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    vistas.push(url);
    if (url.startsWith('http://localhost:8797/')) return s.fetch(new Request(url, init));
    return guardado(entrada, init);
  }) as typeof fetch;
  s = await crearServidorLocal({ datos, puerto: 8797, driver: driverNode, entorno, convertir: await imprentaNode() });
}, 60_000);

afterAll(() => {
  s?.cerrar();
  guardia?.quitar();
  globalThis.fetch = fetchOriginal;
  ia?.close();
  rmSync(datos, { recursive: true, force: true });
});

describe('modo sin conexión', () => {
  it('la guardia bloquea internet y deja pasar lo local', async () => {
    expect(guardia).not.toBeNull();
    await expect(fetch('https://api.openalex.org/works?search=bentham')).rejects.toBeInstanceOf(ErrorSinConexion);
    expect(guardia!.bloqueadas.map((b) => b.anfitrion)).toContain('api.openalex.org');
    const { default: https } = await import('node:https');
    expect(() => https.get('https://generativelanguage.googleapis.com/')).toThrow(ErrorSinConexion);
    const { request } = await import('undici');
    await expect(request('https://api.crossref.org/works')).rejects.toThrow(/sin conexión/);
    expect((await fetch(`${urlIA}/v1/embeddings`, { method: 'POST', body: JSON.stringify({ input: ['hola'] }) })).ok).toBe(true);
    guardia!.bloqueadas.length = 0;
    vistas.length = 0;
    llamadasIA.length = 0;
  });

  it('ingesta de un PDF escaneado + búsqueda + verificación de una cita, sin una sola petición a internet', async () => {
    const c = crearCliente({ base: 'http://localhost:8797', token: TOKEN, fetch: globalThis.fetch });
    const cfg = await c.config();
    expect(cfg.clerkPublishableKey).toBeUndefined();

    const pdf = await pdfEscaneado(2);
    const sub = await c.subidas.crear({ nombre: 'panopticon.pdf', mime: 'application/pdf', bytes: pdf.byteLength });
    await subirFichero(c, sub.subida, sub.original, new Blob([pdf as Uint8Array<ArrayBuffer>]));
    const ing = await c.subidas.ingestar(sub.subida, {});
    await s.cola.vaciar();
    const t = await c.tareas.obtener(ing.tarea);
    expect(t.error).toBeUndefined();
    expect(t.estado).toBe('listo');

    // El lector de visión local leyó las dos páginas (imágenes, no PDF).
    expect(llamadasIA.filter((l) => l.tipo === 'lector').length).toBeGreaterThanOrEqual(2);
    const d = await c.documentos.obtener(ing.documento);
    expect(d.metadatos.titulo).toBe('Panopticon; or, the Inspection-House');

    const r = await c.busqueda.buscar({ consulta: 'inspector seeing without being seen' });
    expect(r.resultados[0]?.fragmento.texto).toMatch(/inspector/);
    expect(r.resultados[0]?.vias).toContain('densa');

    const v = await c.citas.verificar({ afirmacion: 'The inspector sees without being seen.' });
    expect(v.citas.length).toBeGreaterThan(0);
    expect(llamadasIA.some((l) => l.tipo === 'juez')).toBe(true);

    // Ninguna petición a internet: ni bloqueada ni hecha.
    expect(guardia!.bloqueadas).toEqual([]);
    const anfitriones = [...new Set(vistas.map((u) => new URL(u).hostname))];
    expect(anfitriones.every((h) => esAnfitrionLocal(h))).toBe(true);
    expect(llamadasIA.some((l) => l.tipo === 'vectores')).toBe(true);
  }, 120_000);
});
