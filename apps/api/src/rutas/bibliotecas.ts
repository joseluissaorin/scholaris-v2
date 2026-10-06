/** Bibliotecas (ver contrato/bibliotecas.ts). */
import type { Hono } from 'hono';
import { nuevoId } from '@scholaris/nucleo';
import { DERECHOS, type AnadirDocumentos, type Biblioteca, type Derechos, type NuevaBiblioteca } from '@scholaris/contrato';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, noEncontrado } from '../compartido/errores.js';
import { ahora, cambiarBiblioteca, leerBiblioteca, listarBibliotecasPropias } from '../compartido/estanteria.js';
import { exigirEscritura, prm, puertos, type Ctx } from './util.js';

const COLOR = /^#[0-9a-f]{6}$/i;
/** Los colores con nombre de la web (rojo, azul, amarillo, tinta) o uno hexadecimal. */
const colorValido = (c?: string) => !c || COLOR.test(c) || /^[a-z]{3,12}$/.test(c);
const derechosValidos = (d?: string) => d === undefined || d in DERECHOS;

export function rutasBibliotecas(app: Hono<Entorno>): void {
  app.get('/bibliotecas', async (c: Ctx) => {
    const p = puertos(c);
    const propias = await listarBibliotecasPropias(p.sql, p.usuario.id);
    // Las de una sesión encerrada en un ámbito (invitado) no ven las bibliotecas del propietario.
    if (c.get('usuario').ambito) return c.json([]);
    const cuantos = await p.cuentas.cuantosMiembros(propias.map((b) => b.id));
    for (const b of propias) b.compartida = (cuantos.get(b.id) ?? 0) > 0;
    const ajenas: Biblioteca[] = (await p.cuentas.compartidasConmigo(p.usuario.id)).map((f) => ({
      id: f.biblioteca, nombre: f.nombre ?? 'Biblioteca compartida', documentos: 0, creada: f.desde, actualizada: f.desde,
      propietario: f.propietario, permiso: f.permiso, compartida: true,
      ...(f.pnombre ? { propietarioNombre: f.pnombre } : {}), ...(f.descripcion ? { descripcion: f.descripcion } : {}),
      derechos: (f.derechos ?? 'sin_indicar') as Derechos,
    }));
    return c.json([...propias, ...ajenas]);
  });

  app.post('/bibliotecas', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const b = await cuerpoJson<NuevaBiblioteca>(c);
    exigir(typeof b.nombre === 'string' && b.nombre.trim().length > 0 && b.nombre.length <= 200, 'La biblioteca necesita un nombre (hasta 200 caracteres).');
    exigir(colorValido(b.color), 'El color debe ser hexadecimal, como «#b5523b».');
    exigir(derechosValidos(b.derechos), 'Los derechos no son válidos.');
    const id = nuevoId('b');
    const t = ahora();
    await p.sql.ejecutar('INSERT INTO pl_bibliotecas (id, nombre, descripcion, color, creada, actualizada, derechos, nota_derechos, copiada_de) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, b.nombre.trim(), b.descripcion ?? null, b.color ?? null, t, t, b.derechos ?? null, b.notaDerechos ?? null, b.copiadaDe ? JSON.stringify(b.copiadaDe) : null);
    return c.json((await leerBiblioteca(p.sql, id, p.usuario.id))!, 201);
  });

  app.get('/bibliotecas/:id', async (c: Ctx) => {
    const p = puertos(c);
    const b = await leerBiblioteca(p.sql, prm(c, 'id'), p.usuario.id);
    if (!b) noEncontrado('La biblioteca');
    b.compartida = ((await p.cuentas.cuantosMiembros([b.id])).get(b.id) ?? 0) > 0;
    const amb = c.get('usuario').ambito;
    if (amb) b.permiso = amb.permiso;
    return c.json(b);
  });

  app.patch('/bibliotecas/:id', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const id = prm(c, 'id');
    if (!(await leerBiblioteca(p.sql, id, p.usuario.id))) noEncontrado('La biblioteca');
    const b = await cuerpoJson<Partial<NuevaBiblioteca>>(c);
    exigir(b.nombre === undefined || (typeof b.nombre === 'string' && b.nombre.trim().length > 0), 'El nombre no puede quedar vacío.');
    exigir(colorValido(b.color), 'El color debe ser hexadecimal, como «#b5523b».');
    exigir(derechosValidos(b.derechos), 'Los derechos no son válidos.');
    await p.sql.ejecutar(`UPDATE pl_bibliotecas SET nombre = COALESCE(?, nombre), descripcion = COALESCE(?, descripcion), color = COALESCE(?, color),
      derechos = COALESCE(?, derechos), nota_derechos = COALESCE(?, nota_derechos), actualizada = ? WHERE id = ?`,
      b.nombre?.trim() ?? null, b.descripcion ?? null, b.color ?? null, b.derechos ?? null, b.notaDerechos ?? null, ahora(), id);
    // Lo que ven los invitados (nombre, descripción, derechos) se guarda también en las cuentas.
    if (b.nombre || b.descripcion || b.derechos) await p.cuentas.actualizarDatosBiblioteca(id, { nombre: b.nombre?.trim() ?? null, descripcion: b.descripcion ?? null, derechos: b.derechos ?? null });
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
  // Miembros, invitaciones y enlaces: los atiende la puerta (rutas/social.ts), que ve las cuentas.
}
