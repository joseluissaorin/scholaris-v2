/**
 * La comprensión de los documentos (ver contrato/comprension.ts y
 * docs/COMPRENSION.md): el mapa, los segmentos, las fichas y las apariciones de
 * cada documento, y pedir que se haga (o se rehaga) para uno o para toda la
 * biblioteca. Pedirla gasta modelo: solo quien es dueño de la estantería.
 */
import type { Hono } from 'hono';
import { LENTES, type Ficha, type Lente, type ObjetivoFicha, type RolAparicion, type TipoSegmento, type ValorSQL } from '@scholaris/nucleo';
import type {
  AparicionVista, ComprensionBiblioteca, ComprensionCancelada, ComprensionLanzada, EstadoComprensionVista, MapaComprension, Pagina, PedirComprension, PedirComprensionBiblioteca,
} from '@scholaris/contrato';
import { leerDocumento, leerFichas, leerSegmentos } from '@scholaris/spdf';
import { leerEstadoComprension, type EstadoComprension } from '@scholaris/ingesta';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, noEncontrado } from '../compartido/errores.js';
import { cancelarComprension, comprenderBiblioteca, lanzarComprension } from '../compartido/comprension.js';
import { entero, exigirEscritura, json, prm, puertos, type Ctx } from './util.js';

type Fila = Record<string, ValorSQL>;

const TIPOS_SEGMENTO = new Set<TipoSegmento>([
  'obra', 'parte', 'capitulo', 'apartado', 'secuencia', 'escena', 'plano', 'acto', 'cuadro', 'poema', 'estrofa', 'tema', 'bloque', 'intervencion', 'diapositiva', 'tabla', 'folio', 'articulo', 'otro',
]);
const ROLES = new Set<RolAparicion>(['nombrado', 'aludido', 'presente', 'habla', 'visible', 'audible', 'citado', 'definido', 'otro']);
const OBJETIVOS = new Set<ObjetivoFicha>(['documento', 'segmento', 'entidad', 'figura', 'relacion']);

/** El estado sin lo interno (parámetros del Workflow, instancia). */
export function estadoVista(e: EstadoComprension | null): EstadoComprensionVista | null {
  if (!e) return null;
  return {
    documento: e.documento, estado: e.estado, lentes: e.lentes, version: e.version, pasos: e.pasos, usd: e.usd, tokensEntrada: e.tokensEntrada,
    tokensSalida: e.tokensSalida, llamadas: e.llamadas, avisos: e.avisos, iniciado: e.iniciado, actualizado: e.actualizado,
    ...(e.error ? { error: e.error } : {}), ...(e.cancelada ? { cancelada: true } : {}), ...(e.modelo ? { modelo: e.modelo } : {}),
  };
}

function lentesValidas(v: unknown): Lente[] | undefined {
  if (v === undefined) return undefined;
  exigir(Array.isArray(v) && v.every((x) => (LENTES as readonly string[]).includes(String(x))), `«lentes» admite: ${LENTES.join(', ')}.`);
  return (v as Lente[]).slice(0, 2);
}

async function existe(c: Ctx, id: string): Promise<void> {
  if (!(await leerDocumento(puertos(c).sql, id))) noEncontrado('El documento');
}

