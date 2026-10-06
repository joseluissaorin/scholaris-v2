/** Cuenta: quién soy, baja, claves de API y ajustes (ver contrato/cuenta.ts). */
import type { Hono } from 'hono';
import type { AlcanceClave, CrearClaveApi, GuardarClaveProveedor, PreferenciasParciales, ProveedorClave, Yo } from '@scholaris/contrato';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, fallo } from '../compartido/errores.js';
import { idsIndiceDeDocumento } from '../compartido/estanteria.js';
import { prm, puertos, type Ctx } from './util.js';

const PROVEEDORES: ProveedorClave[] = ['gemini', 'openrouter', 'typesafe', 'mistral', 'voyage', 'cohere', 'jina', 'zeroentropy'];
const ALCANCES: AlcanceClave[] = ['lectura', 'escritura', 'mcp'];

/** Solo con sesión de Clerk (o en local): las claves de API no gestionan claves. */
function exigirSesion(c: Ctx): void {
  if (c.get('usuario').via === 'clave_api') fallo('prohibido', 'Esta operación necesita iniciar sesión; no se puede hacer con una clave de API.');
}

export function rutasCuenta(app: Hono<Entorno>): void {
  app.get('/auth/yo', async (c: Ctx) => {
    const p = puertos(c);
    const u = p.usuario;
    const yo: Yo = {
      usuario: { id: u.id, correo: u.correo, nombre: u.nombre, ...(u.imagen ? { imagen: u.imagen } : {}) },
      plan: u.plan,
      funciones: u.funciones,
      cuotas: await p.cuentas.cuotas(u.id, p.config.modo === 'local' ? 'local' : u.plan),
      via: u.via,
    };
    return c.json(yo);
  });

  app.post('/auth/borrar', async (c: Ctx) => {
    exigirSesion(c);
    const p = puertos(c);
    const b = await cuerpoJson<{ confirmar?: string }>(c);
    exigir(b.confirmar === 'BORRAR', 'Para borrar la cuenta manda { "confirmar": "BORRAR" }.');
    const docs = (await p.sql.ejecutar<{ id: string }>('SELECT id FROM documentos')).map((f) => f.id);
    const ids: string[] = [];
    for (const d of docs) ids.push(...(await idsIndiceDeDocumento(p.sql, d)));
    await p.cuentas.auditar(p.usuario.id, 'cuenta_borrada', { documentos: docs.length });
    await p.cuentas.borrarUsuario(p.usuario.id);
    await p.vaciarEstanteria();
    p.segundoPlano((async () => {
      if (p.indice) for (let i = 0; i < ids.length; i += 500) await p.indice.borrar(p.config.espacioNombres(p.usuario.id), ids.slice(i, i + 500));
      await p.almacen.borrarPrefijo(`u/${p.usuario.id}/`);
    })().catch((e) => console.error('baja en segundo plano', e)));
    return c.json({ ok: true });
  });

  app.get('/claves', async (c: Ctx) => c.json(await puertos(c).cuentas.listarClaves(puertos(c).usuario.id)));

  app.post('/claves', async (c: Ctx) => {
    exigirSesion(c);
    const p = puertos(c);
    const b = await cuerpoJson<CrearClaveApi>(c);
    exigir(typeof b.nombre === 'string' && b.nombre.trim() && b.nombre.length <= 100, 'La clave necesita un nombre (hasta 100 caracteres).');
    const alcances = b.alcances?.length ? b.alcances : (['lectura', 'mcp'] as AlcanceClave[]);
    exigir(alcances.every((a) => ALCANCES.includes(a)), `Alcances válidos: ${ALCANCES.join(', ')}.`);
    exigir(b.dias === undefined || (Number.isInteger(b.dias) && b.dias > 0 && b.dias <= 3650), 'Los días de validez deben estar entre 1 y 3650.');
    if ((await p.cuentas.listarClaves(p.usuario.id)).filter((k) => !k.revocada).length >= 20) fallo('cuota_superada', 'Tienes ya 20 claves activas: revoca alguna antes de crear otra.');
    return c.json(await p.cuentas.crearClave(p.usuario.id, b.nombre.trim(), alcances, b.dias), 201);
  });

  app.delete('/claves/:id', async (c: Ctx) => {
    exigirSesion(c);
    const p = puertos(c);
    if (!(await p.cuentas.revocarClave(p.usuario.id, prm(c, 'id')))) fallo('no_encontrado', 'La clave no existe o ya estaba revocada.');
    return c.json({ ok: true });
  });

  app.get('/ajustes', async (c: Ctx) => c.json(await puertos(c).cuentas.ajustes(puertos(c).usuario.id)));

  app.patch('/ajustes', async (c: Ctx) => {
    exigirSesion(c);
    const p = puertos(c);
    const b = await cuerpoJson<PreferenciasParciales>(c);
    exigir(b && typeof b === 'object', 'Manda un objeto con las preferencias que cambian.');
    return c.json(await p.cuentas.preferencias(p.usuario.id, b));
  });

  app.put('/ajustes/claves/:proveedor', async (c: Ctx) => {
    exigirSesion(c);
    const p = puertos(c);
    const prov = prm(c, 'proveedor') as ProveedorClave;
    exigir(PROVEEDORES.includes(prov), `Proveedor desconocido. Válidos: ${PROVEEDORES.join(', ')}.`);
    const b = await cuerpoJson<GuardarClaveProveedor>(c);
    exigir(typeof b.clave === 'string' && b.clave.trim().length >= 8 && b.clave.length <= 500, 'La clave no parece válida.');
    return c.json(await p.cuentas.guardarClaveProveedor(p.usuario.id, prov, b.clave.trim()));
  });

  app.delete('/ajustes/claves/:proveedor', async (c: Ctx) => {
    exigirSesion(c);
    const p = puertos(c);
    return c.json(await p.cuentas.borrarClaveProveedor(p.usuario.id, prm(c, 'proveedor') as ProveedorClave));
  });
}
