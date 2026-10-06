/**
 * Las bibliotecas como objetos sociales, en el runtime de Workers: invitaciones
 * que hay que aceptar, roles, seguir y dejar de seguir, enlaces de solo lectura
 * sin cuenta, copias sin volver a leer ni duplicar binarios, paquetes
 * .scholaris, lotes y la búsqueda conjunta. Lo importante es el aislamiento:
 * quien sigue una biblioteca nunca lee nada fuera de ella.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { importJWK, SignJWT } from 'jose';
import type { PaqueteConversion } from '@scholaris/imprenta';
import { abrirZip, crearCliente, importarPaquete, type ManifiestoPaquete } from '@scholaris/contrato';
import { JWK_PRIVADA } from './clave-prueba.js';

const ORIGEN = 'https://scholaris.prueba';
const BASE = `${ORIGEN}/api/v2`;

async function token(sub: string, extra: Record<string, unknown> = {}): Promise<string> {
  const clave = await importJWK(JWK_PRIVADA, 'RS256');
  return new SignJWT({ email: `${sub}@prueba.es`, name: sub.replace('user_', ''), fea: 'u:scholaris', ...extra })
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

function paquete(nombre: string, textos: string[]): PaqueteConversion {
  let parrafo = 0;
  return {
    version: 1, tipo: 'documento',
    origen: { nombre, mime: 'text/markdown', bytes: 100, huella: `h-${nombre}` },
    metadatos: { titulo: nombre, autores: [{ nombre: 'Ana', apellidos: 'Autora' }], anio: 1990, idioma: 'es' },
    unidades: textos.length,
    contenido: {
      clase: 'documento', formato: 'markdown',
      bloques: [{ tipo: 'titulo', nivel: 1, texto: nombre, ruta: [nombre], parrafo: 0 }, ...textos.map((t) => ({ tipo: 'parrafo' as const, texto: t, ruta: [nombre], parrafo: ++parrafo }))],
      notas: [], esquema: [{ titulo: nombre, nivel: 1, fisica: null, bloque: 0 }], paginasImpresas: [],
    },
    partes: [], reserva: null, avisos: [], entorno: 'navegador', tiempos: {},
  };
}

async function esperarTarea(t: string, tarea: string, ms = 45_000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const r = await api(`/tareas/${tarea}`, { token: t });
    if (r.cuerpo.estado === 'listo' || r.cuerpo.estado === 'error') return r.cuerpo;
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error('La tarea no terminó a tiempo');
}

/** Sube un texto con huella y lo ingiere (la huella permite ver los repetidos). */
async function ingestar(t: string, nombre: string, textos: string[], bibliotecas: string[] = [], extra: Record<string, unknown> = {}): Promise<{ documento: string; tarea: string; subida: string }> {
  const original = new TextEncoder().encode(textos.join('\n\n'));
  const s = await api('/subidas', { token: t, cuerpo: { nombre: `${nombre}.md`, mime: 'text/markdown', bytes: original.byteLength, bibliotecas, huella: `h-${nombre}`, ...extra } });
  expect(s.estado).toBe(201);
  await SELF.fetch(s.cuerpo.original.url, { method: 'PUT', body: original });
  const rec = await api(`/subidas/${s.cuerpo.subida}/recursos`, { token: t, cuerpo: { recursos: [{ ruta: 'paquete.json', mime: 'application/json' }] } });
  await SELF.fetch(rec.cuerpo.recursos[0].subida.url, { method: 'PUT', body: JSON.stringify(paquete(nombre, textos)) });
  const ing = await api(`/subidas/${s.cuerpo.subida}/ingestar`, { token: t, cuerpo: { paquete: 'paquete.json' } });
  expect(ing.estado).toBe(202);
  const tarea = await esperarTarea(t, ing.cuerpo.tarea);
  expect(tarea.estado).toBe('listo');
  return { documento: ing.cuerpo.documento, tarea: ing.cuerpo.tarea, subida: s.cuerpo.subida };
}

async function alta(...ts: string[]) { for (const t of ts) await api('/auth/yo', { token: t }); }

async function bytesBajo(prefijo: string): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  do {
    const l = await env.BUCKET.list({ prefix: prefijo, ...(cursor ? { cursor } : {}) });
    for (const o of l.objects) total += o.size;
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return total;
}

/** Una biblioteca de Rosa con dos documentos dentro y uno privado fuera. */
async function escenario(prefijo: string) {
  const dueno = await token(`user_${prefijo}_rosa`);
  await alta(dueno);
  const bib = (await api('/bibliotecas', { token: dueno, cuerpo: { nombre: `Seminario ${prefijo}`, descripcion: 'Lecturas del seminario', derechos: 'uso_privado' } })).cuerpo;
  const otra = (await api('/bibliotecas', { token: dueno, cuerpo: { nombre: `Privada ${prefijo}` } })).cuerpo;
  const a = await ingestar(dueno, `${prefijo}-panoptico`, ['El panóptico es una máquina de ver sin ser visto.', 'La disciplina fabrica cuerpos dóciles.'], [bib.id]);
  const b = await ingestar(dueno, `${prefijo}-archivo`, ['El archivo es la ley de lo que puede ser dicho.'], [bib.id]);
  const fuera = await ingestar(dueno, `${prefijo}-diario`, ['Notas privadas sobre el panóptico que nadie más debe leer.'], [otra.id]);
  return { dueno, bib, otra, dentro: [a.documento, b.documento], fuera: fuera.documento };
}

