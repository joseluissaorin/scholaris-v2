/**
 * Rehacer las imágenes de página (POST /documentos/:id/paginas/rehacer): el modo
 * simulado cuenta sin convertir, y sin conversor en el servidor se dice claro.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { importJWK, SignJWT } from 'jose';
import { JWK_PRIVADA } from './clave-prueba.js';
import { SPDF_FOLIOS_B64 } from './spdf-folios.js';

const BASE = 'https://scholaris.prueba/api/v2';

async function token(sub: string): Promise<string> {
  const clave = await importJWK(JWK_PRIVADA, 'RS256');
  return new SignJWT({ email: `${sub}@prueba.es`, name: sub, fea: 'u:scholaris' })
    .setProtectedHeader({ alg: 'RS256', kid: 'prueba' })
    .setSubject(sub).setIssuer('https://clerk.prueba').setIssuedAt().setExpirationTime('10m')
    .sign(clave);
}

async function api(ruta: string, o: { token: string; cuerpo?: unknown; cabeceras?: Record<string, string> }) {
  const h: Record<string, string> = { authorization: `Bearer ${o.token}`, ...(o.cabeceras ?? {}) };
  let body: BodyInit | undefined;
  if (o.cuerpo instanceof Uint8Array) body = o.cuerpo as BodyInit;
  else if (o.cuerpo !== undefined) { body = JSON.stringify(o.cuerpo); h['content-type'] = 'application/json'; }
  const r = await SELF.fetch(`${BASE}${ruta}`, { method: o.cuerpo !== undefined ? 'POST' : 'GET', headers: h, body });
  const tipo = r.headers.get('content-type') ?? '';
  return { estado: r.status, cuerpo: (tipo.includes('json') ? await r.json() : await r.text()) as any };
}

describe('rehacer las imágenes de página', () => {
  it('simula sin convertir y, sin conversor, no finge que lo hace', async () => {
    const t = await token('user_paginas');
    const bytes = Uint8Array.from(atob(SPDF_FOLIOS_B64), (ch) => ch.charCodeAt(0));
    const imp = await api('/documentos/importar', { token: t, cuerpo: bytes, cabeceras: { 'content-type': 'application/x-spdf' } });
    expect(imp.estado).toBe(201);
    const id = imp.cuerpo.documento as string;
    const sim = await api(`/documentos/${id}/paginas/rehacer`, { token: t, cuerpo: { simular: true } });
    expect(sim.estado).toBe(200);
    expect(sim.cuerpo).toMatchObject({ documento: id, simulado: true, paginas: 12, actualizadas: 0 });
    expect(sim.cuerpo.sinImagen).toBeGreaterThanOrEqual(0);
    if (!sim.cuerpo.conversor) {
      expect(sim.cuerpo.avisos.join(' ')).toMatch(/conversor/);
      const real = await api(`/documentos/${id}/paginas/rehacer`, { token: t, cuerpo: {} });
      expect(real.estado).toBeGreaterThanOrEqual(400);
    }
  });
});
