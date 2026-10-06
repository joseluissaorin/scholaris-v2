/**
 * Cuadernos: notas en Markdown con tarjetas que citan la biblioteca. Cada
 * tarjeta guarda una copia verificada del pasaje (texto literal + ancla) y su
 * huella; «reverificar» comprueba que la biblioteca sigue diciendo lo mismo
 * (citas vivas). La síntesis la redacta el `Redactor`, que solo puede citar
 * las tarjetas del cuaderno: cualquier otra marca se elimina.
 */

import { anclaACita, nuevoId, sha256, tiempoACadena, type Ancla, type SQL } from '@scholaris/nucleo';
import type { Cuaderno, NuevaTarjeta, NuevoCuaderno, Sintesis, Tarjeta, TipoTarjeta } from '@scholaris/contrato';
import { citaCorta, leerDocumentos } from './estanteria.js';
import type { PuertosFunciones } from './puertos.js';
import { aJSON, ahora, deJSON, ErrorFunciones, noEncontrado, num, numONulo, recortar, texto, una } from './util.js';

const TIPOS: readonly TipoTarjeta[] = ['fragmento', 'unidad', 'figura', 'tramo', 'nota', 'sintesis'];

// ---------------------------------------------------------------------------
// Cuadernos
// ---------------------------------------------------------------------------

function filaACuaderno(f: Record<string, unknown>): Cuaderno {
  return {
    id: String(f.id),
    titulo: String(f.titulo),
    cuerpo: String(f.cuerpo ?? ''),
    tarjetas: num(f.tarjetas),
    creado: String(f.creado),
    actualizado: String(f.actualizado),
  };
}

const SELECT_CUADERNO = `SELECT c.*, (SELECT count(*) FROM cuadernos_tarjetas t WHERE t.cuaderno = c.id) AS tarjetas FROM cuadernos c`;

function validarTitulo(t: unknown): string {
  const s = typeof t === 'string' ? t.trim() : '';
  if (!s) throw new ErrorFunciones('peticion_invalida', 'El cuaderno necesita un título.');
  if (s.length > 300) throw new ErrorFunciones('peticion_invalida', 'El título no puede pasar de 300 caracteres.');
  return s;
}

export async function crearCuaderno(sql: SQL, n: NuevoCuaderno): Promise<Cuaderno> {
  const id = nuevoId('c');
  const t = ahora();
  await sql.ejecutar(
    'INSERT INTO cuadernos (id, titulo, cuerpo, creado, actualizado) VALUES (?, ?, ?, ?, ?)',
    id, validarTitulo(n.titulo), n.cuerpo ?? '', t, t,
  );
  return obtenerCuaderno(sql, id);
}

export async function listarCuadernos(sql: SQL): Promise<Cuaderno[]> {
  return (await sql.ejecutar(`${SELECT_CUADERNO} ORDER BY c.actualizado DESC LIMIT 500`)).map(filaACuaderno);
}

export async function obtenerCuaderno(sql: SQL, id: string): Promise<Cuaderno> {
  const f = await una(sql, `${SELECT_CUADERNO} WHERE c.id = ?`, id);
  if (!f) throw noEncontrado('ese cuaderno');
  return filaACuaderno(f);
}

export async function actualizarCuaderno(sql: SQL, id: string, cambios: Partial<NuevoCuaderno>): Promise<Cuaderno> {
  await obtenerCuaderno(sql, id);
  if (cambios.titulo === undefined && cambios.cuerpo === undefined) {
    throw new ErrorFunciones('peticion_invalida', 'No hay nada que cambiar.');
  }
  if (cambios.titulo !== undefined) await sql.ejecutar('UPDATE cuadernos SET titulo = ? WHERE id = ?', validarTitulo(cambios.titulo), id);
  if (cambios.cuerpo !== undefined) await sql.ejecutar('UPDATE cuadernos SET cuerpo = ? WHERE id = ?', String(cambios.cuerpo), id);
  await tocar(sql, id);
  return obtenerCuaderno(sql, id);
}

export async function borrarCuaderno(sql: SQL, id: string): Promise<void> {
  await obtenerCuaderno(sql, id);
  await sql.transaccion(async (tx) => {
    await tx.ejecutar('DELETE FROM cuadernos_tarjetas WHERE cuaderno = ?', id);
    await tx.ejecutar('UPDATE cuadernos_sintesis SET cuaderno = NULL WHERE cuaderno = ?', id);
    await tx.ejecutar('DELETE FROM cuadernos WHERE id = ?', id);
  });
}

