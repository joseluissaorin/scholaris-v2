/**
 * Investigar en el Worker: la petición se valida, sin clave de Gemini se responde
 * con un error claro antes de abrir el flujo y sin gastar cuota, y la v1 y el MCP
 * llevan al mismo sitio. (El agente en sí se prueba en packages/investigar.)
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { importJWK, SignJWT } from 'jose';
import { JWK_PRIVADA } from './clave-prueba.js';

const BASE = 'https://scholaris.prueba/api/v2';

async function token(sub: string): Promise<string> {
  const clave = await importJWK(JWK_PRIVADA, 'RS256');
  return new SignJWT({ email: `${sub}@prueba.es`, name: sub })
    .setProtectedHeader({ alg: 'RS256', kid: 'prueba' })
    .setSubject(sub).setIssuer('https://clerk.prueba').setIssuedAt().setExpirationTime('10m')
    .sign(clave);
}

const investigar = async (t: string, cuerpo: unknown) => SELF.fetch(`${BASE}/busqueda/investigar`, {
  method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(cuerpo),
});

describe('investigar', () => {
  it('valida la petición', async () => {
    const t = await token('user_inv_1');
    const vacia = await investigar(t, { pregunta: '   ' });
    expect(vacia.status).toBe(400);
    expect(((await vacia.json()) as { error: { mensaje: string } }).error.mensaje).toMatch(/pregunta/);
    const mala = await investigar(t, { pregunta: '¿Qué?', profundidad: 'infinita' });
    expect(mala.status).toBe(400);
  });

  it('sin clave de Gemini: error claro, en JSON, y sin gastar la cuota del día', async () => {
    const t = await token('user_inv_2');
    for (let i = 0; i < 7; i++) {
      const r = await investigar(t, { pregunta: '¿Cómo cambia Coppelia entre el cuento y la película?' });
      expect(r.status).toBe(503);
      const j = (await r.json()) as { error: { codigo: string; mensaje: string } };
      expect(j.error.codigo).toBe('no_disponible');
      expect(j.error.mensaje).toMatch(/clave de Gemini/);
    }
  });

  it('el MCP ofrece «investigate» y devuelve el error como resultado de la herramienta', async () => {
    const t = await token('user_inv_3');
    const r = await SELF.fetch('https://scholaris.prueba/mcp', {
      method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'investigate', arguments: { question: '¿Qué pasa en Coppelia?' } } }),
    });
    const j = (await r.json()) as { result: { isError?: boolean; content: Array<{ text: string }> } };
    expect(j.result.isError).toBe(true);
    expect(j.result.content[0]!.text).toMatch(/Gemini/);
  });
});
