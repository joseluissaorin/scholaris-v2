/** Búsqueda (ver contrato/busqueda.ts). La lógica vive en @scholaris/busqueda. */
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Resultado } from '@scholaris/nucleo';
import { bytesAVector } from '@scholaris/nucleo';
import type {
  Buscar, BuscarMultilingue, EventoRespuesta, IntencionConsulta, Responder, RespuestaBusqueda, RespuestaMultilingue, ResultadoVista, Similares,
} from '@scholaris/contrato';
import { responder, type OpcionesBusqueda, type RespuestaBusqueda as RespuestaBuscador, type Via } from '@scholaris/busqueda';
import { compactarResultados, registrarBusqueda } from '@scholaris/funciones';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, fallo } from '../compartido/errores.js';
import { obtenerBuscador } from '../compartido/servicios.js';
import type { PuertosUsuario } from '../puertos.js';
import { citaCorta, etiquetaAncla, puertos, type Ctx } from './util.js';

const INTENCION: Record<string, IntencionConsulta> = { conceptual: 'conceptual', visual: 'visual', cita: 'literal', temporal: 'temporal' };

const VIAS: Record<string, Via[] | undefined> = { hibrida: undefined, lexica: ['lexica'], densa: ['densa'], visual: ['visual'] };

export async function aVista(p: PuertosUsuario, r: Resultado): Promise<ResultadoVista> {
  const v: ResultadoVista = {
    ...r,
    etiqueta: etiquetaAncla(r.fragmento.ancla, r.fragmento.anclaFin),
    citaCorta: citaCorta(r.documento.metadatos, r.fragmento.ancla, r.fragmento.anclaFin),
  };
  const [u] = await p.sql.ejecutar<{ m: string | null }>('SELECT COALESCE(miniatura, imagen) AS m FROM unidades WHERE id = ?', r.fragmento.unidad);
  if (u?.m) v.miniaturaUrl = await p.almacen.urlLectura(u.m);
  return v;
}

/** Comprueba y consume la cuota diaria de búsquedas. */
async function consumirBusqueda(p: PuertosUsuario): Promise<void> {
  const plan = p.config.modo === 'local' ? 'local' : p.usuario.plan;
  if (!(await p.cuentas.consumir(p.usuario.id, plan, 'busquedasDia'))) {
    fallo(plan === 'gratis' ? 'requiere_pro' : 'cuota_superada', 'Has llegado al máximo de búsquedas de hoy en tu plan. Vuelve mañana o pásate a Pro.', { cuota: 'busquedasDia' });
  }
}

function validar(b: Buscar): void {
  exigir(typeof b.consulta === 'string' && b.consulta.trim().length > 0, 'Escribe algo que buscar.');
  exigir(b.consulta.length <= 4000, 'La consulta es demasiado larga (máximo 4000 caracteres).');
}

function opciones(b: Buscar): OpcionesBusqueda {
  const o: OpcionesBusqueda = { limite: Math.min(100, Math.max(1, b.k ?? 20)) };
  if (b.filtros) o.filtros = b.filtros;
  if (b.reordenar !== undefined) o.reordenar = b.reordenar;
  const vias = VIAS[b.modo ?? 'hibrida'];
  if (vias) o.vias = vias;
  return o;
}

async function grabar(p: PuertosUsuario, tipo: 'busqueda' | 'respuesta' | 'multilingue' | 'similares', b: Buscar, r: RespuestaBuscador | null, extra: { respuesta?: string; confianza?: 'alta' | 'media' | 'baja'; ms: number; error?: string }): Promise<string | undefined> {
  if (b.sinHistorial) return undefined;
  try {
    const id = await registrarBusqueda(p.sql, {
      tipo, consulta: b.consulta, intencion: r?.comprension.intencion ?? null, filtros: b.filtros, pro: p.usuario.plan === 'pro',
      estado: extra.error ? 'error' : 'ok', mensajeError: extra.error ?? null, nResultados: r?.resultados.length ?? 0,
      respuesta: extra.respuesta ?? null, confianza: extra.confianza ?? null, principales: r ? compactarResultados(r.resultados) : [],
      ms: extra.ms, msBusqueda: r?.tiempos.total ?? null, msReordenacion: r?.tiempos.reordenacion ?? null,
    });
    return id ?? undefined;
  } catch (e) {
    console.error('historial', e);
    return undefined;
  }
}

