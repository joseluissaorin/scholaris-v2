/**
 * API pública v1 (/api/v1) en el runtime de Workers, con el Workflow real y la
 * inteligencia falsa: cada verbo, la autenticación con claves, los errores en
 * dos lenguas, la espera (síncrona y asíncrona), la idempotencia y la ingesta
 * por URL con la red simulada.
 */
import { SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importJWK, SignJWT } from 'jose';
import { JWK_PRIVADA } from './clave-prueba.js';

const ORIGEN = 'https://scholaris.prueba';
const V1 = `${ORIGEN}/api/v1`;
const V2 = `${ORIGEN}/api/v2`;

async function sesion(sub: string): Promise<string> {
  const clave = await importJWK(JWK_PRIVADA, 'RS256');
  return new SignJWT({ email: `${sub}@prueba.es`, name: sub, fea: 'u:scholaris' })
    .setProtectedHeader({ alg: 'RS256', kid: 'prueba' })
    .setSubject(sub).setIssuer('https://clerk.prueba').setIssuedAt().setExpirationTime('10m')
    .sign(clave);
}

async function claveDe(sub: string, alcances: string[]): Promise<string> {
  const r = await SELF.fetch(`${V2}/claves`, {
    method: 'POST', headers: { authorization: `Bearer ${await sesion(sub)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ nombre: `v1 ${alcances.join('+')}`, alcances }),
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { secreto: string }).secreto;
}

async function v1(ruta: string, o: { clave?: string; metodo?: string; json?: unknown; cuerpo?: BodyInit; cabeceras?: Record<string, string> } = {}) {
  const h: Record<string, string> = { ...(o.cabeceras ?? {}) };
  if (o.clave) h.authorization = `Bearer ${o.clave}`;
  let body = o.cuerpo;
  if (o.json !== undefined) { body = JSON.stringify(o.json); h['content-type'] = 'application/json'; }
  const r = await SELF.fetch(`${V1}${ruta}`, { method: o.metodo ?? (body !== undefined ? 'POST' : 'GET'), headers: h, body });
  const tipo = r.headers.get('content-type') ?? '';
  return { estado: r.status, cuerpo: (tipo.includes('json') ? await r.json() : await r.text()) as any, r };
}

/** Un PDF mínimo y válido de `n` páginas (sin capa de texto: en el servidor se lee por visión). */
function pdfMinimo(n: number): Uint8Array {
  const objetos: string[] = [];
  const kids = Array.from({ length: n }, (_, i) => `${3 + i} 0 R`).join(' ');
  objetos.push('<< /Type /Catalog /Pages 2 0 R >>');
  objetos.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  for (let i = 0; i < n; i++) objetos.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>');
  let pdf = '%PDF-1.4\n';
  const desplazamientos: number[] = [];
  objetos.forEach((o, i) => { desplazamientos.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${desplazamientos.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

// La red simulada: una página web de ejemplo para la ingesta por URL. El texto es literal de Bentham,
// «Panopticon; or, the Inspection-House» (1791), cartas II y V, en Wikisource:
// https://en.wikisource.org/wiki/Panopticon_or_the_Inspection-House
const HTML = `<!doctype html><html lang="en"><head><title>Panopticon; or, the Inspection-House</title><meta name="author" content="Jeremy Bentham">
<meta name="citation_publication_date" content="1791"></head><body><article><h1>Letters</h1>
<p>The apartment of the inspector occupies the centre; you may call it if you please the inspector’s lodge.</p>
<p>Of this grating, a part sufficiently large opens, in form of a door, to admit the prisoner at his first entrance; and to give admission at any time to the inspector or any of his attendants.</p>
<p>The essence of it consists, then, in the centrality of the inspector’s situation, combined with the wellknown and most effectual contrivances for seeing without being seen.</p>
</article></body></html>`;
const fetchReal = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url.startsWith('https://ejemplo.prueba/')) return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    return fetchReal(entrada as RequestInfo, init);
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = fetchReal; });

describe('API v1: se describe sola', () => {
  it('índice, OpenAPI 3.1 y llms.txt sin clave', async () => {
    const i = await v1('');
    expect(i.estado).toBe(200);
    expect(i.cuerpo.verbos).toContain('GET /api/v1/buscar?q=…');
    const o = await v1('/openapi.json');
    expect(o.cuerpo.openapi).toBe('3.1.0');
    expect(o.cuerpo.servers[0].url).toBe(V1);
    expect(Object.keys(o.cuerpo.paths)).toEqual(expect.arrayContaining(['/documentos', '/buscar', '/preguntar', '/citar', '/verificar', '/documentos/{id}/texto']));
    const l = await v1('/llms.txt');
    expect(l.r.headers.get('content-type')).toContain('text/plain');
    expect(l.cuerpo).toContain(`${V1}/buscar`);
    expect(l.cuerpo).toContain('Authorization: Bearer sch_');
  });

  it('CORS abierto para la v1 (claves, sin cookies)', async () => {
    const r = await SELF.fetch(`${V1}/buscar`, { method: 'OPTIONS', headers: { origin: 'https://cualquiera.ejemplo', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('API v1: autenticación y errores', () => {
  it('sin clave, clave falsa y ruta inexistente: errores en español y en inglés', async () => {
    const a = await v1('/documentos');
    expect(a.estado).toBe(401);
    expect(a.cuerpo.error).toMatchObject({ codigo: 'no_autenticado', estado: 401 });
    expect(a.cuerpo.error.mensaje).toMatch(/sesión/);
    expect(a.cuerpo.error.message).toMatch(/API key/);
    expect(a.cuerpo.error.documentacion).toBe(`${ORIGEN}/api#errores`);
    const b = await v1('/documentos', { clave: 'sch_inventada_0000000000000000' });
    expect(b.estado).toBe(401);
    expect(b.cuerpo.error.mensaje).toMatch(/clave de API/);
    const k = await claveDe('user_v1_errores', ['lectura']);
    const c = await v1('/nada', { clave: k });
    expect(c.estado).toBe(404);
    expect(c.cuerpo.error.message).toMatch(/does not exist/);
    const d = await v1('/buscar', { clave: k });
    expect(d.estado).toBe(400);
    expect(d.cuerpo.error.message).toBe('Missing «q»: what to search for.');
  });

  it('una clave de solo lectura no sube ni borra', async () => {
    const k = await claveDe('user_v1_lectura', ['lectura']);
    const r = await v1('/documentos', { clave: k, json: { url: 'https://ejemplo.prueba/panoptico' } });
    expect(r.estado).toBe(403);
    expect(r.cuerpo.error.codigo).toBe('prohibido');
    expect(r.cuerpo.error.message).toMatch(/scopes/);
    expect((await v1('/documentos', { clave: k })).estado).toBe(200);
  });
});