export function rutasComprension(app: Hono<Entorno>): void {
  app.get('/documentos/:id/comprension', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    await existe(c, id);
    const estado = await leerEstadoComprension(p.sql, id);
    const segmentos = (await leerSegmentos(p.sql, id)).filter((s) => s.tipo !== 'plano');
    const global = await leerFichas(p.sql, { documento: id, clase: 'global' });
    const [t] = await p.sql.ejecutar<Fila>(
      `SELECT (SELECT COUNT(*) FROM segmentos WHERE documento = ?) AS s, (SELECT COUNT(*) FROM segmentos WHERE documento = ? AND tipo = 'plano') AS pl,
              (SELECT COUNT(*) FROM fichas WHERE documento = ?) AS f, (SELECT COUNT(*) FROM apariciones WHERE documento = ?) AS a,
              (SELECT COUNT(DISTINCT entidad) FROM apariciones WHERE documento = ?) AS e`, id, id, id, id, id,
    );
    const mapa: MapaComprension = {
      documento: id, estado: estadoVista(estado), lentes: estado?.lentes ?? [], segmentos, global,
      totales: { segmentos: Number(t?.s ?? 0), planos: Number(t?.pl ?? 0), fichas: Number(t?.f ?? 0), apariciones: Number(t?.a ?? 0), entidades: Number(t?.e ?? 0) },
    };
    return c.json(mapa);
  });

  app.get('/documentos/:id/segmentos', async (c: Ctx) => {
    const id = prm(c, 'id');
    await existe(c, id);
    const tipo = c.req.query('tipo');
    if (tipo) exigir(TIPOS_SEGMENTO.has(tipo as TipoSegmento), `«${tipo}» no es un tipo de segmento.`);
    const nivel = c.req.query('nivel');
    return c.json(await leerSegmentos(puertos(c).sql, id, { ...(tipo ? { tipo: tipo as TipoSegmento } : {}), ...(nivel ? { nivelMaximo: entero(nivel, 1, 1, 20) } : {}) }));
  });

  app.get('/documentos/:id/fichas', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    await existe(c, id);
    const q = (k: string) => c.req.query(k);
    const objetivo = q('objetivo');
    if (objetivo) exigir(OBJETIVOS.has(objetivo as ObjetivoFicha), `«${objetivo}» no es un objetivo de ficha.`);
    const lente = q('lente');
    if (lente) exigir((LENTES as readonly string[]).includes(lente), `«${lente}» no es una lente.`);
    const desde = entero(q('desde'), 0, 0), limite = entero(q('limite'), 200, 1, 1000);
    const todas: Ficha[] = await leerFichas(p.sql, {
      documento: id, ...(objetivo ? { objetivo: objetivo as ObjetivoFicha } : {}), ...(q('clase') ? { clase: q('clase')! } : {}),
      ...(lente ? { lente: lente as Lente } : {}), ...(q('segmento') ? { objetivoId: q('segmento')! } : {}), ...(q('entidad') ? { objetivoId: q('entidad')! } : {}),
    });
    const pagina: Pagina<Ficha> = { elementos: todas.slice(desde, desde + limite), total: todas.length, ...(desde + limite < todas.length ? { siguiente: String(desde + limite) } : {}) };
    return c.json(pagina);
  });

  app.get('/documentos/:id/apariciones', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    await existe(c, id);
    const q = (k: string) => c.req.query(k);
    const rol = q('rol');
    if (rol) exigir(ROLES.has(rol as RolAparicion), `«${rol}» no es un rol de aparición.`);
    const condiciones = ['a.documento = ?'];
    const ps: ValorSQL[] = [id];
    if (q('entidad')) { condiciones.push('a.entidad = ?'); ps.push(q('entidad')!); }
    if (q('segmento')) { condiciones.push('a.segmento = ?'); ps.push(q('segmento')!); }
    if (rol) { condiciones.push('a.rol = ?'); ps.push(rol); }
    const desde = entero(q('desde'), 0, 0), limite = entero(q('limite'), 500, 1, 5000);
    const donde = condiciones.join(' AND ');
    const [t] = await p.sql.ejecutar<Fila>(`SELECT COUNT(*) AS n FROM apariciones a WHERE ${donde}`, ...ps);
    const filas = await p.sql.ejecutar<Fila>(
      `SELECT a.*, e.nombre AS nombre_entidad, e.tipo AS tipo_entidad FROM apariciones a LEFT JOIN entidades e ON e.id = a.entidad
        WHERE ${donde} ORDER BY coalesce(a.fisica, 0), coalesce(a.t0, 0), a.id LIMIT ? OFFSET ?`, ...ps, limite, desde,
    );
    const elementos: AparicionVista[] = filas.map((f) => ({
      id: String(f.id), entidad: String(f.entidad), documento: String(f.documento), ...(f.segmento ? { segmento: String(f.segmento) } : {}),
      ancla: json(f.ancla, { tipo: 'imagen' as const }), ...(f.ancla_fin ? { anclaFin: json(f.ancla_fin, { tipo: 'imagen' as const }) } : {}),
      forma: String(f.forma), rol: String(f.rol) as RolAparicion, confianza: Number(f.confianza), nombre: String(f.nombre_entidad ?? ''), tipo: String(f.tipo_entidad ?? ''),
    }));
    const total = Number(t?.n ?? 0);
    const pagina: Pagina<AparicionVista> = { elementos, total, ...(desde + limite < total ? { siguiente: String(desde + limite) } : {}) };
    return c.json(pagina);
  });

  app.post('/documentos/:id/comprender', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const id = prm(c, 'id');
    const d = await leerDocumento(p.sql, id);
    if (!d) noEncontrado('El documento');
    exigir(d.estado === 'listo', 'El documento todavía no está listo: la comprensión empieza sola cuando termina la ingesta.');
    const b = await cuerpoJson<PedirComprension>(c);
    const lentes = lentesValidas(b.lentes);
    const tope = typeof b.presupuestoUsd === 'number' && Number.isFinite(b.presupuestoUsd) ? Math.min(20, Math.max(0.05, b.presupuestoUsd)) : undefined;
    const PASOS = ['estructura', 'fichas', 'entidades', 'personajes', 'global'] as const;
    const rehacer = Array.isArray(b.rehacer) ? b.rehacer.filter((x): x is (typeof PASOS)[number] => (PASOS as readonly string[]).includes(x)) : [];
    const r = await lanzarComprension(p, id, { ...(b.forzar ? { forzar: true } : {}), ...(lentes ? { lentes } : {}), ...(b.economico ? { economico: true } : {}), ...(tope !== undefined ? { presupuestoUsd: tope } : {}), ...(rehacer.length ? { rehacer } : {}) });
    const salida: ComprensionLanzada = { documento: id, instancia: r.instancia, estado: r.estado };
    return c.json(salida, 202);
  });

  app.post('/documentos/:id/comprension/cancelar', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const id = prm(c, 'id');
    const d = await leerDocumento(p.sql, id);
    if (!d) noEncontrado('El documento');
    const e = await cancelarComprension(p, id);
    const salida: ComprensionCancelada = { documento: id, estado: e?.estado ?? null, ...(e?.error ? { error: e.error } : {}), usd: e?.usd ?? 0 };
    return c.json(salida);
  });

  app.post('/comprension/biblioteca', async (c: Ctx) => {
    exigirEscritura(c);
    const b = await cuerpoJson<PedirComprensionBiblioteca>(c);
    const lentes = lentesValidas(b.lentes);
    if (b.documentos !== undefined) exigir(Array.isArray(b.documentos) && b.documentos.every((x) => typeof x === 'string'), '«documentos» es una lista de ids.');
    const r: ComprensionBiblioteca = await comprenderBiblioteca(puertos(c), {
      ...(b.forzar ? { forzar: true } : {}), ...(lentes ? { lentes } : {}), ...(b.economico ? { economico: true } : {}), ...(b.documentos?.length ? { documentos: b.documentos } : {}),
    });
    return c.json(r, 202);
  });

  app.get('/comprension', async (c: Ctx) => {
    const p = puertos(c);
    const ids = (await p.sql.ejecutar<Fila>("SELECT DISTINCT documento FROM procedencia WHERE fase = 'comprension'")).map((f) => String(f.documento));
    const estados: EstadoComprensionVista[] = [];
    for (const id of ids) { const e = estadoVista(await leerEstadoComprension(p.sql, id)); if (e) estados.push(e); }
    return c.json(estados.sort((a, b) => b.actualizado.localeCompare(a.actualizado)));
  });
}
