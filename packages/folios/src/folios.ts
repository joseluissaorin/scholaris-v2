/**
 * El folio de cada página: de los candidatos que ve el código a un `AnclaPagina`
 * por página física, con su origen y su confianza.
 *
 * 1. `extraerCandidatos`: números de la cabecera, el pie, los bordes del texto y
 *    lo que dijo el lector.
 * 2. `elegirSecuencia`: la cadena de lecturas más larga y coherente (fuera notas,
 *    años, capítulos y errores de OCR).
 * 3. (Opcional) `elegirConJuez`: las páginas dudosas se preguntan al juez en UNA
 *    petición con muchas preguntas, y se vuelve a elegir.
 * 4. Deducción por tramos: entre dos lecturas que cuadran, se interpola; si la
 *    numeración avanza menos que las páginas, las que sobran son láminas sin
 *    numerar; si avanza más, faltan hojas; antes de la primera y después de la
 *    última, se extrapola con confianza decreciente. La transición de romanos a
 *    arábigos, la portada y los marcadores salen del deductor portado de v3.
 *
 * Regla de oro: si no hay ninguna lectura en todo el libro, no se inventa la
 * numeración (origen «ninguno»): una cita solo imprime lo que se ha visto.
 */

import type { Juez, PreguntaJuez, RespuestaJuez } from '@scholaris/nucleo';
import { enParalelo } from '@scholaris/nucleo';
import { enteroARomano, extraerCandidatos, lineasUtiles, textoDeCandidato } from './candidatos.js';
import { DeductorPaginas, MARCADORES_FINALES, type Marcador } from './deductor.js';
import { elegirSecuencia, estimarPaso, type ResultadoSecuencia } from './secuencia.js';
import type { Candidato, Disposicion, FolioPagina, PaginaFolio, ResultadoFolios, TipoPagina } from './tipos.js';

export interface OpcionesFolios {
  /** Disposición de las páginas; por defecto se deduce de las lecturas. */
  disposicion?: Disposicion | 'auto';
  /** Libro foliado (número solo en el recto de cada hoja); por defecto se deduce. */
  foliacion?: boolean | 'auto';
  /** Margen por debajo del cual una decisión es dudosa y se pregunta al juez. */
  umbralDuda?: number;
  /**
   * Preguntas por llamada al juez (100 por defecto: cada lote lleva en el estado
   * solo sus páginas, ~140 tokens por página, por debajo del tope de ~28 000
   * tokens de estado del adaptador de Jev). Si hay más, los lotes van en paralelo.
   */
  preguntasPorLlamada?: number;
  /** Llamadas simultáneas al juez si hay que partir. */
  llamadasSimultaneas?: number;
  /**
   * Si no hay ninguna lectura, numerar igualmente como el v3 (1…N desde la
   * primera página con texto). Por defecto no: se devuelve «ninguno».
   */
  numerarSinLecturas?: boolean;
  registro?: (mensaje: string) => void;
}