describe('API v1: subir, leer, buscar, preguntar, citar, verificar, borrar', () => {
  let k = '';
  let web = '';
  beforeAll(async () => { k = await claveDe('user_v1', ['lectura', 'escritura']); });

  it('POST /documentos con { url }: espera y devuelve el documento listo', async () => {
    const r = await v1('/documentos?esperar=90', { clave: k, json: { url: 'https://ejemplo.prueba/panoptico' }, cabeceras: { 'idempotency-key': 'web-1' } });
    expect(r.cuerpo.error).toBeUndefined();
    expect(r.estado).toBe(201);
    expect(r.cuerpo).toMatchObject({ estado: 'listo', tipo: 'web', url: 'https://ejemplo.prueba/panoptico' });
    expect(r.cuerpo.id).toMatch(/^d\w+$/);
    expect(r.cuerpo.enlace).toBe(`${ORIGEN}/lector/${r.cuerpo.id}`);
    expect(r.cuerpo.texto_url).toBe(`${V1}/documentos/${r.cuerpo.id}/texto`);
    expect(r.r.headers.get('location')).toBe(`${V1}/documentos/${r.cuerpo.id}`);
    web = r.cuerpo.id;
    // La misma Idempotency-Key no crea otro: devuelve el mismo.
    const otra = await v1('/documentos', { clave: k, json: { url: 'https://ejemplo.prueba/panoptico' }, cabeceras: { 'idempotency-key': 'web-1' } });
    expect(otra.estado).toBe(200);
    expect(otra.cuerpo.id).toBe(web);
    expect(otra.r.headers.get('idempotent-replayed')).toBe('true');
  });

  it('asíncrono: esperar=0 responde 202 con progreso_url, y GET ?esperar= espera', async () => {
    const r = await v1('/documentos?esperar=0', { clave: k, json: { url: 'https://ejemplo.prueba/disciplina', titulo: 'Disciplina' } });
    expect(r.estado).toBe(202);
    expect(['en_cola', 'procesando']).toContain(r.cuerpo.estado);
    expect(r.cuerpo.progreso_url).toBe(`${V1}/documentos/${r.cuerpo.id}`);
    const d = await v1(`/documentos/${r.cuerpo.id}?esperar=90`, { clave: k });
    expect(d.cuerpo.estado).toBe('listo');
    expect(d.cuerpo.progreso_url).toBeUndefined();
    expect((await v1(`/documentos/${r.cuerpo.id}`, { clave: k, metodo: 'DELETE' })).cuerpo).toMatchObject({ ok: true, borrado: true });
    expect((await v1(`/documentos/${r.cuerpo.id}`, { clave: k })).estado).toBe(404);
  });

  it('POST /documentos con el fichero crudo, deduplicado por huella', async () => {
    const pdf = pdfMinimo(3);
    const r = await v1('/documentos?nombre=libro.pdf&titulo=Libro%20de%20prueba&autores=N%C3%BA%C3%B1ez,%20Mar%C3%ADa%20Jos%C3%A9&anio=2026', {
      clave: k, cuerpo: pdf, cabeceras: { 'content-type': 'application/pdf' },
    });
    expect(r.cuerpo.error).toBeUndefined();
    expect(r.estado).toBe(201);
    expect(r.cuerpo).toMatchObject({ estado: 'listo', tipo: 'pdf_escaneado', titulo: 'Libro de prueba', autores: ['Núñez, María José'], anio: 2026, unidades: 3 });
    expect(r.cuerpo.referencia).toMatch(/Núñez/);
    const dup = await v1('/documentos?nombre=otro.pdf', { clave: k, cuerpo: pdf, cabeceras: { 'content-type': 'application/octet-stream' } });
    expect(dup.estado).toBe(200);
    expect(dup.cuerpo).toMatchObject({ id: r.cuerpo.id, duplicado: true });
    // El texto, por páginas: posición física entre corchetes.
    const t = await v1(`/documentos/${r.cuerpo.id}/texto?desde=[2]&hasta=[3]`, { clave: k });
    expect(t.cuerpo.unidades.map((u: { posicion: number }) => u.posicion)).toEqual([2, 3]);
    expect(t.cuerpo.unidades[1].texto).toMatch(/Página 3/);
    expect(t.cuerpo.unidades[0].enlace).toBe(`${ORIGEN}/lector/${r.cuerpo.id}?u=2`);
    const md = await v1(`/documentos/${r.cuerpo.id}/texto?limite=1&formato=markdown`, { clave: k });
    expect(md.r.headers.get('content-type')).toContain('text/markdown');
    expect(md.cuerpo).toMatch(/^# Libro de prueba/);
    expect(md.cuerpo).toContain('desde=[2]');
    const mal = await v1(`/documentos/${r.cuerpo.id}/texto?desde=999`, { clave: k });
    expect(mal.estado).toBe(404);
    expect(mal.cuerpo.error.message).toMatch(/printed page/);
  });

  it('multipart: campo «archivo»', async () => {
    const f = new FormData();
    f.append('archivo', new File([pdfMinimo(1)], 'hoja.pdf', { type: 'application/pdf' }));
    f.append('titulo', 'Hoja suelta');
    const r = await v1('/documentos?esperar=0', { clave: k, cuerpo: f });
    expect(r.estado).toBe(202);
    expect(r.cuerpo.titulo).toBe('Hoja suelta');
    await v1(`/documentos/${r.cuerpo.id}`, { clave: k, metodo: 'DELETE' });
  });

  it('GET /documentos lista, también en Markdown', async () => {
    const r = await v1('/documentos', { clave: k });
    expect(r.cuerpo.total).toBeGreaterThanOrEqual(2);
    expect(r.cuerpo.documentos.find((d: { id: string }) => d.id === web)).toMatchObject({ estado: 'listo', tipo: 'web' });
    const md = await v1('/documentos', { clave: k, cabeceras: { accept: 'text/markdown' } });
    expect(md.cuerpo).toMatch(/^# Documentos \(\d+\)/);
  });

  it('GET /buscar devuelve pasajes con cita, localizador, ancla y enlace', async () => {
    const r = await v1(`/buscar?q=${encodeURIComponent('apartment of the inspector lodge')}&k=3&documento=${web}`, { clave: k });
    expect(r.estado).toBe(200);
    const p = r.cuerpo.pasajes[0];
    expect(p.texto).toMatch(/apartment of the inspector/);
    // El pasaje: oraciones enteras del fragmento, más cortas que él, y donde dice su rango.
    expect(p.pasaje).toMatch(/apartment of the inspector/);
    expect(p.pasaje.length).toBeLessThanOrEqual(p.texto.length);
    expect(p.pasaje).toMatch(/^[\p{Lu}¿¡«"“—(\d]/u);
    expect(p.pasaje).toMatch(/[.?!…»”")]$/);
    expect(p.texto.slice(p.pasaje_rango[0], p.pasaje_rango[1]).replace(/\s+/g, ' ')).toBe(p.pasaje);
    expect(p.enlace).toContain(`pd=${p.pasaje_rango[0]}`);
    expect(p.documento.id).toBe(web);
    expect(p.cita).toMatch(/^\(Bentham, .*párr\. \d\)$/);
    expect(p.localizador).toMatch(/párr\. \d/);
    expect(p.ancla.tipo).toBe('web');
    expect(p.enlace).toMatch(new RegExp(`^${ORIGEN}/lector/${web}\\?sec=`));
    expect(p.id.startsWith(`${web}:`)).toBe(true);
    const md = await v1(`/buscar?q=grating&formato=markdown`, { clave: k });
    expect(md.cuerpo).toMatch(/^# grating\n\n## 1\. \(/);
    const post = await v1('/buscar', { clave: k, json: { q: 'grating', k: 1 } });
    expect(post.cuerpo.pasajes.length).toBe(1);
  });

  it('POST /preguntar: JSON y SSE', async () => {
    const r = await v1('/preguntar', { clave: k, json: { pregunta: '¿Qué es el panóptico?' } });
    expect(r.estado).toBe(200);
    expect(typeof r.cuerpo.respuesta).toBe('string');
    expect(Array.isArray(r.cuerpo.fuentes)).toBe(true);
    expect(['alta', 'media', 'baja']).toContain(r.cuerpo.confianza);
    const s = await v1('/preguntar', { clave: k, json: { pregunta: '¿Qué es el panóptico?', stream: true } });
    expect(s.r.headers.get('content-type')).toContain('text/event-stream');
    const eventos = String(s.cuerpo).split('\n').filter((l) => l.startsWith('event: ')).map((l) => l.slice(7));
    expect(eventos[0]).toBe('pasajes');
    expect(eventos.at(-1)).toBe('fin');
  });

  it('POST /verificar: veredicto, probabilidad y pasajes con su cita', async () => {
    const r = await v1('/verificar', { clave: k, json: { afirmacion: 'The inspector sees without being seen.' } });
    expect(r.estado).toBe(200);
    expect(['respaldada', 'parcial', 'sin_respaldo', 'contradicha']).toContain(r.cuerpo.veredicto);
    expect(r.cuerpo.respaldada).toBe(r.cuerpo.veredicto === 'respaldada');
    expect(r.cuerpo.pasajes.length).toBeGreaterThan(0);
    expect(r.cuerpo.pasajes[0].documento.titulo).toBeTruthy();
    expect(r.cuerpo.pasajes[0].cita).toMatch(/^\(/);
  });

  it('GET /documentos/{id}/spdf: SPDF 5.0 por defecto, 4.1 con version=4; POST /documentos/importar lo vuelve a meter', async () => {
    const r = await SELF.fetch(`${V1}/documentos/${web}/spdf`, { headers: { authorization: `Bearer ${k}` } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/vnd.spdf+sqlite3');
    expect(r.headers.get('x-spdf-version')).toBe('5.0');
    expect(r.headers.get('content-disposition')).toMatch(/\.spdf/);
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 15))).toBe('SQLite format 3');
    expect([...bytes.subarray(68, 72)]).toEqual([0x53, 0x50, 0x44, 0x46]); // application_id «SPDF»
    const v4 = await SELF.fetch(`${V1}/documentos/${web}/spdf?version=4`, { headers: { authorization: `Bearer ${k}` } });
    expect(v4.status).toBe(200);
    expect(new Uint8Array(await v4.arrayBuffer())[0]).toBe(0x1f); // gzip
    const mal = await v1(`/documentos/${web}/spdf?version=6`, { clave: k });
    expect(mal.estado).toBe(400);
    expect(mal.cuerpo.error.message).toMatch(/Unknown SPDF version/);
    // Misma huella: con deduplicar (por defecto) no se copia.
    const rep = await v1('/documentos/importar', { clave: k, cuerpo: bytes, cabeceras: { 'content-type': 'application/vnd.spdf+sqlite3' } });
    expect(rep.estado).toBe(200);
    expect(rep.cuerpo).toMatchObject({ repetido: true, documento: { id: web } });
    const imp = await v1('/documentos/importar?deduplicar=0', { clave: k, cuerpo: bytes, cabeceras: { 'content-type': 'application/vnd.spdf' } });
    expect(imp.estado).toBe(201);
    expect(imp.cuerpo.version_origen).toBe(500);
    expect(imp.cuerpo.documento.id).not.toBe(web);
    expect(imp.cuerpo.documento.estado).toBe('listo');
  });

  it('POST /citar: síncrono por defecto; esperar=0 y GET /citar/{id}', async () => {
    const texto = 'The inspector sees without being seen. The building is circular.';
    const r = await v1('/citar', { clave: k, json: { texto, estilo: 'apa' } });
    expect(r.cuerpo.error).toBeUndefined();
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ estado: 'listo', estilo: 'apa' });
    expect(typeof r.cuerpo.texto).toBe('string');
    expect(Array.isArray(r.cuerpo.citas)).toBe(true);
    expect(Array.isArray(r.cuerpo.bibliografia)).toBe(true);
    const a = await v1('/citar?esperar=0', { clave: k, json: { texto } });
    expect([200, 202]).toContain(a.estado);
    const fin = await v1(`/citar/${a.cuerpo.id}?esperar=60`, { clave: k });
    expect(fin.cuerpo.estado).toBe('listo');
    const sin = await v1('/citar', { clave: k, json: {} });
    expect(sin.estado).toBe(400);
    expect(sin.cuerpo.error.message).toMatch(/Missing «texto»/);
  });
});
