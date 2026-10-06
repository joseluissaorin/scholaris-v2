/**
 * Paso de lectura: páginas por pliegos de visión (en paralelo, con cascada de
 * lectores y controles de calidad) y páginas digitales por la capa de texto.
 */

import { enParalelo, reintentar, type Lector, type PaginaLeida } from '@scholaris/nucleo';
import type { PaqueteConversion, PaginaPdf } from '@scholaris/imprenta';
import type { FuentePaquete, Plan, Pliego, Procedencia, ResultadoLectura, UnidadLeida } from '../tipos.js';
import { leerCapaPagina, cuerpoDominante, limpiarUnidad, prefijoBasura } from './capa.js';
import { Cobertura } from '../cobertura.js';
export { Cobertura };

export interface OpcionesLectura {
  pista?: string;
  /** Milisegundos máximos por llamada al lector. */
  limiteMs?: number;
  /** Cada vez que un pliego termina (para ir enseñando páginas). */
  alLeer?: (unidades: UnidadLeida[]) => void;
  reloj?: () => number;
  /** Cobertura de la cola de latencia (compartida por todos los pliegos de un documento). */
  cobertura?: Cobertura;
}

/** Resultado de un pliego: serializable, lo que devuelve un paso de Workflow. */
export interface ResultadoPliego {
  pliego: number;
  paginas: UnidadLeida[];
  procedencia: Procedencia;
  avisos: string[];
}

function conLimite<T>(p: Promise<T>, ms: number, que: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rechazar) => { t = setTimeout(() => rechazar(new Error(`${que}: sin respuesta en ${ms} ms`)), ms); }),
  ]);
}

/** ¿El modelo entró en bucle? (la misma línea o el mismo trozo repetido muchas veces). */
export function enBucle(texto: string): boolean {
  const lineas = texto.split('\n').map((l) => l.trim()).filter((l) => l.length > 3);
  const cuenta = new Map<string, number>();
  for (const l of lineas) cuenta.set(l, (cuenta.get(l) ?? 0) + 1);
  for (const [l, n] of cuenta) if (n >= 8 && l.length > 8 && n > lineas.length * 0.3) return true;
  return /(.{20,}?)\1{6,}/s.test(texto.slice(0, 20000));
}

/** Normaliza el número físico: algunos lectores numeran dentro del pliego (1..n). */
function aAbsoluta(paginas: PaginaLeida[], desde: number, hasta: number): PaginaLeida[] {
  const n = hasta - desde + 1;
  const relativas = desde > 1 && paginas.every((p) => p.fisica >= 1 && p.fisica <= n) && !paginas.some((p) => p.fisica >= desde && p.fisica <= hasta && desde <= n);
  return paginas.map((p) => ({ ...p, fisica: relativas ? p.fisica + desde - 1 : p.fisica }));
}

function aUnidad(p: PaginaLeida, orden: number, lector: string, etiqueta: string | null): UnidadLeida {
  return {
    orden,
    fisica: p.fisica,
    texto: (p.texto ?? '').trim(),
    notas: (p.notas ?? []).map((n) => n.trim()).filter(Boolean),
    cabecera: p.cabecera ?? '',
    pie: p.pie ?? '',
    folioVisto: p.folio ? String(p.folio).trim() || null : null,
    etiqueta,
    titulos: p.titulos ?? [],
    figuras: p.figuras ?? [],
    vacia: Boolean(p.vacia) || ((p.texto ?? '').trim().length === 0 && (p.notas ?? []).length === 0),
    ...(p.idioma ? { idioma: p.idioma } : {}),
    lector,
    confianza: typeof p.confianza === 'number' ? p.confianza : 0.8,
  };
}

/**
 * Lee un pliego con la cascada de lectores. Si un lector devuelve páginas de
 * menos, en bucle o vacías donde la capa tiene texto, se parte el pliego y se
 * reintenta; al final, la página cae al siguiente lector o a la capa.
 */
