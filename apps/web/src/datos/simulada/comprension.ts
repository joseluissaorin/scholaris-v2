/**
 * La comprensión en la demostración: lo que el flujo de comprensión habría
 * dejado para el cuento y la película inventados (estructura, fichas, entidades
 * con sus apariciones ancladas, la relación de adaptación y sus alineaciones) y
 * una comprensión simulada para el resto del corpus, que solo rehace la
 * estructura desde el índice y lo dice.
 *
 * Las anclas son exactas sobre el material de la demo: los caracteres se cuentan
 * en puntos de código del texto de cada unidad, y las regiones de las páginas
 * salen de cómo se dibuja cada página (renglón a renglón), así que el recuadro
 * cae sobre las palabras que señala.
 */
import { anclaACita, type Alineacion, type AnclaMaterial, type Aparicion, type Evidencia, type Ficha, type LadoAlineacion, type Lente, type Region, type Relacion, type Segmento, type TipoCorrespondencia, type TipoSegmento } from '@scholaris/nucleo';
import type { AparicionVista, EstadoAlineacionVista, EstadoComprensionVista, EventoTiempoReal, EvidenciaInvestigacion, FiguraVista, MapaComprension } from '@scholaris/contrato';
import { anclaDe, textoDe, type DocDemo } from './corpus';
import {
  CUENTO, ENTIDADES_INVENTADAS, ESCENAS_CUENTO, ID_CUENTO, ID_PELICULA, PELICULA, SECUENCIAS, type EscenaInventada, type PlanoInventado, type Visto,
} from './obras-inventadas';
import type { RelacionVista } from '@scholaris/contrato';

const CREADA = '2026-10-22T09:14:00Z';
const MODELO = 'gemini-4-argon';
const cp = (t: string, i: number) => Array.from(t.slice(0, i)).length;

// ---------------------------------------------------------------------------
// Las páginas del cuento, dibujadas renglón a renglón (y dónde cae cada carácter)
// ---------------------------------------------------------------------------

/** Un renglón de la página: sus caracteres [desde, hasta), dónde empieza y cuánto mide (justificado, salvo el último del párrafo). */
interface Renglon { desde: number; hasta: number; x: number; y: number; ancho: number; texto: string; titulo?: boolean }
const ANCHO = 600, ALTO = 848, IZQ = 70, DER = 530, RENGLON = 25, LETRA = 6.7, POR_LINEA = 64;
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Reparte el texto de una página en renglones, contando los puntos de código de cada uno. */
export function maquetar(texto: string): Renglon[] {
  const out: Renglon[] = [];
  let y = 96, pos = 0;
  for (const parrafo of texto.split('\n\n')) {
    const inicio = cp(texto, texto.indexOf(parrafo, pos));
    pos = texto.indexOf(parrafo, pos) + parrafo.length;
    if (parrafo.startsWith('## ')) {
      y += 18;
      out.push({ desde: inicio, hasta: inicio + Array.from(parrafo).length, x: ANCHO / 2, y, ancho: 0, texto: parrafo.slice(3), titulo: true });
      y += RENGLON + 22;
      continue;
    }
    const palabras = parrafo.split(' ');
    let linea = '', desde = inicio, primera = true, c = inicio;
    const cerrar = (ultima: boolean) => {
      const x = IZQ + (primera ? 22 : 0);
      const n = Array.from(linea).length;
      // Justificada a la caja, como en el libro; la última del párrafo, a su largo natural.
      out.push({ desde, hasta: desde + n, x, y, ancho: ultima ? Math.min(DER - x, n * LETRA) : DER - x, texto: linea });
      y += RENGLON; primera = false;
    };
    for (const p of palabras) {
      const largo = Array.from(p).length;
      if (linea && Array.from(linea).length + 1 + largo > POR_LINEA - (primera ? 3 : 0)) { cerrar(false); linea = p; desde = c; }
      else linea = linea ? `${linea} ${p}` : p;
      c += largo + 1;
    }
    if (linea) cerrar(true);
    y += 6;
  }
  return out;
}

function paginaSvg(texto: string, folio: string): string {
  const rs = maquetar(texto);
  const lineas = rs.map((r) => (r.titulo
    ? `<text x="${r.x}" y="${r.y}" text-anchor="middle" font-size="20" letter-spacing="3">${xml(r.texto)}</text>`
    : `<text x="${r.x}" y="${r.y}" textLength="${r.ancho.toFixed(1)}" lengthAdjust="spacingAndGlyphs">${xml(r.texto)}</text>`)).join('');
  // Papel algo amarillento, una sombra de escáner en el lomo y el folio al pie.
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ANCHO} ${ALTO}" width="${ANCHO}" height="${ALTO}"><defs><linearGradient id="l" x1="0" x2="1"><stop offset="0" stop-color="#d9ccb4"/><stop offset="0.06" stop-color="#f6efe0"/><stop offset="1" stop-color="#fbf6ea"/></linearGradient></defs><rect width="${ANCHO}" height="${ALTO}" fill="url(#l)"/><text x="${ANCHO / 2}" y="56" text-anchor="middle" font-family="Georgia, serif" font-size="11" letter-spacing="2" fill="#6b5a48">LAS TARDES DEL MIRLO</text><g font-family="Georgia, serif" font-size="15.2" fill="#2a1d14">${lineas}</g><text x="${ANCHO / 2}" y="${ALTO - 40}" text-anchor="middle" font-family="Georgia, serif" font-size="13" fill="#4a3b2e">${folio}</text></svg>`)}`;
}

/** La región de unos caracteres en la página dibujada: el renglón (o los renglones) que ocupan. */
export function regionDeCaracteres(texto: string, [a, b]: readonly [number, number]): Region | undefined {
  const rs = maquetar(texto).filter((r) => r.desde < b && r.hasta > a && !r.titulo);
  if (!rs.length) return undefined;
  const y0 = rs[0]!.y - 17, y1 = rs.at(-1)!.y + 7;
  let x0 = IZQ - 4, x1 = DER + 4;
  if (rs.length === 1) {
    // Con el renglón justificado a su ancho, cada carácter ocupa su parte proporcional.
    const r = rs[0]!, n = Math.max(1, r.hasta - r.desde);
    x0 = r.x + (Math.max(0, a - r.desde) / n) * r.ancho - 3;
    x1 = Math.min(DER + 4, r.x + ((Math.min(b, r.hasta) - r.desde) / n) * r.ancho + 3);
  }
  return { x: x0 / ANCHO, y: y0 / ALTO, w: (x1 - x0) / ANCHO, h: (y1 - y0) / ALTO };
}

CUENTO.imagenes = Array.from({ length: CUENTO.unidades }, (_, i) => paginaSvg(textoDe(CUENTO, i + 1), String(i + 1)));

// ---------------------------------------------------------------------------
// Anclas exactas
// ---------------------------------------------------------------------------

/** El ancla de un trozo literal de una página del cuento: página, caracteres y región. */
function enPagina(orden: number, literal: string): AnclaMaterial {
  const t = textoDe(CUENTO, orden);
  const i = t.indexOf(literal);
  const base = anclaDe(CUENTO, orden);
  if (i < 0) return base;
  const c: [number, number] = [cp(t, i), cp(t, i) + Array.from(literal).length];
  const region = regionDeCaracteres(t, c);
  return { ...base, caracteres: c, ...(region ? { region } : {}) };
}

/** El ancla de un trozo de los diálogos de la película: el tramo y los caracteres. */
function enDialogo(literal: string): { ancla: AnclaMaterial; unidad: number } | null {
  for (let o = 1; o <= PELICULA.unidades; o++) {
    const t = textoDe(PELICULA, o);
    const i = t.indexOf(literal);
    if (i < 0) continue;
    const a = anclaDe(PELICULA, o);
    return { ancla: { ...a, caracteres: [cp(t, i), cp(t, i) + Array.from(literal).length] }, unidad: o };
  }
  return null;
}

const evTexto = (orden: number, literal: string): Evidencia => ({ documento: ID_CUENTO, ancla: enPagina(orden, literal), cita: literal, modo: 'texto', unidad: `u-${ID_CUENTO}-${orden}` });
function evDialogo(literal: string): Evidencia {
  const d = enDialogo(literal);
  return { documento: ID_PELICULA, ancla: d?.ancla ?? { tipo: 'tiempo', t0: 0, t1: 1 }, cita: literal, modo: 'audio', ...(d ? { unidad: `u-${ID_PELICULA}-${d.unidad}` } : {}) };
}
const evPlano = (pl: PlanoInventado, v: Visto | undefined, cita: string): Evidencia => ({
  documento: ID_PELICULA, modo: 'video', cita,
  ancla: { tipo: 'tiempo', t0: pl.t0, t1: pl.t1, instante: Math.round(((pl.t0 + pl.t1) / 2) * 10) / 10, ...(v ? { region: v.region } : {}) },
});

// ---------------------------------------------------------------------------
// La estructura
// ---------------------------------------------------------------------------

const ESCENAS = SECUENCIAS.flatMap((s) => s.escenas.map((e) => ({ ...e, secuencia: s.id })));
const PLANOS = ESCENAS.flatMap((e) => e.planos.map((p, k) => ({ ...p, id: `${e.id}pl${k + 1}`, escena: e })));
const sid = (doc: string, clave: string) => `${doc}:s:${clave}`;

function unidadEnTiempo(t: number): number {
  let mejor = 1, dist = Infinity;
  for (let o = 1; o <= PELICULA.unidades; o++) {
    const a = anclaDe(PELICULA, o);
    if (a.tipo !== 'tiempo') continue;
    if (t >= a.t0 && t < a.t1) return o;
    const d = Math.min(Math.abs(t - a.t0), Math.abs(t - a.t1));
    if (d < dist) { dist = d; mejor = o; }
  }
  return mejor;
}

