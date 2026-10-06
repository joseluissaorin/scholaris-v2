/**
 * Pruebas del Worker en el runtime de Workers (vitest-pool-workers):
 * autenticación, aislamiento entre usuarios, claves de API, y el camino feliz
 * subida → ingesta (Workflow real) → búsqueda, con inteligencia falsa.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { importJWK, SignJWT } from 'jose';
import type { PaqueteConversion } from '@scholaris/imprenta';
import { JWK_PRIVADA } from './clave-prueba.js';
import { SPDF_FOLIOS_B64 } from './spdf-folios.js';

const BASE = 'https://scholaris.prueba/api/v2';

async function token(sub: string, extra: Record<string, unknown> = {}): Promise<string> {
  const clave = await importJWK(JWK_PRIVADA, 'RS256');
  return new SignJWT({ email: `${sub}@prueba.es`, name: sub, ...extra })
    .setProtectedHeader({ alg: 'RS256', kid: 'prueba' })
    .setSubject(sub).setIssuer('https://clerk.prueba').setIssuedAt().setExpirationTime('10m')
    .sign(clave);
}

async function api(ruta: string, o: { token?: string; metodo?: string; cuerpo?: unknown; cabeceras?: Record<string, string> } = {}) {
  const h: Record<string, string> = { ...(o.cabeceras ?? {}) };
  if (o.token) h.authorization = `Bearer ${o.token}`;
  let body: BodyInit | undefined;
  if (o.cuerpo instanceof Uint8Array || typeof o.cuerpo === 'string') body = o.cuerpo as BodyInit;
  else if (o.cuerpo !== undefined) { body = JSON.stringify(o.cuerpo); h['content-type'] = 'application/json'; }
  const r = await SELF.fetch(ruta.startsWith('http') ? ruta : `${BASE}${ruta}`, { method: o.metodo ?? (o.cuerpo !== undefined ? 'POST' : 'GET'), headers: h, body });
  const tipo = r.headers.get('content-type') ?? '';
  return { estado: r.status, cuerpo: (tipo.includes('json') ? await r.json() : await r.text()) as any, r };
}

function paqueteDocumento(texto: string[]): PaqueteConversion {
  let parrafo = 0;
  return {
    version: 1, tipo: 'documento',
    origen: { nombre: 'ensayo.md', mime: 'text/markdown', bytes: 100, huella: 'h-ensayo' },
    metadatos: { titulo: 'Ensayo sobre el panóptico', autores: [{ nombre: 'Michel', apellidos: 'Foucault' }], anio: 1975, idioma: 'es' },
    unidades: texto.length,
    contenido: {
      clase: 'documento', formato: 'markdown',
      bloques: [
        { tipo: 'titulo', nivel: 1, texto: 'Vigilar', ruta: ['Vigilar'], parrafo: 0 },
        ...texto.map((t) => ({ tipo: 'parrafo' as const, texto: t, ruta: ['Vigilar'], parrafo: ++parrafo })),
      ],
      notas: [], esquema: [{ titulo: 'Vigilar', nivel: 1, fisica: null, bloque: 0 }], paginasImpresas: [],
    },
    partes: [], reserva: null, avisos: [], entorno: 'navegador', tiempos: {},
  };
}

async function esperarTarea(t: string, tarea: string, ms = 45_000, prefijo = '') {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const r = await api(`${prefijo}/tareas/${tarea}`, { token: t });
    if (r.cuerpo.estado === 'listo' || r.cuerpo.estado === 'error') return r.cuerpo;
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error('La tarea no terminó a tiempo');
}

describe('sin autenticar', () => {
  it('salud y configuración públicas', async () => {
    expect((await api('/salud')).cuerpo.ok).toBe(true);
    const c = await api('/config');
    expect(c.cuerpo.modo).toBe('nube');
    expect(c.cuerpo.clerkPublishableKey).toMatch(/^pk_test_/);
  });

  it('rechaza sin token y con token falso, con error en español', async () => {
    const a = await api('/documentos');
    expect(a.estado).toBe(401);
    expect(a.cuerpo.error.codigo).toBe('no_autenticado');
    const b = await api('/documentos', { token: 'eyJhbGciOiJSUzI1NiJ9.e30.firma' });
    expect(b.estado).toBe(401);
    expect(b.cuerpo.error.mensaje).toMatch(/sesión/);
  });

  it('los binarios exigen firma válida', async () => {
    const r = await api('/binarios?clave=u/x/d/y/original.pdf&exp=9999999999&sig=falsa');
    expect(r.estado).toBe(403);
  });
});

describe('cuenta y plan desde el token', () => {
  it('plan gratis sin la función scholaris y pro con ella', async () => {
    const g = await api('/auth/yo', { token: await token('user_gratis') });
    expect(g.estado).toBe(200);
    expect(g.cuerpo.plan).toBe('gratis');
    expect(g.cuerpo.cuotas.documentos.limite).toBe(25);
    const p = await api('/auth/yo', { token: await token('user_pro', { fea: 'u:scholaris' }) });
    expect(p.cuerpo.plan).toBe('pro');
    expect(p.cuerpo.usuario.correo).toBe('user_pro@prueba.es');
  });

  it('claves de API: se crean con sesión, sirven para leer y no para gestionar claves', async () => {
    const t = await token('user_claves');
    const k = await api('/claves', { token: t, cuerpo: { nombre: 'SDK', alcances: ['lectura'] } });
    expect(k.estado).toBe(201);
    expect(k.cuerpo.secreto).toMatch(/^sch_/);
    const lee = await api('/bibliotecas', { token: k.cuerpo.secreto });
    expect(lee.estado).toBe(200);
    const escribe = await api('/bibliotecas', { token: k.cuerpo.secreto, cuerpo: { nombre: 'No' } });
    expect(escribe.estado).toBe(403);
    const gestiona = await api('/claves', { token: k.cuerpo.secreto, cuerpo: { nombre: 'Otra' } });
    expect(gestiona.estado).toBe(403);
    await api(`/claves/${k.cuerpo.id}`, { token: t, metodo: 'DELETE' });
    // La revocación surte efecto cuando caduca la caché de la puerta (un minuto); con otra clave, al momento.
    const k2 = await api('/claves', { token: t, cuerpo: { nombre: 'Otra', alcances: ['lectura'] } });
    await api(`/claves/${k2.cuerpo.id}`, { token: t, metodo: 'DELETE' });
    expect((await api('/bibliotecas', { token: k2.cuerpo.secreto })).estado).toBe(401);
  });

  it('las claves propias se guardan cifradas y solo se enseña el final', async () => {
    const t = await token('user_byok');
    const r = await api('/ajustes/claves/gemini', { token: t, metodo: 'PUT', cuerpo: { clave: 'AIzaClaveDePrueba1234' } });
    expect(r.estado).toBe(200);
    expect(r.cuerpo.claves[0]).toMatchObject({ proveedor: 'gemini', final: '1234' });
    const fila = await env.DB.prepare('SELECT claves FROM ajustes WHERE usuario = ?').bind('user_byok').first<{ claves: string }>();
    expect(fila?.claves).not.toContain('AIzaClaveDePrueba1234');
    expect(fila?.claves).toContain('v1.');
  });
});

describe('aislamiento entre usuarios', () => {
  it('lo de A no existe para B', async () => {
    const a = await token('user_a');
    const b = await token('user_b');
    const bib = await api('/bibliotecas', { token: a, cuerpo: { nombre: 'Seminario de A' } });
    expect(bib.estado).toBe(201);
    const listaB = await api('/bibliotecas', { token: b });
    expect(listaB.cuerpo.find((x: { id: string }) => x.id === bib.cuerpo.id)).toBeUndefined();
    expect((await api(`/bibliotecas/${bib.cuerpo.id}`, { token: b })).estado).toBe(404);

    const s = await api('/subidas', { token: a, cuerpo: { nombre: 'privado.md', mime: 'text/markdown', bytes: 10 } });
    expect(s.estado).toBe(201);
    expect((await api(`/documentos/${s.cuerpo.documento}`, { token: b })).estado).toBe(404);
    expect((await api(`/documentos/${s.cuerpo.documento}`, { token: a })).estado).toBe(200);
    expect((await api(`/subidas/${s.cuerpo.subida}/ingestar`, { token: b, cuerpo: {} })).estado).toBe(404);
  });
});

describe('subida → ingesta → búsqueda', () => {
  it('camino feliz con el Workflow real y la inteligencia falsa', async () => {
    const t = await token('user_ingesta', { fea: 'u:scholaris' });
    const original = new TextEncoder().encode('# Vigilar\n\nEl panóptico de Bentham…');
    const s = await api('/subidas', { token: t, cuerpo: { nombre: 'ensayo.md', mime: 'text/markdown', bytes: original.byteLength, metadatos: { anio: 1975 } } });
    expect(s.estado).toBe(201);
    expect(s.cuerpo.original.modo).toBe('simple');

    // El original, por la URL firmada que da la API (sin credenciales S3: pasa por el Worker).
    const put = await SELF.fetch(s.cuerpo.original.url, { method: 'PUT', body: original, headers: s.cuerpo.original.cabeceras });
    expect(put.status).toBe(200);

    const paquete = paqueteDocumento([
      'El panóptico de Bentham es una figura arquitectónica de la vigilancia: el vigilado nunca sabe si lo miran.',
      'La disciplina fabrica individuos; es la técnica específica de un poder que toma a los individuos como objetos.',
      'Las prisiones, las escuelas y los cuarteles comparten la misma tecnología del encierro.',
    ]);
    const rec = await api(`/subidas/${s.cuerpo.subida}/recursos`, { token: t, cuerpo: { recursos: [{ ruta: 'paquete.json', mime: 'application/json' }] } });
    expect(rec.estado).toBe(200);
    const up = await SELF.fetch(rec.cuerpo.recursos[0].subida.url, { method: 'PUT', body: JSON.stringify(paquete), headers: { 'content-type': 'application/json' } });
    expect(up.status).toBe(200);

    const ing = await api(`/subidas/${s.cuerpo.subida}/ingestar`, { token: t, cuerpo: { paquete: 'paquete.json' } });
    expect(ing.estado).toBe(202);
    const tarea = await esperarTarea(t, ing.cuerpo.tarea);
    expect(tarea.error).toBeUndefined();
    expect(tarea.estado).toBe('listo');

    const doc = await api(`/documentos/${ing.cuerpo.documento}`, { token: t });
    expect(doc.cuerpo.estado).toBe('listo');
    expect(doc.cuerpo.metadatos.anio).toBe(1975);
    expect(doc.cuerpo.cuentas.fragmentos).toBeGreaterThan(0);
    expect(doc.cuerpo.original).toContain(`/d/${ing.cuerpo.documento}/original.md`);

    const lista = await api('/documentos?orden=titulo&dir=asc', { token: t });
    expect(lista.cuerpo.elementos.some((d: { id: string }) => d.id === ing.cuerpo.documento)).toBe(true);

    const b = await api('/busqueda', { token: t, cuerpo: { consulta: 'panóptico de Bentham', k: 5 } });
    expect(b.estado).toBe(200);
    expect(b.cuerpo.resultados.length).toBeGreaterThan(0);
    expect(b.cuerpo.resultados[0].fragmento.texto).toMatch(/panóptico/);
    expect(b.cuerpo.resultados[0].citaCorta).toMatch(/Foucault, 1975/);

    // En dos tiempos (SSE): termina con «final», con los mismos resultados que la JSON.
    const dos = await api('/busqueda', { token: t, cuerpo: { consulta: 'panóptico de Bentham', k: 5 }, cabeceras: { accept: 'text/event-stream' } });
    expect(dos.estado).toBe(200);
    expect(dos.r.headers.get('content-type')).toContain('text/event-stream');
    const eventos = String(dos.cuerpo).split('\n').filter((l) => l.startsWith('event: ')).map((l) => l.slice(7));
    expect(eventos.at(-1)).toBe('final');
    expect(eventos.every((e) => e === 'preliminar' || e === 'final')).toBe(true);
    const datosFinal = JSON.parse(String(dos.cuerpo).split('\n').filter((l) => l.startsWith('data: ')).at(-1)!.slice(6));
    expect(datosFinal.respuesta.resultados[0].fragmento.texto).toMatch(/panóptico/);

    // La búsqueda quedó en el historial (montado desde @scholaris/funciones).
    const h = await api('/historial', { token: t });
    expect(h.estado).toBe(200);

    // Y el original se descarga por URL firmada.
    const o = await api(`/documentos/${ing.cuerpo.documento}/original`, { token: t });
    const bin = await SELF.fetch(o.cuerpo.url, { headers: { range: 'bytes=0-8' } });
    expect(bin.status).toBe(206);
    expect(await bin.text()).toBe('# Vigilar');
    // «bytes=0-» (lo primero que pide un <video>) llega entero en flujo, como 206.
    const abierto = await SELF.fetch(o.cuerpo.url, { headers: { range: 'bytes=2-' } });
    expect(abierto.status).toBe(206);
    expect(abierto.headers.get('content-range')).toMatch(/^bytes 2-\d+\/\d+$/);
    expect(await abierto.text()).toBe('Vigilar\n\nEl panóptico de Bentham…');

    // Exportar el .spdf en el servidor (sqlite-wasm en workerd) e importarlo como copia.
    const sp = await SELF.fetch(`${BASE}/documentos/${ing.cuerpo.documento}/spdf`, { headers: { authorization: `Bearer ${t}` } });
    expect(sp.status).toBe(200);
    const bytesSpdf = new Uint8Array(await sp.arrayBuffer());
    expect(bytesSpdf[0]).toBe(0x1f); // gzip
    const imp = await api('/documentos/importar', { token: t, cuerpo: bytesSpdf, cabeceras: { 'content-type': 'application/x-spdf' } });
    expect(imp.estado).toBe(201);
    expect(imp.cuerpo.versionOrigen).toBe(400);
    expect(imp.cuerpo.documento).not.toBe(ing.cuerpo.documento);
    const copia = await api(`/documentos/${imp.cuerpo.documento}`, { token: t });
    expect(copia.cuerpo.cuentas.fragmentos).toBe(doc.cuerpo.cuentas.fragmentos);

    // Borrar deja la estantería limpia.
    expect((await api(`/documentos/${ing.cuerpo.documento}`, { token: t, metodo: 'DELETE' })).estado).toBe(200);
    expect((await api(`/documentos/${ing.cuerpo.documento}`, { token: t })).estado).toBe(404);
  });

  it('una subida por partes pasa por la API y se completa', async () => {
    const t = await token('user_partes', { fea: 'u:scholaris' });
    const bytes = 70 * 1024 * 1024;
    const s = await api('/subidas', { token: t, cuerpo: { nombre: 'grande.pdf', mime: 'application/pdf', bytes } });
    expect(s.cuerpo.original.modo).toBe('partes');
    const partes = await api(`/subidas/${s.cuerpo.subida}/partes`, { token: t, cuerpo: { numeros: [1, 2] } });
    expect(partes.cuerpo.partes).toHaveLength(2);
    const tam = s.cuerpo.original.tamParte as number;
    const etags = [];
    for (const [i, p] of (partes.cuerpo.partes as Array<{ numero: number; url: string }>).entries()) {
      const r = await SELF.fetch(p.url, { method: 'PUT', body: new Uint8Array(i === 0 ? tam : 1024).fill(37) });
      expect(r.status).toBe(200);
      etags.push({ numero: p.numero, etag: r.headers.get('etag')! });
    }
    const c = await api(`/subidas/${s.cuerpo.subida}/completar`, { token: t, cuerpo: { partes: etags } });
    expect(c.estado).toBe(200);
    const cab = await env.BUCKET.head(s.cuerpo.original.clave);
    expect(cab?.size).toBe(tam + 1024);
  });
});

describe('rehacer folios sin releer', () => {
  it('quita los folios inventados de las guardas en blanco y reancla los fragmentos', async () => {
    const t = await token('user_folios', { fea: 'u:scholaris' });
    const bytes = Uint8Array.from(atob(SPDF_FOLIOS_B64), (ch) => ch.charCodeAt(0));
    const imp = await api('/documentos/importar', { token: t, cuerpo: bytes, cabeceras: { 'content-type': 'application/x-spdf' } });
    expect(imp.estado).toBe(201);
    const id = imp.cuerpo.documento as string;
    // La importación sin vectores del espacio actual lanza una tarea (vectores, indexado): mientras, no se rehace.
    if (imp.cuerpo.tarea) {
      expect((await api(`/documentos/${id}/folios/rehacer`, { token: t, cuerpo: {} })).estado).toBe(409);
      expect((await esperarTarea(t, imp.cuerpo.tarea)).estado).toBe('listo');
    }
    const folio = async (fisica: number) => ((await api(`/documentos/${id}/folios`, { token: t })).cuerpo.folios as Array<{ fisica?: number; impresa: string | null }>).find((f) => f.fisica === fisica)?.impresa;
    expect(await folio(10)).toBe('9');

    const sim = await api(`/documentos/${id}/folios/rehacer`, { token: t, cuerpo: { juez: false, simular: true } });
    expect(sim.estado).toBe(200);
    expect(sim.cuerpo).toMatchObject({ simulado: true, unidades: 12, cambiadas: 3, fuente: 'secuencia' });
    expect(await folio(10)).toBe('9');

    const r = await api(`/documentos/${id}/folios/rehacer`, { token: t, cuerpo: { juez: false } });
    expect(r.estado).toBe(200);
    expect(r.cuerpo.cambios).toEqual(['10: 9 → —', '11: 10 → —', '12: 11 → —']);
    expect(r.cuerpo.fragmentos).toBe(1);
    expect(await folio(9)).toBe('8');
    expect(await folio(10)).toBeNull();
    const fr = await api(`/documentos/${id}/fragmentos`, { token: t });
    expect(fr.cuerpo[0].anclaFin.impresa).toBeNull();

    // Idempotente; y un documento ajeno o inexistente da 404.
    expect((await api(`/documentos/${id}/folios/rehacer`, { token: t, cuerpo: { juez: false } })).cuerpo.actualizadas).toBe(0);
    expect((await api('/documentos/no-existe/folios/rehacer', { token: t, cuerpo: {} })).estado).toBe(404);
    const otro = await token('user_folios_otro', { fea: 'u:scholaris' });
    expect((await api(`/documentos/${id}/folios/rehacer`, { token: otro, cuerpo: {} })).estado).toBe(404);
  });
});

describe('tiempo real y MCP', () => {
  it('el billete abre el WebSocket y saluda', async () => {
    const t = await token('user_ws');
    const b = await api('/tiempo-real/billete', { token: t, cuerpo: {} });
    expect(b.cuerpo.url).toMatch(/^wss:\/\/scholaris\.prueba\/api\/v2\/tiempo-real\?billete=/);
    const r = await SELF.fetch(b.cuerpo.url.replace('wss:', 'https:'), { headers: { upgrade: 'websocket' } });
    expect(r.status).toBe(101);
    const ws = r.webSocket!;
    const llegado = new Promise<string>((res) => ws.addEventListener('message', (e: MessageEvent) => res(String(e.data))));
    ws.accept();
    expect(JSON.parse(await llegado)).toMatchObject({ tipo: 'hola', usuario: 'user_ws' });
    ws.close();
    const malo = await SELF.fetch(`${BASE}/tiempo-real?billete=nada`, { headers: { upgrade: 'websocket' } });
    expect(malo.status).toBe(401);
  });

  it('MCP lista las herramientas', async () => {
    const t = await token('user_mcp');
    const r = await SELF.fetch('https://scholaris.prueba/mcp', {
      method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { result: { tools: Array<{ name: string }> } };
    expect(j.result.tools.map((x) => x.name)).toEqual(['search', 'cite', 'open_page', 'verify_claim']);
  });
});

/** Sube e ingiere un documento de texto y devuelve su id. */
async function ingestar(t: string, nombre: string, textos: string[], bibliotecas: string[] = [], prefijo = ''): Promise<string> {
  const original = new TextEncoder().encode(textos.join('\n\n'));
  const s = await api(`${prefijo}/subidas`, { token: t, cuerpo: { nombre, mime: 'text/markdown', bytes: original.byteLength, bibliotecas } });
  expect(s.estado).toBe(201);
  await SELF.fetch(s.cuerpo.original.url, { method: 'PUT', body: original });
  const rec = await api(`${prefijo}/subidas/${s.cuerpo.subida}/recursos`, { token: t, cuerpo: { recursos: [{ ruta: 'paquete.json', mime: 'application/json' }] } });
  const p = paqueteDocumento(textos);
  p.origen = { ...p.origen, nombre, huella: `h-${nombre}` };
  p.metadatos = { titulo: nombre, autores: [{ nombre: 'Ana', apellidos: 'Autora' }] };
  await SELF.fetch(rec.cuerpo.recursos[0].subida.url, { method: 'PUT', body: JSON.stringify(p) });
  const ing = await api(`${prefijo}/subidas/${s.cuerpo.subida}/ingestar`, { token: t, cuerpo: { paquete: 'paquete.json' } });
  expect(ing.estado).toBe(202);
  const tarea = await esperarTarea(t, ing.cuerpo.tarea, 45_000, prefijo);
  expect(tarea.estado).toBe('listo');
  return ing.cuerpo.documento;
}