export async function leerPliego(
  pliego: Pliego,
  paquete: PaqueteConversion,
  fuente: FuentePaquete,
  lectores: Lector[],
  opciones: OpcionesLectura = {},
): Promise<ResultadoPliego> {
  const reloj = opciones.reloj ?? Date.now;
  const inicio = reloj();
  const avisos: string[] = [];
  const paginasPdf = paquete.contenido.clase === 'pdf' ? paquete.contenido.paginas : null;
  const imagenes = paquete.contenido.clase === 'imagenes' ? paquete.contenido.paginas : null;
  const porFisica = new Map<number, PaginaPdf>();
  for (const p of paginasPdf ?? []) porFisica.set(p.fisica, p);
  const etiqueta = (f: number) => porFisica.get(f)?.etiqueta ?? null;
  const llamadas: Array<{ lector: string; desde: number; hasta: number; ms: number; ok: boolean; error?: string }> = [];

  const entradaPara = async (desde: number, hasta: number, envio: Pliego['envio']) => {
    if (envio === 'pdf' && fuente.subPdf) {
      const pdf = await fuente.subPdf(desde, hasta);
      if (pdf) return { pdf, primeraFisica: desde };
    }
    const imgs: Array<{ bytes: Uint8Array; mime: string }> = [];
    for (let f = desde; f <= hasta; f++) {
      const id = porFisica.get(f)?.imagen ?? imagenes?.find((p) => p.fisica === f)?.imagen;
      const b = id ? await fuente.parte(id) : null;
      if (!b) throw new Error(`Falta la imagen de la página ${f}`);
      imgs.push(b);
    }
    return { imagenes: imgs, primeraFisica: desde };
  };

  const valida = (p: PaginaLeida): string | null => {
    if (enBucle(p.texto ?? '')) return 'bucle';
    const capa = porFisica.get(p.fisica);
    const largoCapa = capa?.texto.util ? capa.cuerpo.length : 0;
    if (largoCapa > 400 && (p.texto ?? '').length + (p.notas ?? []).join('').length < largoCapa * 0.3) return 'corta';
    return null;
  };

  const leidas = new Map<number, UnidadLeida>();

  const intentar = async (desde: number, hasta: number, nivel: number): Promise<void> => {
    const lector = lectores[nivel];
    if (!lector) return;
    const t0 = reloj();
    let paginas: PaginaLeida[] = [];
    let errorTotal = false;
    try {
      const entrada = await entradaPara(desde, hasta, pliego.envio);
      paginas = await reintentar(
        () => {
          // La llamada de cobertura cambia un poco la pista: si la primera se quedó en un bucle
          // de repetición (determinista), la segunda no lo repite.
          const llamada = (n = 0) => {
            const pista = [opciones.pista, n > 0 ? 'Transcribe cada página una sola vez, sin repetir líneas.' : ''].filter(Boolean).join(' ');
            return conLimite(lector.leerPliego({ ...entrada, ...(pista ? { pista } : {}) }), opciones.limiteMs ?? Math.max(60_000, (hasta - desde + 1) * 20_000), lector.nombre);
          };
          return opciones.cobertura && nivel === 0 ? opciones.cobertura.llamar(llamada) : llamada();
        },
        { intentos: 2, base: 1500 },
      );
      paginas = aAbsoluta(paginas, desde, hasta);
      llamadas.push({ lector: lector.nombre, desde, hasta, ms: reloj() - t0, ok: true });
    } catch (e) {
      errorTotal = true;
      llamadas.push({ lector: lector.nombre, desde, hasta, ms: reloj() - t0, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
    const faltan: number[] = [];
    for (let f = desde; f <= hasta; f++) {
      const p = paginas.find((x) => x.fisica === f);
      const fallo = p ? valida(p) : 'falta';
      if (p && !fallo) leidas.set(f, aUnidad(p, f - 1, lector.nombre, etiqueta(f)));
      else faltan.push(f);
    }
    if (!faltan.length) return;
    avisos.push(`${lector.nombre}: ${faltan.length} página(s) sin leer bien en ${desde}-${hasta}`);
    // Tiradas de páginas que faltan: primero se parte con el mismo lector, luego se baja en la cascada.
    const tiradas: Array<[number, number]> = [];
    for (const f of faltan) {
      const u = tiradas.at(-1);
      if (u && u[1] === f - 1) u[1] = f; else tiradas.push([f, f]);
    }
    await Promise.all(tiradas.map(async ([a, b]) => {
      // Si la llamada entera falló (red, cuota), se baja en la cascada; si el
      // lector devolvió páginas de menos o malas, se parte con el mismo lector.
      if (!errorTotal && b > a) {
        const m = Math.floor((a + b) / 2);
        await Promise.all([intentar(a, m, nivel), intentar(m + 1, b, nivel)]);
      } else {
        await intentar(a, b, nivel + 1);
      }
    }));
  };

  await intentar(pliego.desde, pliego.hasta, 0);

  // Lo que no leyó nadie: la capa, si existe; si no, una página vacía de confianza baja.
  const base = paginasPdf ? cuerpoDominante(paginasPdf) : 10;
  const salida: UnidadLeida[] = [];
  for (let f = pliego.desde; f <= pliego.hasta; f++) {
    let u = leidas.get(f);
    const capa = porFisica.get(f);
    if (!u) {
      avisos.push(`Página ${f}: ningún lector la leyó; ${capa?.cuerpo ? 'se usa la capa' : 'queda vacía'}`);
      u = capa ? { ...leerCapaPagina(capa, f - 1, base), confianza: 0.3 } : { orden: f - 1, fisica: f, texto: '', notas: [], cabecera: '', pie: '', folioVisto: null, etiqueta: null, titulos: [], figuras: [], vacia: true, lector: 'ninguno', confianza: 0 };
    }
    salida.push(u);
  }
  return {
    pliego: pliego.id,
    paginas: salida,
    avisos,
    procedencia: { fase: 'lectura', proveedor: lectores[0]?.nombre ?? 'ninguno', ms: reloj() - inicio, detalle: { pliego: pliego.id, desde: pliego.desde, hasta: pliego.hasta, motivo: pliego.motivo, llamadas } },
  };
}

/**
 * Lectura completa de un documento de páginas: la capa donde vale, los pliegos
 * de visión en paralelo. Devuelve las unidades en orden físico.
 */
export async function leerPaginas(
  plan: Plan,
  paquete: PaqueteConversion,
  fuente: FuentePaquete,
  lectores: Lector[],
  opciones: OpcionesLectura = {},
): Promise<ResultadoLectura> {
  const reloj = opciones.reloj ?? Date.now;
  const t0 = reloj();
  const unidades: UnidadLeida[] = [];
  const procedencia: Procedencia[] = [];
  const avisos: string[] = [];
  if (paquete.contenido.clase === 'pdf') {
    const paginas = paquete.contenido.paginas;
    const base = cuerpoDominante(paginas);
    const basura = prefijoBasura(paginas);
    const capa: UnidadLeida[] = [];
    paginas.forEach((p, i) => { if (plan.vias[i] === 'capa') capa.push(limpiarUnidad(leerCapaPagina(p, i, base), basura)); });
    unidades.push(...capa);
    if (capa.length) {
      opciones.alLeer?.(capa);
      procedencia.push({ fase: 'lectura', proveedor: 'capa-pdf', ms: reloj() - t0, detalle: { paginas: capa.length } });
    }
  }
  const cobertura = opciones.cobertura ?? new Cobertura(15_000, 2.2, reloj);
  const resultados = await enParalelo(plan.pliegos, plan.concurrencia, async (pl) => {
    const r = await leerPliego(pl, paquete, fuente, lectores, { ...opciones, cobertura });
    opciones.alLeer?.(r.paginas);
    return r;
  });
  for (const r of resultados) {
    unidades.push(...r.paginas);
    procedencia.push(r.procedencia);
    avisos.push(...r.avisos);
  }
  unidades.sort((a, b) => a.fisica - b.fisica);
  unidades.forEach((u, i) => { u.orden = i; });
  if (cobertura.cubiertas) procedencia.push({ fase: 'lectura', proveedor: 'cobertura', ms: 0, detalle: { cubiertas: cobertura.cubiertas, umbralMs: Math.round(cobertura.umbral()) } });
  return { unidades, procedencia, avisos };
}
