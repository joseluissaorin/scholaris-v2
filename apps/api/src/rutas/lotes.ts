/** Lotes y paquetes de biblioteca (ver contrato/comunidad.ts). */
import type { Hono } from 'hono';
import { DERECHOS, type EstimarLote, type ManifiestoPaquete, type NuevoLote, type ParcheElemento, EscritorZip, MIME_PAQUETE } from '@scholaris/contrato';
import { leerDocumento } from '@scholaris/spdf';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, noEncontrado } from '../compartido/errores.js';
import { leerBiblioteca } from '../compartido/estanteria.js';
import { apuntarElemento, cambiarEstadoLote, crearLote, detalleLote, estimar, listarLotes, reintentarElemento, siguientes } from '../compartido/lotes.js';
import { borrarDocumentoCompleto } from './documentos.js';
import { armarSpdf } from './spdf.js';
import { entero, exigirEscritura, prm, puertos, type Ctx } from './util.js';

export function rutasLotes(app: Hono<Entorno>): void {
  app.post('/lotes/estimar', async (c: Ctx) => {
    const b = await cuerpoJson<EstimarLote>(c);
    return c.json(await estimar(puertos(c), b.elementos));
  });

  app.post('/lotes', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const b = await cuerpoJson<NuevoLote>(c);
    if (b.biblioteca && !(await leerBiblioteca(p.sql, b.biblioteca, p.usuario.id))) noEncontrado('La biblioteca');
    exigir(b.modo === undefined || b.modo === 'rapido' || b.modo === 'economico', 'El modo es «rapido» o «economico».');
    return c.json(await crearLote(p, b), 201);
  });

  app.get('/lotes', async (c: Ctx) => c.json(await listarLotes(puertos(c))));

  app.get('/lotes/:id', async (c: Ctx) => {
    const p = puertos(c);
    const { avanzarLote } = await import('../compartido/lotes.js');
    await avanzarLote(p, prm(c, 'id'));
    return c.json(await detalleLote(p, prm(c, 'id')));
  });

  for (const accion of ['pausar', 'reanudar', 'cancelar'] as const) {
    app.post(`/lotes/:id/${accion}`, async (c: Ctx) => {
      exigirEscritura(c);
      return c.json(await cambiarEstadoLote(puertos(c), prm(c, 'id'), accion));
    });
  }

  app.post('/lotes/:id/siguientes', async (c: Ctx) => {
    exigirEscritura(c);
    const b = await cuerpoJson<{ max?: number }>(c);
    return c.json(await siguientes(puertos(c), prm(c, 'id'), Math.min(8, Math.max(1, b.max ?? 1))));
  });

  app.patch('/lotes/:id/elementos/:n', async (c: Ctx) => {
    exigirEscritura(c);
    const b = await cuerpoJson<ParcheElemento>(c);
    return c.json(await apuntarElemento(puertos(c), prm(c, 'id'), entero(prm(c, 'n'), 0, 1), b));
  });

  for (const accion of ['reintentar', 'omitir'] as const) {
    app.post(`/lotes/:id/elementos/:n/${accion}`, async (c: Ctx) => {
      exigirEscritura(c);
      const p = puertos(c);
      return c.json(await reintentarElemento(p, prm(c, 'id'), entero(prm(c, 'n'), 0, 1), accion === 'omitir', (d) => borrarDocumentoCompleto(p, d)));
    });
  }

  // -------------------------------------------------------------------------
  // Paquete .scholaris en flujo: un .spdf en memoria cada vez.
  // -------------------------------------------------------------------------

  app.get('/bibliotecas/:id/paquete', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    const bib = await leerBiblioteca(p.sql, id, p.usuario.id);
    if (!bib) noEncontrado('La biblioteca');
    const q = c.req.query();
    const originales = q.originales !== '0';
    const vectores = q.vectores !== '0';
    const elegidos = q.documentos ? new Set(q.documentos.split(',').filter(Boolean)) : null;
    const filas = await p.sql.ejecutar<{ id: string }>(
      'SELECT d.id FROM documentos d, json_each(d.bibliotecas) je WHERE je.value = ? ORDER BY d.titulo COLLATE NOCASE', id);
    const ids = filas.map((f) => f.id).filter((x) => !elegidos || elegidos.has(x));
    const derechos = bib.derechos ?? 'sin_indicar';
    const manifiesto: ManifiestoPaquete = {
      formato: 'scholaris-biblioteca', version: 1, generador: `scholaris ${p.config.version}`, exportado: new Date().toISOString(),
      biblioteca: {
        id: bib.id, nombre: bib.nombre, derechos, creada: bib.creada,
        ...(bib.descripcion ? { descripcion: bib.descripcion } : {}), ...(bib.color ? { color: bib.color } : {}), ...(bib.notaDerechos ? { notaDerechos: bib.notaDerechos } : {}),
      },
      opciones: { originales, vectores }, documentos: [], omitidos: [],
    };
    const zip = new EscritorZip();
    const trabajo = (async () => {
      for (const docId of ids) {
        const d = await leerDocumento(p.sql, docId);
        if (!d) continue;
        if (d.estado !== 'listo') { manifiesto.omitidos.push({ id: d.id, titulo: d.metadatos.titulo, motivo: 'Todavía no está listo.' }); continue; }
        try {
          const r = await armarSpdf(p, d, { incrustar: true, originales, vectores });
          const archivo = `documentos/${d.id}.spdf`;
          await zip.anadir(archivo, r.bytes);
          manifiesto.documentos.push({
            archivo, id: d.id, titulo: d.metadatos.titulo, autores: (d.metadatos.autores ?? []).map((a) => [a.nombre, a.apellidos].filter(Boolean).join(' ')).join('; '),
            tipo: d.tipo, bytes: r.bytes.length, ...(d.metadatos.anio ? { anio: d.metadatos.anio } : {}), ...(d.huella ? { huella: d.huella } : {}),
            ...(r.sinOriginal ? { sinOriginal: true } : {}),
          });
        } catch (e) {
          manifiesto.omitidos.push({ id: d.id, titulo: d.metadatos.titulo, motivo: (e as Error).message });
        }
      }
      const dr = DERECHOS[derechos];
      await zip.anadir('LEEME.txt', [
        `${bib.nombre}`, '',
        ...(bib.descripcion ? [bib.descripcion, ''] : []),
        `Derechos: ${dr.nombre}.`,
        ...(bib.notaDerechos ? [bib.notaDerechos] : []),
        ...(!dr.abierto ? ['', 'Este paquete puede contener obras protegidas por derechos de autor. Se comparte para uso privado de quien lo recibe: no lo publiques ni lo redistribuyas.'] : []),
        '', `${manifiesto.documentos.length} documentos en formato SPDF (documentos/*.spdf). Para abrirlo, en Scholaris: Biblioteca → Importar paquete.`,
        `Exportado el ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}.`, '',
      ].join('\n'), { comprimir: true });
      await zip.anadir('manifest.json', JSON.stringify(manifiesto, null, 2), { comprimir: true });
      await zip.cerrar();
    })().catch(async (e) => { console.error('paquete', e); await zip.abortar(e); });
    p.segundoPlano(trabajo);
    const nombre = `${bib.nombre.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 80) || 'biblioteca'}.scholaris`;
    return new Response(zip.flujo, { headers: { 'content-type': MIME_PAQUETE, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`, 'cache-control': 'no-store' } });
  });
}