describe('bibliotecas compartidas', () => {
  it('el invitado lee y busca solo dentro de la biblioteca, con su permiso', async () => {
    const dueno = await token('user_dueno', { fea: 'u:scholaris' });
    const lector = await token('user_lector');
    const editor = await token('user_editor');
    const ajeno = await token('user_ajeno');
    for (const t of [lector, editor, ajeno]) await api('/auth/yo', { token: t }); // alta con su correo

    const bib = (await api('/bibliotecas', { token: dueno, cuerpo: { nombre: 'Seminario de Foucault' } })).cuerpo;
    const dentro = await ingestar(dueno, 'Compartido', ['El panóptico es una máquina de ver sin ser visto.'], [bib.id]);
    const fuera = await ingestar(dueno, 'Privado', ['Mis notas privadas sobre el panóptico y la sociedad disciplinaria.']);

    expect((await api(`/bibliotecas/${bib.id}/compartir`, { token: dueno, cuerpo: { correo: 'user_lector@prueba.es', permiso: 'lectura' } })).estado).toBe(201);
    expect((await api(`/bibliotecas/${bib.id}/compartir`, { token: dueno, cuerpo: { correo: 'user_editor@prueba.es', permiso: 'edicion' } })).estado).toBe(201);

    const lista = (await api('/bibliotecas', { token: lector })).cuerpo as Array<{ id: string; permiso: string; propietario: string }>;
    expect(lista.find((b) => b.id === bib.id)).toMatchObject({ permiso: 'lectura', propietario: 'user_dueno' });

    const C = `/compartidas/${bib.id}`;
    const docs = await api(`${C}/documentos`, { token: lector });
    expect(docs.cuerpo.elementos.map((d: { id: string }) => d.id)).toEqual([dentro]);
    expect((await api(`${C}/documentos/${dentro}`, { token: lector })).estado).toBe(200);
    expect((await api(`${C}/documentos/${fuera}`, { token: lector })).estado).toBe(404);

    const b = await api(`${C}/busqueda`, { token: lector, cuerpo: { consulta: 'panóptico' } });
    expect(b.estado).toBe(200);
    expect(b.cuerpo.resultados.length).toBeGreaterThan(0);
    expect(b.cuerpo.resultados.every((r: { documento: { id: string } }) => r.documento.id === dentro)).toBe(true);

    // El lector no edita ni sale de la biblioteca; tampoco toca lo del propietario.
    expect((await api(`${C}/documentos/${dentro}/metadatos`, { token: lector, metodo: 'PATCH', cuerpo: { titulo: 'X' } })).estado).toBe(403);
    expect((await api(`${C}/claves`, { token: lector })).estado).toBe(403);
    expect((await api(`${C}/historial`, { token: lector })).estado).toBe(403);
    expect((await api(`/documentos/${dentro}`, { token: lector })).estado).toBe(404);

    // El editor cambia metadatos y sube a la biblioteca (entra en la estantería del propietario).
    expect((await api(`${C}/documentos/${dentro}/metadatos`, { token: editor, metodo: 'PATCH', cuerpo: { titulo: 'Compartido (revisado)' } })).estado).toBe(200);
    const nuevo = await ingestar(editor, 'Aportado', ['Un texto que aporta el editor sobre la vigilancia.'], [], C);
    const delDueno = await api('/documentos', { token: dueno });
    expect(delDueno.cuerpo.elementos.find((d: { id: string }) => d.id === nuevo)?.bibliotecas).toEqual([bib.id]);

    // Quien no está invitado no ve nada.
    expect((await api(`${C}/documentos`, { token: ajeno })).estado).toBe(404);
  });
});