describe('invitaciones, roles y seguir', () => {
  it('invitar no da acceso hasta aceptar; quien sigue no sale de la biblioteca; revocar y salir cortan el acceso', async () => {
    const { dueno, bib, otra, dentro, fuera } = await escenario('inv');
    const lector = await token('user_inv_lector');
    const admin = await token('user_inv_admin');
    const tercero = await token('user_inv_tercero');
    await alta(lector, admin, tercero);

    const inv = await api(`/bibliotecas/${bib.id}/compartir`, { token: dueno, cuerpo: { correo: 'user_inv_lector@prueba.es', permiso: 'lectura', mensaje: 'Para el jueves', caducaDias: 30 } });
    expect(inv.estado).toBe(201);
    expect(inv.cuerpo).toMatchObject({ estado: 'pendiente', permiso: 'lectura', correoEnviado: false });
    expect(inv.cuerpo.enlace).toMatch(/\/invitaciones\?token=/);

    const C = `/compartidas/${bib.id}`;
    expect((await api(`${C}/documentos`, { token: lector })).estado).toBe(404);
    const bandeja = (await api('/invitaciones', { token: lector })).cuerpo;
    expect(bandeja).toHaveLength(1);
    expect(bandeja[0]).toMatchObject({ biblioteca: bib.id, nombre: bib.nombre, mensaje: 'Para el jueves', derechos: 'uso_privado' });
    expect((await api('/notificaciones?pendientes=1', { token: lector })).cuerpo.some((n: { tipo: string }) => n.tipo === 'invitacion')).toBe(true);
    // Nadie más puede aceptarla por su id.
    expect((await api(`/invitaciones/${bandeja[0].id}/aceptar`, { token: tercero, cuerpo: {} })).estado).toBe(404);

    const acepta = await api(`/invitaciones/${bandeja[0].id}/aceptar`, { token: lector, cuerpo: {} });
    expect(acepta.estado).toBe(200);
    expect(acepta.cuerpo).toMatchObject({ biblioteca: bib.id, permiso: 'lectura', propietario: { id: 'user_inv_rosa' } });
    expect((await api('/seguidas', { token: lector })).cuerpo.map((s: { biblioteca: string }) => s.biblioteca)).toEqual([bib.id]);
    expect((await api('/notificaciones', { token: dueno })).cuerpo.some((n: { tipo: string }) => n.tipo === 'invitacion_aceptada')).toBe(true);

    // Dentro, solo lo de la biblioteca.
    const docs = await api(`${C}/documentos`, { token: lector });
    expect(docs.cuerpo.elementos.map((d: { id: string }) => d.id).sort()).toEqual([...dentro].sort());
    expect((await api(`${C}/documentos/${fuera}`, { token: lector })).estado).toBe(404);
    expect((await api(`${C}/documentos/${fuera}/unidades`, { token: lector })).estado).toBe(404);
    expect((await api(`${C}/documentos/${fuera}/spdf`, { token: lector })).estado).toBe(404);
    expect((await api(`/compartidas/${otra.id}/documentos`, { token: lector })).estado).toBe(404);
    expect((await api(`${C}/bibliotecas/${otra.id}`, { token: lector })).estado).toBe(404);
    expect((await api(`${C}/bibliotecas/${otra.id}/paquete`, { token: lector })).estado).toBe(404);
    expect((await api(`${C}/bibliotecas`, { token: lector })).estado).toBe(403);
    const b = await api(`${C}/busqueda`, { token: lector, cuerpo: { consulta: 'panóptico' } });
    expect(b.cuerpo.resultados.length).toBeGreaterThan(0);
    expect(b.cuerpo.resultados.every((r: { documento: { id: string } }) => dentro.includes(r.documento.id))).toBe(true);
    // Un lector no invita ni crea enlaces.
    expect((await api(`/bibliotecas/${bib.id}/compartir`, { token: lector, cuerpo: { correo: 'x@prueba.es', permiso: 'lectura' } })).estado).toBe(403);
    expect((await api('/enlaces', { token: lector, cuerpo: { biblioteca: bib.id, confirmarDerechos: true } })).estado).toBe(403);

    // Un administrador sí invita, y ve a los miembros.
    await api(`/bibliotecas/${bib.id}/compartir`, { token: dueno, cuerpo: { correo: 'user_inv_admin@prueba.es', permiso: 'administrador' } });
    const invAdmin = (await api('/invitaciones', { token: admin })).cuerpo[0];
    await api(`/invitaciones/${invAdmin.id}/aceptar`, { token: admin, cuerpo: {} });
    expect((await api(`/bibliotecas/${bib.id}/compartir`, { token: admin, cuerpo: { correo: 'user_inv_tercero@prueba.es', permiso: 'edicion' } })).estado).toBe(201);
    const miembros = (await api(`/bibliotecas/${bib.id}/miembros`, { token: admin })).cuerpo as Array<{ correo: string; permiso: string; pendiente: boolean }>;
    expect(miembros.map((m) => m.permiso)).toEqual(['propietario', 'lectura', 'administrador', 'edicion']);
    expect(miembros.find((m) => m.correo === 'user_inv_tercero@prueba.es')?.pendiente).toBe(true);
    // El tercero rechaza: ni accede ni le queda pendiente.
    const invTercero = (await api('/invitaciones', { token: tercero })).cuerpo[0];
    expect((await api(`/invitaciones/${invTercero.id}/rechazar`, { token: tercero, cuerpo: {} })).estado).toBe(200);
    expect((await api(`${C}/documentos`, { token: tercero })).estado).toBe(404);
    expect((await api('/invitaciones', { token: tercero })).cuerpo).toHaveLength(0);

    // Cambiar de permiso: el lector pasa a editor y puede tocar metadatos.
    expect((await api(`${C}/documentos/${dentro[0]}/metadatos`, { token: lector, metodo: 'PATCH', cuerpo: { titulo: 'X' } })).estado).toBe(403);
    expect((await api(`/bibliotecas/${bib.id}/miembros/user_inv_lector`, { token: dueno, metodo: 'PATCH', cuerpo: { permiso: 'edicion' } })).cuerpo.permiso).toBe('edicion');
    expect((await api(`${C}/documentos/${dentro[0]}/metadatos`, { token: lector, metodo: 'PATCH', cuerpo: { titulo: 'Panóptico (revisado)' } })).estado).toBe(200);

    // Caducado: deja de valer.
    await env.DB.prepare("UPDATE comparticiones SET caduca = '2000-01-01T00:00:00.000Z' WHERE biblioteca = ? AND usuario = ?").bind(bib.id, 'user_inv_lector').run();
    expect((await api(`${C}/documentos`, { token: lector })).estado).toBe(404);
    await env.DB.prepare('UPDATE comparticiones SET caduca = NULL WHERE biblioteca = ? AND usuario = ?').bind(bib.id, 'user_inv_lector').run();
    expect((await api(`${C}/documentos`, { token: lector })).estado).toBe(200);

    // Revocar corta el acceso al momento; dejar de seguir, también.
    expect((await api(`/bibliotecas/${bib.id}/miembros/user_inv_lector`, { token: dueno, metodo: 'DELETE' })).estado).toBe(200);
    expect((await api(`${C}/documentos`, { token: lector })).estado).toBe(404);
    expect((await api('/notificaciones', { token: lector })).cuerpo.some((n: { tipo: string }) => n.tipo === 'acceso_retirado')).toBe(true);
    expect((await api(`/seguidas/${bib.id}`, { token: admin, metodo: 'DELETE' })).estado).toBe(200);
    expect((await api(`${C}/documentos`, { token: admin })).estado).toBe(404);
  });

  it('el enlace del correo vale para quien no tenía cuenta todavía', async () => {
    const { dueno, bib } = await escenario('correo');
    const inv = (await api(`/bibliotecas/${bib.id}/compartir`, { token: dueno, cuerpo: { correo: 'nueva-persona@otro.es', permiso: 'lectura' } })).cuerpo;
    const tokenInv = new URL(inv.enlace).searchParams.get('token')!;
    // Se registra con otro correo y abre el enlace.
    const nueva = await token('user_correo_nueva', { email: 'otra-direccion@otro.es' });
    await alta(nueva);
    expect((await api(`/invitaciones/token/${tokenInv}`, { token: nueva })).cuerpo.nombre).toBe(bib.nombre);
    expect((await api(`/invitaciones/${tokenInv}/aceptar`, { token: nueva, cuerpo: {} })).estado).toBe(200);
    expect((await api(`/compartidas/${bib.id}/documentos`, { token: nueva })).estado).toBe(200);
    // Ya reclamada: no la usa nadie más.
    const otro = await token('user_correo_otro');
    await alta(otro);
    expect((await api(`/invitaciones/${tokenInv}/aceptar`, { token: otro, cuerpo: {} })).estado).toBe(404);
  });
});