function segmentosPelicula(): Segmento[] {
  const out: Segmento[] = [];
  let orden = 0;
  const seg = (clave: string, padre: string | null, nivel: number, tipo: TipoSegmento, titulo: string, t0: number, t1: number, resumen?: string): Segmento => ({
    id: sid(ID_PELICULA, clave), documento: ID_PELICULA, padre: padre ? sid(ID_PELICULA, padre) : null, nivel, orden: orden++, tipo, titulo,
    ancla: { tipo: 'tiempo', t0, t1 }, unidadDesde: `u-${ID_PELICULA}-${unidadEnTiempo(t0)}`, unidadHasta: `u-${ID_PELICULA}-${unidadEnTiempo(Math.max(t0, t1 - 1))}`,
    ...(resumen ? { resumen } : {}), origen: 'modelo', confianza: tipo === 'plano' ? 0.85 : 0.9,
  });
  for (const s of SECUENCIAS) {
    const t0 = s.escenas[0]!.t0, t1 = s.escenas.at(-1)!.t1;
    out.push(seg(s.id, null, 1, 'secuencia', s.titulo, t0, t1, s.resumen));
    for (const e of s.escenas) {
      out.push(seg(e.id, s.id, 2, 'escena', e.titulo, e.t0, e.t1, [e.lugar, e.accion].filter(Boolean).join('. ')));
      e.planos.forEach((p, k) => out.push(seg(`${e.id}pl${k + 1}`, e.id, 3, 'plano', [p.escala, p.movimiento !== 'fija' ? p.movimiento : ''].filter(Boolean).join(', '), p.t0, p.t1, p.descripcion)));
    }
  }
  return out;
}