describe('imágenes de página', () => {
  it('las URLs firmadas de las unidades resuelven la clave relativa del paquete', async () => {
    const t = await token('user_imagenes', { fea: 'u:scholaris' });
    const pdf = new TextEncoder().encode('%PDF-1.4 falso');
    const s = await api('/subidas', { token: t, cuerpo: { nombre: 'libro.pdf', mime: 'application/pdf', bytes: pdf.byteLength } });
    await SELF.fetch(s.cuerpo.original.url, { method: 'PUT', body: pdf });
    const cuerpo = 'Este es el cuerpo de la página con texto suficiente para que la capa se considere útil y no haga falta visión.';
    const paginas = [1, 2].map((fisica) => ({
      fisica, ancho: 595, alto: 842, rotacion: 0, etiqueta: String(fisica), clase: 'pdf' as const,
      texto: { util: true, calidad: 0.95, origen: 'digital' as const, caracteres: cuerpo.length, basura: 0, palabrasRaras: 0, coberturaImagen: 0 },
      cuerpo, lineas: [], bloques: [{ x: 0.1, y: 0.1, w: 0.8, h: 0.1, lineas: [], texto: cuerpo, tam: 10 }], cabecera: [], pie: [], candidatosFolio: [], imagenes: [],
      imagen: `paginas/000${fisica}.jpg`, ms: 1,
    }));
    const paquete = {
      version: 1, tipo: 'pdf', origen: { nombre: 'libro.pdf', mime: 'application/pdf', bytes: pdf.byteLength, huella: 'h-libro' }, metadatos: { titulo: 'Libro' }, unidades: 2,
      contenido: { clase: 'pdf', paginas, esquema: [], etiquetas: ['1', '2'], mixto: false, paginasEscaneadas: [], titulillos: { cabecera: [], pie: [] }, info: {}, xmp: null, cifrado: false },
      partes: paginas.map((p) => ({ id: p.imagen, clase: 'pagina', mime: 'image/jpeg', bytes: 4, unidad: p.fisica })), reserva: null, avisos: [], entorno: 'navegador', tiempos: {},
    };
    const rec = await api(`/subidas/${s.cuerpo.subida}/recursos`, { token: t, cuerpo: { recursos: [{ ruta: 'paquete.json', mime: 'application/json' }, ...paginas.map((p) => ({ ruta: p.imagen, mime: 'image/jpeg' }))] } });
    for (const r of rec.cuerpo.recursos) {
      await SELF.fetch(r.subida.url, { method: 'PUT', body: r.ruta === 'paquete.json' ? JSON.stringify(paquete) : new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), headers: r.subida.cabeceras });
    }
    const ing = await api(`/subidas/${s.cuerpo.subida}/ingestar`, { token: t, cuerpo: { paquete: 'paquete.json' } });
    expect((await esperarTarea(t, ing.cuerpo.tarea)).estado).toBe('listo');
    const us = await api(`/documentos/${ing.cuerpo.documento}/unidades?desde=0&hasta=5`, { token: t });
    expect(us.cuerpo).toHaveLength(2);
    expect(us.cuerpo[0].orden).toBe(0);
    expect(us.cuerpo.every((u: { id: string }) => !u.id.startsWith('prov:'))).toBe(true);
    const img = await SELF.fetch(us.cuerpo[0].imagenUrl);
    expect(img.status).toBe(200);
    expect(new Uint8Array(await img.arrayBuffer())[0]).toBe(0xff);
    const lista = await api('/documentos', { token: t });
    expect((await SELF.fetch(lista.cuerpo.elementos[0].portadaUrl)).status).toBe(200);
  });

  it('una subida a medias con la misma huella se reanuda (no cuenta como duplicada)', async () => {
    const t = await token('user_reanuda');
    const a = await api('/subidas', { token: t, cuerpo: { nombre: 'x.pdf', mime: 'application/pdf', bytes: 10, huella: 'h-reanuda' } });
    const b = await api('/subidas', { token: t, cuerpo: { nombre: 'x.pdf', mime: 'application/pdf', bytes: 10, huella: 'h-reanuda' } });
    expect(b.cuerpo.duplicado).toBeUndefined();
    expect(b.cuerpo.documento).toBe(a.cuerpo.documento);
    expect(b.cuerpo.subida).toBe(a.cuerpo.subida);
    expect(b.cuerpo.original.url).toBeTruthy();
  });

  it('con paquete, la ingesta empieza aunque el original no haya terminado de subir', async () => {
    const t = await token('user_sin_original', { fea: 'u:scholaris' });
    const original = new TextEncoder().encode('# Nota\n\nUna nota breve sobre la vigilancia y el panóptico.');
    const s = await api('/subidas', { token: t, cuerpo: { nombre: 'nota.md', mime: 'text/markdown', bytes: original.byteLength } });
    const rec = await api(`/subidas/${s.cuerpo.subida}/recursos`, { token: t, cuerpo: { recursos: [{ ruta: 'paquete.json', mime: 'application/json' }] } });
    await SELF.fetch(rec.cuerpo.recursos[0].subida.url, { method: 'PUT', body: JSON.stringify(paqueteDocumento(['Una nota breve sobre la vigilancia y el panóptico.'])) });
    const ing = await api(`/subidas/${s.cuerpo.subida}/ingestar`, { token: t, cuerpo: { paquete: 'paquete.json' } });
    expect(ing.estado).toBe(202);
    // El original llega después: el Workflow lo espera antes de cerrar.
    expect((await SELF.fetch(s.cuerpo.original.url, { method: 'PUT', body: original })).status).toBe(200);
    expect((await esperarTarea(t, ing.cuerpo.tarea, 100_000)).estado).toBe('listo');
  }, 120_000);
});

