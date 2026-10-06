/// <reference lib="webworker" />
// Arnés de la prueba en Chrome: convierte un archivo dentro de un Web Worker y resume.
import { configurarImprenta, convertir } from '../../src/navegador/index.js';
import type { EventoConversion, OpcionesConversion } from '../../src/tipos.js';

configurarImprenta({ recursosPdfjs: '/pdfjs/', crearTrabajador: () => new Worker('/trabajador-pdf.js', { type: 'module' }) });

self.addEventListener('message', async (m: MessageEvent<{ url: string; nombre: string; opciones?: OpcionesConversion & { muestras?: string[] } }>) => {
  const t0 = performance.now();
  try {
    const bytes = new Uint8Array(await (await fetch(m.data.url)).arrayBuffer());
    const tCarga = performance.now() - t0;
    const t1 = performance.now();
    let primera = 0, bytesPartes = 0;
    const cuenta: Record<string, number> = {};
    const muestras: Record<string, string> = {};
    let fin: Extract<EventoConversion, { tipo: 'fin' }> | null = null;
    for await (const e of convertir({ nombre: m.data.nombre, bytes }, m.data.opciones ?? {})) {
      cuenta[e.tipo] = (cuenta[e.tipo] ?? 0) + 1;
      if (e.tipo === 'parte') {
        bytesPartes += e.datos.byteLength;
        if (m.data.opciones?.muestras?.includes(e.parte.id)) muestras[e.parte.id] = btoa(Array.from(e.datos, (x) => String.fromCharCode(x)).join(''));
      }
      if (!primera && ['pagina_pdf', 'tramo_audio', 'fotograma', 'pagina_imagen'].includes(e.tipo)) primera = performance.now() - t1;
      if (e.tipo === 'fin') fin = e;
    }
    const p = fin!.paquete;
    const c = p.contenido as any;
    self.postMessage({
      ok: true, nombre: m.data.nombre, tipo: p.tipo, unidades: p.unidades, ms: Math.round(performance.now() - t1), carga: Math.round(tCarga), primera: Math.round(primera),
      MB: +(bytesPartes / 1e6).toFixed(2), cuenta, muestras, tiempos: p.tiempos, reserva: p.reserva, avisos: p.avisos.slice(0, 3),
      extra: c.clase === 'pdf' ? { escaneadas: c.paginasEscaneadas.length, p1: c.paginas[0]?.cuerpo.slice(0, 80), etiquetas: c.etiquetas?.slice(0, 5), calidad: c.paginas.map((x: any) => x.texto.calidad).slice(0, 5) }
        : c.clase === 'medio' ? { duracion: c.duracion, tramos: c.audio?.tramos.length, formato: c.audio?.formato, fotogramas: c.video?.fotogramas.length }
        : c.clase === 'documento' ? { bloques: c.bloques.length, paginas: c.paginasImpresas.length }
        : c.clase === 'imagenes' ? { paginas: c.paginas.map((x: any) => [x.nombre, x.ancho, x.alto]) } : {},
    });
  } catch (e) {
    self.postMessage({ ok: false, nombre: m.data.nombre, error: String((e as Error)?.stack ?? e) });
  }
});