interface Preparado {
  paginas: PaginaFolio[];
  candidatos: Candidato[][];
  paso: number;
  disposicion: Disposicion;
  foliacion: boolean;
  /** Páginas que el juez dijo que no llevan número. */
  sinNumero: Set<number>;
  avisos: string[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Folios sin juez: lógica pura, síncrona. */
export function deducirFolios(paginas: readonly PaginaFolio[], opciones: OpcionesFolios = {}): ResultadoFolios {
  const prep = preparar(paginas, opciones);
  const sec = elegirSecuencia(prep.candidatos, { paso: prep.paso });
  return ensamblar(prep, sec, opciones, { llamadas: 0, preguntas: 0 });
}

/**
 * Folios con juez: las páginas dudosas (varios candidatos con poco margen, una
 * lectura aislada que no cuadra con nadie, un número que parece mal leído) se
 * preguntan al juez en una sola petición por lotes, y se vuelve a calcular.
 */
export async function elegirConJuez(juez: Juez, paginas: readonly PaginaFolio[], opciones: OpcionesFolios = {}): Promise<ResultadoFolios> {
  const prep = preparar(paginas, opciones);
  let sec = elegirSecuencia(prep.candidatos, { paso: prep.paso });
  const previo = ensamblar(prep, sec, opciones, { llamadas: 0, preguntas: 0 });
  const dudosas = paginasDudosas(prep, sec, previo, opciones.umbralDuda ?? 0.75);
  if (!dudosas.length) return previo;

  const { preguntas, estado, opcionesPorPagina } = construirPreguntas(prep, previo, dudosas);
  const porLlamada = Math.max(1, opciones.preguntasPorLlamada ?? 100);
  const claves = Object.keys(preguntas);
  const lotes: string[][] = [];
  for (let i = 0; i < claves.length; i += porLlamada) lotes.push(claves.slice(i, i + porLlamada));
  const respuestas: Record<string, RespuestaJuez> = {};
  let fallos = 0;
  await enParalelo(lotes, opciones.llamadasSimultaneas ?? 4, async (lote) => {
    const sub: Record<string, PreguntaJuez> = {};
    const paginasLote: Record<string, unknown> = {};
    for (const k of lote) {
      sub[k] = preguntas[k] as PreguntaJuez;
      paginasLote[k] = (estado.paginas as Record<string, unknown>)[k];
    }
    try {
      Object.assign(respuestas, await juez.juzgar({ ...estado, paginas: paginasLote }, sub));
    } catch (e) {
      fallos++;
      opciones.registro?.(`El juez falló en un lote de ${lote.length} preguntas: ${(e as Error).message}`);
    }
  });
  if (fallos) prep.avisos.push(`El juez no respondió a ${fallos} de ${lotes.length} lotes: esas páginas se resolvieron solo con la secuencia.`);

  aplicarRespuestas(prep, respuestas, opcionesPorPagina);
  sec = elegirSecuencia(prep.candidatos, { paso: prep.paso });
  return ensamblar(prep, sec, opciones, { llamadas: lotes.length, preguntas: claves.length });
}

/** Con juez si se da, sin él si no. */
export function calcularFolios(paginas: readonly PaginaFolio[], opciones: OpcionesFolios & { juez?: Juez } = {}): Promise<ResultadoFolios> {
  return opciones.juez ? elegirConJuez(opciones.juez, paginas, opciones) : Promise.resolve(deducirFolios(paginas, opciones));
}

/** Solo el `AnclaPagina` de nucleo (sin candidatos ni explicaciones). */
export function aAncla(f: FolioPagina): import('@scholaris/nucleo').AnclaPagina {
  return { tipo: 'pagina', fisica: f.fisica, impresa: f.impresa, romana: f.romana, origen: f.origen, confianza: f.confianza };
}

// ---------------------------------------------------------------------------
// Preparación
// ---------------------------------------------------------------------------

function preparar(paginasEntrada: readonly PaginaFolio[], opciones: OpcionesFolios): Preparado {
  const paginas = [...paginasEntrada].sort((a, b) => a.fisica - b.fisica);
  const candidatos = paginas.map((p) => extraerCandidatos(p));
  const avisos: string[] = [];
  let disposicion: Disposicion = 'simple';
  let paso = 1;
  let foliacion = false;
  if (opciones.disposicion && opciones.disposicion !== 'auto') {
    disposicion = opciones.disposicion;
    paso = disposicion === 'simple' ? 1 : 2;
  }
  if (opciones.foliacion === true) {
    foliacion = true;
    paso = 0.5;
  }
  if ((!opciones.disposicion || opciones.disposicion === 'auto') && (opciones.foliacion === undefined || opciones.foliacion === 'auto')) {
    const est = estimarPaso(candidatos);
    paso = est.paso;
    if (paso === 2) disposicion = 'doble';
    if (paso === 0.5) foliacion = true;
  }
  if (paso === 2) {
    // En doble página, el candidato «12 … 13» manda sobre los sueltos.
    for (const cs of candidatos) for (const c of cs) if (c.derecha !== undefined) c.peso = Math.min(1, c.peso + 0.1);
  }
  return { paginas, candidatos, paso, disposicion, foliacion, sinNumero: new Set(), avisos };
}

// ---------------------------------------------------------------------------
// Ensamblado: de la cadena de lecturas al folio de cada página
// ---------------------------------------------------------------------------

interface Ancla {
  i: number;
  c: Candidato;
  apoyo: number;
}

function ensamblar(prep: Preparado, sec: ResultadoSecuencia, opciones: OpcionesFolios, juez: { llamadas: number; preguntas: number }): ResultadoFolios {
  const { paginas, candidatos, paso } = prep;
  const n = paginas.length;
  const avisos = [...prep.avisos];

  // Anclas: lecturas de la cadena. Una lectura aislada y débil no basta.
  let anclas: Ancla[] = [];
  sec.elegidos.forEach((el, i) => {
    if (el === null || el === undefined) return;
    const c = (candidatos[i] as Candidato[])[el] as Candidato;
    anclas.push({ i, c, apoyo: sec.apoyos[i] ?? 0 });
  });
  if (anclas.length > 1) {
    const fuertes = anclas.filter((a) => a.apoyo > 0 || a.c.peso >= 0.85 || a.c.fuente === 'juez');
    if (fuertes.length) anclas = fuertes;
  } else if (anclas.length === 1 && (anclas[0] as Ancla).c.peso < 0.85) {
    avisos.push('Solo hay una lectura del folio y es débil: no se usa.');
    anclas = [];
  }

  // El deductor de v3: marcadores, portada, transición de respaldo.
  const textos = new Map<number, string>();
  const confianzas = new Map<number, number>();
  paginas.forEach((p, i) => {
    textos.set(i + 1, (p.texto ?? '').slice(0, 300));
    if (typeof p.confianza === 'number') confianzas.set(i + 1, p.confianza);
  });
  const anclasV3 = new Map<number, { folio: number; confianza: number }>();
  for (const a of anclas) anclasV3.set(a.i + 1, { folio: a.c.romana ? -a.c.valor : Math.max(1, Math.round(a.c.valor)), confianza: 0.9 });
  const deductor = new DeductorPaginas();
  const v3 = deductor.deducir({
    totalPaginas: n,
    disposicion: prep.disposicion === 'doble' ? 'TWO_UP' : prep.disposicion === 'doble_rtl' ? 'TWO_UP_RTL' : 'SINGLE',
    anclas: anclasV3,
    textos,
    confianzas,
    marcadoresEstrictos: true,
    ...(opciones.registro ? { registro: opciones.registro } : {}),
  });
  const marcadores = v3.marcadores;

  const romanas = anclas.filter((a) => a.c.romana);
  const arabigas = anclas.filter((a) => !a.c.romana);
  const mayusculas = romanas.filter((a) => a.c.mayusculas).length > romanas.length / 2;

  // Sin ninguna lectura: no se inventa nada (salvo que se pida el comportamiento de v3).
  if (!anclas.length) {
    if (opciones.numerarSinLecturas) return desdeDeductor(prep, v3, juez, avisos);
    avisos.push('No hay ninguna lectura fiable del folio: las páginas quedan sin número impreso.');
    return {
      paginas: paginas.map((p, i) => ({
        tipo: 'pagina', fisica: p.fisica, impresa: null, romana: false, origen: 'ninguno', confianza: 0,
        tipoPagina: 'cuerpo', candidatos: candidatos[i] as Candidato[],
      })),
      estrategia: 'ninguno', disposicion: prep.disposicion, foliacion: prep.foliacion, transicion: null,
      primeraNumerada: paginas[0]?.fisica ?? 1, anclas: 0, juez, avisos,
    };
  }

  // Transición romanos → arábigos (índice 0-based de la primera página arábiga).
  let transicion: number | null = null;
  if (arabigas.length) {
    const a0 = arabigas[0] as Ancla;
    const estimada = Math.round(a0.i - (a0.c.valor - 1) / paso);
    const ultimaRomana = romanas.length ? (romanas[romanas.length - 1] as Ancla).i : -1;
    if (estimada > 0 || romanas.length) {
      transicion = Math.max(ultimaRomana + 1, Math.min(a0.i, estimada));
      if (transicion <= 0 && !romanas.length) transicion = null;
    }
  } else if (romanas.length) {
    // Solo romanos: el cuerpo empieza donde lo diga un marcador de capítulo posterior, si lo hay.
    const ultima = (romanas[romanas.length - 1] as Ancla).i;
    const capitulos = [...marcadores].filter(([p, m]) => m === 'chapter_start' && p - 1 > ultima).map(([p]) => p - 1);
    transicion = capitulos.length ? Math.min(...capitulos) : null;
  }

  // Primera página numerada: la de v3 (texto > 50 caracteres o primer marcador de preliminares),
  // pero nunca después de la primera lectura.
  let primera = Math.min(v3.primeraNumerada - 1, (anclas[0] as Ancla).i);
  if (romanas.length) {
    // Con romanos leídos, los preliminares empiezan donde salga el i romano.
    const r0 = romanas[0] as Ancla;
    primera = Math.max(0, Math.min(primera, Math.round(r0.i - (r0.c.valor - 1) / paso)));
  } else if (transicion !== null) {
    primera = Math.min(primera, transicion);
  }
  primera = Math.max(0, primera);

  const enZonaRomana = (i: number) => transicion !== null ? i < transicion : arabigas.length === 0;
  const zonaR = romanas;
  const zonaA = arabigas;

  // Valores por página
  const valor: Array<number | null> = new Array(n).fill(null);
  const conf: number[] = new Array(n).fill(0);
  const origen: Array<'leido' | 'deducido' | 'ninguno'> = new Array(n).fill('ninguno');
  const lamina: boolean[] = new Array(n).fill(false);
  const elegido: Array<Candidato | undefined> = new Array(n).fill(undefined);

  const rellenarZona = (zona: Ancla[], desde: number, hasta: number, romano: boolean) => {
    if (hasta < desde) return;
    if (!zona.length) {
      // Zona sin lecturas: preliminares contados desde la primera página (como v3) o cuerpo desde 1.
      for (let i = desde; i <= hasta; i++) {
        valor[i] = romano ? (i - desde) * paso + 1 : 1 + paso * (i - desde);
        conf[i] = 0.4;
        origen[i] = 'deducido';
      }
      return;
    }
    const enRango = zona.filter((a) => a.i >= desde && a.i <= hasta);
    if (!enRango.length) return;
    for (const a of enRango) {
      valor[a.i] = a.c.valor;
      conf[a.i] = confianzaLectura(a);
      origen[a.i] = 'leido';
      elegido[a.i] = a.c;
    }
    // Antes de la primera lectura
    const p0 = enRango[0] as Ancla;
    for (let i = p0.i - 1; i >= desde; i--) {
      const v = p0.c.valor - paso * (p0.i - i);
      if (v < 1 - 1e-9) break;
      valor[i] = v;
      conf[i] = Math.max(0.5, 0.9 - 0.005 * (p0.i - i));
      origen[i] = 'deducido';
    }
    // Entre lecturas
    for (let k = 0; k + 1 < enRango.length; k++) {
      const a = enRango[k] as Ancla, b = enRango[k + 1] as Ancla;
      const dentro = b.i - a.i - 1;
      if (dentro <= 0) continue;
      const hueco = (b.c.valor - a.c.valor) - paso * (b.i - a.i);
      if (Math.abs(hueco) < 1e-9) {
        for (let i = a.i + 1; i < b.i; i++) { valor[i] = a.c.valor + paso * (i - a.i); conf[i] = 0.95; origen[i] = 'deducido'; }
        continue;
      }
      const laminas = Math.round(-hueco / paso);
      if (hueco < 0 && laminas <= dentro && Math.abs(-hueco / paso - laminas) < 1e-9) {
        const elegidas = elegirLaminas(prep, a.i + 1, b.i - 1, laminas);
        let v = a.c.valor;
        for (let i = a.i + 1; i < b.i; i++) {
          if (elegidas.has(i)) { lamina[i] = true; valor[i] = null; conf[i] = 0.7; origen[i] = 'ninguno'; continue; }
          v += paso;
          valor[i] = v; conf[i] = 0.85; origen[i] = 'deducido';
        }
        avisos.push(`Entre las páginas físicas ${paginas[a.i]?.fisica} y ${paginas[b.i]?.fisica} hay ${laminas} página(s) sin numerar (láminas).`);
        continue;
      }
      // Ruptura: hojas que faltan o numeración que cambia. Cada mitad sigue a su lectura.
      const corte = puntoDeCorte(a.i, b.i, marcadores);
      for (let i = a.i + 1; i < b.i; i++) {
        const v = i < corte ? a.c.valor + paso * (i - a.i) : b.c.valor - paso * (b.i - i);
        if (v < 1 - 1e-9) continue;
        valor[i] = v; conf[i] = 0.6; origen[i] = 'deducido';
      }
      if (hueco > 0) avisos.push(`Entre las páginas físicas ${paginas[a.i]?.fisica} y ${paginas[b.i]?.fisica} la numeración salta ${hueco / paso} página(s): faltan hojas en el escaneo.`);
      else avisos.push(`Entre las páginas físicas ${paginas[a.i]?.fisica} y ${paginas[b.i]?.fisica} la numeración se rompe (de ${a.c.valor} a ${b.c.valor}).`);
    }
    // Después de la última lectura
    const pn = enRango[enRango.length - 1] as Ancla;
    for (let i = pn.i + 1; i <= hasta; i++) {
      valor[i] = pn.c.valor + paso * (i - pn.i);
      conf[i] = Math.max(0.5, 0.9 - 0.005 * (i - pn.i));
      origen[i] = 'deducido';
    }
  };

  if (transicion === null) {
    if (arabigas.length) rellenarZona(zonaA, primera, n - 1, false);
    else rellenarZona(zonaR, primera, n - 1, true);
  } else {
    rellenarZona(zonaR, primera, transicion - 1, true);
    rellenarZona(zonaA, transicion, n - 1, false);
  }

  // Páginas que el juez dijo que no llevan número y que no se han leído: si caen entre
  // lecturas que cuadran, siguen contando (las páginas de inicio de capítulo no llevan
  // número impreso pero cuentan). Solo se marcan como láminas cuando sobran páginas.

  const salida: FolioPagina[] = paginas.map((p, i) => {
    const v = valor[i];
    const romano = transicion !== null ? i < transicion : arabigas.length === 0 && romanas.length > 0;
    let tipoPagina: TipoPagina = i < primera ? 'portada' : romano ? 'preliminar' : 'cuerpo';
    const m = marcadores.get(i + 1) as Marcador | undefined;
    if (m && MARCADORES_FINALES.has(m) && !romano) tipoPagina = 'final';
    if (lamina[i]) tipoPagina = 'lamina';
    const base: FolioPagina = {
      tipo: 'pagina', fisica: p.fisica, impresa: null, romana: false, origen: 'ninguno', confianza: 0,
      tipoPagina, candidatos: candidatos[i] as Candidato[],
    };
    const el = elegido[i];
    if (el) base.elegido = el;
    if (v === null || v === undefined || i < primera) {
      base.confianza = i < primera ? 0.7 : lamina[i] ? conf[i] as number : 0;
      return base;
    }
    base.origen = origen[i] as 'leido' | 'deducido';
    base.confianza = redondear(conf[i] as number);
    if (romano) {
      base.romana = true;
      base.impresa = enteroARomano(Math.round(v), mayusculas);
    } else if (prep.foliacion) {
      const hoja = Math.floor(v + 1e-9);
      base.impresa = `${hoja}${Math.abs(v - hoja) < 1e-9 ? 'r' : 'v'}`;
    } else {
      base.impresa = String(Math.round(v));
    }
    if (paso === 2 && !romano) {
      const izq = Math.round(v), der = izq + 1;
      base.impresas = prep.disposicion === 'doble_rtl' ? [String(der), String(izq)] : [String(izq), String(der)];
      if (prep.disposicion === 'doble_rtl') base.impresa = String(der);
    } else if (paso === 2 && romano) {
      const izq = Math.round(v), der = izq + 1;
      base.impresas = [enteroARomano(izq, mayusculas), enteroARomano(der, mayusculas)];
    }
    // Un elegido que no coincide con el valor final no es una lectura.
    if (base.origen === 'leido' && el && Math.abs(el.valor - v) > 1e-9) base.origen = 'deducido';
    return base;
  });

  const leidas = salida.filter((f) => f.origen === 'leido').length;
  const numeradas = salida.filter((f) => f.impresa !== null).length;
  return {
    paginas: salida,
    estrategia: leidas > numeradas * 0.5 ? 'leido' : numeradas ? 'deducido' : 'ninguno',
    disposicion: prep.disposicion,
    foliacion: prep.foliacion,
    transicion: transicion === null ? null : (paginas[transicion]?.fisica ?? null),
    primeraNumerada: paginas[primera]?.fisica ?? 1,
    anclas: anclas.length,
    juez,
    avisos,
  };
}

function confianzaLectura(a: Ancla): number {
  if (a.c.fuente === 'juez') return redondear(Math.max(0.85, a.c.peso));
  if (a.apoyo >= 2) return redondear(Math.min(1, 0.9 + 0.1 * a.c.peso));
  if (a.apoyo === 1) return redondear(Math.min(0.97, 0.85 + 0.1 * a.c.peso));
  return redondear(0.6 + 0.3 * a.c.peso);
}

const redondear = (x: number) => Math.round(x * 1000) / 1000;

/** Las páginas con más pinta de lámina sin numerar: vacías, sin texto, solo figura, o las que el juez dijo. */
function elegirLaminas(prep: Preparado, desde: number, hasta: number, cuantas: number): Set<number> {
  const puntos: Array<[number, number]> = [];
  for (let i = desde; i <= hasta; i++) {
    const p = prep.paginas[i] as PaginaFolio;
    const largo = (p.texto ?? '').trim().length;
    let s = 0;
    if (prep.sinNumero.has(i)) s += 3;
    if (p.vacia) s += 2;
    if ((p.figuras?.length ?? 0) > 0 && largo < 400) s += 1.5;
    if (!(prep.candidatos[i] as Candidato[]).length) s += 0.5;
    s += Math.max(0, 1 - largo / 600);
    puntos.push([i, s]);
  }
  puntos.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return new Set(puntos.slice(0, cuantas).map(([i]) => i));
}

/** Dónde cambia de tramo una numeración rota: en un inicio de capítulo si lo hay; si no, a mitad. */
function puntoDeCorte(a: number, b: number, marcadores: Map<number, Marcador>): number {
  for (let i = a + 1; i < b; i++) {
    const m = marcadores.get(i + 1);
    if (m === 'chapter_start' || m === 'introduction') return i;
  }
  return Math.ceil((a + b) / 2);
}

/** El comportamiento de v3 cuando no hay ninguna lectura (opcional). */
function desdeDeductor(prep: Preparado, v3: ReturnType<DeductorPaginas['deducir']>, juez: { llamadas: number; preguntas: number }, avisos: string[]): ResultadoFolios {
  const paginas: FolioPagina[] = prep.paginas.map((p, i) => {
    const c = v3.correspondencias[i];
    const f = c?.folio ?? null;
    const tipoPagina: TipoPagina = !c || c.tipo === 'portada' ? 'portada' : c.tipo === 'preliminar' ? 'preliminar' : c.tipo === 'final' ? 'final' : 'cuerpo';
    return {
      tipo: 'pagina', fisica: p.fisica,
      impresa: f === null ? null : f < 0 ? enteroARomano(-f) : String(f),
      romana: f !== null && f < 0,
      origen: f === null ? 'ninguno' : 'deducido',
      confianza: f === null ? 0 : 0.3,
      tipoPagina, candidatos: prep.candidatos[i] as Candidato[],
    };
  });
  avisos.push('Sin lecturas del folio: numeración de v3 (de 1 en adelante desde la primera página con texto), con confianza baja.');
  return {
    paginas, estrategia: 'deducido', disposicion: prep.disposicion, foliacion: prep.foliacion,
    transicion: v3.transicion, primeraNumerada: v3.primeraNumerada, anclas: 0, juez, avisos,
  };
}

// ---------------------------------------------------------------------------
// El juez
// ---------------------------------------------------------------------------

/** Distancia de edición ≤ 1 entre las cifras de dos números (un dígito mal leído, de más o de menos). */
export function casiIgual(a: number, b: number): boolean {
  const x = String(a), y = String(b);
  if (x === y) return false;
  if (x.length === y.length) {
    let d = 0;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++;
    return d === 1;
  }
  const [corto, largo] = x.length < y.length ? [x, y] : [y, x];
  if (largo.length - corto.length !== 1) return false;
  for (let i = 0; i < largo.length; i++) if (largo.slice(0, i) + largo.slice(i + 1) === corto) return true;
  return false;
}

/** Páginas cuya decisión es dudosa (índices 0-based). */
export function paginasDudosas(prep: Preparado, sec: ResultadoSecuencia, previo: ResultadoFolios, umbral: number): number[] {
  const dudosas: number[] = [];
  prep.candidatos.forEach((cs, i) => {
    if (!cs.length) return;
    const el = sec.elegidos[i];
    const margen = sec.margenes[i] ?? Infinity;
    if (el !== null && el !== undefined) {
      if ((sec.apoyos[i] ?? 0) === 0 || margen < umbral) dudosas.push(i);
      return;
    }
    if (margen < umbral + 0.25) { dudosas.push(i); return; }
    const previsto = previo.paginas[i];
    if (previsto?.impresa && !previsto.romana) {
      const p = Number(previsto.impresa);
      if (Number.isFinite(p) && cs.some((c) => !c.romana && casiIgual(c.valor, p))) dudosas.push(i);
    }
  });
  return dudosas;
}

function recortar(s: string | undefined | null, max = 160): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function construirPreguntas(prep: Preparado, previo: ResultadoFolios, dudosas: number[]) {
  const preguntas: Record<string, PreguntaJuez> = {};
  const opcionesPorPagina = new Map<string, { i: number; opciones: Map<string, { valor: number; romana: boolean; candidato?: Candidato }> }>();
  const paginasEstado: Record<string, unknown> = {};
  const folioDe = (i: number) => previo.paginas[i]?.impresa ?? null;
  for (const i of dudosas) {
    const p = prep.paginas[i] as PaginaFolio;
    const clave = `p${p.fisica}`;
    const cs = prep.candidatos[i] as Candidato[];
    const opciones: Record<string, string | null> = {};
    const mapa = new Map<string, { valor: number; romana: boolean; candidato?: Candidato }>();
    for (const c of cs) {
      const k = textoDeCandidato(c);
      if (mapa.has(k)) continue;
      const donde = c.fuente === 'lector' ? 'según el lector' : c.fuente === 'pie' ? 'en el pie' : c.fuente === 'cabecera' ? 'en la cabecera' : c.fuente === 'texto-inicio' ? 'al principio del texto' : 'al final del texto';
      opciones[k] = `${k}: aparece ${donde} como «${recortar(c.texto, 60)}»`;
      mapa.set(k, { valor: c.valor, romana: c.romana, candidato: c });
    }
    const previsto = previo.paginas[i];
    if (previsto?.impresa && !previsto.romana && !mapa.has(previsto.impresa)) {
      const v = Number(previsto.impresa);
      const parecido = cs.find((c) => !c.romana && casiIgual(c.valor, v));
      if (Number.isFinite(v) && parecido) {
        opciones[previsto.impresa] = `${previsto.impresa}: el que le toca por las páginas vecinas, mal leído como «${recortar(parecido.texto, 40)}»`;
        mapa.set(previsto.impresa, { valor: v, romana: false });
      }
    }
    opciones.ninguno = 'la página no lleva número de página impreso (o no se distingue)';
    preguntas[clave] = {
      tipo: 'eleccion',
      instrucciones:
        `¿Qué número de página (folio) lleva impreso la página física ${p.fisica}? Sus datos están en «paginas.${clave}». ` +
        'Las llamadas de nota, los años, los números de capítulo, las referencias a otras páginas y las signaturas del impresor (A2, B3) no son el folio.',
      opciones,
    };
    const lineas = lineasUtiles(p.texto);
    paginasEstado[clave] = {
      cabecera: recortar(p.cabecera),
      pie: recortar(p.pie),
      folio_segun_lector: p.folio ?? null,
      primeras_lineas: recortar(lineas.slice(0, 2).join(' / ')),
      ultimas_lineas: recortar(lineas.slice(-3).join(' / ')),
      folio_pagina_anterior: i > 0 ? folioDe(i - 1) : null,
      folio_pagina_siguiente: i + 1 < prep.paginas.length ? folioDe(i + 1) : null,
    };
    opcionesPorPagina.set(clave, { i, opciones: mapa });
  }
  const estado = {
    tarea: 'Elegir el número de página impreso de páginas de un libro leídas por OCR.',
    libro: { paginas_fisicas: prep.paginas.length, doble_pagina: prep.paso === 2, foliado: prep.foliacion },
    paginas: paginasEstado,
  };
  return { preguntas, estado, opcionesPorPagina };
}

function aplicarRespuestas(
  prep: Preparado,
  respuestas: Record<string, RespuestaJuez>,
  opcionesPorPagina: Map<string, { i: number; opciones: Map<string, { valor: number; romana: boolean; candidato?: Candidato }> }>,
): void {
  for (const [clave, { i, opciones }] of opcionesPorPagina) {
    const r = respuestas[clave];
    if (!r || r.tipo !== 'eleccion') continue;
    const prob = r.probabilidades[r.eleccion] ?? 0;
    if (prob < 0.5) continue;
    const cs = prep.candidatos[i] as Candidato[];
    if (r.eleccion === 'ninguno') {
      prep.sinNumero.add(i);
      prep.candidatos[i] = cs.filter((c) => c.peso >= 0.95).map((c) => ({ ...c, peso: c.peso * (1 - prob) }));
      continue;
    }
    const op = opciones.get(r.eleccion);
    if (!op) continue;
    const otros = cs.filter((c) => c !== op.candidato).map((c) => ({ ...c, peso: redondear(c.peso * (1 - 0.8 * prob)) }));
    const base: Candidato = op.candidato ?? { valor: op.valor, romana: op.romana, mayusculas: false, texto: r.eleccion, fuente: 'juez', peso: 0, corregido: true };
    const elegido: Candidato = { ...base, fuente: 'juez', peso: redondear(Math.min(1, Math.max(base.peso, 0.5 + 0.5 * prob))) };
    prep.candidatos[i] = [elegido, ...otros];
  }
}