describe('OAuth del servidor MCP', () => {
  it('registro, autorización con Clerk, token y llamada a /mcp', async () => {
    const O = 'https://scholaris.prueba';
    const meta = await (await SELF.fetch(`${O}/.well-known/oauth-authorization-server`)).json() as { authorization_endpoint: string; token_endpoint: string; registration_endpoint: string };
    expect(meta.authorization_endpoint).toBe(`${O}/oauth/autorizar`);
    const reg = await (await SELF.fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Cliente MCP de prueba', redirect_uris: ['http://localhost:9999/vuelta'], token_endpoint_auth_method: 'none' }) })).json() as { client_id: string };
    expect(reg.client_id).toBeTruthy();

    const verificador = 'v'.repeat(50);
    const reto = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificador))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const consulta = `?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent('http://localhost:9999/vuelta')}&scope=mcp&state=xyz&code_challenge=${reto}&code_challenge_method=S256&resource=${encodeURIComponent(`${O}/mcp`)}`;
    const pagina = await SELF.fetch(`${O}/oauth/autorizar${consulta}`);
    expect(pagina.status).toBe(200);
    expect(await pagina.text()).toContain('Cliente MCP de prueba');

    const t = await token('user_oauth', { fea: 'u:scholaris' });
    const fin = await (await SELF.fetch(`${O}/oauth/autorizar/completar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ consulta, token: t }) })).json() as { redirectTo: string };
    const codigo = new URL(fin.redirectTo).searchParams.get('code')!;
    expect(new URL(fin.redirectTo).searchParams.get('state')).toBe('xyz');

    const tok = await (await SELF.fetch(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: codigo, redirect_uri: 'http://localhost:9999/vuelta', client_id: reg.client_id, code_verifier: verificador, resource: `${O}/mcp` }) })).json() as { access_token: string };
    expect(tok.access_token).toBeTruthy();

    const llamar = (bearer: string) => SELF.fetch(`${O}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    const r = await llamar(tok.access_token);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { result: { tools: unknown[] } }).result.tools).toHaveLength(4);
    expect((await llamar('token-inventado')).status).toBe(401);
    // Sin token: 401 con la pista del recurso protegido (descubrimiento del cliente MCP).
    const sin = await SELF.fetch(`${O}/mcp`, { method: 'POST', body: '{}' });
    expect(sin.status).toBe(401);
    expect(sin.headers.get('www-authenticate') ?? '').toContain('resource_metadata');
  });
});
