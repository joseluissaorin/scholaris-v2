/**
 * Cupones y concesiones de plan, en la puerta (viven en las cuentas, D1).
 *
 *   POST /cupones/canjear            cualquiera con sesión (no con clave de API)
 *   /admin/cupones…, /admin/concesiones…   solo las cuentas de ADMINS
 *
 * Tras un canje o una concesión se olvida la sesión del usuario en la caché,
 * para que su plan nuevo valga en la siguiente petición.
 */
import type { Context, Hono } from 'hono';
import { PREFIJO_API, type ConcederPlan, type CrearLoteCupones, type CuponCanjeado, type LoteCreado, type Plan, type RevocarCupones } from '@scholaris/contrato';
import type { Plataforma } from '../app.js';
import type { UsuarioSesion } from '../puertos.js';
import { cuerpoJson, exigir, fallo } from '../compartido/errores.js';
import { csvCupones, esPlan } from '../compartido/cupones.js';

type Puerta = Hono<{ Variables: { usuario: UsuarioSesion } }>;
type C = Context<{ Variables: { usuario: UsuarioSesion } }>;

const ID_USUARIO = /^[\w-]{3,80}$/;
const NOMBRE_LOTE = /^[\p{L}\p{N} .,:_\-·()«»]{1,60}$/u;

function exigirAdmin(c: C): UsuarioSesion {
  const u = c.get('usuario');
  if (!u.admin) fallo('prohibido', 'Esta parte solo la puede usar quien administra Scholaris.');
  return u;
}

function dias(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  exigir(Number.isInteger(n) && n >= 1 && n <= 36500, 'La duración va en días enteros, entre 1 y 36 500 (o sin duración, de por vida).');
  return n;
}

function planPro(v: unknown): Plan {
  exigir(esPlan(v), 'El plan tiene que ser «pro».');
  exigir(v === 'pro', 'Solo se puede conceder el plan Pro: el gratuito ya lo tiene todo el mundo.');
  return v;
}

export function montarCupones(app: Puerta, pl: Plataforma, olvidar: (usuario: string) => Promise<void>): void {
  const P = PREFIJO_API;

  app.post(`${P}/cupones/canjear`, async (c) => {
    const u = c.get('usuario');
    if (u.via === 'clave_api' || u.via === 'admin' || u.ambito) fallo('prohibido', 'Para canjear un cupón hay que iniciar sesión en Scholaris; no se puede con una clave de API.');
    const b = await cuerpoJson<{ codigo?: unknown }>(c);
    exigir(typeof b.codigo === 'string' && b.codigo.trim().length > 0 && b.codigo.length <= 64, 'Escribe el código del cupón (SCHO-XXXX-XXXX).');
    const concesion = await pl.cuentas.canjearCupon(u.id, b.codigo);
    await olvidar(u.id);
    return c.json<CuponCanjeado>({ plan: concesion.plan, ...(concesion.caduca ? { caduca: concesion.caduca } : {}), concesion });
  });

  // --- Administración ------------------------------------------------------

  app.get(`${P}/admin/cupones`, async (c) => {
    exigirAdmin(c);
    return c.json(await pl.cuentas.lotesCupones());
  });

  app.post(`${P}/admin/cupones`, async (c) => {
    const u = exigirAdmin(c);
    const b = await cuerpoJson<CrearLoteCupones>(c);
    const cantidad = Number(b.cantidad);
    exigir(Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= 1000, 'La cantidad va de 1 a 1000 cupones por lote.');
    const plan = planPro(b.plan);
    const d = dias(b.dias);
    const lote = (typeof b.lote === 'string' && b.lote.trim()) ? b.lote.trim() : `Lote del ${new Date().toISOString().slice(0, 23).replace('T', ' ')}`;
    exigir(NOMBRE_LOTE.test(lote), 'El nombre del lote admite letras, cifras, espacios y signos sencillos (hasta 60 caracteres).');
    const nota = typeof b.nota === 'string' && b.nota.trim() ? b.nota.trim().slice(0, 300) : null;
    const codigos = await pl.cuentas.crearCupones({ cantidad, plan, dias: d, lote, nota, por: u.id });
    const csv = csvCupones(codigos.map((codigo) => ({ codigo, plan, duracionDias: d, lote, nota })));
    if (c.req.query('formato') === 'csv') {
      return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`cupones-${lote}.csv`)}`, 'cache-control': 'no-store' } });
    }
    c.header('cache-control', 'no-store');
    return c.json<LoteCreado>({ lote, plan, dias: d, ...(nota ? { nota } : {}), codigos, csv });
  });

  app.get(`${P}/admin/cupones/lotes/:lote`, async (c) => {
    exigirAdmin(c);
    return c.json(await pl.cuentas.cuponesDeLote(c.req.param('lote')));
  });

  app.post(`${P}/admin/cupones/revocar`, async (c) => {
    const u = exigirAdmin(c);
    const b = await cuerpoJson<RevocarCupones>(c);
    const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 1000) : []);
    const codigos = lista(b.codigos), huellas = lista(b.huellas);
    const lote = typeof b.lote === 'string' && b.lote.trim() ? b.lote.trim() : undefined;
    exigir(codigos.length || huellas.length || lote, 'Indica qué cupones anular: códigos, huellas o un lote.');
    return c.json({ revocados: await pl.cuentas.revocarCupones({ codigos, huellas, ...(lote ? { lote } : {}), por: u.id }) });
  });

  app.get(`${P}/admin/concesiones`, async (c) => {
    exigirAdmin(c);
    const usuario = c.req.query('usuario');
    if (usuario) exigir(ID_USUARIO.test(usuario), 'El identificador de usuario no es válido.');
    return c.json(await pl.cuentas.concesiones(usuario || undefined));
  });

  app.post(`${P}/admin/concesiones`, async (c) => {
    const u = exigirAdmin(c);
    const b = await cuerpoJson<ConcederPlan>(c);
    exigir(typeof b.usuario === 'string' && ID_USUARIO.test(b.usuario), 'Falta el identificador del usuario (el de Clerk, «user_…»).');
    const plan = planPro(b.plan);
    const d = dias(b.dias);
    const nota = typeof b.nota === 'string' && b.nota.trim() ? b.nota.trim().slice(0, 300) : null;
    // Una cuenta que aún no ha entrado nunca queda dada de alta: la concesión la espera.
    if (!(await pl.cuentas.usuario(b.usuario))) await pl.cuentas.asegurarUsuario({ id: b.usuario, correo: '', nombre: '', plan: 'gratis' });
    const concesion = await pl.cuentas.conceder({ usuario: b.usuario, plan, origen: 'admin', dias: d, nota, por: u.id });
    await olvidar(b.usuario);
    return c.json(concesion);
  });

  app.delete(`${P}/admin/concesiones/:id`, async (c) => {
    const u = exigirAdmin(c);
    const afectado = await pl.cuentas.revocarConcesion(c.req.param('id'), u.id);
    if (!afectado) fallo('no_encontrado', 'Esa concesión no existe o ya estaba revocada.');
    await olvidar(afectado);
    return c.json({ ok: true });
  });
}
