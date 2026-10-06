/**
 * Medios reproducibles al instante.
 *
 *   GET  /documentos/:id/medio/diagnostico  → DiagnosticoMedio  (¿índice delante? ¿qué códecs?)
 *   POST /documentos/:id/medio/preparar     → MedioPreparado    (pone el índice delante si hace falta)
 *
 * «Preparar» es la reparación de los documentos que ya estaban en la
 * biblioteca; los nuevos se preparan solos al final de la ingesta.
 */
import type { Hono } from 'hono';
import type { DiagnosticoMedio, MedioPreparado } from '@scholaris/contrato';
import { leerDocumento } from '@scholaris/spdf';
import type { Entorno } from '../entorno.js';
import { fallo, noEncontrado } from '../compartido/errores.js';
import { adelantarMoov, diagnosticar, esMp4 } from '../compartido/medio-rapido.js';
import { exigirEscritura, prm, puertos, type Ctx } from './util.js';

async function originalDeMedio(c: Ctx) {
  const p = puertos(c);
  const d = (await leerDocumento(p.sql, prm(c, 'id'))) ?? noEncontrado('El documento');
  if (d.tipo !== 'audio' && d.tipo !== 'video') fallo('peticion_invalida', 'Este documento no es un audio ni un vídeo.');
  if (!d.original) noEncontrado('El archivo del medio');
  return { p, d, original: d.original };
}

export function rutasMedios(app: Hono<Entorno>): void {
  app.get('/documentos/:id/medio/diagnostico', async (c: Ctx) => {
    const { p, d, original } = await originalDeMedio(c);
    if (!esMp4(d.mime, original)) return c.json<DiagnosticoMedio>({ mp4: false, rapido: true, codecs: [], dudosos: [] });
    const r = await diagnosticar(p.almacen, original);
    return c.json<DiagnosticoMedio>(r?.diag ?? { mp4: false, rapido: true, codecs: [], dudosos: [] });
  });

  app.post('/documentos/:id/medio/preparar', async (c: Ctx) => {
    exigirEscritura(c);
    const { p, d, original } = await originalDeMedio(c);
    if (!esMp4(d.mime, original)) return c.json<MedioPreparado>({ estado: 'no_mp4' });
    const r = await adelantarMoov(p.almacen, original, d.mime);
    return c.json<MedioPreparado>({ estado: r.estado, ...(r.diag ? { diagnostico: r.diag } : {}), ...(r.ms != null ? { ms: r.ms } : {}) });
  });
}