async function tocar(sql: SQL, id: string) {
  await sql.ejecutar('UPDATE cuadernos SET actualizado = ? WHERE id = ?', ahora(), id);
}

// ---------------------------------------------------------------------------
// Resolución de citas contra la estantería
// ---------------------------------------------------------------------------

interface CitaResuelta {
  documento: string;
  pasaje: string;
  ancla: Ancla | null;
  anclaFin: Ancla | null;
  citaCorta: string;
}

function etiquetaDe(ancla: Ancla | null, anclaFin: Ancla | null): string {
  if (!ancla) return '';
  if (ancla.tipo === 'tiempo') return `${tiempoACadena(ancla.t0)}-${tiempoACadena(ancla.t1)}`;
  return anclaACita(ancla, anclaFin ?? undefined);
}

/** Resuelve lo que cita una tarjeta. `null` si ya no existe en la biblioteca. */
async function resolverCita(
  sql: SQL,
  t: { tipo: TipoTarjeta; documento?: string | null; objetivo?: string | null; t0?: number | null; t1?: number | null },
): Promise<CitaResuelta | null> {
  let documento: string | null = t.documento ?? null;
  let pasaje = '';
  let ancla: Ancla | null = null;
  let anclaFin: Ancla | null = null;
  if (t.tipo === 'fragmento' || t.tipo === 'unidad' || t.tipo === 'figura') {
    if (!t.objetivo) throw new ErrorFunciones('peticion_invalida', 'Falta el fragmento, la unidad o la figura que se cita.');
    const consulta = {
      fragmento: 'SELECT documento, texto, ancla, ancla_fin FROM fragmentos WHERE id = ?',
      unidad: 'SELECT documento, texto, ancla, NULL AS ancla_fin FROM unidades WHERE id = ?',
      figura: "SELECT documento, trim(coalesce(pie, '') || ' ' || coalesce(descripcion, '')) AS texto, ancla, NULL AS ancla_fin FROM figuras WHERE id = ?",
    }[t.tipo];
    const f = await una(sql, consulta, t.objetivo);
    if (!f) return null;
    documento = String(f.documento);
    pasaje = String(f.texto ?? '');
    ancla = deJSON<Ancla | null>(f.ancla, null);
    anclaFin = deJSON<Ancla | null>(f.ancla_fin, null);
  } else if (t.tipo === 'tramo') {
    if (!documento || t.t0 === undefined || t.t0 === null || t.t1 === undefined || t.t1 === null || t.t1 < t.t0) {
      throw new ErrorFunciones('peticion_invalida', 'Un tramo necesita documento, inicio y fin (en segundos).');
    }
    if (!(await una(sql, 'SELECT 1 AS x FROM documentos WHERE id = ?', documento))) return null;
    const filas = await sql.ejecutar(
      `SELECT texto FROM fragmentos WHERE documento = ?
         AND json_extract(ancla, '$.tipo') = 'tiempo'
         AND json_extract(ancla, '$.t1') > ? AND json_extract(ancla, '$.t0') < ?
       ORDER BY orden`,
      documento, t.t0, t.t1,
    );
    pasaje = filas.map((f) => String(f.texto)).join(' ');
    ancla = { tipo: 'tiempo', t0: t.t0, t1: t.t1 };
  } else {
    return null;
  }
  const d = (await leerDocumentos(sql, [documento!])).get(documento!);
  if (!d) return null;
  return { documento: documento!, pasaje, ancla, anclaFin, citaCorta: citaCorta(d, ancla, anclaFin) };
}

// ---------------------------------------------------------------------------
// Tarjetas
// ---------------------------------------------------------------------------

export interface TarjetaCompleta extends Tarjeta {
  estado: 'verificada' | 'cambiada' | 'huerfana' | 'libre';
  /** Probabilidad 0-1 de que el pasaje respalde `contenido.afirmacion` (juez). */
  respaldo?: number;
  verificada?: string;
}

