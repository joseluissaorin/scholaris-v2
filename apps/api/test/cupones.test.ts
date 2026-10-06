/**
 * Concesiones de plan y cupones: el plan efectivo es el mejor entre el del token
 * y la concesión vigente, en sesiones de Clerk, claves de API y MCP; los cupones
 * valen una sola vez aunque lleguen a la vez, nunca rebajan ni se malgastan, los
 * anulados no valen y la administración es solo de ADMINS.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { importJWK, SignJWT } from 'jose';
import { JWK_PRIVADA } from './clave-prueba.js';
import { normalizarCodigoCupon, nuevoCodigoCupon } from '../src/compartido/cupones.js';

const BASE = 'https://scholaris.prueba/api/v2';
const ADMIN = 'user_admin_cupones';
const FORMA = /^SCHO-[ACDEFGHJKMNPQRTUVWXY2346789]{4}-[ACDEFGHJKMNPQRTUVWXY2346789]{4}$/;

async function token(sub: string, extra: Record<string, unknown> = {}): Promise<string> {
  const clave = await importJWK(JWK_PRIVADA, 'RS256');
  return new SignJWT({ email: `${sub}@prueba.es`, name: sub, ...extra })
    .setProtectedHeader({ alg: 'RS256', kid: 'prueba' })
    .setSubject(sub).setIssuer('https://clerk.prueba').setIssuedAt().setExpirationTime('10m')
    .sign(clave);
}

async function api(ruta: string, o: { token?: string; metodo?: string; cuerpo?: unknown } = {}) {
  const h: Record<string, string> = {};
  if (o.token) h.authorization = `Bearer ${o.token}`;
  let body: string | undefined;
  if (o.cuerpo !== undefined) { body = JSON.stringify(o.cuerpo); h['content-type'] = 'application/json'; }
  const r = await SELF.fetch(ruta.startsWith('http') ? ruta : `${BASE}${ruta}`, { method: o.metodo ?? (o.cuerpo !== undefined ? 'POST' : 'GET'), headers: h, body });
  const tipo = r.headers.get('content-type') ?? '';
  return { estado: r.status, cuerpo: (tipo.includes('json') ? await r.json() : await r.text()) as any };
}

async function lote(cantidad: number, dias: number | null = null, nombre?: string): Promise<string[]> {
  const r = await api('/admin/cupones', { token: await token(ADMIN), cuerpo: { cantidad, plan: 'pro', dias, ...(nombre ? { lote: nombre } : {}), nota: 'Pruebas' } });
  expect(r.estado).toBe(200);
  return r.cuerpo.codigos as string[];
}

const canjear = async (usuario: string, codigo: string) => api('/cupones/canjear', { token: await token(usuario), cuerpo: { codigo } });

describe('códigos', () => {
  it('forma SCHO-XXXX-XXXX con el alfabeto sin ambigüedades, y normalización de lo tecleado', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = nuevoCodigoCupon();
      expect(c).toMatch(FORMA);
      vistos.add(c);
    }
    expect(vistos.size).toBe(2000);
    expect(normalizarCodigoCupon(' scho ac3d 4fgh ')).toBe('SCHO-AC3D-4FGH');
    expect(normalizarCodigoCupon('ac3d-4fgh')).toBe('SCHO-AC3D-4FGH');
    expect(normalizarCodigoCupon('SCHO-0OI1-LLLL')).toBeNull();
  });
});

describe('concesiones', () => {
  it('una concesión del administrador gana al plan del token (sesión de Clerk)', async () => {
    const t = await token('user_regalo');
    expect((await api('/auth/yo', { token: t })).cuerpo.plan).toBe('gratis');
    const c = await api('/admin/concesiones', { token: await token(ADMIN), cuerpo: { usuario: 'user_regalo', plan: 'pro', nota: 'propietario' } });
    expect(c.estado).toBe(200);
    expect(c.cuerpo).toMatchObject({ usuario: 'user_regalo', plan: 'pro', origen: 'admin', nota: 'propietario' });
    expect(c.cuerpo.caduca).toBeUndefined();
    const yo = (await api('/auth/yo', { token: t })).cuerpo;
    expect(yo.plan).toBe('pro');
    expect(yo.concesion).toMatchObject({ origen: 'admin', plan: 'pro' });
    expect(yo.cuotas.documentos.limite).toBe(5000);
    // Revocarla devuelve al plan del token.
    expect((await api(`/admin/concesiones/${c.cuerpo.id}`, { token: await token(ADMIN), metodo: 'DELETE' })).estado).toBe(200);
    expect((await api('/auth/yo', { token: t })).cuerpo.plan).toBe('gratis');
  });

  it('un token Pro sigue siendo Pro sin concesiones, y /auth/yo marca al administrador', async () => {
    expect((await api('/auth/yo', { token: await token('user_paga', { fea: 'u:scholaris' }) })).cuerpo.plan).toBe('pro');
    expect((await api('/auth/yo', { token: await token(ADMIN) })).cuerpo.admin).toBe(true);
    expect((await api('/auth/yo', { token: await token('user_paga') })).cuerpo.admin).toBeUndefined();
  });
});

describe('cupones', () => {
  it('el lote devuelve los códigos una vez (y en CSV) y el listado solo enseña pistas', async () => {
    const r = await api('/admin/cupones', { token: await token(ADMIN), cuerpo: { cantidad: 3, plan: 'pro', lote: 'Lote CSV', nota: 'Prueba, «con comillas»' } });
    expect(r.estado).toBe(200);
    expect(r.cuerpo.codigos).toHaveLength(3);
    for (const c of r.cuerpo.codigos) { expect(c).toMatch(FORMA); expect(r.cuerpo.csv).toContain(c); }
    expect(r.cuerpo.csv).toContain('de por vida');
    const lotes = (await api('/admin/cupones', { token: await token(ADMIN) })).cuerpo as Array<{ lote: string; total: number }>;
    expect(lotes.find((l) => l.lote === 'Lote CSV')?.total).toBe(3);
    const lista = (await api(`/admin/cupones/lotes/${encodeURIComponent('Lote CSV')}`, { token: await token(ADMIN) })).cuerpo as Array<{ pista: string; huella: string }>;
    expect(lista).toHaveLength(3);
    const texto = JSON.stringify(lista);
    for (const c of r.cuerpo.codigos) expect(texto).not.toContain(c);
    expect(lista[0]!.pista).toMatch(/^SCHO-.{4}-••••$/);
    // El mismo nombre de lote no se repite.
    expect((await api('/admin/cupones', { token: await token(ADMIN), cuerpo: { cantidad: 1, plan: 'pro', lote: 'Lote CSV' } })).estado).toBe(409);
  });

  it('un cupón vale una sola vez aunque lo canjeen a la vez', async () => {
    const [codigo] = await lote(1);
    const usuarios = Array.from({ length: 8 }, (_, i) => `user_carrera_${i}`);
    const r = await Promise.all(usuarios.map((u) => canjear(u, codigo!)));
    const buenos = r.filter((x) => x.estado === 200);
    expect(buenos).toHaveLength(1);
    expect(r.filter((x) => x.estado === 409)).toHaveLength(7);
    for (const x of r.filter((y) => y.estado === 409)) expect(x.cuerpo.error.mensaje).toMatch(/ya se ha canjeado/);
    const ganador = usuarios[r.findIndex((x) => x.estado === 200)]!;
    const yo = (await api('/auth/yo', { token: await token(ganador) })).cuerpo;
    expect(yo.plan).toBe('pro');
    expect(yo.concesion).toMatchObject({ origen: 'cupon', plan: 'pro' });
    expect(yo.concesion.caduca).toBeUndefined();
    // Volver a canjearlo: «ya lo canjeaste».
    expect((await canjear(ganador, codigo!)).cuerpo.error.mensaje).toMatch(/Ya canjeaste/);
  });

  it('nunca rebaja ni malgasta: con Pro de por vida, otro cupón se rechaza y sigue libre', async () => {
    const [a, b] = await lote(2);
    expect((await canjear('user_vitalicio', a!)).estado).toBe(200);
    const otro = await canjear('user_vitalicio', b!);
    expect(otro.estado).toBe(409);
    expect(otro.cuerpo.error.mensaje).toMatch(/Pro de por vida/);
    expect((await canjear('user_otra_persona', b!)).estado).toBe(200);
    // Un cupón temporal tampoco le quita lo vitalicio.
    const [temporal] = await lote(1, 30);
    expect((await canjear('user_vitalicio', temporal!)).estado).toBe(409);
    expect((await api('/auth/yo', { token: await token('user_vitalicio') })).cuerpo.concesion.caduca).toBeUndefined();
  });

  it('un cupón temporal da una fecha de caducidad; dos se suman', async () => {
    const [x, y] = await lote(2, 30);
    const r1 = await canjear('user_temporal', x!);
    expect(r1.estado).toBe(200);
    const fin1 = Date.parse(r1.cuerpo.caduca);
    expect(fin1).toBeGreaterThan(Date.now() + 29 * 86400_000);
    const r2 = await canjear('user_temporal', y!);
    expect(r2.estado).toBe(200);
    expect(Date.parse(r2.cuerpo.caduca) - fin1).toBeGreaterThan(29 * 86400_000);
  });

  it('un cupón anulado no vale; uno inventado tampoco; y hay límite de intentos', async () => {
    const [anulado, lotero] = await lote(2, null, 'Lote anulable');
    expect((await api('/admin/cupones/revocar', { token: await token(ADMIN), cuerpo: { codigos: [anulado] } })).cuerpo.revocados).toBe(1);
    const r = await canjear('user_anulado', anulado!);
    expect(r.estado).toBe(409);
    expect(r.cuerpo.error.mensaje).toMatch(/anulado/);
    // Anular el lote entero deja fuera el que quedaba.
    expect((await api('/admin/cupones/revocar', { token: await token(ADMIN), cuerpo: { lote: 'Lote anulable' } })).cuerpo.revocados).toBe(1);
    expect((await canjear('user_anulado', lotero!)).estado).toBe(409);
    expect((await api('/auth/yo', { token: await token('user_anulado') })).cuerpo.plan).toBe('gratis');

    expect((await canjear('user_tanteo', 'hola')).estado).toBe(400);
    const falso = await canjear('user_tanteo', 'SCHO-AAAA-AAAA');
    expect(falso.estado).toBe(404);
    expect(falso.cuerpo.error.mensaje).toMatch(/no existe/);
    for (let i = 0; i < 8; i++) await canjear('user_tanteo', 'SCHO-AAAA-AAAA');
    const bloqueado = await canjear('user_tanteo', 'SCHO-AAAA-AAAA');
    expect(bloqueado.estado).toBe(429);
    expect(bloqueado.cuerpo.error.mensaje).toMatch(/Demasiados intentos/);
  });

  it('la administración solo es de ADMINS (ni otra cuenta ni una clave de API del administrador)', async () => {
    const otro = await token('user_curioso');
    for (const [ruta, metodo, cuerpo] of [
      ['/admin/cupones', 'GET', undefined], ['/admin/cupones', 'POST', { cantidad: 1, plan: 'pro' }],
      ['/admin/cupones/revocar', 'POST', { lote: 'x' }], ['/admin/concesiones', 'GET', undefined],
      ['/admin/concesiones', 'POST', { usuario: 'user_curioso', plan: 'pro' }], ['/admin/concesiones/c123', 'DELETE', undefined],
    ] as const) {
      const r = await api(ruta, { token: otro, metodo, ...(cuerpo ? { cuerpo } : {}) });
      expect(r.estado, `${metodo} ${ruta}`).toBe(403);
    }
    const clave = await api('/claves', { token: await token(ADMIN), cuerpo: { nombre: 'admin', alcances: ['lectura', 'escritura', 'mcp'] } });
    expect(clave.estado).toBe(201);
    expect((await api('/admin/cupones', { token: clave.cuerpo.secreto })).estado).toBe(403);
    expect((await api('/admin/cupones', { token: clave.cuerpo.secreto, cuerpo: { cantidad: 1, plan: 'pro' } })).estado).toBe(403);
    // Y una clave de API no canjea.
    expect((await api('/cupones/canjear', { token: clave.cuerpo.secreto, cuerpo: { codigo: 'SCHO-AAAA-AAAA' } })).estado).toBe(403);
    expect((await api('/cupones/canjear', { cuerpo: { codigo: 'SCHO-AAAA-AAAA' } })).estado).toBe(401);
  });

  it('las claves de API y el MCP ven el plan efectivo', async () => {
    const [codigo] = await lote(1);
    const t = await token('user_clave_pro');
    const clave = (await api('/claves', { token: t, cuerpo: { nombre: 'sdk', alcances: ['lectura', 'mcp'] } })).cuerpo.secreto as string;
    expect((await api('/auth/yo', { token: clave })).cuerpo.plan).toBe('gratis');
    expect((await canjear('user_clave_pro', codigo!)).estado).toBe(200);
    const yo = (await api('/auth/yo', { token: clave })).cuerpo;
    expect(yo.via).toBe('clave_api');
    expect(yo.plan).toBe('pro');
    expect(yo.concesion.origen).toBe('cupon');
    expect(yo.cuotas.paginasMes.limite).toBe(60000);

    // MCP: el ritmo de la estantería depende del plan (120/min gratis, 600/min Pro).
    const ping = (bearer: string) => SELF.fetch('https://scholaris.prueba/mcp', {
      method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    }).then((r) => r.status);
    const rafaga = async (bearer: string, n: number) => {
      const estados: number[] = [];
      for (let i = 0; i < n; i += 25) estados.push(...(await Promise.all(Array.from({ length: Math.min(25, n - i) }, () => ping(bearer)))));
      return estados;
    };
    const pro = await rafaga(clave, 140);
    expect(pro.filter((s) => s === 429)).toHaveLength(0);
    expect(pro.every((s) => s === 200)).toBe(true);
    const tGratis = await token('user_clave_gratis');
    const claveGratis = (await api('/claves', { token: tGratis, cuerpo: { nombre: 'sdk', alcances: ['lectura', 'mcp'] } })).cuerpo.secreto as string;
    const gratis = await rafaga(claveGratis, 140);
    expect(gratis.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