function segmentosCuento(): Segmento[] {
  const out: Segmento[] = [];
  let orden = 0;
  const partes: Array<[number, number]> = [[1, 3], [4, 6], [7, 9], [10, 12]];
  partes.forEach(([desde, hasta], i) => {
    const titulo = CUENTO.secciones[i]!.titulo;
    out.push({
      id: sid(ID_CUENTO, `p${i + 1}`), documento: ID_CUENTO, padre: null, nivel: 1, orden: orden++, tipo: 'parte', titulo: `Parte ${titulo}`,
      ancla: anclaDe(CUENTO, desde), anclaFin: anclaDe(CUENTO, hasta), unidadDesde: `u-${ID_CUENTO}-${desde}`, unidadHasta: `u-${ID_CUENTO}-${hasta}`,
      resumen: ['El encuentro en El Mirlo y el primer préstamo.', 'La librería, el reloj de arena y la sospecha del barrio.', 'La tormenta, la confidencia y los jueves de lectura.', 'El derribo, la despedida en el muelle y el reloj quieto.'][i], origen: 'leido', confianza: 0.97,
    });
    for (const e of ESCENAS_CUENTO.filter((x) => x.parte === i)) {
      out.push({
        id: sid(ID_CUENTO, e.id), documento: ID_CUENTO, padre: sid(ID_CUENTO, `p${i + 1}`), nivel: 2, orden: orden++, tipo: 'escena', titulo: e.titulo,
        ancla: anclaDe(CUENTO, e.desde), ...(e.hasta !== e.desde ? { anclaFin: anclaDe(CUENTO, e.hasta) } : {}),
        unidadDesde: `u-${ID_CUENTO}-${e.desde}`, unidadHasta: `u-${ID_CUENTO}-${e.hasta}`, resumen: e.resumen, origen: 'modelo', confianza: 0.88,
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Entidades y apariciones
// ---------------------------------------------------------------------------

const ENT_DE_NOMBRE: Record<string, string> = {
  Ernesto: 'e-ernesto', Tomás: 'e-tomas', 'Don Julián': 'e-julian', Nieves: 'e-nieves', 'Reloj de arena': 'e-reloj', 'Té con canela': 'e-te',
  'Taza de té': 'e-te', 'Té sin canela': 'e-te', 'Cuaderno de bajamar': 'e-bajamar',
};
const entPorId = new Map(ENTIDADES_INVENTADAS.map((e) => [e.id, e]));
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Todas las veces que aparecen las formas de una entidad en un texto (sin solapes, las formas largas primero). */
function buscarFormas(texto: string, formas: string[], tomadas: Array<[number, number]>): Array<[number, number, string]> {
  const out: Array<[number, number, string]> = [];
  for (const f of [...formas].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapar(f)}(?![\\p{L}\\p{N}])`, 'gu');
    for (const m of texto.matchAll(re)) {
      const i = m.index!, j = i + m[0].length;
      if (tomadas.some(([a, b]) => i < b && j > a)) continue;
      // Los turnos marcados («**Ernesto:**») no son menciones: son quién habla.
      if (texto.slice(Math.max(0, i - 2), i) === '**' && texto.slice(j, j + 3) === ':**') continue;
      tomadas.push([i, j]);
      out.push([i, j, m[0]]);
    }
  }
  return out;
}

function vista(a: Aparicion): AparicionVista {
  const e = entPorId.get(a.entidad);
  return { ...a, nombre: e?.nombre ?? a.entidad, tipo: e?.tipo ?? 'concepto' };
}

function aparicionesCuento(segs: Segmento[]): AparicionVista[] {
  const out: Aparicion[] = [];
  const escenaDe = (orden: number) => segs.find((s) => s.tipo === 'escena' && orden >= Number(s.unidadDesde.split('-').at(-1)) && orden <= Number(s.unidadHasta.split('-').at(-1)))?.id;
  for (let o = 1; o <= CUENTO.unidades; o++) {
    const t = textoDe(CUENTO, o);
    const tomadas: Array<[number, number]> = [];
    for (const e of ENTIDADES_INVENTADAS) {
      if (!e.formas.length || e.id === 'e-bolero' || e.id === 'e-nieves') continue;
      for (const [i, j, literal] of buscarFormas(t, e.formas, tomadas)) {
        const c: [number, number] = [cp(t, i), cp(t, j)];
        const region = regionDeCaracteres(t, c);
        const segmento = escenaDe(o);
        out.push({
          id: `${ID_CUENTO}:ap:${e.id}:${o}:${c[0]}`, entidad: e.id, documento: ID_CUENTO, ...(segmento ? { segmento } : {}),
          ancla: { ...anclaDe(CUENTO, o), caracteres: c, ...(region ? { region } : {}) }, forma: literal, rol: e.fino === 'personaje' ? 'nombrado' : e.fino === 'obra' ? 'citado' : 'nombrado', confianza: 0.9,
        });
      }
    }
  }
  // Tomás narra: está presente en todas las escenas aunque casi nunca se nombre.
  for (const e of ESCENAS_CUENTO) {
    const t = textoDe(CUENTO, e.desde);
    const primera = /[^.!?]+[.!?]/u.exec(t.replace(/^## [^\n]+\n\n/, ''))?.[0] ?? t.slice(0, 60);
    const ancla = enPagina(e.desde, primera.trim());
    out.push({ id: `${ID_CUENTO}:ap:e-tomas:narra:${e.id}`, entidad: 'e-tomas', documento: ID_CUENTO, segmento: sid(ID_CUENTO, e.id), ancla, forma: 'el narrador (yo)', rol: 'presente', confianza: 0.8 });
  }
  // Los temas: aludidos en pasajes concretos.
  const temas: Array<[string, number, string]> = [
    ['e-amistad', 9, 'los jueves se convirtieron en nuestros'], ['e-amistad', 3, 'Me reí por primera vez aquella semana'], ['e-amistad', 11, 'Así no tendrá que pedirle a nadie media hora'],
    ['e-sospecha', 3, 'Don Julián me miró con una cara que entonces no supe leer'], ['e-sospecha', 6, 'Porque la gente dice cosas'], ['e-sospecha', 9, 'ya no me traía la canela'],
    ['e-sospecha', 10, 'No es por el aparcamiento'], ['e-tiempo', 5, 'Media hora exacta'], ['e-tiempo', 7, 'La lluvia ya cuenta el tiempo por nosotros'],
    ['e-tiempo', 10, 'El local se derribaba en primavera'], ['e-tiempo', 12, 'mientras la arena siguiera abajo, la conversación con Ernesto no se habría terminado del todo'],
  ];
  for (const [ent, o, literal] of temas) {
    const ancla = enPagina(o, literal);
    out.push({ id: `${ID_CUENTO}:ap:t:${ent}:${o}:${ancla.caracteres?.[0] ?? 0}`, entidad: ent, documento: ID_CUENTO, ...(escenaDe(o) ? { segmento: escenaDe(o)! } : {}), ancla, forma: literal, rol: 'aludido', confianza: 0.75 });
  }
  return out.map(vista);
}

function aparicionesPelicula(): AparicionVista[] {
  const out: Aparicion[] = [];
  // Quién y qué se ve, plano a plano, con su región en el fotograma.
  for (const p of PLANOS) {
    const instante = Math.round(((p.t0 + p.t1) / 2) * 10) / 10;
    for (const [v, clase] of [...(p.personas ?? []).map((x) => [x, 'persona'] as const), ...(p.objetos ?? []).map((x) => [x, 'objeto'] as const)]) {
      const ent = ENT_DE_NOMBRE[v.nombre];
      if (!ent) continue;
      out.push({
        id: `${ID_PELICULA}:ap:${ent}:${p.id}`, entidad: ent, documento: ID_PELICULA, segmento: sid(ID_PELICULA, p.escena.id),
        ancla: { tipo: 'tiempo', t0: p.t0, t1: p.t1, instante, region: v.region }, forma: v.nota ? `${v.nombre}, ${v.nota}` : v.nombre, rol: clase === 'persona' ? 'visible' : 'visible', confianza: 0.86,
      });
    }
  }
  // Quién habla y qué se nombra en los diálogos.
  for (let o = 1; o <= PELICULA.unidades; o++) {
    const t = textoDe(PELICULA, o);
    const a = anclaDe(PELICULA, o);
    const escena = ESCENAS.find((e) => a.tipo === 'tiempo' && a.t0 >= e.t0 && a.t0 < e.t1);
    for (const m of t.matchAll(/\*\*([^*]+):\*\*\s*([^\n]+)/g)) {
      const ent = ENT_DE_NOMBRE[m[1]!];
      if (!ent) continue;
      const i = m.index! + m[0].length - m[2]!.length;
      out.push({
        id: `${ID_PELICULA}:ap:${ent}:habla:${o}:${i}`, entidad: ent, documento: ID_PELICULA, ...(escena ? { segmento: sid(ID_PELICULA, escena.id) } : {}),
        ancla: { ...a, caracteres: [cp(t, i), cp(t, i + m[2]!.length)] }, forma: m[2]!.slice(0, 120), rol: 'habla', confianza: 0.93,
      });
    }
    const tomadas: Array<[number, number]> = [];
    for (const e of ENTIDADES_INVENTADAS) {
      if (!e.formas.length) continue;
      for (const [i, j, literal] of buscarFormas(t, e.formas, tomadas)) {
        out.push({
          id: `${ID_PELICULA}:ap:${e.id}:${o}:${cp(t, i)}`, entidad: e.id, documento: ID_PELICULA, ...(escena ? { segmento: sid(ID_PELICULA, escena.id) } : {}),
          ancla: { ...a, caracteres: [cp(t, i), cp(t, j)] }, forma: literal, rol: e.fino === 'obra' || e.fino === 'obra_musical' ? 'citado' : 'nombrado', confianza: 0.88,
        });
      }
    }
  }
  // Lo que se oye: el bolero (dentro y fuera de la historia) y la lluvia.
  const oidos: Array<[string, number, number, string]> = [
    ['e-bolero', 0, 150, 'Bolero del muelle, en la banda sonora (créditos)'], ['e-bolero', 2460, 2840, 'Bolero del muelle, en una radio de la azotea'],
    ['e-bolero', 3780, 4470, 'Bolero del muelle, variación al piano'], ['e-bolero', 5790, 5880, 'Bolero del muelle, en el fundido y los créditos'],
    ['e-lluvia', 2840, 3780, 'la lluvia sobre la uralita'], ['e-lluvia', 5160, 5660, 'la llovizna del muelle'],
  ];
  for (const [ent, t0, t1, forma] of oidos) {
    const escena = ESCENAS.find((e) => t0 >= e.t0 && t0 < e.t1);
    out.push({ id: `${ID_PELICULA}:ap:${ent}:oido:${t0}`, entidad: ent, documento: ID_PELICULA, ...(escena ? { segmento: sid(ID_PELICULA, escena.id) } : {}), ancla: { tipo: 'tiempo', t0, t1 }, forma, rol: 'audible', confianza: 0.9 });
  }
  // Los temas, aludidos en momentos concretos.
  const plano = (id: string) => PLANOS.find((p) => p.id === id)!;
  const temas: Array<[string, string, string]> = [
    ['e-amistad', 'es5pl4', 'los dos a cada lado del reloj'], ['e-amistad', 'es13pl3', 'la entrega del paquete'], ['e-sospecha', 'es6pl2', 'Nieves nombra la mala fama'],
    ['e-sospecha', 'es10pl3', 'el té sin canela'], ['e-tiempo', 'es5pl5', 'la arena que cae'], ['e-tiempo', 'es14pl3', 'Tomás da la vuelta al reloj'],
  ];
  for (const [ent, pid, forma] of temas) {
    const p = plano(pid);
    out.push({ id: `${ID_PELICULA}:ap:t:${ent}:${pid}`, entidad: ent, documento: ID_PELICULA, segmento: sid(ID_PELICULA, p.escena.id), ancla: { tipo: 'tiempo', t0: p.t0, t1: p.t1, instante: (p.t0 + p.t1) / 2 }, forma, rol: 'aludido', confianza: 0.72 });
  }
  return out.map(vista);
}

// ---------------------------------------------------------------------------
// Fichas
// ---------------------------------------------------------------------------

const ficha = (f: Omit<Ficha, 'modelo' | 'version' | 'creada' | 'idioma'> & { version?: string }): Ficha => ({ idioma: 'es', modelo: MODELO, creada: CREADA, version: 'comprension@2', ...f });

function prosaPlano(p: PlanoInventado): string {
  const cab = [p.escala.charAt(0).toUpperCase() + p.escala.slice(1), p.angulacion ? `con angulación ${p.angulacion}` : '', p.movimiento === 'fija' ? 'y cámara fija' : `y ${p.movimiento}`].filter(Boolean).join(' ');
  const partes = [`${cab}, de ${anclaACita({ tipo: 'tiempo', t0: p.t0, t1: p.t0 })} a ${anclaACita({ tipo: 'tiempo', t0: p.t1, t1: p.t1 })} (${String(p.t1 - p.t0)} s).`, p.descripcion];
  if (p.composicion) partes.push(`Composición: ${p.composicion.charAt(0).toLowerCase()}${p.composicion.slice(1)}`);
  if (p.luz) partes.push(`Luz: ${p.luz}.`);
  if (p.personas?.length) partes.push(`En cuadro: ${p.personas.map((x) => `${x.nombre}${x.nota ? ` (${x.nota})` : ''}`).join(', ')}.`);
  if (p.textoEnPantalla) partes.push(`Texto en pantalla: «${p.textoEnPantalla}».`);
  return partes.join(' ');
}

function fichasPelicula(): Ficha[] {
  const out: Ficha[] = [];
  for (const p of PLANOS) {
    const vistos = [...(p.personas ?? []), ...(p.objetos ?? [])];
    out.push(ficha({
      id: `${ID_PELICULA}:fi:${p.id}:plano`, documento: ID_PELICULA, objetivo: 'segmento', objetivoId: sid(ID_PELICULA, p.id), lente: 'cine', clase: 'plano', version: 'comprension@2 percepcion:demo',
      texto: prosaPlano(p),
      datos: {
        escala: p.escala, angulacion: p.angulacion ?? 'normal', movimiento: p.movimiento, composicion: p.composicion ?? null, luz: p.luz ?? null, color: p.color ?? null,
        duracion: p.t1 - p.t0, personas: (p.personas ?? []).map((x) => x.nombre), objetos: (p.objetos ?? []).map((x) => x.nombre), textoEnPantalla: p.textoEnPantalla ?? null,
        resumen: { es: p.descripcion },
      },
      evidencias: vistos.length ? vistos.map((v) => evPlano(p, v, `${v.nombre}${v.nota ? `: ${v.nota}` : ''}`)) : [evPlano(p, undefined, p.descripcion)],
    }));
  }
  const dialogoDe = (e: EscenaInventada) => {
    const lineas: Array<{ hablante: string; texto: string }> = [];
    for (let o = 1; o <= PELICULA.unidades; o++) {
      const a = anclaDe(PELICULA, o);
      if (a.tipo !== 'tiempo' || a.t0 < e.t0 || a.t0 >= e.t1) continue;
      for (const m of textoDe(PELICULA, o).matchAll(/\*\*([^*]+):\*\*\s*([^\n]+)/g)) lineas.push({ hablante: m[1]!, texto: m[2]! });
    }
    return lineas;
  };
  for (const e of ESCENAS) {
    const dialogo = dialogoDe(e);
    const clave = dialogo.slice().sort((a, b) => b.texto.length - a.texto.length)[0];
    const conComposicion = e.planos.find((p) => p.composicion);
    out.push(ficha({
      id: `${ID_PELICULA}:fi:${e.id}:cine`, documento: ID_PELICULA, objetivo: 'segmento', objetivoId: sid(ID_PELICULA, e.id), lente: 'cine', clase: 'escena',
      texto: e.ficha,
      datos: {
        titulo: e.titulo, lugar: e.lugar, tiempo: e.tiempo, personajes: e.personajes.map((nombre) => ({ nombre })), accion: e.accion,
        dialogoClave: clave ? [{ hablante: clave.hablante, texto: clave.texto }] : [], escalas: [...new Set(e.planos.map((p) => p.escala))],
        composicion: conComposicion?.composicion ?? '', montaje: e.montaje, sonido: e.sonido, funcionNarrativa: e.funcion,
        objetosSimbolos: e.planos.flatMap((p) => p.objetos ?? []).filter((o) => ENT_DE_NOMBRE[o.nombre]).map((o) => ({ objeto: o.nombre, sentido: o.nota ?? '' })),
        resumen: { es: e.accion },
      },
      evidencias: [
        ...(clave ? [evDialogo(clave.texto)] : []),
        ...e.planos.filter((p) => p.composicion || p.objetos?.length).slice(0, 2).map((p) => evPlano(p, p.personas?.[0] ?? p.objetos?.[0], p.composicion ?? p.descripcion)),
      ],
    }));
  }
  // Las fichas de los personajes (de la biblioteca: objetivo «entidad»).
  const personajes: Array<[string, string, string, string]> = [
    ['e-ernesto', 'Dámaso Lugo', 'Librero de viejo; maestro de lecturas y de silencios.', 'De dominar el encuadre en la primera mitad pasa a segundo término en la despedida: entrega el reloj y, con él, el tiempo de las conversaciones.'],
    ['e-tomas', 'Iván Cejas', 'Estudiante de ingeniería; el que aprende a leer en voz baja.', 'Pasa del fondo desenfocado de la terraza a ocupar, al final, la mesa de Ernesto y dar la vuelta al reloj.'],
    ['e-nieves', 'Marta Quevedo', 'Vecina de la azotea; voz del barrio, inventada para la película.', 'Nombra la sospecha y la desactiva con ironía; enseña a Tomás a bailar mal un bolero.'],
  ];
  for (const [ent, actor, papel, arco] of personajes) {
    out.push(ficha({
      id: `${ID_PELICULA}:fi:${ent}:cine`, documento: null, objetivo: 'entidad', objetivoId: ent, lente: 'cine', clase: 'personaje',
      texto: `${papel} ${arco}`, datos: { actor, papel, arco, resumen: { es: papel } }, evidencias: [],
    }));
  }
  out.push(ficha({
    id: `${ID_PELICULA}:fi:global:cine`, documento: ID_PELICULA, objetivo: 'documento', objetivoId: ID_PELICULA, lente: 'cine', clase: 'global',
    texto: '«Arena en los bolsillos» adapta el cuento de Adela Sorní con una fidelidad de superficie y una libertad de fondo. Conserva la estructura del relato (el encuentro, la librería, la tormenta, el cierre y la despedida) y buena parte de sus réplicas, pero sustituye la voz del narrador por la puesta en cuadro: lo que el cuento dice desde la conciencia de Tomás, la película lo muestra en la composición y en la duración de los planos. Ernesto domina el encuadre durante toda la primera mitad; Tomás solo lo domina en la despedida del muelle, en contrapicado. La película añade a Nieves, una vecina que pone voz a la sospecha del barrio y la desactiva con ironía, y un baile en la azotea que funciona como contrapunto; suprime a Rafa y deja la confidencia de Ernesto en la palabra, sin flashback. El cambio decisivo está al final: donde el cuento deja el reloj de arena quieto, la película hace que Tomás le dé la vuelta, y el motivo pasa de la suspensión a la continuidad.',
    datos: {
      sinopsis: 'En una ciudad portuaria de la isla, Tomás, un estudiante de ingeniería, conoce en la terraza del café El Mirlo a Ernesto Valdivia, un librero de viejo que le presta un libro de poemas. Empieza una amistad de tardes en la trastienda de la librería, medidas por un reloj de arena de media hora. Una vecina, Nieves, le cuenta lo que se murmura de Ernesto en el barrio. Durante una tormenta, Ernesto le confía que alguien lo esperaba en el muelle cuando era joven. En invierno, el ayuntamiento anuncia el derribo del local y Ernesto decide irse a la península. En el muelle le regala a Tomás el reloj de arena; de vuelta en El Mirlo, Tomás le da la vuelta.',
      estructura: 'Ocho secuencias: un prólogo en el puerto, el encuentro, la librería, Nieves, la tormenta, los jueves, el cierre y el muelle. La primera y la última comparten espacio, de modo que el final queda inscrito en el principio.',
      narracion: 'Sin narrador salvo en el montaje de los jueves (la única voz en off). La focalización es externa; el saber del espectador sobre el secreto de Ernesto es el mismo que el de Tomás.',
      montaje: 'Corte con elipsis entre días; plano y contraplano desigual en el encuentro y equilibrado en la trastienda; montaje de encadenados para la frecuencia iterativa.',
      sonidoMusica: 'El «Bolero del muelle» suena fuera de la historia en los créditos, dentro (en una radio) en la azotea, al piano en los jueves y de nuevo en el final. La lluvia ocupa el lugar del reloj en la tormenta.',
      personajes: [
        { nombre: 'Ernesto Valdivia', actor: 'Dámaso Lugo', papel: 'librero de viejo', arco: 'de dominar el encuadre a cederlo' },
        { nombre: 'Tomás Ledesma', actor: 'Iván Cejas', papel: 'estudiante', arco: 'del fondo de la terraza a la mesa de Ernesto' },
        { nombre: 'Nieves', actor: 'Marta Quevedo', papel: 'vecina de la azotea (añadida)', arco: 'nombra la sospecha y la desactiva' },
        { nombre: 'Don Julián', actor: 'Abilio Tejera', papel: 'dueño de El Mirlo', arco: 'niega la canela y la devuelve al final' },
      ],
      adaptacion: 'Adapta «Las tardes del Mirlo» (1988), de Adela Sorní, que coescribe el guion. Cambia el final: Tomás da la vuelta al reloj.',
      sentido: 'Una película sobre lo que se transmite sin decirse: una forma de leer, una media hora, un reloj.',
      temas: [
        { nombre: 'La amistad', descripcion: 'Entre dos hombres de edades y mundos distintos, hecha de préstamos y medias horas.', entidad: 'e-amistad' },
        { nombre: 'La sospecha del barrio', descripcion: 'Lo que se dice de Ernesto, que la película pone en boca de Nieves y en el té sin canela.', entidad: 'e-sospecha' },
        { nombre: 'El tiempo que se acaba', descripcion: 'La media hora del reloj, el derribo y la partida.', entidad: 'e-tiempo' },
      ],
      motivos: [
        { nombre: 'El reloj de arena', descripcion: 'Mide las conversaciones; al final pasa a Tomás, que le da la vuelta.', entidad: 'e-reloj' },
        { nombre: 'El té con canela', descripcion: 'La costumbre de Ernesto, la canela negada por el barrio y devuelta al final.', entidad: 'e-te' },
        { nombre: 'La lluvia', descripcion: 'Cuenta el tiempo cuando el reloj se detiene; vuelve en el muelle.', entidad: 'e-lluvia' },
        { nombre: 'Bolero del muelle', descripcion: 'El tema musical, dentro y fuera de la historia.', entidad: 'e-bolero' },
      ],
      contexto: [{ dato: 'La autora del cuento firma el guion con el director, según los títulos de crédito.', externo: false }, { dato: 'Obras, autores e intérpretes inventados para la demostración de Scholaris.', externo: true }],
      resumen: { es: 'Adaptación que traduce la voz del narrador a la puesta en cuadro y cambia el sentido del reloj de arena al final.' }, fuente: 'obra entera',
    },
    evidencias: [evPlano(PLANOS.find((p) => p.id === 'es2pl4')!, { nombre: 'Ernesto', region: { x: 0.5, y: 0.06, w: 0.42, h: 0.92 } }, 'Ernesto domina el encuadre en primer término'), evDialogo('Media hora exacta. Ninguna conversación seria debería durar más.'), evPlano(PLANOS.find((p) => p.id === 'es14pl3')!, undefined, 'Tomás da la vuelta al reloj de arena')],
  }));
  return out;
}

function fichasCuento(): Ficha[] {
  const out: Ficha[] = ESCENAS_CUENTO.map((e) => {
    const t = textoDe(CUENTO, e.desde).replace(/^## [^\n]+\n\n/, '');
    const primera = (/[^.!?]+[.!?]/u.exec(t)?.[0] ?? t.slice(0, 80)).trim();
    return ficha({
      id: `${ID_CUENTO}:fi:${e.id}:narrativa`, documento: ID_CUENTO, objetivo: 'segmento', objetivoId: sid(ID_CUENTO, e.id), lente: 'narrativa', clase: 'escena', version: 'narrativa@1',
      texto: e.ficha,
      datos: { titulo: e.titulo, acontecimientos: [e.resumen], orden: e.orden, duracion: e.duracion, frecuencia: e.frecuencia, narrador: 'Tomás, narrador autodiegético, en narración ulterior.', focalizacion: 'interna fija', funcionTrama: e.resumen, resumen: { es: e.resumen } },
      evidencias: [evTexto(e.desde, primera)],
    });
  });
  out.push(ficha({
    id: `${ID_CUENTO}:fi:global:narrativa`, documento: ID_CUENTO, objetivo: 'documento', objetivoId: ID_CUENTO, lente: 'narrativa', clase: 'global', version: 'narrativa@1',
    texto: '«Las tardes del Mirlo» es un relato de aprendizaje contado desde la madurez por su protagonista. Tomás narra en primera persona, con una focalización interna fija que filtra a Ernesto por los prejuicios del joven que fue y que el relato desmonta poco a poco. La historia avanza en orden cronológico, con una sola analepsis importante, la juventud de Ernesto, que llega en estilo indirecto y deja sin nombre a la persona que lo esperaba en el puerto. Lo esencial no se dice: la sospecha del barrio se cuenta en gestos (una mirada, una canela que deja de servirse) y el secreto de Ernesto se insinúa en la lectura en voz baja. El reloj de arena organiza el sentido: mide las conversaciones, se detiene en la tormenta y, al final, queda quieto, con la arena abajo, para que la conversación no termine.',
    datos: {
      sinopsis: 'Tomás, estudiante de ingeniería, conoce a Ernesto Valdivia en la terraza de El Mirlo. Ernesto le presta un libro de poemas y lo invita a su librería de la calle Real, donde las conversaciones duran lo que un reloj de arena. El barrio murmura y Rafa, un compañero, advierte a Tomás. En una tormenta, Ernesto le cuenta su juventud. Llegan los jueves de préstamos hasta que el ayuntamiento anuncia el derribo del local. Ernesto se va a la península y deja a Tomás el reloj, que él no vuelve a girar.',
      fabula: [{ acontecimiento: 'Juventud de Ernesto: el mercante y la persona que lo esperaba', segmento: 'ce7' }, { acontecimiento: 'Encuentro en El Mirlo', segmento: 'ce1' }, { acontecimiento: 'Despedida en el muelle', segmento: 'ce10' }],
      ordenRelato: 'Cronológico, con una analepsis externa (p. 8) y una prolepsis implícita en la mirada de Don Julián (p. 3).',
      narrador: 'Autodiegético, en narración ulterior.', focalizacion: 'Interna fija en Tomás.',
      discurso: 'Estilo directo para las réplicas de Ernesto; indirecto para su confidencia.',
      personajes: [{ nombre: 'Tomás', papel: 'narrador y protagonista', arco: 'del juicio a la lealtad' }, { nombre: 'Ernesto Valdivia', papel: 'maestro', arco: 'del secreto al regalo' }, { nombre: 'Rafa', papel: 'voz del barrio' }, { nombre: 'Don Julián', papel: 'testigo' }],
      sentido: 'Lo que se transmite sin decirse.',
      temas: [
        { nombre: 'La amistad', descripcion: 'Una amistad que el relato no nombra y que se mide en jueves y medias horas.', entidad: 'e-amistad' },
        { nombre: 'La sospecha del barrio', descripcion: 'Contada en gestos y en el aviso de Rafa; nunca se dice qué se dice.', entidad: 'e-sospecha' },
        { nombre: 'El tiempo que se acaba', descripcion: 'La media hora, el derribo, la partida; el final suspende el tiempo.', entidad: 'e-tiempo' },
      ],
      motivos: [
        { nombre: 'El reloj de arena', descripcion: 'Mide, se detiene y queda quieto al final.', entidad: 'e-reloj' },
        { nombre: 'El té con canela', descripcion: 'La costumbre de Ernesto, negada y devuelta por Don Julián.', entidad: 'e-te' },
        { nombre: 'La lluvia', descripcion: 'Sustituye al reloj en la tormenta y vuelve en el muelle.', entidad: 'e-lluvia' },
      ],
      contexto: [{ dato: 'Obra y autora inventadas para la demostración de Scholaris.', externo: true }],
      resumen: { es: 'Relato de aprendizaje en primera persona sobre una amistad que el barrio sospecha y un reloj de arena que queda quieto.' }, fuente: 'obra entera',
    },
    evidencias: [evTexto(5, 'Media hora exacta'), evTexto(8, 'Era la única manera de leer juntos sin que nos oyeran'), evTexto(12, 'No le di la vuelta.')],
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Fotogramas de la película (la demo no tiene vídeo: se dibujan como un guion gráfico)
// ---------------------------------------------------------------------------

const FONDOS: Record<EscenaInventada['fondo'], string> = {
  terraza: '<rect width="640" height="360" fill="#EDE6D6"/><rect y="150" width="640" height="60" fill="#2B4C7E"/><rect y="210" width="640" height="150" fill="#D4C4B0"/>',
  libreria: '<rect width="640" height="360" fill="#5C3D2E"/>' + Array.from({ length: 6 }, (_, i) => `<rect x="0" y="${30 + i * 52}" width="640" height="6" fill="#3a2418"/>`).join(''),
  trastienda: '<rect width="640" height="360" fill="#2C1810"/><circle cx="470" cy="70" r="120" fill="#E8A838" opacity="0.18"/>',
  azotea: '<rect width="640" height="360" fill="#1F2E4A"/><rect x="40" y="60" width="120" height="150" fill="#EDE6D6" opacity="0.5"/><rect x="480" y="50" width="110" height="160" fill="#EDE6D6" opacity="0.45"/>',
  lluvia: '<rect width="640" height="360" fill="#25303d"/>' + Array.from({ length: 22 }, (_, i) => `<line x1="${i * 31}" y1="0" x2="${i * 31 - 60}" y2="360" stroke="#8fa3b8" stroke-width="1" opacity="0.35"/>`).join('') + '<circle cx="320" cy="200" r="90" fill="#E8A838" opacity="0.12"/>',
  muelle: '<rect width="640" height="360" fill="#9AA4AE"/><rect y="170" width="640" height="80" fill="#2B4C7E"/><rect y="250" width="640" height="110" fill="#4A4038"/>',
  negro: '<rect width="640" height="360" fill="#0d0806"/>',
};
const COLOR_PERSONA: Record<string, string> = { Ernesto: '#B83E33', Tomás: '#2B4C7E', Nieves: '#E8A838', 'Don Julián': '#5B7A3D' };

function silueta(v: Visto): string {
  const x = v.region.x * 640, y = v.region.y * 360, w = v.region.w * 640, h = v.region.h * 360;
  const c = COLOR_PERSONA[v.nombre] ?? '#8F7868';
  const rc = Math.min(w * 0.22, h * 0.13);
  return `<g stroke="#FAF7F0" stroke-width="1.5"><circle cx="${x + w / 2}" cy="${y + rc + 2}" r="${rc}" fill="${c}"/><path d="M${x + w * 0.12} ${y + h} Q${x + w * 0.14} ${y + rc * 2.6} ${x + w / 2} ${y + rc * 2.4} Q${x + w * 0.86} ${y + rc * 2.6} ${x + w * 0.88} ${y + h} Z" fill="${c}"/></g>`;
}
function objeto(v: Visto): string {
  const x = v.region.x * 640, y = v.region.y * 360, w = v.region.w * 640, h = v.region.h * 360;
  if (/reloj/i.test(v.nombre)) return `<g fill="#E8A838" stroke="#FAF7F0" stroke-width="1.5"><path d="M${x + w * 0.2} ${y + h * 0.08} H${x + w * 0.8} L${x + w * 0.5} ${y + h / 2} Z"/><path d="M${x + w * 0.2} ${y + h * 0.92} H${x + w * 0.8} L${x + w * 0.5} ${y + h / 2} Z"/></g>`;
  if (/té/i.test(v.nombre)) return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2.4}" fill="#FAF7F0" stroke="#4A2E1A" stroke-width="2"/><circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) / 4}" fill="#8F7868"/>`;
  if (/cuaderno|libro/i.test(v.nombre)) return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#2B4C7E" stroke="#FAF7F0" stroke-width="2"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#FAF7F0" opacity="0.85" stroke="#4A2E1A"/>`;
}

function fotogramaSvg(e: EscenaInventada, p: PlanoInventado): string {
  const texto = p.textoEnPantalla ? `<text x="320" y="330" text-anchor="middle" font-family="Georgia, serif" font-size="15" letter-spacing="3" fill="#FAF7F0">${xml(p.textoEnPantalla)}</text>` : '';
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">${FONDOS[e.fondo]}${(p.objetos ?? []).map(objeto).join('')}${(p.personas ?? []).map(silueta).join('')}${texto}</svg>`)}`;
}

function figurasPelicula(): FiguraVista[] {
  return PLANOS.map((p, i) => {
    const t = Math.round((p.t0 + Math.min(1, (p.t1 - p.t0) / 2)) * 10) / 10;
    return {
      id: `fot-${p.id}`, unidad: unidadEnTiempo(t) - 1, imagenUrl: fotogramaSvg(p.escena, p), descripcion: p.descripcion,
      ancla: { tipo: 'tiempo', t0: t, t1: t }, etiqueta: anclaACita({ tipo: 'tiempo', t0: t, t1: t }), t, escena: i === 0 || PLANOS[i - 1]!.escena.id !== p.escena.id,
    };
  });
}

// ---------------------------------------------------------------------------
// La relación de adaptación y sus alineaciones
// ---------------------------------------------------------------------------

const ID_RELACION = 'r-arena-mirlo';

function ladoPelicula(escena: string, literal?: string): LadoAlineacion {
  const e = ESCENAS.find((x) => x.id === escena)!;
  const d = literal ? enDialogo(literal) : null;
  return { documento: ID_PELICULA, ancla: d?.ancla ?? { tipo: 'tiempo', t0: e.t0, t1: e.t1 }, ...(d ? {} : { anclaFin: { tipo: 'tiempo', t0: e.t1, t1: e.t1 } }), segmento: sid(ID_PELICULA, escena) };
}
function ladoCuento(desde: number, literal: string, hasta?: number): LadoAlineacion {
  const e = ESCENAS_CUENTO.find((x) => desde >= x.desde && desde <= x.hasta);
  return { documento: ID_CUENTO, ancla: enPagina(desde, literal), ...(hasta && hasta !== desde ? { anclaFin: anclaDe(CUENTO, hasta) } : {}), ...(e ? { segmento: sid(ID_CUENTO, e.id) } : {}) };
}

const ALINEACIONES: Array<[TipoCorrespondencia, LadoAlineacion | undefined, LadoAlineacion | undefined, string]> = [
  ['anadido', ladoPelicula('es1'), undefined, 'La película abre en el muelle, el espacio de la despedida, con los títulos de crédito y el bolero: el final queda anunciado antes de que aparezcan los personajes. El cuento empieza directamente en El Mirlo.'],
  ['equivalente', ladoPelicula('es2'), ladoCuento(1, 'La primera vez que vi a Ernesto Valdivia fue en la terraza de El Mirlo', 2), 'Los mismos hechos: el té con canela, la frase de las vigas y el préstamo del «Cuaderno de bajamar». Lo que el narrador juzga desde dentro («uno de esos viejos que hablan con cualquiera») la película lo da en la composición: Ernesto domina el encuadre y Tomás queda al fondo, desenfocado.'],
  ['condensado', ladoPelicula('es3'), ladoCuento(3, 'Ernesto estaba en la misma mesa, como si no se hubiera movido en veinticuatro horas.'), 'Una página del cuento en tres planos. Se pierde la mirada de Don Julián al final («una cara que entonces no supe leer»), que en el relato anticipa la sospecha; la película la desplaza a Nieves.'],
  ['ampliado', ladoPelicula('es4'), ladoCuento(4, 'Las estanterías llegaban hasta el techo y no seguían ningún orden que yo pudiera entender'), 'La enumeración de estanterías se vuelve un travelling largo por la librería hasta la trastienda, que la cámara presenta como un refugio.'],
  ['equivalente', ladoPelicula('es5', 'Media hora exacta. Ninguna conversación seria debería durar más.'), ladoCuento(5, '—Media hora exacta —me dijo la primera tarde—. Ninguna conversación seria debería durar más.'), 'La escena más fiel: conserva la regla de la media hora y el regalo de alguien que ya no está en la isla. Añade dos insertos del reloj que enmarcan la conversación.'],
  ['transformado', ladoPelicula('es6', 'En este barrio todo se sabe, chico. Y lo que no se sabe, se inventa.'), ladoCuento(6, '—Tomás, no te conviene que te vean tanto con el librero.'), 'Rafa desaparece y su aviso pasa a Nieves, una vecina inventada para la película. La sospecha deja de ser un rumor sin nombre («la gente dice cosas») y se dice en voz alta, con ironía.'],
  ['suprimido', undefined, ladoCuento(6, 'Mis notas mejoraron, quizá porque estudiaba menos y entendía más'), 'El progreso de Tomás en la facultad, que el cuento cuenta en una frase irónica, no tiene lugar en la película.'],
  ['anadido', ladoPelicula('es7'), undefined, 'El baile en la azotea no está en el cuento: el bolero de los créditos vuelve como música diegética y Tomás aprende de otra maestra a hacer mal las cosas.'],
  ['equivalente', ladoPelicula('es8', 'Hoy no le damos la vuelta. La lluvia lleva la cuenta por nosotros.'), ladoCuento(7, '—Hoy no hace falta —dijo—. La lluvia ya cuenta el tiempo por nosotros.'), 'La lluvia sustituye al reloj como medida del tiempo, con una réplica casi literal.'],
  ['transformado', ladoPelicula('es9', 'Me enseñó a leer en voz baja. Era la única forma de leer juntos sin que nos oyeran.'), ladoCuento(8, 'Me contó que a mi edad había querido ser marino'), 'La analepsis del cuento, en estilo indirecto, pasa al estilo directo y a un único plano que se cierra sobre Ernesto, sin flashback: la confidencia se oye en su voz, no en la del narrador.'],
  ['alusion', ladoPelicula('es3', 'A los que leen bajito no les cobro.'), ladoCuento(8, 'esa persona le había enseñado a leer en voz baja'), 'La película adelanta la lectura en voz baja al primer encuentro; el espectador la reconoce en la confidencia. En el cuento el eco lo hace el lector entre las pp. 2 y 8.'],
  ['condensado', ladoPelicula('es10'), ladoCuento(9, 'Cada jueves Ernesto me prestaba un libro'), 'La frecuencia iterativa («cada jueves») se resuelve en un montaje de encadenados con la única voz en off de la película. La canela negada se ve en un plano.'],
  ['equivalente', ladoPelicula('es11', 'Lo derriban en primavera. Un aparcamiento para el muelle nuevo.'), ladoCuento(10, 'El local se derribaba en primavera; había un proyecto de aparcamiento para el muelle nuevo.'), 'Casi frase por frase; la película añade el inserto de la carta para que se lea lo que el narrador lee.'],
  ['transformado', ladoPelicula('es12'), ladoCuento(11, 'Pasé las últimas semanas sacando libros a escondidas'), 'Los libros que Tomás saca a escondidas («Ernesto hacía como que no me veía») se convierten en un regalo explícito, en cajas a la vista: lo callado pasa a decirse.'],
  ['equivalente', ladoPelicula('es13', 'Para usted. Así no tendrá que pedirle a nadie media hora.'), ladoCuento(11, '—Para usted —me dijo—. Así no tendrá que pedirle a nadie media hora.'), 'La entrega del paquete con la frase de la media hora. Por primera vez Tomás domina el encuadre, en contrapicado.'],
  ['transformado', ladoPelicula('es14'), ladoCuento(12, 'Puse el reloj sobre la mesa. No le di la vuelta.'), 'El final cambia de signo. En el cuento Tomás no da la vuelta al reloj y la conversación queda en suspenso; en la película se la da, en plano detalle, y ocupa la mesa de Ernesto: el motivo pasa de la suspensión a la continuidad.'],
];

function alineaciones(): Alineacion[] {
  return ALINEACIONES.map(([tipo, a, b, nota], i) => ({ id: `al-${i + 1}`, relacion: ID_RELACION, orden: i, tipo, ...(a ? { a } : {}), ...(b ? { b } : {}), nota, confianza: tipo === 'alusion' ? 0.62 : 0.86 }));
}

let confirmada = false;

function relacion(): Relacion & { ficha: Ficha } {
  const creditos = PLANOS.find((p) => p.id === 'es1pl3')!;
  const plano = (id: string) => PLANOS.find((p) => p.id === id)!;
  // Las pruebas de la ficha: A es la película (origen) y B el cuento (destino); los cambios las citan por índice.
  const evidencias: Evidencia[] = [
    evPlano(plano('es2pl4'), { nombre: 'Ernesto', region: { x: 0.5, y: 0.06, w: 0.42, h: 0.92 } }, 'Ernesto domina el encuadre en primer término'), // 0 A
    evTexto(2, 'Pensé que era uno de esos viejos que hablan con cualquiera'), // 1 B
    evDialogo('En este barrio todo se sabe, chico. Y lo que no se sabe, se inventa.'), // 2 A
    evTexto(6, '—Tomás, no te conviene que te vean tanto con el librero.'), // 3 B
    evDialogo('Volví porque alguien me esperaba en el muelle.'), // 4 A
    evTexto(8, 'Me contó que en el puerto de vuelta lo esperaba una persona a la que nunca nombró'), // 5 B
    evPlano(plano('es14pl3'), undefined, 'Tomás da la vuelta al reloj de arena'), // 6 A
    evTexto(12, 'Puse el reloj sobre la mesa. No le di la vuelta.'), // 7 B
    evPlano(plano('es7pl1'), { nombre: 'Nieves', region: { x: 0.44, y: 0.12, w: 0.18, h: 0.84 } }, 'Nieves y Tomás bailan en la azotea'), // 8 A
    evPlano(plano('es13pl3'), { nombre: 'Tomás', region: { x: 0.08, y: 0.06, w: 0.4, h: 0.92 } }, 'Tomás domina el encuadre en primer término'), // 9 A
    evTexto(11, '—Para usted —me dijo—. Así no tendrá que pedirle a nadie media hora.'), // 10 B
  ];
  const conteo: Partial<Record<TipoCorrespondencia, number>> = {};
  for (const [t] of ALINEACIONES) conteo[t] = (conteo[t] ?? 0) + 1;
  return {
    id: ID_RELACION, origen: ID_PELICULA, destino: ID_CUENTO, tipo: 'adaptacion_de', nota: 'La autora del cuento coescribe el guion.', confianza: 0.97,
    fuente: confirmada ? 'usuario' : 'modelo', creada: CREADA,
    evidencias: [evPlano(creditos, undefined, 'Texto en pantalla: «SEGÚN UN CUENTO DE ADELA SORNÍ»'), evTexto(1, 'La primera vez que vi a Ernesto Valdivia')],
    ficha: ficha({
      id: `${ID_RELACION}:fi`, documento: null, objetivo: 'relacion', objetivoId: ID_RELACION, lente: 'cine', clase: 'adaptacion',
      texto: 'La película conserva el armazón del cuento (cinco de sus once escenas pasan casi intactas) y cambia el modo de contarlo: la voz retrospectiva de Tomás desaparece y su juicio sobre Ernesto se convierte en decisiones de puesta en cuadro. Las supresiones (Rafa, las notas de la facultad) y los añadidos (el prólogo en el muelle, Nieves, el baile) desplazan la sospecha del barrio de un rumor sin nombre a un personaje que la dice. El cambio de sentido más hondo está en el final: el reloj que el cuento deja quieto, la película lo pone a contar.',
      datos: {
        relacion: { tipo: 'adaptacion_de', origen: ID_PELICULA, destino: ID_CUENTO }, titulo: 'Arena en los bolsillos y Las tardes del Mirlo',
        modo: 'Transposición fiel en la estructura que transfocaliza el relato: la voz del narrador pasa a la puesta en cuadro.',
        resumen: { es: 'Adaptación que conserva la estructura, sustituye la voz narradora por la puesta en cuadro e invierte el sentido del reloj al final.', en: 'An adaptation that keeps the structure, turns the narrating voice into mise-en-scène and reverses the meaning of the hourglass at the end.' },
        cambios: [
          { aspecto: 'estructura', afirmacion: 'Conserva las cinco grandes partes del cuento (encuentro, librería, tormenta, cierre y despedida) y les añade un prólogo en el muelle.', pruebas: { a: [], b: [] }, inferido: true },
          { aspecto: 'punto_de_vista', afirmacion: 'El juicio del narrador sobre Ernesto se convierte en composición: Ernesto domina el encuadre y Tomás queda al fondo, desenfocado.', pruebas: { a: [0], b: [1] } },
          { aspecto: 'personajes', afirmacion: 'El aviso de Rafa pasa a Nieves, una vecina que dice en voz alta lo que el cuento deja en rumor.', pruebas: { a: [2], b: [3] } },
          { aspecto: 'tiempo', afirmacion: 'La analepsis de la juventud de Ernesto pasa al estilo directo, sin flashback.', pruebas: { a: [4], b: [5] } },
          { aspecto: 'final', afirmacion: 'El reloj que el cuento deja quieto, la película lo pone a contar: Tomás le da la vuelta.', pruebas: { a: [6], b: [7] } },
          { aspecto: 'medio', afirmacion: 'La despedida se dice con la cámara: por primera vez Tomás domina el encuadre, en contrapicado.', pruebas: { a: [9], b: [10] } },
        ],
        personajes: [
          { nombre: 'Nieves', cambio: 'anadido', nota: 'Vecina de la azotea; pone voz a la sospecha y enseña a Tomás a bailar.', pruebas: { a: [8], b: [] } },
          { nombre: 'Rafa', cambio: 'suprimido', nota: 'Su aviso pasa a Nieves.', pruebas: { a: [], b: [3] } },
          { nombre: 'Ernesto Valdivia', cambio: 'conservado', nota: 'Mismo papel; su confidencia se oye en su voz.', pruebas: { a: [4], b: [5] } },
          { nombre: 'Don Julián', cambio: 'ampliado', nota: 'Su gesto con la canela se ve en un plano.', pruebas: { a: [], b: [] } },
        ],
        conteo, alineaciones: ALINEACIONES.length,
      },
      evidencias,
    }),
  };
}

// ---------------------------------------------------------------------------
// La comprensión de los demás documentos (simulada, solo la estructura)
// ---------------------------------------------------------------------------

const LENTE_DE: Record<string, Lente> = {
  'd-quijote': 'narrativa', 'd-marianela': 'narrativa', 'd-panoptico': 'ensayo', 'd-consolatio': 'ensayo', 'd-rimas': 'poesia',
  'd-vida-sueno': 'teatro', 'd-rice': 'documental', 'd-larra': 'periodismo', 'd-origen': 'cientifico',
};
const SEGMENTO_DE: Record<Lente, TipoSegmento> = {
  narrativa: 'capitulo', poesia: 'poema', teatro: 'escena', cine: 'escena', documental: 'bloque', periodismo: 'apartado', entrevista: 'bloque', podcast: 'bloque',
  clase: 'tema', ensayo: 'apartado', cientifico: 'apartado', archivo: 'folio', juridico: 'articulo', datos: 'tabla', presentacion: 'diapositiva', general: 'apartado',
};

/** Resúmenes propios (paráfrasis de la demo) de la jornada primera de «La vida es sueño». */
const RESUMENES_VIDA: Record<string, string> = {
  'Escena primera': 'Rosaura, vestida de hombre, y Clarín llegan perdidos a un monte de Polonia y descubren una torre.',
  'Escena II': 'Segismundo, encadenado en la torre, se lamenta de su falta de libertad; Rosaura lo escucha y él la amenaza y luego se rinde a su presencia.',
  'Escena III': 'Clotaldo, el alcaide, sorprende a los intrusos y ordena prenderlos.',
};

export interface EstadoDemo { estado: EstadoComprensionVista; segmentos: Segmento[]; fichas: Ficha[]; apariciones: AparicionVista[] }

function estadoHecho(documento: string, lentes: Lente[], usd: number, lotes: number, desde: string): EstadoComprensionVista {
  const pasos: EstadoComprensionVista['pasos'] = { estructura: { hecho: desde, ms: 41_000, usd: usd * 0.12, detalle: { lotes } } };
  for (let i = 0; i < lotes; i++) pasos[`fichas:${i}`] = { hecho: desde, ms: 62_000, usd: (usd * 0.55) / lotes };
  pasos.entidades = { hecho: desde, ms: 48_000, usd: usd * 0.13 };
  pasos.global = { hecho: desde, ms: 71_000, usd: usd * 0.18 };
  pasos.indexado = { hecho: desde, ms: 9_000, usd: usd * 0.02 };
  return { documento, estado: 'hecho', lentes, version: 'comprension@2', pasos, usd, tokensEntrada: Math.round(usd * 1_400_000), tokensSalida: Math.round(usd * 90_000), llamadas: lotes + 6, avisos: [], modelo: MODELO, iniciado: desde, actualizado: desde };
}

function estructuraSimulada(d: DocDemo, lente: Lente): { segmentos: Segmento[]; fichas: Ficha[] } {
  const tipo = SEGMENTO_DE[lente];
  const segmentos: Segmento[] = d.secciones.map((s, i) => {
    const fin = (d.secciones[i + 1]?.unidad ?? d.unidades + 1) - 1;
    return {
      id: `${d.id}:s:${i}`, documento: d.id, padre: null, nivel: 1, orden: i, tipo, titulo: s.titulo, ancla: anclaDe(d, s.unidad), ...(fin > s.unidad ? { anclaFin: anclaDe(d, fin) } : {}),
      unidadDesde: `u-${d.id}-${s.unidad}`, unidadHasta: `u-${d.id}-${Math.max(s.unidad, fin)}`, ...(d.id === 'd-vida-sueno' && RESUMENES_VIDA[s.titulo] ? { resumen: RESUMENES_VIDA[s.titulo] } : {}),
      origen: 'leido', confianza: 0.95,
    };
  });
  const vida = d.id === 'd-vida-sueno';
  const global = ficha({
    id: `${d.id}:fi:global:${lente}`, documento: d.id, objetivo: 'documento', objetivoId: d.id, lente, clase: 'global',
    texto: vida
      ? 'La grabación recoge el arranque de la comedia: la llegada de Rosaura y Clarín al monte, el lamento de Segismundo encadenado y la irrupción de Clotaldo. La jornada plantea en pocas escenas los dos ejes de la obra, la libertad negada y el destino que se intenta burlar, y los encarna en un espacio, la torre, que es a la vez cárcel y sepultura.'
      : 'Comprensión de demostración: en esta demo solo se rehace la estructura a partir del índice del documento. La ficha completa, con sinopsis, temas, motivos y apariciones, se ve en «Las tardes del Mirlo» y en «Arena en los bolsillos».',
    datos: vida
      ? { sinopsis: 'Rosaura y Clarín, perdidos en un monte, descubren la torre donde vive encadenado Segismundo. Lo oyen lamentarse de su falta de libertad; él los descubre, amenaza a Rosaura y se rinde ante ella. Clotaldo, el alcaide, llega con sus guardas y los prende.', temas: [{ nombre: 'La libertad', descripcion: 'La que Segismundo reclama frente a la naturaleza.' }, { nombre: 'El destino', descripcion: 'El encierro como intento de burlarlo.' }], motivos: [{ nombre: 'La torre', descripcion: 'Cárcel y sepultura a la vez.' }], resumen: { es: 'Arranque de la comedia: la torre, el lamento de Segismundo y Clotaldo.' } }
      : { sinopsis: '', temas: [], motivos: [], resumen: { es: 'Estructura del documento, desde su índice.' } },
    evidencias: [],
  });
  return { segmentos, fichas: [global] };
}

// ---------------------------------------------------------------------------
// Las rutas
// ---------------------------------------------------------------------------

type Ruta = (metodo: string, patron: string, fn: (m: RegExpMatchArray, cuerpo: any, q: URLSearchParams) => Promise<Response> | Response) => void;
interface Ayudas {
  ruta: Ruta;
  json: (cuerpo: unknown, ms?: number, estado?: number) => Promise<Response>;
  error: (estado: number, codigo: string, mensaje: string) => Promise<Response>;
  emitir: (e: EventoTiempoReal) => void;
  documento: (id: string) => DocDemo | undefined;
}

/** Estado de una relación de la demo: la relación, sus alineaciones y cómo va su alineación. */
interface RelacionDemo { r: Relacion & { ficha?: Ficha }; als: Alineacion[]; estado?: EstadoAlineacionVista; confirmada: boolean }

const estados = new Map<string, EstadoDemo>();
let preparado = false;
function preparar() {
  if (preparado) return;
  preparado = true;
  const sp = segmentosPelicula(), sc = segmentosCuento();
  estados.set(ID_PELICULA, { estado: estadoHecho(ID_PELICULA, ['cine'], 0.62, 3, '2026-10-22T09:14:00Z'), segmentos: sp, fichas: fichasPelicula(), apariciones: aparicionesPelicula() });
  estados.set(ID_CUENTO, { estado: estadoHecho(ID_CUENTO, ['narrativa'], 0.21, 2, '2026-10-22T08:51:00Z'), segmentos: sc, fichas: fichasCuento(), apariciones: aparicionesCuento(sc) });
}

/**
 * La prueba visual de la película para una investigación de la demo: el plano que
 * mejor responde (el reloj al final, o el encuentro), con su fotograma y la región.
 */
export function pruebaVisualInventada(pregunta: string): Omit<EvidenciaInvestigacion, 'id' | 'herramienta' | 'capa' | 'citaCorta'> {
  const final = /reloj|arena|final|vuelta|termina/i.test(pregunta);
  const p = PLANOS.find((x) => x.id === (final ? 'es14pl3' : 'es2pl4'))!;
  const v = [...(p.personas ?? []), ...(p.objetos ?? [])][0];
  const instante = Math.round(((p.t0 + p.t1) / 2) * 10) / 10;
  const ancla: AnclaMaterial = { tipo: 'tiempo', t0: p.t0, t1: p.t1, instante, ...(v ? { region: v.region } : {}) };
  const i = PLANOS.indexOf(p);
  return {
    documento: ID_PELICULA, titulo: PELICULA.meta.titulo, ancla, modo: 'video', cita: `${p.escala.charAt(0).toUpperCase()}${p.escala.slice(1)}: ${p.descripcion.charAt(0).toLowerCase()}${p.descripcion.slice(1)}`,
    unidad: `u-${ID_PELICULA}-${unidadEnTiempo(instante)}`, etiqueta: anclaACita({ tipo: 'tiempo', t0: instante, t1: instante }), idioma: 'es', orden: unidadEnTiempo(instante) - 1,
    imagenUrl: figurasPelicula()[i]!.imagenUrl,
    nota: final ? 'Tomás da la vuelta al reloj en plano detalle: en el cuento no se la da' : 'Ernesto domina el encuadre en primer término y Tomás queda al fondo, desenfocado',
  };
}

/** Los fotogramas de la película inventada (para `/documentos/:id/figuras`). */
export function figurasInventadas(id: string): FiguraVista[] | null {
  return id === ID_PELICULA ? figurasPelicula() : null;
}

/** Las menciones de las entidades inventadas, para el grafo de la demo: [documento, orden, contexto con ⟦⟧]. */
export function mencionesInventadas(): Array<{ id: string; nombre: string; tipo: 'persona' | 'lugar' | 'obra' | 'concepto'; descripcion: string; alias: string[]; en: Array<[string, number, string]> }> {
  preparar();
  return ENTIDADES_INVENTADAS.map((e) => {
    const en: Array<[string, number, string]> = [];
    for (const [doc, d] of [[ID_CUENTO, CUENTO], [ID_PELICULA, PELICULA]] as const) {
      for (const a of estados.get(doc)!.apariciones) {
        if (a.entidad !== e.id || (a.rol !== 'nombrado' && a.rol !== 'citado') || !a.ancla.caracteres) continue;
        const orden = a.ancla.tipo === 'pagina' ? a.ancla.fisica : PELICULA.pasajes.findIndex((_, i) => { const x = anclaDe(PELICULA, i + 1); return x.tipo === 'tiempo' && a.ancla.tipo === 'tiempo' && x.t0 === a.ancla.t0; }) + 1;
        const t = Array.from(textoDe(d, orden).replace(/\*\*([^*]+):\*\*/g, (m) => ' '.repeat(Array.from(m).length)));
        const [i, j] = a.ancla.caracteres;
        en.push([doc, orden, `${t.slice(Math.max(0, i - 40), i).join('').trimStart()}⟦${t.slice(i, j).join('')}⟧${t.slice(j, j + 40).join('').trimEnd()}`]);
        if (en.filter((x) => x[0] === doc).length >= 6) break;
      }
    }
    return { id: e.id, nombre: e.nombre, tipo: e.tipo, descripcion: e.descripcion, alias: e.formas.filter((f) => f !== e.nombre), en };
  }).filter((e) => e.en.length);
}

export function registrarComprension(h: Ayudas): void {
  preparar();
  const { ruta, json, error, emitir } = h;
  const mapa = (id: string): MapaComprension => {
    const e = estados.get(id);
    if (!e) return { documento: id, estado: null, lentes: [], segmentos: [], global: [], totales: { segmentos: 0, planos: 0, fichas: 0, apariciones: 0, entidades: 0 } };
    return {
      documento: id, estado: e.estado, lentes: e.estado.lentes, segmentos: e.segmentos.filter((s) => s.tipo !== 'plano'), global: e.fichas.filter((f) => f.clase === 'global'),
      totales: {
        segmentos: e.segmentos.length, planos: e.segmentos.filter((s) => s.tipo === 'plano').length, fichas: e.fichas.filter((f) => f.documento === id).length,
        apariciones: e.apariciones.length, entidades: new Set(e.apariciones.map((a) => a.entidad)).size,
      },
    };
  };
  const existe = (id: string) => !!h.documento(id);

  ruta('GET', '/documentos/:id/comprension', (m) => (existe(m[1]!) ? json(mapa(m[1]!)) : error(404, 'no_encontrado', 'El documento no existe.')));
  ruta('GET', '/documentos/:id/segmentos', (m, _c, q) => {
    const e = estados.get(m[1]!);
    const tipo = q.get('tipo'), nivel = Number(q.get('nivel') ?? 0);
    return json((e?.segmentos ?? []).filter((s) => (!tipo || s.tipo === tipo) && (!nivel || s.nivel <= nivel)));
  });
  ruta('GET', '/documentos/:id/fichas', (m, _c, q) => {
    const id = m[1]!;
    const e = estados.get(id);
    const todas = [...(e?.fichas ?? []), ...(id === ID_PELICULA || id === ID_CUENTO ? [relacion().ficha] : [])];
    const clase = q.get('clase'), objetivo = q.get('objetivo'), lente = q.get('lente'), seg = q.get('segmento') ?? q.get('entidad');
    const lista = todas.filter((f) => (!clase || f.clase === clase) && (!objetivo || f.objetivo === objetivo) && (!lente || f.lente === lente) && (!seg || f.objetivoId === seg) && (f.documento === id || (f.documento === null && !!seg)));
    const desde = Number(q.get('desde') ?? 0), limite = Number(q.get('limite') ?? 200);
    return json({ elementos: lista.slice(desde, desde + limite), total: lista.length, ...(desde + limite < lista.length ? { siguiente: String(desde + limite) } : {}) });
  });
  ruta('GET', '/documentos/:id/apariciones', (m, _c, q) => {
    const e = estados.get(m[1]!);
    const ent = q.get('entidad'), seg = q.get('segmento'), rol = q.get('rol');
    const lista = (e?.apariciones ?? []).filter((a) => (!ent || a.entidad === ent) && (!seg || a.segmento === seg) && (!rol || a.rol === rol));
    const desde = Number(q.get('desde') ?? 0), limite = Number(q.get('limite') ?? 500);
    return json({ elementos: lista.slice(desde, desde + limite), total: lista.length, ...(desde + limite < lista.length ? { siguiente: String(desde + limite) } : {}) });
  });
  ruta('GET', '/comprension', () => json([...estados.values()].map((e) => e.estado).sort((a, b) => b.actualizado.localeCompare(a.actualizado))));
  /** Lanza la comprensión simulada de un documento (o dice que ya está hecha o en marcha). */
  const comprender = (id: string, c: { forzar?: boolean; lentes?: Lente[] } = {}): { estado: 'hecho' | 'en_marcha'; instancia: string | null } | null => {
    const d = h.documento(id);
    if (!d) return null;
    const previo = estados.get(id);
    if (previo?.estado.estado === 'hecho' && !c.forzar) return { estado: 'hecho', instancia: null };
    if (previo?.estado.estado === 'en_marcha') return { estado: 'en_marcha', instancia: `demo-${id}` };
    const inventada = id === ID_PELICULA || id === ID_CUENTO;
    const lente = c.lentes?.[0] ?? (inventada ? previo!.estado.lentes[0]! : LENTE_DE[id] ?? 'general');
    const ahora = new Date().toISOString();
    const vacio: EstadoComprensionVista = { documento: id, estado: 'en_marcha', lentes: [lente], version: 'comprension@2', pasos: {}, usd: 0, tokensEntrada: 0, tokensSalida: 0, llamadas: 0, avisos: [], iniciado: ahora, actualizado: ahora, modelo: MODELO };
    const guardado = previo;
    estados.set(id, { estado: vacio, segmentos: inventada ? guardado!.segmentos : [], fichas: inventada ? guardado!.fichas.filter((f) => f.clase !== 'global') : [], apariciones: inventada ? guardado!.apariciones : [] });
    const pasos: Array<[string, number, string, number]> = [
      ['estructura', 0.15, 'Leyendo la estructura de la obra', 1400], ['fichas', 0.4, 'Fichas: tanda 1 de 2', 1500], ['fichas', 0.6, 'Fichas: tanda 2 de 2', 1500],
      ['entidades', 0.62, 'Reconociendo personajes, lugares, obras y motivos', 1200], ['personajes', 0.7, 'Analizando los personajes y los motivos principales', 1300],
      ['global', 0.75, 'Escribiendo la ficha global de la obra', 1600], ['indexado', 0.92, 'Indexando las fichas para la búsqueda', 900],
    ];
    let espera = 300;
    for (const [paso, avance, mensaje, ms] of pasos) {
      espera += ms;
      setTimeout(() => {
        const x = estados.get(id);
        if (!x) return;
        const n = Object.keys(x.estado.pasos).filter((k) => k.startsWith('fichas')).length;
        const clave = paso === 'fichas' ? `fichas:${n}` : paso;
        x.estado = { ...x.estado, pasos: { ...x.estado.pasos, [clave]: { hecho: new Date().toISOString(), ms, usd: 0.004, ...(paso === 'estructura' ? { detalle: { lotes: 2 } } : {}) } }, actualizado: new Date().toISOString() };
        if (paso === 'estructura' && !inventada) x.segmentos = estructuraSimulada(d, lente).segmentos;
        emitir({ tipo: 'comprension', documento: id, paso, avance, mensaje, estado: 'en_marcha' });
      }, espera);
    }
    setTimeout(() => {
      const x = estados.get(id);
      if (!x) return;
      if (inventada) { x.estado = { ...guardado!.estado, actualizado: new Date().toISOString() }; x.fichas = guardado!.fichas; }
      else {
        const s = estructuraSimulada(d, lente); x.segmentos = s.segmentos; x.fichas = s.fichas;
        x.estado = { ...estadoHecho(id, [lente], 0.03, 2, new Date().toISOString()), avisos: ['Demostración: solo se ha rehecho la estructura desde el índice.', 'Los vectores de las fichas no llegaron al índice: se buscan por texto y se reenviarán.'] };
      }
      emitir({ tipo: 'comprension', documento: id, paso: 'fin', avance: 1, mensaje: 'Comprensión terminada', estado: 'hecho' });
    }, espera + 700);
    return { estado: 'en_marcha', instancia: `demo-${id}` };
  };
  ruta('POST', '/comprension/biblioteca', (_m, c: { documentos?: string[]; forzar?: boolean; lentes?: Lente[] }) => {
    const ids = (c.documentos ?? []).filter((id) => h.documento(id) && (estados.get(id)?.estado.estado !== 'hecho' || c.forzar));
    // Como la API: unos pocos a la vez; el resto, en cola (aquí, escalonados).
    ids.forEach((id, i) => setTimeout(() => comprender(id, c), Math.floor(i / 2) * 9000));
    return json({ encolados: ids.length, lanzados: Math.min(2, ids.length) }, 200, 202);
  });
  ruta('POST', '/documentos/:id/comprender', (m, c: { forzar?: boolean; lentes?: Lente[] }) => {
    const r = comprender(m[1]!, c);
    return r ? json({ documento: m[1], ...r }, 200, 202) : error(404, 'no_encontrado', 'El documento no existe.');
  });

  // Relaciones y alineaciones (contrato de transmedia): la inventada y las que se pongan a mano.
  const relaciones = new Map<string, RelacionDemo>();
  const inventada = relacion();
  relaciones.set(ID_RELACION, { r: inventada, als: alineaciones(), confirmada: false, estado: { estado: 'hecho', alineaciones: ALINEACIONES.length, usd: 0.38, avisos: [], actualizado: CREADA, hechos: 6, total: 6 } });
  const obra = (id: string) => {
    const d = h.documento(id)!;
    return { id: d.id, titulo: d.meta.titulo, autores: d.meta.autores.map((x) => `${x.nombre} ${x.apellidos}`.trim()), ...(d.meta.anioOriginal ?? d.meta.anio ? { anio: (d.meta.anioOriginal ?? d.meta.anio)! } : {}), tipo: d.tipo };
  };
  const vista = (x: RelacionDemo, lado: string): RelacionVista => ({
    ...x.r, fuente: x.confirmada ? 'usuario' : x.r.fuente, sentido: lado === x.r.origen ? 'origen' : 'destino', alineaciones: x.als.length, confirmada: x.confirmada,
    ...(x.estado ? { estadoAlineacion: { ...x.estado, alineaciones: x.als.length } } : {}), otro: obra(lado === x.r.origen ? x.r.destino : x.r.origen),
  });
  const comprendido = (id: string) => estados.get(id)?.estado.estado === 'hecho';
  /** Alinea en la demo: avanza grupo a grupo; la inventada recupera sus correspondencias según avanza, las demás terminan sin ellas o con error. */
  const alinearDemo = (x: RelacionDemo) => {
    const total = x.r.id === ID_RELACION ? 6 : 4;
    const todas = x.r.id === ID_RELACION ? alineaciones() : [];
    x.als = [];
    x.estado = { estado: 'en_marcha', alineaciones: 0, usd: 0, avisos: [], actualizado: new Date().toISOString(), hechos: 0, total };
    for (let k = 1; k <= total; k++) {
      setTimeout(() => {
        if (!relaciones.has(x.r.id) || !x.estado) return;
        const falta = [x.r.origen, x.r.destino].find((id) => !comprendido(id));
        if (falta && k === 2) {
          x.estado = { ...x.estado, estado: 'error', hechos: 1, error: `Falta comprender «${h.documento(falta)?.meta.titulo ?? falta}»: la alineación necesita la estructura de las dos obras.`, actualizado: new Date().toISOString() };
          return;
        }
        if (x.estado.estado !== 'en_marcha') return;
        x.als = todas.slice(0, Math.ceil((todas.length * k) / total));
        x.estado = { ...x.estado, hechos: k, usd: Math.round(0.065 * k * 100) / 100, actualizado: new Date().toISOString(), ...(k === total ? { estado: 'hecho' as const, avisos: todas.length ? [] : ['Demostración: las correspondencias solo están escritas para el cuento y la película inventados.'] } : {}) };
      }, k * 1400);
    }
  };
  const sinRelacion = () => error(404, 'no_encontrado', 'La relación no existe.');
  ruta('GET', '/documentos/:id/relaciones', (m) => {
    const id = m[1]!;
    if (!h.documento(id)) return error(404, 'no_encontrado', 'El documento no existe.');
    return json([...relaciones.values()].filter((x) => x.r.origen === id || x.r.destino === id).map((x) => vista(x, id)));
  });
  ruta('GET', '/relaciones/:id', (m) => { const x = relaciones.get(m[1]!); return x ? json(vista(x, x.r.origen)) : sinRelacion(); });
  ruta('GET', '/relaciones/:id/alineaciones', (m, _c, q) => {
    const x = relaciones.get(m[1]!);
    if (!x) return sinRelacion();
    const tipo = q.get('tipo');
    const lista = x.als.filter((y) => !tipo || y.tipo === tipo);
    const desde = Number(q.get('desde') ?? 0), limite = Number(q.get('limite') ?? 500);
    return json({ elementos: lista.slice(desde, desde + limite), total: lista.length, ...(desde + limite < lista.length ? { siguiente: String(desde + limite) } : {}) });
  });
  ruta('POST', '/relaciones', (_m, c: { origen?: string; destino?: string; tipo?: string; nota?: string }) => {
    if (!c.origen || !c.destino || !h.documento(c.origen) || !h.documento(c.destino)) return error(404, 'no_encontrado', 'El documento no existe.');
    if (c.origen === c.destino) return error(400, 'peticion_invalida', 'Una obra no se relaciona consigo misma.');
    const tipos = ['adaptacion_de', 'traduccion_de', 'edicion_de', 'version_de', 'cita_a', 'comenta_a', 'responde_a', 'parte_de', 'misma_obra', 'relacionado'];
    if (!c.tipo || !tipos.includes(c.tipo)) return error(400, 'peticion_invalida', `«tipo» admite: ${tipos.join(', ')}.`);
    if ([...relaciones.values()].some((x) => (x.r.origen === c.origen && x.r.destino === c.destino) || (x.r.origen === c.destino && x.r.destino === c.origen))) {
      return error(400, 'peticion_invalida', 'Esas dos obras ya están relacionadas.');
    }
    const id = `r-${Date.now().toString(36)}`;
    const x: RelacionDemo = { r: { id, origen: c.origen, destino: c.destino, tipo: c.tipo as Relacion['tipo'], ...(c.nota ? { nota: c.nota } : {}), evidencias: [], confianza: 1, fuente: 'usuario', creada: new Date().toISOString() }, als: [], confirmada: true };
    relaciones.set(id, x);
    return json(vista(x, x.r.origen), 120, 201);
  });
  ruta('POST', '/relaciones/:id/confirmar', (m) => { const x = relaciones.get(m[1]!); if (!x) return sinRelacion(); x.confirmada = true; if (x.r.id === ID_RELACION) confirmada = true; return json(vista(x, x.r.origen)); });
  ruta('DELETE', '/relaciones/:id', (m) => { if (!relaciones.delete(m[1]!)) return sinRelacion(); return json({ borrada: true }); });
  ruta('POST', '/documentos/:id/alinear', (m, c: { relacion?: string; forzar?: boolean }) => {
    const id = m[1]!;
    if (!h.documento(id)) return error(404, 'no_encontrado', 'El documento no existe.');
    const suyas = [...relaciones.values()].filter((x) => (x.r.origen === id || x.r.destino === id) && (!c.relacion || x.r.id === c.relacion));
    if (c.relacion && !suyas.length) return error(400, 'peticion_invalida', 'Esa relación no es de este documento.');
    for (const x of suyas) if (c.forzar || !x.estado || x.estado.estado === 'error') alinearDemo(x);
    return json({ instancia: `demo-alinear-${id}`, relaciones: suyas.length }, 150, 202);
  });
  ruta('POST', '/transmedia/biblioteca', () => json({ instancia: 'demo-transmedia', relaciones: relaciones.size }, 300, 202));
}

export { ID_RELACION };
