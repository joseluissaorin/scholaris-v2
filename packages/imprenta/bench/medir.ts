/**
 * Banco de la imprenta: convierte los originales del banco con la plataforma
 * Node y apunta tiempos y tamaños. Uso: pnpm --filter @scholaris/imprenta bench [archivo…] [--hilos N]
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { convertirEnMemoria } from '../src/node/index.js';
import type { EventoConversion } from '../src/tipos.js';

const DATOS = new URL('../../../bench/datos/originales/', import.meta.url).pathname;
const args = process.argv.slice(2);
const iH = args.indexOf('--hilos');
const hilos = iH >= 0 ? Number(args[iH + 1]) : undefined;
const iS = args.indexOf('--salida');
const salida = iS >= 0 ? args[iS + 1] : null;
const archivos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--hilos' && args[i - 1] !== '--salida');

for (const a of archivos) {
  const t0 = performance.now();
  let primera = 0;
  const r = await convertirEnMemoria(a.includes('/') ? a : join(DATOS, a), hilos === undefined ? {} : { hilos }, (e: EventoConversion) => {
    if (!primera && (e.tipo === 'pagina_pdf' || e.tipo === 'tramo_audio' || e.tipo === 'fotograma' || e.tipo === 'pagina_imagen')) primera = performance.now() - t0;
  });
  const ms = performance.now() - t0;
  const bytes = [...r.datos.values()].reduce((s, b) => s + b.byteLength, 0);
  const p = r.paquete;
  const resumen: Record<string, unknown> = {
    archivo: a, tipo: p.tipo, unidades: p.unidades, ms: Math.round(ms), primeraPiezaMs: Math.round(primera),
    partes: p.partes.length, MB: +(bytes / 1e6).toFixed(2), manifiestoKB: Math.round(JSON.stringify(p).length / 1024), tiempos: p.tiempos,
  };
  if (p.contenido.clase === 'pdf') {
    const c = p.contenido;
    resumen.paginasPorSegundo = +(c.paginas.length / (ms / 1000)).toFixed(1);
    resumen.escaneadas = c.paginasEscaneadas.length;
    resumen.mixto = c.mixto;
    resumen.calidadMedia = +(c.paginas.reduce((s, x) => s + x.texto.calidad, 0) / c.paginas.length).toFixed(3);
    resumen.esquema = c.esquema.length;
    resumen.etiquetas = c.etiquetas ? c.etiquetas.slice(0, 16).join(',') : null;
    resumen.titulillos = c.titulillos;
    resumen.metadatos = p.metadatos;
    const jpgs = p.partes.filter((x) => x.clase === 'pagina');
    resumen.jpegMedioKB = jpgs.length ? Math.round(jpgs.reduce((s, x) => s + x.bytes, 0) / jpgs.length / 1024) : 0;
  }
  if (p.contenido.clase === 'medio') {
    resumen.duracion = p.duracion;
    resumen.tramos = p.contenido.audio?.tramos.length;
    resumen.fotogramas = p.contenido.video?.fotogramas.length;
    resumen.velocidad = +(p.duracion! / (ms / 1000)).toFixed(1) + '× tiempo real';
  }
  console.log(JSON.stringify(resumen, null, 1));
  if (salida) {
    const dir = join(salida, a.replace(/\W+/g, '_'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'manifiesto.json'), JSON.stringify(p, null, 1));
    for (const [id, b] of r.datos) {
      await mkdir(join(dir, id, '..'), { recursive: true });
      await writeFile(join(dir, id), b);
    }
  }
}
