/**
 * Todo lo que contiene un .spdf, para verlo (ver contrato/contenido.ts), y las
 * figuras e imágenes de toda la biblioteca: buscarlas por su descripción y por
 * su imagen, y encontrar las parecidas.
 */
import type { Hono } from 'hono';
import type { Ancla, ValorSQL } from '@scholaris/nucleo';
import { bytesAVector, enLista } from '@scholaris/nucleo';
import type {
  ContenidoDocumento, FiguraEncontrada, FiguraResultado, FragmentoInspeccion, MapaVectores, Pagina, RegionFigura, UnidadInspeccion,
} from '@scholaris/contrato';
import { leerDocumento, leerEspacios, leerProcedencia } from '@scholaris/spdf';
import type { Entorno } from '../entorno.js';
import { fallo, noEncontrado } from '../compartido/errores.js';
import type { PuertosUsuario } from '../puertos.js';
import { claveDe, cursorADesplazamiento, desplazamientoACursor, entero, etiquetaAncla, json, prm, puertos, type Ctx } from './util.js';

type Fila = Record<string, ValorSQL>;

const num = (v: ValorSQL | undefined) => (v == null ? 0 : Number(v));
const txt = (v: ValorSQL | undefined) => (v == null ? '' : String(v));

/** La región y el instante que la ingesta guarda dentro del ancla de una figura. */
export function extrasFigura(a: Ancla): { region?: RegionFigura; t?: number; escena?: boolean } {
  const x = a as Ancla & { region?: RegionFigura; escena?: boolean };
  const r: { region?: RegionFigura; t?: number; escena?: boolean } = {};
  if (x.region && typeof x.region.x === 'number') r.region = { x: x.region.x, y: x.region.y, w: x.region.w, h: x.region.h };
  if (a.tipo === 'tiempo') r.t = a.t0;
  if (x.escena) r.escena = true;
  return r;
}

const url = (p: PuertosUsuario, documento: string, clave: string | null | undefined) =>
  (clave ? p.almacen.urlLectura(claveDe(p.usuario.id, documento, clave)) : Promise.resolve(undefined));

/** «**Ana:** hola **Luis:** adiós» → turnos con su parte de palabras. */
function turnosDe(texto: string, porDefecto?: string): Array<{ nombre: string; palabras: number }> {
  const partes = texto.split(/(\*\*[^*\n]{1,80}?:\*\*)/);
  const salida: Array<{ nombre: string; palabras: number }> = [];
  let actual = porDefecto ?? '';
  for (const t of partes) {
    const m = /^\*\*([^*\n]+?):\*\*$/.exec(t);
    if (m) { actual = m[1]!.trim(); continue; }
    const n = t.split(/\s+/).filter(Boolean).length;
    if (!n || !actual) continue;
    const ult = salida.at(-1);
    if (ult && ult.nombre === actual) ult.palabras += n; else salida.push({ nombre: actual, palabras: n });
  }
  return salida;
}

