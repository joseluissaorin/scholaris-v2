/** Búsqueda (ver contrato/busqueda.ts). La lógica vive en @scholaris/busqueda. */
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Resultado } from '@scholaris/nucleo';
import { bytesAVector } from '@scholaris/nucleo';
import type {
  Buscar, BuscarMultilingue, EventoBusquedaEnDos, EventoRespuesta, IntencionConsulta, Responder, RespuestaBusqueda, RespuestaMultilingue, ResultadoVista, Similares,
} from '@scholaris/contrato';
import { responder, type OpcionesBusqueda, type RespuestaBusqueda as RespuestaBuscador, type Via } from '@scholaris/busqueda';
import { compactarResultados, registrarBusqueda } from '@scholaris/funciones';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, fallo } from '../compartido/errores.js';
import { obtenerBuscador } from '../compartido/servicios.js';
import { LIMITES } from '../compartido/planes.js';
import type { PuertosUsuario } from '../puertos.js';
import { figuraDeResultado } from './contenido.js';
import { anclaDePasaje, citaCorta, claveDe, etiquetaAncla, puertos, type Ctx } from './util.js';
import { documentosDelAmbito, filtrosEnAmbito } from './ambito.js';

const INTENCION: Record<string, IntencionConsulta> = { conceptual: 'conceptual', visual: 'visual', cita: 'literal', temporal: 'temporal' };

const VIAS: Record<string, Via[] | undefined> = { hibrida: undefined, lexica: ['lexica'], densa: ['densa'], visual: ['visual'] };

export async function aVista(p: PuertosUsuario, r: Resultado): Promise<ResultadoVista> {
  // La etiqueta y la cita son las del pasaje (sus oraciones, su página o su segundo), no las del fragmento entero.
  const [ancla, fin] = anclaDePasaje(r);
  const v: ResultadoVista = {
    ...r,
    etiqueta: etiquetaAncla(ancla, fin),
    citaCorta: citaCorta(r.documento.metadatos, ancla, fin),
  };
  const [u] = await p.sql.ejecutar<{ m: string | null }>('SELECT COALESCE(miniatura, imagen) AS m FROM unidades WHERE id = ?', r.fragmento.unidad);
  if (u?.m) v.miniaturaUrl = await p.almacen.urlLectura(claveDe(p.usuario.id, r.documento.id, u.m));
  const figura = await figuraDeResultado(p, r.documento.id, r.fragmento, r.vias).catch(() => undefined);
  if (figura) v.figura = figura;
  return v;
}

/** Comprueba y consume la cuota diaria de búsquedas. */
async function consumirBusqueda(p: PuertosUsuario): Promise<void> {
  const plan = p.config.modo === 'local' ? 'local' : p.usuario.plan;
  const limite = LIMITES[plan].busquedasDia;
  if (limite === null) return;
  // El contador del día vive en la estantería (local y atómico); D1 se pone al día después.
  const dia = new Date().toISOString().slice(0, 10);
  await p.sql.ejecutar('INSERT INTO pl_uso (metrica, periodo, n) VALUES (?, ?, 0) ON CONFLICT DO NOTHING', 'busquedasDia', dia);
  const f = await p.sql.ejecutar<{ n: number }>('UPDATE pl_uso SET n = n + 1 WHERE metrica = ? AND periodo = ? AND n + 1 <= ? RETURNING n', 'busquedasDia', dia, limite);
  if (!f.length) fallo(plan === 'gratis' ? 'requiere_pro' : 'cuota_superada', 'Has llegado al máximo de búsquedas de hoy en tu plan. Vuelve mañana o pásate a Pro.', { cuota: 'busquedasDia' });
  p.segundoPlano(p.cuentas.consumir(p.usuario.id, plan, 'busquedasDia').catch(() => false));
}

function validar(b: Buscar): void {
  exigir(typeof b.consulta === 'string' && b.consulta.trim().length > 0, 'Escribe algo que buscar.');
  exigir(b.consulta.length <= 4000, 'La consulta es demasiado larga (máximo 4000 caracteres).');
}

/** Encierra la petición en la biblioteca compartida (y sin historial del propietario). */
function enAmbito<T extends Buscar | Similares>(c: Ctx, b: T): T {
  if (!c.get('usuario').ambito) return b;
  return { ...b, filtros: filtrosEnAmbito(c, b.filtros), ...('consulta' in b ? { sinHistorial: true } : {}) };
}

/** Sin repetidos: mismo fragmento, o mismo documento, ancla y texto (versiones viejas, reintentos). */
function sinRepetidos(rs: Resultado[]): Resultado[] {
  const vistos = new Set<string>();
  return rs.filter((r) => {
    const claves = [`f:${r.fragmento.id}`, `a:${r.documento.id}|${JSON.stringify(r.fragmento.ancla)}|${r.fragmento.texto.slice(0, 120)}`];
    if (claves.some((k) => vistos.has(k))) return false;
    for (const k of claves) vistos.add(k);
    return true;
  });
}

