/** Bibliotecas (ver contrato/bibliotecas.ts). */
import type { Hono } from 'hono';
import { nuevoId } from '@scholaris/nucleo';
import type { AnadirDocumentos, Biblioteca, Compartir, NuevaBiblioteca } from '@scholaris/contrato';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, fallo, noEncontrado } from '../compartido/errores.js';
import { ahora, cambiarBiblioteca, leerBiblioteca, listarBibliotecasPropias } from '../compartido/estanteria.js';
import { exigirEscritura, prm, puertos, type Ctx } from './util.js';

const COLOR = /^#[0-9a-f]{6}$/i;

export function rutasBibliotecas(app: Hono<Entorno>): void {
  app.get('/bibliotecas', async (c: Ctx) => {
    const p = puertos(c);
    const propias = await listarBibliotecasPropias(p.sql, p.usuario.id);
    const compartidasPorMi = new Set((await Promise.all(propias.map(async (b) => ((await p.cuentas.miembros(b.id)).length ? b.id : null)))).filter(Boolean));
    for (const b of propias) b.compartida = compartidasPorMi.has(b.id);
    const ajenas: Biblioteca[] = (await p.cuentas.compartidasConmigo(p.usuario.id)).map((f) => ({
      id: f.biblioteca, nombre: f.nombre ?? 'Biblioteca compartida', documentos: 0, creada: f.desde, actualizada: f.desde,
      propietario: f.propietario, permiso: f.permiso, compartida: true,
    }));
    return c.json([...propias, ...ajenas]);
  });

  app.post('/bibliotecas', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const b = await cuerpoJson<NuevaBiblioteca>(c);
    exigir(typeof b.nombre === 'string' && b.nombre.trim().length > 0 && b.nombre.length <= 200, 'La biblioteca necesita un nombre (hasta 200 caracteres).');
    exigir(!b.color || COLOR.test(b.color), 'El color debe ser hexadecimal, como «#b5523b».');
    const id = nuevoId('b');
    const t = ahora();
    await p.sql.ejecutar('INSERT INTO pl_bibliotecas (id, nombre, descripcion, color, creada, actualizada) VALUES (?, ?, ?, ?, ?, ?)',
      id, b.nombre.trim(), b.descripcion ?? null, b.color ?? null, t, t);
    return c.json((await leerBiblioteca(p.sql, id, p.usuario.id))!, 201);
  });

  app.get('/bibliotecas/:id', async (c: Ctx) => {
    const p = puertos(c);
    const b = await leerBiblioteca(p.sql, prm(c, 'id'), p.usuario.id);
    if (!b) noEncontrado('La biblioteca');
    b.compartida = (await p.cuentas.miembros(b.id)).length > 0;
    return c.json(b);
  });

  app.patch('/bibliotecas/:id', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const id = prm(c, 'id');
    if (!(await leerBiblioteca(p.sql, id, p.usuario.id))) noEncontrado('La biblioteca');
    const b = await cuerpoJson<Partial<NuevaBiblioteca>>(c);
    exigir(b.nombre === undefined || (typeof b.nombre === 'string' && b.nombre.trim().length > 0), 'El nombre no puede quedar vacío.');
    exigir(!b.color || COLOR.test(b.color), 'El color debe ser hexadecimal, como «#b5523b».');
    await p.sql.ejecutar('UPDATE pl_bibliotecas SET nombre = COALESCE(?, nombre), descripcion = COALESCE(?, descripcion), color = COALESCE(?, color), actualizada = ? WHERE id = ?',
      b.nombre?.trim() ?? null, b.descripcion ?? null, b.color ?? null, ahora(), id);
    return c.json((await leerBiblioteca(p.sql, id, p.usuario.id))!);
  });

  app.delete('/bibliotecas/:id', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const id = prm(c, 'id');
    if (!(await leerBiblioteca(p.sql, id, p.usuario.id))) noEncontrado('La biblioteca');
    const docs = (await p.sql.ejecutar<{ id: string }>('SELECT d.id FROM documentos d, json_each(d.bibliotecas) je WHERE je.value = ?', id)).map((f) => f.id);
    await cambiarBiblioteca(p.sql, id, docs, false);
    await p.sql.ejecutar('DELETE FROM pl_bibliotecas WHERE id = ?', id);
    await p.cuentas.borrarComparticiones(id);
    return c.json({ ok: true });
  });

  app.post('/bibliotecas/:id/documentos', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const id = prm(c, 'id');
    if (!(await leerBiblioteca(p.sql, id, p.usuario.id))) noEncontrado('La biblioteca');
    const b = await cuerpoJson<AnadirDocumentos>(c);
    exigir(Array.isArray(b.documentos) && b.documentos.length > 0 && b.documentos.length <= 1000, 'Indica entre 1 y 1000 documentos.');
    await cambiarBiblioteca(p.sql, id, b.documentos, true);
    return c.json((await leerBiblioteca(p.sql, id, p.usuario.id))!);
  });

  app.delete('/bibliotecas/:id/documentos/:documento', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const id = prm(c, 'id');
    if (!(await leerBiblioteca(p.sql, id, p.usuario.id))) noEncontrado('La biblioteca');
    await cambiarBiblioteca(p.sql, id, [prm(c, 'documento')], false);
    return c.json((await leerBiblioteca(p.sql, id, p.usuario.id))!);
  });

  app.get('/bibliotecas/:id/miembros', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    if (!(await leerBiblioteca(p.sql, id, p.usuario.id))) noEncontrado('La biblioteca');
    return c.json([
      { usuario: p.usuario.id, correo: p.usuario.correo, permiso: 'propietario', pendiente: false, desde: '' },
      ...(await p.cuentas.miembros(id)),
    ]);
  });

  app.post('/bibliotecas/:id/compartir', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    if (p.config.modo === 'local') fallo('no_disponible', 'Compartir bibliotecas solo está disponible en la versión en la nube.');
    const id = prm(c, 'id');
    const bib = await leerBiblioteca(p.sql, id, p.usuario.id);
    if (!bib) noEncontrado('La biblioteca');
    const b = await cuerpoJson<Compartir>(c);
    exigir(typeof b.correo === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.correo), 'El correo no es válido.');
    exigir(b.permiso === 'lectura' || b.permiso === 'edicion', 'El permiso debe ser «lectura» o «edicion».');
    if (b.correo.toLowerCase() === p.usuario.correo.toLowerCase()) fallo('peticion_invalida', 'No puedes compartir una biblioteca contigo.');
    return c.json(await p.cuentas.compartir(id, p.usuario.id, bib.nombre, b.correo, b.permiso), 201);
  });

  app.delete('/bibliotecas/:id/miembros/:usuario', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const id = prm(c, 'id');
    if (!(await leerBiblioteca(p.sql, id, p.usuario.id))) noEncontrado('La biblioteca');
    await p.cuentas.dejarDeCompartir(id, p.usuario.id, prm(c, 'usuario'));
    return c.json({ ok: true });
  });
}