/** Las dos componentes principales de una muestra (iteración de potencias con deflación). */
function proyectar(vs: Float32Array[]): { xy: Array<[number, number]>; varianza: [number, number] } {
  const n = vs.length, d = vs[0]?.length ?? 0;
  if (n < 3 || !d) return { xy: vs.map(() => [0, 0]), varianza: [0, 0] };
  const media = new Float64Array(d);
  for (const v of vs) for (let j = 0; j < d; j++) media[j]! += v[j]! / n;
  const X = vs.map((v) => { const c = new Float64Array(d); for (let j = 0; j < d; j++) c[j] = v[j]! - media[j]!; return c; });
  let total = 0;
  for (const c of X) for (let j = 0; j < d; j++) total += c[j]! * c[j]!;
  const comps: Float64Array[] = [];
  const valores: number[] = [];
  for (let k = 0; k < 2; k++) {
    let w = new Float64Array(d).map((_, j) => Math.sin(j * 12.9898 + k * 78.233));
    let lambda = 0;
    for (let it = 0; it < 40; it++) {
      const s = new Float64Array(d);
      for (const c of X) {
        let p = 0;
        for (let j = 0; j < d; j++) p += c[j]! * w[j]!;
        for (let j = 0; j < d; j++) s[j]! += p * c[j]!;
      }
      for (const prev of comps) { let p = 0; for (let j = 0; j < d; j++) p += s[j]! * prev[j]!; for (let j = 0; j < d; j++) s[j]! -= p * prev[j]!; }
      let norma = 0;
      for (let j = 0; j < d; j++) norma += s[j]! * s[j]!;
      norma = Math.sqrt(norma) || 1;
      lambda = norma;
      w = s.map((x) => x / norma);
    }
    comps.push(w);
    valores.push(lambda);
  }
  const xy = X.map((c) => comps.map((w) => { let p = 0; for (let j = 0; j < d; j++) p += c[j]! * w[j]!; return p; }) as [number, number]);
  const mx = Math.max(1e-9, ...xy.map(([a]) => Math.abs(a))), my = Math.max(1e-9, ...xy.map(([, b]) => Math.abs(b)));
  return { xy: xy.map(([a, b]) => [a / mx, b / my]), varianza: [total ? valores[0]! / total : 0, total ? valores[1]! / total : 0] };
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
const VACIAS = new Set(['de', 'la', 'el', 'los', 'las', 'del', 'en', 'un', 'una', 'y', 'o', 'con', 'por', 'para', 'que', 'se', 'al', 'the', 'of', 'a', 'an', 'and', 'in', 'on', 'with', 'to', 'is']);

/** Puntuación por texto: qué parte de las palabras de la consulta aparece (por raíz) en la descripción, el pie o el título. */
function puntuarTexto(consulta: string[], ...textos: Array<string | null | undefined>): number {
  if (!consulta.length) return 0;
  const palabras = new Set(sinTildes(textos.filter(Boolean).join(' ')).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  let aciertos = 0;
  for (const q of consulta) {
    const raiz = q.length > 5 ? q.slice(0, q.length - 2) : q;
    for (const w of palabras) if (w.startsWith(raiz)) { aciertos++; break; }
  }
  return aciertos / consulta.length;
}

interface FilaFigura { id: string; documento: string; unidad: string; imagen: string; pie: string | null; descripcion: string | null; ancla: string; titulo: string | null; tipo: string; orden: number | null }

const SELECT_FIGURAS = `SELECT g.id, g.documento, g.unidad, g.imagen, g.pie, g.descripcion, g.ancla, d.titulo, d.tipo, u.orden
  FROM figuras g JOIN documentos d ON d.id = g.documento LEFT JOIN unidades u ON u.id = g.unidad`;

async function aEncontrada(p: PuertosUsuario, f: FilaFigura, puntuacion: number, vias: FiguraEncontrada['vias']): Promise<FiguraEncontrada> {
  const ancla = json<Ancla>(f.ancla, { tipo: 'imagen' });
  return {
    id: f.id, documento: f.documento, titulo: f.titulo ?? '', tipo: f.tipo as FiguraEncontrada['tipo'], unidad: num(f.orden),
    imagenUrl: (await url(p, f.documento, f.imagen)) ?? '',
    ...(f.pie ? { pie: f.pie } : {}), ...(f.descripcion ? { descripcion: f.descripcion } : {}),
    ancla, etiqueta: etiquetaAncla(ancla), ...extrasFigura(ancla), puntuacion: Math.round(puntuacion * 1000) / 1000, vias,
  };
}

async function figurasPorId(p: PuertosUsuario, ids: string[]): Promise<Map<string, FilaFigura>> {
  if (!ids.length) return new Map();
  const l = enLista(ids);
  const filas = await p.sql.ejecutar<FilaFigura>(`${SELECT_FIGURAS} WHERE g.id IN ${l.sql}`, l.param);
  return new Map(filas.map((f) => [f.id, f]));
}

/** Vecinos de un vector entre las figuras del índice (ids sin prefijo). */
async function vecinasEnIndice(p: PuertosUsuario, v: Float32Array, k: number): Promise<Array<{ id: string; puntuacion: number }>> {
  if (!p.indice) return [];
  const r = await p.indice.consultar(p.config.espacioNombres(p.usuario.id), v, { k, filtro: { objetivo: 'figura' }, conMetadatos: true });
  return r.map((c) => ({ id: c.id.replace(/^[a-z]:/, ''), puntuacion: c.puntuacion }));
}

/**
 * La figura que respalda un resultado de búsqueda: la propia (lámina sin texto,
 * cuyo «fragmento» es la figura) o, si salió por la vía visual, la de su
 * página o el fotograma de su intervalo.
 */
export async function figuraDeResultado(p: PuertosUsuario, documento: string, fragmento: { id: string; unidad: string; ancla: Ancla }, vias: string[]): Promise<FiguraResultado | undefined> {
  const propia = fragmento.id.startsWith('fg');
  if (!propia && !vias.includes('visual')) return undefined;
  const filas = await p.sql.ejecutar<{ id: string; imagen: string; pie: string | null; descripcion: string | null; ancla: string }>(
    propia ? 'SELECT id, imagen, pie, descripcion, ancla FROM figuras WHERE id = ?' : 'SELECT id, imagen, pie, descripcion, ancla FROM figuras WHERE unidad = ? ORDER BY rowid LIMIT 40',
    propia ? fragmento.id : fragmento.unidad,
  );
  let elegida = filas[0];
  if (!propia && fragmento.ancla.tipo === 'tiempo') {
    const { t0, t1 } = fragmento.ancla;
    const dentro = filas.map((f) => ({ f, t: json<Ancla>(f.ancla, { tipo: 'imagen' }) })).filter((x) => x.t.tipo === 'tiempo' && x.t.t0 >= t0 - 1 && x.t.t0 <= t1 + 1);
    elegida = dentro[0]?.f ?? elegida;
  }
  if (!elegida) return undefined;
  const ancla = json<Ancla>(elegida.ancla, { tipo: 'imagen' });
  const { region, t } = extrasFigura(ancla);
  return {
    id: elegida.id, imagenUrl: (await url(p, documento, elegida.imagen)) ?? '',
    ...(elegida.pie ? { pie: elegida.pie } : {}), ...(elegida.descripcion ? { descripcion: elegida.descripcion } : {}),
    ...(region ? { region } : {}), ...(t !== undefined ? { t } : {}),
  };
}

export function rutasContenido(app: Hono<Entorno>): void {
  app.get('/documentos/:id/contenido', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    const d = (await leerDocumento(p.sql, id)) ?? noEncontrado('El documento');
    const [claves, lectores, [cu], folios, [cf], [cs], [cg], vectores, espacios, procedencia] = await Promise.all([
      p.sql.ejecutar<{ clave: string; valor: string }>('SELECT clave, valor FROM spdf'),
      p.sql.ejecutar<Fila>('SELECT lector, COUNT(*) AS n, AVG(confianza) AS m, MIN(confianza) AS mi FROM unidades WHERE documento = ? GROUP BY lector ORDER BY n DESC', id),
      p.sql.ejecutar<Fila>(`SELECT COUNT(*) AS n,
          SUM(imagen IS NOT NULL AND imagen <> '') AS img,
          SUM(notas IS NOT NULL AND notas NOT IN ('', '[]')) AS notas,
          SUM(cabecera IS NOT NULL AND cabecera <> '') AS cab,
          SUM(pie IS NOT NULL AND pie <> '') AS pie,
          SUM(length(texto)) AS car
        FROM unidades WHERE documento = ?`, id),
      p.sql.ejecutar<Fila>(`SELECT json_extract(ancla, '$.origen') AS o, COUNT(*) AS n,
          SUM(json_extract(ancla, '$.romana')) AS r, SUM(json_extract(ancla, '$.confianza') < 0.75) AS dud
        FROM unidades WHERE documento = ? AND json_extract(ancla, '$.tipo') = 'pagina' GROUP BY o`, id),
      p.sql.ejecutar<Fila>(`SELECT COUNT(*) AS n, SUM(texto_busqueda IS NOT NULL AND texto_busqueda <> '') AS b FROM fragmentos WHERE documento = ?`, id),
      p.sql.ejecutar<Fila>('SELECT COUNT(*) AS n FROM secciones WHERE documento = ?', id),
      p.sql.ejecutar<Fila>(`SELECT COUNT(*) AS n, SUM(json_extract(ancla, '$.tipo') = 'tiempo') AS t,
          SUM(descripcion IS NOT NULL AND descripcion <> '') AS dsc, SUM(pie IS NOT NULL AND pie <> '') AS pie
        FROM figuras WHERE documento = ?`, id),
      p.sql.ejecutar<Fila>('SELECT espacio, objetivo, COUNT(*) AS n FROM vectores WHERE documento = ? GROUP BY espacio, objetivo', id),
      leerEspacios(p.sql),
      leerProcedencia(p.sql, id),
    ]);

    // Hablantes: los turnos «**Nombre:**» de cada tramo; el tiempo se reparte por palabras.
    const hablantes = new Map<string, { turnos: number; segundos: number }>();
    if (d.tipo === 'audio' || d.tipo === 'video') {
      const tramos = await p.sql.ejecutar<{ texto: string; t0: number | null; t1: number | null; ancla: string }>('SELECT texto, t0, t1, ancla FROM unidades WHERE documento = ? ORDER BY orden', id);
      let ultimo = '';
      for (const u of tramos) {
        const a = json<Ancla>(u.ancla, { tipo: 'imagen' });
        const turnos = turnosDe(u.texto, a.tipo === 'tiempo' ? a.hablante : undefined);
        const total = turnos.reduce((s, x) => s + x.palabras, 0) || 1;
        const dur = Math.max(0, num(u.t1) - num(u.t0));
        for (const t of turnos) {
          const h = hablantes.get(t.nombre) ?? { turnos: 0, segundos: 0 };
          if (t.nombre !== ultimo) h.turnos++;
          h.segundos += (dur * t.palabras) / total;
          hablantes.set(t.nombre, h);
          ultimo = t.nombre;
        }
      }
    }

    const porEspacio = new Map<string, Record<string, number>>();
    for (const v of vectores) {
      const m = porEspacio.get(txt(v.espacio)) ?? {};
      m[txt(v.objetivo)] = num(v.n);
      porEspacio.set(txt(v.espacio), m);
    }
    const origen = Object.fromEntries(folios.map((f) => [txt(f.o) || 'ninguno', num(f.n)]));
    const medio = d.tipo === 'audio' || d.tipo === 'video';
    const indexado = procedencia.find((x) => x.fase === 'indexado');
    const llamadas = procedencia.reduce((s, x) => {
      const l = (x.detalle as { llamadas?: unknown[] } | null)?.llamadas;
      return s + (Array.isArray(l) ? l.length : x.proveedor && x.fase !== 'indexado' ? 1 : 0);
    }, 0);

    const r: ContenidoDocumento = {
      documento: id,
      archivo: {
        spdfVersion: claves.find((x) => x.clave === 'spdf_version')?.valor ?? '4.1',
        claves: Object.fromEntries(claves.map((x) => [x.clave, x.valor])),
        huella: d.huella, bytes: d.bytes, mime: d.mime, original: d.original, creado: d.creado, actualizado: d.actualizado,
      },
      cuentas: {
        unidades: num(cu?.n), conImagen: num(cu?.img), conNotas: num(cu?.notas), conCabecera: num(cu?.cab), conPiePagina: num(cu?.pie),
        fragmentos: num(cf?.n), conBusqueda: num(cf?.b), secciones: num(cs?.n),
        figuras: num(cg?.n), fotogramas: num(cg?.t), descritas: num(cg?.dsc), figurasConPie: num(cg?.pie),
        vectores: vectores.reduce((s, v) => s + num(v.n), 0), caracteres: num(cu?.car),
      },
      lectores: lectores.map((l) => ({ lector: txt(l.lector), unidades: num(l.n), confianzaMedia: Math.round(num(l.m) * 1000) / 1000, confianzaMin: Math.round(num(l.mi) * 1000) / 1000 })),
      folios: folios.length ? {
        leido: origen.leido ?? 0, deducido: origen.deducido ?? 0, epub: origen.epub ?? 0, ninguno: origen.ninguno ?? 0,
        romanas: folios.reduce((s, f) => s + num(f.r), 0), dudosos: folios.reduce((s, f) => s + num(f.dud), 0),
      } : null,
      espacios: espacios.filter((e) => porEspacio.has(e.id)).map((e) => {
        const m = porEspacio.get(e.id)!;
        return { ...e, vectores: Object.values(m).reduce((s, n) => s + n, 0), porObjetivo: m };
      }),
      hablantes: [...hablantes].map(([nombre, h]) => ({ nombre, turnos: h.turnos, segundos: Math.round(h.segundos) })).sort((a, b) => b.segundos - a.segundos),
      procedencia: procedencia.map((x) => ({
        fase: x.fase, ...(x.proveedor ? { proveedor: x.proveedor } : {}), ...(x.detalle != null ? { detalle: x.detalle } : {}), ...(x.ms != null ? { ms: x.ms } : {}), cuando: x.cuando ?? "",
      })),
      coste: {
        unidades: medio ? Math.ceil((d.duracion ?? 0) / 60) : d.unidades,
        medida: medio ? 'minutos' : 'paginas',
        llamadas,
        msTotal: indexado?.ms || procedencia.reduce((s, x) => s + (x.ms ?? 0), 0),
      },
    };
    return c.json(r);
  });

  app.get('/documentos/:id/contenido/unidades', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    const desde = entero(c.req.query('desde'), 0, 0);
    const hasta = Math.min(entero(c.req.query('hasta'), desde + 19, desde), desde + 49);
    const filas = await p.sql.ejecutar<Fila>('SELECT * FROM unidades WHERE documento = ? AND orden BETWEEN ? AND ? ORDER BY orden', id, desde, hasta);
    const ids = filas.map((f) => txt(f.id));
    const cuentaPor = async (tabla: 'fragmentos' | 'figuras') => {
      if (!ids.length) return new Map<string, number>();
      const l = enLista(ids);
      const r = await p.sql.ejecutar<{ unidad: string; n: number }>(`SELECT unidad, COUNT(*) AS n FROM ${tabla} WHERE unidad IN ${l.sql} GROUP BY unidad`, l.param);
      return new Map(r.map((x) => [x.unidad, num(x.n)]));
    };
    const [fr, fg] = await Promise.all([cuentaPor('fragmentos'), cuentaPor('figuras')]);
    const salida = await Promise.all(filas.map(async (f): Promise<UnidadInspeccion> => {
      const ancla = json<Ancla>(f.ancla, { tipo: 'imagen' });
      const notas = json<string[]>(f.notas, []);
      const palabras = json<{ cs?: number[] } | null>(f.palabras, null);
      const [imagenUrl, miniaturaUrl] = await Promise.all([url(p, id, txt(f.imagen) || null), url(p, id, txt(f.miniatura) || null)]);
      return {
        id: txt(f.id), orden: num(f.orden), ancla, etiqueta: etiquetaAncla(ancla), texto: txt(f.texto),
        ...(notas.length ? { notas } : {}), ...(f.cabecera ? { cabecera: txt(f.cabecera) } : {}), ...(f.pie ? { pie: txt(f.pie) } : {}),
        ...(imagenUrl ? { imagenUrl } : {}), ...(miniaturaUrl ? { miniaturaUrl } : {}),
        lector: txt(f.lector), confianza: num(f.confianza),
        ...(f.impresa ? { impresa: txt(f.impresa) } : {}), ...(f.t0 != null ? { t0: num(f.t0) } : {}), ...(f.t1 != null ? { t1: num(f.t1) } : {}),
        ...(palabras?.cs ? { palabras: Math.floor(palabras.cs.length / 2) } : {}),
        fragmentos: fr.get(txt(f.id)) ?? 0, figuras: fg.get(txt(f.id)) ?? 0,
      };
    }));
    return c.json(salida);
  });

  app.get('/documentos/:id/contenido/fragmentos', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    const limite = entero(c.req.query('limite'), 100, 1, 200);
    const desp = cursorADesplazamiento(c.req.query('cursor'));
    const unidad = c.req.query('unidad');
    const filtro = unidad !== undefined && unidad !== '' ? ' AND u.orden = ?' : '';
    const params: ValorSQL[] = [id, ...(filtro ? [entero(unidad, 0, 0)] : [])];
    const [filas, [t]] = await Promise.all([
      p.sql.ejecutar<Fila>(`SELECT f.id, f.orden, f.texto, f.contexto, f.seccion, f.ancla, f.ancla_fin, f.texto_busqueda, u.orden AS uorden
        FROM fragmentos f LEFT JOIN unidades u ON u.id = f.unidad WHERE f.documento = ?${filtro} ORDER BY f.orden LIMIT ? OFFSET ?`, ...params, limite, desp),
      p.sql.ejecutar<Fila>(`SELECT COUNT(*) AS n FROM fragmentos f LEFT JOIN unidades u ON u.id = f.unidad WHERE f.documento = ?${filtro}`, ...params),
    ]);
    const ids = filas.map((f) => txt(f.id));
    const vec = new Map<string, string[]>();
    if (ids.length) {
      const l = enLista(ids);
      for (const v of await p.sql.ejecutar<{ id: string; espacio: string }>(`SELECT id, espacio FROM vectores WHERE objetivo = 'fragmento' AND id IN ${l.sql}`, l.param)) {
        vec.set(v.id, [...(vec.get(v.id) ?? []), v.espacio]);
      }
    }
    const elementos = filas.map((f): FragmentoInspeccion => {
      const ancla = json<Ancla>(f.ancla, { tipo: 'imagen' });
      const fin = f.ancla_fin ? json<Ancla>(f.ancla_fin, { tipo: 'imagen' }) : undefined;
      return {
        id: txt(f.id), unidad: num(f.uorden), orden: num(f.orden), texto: txt(f.texto), contexto: txt(f.contexto),
        seccion: json<string[]>(f.seccion, []), ancla, ...(fin ? { anclaFin: fin } : {}), etiqueta: etiquetaAncla(ancla, fin),
        textoBusqueda: f.texto_busqueda == null ? null : txt(f.texto_busqueda), vectores: vec.get(txt(f.id)) ?? [],
      };
    });
    const total = num(t?.n);
    const r: Pagina<FragmentoInspeccion> = { elementos, total, ...(desp + limite < total ? { siguiente: desplazamientoACursor(desp + limite) } : {}) };
    return c.json(r);
  });

  app.get('/documentos/:id/contenido/mapa', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    const max = entero(c.req.query('max'), 400, 20, 800);
    const cuentas = await p.sql.ejecutar<{ espacio: string; n: number }>('SELECT espacio, COUNT(*) AS n FROM vectores WHERE documento = ? GROUP BY espacio ORDER BY n DESC', id);
    const espacio = c.req.query('espacio') || cuentas[0]?.espacio;
    if (!espacio) noEncontrado('Un espacio vectorial con vectores de este documento');
    const total = num(cuentas.find((x) => x.espacio === espacio)?.n);
    const paso = Math.max(1, Math.ceil(total / max));
    const filas = await p.sql.ejecutar<{ objetivo: string; id: string; valores: Uint8Array }>(
      `SELECT objetivo, id, valores FROM (SELECT objetivo, id, valores, ROW_NUMBER() OVER (ORDER BY objetivo, id) AS rn FROM vectores WHERE documento = ? AND espacio = ?) WHERE (rn - 1) % ? = 0 LIMIT ?`,
      id, espacio!, paso, max,
    );
    const vs = filas.map((f) => bytesAVector(f.valores));
    const { xy, varianza } = proyectar(vs);
    // Etiquetas: el ancla y el principio del texto (o la descripción de la figura).
    const porTipo = (o: string) => filas.filter((f) => f.objetivo === o).map((f) => f.id);
    const etiquetas = new Map<string, { etiqueta: string; texto: string; unidad?: number }>();
    const cargar = async (sql: string, ids: string[]) => {
      if (!ids.length) return;
      const l = enLista(ids);
      for (const f of await p.sql.ejecutar<{ id: string; ancla: string; texto: string | null; uorden: number | null }>(sql.replace('$L', l.sql), l.param)) {
        etiquetas.set(f.id, { etiqueta: etiquetaAncla(json<Ancla>(f.ancla, { tipo: 'imagen' })), texto: txt(f.texto).replace(/\s+/g, ' ').slice(0, 140), ...(f.uorden != null ? { unidad: num(f.uorden) } : {}) });
      }
    };
    await Promise.all([
      cargar('SELECT f.id, f.ancla, f.texto, u.orden AS uorden FROM fragmentos f LEFT JOIN unidades u ON u.id = f.unidad WHERE f.id IN $L', porTipo('fragmento')),
      cargar('SELECT id, ancla, substr(texto, 1, 200) AS texto, orden AS uorden FROM unidades WHERE id IN $L', porTipo('unidad')),
      cargar("SELECT g.id, g.ancla, COALESCE(g.descripcion, g.pie, '') AS texto, u.orden AS uorden FROM figuras g LEFT JOIN unidades u ON u.id = g.unidad WHERE g.id IN $L", porTipo('figura')),
    ]);
    const r: MapaVectores = {
      espacio: espacio!, dims: vs[0]?.length ?? 0, total, varianza: [Math.round(varianza[0] * 1000) / 1000, Math.round(varianza[1] * 1000) / 1000],
      puntos: filas.map((f, i) => ({
        objetivo: f.objetivo as MapaVectores['puntos'][number]['objetivo'], id: f.id,
        x: Math.round(xy[i]![0] * 1e4) / 1e4, y: Math.round(xy[i]![1] * 1e4) / 1e4,
        etiqueta: etiquetas.get(f.id)?.etiqueta ?? '', texto: etiquetas.get(f.id)?.texto ?? '',
        ...(etiquetas.get(f.id)?.unidad != null ? { unidad: etiquetas.get(f.id)!.unidad! } : {}),
      })),
    };
    return c.json(r);
  });

  app.get('/figuras', async (c: Ctx) => {
    const p = puertos(c);
    const q = (c.req.query('q') ?? '').trim();
    const limite = entero(c.req.query('limite'), 60, 1, 200);
    const documento = c.req.query('documento');
    const tipo = c.req.query('tipo');
    const cond: string[] = [];
    const params: ValorSQL[] = [];
    if (documento) { cond.push('g.documento = ?'); params.push(documento); }
    if (tipo === 'fotogramas') cond.push("json_extract(g.ancla, '$.tipo') = 'tiempo'");
    else if (tipo === 'figuras') cond.push("json_extract(g.ancla, '$.tipo') <> 'tiempo'");
    const donde = cond.length ? ` WHERE ${cond.join(' AND ')}` : '';
    if (!q) {
      const filas = await p.sql.ejecutar<FilaFigura>(`${SELECT_FIGURAS}${donde} ORDER BY d.creado DESC, g.rowid LIMIT ?`, ...params, limite);
      return c.json(await Promise.all(filas.map((f) => aEncontrada(p, f, 0, []))));
    }
    const consulta = sinTildes(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !VACIAS.has(w));
    // Por texto: descripción, pie y título.
    const todas = await p.sql.ejecutar<FilaFigura>(`${SELECT_FIGURAS}${donde}`, ...params);
    const puntos = new Map<string, { s: number; vias: Set<'texto' | 'imagen'> }>();
    for (const f of todas) {
      const s = puntuarTexto(consulta, f.descripcion, f.pie) * 0.9 + puntuarTexto(consulta, f.titulo) * 0.1;
      if (s >= 0.34) puntos.set(f.id, { s, vias: new Set(['texto']) });
    }
    // Por la imagen: la consulta en el mismo espacio que las figuras (si el modelo es multimodal).
    try {
      const ia = await p.inteligencia();
      if (p.indice && ia.embebedor.admite('imagen') && q.length >= 3) {
        const [v] = await ia.embebedor.vectorizar([{ modalidad: 'texto', texto: q }], 'consulta');
        if (v) {
          const permitidas = new Set(todas.map((f) => f.id));
          const vecinas = (await vecinasEnIndice(p, v, 40)).filter((x) => permitidas.has(x.id));
          const mejor = vecinas[0]?.puntuacion ?? 0;
          for (const x of vecinas) {
            // Relativa a la mejor: el índice no da puntuaciones absolutas comparables con el texto.
            const s = mejor > 0 ? (x.puntuacion / mejor) * 0.75 : 0;
            if (s < 0.6) continue;
            const e = puntos.get(x.id) ?? { s: 0, vias: new Set<'texto' | 'imagen'>() };
            e.s = Math.max(e.s, s) + (e.vias.has('texto') ? 0.15 : 0);
            e.vias.add('imagen');
            puntos.set(x.id, e);
          }
        }
      }
    } catch (e) { console.error('figuras: vía de imagen', e); }
    const porId = new Map(todas.map((f) => [f.id, f]));
    const orden = [...puntos].sort((a, b) => b[1].s - a[1].s).slice(0, limite);
    return c.json(await Promise.all(orden.map(([fid, x]) => aEncontrada(p, porId.get(fid)!, Math.min(1, x.s), [...x.vias]))));
  });

  app.get('/figuras/:id/parecidas', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    const k = entero(c.req.query('k'), 12, 1, 48);
    const [base] = (await figurasPorId(p, [id])).values();
    if (!base) noEncontrado('La figura');
    const ia = await p.inteligencia();
    const [fila] = await p.sql.ejecutar<{ valores: Uint8Array }>("SELECT valores FROM vectores WHERE objetivo = 'figura' AND id = ? AND espacio = ?", id, ia.embebedor.espacio.id);
    if (fila && p.indice) {
      const vecinas = (await vecinasEnIndice(p, bytesAVector(fila.valores), k + 1)).filter((x) => x.id !== id);
      const filas = await figurasPorId(p, vecinas.map((x) => x.id));
      const salida = await Promise.all(vecinas.filter((x) => filas.has(x.id)).slice(0, k).map((x) => aEncontrada(p, filas.get(x.id)!, x.puntuacion, ['imagen'])));
      if (salida.length) return c.json(salida);
    }
    // Sin vector (o sin índice): las que se describen con palabras parecidas.
    const consulta = sinTildes(`${base!.descripcion ?? ''} ${base!.pie ?? ''}`).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3 && !VACIAS.has(w)).slice(0, 24);
    if (!consulta.length) fallo('no_disponible', 'Esta figura no tiene vector ni descripción con la que buscar parecidas.');
    const todas = await p.sql.ejecutar<FilaFigura>(`${SELECT_FIGURAS} WHERE g.id <> ?`, id);
    const orden = todas.map((f) => ({ f, s: puntuarTexto(consulta, f.descripcion, f.pie) })).filter((x) => x.s > 0.15).sort((a, b) => b.s - a.s).slice(0, k);
    return c.json(await Promise.all(orden.map((x) => aEncontrada(p, x.f, x.s, ['texto']))));
  });
}