function confianzaDe(resultados: Resultado[]): 'alta' | 'media' | 'baja' {
  const mejor = resultados[0]?.puntuacion ?? 0;
  return resultados.length >= 3 && mejor >= 0.5 ? 'alta' : resultados.length >= 1 && mejor >= 0.2 ? 'media' : 'baja';
}

export function rutasBusqueda(app: Hono<Entorno>): void {
  app.post('/busqueda', async (c: Ctx) => {
    const p = puertos(c);
    const b = await cuerpoJson<Buscar>(c);
    validar(b);
    await consumirBusqueda(p);
    const t0 = Date.now();
    const buscador = await obtenerBuscador(p);
    const r = await buscador.buscar(b.consulta, opciones(b));
    const ms = Date.now() - t0;
    const salida: RespuestaBusqueda = {
      resultados: await Promise.all(r.resultados.map((x) => aVista(p, x))),
      intencion: INTENCION[r.comprension.intencion] ?? 'conceptual',
      expansion: r.comprension.expansiones.map((e) => e.texto),
      ms,
    };
    const evento = await grabar(p, 'busqueda', b, r, { ms });
    if (evento) salida.evento = evento;
    return c.json(salida);
  });

  app.post('/busqueda/responder', async (c: Ctx) => {
    const p = puertos(c);
    const b = await cuerpoJson<Responder>(c);
    validar(b);
    await consumirBusqueda(p);
    const ia = await p.inteligencia();
    const buscador = await obtenerBuscador(p);
    return streamSSE(c, async (sse) => {
      const enviar = (e: EventoRespuesta) => sse.writeSSE({ event: e.tipo, data: JSON.stringify(e) });
      const t0 = Date.now();
      let busqueda: RespuestaBuscador | null = null;
      let texto = '';
      try {
        for await (const ev of responder(buscador, ia.redactor, b.consulta, { busqueda: opciones(b), contexto: Math.min(12, b.k ?? 8) })) {
          if (ev.tipo === 'busqueda') {
            busqueda = ev.busqueda;
            await enviar({ tipo: 'resultados', resultados: await Promise.all(ev.busqueda.resultados.map((x) => aVista(p, x))), intencion: INTENCION[ev.busqueda.comprension.intencion] ?? 'conceptual' });
          } else if (ev.tipo === 'texto') {
            texto += ev.delta;
            await enviar({ tipo: 'texto', delta: ev.delta });
          } else if (ev.tipo === 'fin') {
            for (const f of ev.fuentes) {
              await enviar({
                tipo: 'cita', n: f.n, fragmento: f.fragmento, documento: f.documento, etiqueta: etiquetaAncla(f.resultado.fragmento.ancla, f.resultado.fragmento.anclaFin),
                citaCorta: citaCorta(f.resultado.documento.metadatos, f.resultado.fragmento.ancla, f.resultado.fragmento.anclaFin),
              });
            }
            const confianza = ev.fuentes.length === 0 ? 'baja' : confianzaDe(busqueda?.resultados ?? []);
            const ms = Date.now() - t0;
            const evento = await grabar(p, 'respuesta', b, busqueda, { respuesta: ev.markdown || texto, confianza, ms });
            await enviar({ tipo: 'fin', ms, confianza, ...(evento ? { evento } : {}) });
          }
        }
      } catch (e) {
        console.error('responder', e);
        await grabar(p, 'respuesta', b, busqueda, { ms: Date.now() - t0, error: (e as Error).message });
        await enviar({ tipo: 'error', mensaje: 'No he podido terminar la respuesta. Vuelve a intentarlo.' });
      }
    });
  });

  app.post('/busqueda/similares', async (c: Ctx) => {
    const p = puertos(c);
    const b = await cuerpoJson<Similares>(c);
    exigir(b.fragmento || b.documento, 'Indica un fragmento o un documento de partida.');
    const t0 = Date.now();
    const k = Math.min(50, Math.max(1, b.k ?? 10));
    const ia = await p.inteligencia();
    let vector: Float32Array | null = null;
    let excluirDoc: string | undefined;
    let consulta = '';
    if (b.fragmento) {
      const [v] = await p.sql.ejecutar<{ valores: Uint8Array }>('SELECT valores FROM vectores WHERE objetivo = ? AND id = ? AND espacio = ?', 'fragmento', b.fragmento, ia.embebedor.espacio.id);
      if (v) vector = bytesAVector(v.valores);
      const [f] = await p.sql.ejecutar<{ texto: string }>('SELECT texto FROM fragmentos WHERE id = ?', b.fragmento);
      if (!f) fallo('no_encontrado', 'El fragmento no existe.');
      consulta = f.texto.slice(0, 1500);
    } else {
      excluirDoc = b.documento;
      const [d] = await p.sql.ejecutar<{ titulo: string | null; metadatos: string }>('SELECT titulo, metadatos FROM documentos WHERE id = ?', b.documento!);
      if (!d) fallo('no_encontrado', 'El documento no existe.');
      const m = JSON.parse(d.metadatos) as { resumen?: string };
      consulta = [d.titulo, m.resumen].filter(Boolean).join('. ').slice(0, 1500);
    }
    const buscador = await obtenerBuscador(p);
    let resultados: Resultado[];
    if (vector && p.indice) {
      const coincidencias = await p.indice.consultar(p.config.espacioNombres(p.usuario.id), vector, { k: k + 5, filtro: { objetivo: 'fragmento' }, conMetadatos: true });
      const ids = coincidencias.map((x) => x.id.replace(/^f:/, '')).filter((id) => id !== b.fragmento);
      const r = await buscador.buscar(consulta, { limite: k + 5, ...(b.filtros ? { filtros: b.filtros } : {}), comprender: false, reordenar: false });
      const orden = new Map(ids.map((id, i) => [id, i]));
      resultados = r.resultados.filter((x) => x.fragmento.id !== b.fragmento).sort((a, z) => (orden.get(a.fragmento.id) ?? 99) - (orden.get(z.fragmento.id) ?? 99));
    } else {
      const r = await buscador.buscar(consulta, { limite: k + 5, ...(b.filtros ? { filtros: b.filtros } : {}), comprender: false });
      resultados = r.resultados.filter((x) => x.fragmento.id !== b.fragmento);
    }
    if (excluirDoc) resultados = resultados.filter((x) => x.documento.id !== excluirDoc);
    return c.json<RespuestaBusqueda>({ resultados: await Promise.all(resultados.slice(0, k).map((x) => aVista(p, x))), ms: Date.now() - t0 });
  });

  app.post('/busqueda/multilingue', async (c: Ctx) => {
    const p = puertos(c);
    const b = await cuerpoJson<BuscarMultilingue>(c);
    validar(b);
    await consumirBusqueda(p);
    const t0 = Date.now();
    const buscador = await obtenerBuscador(p);
    const comp = await buscador.comprender(b.consulta, true);
    const idiomas = b.idiomas?.length ? b.idiomas : Object.keys(comp.traducciones);
    const traducciones = idiomas.filter((i) => comp.traducciones[i]).map((idioma) => ({ idioma, consulta: comp.traducciones[idioma]! }));
    // El buscador ya fusiona las traducciones como expansiones; se pasan además como consultas propias.
    const listas = await Promise.all([b.consulta, ...traducciones.map((t) => t.consulta)].map((q) => buscador.buscar(q, opciones(b))));
    const vistos = new Map<string, Resultado>();
    for (const l of listas) for (const r of l.resultados) {
      const prev = vistos.get(r.fragmento.id);
      if (!prev || prev.puntuacion < r.puntuacion) vistos.set(r.fragmento.id, r);
    }
    const resultados = [...vistos.values()].sort((a, z) => z.puntuacion - a.puntuacion).slice(0, Math.min(100, b.k ?? 20));
    const ms = Date.now() - t0;
    const salida: RespuestaMultilingue = {
      resultados: await Promise.all(resultados.map((x) => aVista(p, x))), traducciones,
      intencion: INTENCION[comp.intencion] ?? 'conceptual', ms,
    };
    const evento = await grabar(p, 'multilingue', b, listas[0] ?? null, { ms });
    if (evento) salida.evento = evento;
    return c.json(salida);
  });
}