function filaATarjeta(f: Record<string, unknown>): TarjetaCompleta {
  const ancla = deJSON<Ancla | null>(f.ancla, null);
  const t: TarjetaCompleta = {
    id: String(f.id),
    tipo: String(f.tipo) as TipoTarjeta,
    contenido: deJSON<Record<string, unknown>>(f.contenido, {}),
    posicion: num(f.posicion),
    huerfana: f.estado === 'huerfana',
    estado: String(f.estado) as TarjetaCompleta['estado'],
    creada: String(f.creada),
  };
  if (f.documento) t.documento = String(f.documento);
  if (f.objetivo) t.objetivo = String(f.objetivo);
  if (ancla?.tipo === 'tiempo') { t.t0 = ancla.t0; t.t1 = ancla.t1; }
  if (f.pasaje !== null && f.pasaje !== undefined && f.cita) {
    t.cita = { texto: String(f.pasaje), etiqueta: etiquetaDe(ancla, deJSON<Ancla | null>(f.ancla_fin, null)), citaCorta: String(f.cita) };
  }
  const r = numONulo(f.respaldo);
  if (r !== null) t.respaldo = r;
  if (f.verificada) t.verificada = String(f.verificada);
  return t;
}

export async function listarTarjetas(sql: SQL, cuaderno: string): Promise<TarjetaCompleta[]> {
  await obtenerCuaderno(sql, cuaderno);
  return (await sql.ejecutar('SELECT * FROM cuadernos_tarjetas WHERE cuaderno = ? ORDER BY posicion, creada', cuaderno)).map(filaATarjeta);
}

async function obtenerTarjeta(sql: SQL, cuaderno: string, id: string): Promise<TarjetaCompleta> {
  const f = await una(sql, 'SELECT * FROM cuadernos_tarjetas WHERE id = ? AND cuaderno = ?', id, cuaderno);
  if (!f) throw noEncontrado('esa tarjeta en el cuaderno');
  return filaATarjeta(f);
}

/** ¿Respalda el pasaje la afirmación de la tarjeta? (juez, si lo hay). */
async function juzgarRespaldo(p: PuertosFunciones, pasaje: string, afirmacion: string): Promise<number | null> {
  const juez = p.inteligencia?.juez;
  if (!juez || !afirmacion.trim() || !pasaje.trim()) return null;
  try {
    const r = await juez.juzgar(
      { afirmacion, pasaje },
      {
        respalda: {
          tipo: 'si_no',
          instrucciones: '¿El pasaje citado respalda la afirmación tal como está escrita?',
          criterios: { si: 'El pasaje dice lo que afirma la afirmación, o lo implica claramente.', no: 'El pasaje no lo dice, lo contradice o habla de otra cosa.' },
        },
      },
    );
    const x = r.respalda;
    return x && x.tipo === 'si_no' ? x.probabilidad : null;
  } catch {
    return null;
  }
}