/** Por si acaso: fuera lo que no sea de la biblioteca compartida. */
async function soloAmbito(c: Ctx, rs0: Resultado[]): Promise<Resultado[]> {
  const rs = sinRepetidos(rs0);
  const ok = await documentosDelAmbito(c);
  if (!ok) return rs;
  return rs.filter((r) => ok.has(r.documento.id));
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
    const b = enAmbito(c, await cuerpoJson<Buscar>(c));
    validar(b);
    await consumirBusqueda(p);
    const t0 = Date.now();
    const buscador = await obtenerBuscador(p);
    const final = async (r: RespuestaBuscador): Promise<RespuestaBusqueda> => {
      r.resultados = await soloAmbito(c, r.resultados);
      const ms = Date.now() - t0;
      const salida: RespuestaBusqueda = {
        resultados: await Promise.all(r.resultados.map((x) => aVista(p, x))),
        intencion: INTENCION[r.comprension.intencion] ?? 'conceptual',
        expansion: r.comprension.expansiones.map((e) => e.texto),
        ms,
        tiempos: { ...r.tiempos, puerta: Number(c.req.header('x-scholaris-ms-puerta') ?? 0) },
      };
      const evento = await grabar(p, 'busqueda', b, r, { ms });
      if (evento) salida.evento = evento;
      return salida;
    };
    if (!(c.req.header('accept') ?? '').includes('text/event-stream')) return c.json(await final(await buscador.buscar(b.consulta, opciones(b))));

    // En dos tiempos: el orden de la fusión en cuanto lo hay y, después, el reordenado.
    return streamSSE(c, async (sse) => {
      const enviar = (e: EventoBusquedaEnDos) => sse.writeSSE({ event: e.tipo, data: JSON.stringify(e) });
      let preliminar: Promise<void> = Promise.resolve();
      let terminado = false;
      let fusionEnviada = false;
      // Lo primero que se pinta: la vía léxica sola (FTS en la propia estantería, sin esperar
      // al vector de la consulta). La fusión y el definitivo la sustituyen al llegar.
      const lexica = (async () => {
        const o = opciones(b);
        if (o.vias && !o.vias.includes('lexica')) return;
        const rl = await buscador.buscar(b.consulta, { ...o, vias: ['lexica'], reordenar: false, juez: false });
        const vistas = await Promise.all((await soloAmbito(c, rl.resultados)).map((x) => aVista(p, x)));
        if (vistas.length && !fusionEnviada && !terminado) await enviar({ tipo: 'preliminar', resultados: vistas, ms: Date.now() - t0, via: 'lexica' });
      })().catch((e) => console.error('preliminar lexica', e));
      try {
        const r = await buscador.buscar(b.consulta, {
          ...opciones(b),
          alPreliminar: (rs) => {
            fusionEnviada = true;
            preliminar = (async () => {
              await lexica;
              // El orden preliminar también cita su pasaje con su página o su segundo (como el definitivo).
              await buscador.anclarPasajes(rs);
              const vistas = await Promise.all((await soloAmbito(c, rs)).map((x) => aVista(p, x)));
              if (!terminado) await enviar({ tipo: 'preliminar', resultados: vistas, ms: Date.now() - t0, via: 'fusion' });
            })().catch((e) => console.error('preliminar', e));
          },
        });
        await lexica;
        await preliminar;
        const salida = await final(r);
        terminado = true;
        await enviar({ tipo: 'final', respuesta: salida });
      } catch (e) {
        console.error('busqueda', e);
        await enviar({ tipo: 'error', mensaje: 'No he podido terminar la búsqueda. Vuelve a intentarlo.' });
      }
    });
  });

  app.post('/busqueda/responder', async (c: Ctx) => {
    const p = puertos(c);
    const b = enAmbito(c, await cuerpoJson<Responder>(c));
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
            ev.busqueda.resultados = await soloAmbito(c, ev.busqueda.resultados);
            busqueda = ev.busqueda;
            await enviar({ tipo: 'resultados', resultados: await Promise.all(ev.busqueda.resultados.map((x) => aVista(p, x))), intencion: INTENCION[ev.busqueda.comprension.intencion] ?? 'conceptual' });
          } else if (ev.tipo === 'texto') {
            texto += ev.delta;
            await enviar({ tipo: 'texto', delta: ev.delta });
          } else if (ev.tipo === 'fin') {
            for (const f of ev.fuentes) {
              // La nota cita las oraciones que sostienen su frase (con su página); si no las hay, el fragmento entero.
              const [ancla, fin] = f.pasajeRelevante?.ancla ? [f.pasajeRelevante.ancla, f.pasajeRelevante.anclaFin] : [f.resultado.fragmento.ancla, f.resultado.fragmento.anclaFin];
              await enviar({
                tipo: 'cita', n: f.n, fragmento: f.fragmento, documento: f.documento, etiqueta: etiquetaAncla(ancla, fin),
                citaCorta: citaCorta(f.resultado.documento.metadatos, ancla, fin),
                ...(f.pasajeRelevante ? { pasaje: f.pasajeRelevante } : {}),
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
    const b = enAmbito(c, await cuerpoJson<Similares>(c));
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
    resultados = await soloAmbito(c, resultados);
    return c.json<RespuestaBusqueda>({ resultados: await Promise.all(resultados.slice(0, k).map((x) => aVista(p, x))), ms: Date.now() - t0 });
  });

  app.post('/busqueda/multilingue', async (c: Ctx) => {
    const p = puertos(c);
    const b = enAmbito(c, await cuerpoJson<BuscarMultilingue>(c));
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
    const resultados = (await soloAmbito(c, [...vistos.values()])).sort((a, z) => z.puntuacion - a.puntuacion).slice(0, Math.min(100, b.k ?? 20));
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