describe('enlaces de solo lectura', () => {
  it('sin cuenta: se lee y se busca dentro, nada fuera, nada de escribir; la contraseña y la revocación funcionan', async () => {
    const { dueno, bib, dentro, fuera } = await escenario('pub');
    // Obras con derechos: hay que confirmar el uso privado.
    const sin = await api('/enlaces', { token: dueno, cuerpo: { biblioteca: bib.id } });
    expect(sin.estado).toBe(409);
    expect(sin.cuerpo.error.mensaje).toMatch(/uso privado/);
    const e = (await api('/enlaces', { token: dueno, cuerpo: { biblioteca: bib.id, confirmarDerechos: true, caducaDias: 7 } })).cuerpo;
    expect(e.url).toBe(`${ORIGEN}/p/${e.token}`);

    const P = `/publico/${e.token}`;
    const vista = await api(P);
    expect(vista.estado).toBe(200);
    expect(vista.r.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect(vista.cuerpo).toMatchObject({ tipo: 'biblioteca', titulo: bib.nombre, documentos: 2, derechos: 'uso_privado', de: 'pub_rosa', conClave: false });
    const docs = await api(`${P}/documentos`);
    expect(docs.cuerpo.elementos.map((d: { id: string }) => d.id).sort()).toEqual([...dentro].sort());
    expect((await api(`${P}/documentos/${dentro[0]}/unidades?desde=0&hasta=5`)).estado).toBe(200);
    expect((await api(`${P}/documentos/${fuera}`)).estado).toBe(404);
    const b = await api(`${P}/busqueda`, { cuerpo: { consulta: 'panóptico' } });
    expect(b.estado).toBe(200);
    expect(b.cuerpo.resultados.every((r: { documento: { id: string } }) => dentro.includes(r.documento.id))).toBe(true);
    // Ni escribir, ni preguntar a la IA, ni bajarse el .spdf, ni el paquete.
    expect((await api(`${P}/documentos/${dentro[0]}/metadatos`, { metodo: 'PATCH', cuerpo: { titulo: 'X' } })).estado).toBe(403);
    expect((await api(`${P}/busqueda/responder`, { cuerpo: { consulta: 'x' } })).estado).toBe(403);
    expect((await api(`${P}/documentos/${dentro[0]}/spdf`)).estado).toBe(403);
    expect((await api(`${P}/bibliotecas/${bib.id}/paquete`)).estado).toBe(403);
    expect((await api(`${P}/historial`)).estado).toBe(403);
    expect((await api('/enlaces', { token: dueno })).estado).toBe(404);
    const lista = (await api(`/bibliotecas/${bib.id}/enlaces`, { token: dueno })).cuerpo;
    expect(lista[0].visitas).toBeGreaterThan(0);

    // Revocar: deja de funcionar todo, también lo que ya se tenía abierto.
    expect((await api(`/enlaces/${e.id}`, { token: dueno, metodo: 'DELETE' })).estado).toBe(200);
    expect((await api(P)).estado).toBe(404);
    expect((await api(`${P}/documentos`)).estado).toBe(404);
    expect((await api(`${P}/busqueda`, { cuerpo: { consulta: 'panóptico' } })).estado).toBe(404);

    // Con contraseña.
    const ec = (await api('/enlaces', { token: dueno, cuerpo: { biblioteca: bib.id, confirmarDerechos: true, clave: 'foucault' } })).cuerpo;
    const PC = `/publico/${ec.token}`;
    expect((await api(PC)).cuerpo.conClave).toBe(true);
    expect((await api(`${PC}/documentos`)).estado).toBe(401);
    expect((await api(`${PC}/acceso`, { cuerpo: { clave: 'deleuze' } })).estado).toBe(403);
    const pase = (await api(`${PC}/acceso`, { cuerpo: { clave: 'foucault' } })).cuerpo.pase;
    expect((await api(`${PC}/documentos`, { cabeceras: { 'x-scholaris-pase': pase } })).estado).toBe(200);
    // El pase de un enlace no abre otro.
    const ec2 = (await api('/enlaces', { token: dueno, cuerpo: { biblioteca: bib.id, confirmarDerechos: true, clave: 'otra' } })).cuerpo;
    expect((await api(`/publico/${ec2.token}/documentos`, { cabeceras: { 'x-scholaris-pase': pase } })).estado).toBe(401);

    // Caducado.
    await env.DB.prepare("UPDATE enlaces SET caduca = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(ec.id).run();
    expect((await api(`${PC}/documentos`, { cabeceras: { 'x-scholaris-pase': pase } })).estado).toBe(404);

    // Un solo documento: solo ese.
    const ed = (await api('/enlaces', { token: dueno, cuerpo: { documento: dentro[1], confirmarDerechos: true } })).cuerpo;
    const PD = `/publico/${ed.token}`;
    expect((await api(PD)).cuerpo).toMatchObject({ tipo: 'documento', documentos: 1 });
    expect((await api(`${PD}/documentos`)).cuerpo.elementos.map((d: { id: string }) => d.id)).toEqual([dentro[1]]);
    expect((await api(`${PD}/documentos/${dentro[0]}`)).estado).toBe(404);
    expect((await api(`${PD}/bibliotecas/${bib.id}`)).estado).toBe(404);
    const bd = await api(`${PD}/busqueda`, { cuerpo: { consulta: 'panóptico archivo' } });
    expect(bd.cuerpo.resultados.every((r: { documento: { id: string } }) => r.documento.id === dentro[1])).toBe(true);
  });

  it('desde un enlace: seguir (mientras viva) y copiar a mi biblioteca', async () => {
    const { dueno, bib, dentro } = await escenario('enl');
    const yo = await token('user_enl_visita');
    await alta(yo);
    const e = (await api('/enlaces', { token: dueno, cuerpo: { biblioteca: bib.id, confirmarDerechos: true } })).cuerpo;
    const s = await api('/seguidas', { token: yo, cuerpo: { enlace: e.token } });
    expect(s.estado).toBe(201);
    expect(s.cuerpo).toMatchObject({ biblioteca: bib.id, permiso: 'lectura', porEnlace: true });
    expect((await api(`/compartidas/${bib.id}/documentos`, { token: yo })).cuerpo.elementos).toHaveLength(2);
    // Quien sigue por un enlace no aparece entre los miembros con nombre.
    expect((await api(`/bibliotecas/${bib.id}/miembros`, { token: dueno })).cuerpo).toHaveLength(1);
    const copia = await api('/copias', { token: yo, cuerpo: { origen: { enlace: e.token } } });
    expect(copia.estado).toBe(201);
    expect(copia.cuerpo.copiados).toHaveLength(2);
    // Al revocar el enlace, deja de seguirla; la copia es suya y se queda.
    await api(`/enlaces/${e.id}`, { token: dueno, metodo: 'DELETE' });
    expect((await api(`/compartidas/${bib.id}/documentos`, { token: yo })).estado).toBe(404);
    expect((await api('/seguidas', { token: yo })).cuerpo).toHaveLength(0);
    expect((await api(`/documentos?biblioteca=${copia.cuerpo.biblioteca}`, { token: yo })).cuerpo.elementos).toHaveLength(2);
    void dentro;
  });
});

describe('copiar a mi biblioteca', () => {
  it('al instante, sin volver a leer ni duplicar binarios, con la procedencia; los binarios aguantan mientras alguien los use', async () => {
    const { dueno, bib, dentro, fuera } = await escenario('cop');
    const yo = await token('user_cop_yo');
    await alta(yo);
    // Sin acceso no se copia nada.
    expect((await api('/copias', { token: yo, cuerpo: { origen: { biblioteca: bib.id } } })).estado).toBe(404);
    await api(`/bibliotecas/${bib.id}/compartir`, { token: dueno, cuerpo: { correo: 'user_cop_yo@prueba.es', permiso: 'lectura' } });
    await api(`/invitaciones/${(await api('/invitaciones', { token: yo })).cuerpo[0].id}/aceptar`, { token: yo, cuerpo: {} });
    // Ni pidiendo un documento de fuera.
    const intruso = await api('/copias', { token: yo, cuerpo: { origen: { biblioteca: bib.id }, documentos: [fuera] } });
    expect(intruso.cuerpo.copiados).toHaveLength(0);
    expect(intruso.cuerpo.fallidos).toHaveLength(1);

    const antes = await bytesBajo('u/user_cop_yo/');
    const r = await api('/copias', { token: yo, cuerpo: { origen: { biblioteca: bib.id }, destino: { nombre: 'Mi copia del seminario' }, tanda: 1 } });
    expect(r.estado).toBe(201);
    expect(r.cuerpo.copiados).toHaveLength(1);
    expect(r.cuerpo.pendientes).toHaveLength(1);
    const r2 = await api('/copias', { token: yo, cuerpo: { origen: { biblioteca: bib.id }, destino: { biblioteca: r.cuerpo.biblioteca }, documentos: r.cuerpo.pendientes } });
    expect(r2.cuerpo.copiados).toHaveLength(1);
    expect(r2.cuerpo.pendientes).toHaveLength(0);
    const destino = (await api(`/bibliotecas/${r.cuerpo.biblioteca}`, { token: yo })).cuerpo;
    expect(destino).toMatchObject({ nombre: 'Mi copia del seminario', permiso: 'propietario', documentos: 2, derechos: 'uso_privado' });
    expect(destino.copiadaDe).toMatchObject({ biblioteca: bib.id, de: 'cop_rosa' });

    // Ningún byte nuevo en mi almacén: la copia apunta a los binarios de Rosa.
    expect(await bytesBajo('u/user_cop_yo/')).toBe(antes);
    const copias = [...r.cuerpo.copiados, ...r2.cuerpo.copiados] as Array<{ origen: string; documento: string }>;
    const d = (await api(`/documentos/${copias[0]!.documento}`, { token: yo })).cuerpo;
    expect(d.original).toMatch(/^u\/user_cop_rosa\/d\//);
    expect(d.cuentas.fragmentos).toBeGreaterThan(0);
    expect(d.tarea).toBeUndefined(); // ni se lee ni se vectoriza otra vez
    const cont = await SELF.fetch((await api(`/documentos/${copias[0]!.documento}/original`, { token: yo })).cuerpo.url);
    expect(cont.status).toBe(200);
    // Busca en su copia como en lo suyo.
    const b = await api('/busqueda', { token: yo, cuerpo: { consulta: 'panóptico', filtros: { bibliotecas: [r.cuerpo.biblioteca] } } });
    expect(b.cuerpo.resultados.length).toBeGreaterThan(0);
    expect((await api('/notificaciones', { token: dueno })).cuerpo.some((n: { tipo: string }) => n.tipo === 'biblioteca_copiada')).toBe(true);

    // Copiar otra vez: ya estaban (misma huella), no se duplica nada.
    const otra = await api('/copias', { token: yo, cuerpo: { origen: { biblioteca: bib.id } } });
    expect(otra.cuerpo.copiados).toHaveLength(0);
    expect(otra.cuerpo.repetidos).toHaveLength(2);

    // Rosa borra el suyo: la copia sigue leyéndose (los binarios se retienen).
    const origenDoc = copias[0]!.origen;
    const prefijoRosa = `u/user_cop_rosa/d/${origenDoc}/`;
    expect(await bytesBajo(prefijoRosa)).toBeGreaterThan(0);
    await api(`/documentos/${origenDoc}`, { token: dueno, metodo: 'DELETE' });
    await new Promise((res) => setTimeout(res, 300));
    expect(await bytesBajo(prefijoRosa)).toBeGreaterThan(0);
    const sigue = await SELF.fetch((await api(`/documentos/${copias[0]!.documento}/original`, { token: yo })).cuerpo.url);
    expect(sigue.status).toBe(200);
    // Cuando nadie lo usa ya, se borra de verdad.
    await api(`/documentos/${copias[0]!.documento}`, { token: yo, metodo: 'DELETE' });
    // La otra copia (en la segunda biblioteca) también apuntaba ahí: hasta borrarla, se queda.
    const restos = (await env.DB.prepare('SELECT documento FROM referencias_almacen WHERE prefijo = ?').bind(prefijoRosa).all<{ documento: string }>()).results;
    for (const x of restos) await api(`/documentos/${x.documento}`, { token: yo, metodo: 'DELETE' });
    await new Promise((res) => setTimeout(res, 300));
    expect(await bytesBajo(prefijoRosa)).toBe(0);
    // Lo de Rosa que nadie copió, intacto.
    expect(await bytesBajo(`u/user_cop_rosa/d/${dentro.find((x) => x !== origenDoc)}/`)).toBeGreaterThan(0);
  });
});

describe('paquetes .scholaris', () => {
  it('se exporta en flujo, se abre como zip y se importa en otra cuenta sin volver a leer', async () => {
    const { dueno, bib, dentro } = await escenario('paq');
    const r = await SELF.fetch(`${BASE}/bibliotecas/${bib.id}/paquete`, { headers: { authorization: `Bearer ${dueno}` } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/x-scholaris');
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect(bytes[0]).toBe(0x50); // «PK»
    const zip = await abrirZip(bytes);
    const m = JSON.parse(await zip.texto('manifest.json')) as ManifiestoPaquete;
    expect(m).toMatchObject({ formato: 'scholaris-biblioteca', version: 1, opciones: { originales: true, vectores: true } });
    expect(m.biblioteca).toMatchObject({ nombre: bib.nombre, derechos: 'uso_privado', descripcion: 'Lecturas del seminario' });
    expect(m.documentos.map((d) => d.id).sort()).toEqual([...dentro].sort());
    expect(await zip.texto('LEEME.txt')).toMatch(/uso privado/);

    // Otra cuenta lo importa con el cliente del contrato.
    const otra = await token('user_paq_otra');
    await alta(otra);
    const cli = crearCliente({ base: ORIGEN, token: otra, fetch: (a, i) => SELF.fetch(a as string, i) });
    const imp = await importarPaquete(cli, bytes);
    expect(imp.fallidos).toEqual([]);
    expect(imp.importados).toHaveLength(2);
    expect(imp.importados.every((x) => !x.tarea)).toBe(true); // con vectores: cero ingesta
    const b2 = (await api(`/bibliotecas/${imp.biblioteca}`, { token: otra })).cuerpo;
    expect(b2).toMatchObject({ nombre: bib.nombre, documentos: 2, derechos: 'uso_privado' });
    const doc = (await api(`/documentos/${imp.importados[0]!.documento}`, { token: otra })).cuerpo;
    expect(doc.original).toMatch(/^u\/user_paq_otra\//);
    expect((await SELF.fetch((await api(`/documentos/${doc.id}/original`, { token: otra })).cuerpo.url)).status).toBe(200);
    expect((await api('/busqueda', { token: otra, cuerpo: { consulta: 'panóptico' } })).cuerpo.resultados.length).toBeGreaterThan(0);
    // Importarlo otra vez: lo repetido no se copia.
    const otraVez = await importarPaquete(cli, bytes, { biblioteca: imp.biblioteca });
    expect(otraVez.repetidos).toHaveLength(2);

    // Ligero: sin originales ni vectores. Quien lo importa recalcula solo los vectores.
    const ligero = new Uint8Array(await (await SELF.fetch(`${BASE}/bibliotecas/${bib.id}/paquete?originales=0&vectores=0`, { headers: { authorization: `Bearer ${dueno}` } })).arrayBuffer());
    expect(ligero.length).toBeLessThan(bytes.length);
    const ml = JSON.parse(await (await abrirZip(ligero)).texto('manifest.json')) as ManifiestoPaquete;
    expect(ml.opciones).toEqual({ originales: false, vectores: false });
    expect(ml.documentos.every((d) => d.sinOriginal)).toBe(true);
    const tercera = await token('user_paq_tercera');
    await alta(tercera);
    const imp3 = await importarPaquete(crearCliente({ base: ORIGEN, token: tercera, fetch: (a, i) => SELF.fetch(a as string, i) }), ligero);
    expect(imp3.importados).toHaveLength(2);
    expect(imp3.importados.every((x) => x.tarea)).toBe(true);
    for (const x of imp3.importados) expect((await esperarTarea(tercera, x.tarea!)).estado).toBe('listo');
    expect((await api('/busqueda', { token: tercera, cuerpo: { consulta: 'panóptico', modo: 'densa' } })).cuerpo.resultados.length).toBeGreaterThan(0);
  });
});

describe('lotes', () => {
  it('estima, detecta repetidos por huella, reparte por concurrencia, se pausa, se reanuda y termina solo', async () => {
    const t = await token('user_lote');
    await alta(t);
    const ya = await ingestar(t, 'ya-estaba', ['Un texto que ya estaba en la estantería.']);
    const bib = (await api('/bibliotecas', { token: t, cuerpo: { nombre: 'Lote de prueba' } })).cuerpo;
    const elementos = [
      { clase: 'archivo', nombre: 'uno.md', mime: 'text/markdown', bytes: 2000, huella: 'huella-lote-uno' },
      { clase: 'archivo', nombre: 'dos.pdf', mime: 'application/pdf', bytes: 600_000, huella: 'huella-lote-dos', paginas: 12 },
      { clase: 'archivo', nombre: 'otra-vez.md', mime: 'text/markdown', bytes: 10, huella: 'h-ya-estaba' },
      { clase: 'archivo', nombre: 'clase.mp3', mime: 'audio/mpeg', bytes: 3 * 1024 * 1024, huella: 'huella-lote-mp3', minutos: 3 },
    ];
    const e = (await api('/lotes/estimar', { token: t, cuerpo: { elementos } })).cuerpo;
    expect(e).toMatchObject({ elementos: 4, nuevos: 3, minutos: 3 });
    expect(e.paginas).toBeGreaterThanOrEqual(13);
    expect(e.duplicados).toEqual([expect.objectContaining({ indice: 2, documento: ya.documento })]);
    expect(e.modos.economico.euros).toBeLessThan(e.modos.rapido.euros);
    expect(e.modos.economico.segundos).toBeGreaterThan(e.modos.rapido.segundos);

    const l = (await api('/lotes', { token: t, cuerpo: { nombre: 'Seminario', biblioteca: bib.id, elementos, concurrencia: 1 } })).cuerpo;
    expect(l.estado).toBe('en_marcha');
    expect(l.cuentas).toMatchObject({ pendiente: 3, duplicado: 1 });
    // Lo repetido ya está en la biblioteca, sin leerlo.
    expect((await api(`/documentos?biblioteca=${bib.id}`, { token: t })).cuerpo.elementos.map((d: { id: string }) => d.id)).toEqual([ya.documento]);

    // Concurrencia 1: solo uno a la vez.
    const s1 = (await api(`/lotes/${l.id}/siguientes`, { token: t, cuerpo: { max: 4 } })).cuerpo;
    expect(s1.map((x: { n: number }) => x.n)).toEqual([1]);
    expect((await api(`/lotes/${l.id}/siguientes`, { token: t, cuerpo: { max: 4 } })).cuerpo).toEqual([]);
    // El conductor sube «uno» (con lote → biblioteca) y apunta documento y tarea.
    const uno = await ingestar(t, 'lote-uno', ['El primer texto del lote, sobre la memoria.'], [bib.id]);
    const ap = await api(`/lotes/${l.id}/elementos/1`, { token: t, metodo: 'PATCH', cuerpo: { estado: 'procesando', documento: uno.documento, tarea: uno.tarea } });
    expect(ap.cuerpo.estado).toBe('listo'); // ya había terminado

    // Pausa: no se reparte nada más.
    expect((await api(`/lotes/${l.id}/pausar`, { token: t, cuerpo: {} })).cuerpo.estado).toBe('pausado');
    expect((await api(`/lotes/${l.id}/siguientes`, { token: t, cuerpo: { max: 4 } })).cuerpo).toEqual([]);
    expect((await api(`/lotes/${l.id}/reanudar`, { token: t, cuerpo: {} })).cuerpo.estado).toBe('en_marcha');
    const s2 = (await api(`/lotes/${l.id}/siguientes`, { token: t, cuerpo: { max: 4 } })).cuerpo;
    expect(s2.map((x: { n: number }) => x.n)).toEqual([2]);
    // Falla y se reintenta.
    expect((await api(`/lotes/${l.id}/elementos/2`, { token: t, metodo: 'PATCH', cuerpo: { estado: 'error', error: 'La imprenta no pudo con él.' } })).cuerpo.estado).toBe('error');
    const re = (await api(`/lotes/${l.id}/elementos/2/reintentar`, { token: t, cuerpo: {} })).cuerpo;
    expect(re.elementos.find((x: { n: number }) => x.n === 2).estado).toBe('pendiente');
    // Se omiten los dos que quedan y el lote termina solo, con su aviso.
    await api(`/lotes/${l.id}/elementos/2/omitir`, { token: t, cuerpo: {} });
    const fin = (await api(`/lotes/${l.id}/elementos/4/omitir`, { token: t, cuerpo: {} })).cuerpo;
    expect(fin.estado).toBe('terminado');
    expect(fin.cuentas).toMatchObject({ listo: 1, duplicado: 1, omitido: 2 });
    expect((await api('/notificaciones', { token: t })).cuerpo.some((n: { tipo: string }) => n.tipo === 'lote_terminado')).toBe(true);
    expect((await api('/lotes', { token: t })).cuerpo[0].id).toBe(l.id);
    // Lotes ajenos: nada.
    expect((await api(`/lotes/${l.id}`, { token: await token('user_lote_otro') })).estado).toBe(404);
  });

  it('el cierre de la ingesta avanza el elemento sin que el conductor lo apunte', async () => {
    const t = await token('user_lote_cierre');
    await alta(t);
    const l = (await api('/lotes', { token: t, cuerpo: { elementos: [{ clase: 'archivo', nombre: 'a.md', mime: 'text/markdown', bytes: 100, huella: 'h-cierre-a' }] } })).cuerpo;
    const [el] = (await api(`/lotes/${l.id}/siguientes`, { token: t, cuerpo: { max: 1 } })).cuerpo;
    // El conductor apunta el documento en cuanto lo crea, antes de ingerir.
    const original = new TextEncoder().encode('Texto del lote.');
    const s = await api('/subidas', { token: t, cuerpo: { nombre: 'a.md', mime: 'text/markdown', bytes: original.byteLength, huella: 'h-cierre-a' } });
    await api(`/lotes/${l.id}/elementos/${el.n}`, { token: t, metodo: 'PATCH', cuerpo: { estado: 'procesando', documento: s.cuerpo.documento } });
    await SELF.fetch(s.cuerpo.original.url, { method: 'PUT', body: original });
    const rec = await api(`/subidas/${s.cuerpo.subida}/recursos`, { token: t, cuerpo: { recursos: [{ ruta: 'paquete.json', mime: 'application/json' }] } });
    await SELF.fetch(rec.cuerpo.recursos[0].subida.url, { method: 'PUT', body: JSON.stringify(paquete('a', ['Texto del lote, que se cierra solo.'])) });
    const ing = await api(`/subidas/${s.cuerpo.subida}/ingestar`, { token: t, cuerpo: { paquete: 'paquete.json' } });
    await esperarTarea(t, ing.cuerpo.tarea);
    const d = (await api(`/lotes/${l.id}`, { token: t })).cuerpo;
    expect(d.elementos[0].estado).toBe('listo');
    expect(d.estado).toBe('terminado');
  });
});

describe('búsqueda conjunta', () => {
  it('busca en lo mío y en lo que sigo, y cada pasaje dice de dónde sale', async () => {
    const { dueno, bib, dentro, fuera } = await escenario('con');
    const yo = await token('user_con_yo');
    await alta(yo);
    const mio = await ingestar(yo, 'con-mio', ['Mi propio ensayo sobre el panóptico y la vigilancia.']);
    await api(`/bibliotecas/${bib.id}/compartir`, { token: dueno, cuerpo: { correo: 'user_con_yo@prueba.es', permiso: 'lectura' } });
    await api(`/invitaciones/${(await api('/invitaciones', { token: yo })).cuerpo[0].id}/aceptar`, { token: yo, cuerpo: {} });

    const todo = (await api('/busqueda/conjunta', { token: yo, cuerpo: { consulta: 'panóptico' } })).cuerpo;
    const ids = todo.resultados.map((r: { documento: { id: string } }) => r.documento.id);
    expect(ids).toContain(mio.documento);
    expect(ids).toContain(dentro[0]);
    expect(ids).not.toContain(fuera);
    const ajeno = todo.resultados.find((r: { documento: { id: string } }) => r.documento.id === dentro[0]);
    expect(ajeno.origen).toMatchObject({ propia: false, biblioteca: bib.id, nombre: bib.nombre, de: 'con_rosa' });
    expect(todo.resultados.find((r: { documento: { id: string } }) => r.documento.id === mio.documento).origen.propia).toBe(true);
    expect(todo.fuentes).toHaveLength(2);

    const mias = (await api('/busqueda/conjunta', { token: yo, cuerpo: { consulta: 'panóptico', alcance: 'mias' } })).cuerpo;
    expect(mias.resultados.every((r: { origen: { propia: boolean } }) => r.origen.propia)).toBe(true);
    const seguidas = (await api('/busqueda/conjunta', { token: yo, cuerpo: { consulta: 'panóptico', alcance: 'seguidas' } })).cuerpo;
    expect(seguidas.resultados.length).toBeGreaterThan(0);
    expect(seguidas.resultados.every((r: { origen: { propia: boolean } }) => !r.origen.propia)).toBe(true);
    // Una biblioteca que no sigo no se cuela pidiéndola.
    const colada = (await api('/busqueda/conjunta', { token: yo, cuerpo: { consulta: 'panóptico', alcance: { bibliotecas: [bib.id, 'b-que-no-es-mia'] } } })).cuerpo;
    expect(colada.resultados.every((r: { documento: { id: string } }) => r.documento.id !== fuera)).toBe(true);
  });
});