export async function crearTarjeta(p: PuertosFunciones, cuaderno: string, n: NuevaTarjeta): Promise<TarjetaCompleta> {
  const { sql } = p;
  await obtenerCuaderno(sql, cuaderno);
  if (!TIPOS.includes(n.tipo)) throw new ErrorFunciones('peticion_invalida', `Tipo de tarjeta desconocido: «${String(n.tipo)}».`);
  const contenido = n.contenido ?? {};
  const cita = await resolverCita(sql, { tipo: n.tipo, documento: n.documento ?? null, objetivo: n.objetivo ?? null, t0: n.t0 ?? null, t1: n.t1 ?? null });
  if (!cita && n.tipo !== 'nota' && n.tipo !== 'sintesis') throw noEncontrado('lo que cita la tarjeta en la biblioteca');
  const max = await una<{ m: number | null }>(sql, 'SELECT max(posicion) AS m FROM cuadernos_tarjetas WHERE cuaderno = ?', cuaderno);
  const ultima = max?.m === null || max?.m === undefined ? -1 : num(max.m);
  const posicion = n.posicion === undefined ? ultima + 1 : Math.max(0, Math.trunc(n.posicion));
  if (n.posicion !== undefined) {
    await sql.ejecutar('UPDATE cuadernos_tarjetas SET posicion = posicion + 1 WHERE cuaderno = ? AND posicion >= ?', cuaderno, posicion);
  }
  const afirmacion = typeof contenido.afirmacion === 'string' ? contenido.afirmacion : null;
  const respaldo = cita && afirmacion ? await juzgarRespaldo(p, cita.pasaje, afirmacion) : null;
  const id = nuevoId('t');
  const t = ahora();
  await sql.ejecutar(
    `INSERT INTO cuadernos_tarjetas (id, cuaderno, tipo, documento, objetivo, ancla, ancla_fin, pasaje, cita, huella, contenido,
       afirmacion, respaldo, posicion, estado, verificada, creada, actualizada)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, cuaderno, n.tipo, cita?.documento ?? n.documento ?? null, n.objetivo ?? null,
    aJSON(cita?.ancla), aJSON(cita?.anclaFin), cita?.pasaje ?? null, cita?.citaCorta ?? null,
    cita ? await sha256(cita.pasaje) : null, JSON.stringify(contenido), afirmacion, respaldo,
    posicion, cita ? 'verificada' : 'libre', cita ? t : null, t, t,
  );
  await tocar(sql, cuaderno);
  return obtenerTarjeta(sql, cuaderno, id);
}

export async function actualizarTarjeta(
  p: PuertosFunciones,
  cuaderno: string,
  id: string,
  cambios: { contenido?: Record<string, unknown>; posicion?: number },
): Promise<TarjetaCompleta> {
  const { sql } = p;
  const actual = await obtenerTarjeta(sql, cuaderno, id);
  if (cambios.contenido === undefined && cambios.posicion === undefined) throw new ErrorFunciones('peticion_invalida', 'No hay nada que cambiar.');
  if (cambios.contenido !== undefined) {
    const afirmacion = typeof cambios.contenido.afirmacion === 'string' ? cambios.contenido.afirmacion : null;
    const respaldo = actual.cita && afirmacion ? await juzgarRespaldo(p, actual.cita.texto, afirmacion) : null;
    await sql.ejecutar(
      'UPDATE cuadernos_tarjetas SET contenido = ?, afirmacion = ?, respaldo = ?, actualizada = ? WHERE id = ?',
      JSON.stringify(cambios.contenido), afirmacion, respaldo, ahora(), id,
    );
  }
  if (cambios.posicion !== undefined) {
    const orden = (await listarTarjetas(sql, cuaderno)).map((t) => t.id).filter((x) => x !== id);
    orden.splice(Math.max(0, Math.min(orden.length, Math.trunc(cambios.posicion))), 0, id);
    await ordenarTarjetas(sql, cuaderno, orden);
  }
  await tocar(sql, cuaderno);
  return obtenerTarjeta(sql, cuaderno, id);
}

export async function borrarTarjeta(sql: SQL, cuaderno: string, id: string): Promise<void> {
  await obtenerTarjeta(sql, cuaderno, id);
  await sql.ejecutar('DELETE FROM cuadernos_tarjetas WHERE id = ?', id);
  await tocar(sql, cuaderno);
}

/** Fija el orden: las tarjetas que no aparezcan van detrás, en su orden actual. */
export async function ordenarTarjetas(sql: SQL, cuaderno: string, orden: string[]): Promise<void> {
  const actuales = await listarTarjetas(sql, cuaderno);
  const existentes = new Set(actuales.map((t) => t.id));
  const vistas = new Set<string>();
  const final: string[] = [];
  for (const id of orden) if (existentes.has(id) && !vistas.has(id)) { vistas.add(id); final.push(id); }
  for (const t of actuales) if (!vistas.has(t.id)) final.push(t.id);
  await sql.transaccion(async (tx) => {
    for (let i = 0; i < final.length; i++) await tx.ejecutar('UPDATE cuadernos_tarjetas SET posicion = ? WHERE id = ?', i, final[i]!);
  });
}

/**
 * Citas vivas: vuelve a resolver cada tarjeta contra la biblioteca. Si el
 * pasaje ha cambiado, la tarjeta pasa a «cambiada» y guarda el texto nuevo
 * (el anterior queda en `contenido.pasajeAnterior`); si ya no existe, a «huérfana».
 */
export async function reverificarCuaderno(p: PuertosFunciones, cuaderno: string): Promise<TarjetaCompleta[]> {
  const { sql } = p;
  await obtenerCuaderno(sql, cuaderno);
  const tarjetas = await sql.ejecutar('SELECT * FROM cuadernos_tarjetas WHERE cuaderno = ?', cuaderno);
  const t = ahora();
  for (const f of tarjetas) {
    const tipo = String(f.tipo) as TipoTarjeta;
    if (tipo === 'nota' || tipo === 'sintesis') continue;
    const ancla = deJSON<Ancla | null>(f.ancla, null);
    let cita: CitaResuelta | null = null;
    try {
      cita = await resolverCita(sql, {
        tipo, documento: texto(f.documento), objetivo: texto(f.objetivo),
        t0: ancla?.tipo === 'tiempo' ? ancla.t0 : null, t1: ancla?.tipo === 'tiempo' ? ancla.t1 : null,
      });
    } catch {
      cita = null;
    }
    if (!cita) {
      await sql.ejecutar("UPDATE cuadernos_tarjetas SET estado = 'huerfana', verificada = ? WHERE id = ?", t, String(f.id));
      continue;
    }
    const huella = await sha256(cita.pasaje);
    if (huella === f.huella) {
      await sql.ejecutar(
        "UPDATE cuadernos_tarjetas SET estado = CASE WHEN estado = 'huerfana' THEN 'verificada' ELSE estado END, cita = ?, verificada = ? WHERE id = ?",
        cita.citaCorta, t, String(f.id),
      );
      continue;
    }
    const contenido = deJSON<Record<string, unknown>>(f.contenido, {});
    contenido.pasajeAnterior = f.pasaje;
    const afirmacion = texto(f.afirmacion);
    const respaldo = afirmacion ? await juzgarRespaldo(p, cita.pasaje, afirmacion) : null;
    await sql.ejecutar(
      `UPDATE cuadernos_tarjetas SET estado = 'cambiada', pasaje = ?, ancla = ?, ancla_fin = ?, cita = ?, huella = ?, contenido = ?,
         respaldo = coalesce(?, respaldo), verificada = ?, actualizada = ? WHERE id = ?`,
      cita.pasaje, aJSON(cita.ancla), aJSON(cita.anclaFin), cita.citaCorta, huella, JSON.stringify(contenido), respaldo, t, t, String(f.id),
    );
  }
  return listarTarjetas(sql, cuaderno);
}

// ---------------------------------------------------------------------------
// Síntesis
// ---------------------------------------------------------------------------

export interface SintesisCompleta extends Sintesis {
  confianza?: 'alta' | 'media' | 'baja';
  modelo?: string;
  ms?: number;
  /** Marcas que el redactor inventó y se quitaron. */
  marcasDescartadas?: number;
}

function filaASintesis(f: Record<string, unknown>): SintesisCompleta {
  const s: SintesisCompleta = {
    id: String(f.id),
    cuaderno: String(f.cuaderno ?? ''),
    instrucciones: String(f.peticion),
    texto: String(f.cuerpo),
    citas: deJSON(f.fuentes, []),
    creada: String(f.creada),
  };
  if (f.confianza) s.confianza = String(f.confianza) as SintesisCompleta['confianza'];
  if (f.modelo) s.modelo = String(f.modelo);
  if (f.ms !== null && f.ms !== undefined) s.ms = num(f.ms);
  return s;
}

const ESQUEMA_SINTESIS = {
  type: 'object',
  properties: {
    texto: { type: 'string', description: 'Síntesis en Markdown, con marcas [n] que remiten a las tarjetas numeradas.' },
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
  },
  required: ['texto', 'confianza'],
};

/** Quita las marcas [n] que no remiten a una tarjeta citable. Devuelve el texto limpio, las usadas y las descartadas. */
export function depurarMarcas(textoIn: string, validas: Set<number>): { texto: string; usadas: number[]; descartadas: number } {
  const usadas = new Set<number>();
  let descartadas = 0;
  const limpio = textoIn.replace(/\s?\[(\d+(?:\s*[,;]\s*\d+)*)\]/g, (todo, dentro: string) => {
    const ns = dentro.split(/\s*[,;]\s*/).map(Number);
    const buenas = ns.filter((n) => validas.has(n));
    descartadas += ns.length - buenas.length;
    buenas.forEach((n) => usadas.add(n));
    if (!buenas.length) return '';
    return (todo.startsWith(' ') ? ' ' : '') + `[${buenas.join(', ')}]`;
  });
  return { texto: limpio, usadas: [...usadas].sort((a, b) => a - b), descartadas };
}

export async function sintetizar(p: PuertosFunciones, cuaderno: string, instrucciones: string): Promise<SintesisCompleta> {
  const { sql } = p;
  const pet = typeof instrucciones === 'string' ? instrucciones.trim() : '';
  if (!pet) throw new ErrorFunciones('peticion_invalida', 'Faltan las instrucciones de la síntesis.');
  if (pet.length > 2000) throw new ErrorFunciones('peticion_invalida', 'Las instrucciones no pueden pasar de 2000 caracteres.');
  const redactor = p.inteligencia?.redactor;
  if (!redactor) throw new ErrorFunciones('no_disponible', 'No hay ningún redactor disponible para sintetizar.', 503);
  const c = await obtenerCuaderno(sql, cuaderno);
  const tarjetas = await listarTarjetas(sql, cuaderno);
  const citables = tarjetas.filter((t) => t.cita && !t.huerfana);
  const notas = tarjetas.filter((t) => t.tipo === 'nota' && typeof t.contenido.texto === 'string');
  if (!citables.length) throw new ErrorFunciones('peticion_invalida', 'El cuaderno no tiene tarjetas con citas que sintetizar.');

  const bloques = citables.map((t, i) => {
    const comentario = typeof t.contenido.comentario === 'string' ? `\nComentario del usuario: ${t.contenido.comentario}` : '';
    return `[${i + 1}] ${t.cita!.citaCorta}\n«${recortar(t.cita!.texto, 1500)}»${comentario}`;
  });
  const notasTxt = notas.length ? `\n\nNotas del usuario (no son citables):\n${notas.map((n) => `- ${recortar(String(n.contenido.texto), 500)}`).join('\n')}` : '';
  const sistema =
    'Eres un asistente de investigación académica. Redactas síntesis rigurosas en el idioma de las instrucciones ' +
    '(en español si no se indica otro), con buena ortografía. Solo puedes afirmar lo que dicen las tarjetas y debes citarlas ' +
    'con marcas [n] que remitan a su número. Nunca inventes fuentes ni números de tarjeta. Si las tarjetas no bastan para ' +
    'responder, dilo y baja la confianza.';
  const t0 = Date.now();
  const r = await redactor.generar<{ texto: string; confianza: 'alta' | 'media' | 'baja' }>({
    sistema,
    mensajes: [{
      rol: 'usuario',
      partes: [{ texto: `Cuaderno: «${c.titulo}»\n\nInstrucciones: ${pet}\n\nTarjetas citables:\n\n${bloques.join('\n\n')}${notasTxt}` }],
    }],
    esquema: ESQUEMA_SINTESIS,
    temperatura: 0.3,
    calidad: p.usuario.pro ? 'alta' : 'rapida',
  });
  const crudo = r.json?.texto ?? r.texto;
  const { texto: limpio, usadas, descartadas } = depurarMarcas(crudo, new Set(citables.map((_, i) => i + 1)));
  const citas = usadas.map((n) => {
    const t = citables[n - 1]!;
    return { n, tarjeta: t.id, ...(t.tipo === 'fragmento' && t.objetivo ? { fragmento: t.objetivo } : {}), etiqueta: t.cita!.citaCorta };
  });
  let confianza = r.json?.confianza;
  if (confianza && !['alta', 'media', 'baja'].includes(confianza)) confianza = undefined;
  if (!usadas.length) confianza = 'baja';
  const id = nuevoId('s');
  await sql.ejecutar(
    'INSERT INTO cuadernos_sintesis (id, cuaderno, peticion, cuerpo, fuentes, confianza, modelo, ms, creada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, cuaderno, pet, limpio.trim(), JSON.stringify(citas), confianza ?? null, redactor.nombre, Date.now() - t0, ahora(),
  );
  const s = await obtenerSintesis(sql, id);
  if (descartadas) s.marcasDescartadas = descartadas;
  return s;
}

export async function obtenerSintesis(sql: SQL, id: string): Promise<SintesisCompleta> {
  const f = await una(sql, 'SELECT * FROM cuadernos_sintesis WHERE id = ?', id);
  if (!f) throw noEncontrado('esa síntesis');
  return filaASintesis(f);
}

export async function listarSintesis(sql: SQL, cuaderno: string): Promise<SintesisCompleta[]> {
  await obtenerCuaderno(sql, cuaderno);
  return (await sql.ejecutar('SELECT * FROM cuadernos_sintesis WHERE cuaderno = ? ORDER BY creada DESC', cuaderno)).map(filaASintesis);
}
