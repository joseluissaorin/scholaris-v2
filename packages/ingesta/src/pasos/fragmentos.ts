/**
 * Paso de fragmentos: el troceado que respeta la estructura.
 *
 * - Nunca cruza secciones.
 * - Respeta los párrafos: solo parte un párrafo si no cabe, y entonces por frases
 *   (o por versos, en teatro y poesía).
 * - Apunta a 250-450 tokens.
 * - Un párrafo que sigue en la página siguiente se une, y el fragmento lleva
 *   `ancla` y `anclaFin` (la cita imprime «pp. 23-24»).
 * - Las notas al pie van con el fragmento que las llama ([^n] o voladita); las
 *   que nadie llama forman su propio fragmento de la página.
 */

import { nuevoId, type Ancla } from '@scholaris/nucleo';
import type { FragmentoPlano, Procedencia, Seccion, UnidadLeida } from '../tipos.js';
import { contarTokens, esTituloMarkdown, limpiarMarkdown, partirFrases, terminaFrase } from '../texto.js';
import { parrafosDeUnidad, rutaDe } from './estructura.js';

export interface OpcionesTroceado {
  minimo?: number;
  objetivo?: number;
  maximo?: number;
  /**
   * Unidades donde empieza una tanda de la tubería (un pliego, un lote de capa).
   * Ahí se cierra el grupo aunque siga la sección, igual al trocear la tanda sola
   * que al trocear el documento entero: así los fragmentos de dentro de cada tanda
   * salen idénticos en las dos pasadas y la consolidación solo rehace las costuras.
   */
  cortes?: Iterable<number>;
}

/** ¿Empieza como continuación de la página anterior (minúscula, coma, paréntesis)? */
const pareceCabo = (texto: string) => /^[\p{Ll}(«"“,;]/u.test(texto);

/** Una frase con la unidad donde empieza y donde acaba. */
interface Frase { texto: string; u0: number; u1: number; p0: number; titulo?: boolean }
/** Un párrafo lógico (puede cruzar página). */
interface Parrafo { frases: Frase[]; titulo: boolean; verso: boolean; u0: number; p0: number }

const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const deVoladita = (s: string) => [...s].map((c) => String(SUPER.indexOf(c))).join('');

function frasesDe(texto: string, u: number, p: number): Frase[] {
  if (texto.includes('\n')) return texto.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ texto: l, u0: u, u1: u, p0: p }));
  return partirFrases(texto).map((f) => ({ texto: f, u0: u, u1: u, p0: p }));
}

/** Parte una frase demasiado larga por palabras. */
function partirLarga(f: Frase, maximo: number): Frase[] {
  if (contarTokens(f.texto) <= maximo) return [f];
  const palabras = f.texto.split(/\s+/);
  const trozos: Frase[] = [];
  let actual: string[] = [];
  for (const w of palabras) {
    actual.push(w);
    if (contarTokens(actual.join(' ')) >= maximo * 0.9) { trozos.push({ ...f, texto: actual.join(' ') }); actual = []; }
  }
  if (actual.length) trozos.push({ ...f, texto: actual.join(' ') });
  // El cambio de página cae en algún trozo: el primero empieza en u0 y el último acaba en u1.
  return trozos.map((t, i) => ({ ...t, u0: i === 0 ? f.u0 : f.u1 === f.u0 ? f.u0 : f.u1, u1: i === trozos.length - 1 ? f.u1 : f.u0 }));
}

/** Corriente de párrafos lógicos de todo el documento, con su sección. */
function corriente(unidades: UnidadLeida[], secciones: Seccion[], cortes: Set<number> = new Set()): Array<{ seccion: Seccion | undefined; parrafos: Parrafo[] }> {
  const inicios = [...secciones].sort((a, b) => a.desde.unidad - b.desde.unidad || a.desde.parrafo - b.desde.parrafo);
  const grupos: Array<{ seccion: Seccion | undefined; parrafos: Parrafo[] }> = [{ seccion: undefined, parrafos: [] }];
  let si = 0;
  let anterior: Parrafo | null = null;
  /** Tras una costura cuyo primer párrafo se unió al anterior (o se aisló), el siguiente abre grupo. */
  let cortePendiente = false;
  for (const u of unidades) {
    const ps = parrafosDeUnidad(u);
    ps.forEach((texto, i) => {
      const enCorte = i === 0 && cortes.has(u.orden);
      // ¿Empieza aquí una sección (o varias seguidas)?
      let cambio = false;
      while (si < inicios.length && ((inicios[si] as Seccion).desde.unidad < u.orden || ((inicios[si] as Seccion).desde.unidad === u.orden && (inicios[si] as Seccion).desde.parrafo <= i))) {
        grupos.push({ seccion: inicios[si], parrafos: [] });
        si++;
        cambio = true;
      }
      let grupo = grupos.at(-1) as (typeof grupos)[number];
      const abrir = () => { grupo = { seccion: grupo.seccion, parrafos: [] }; grupos.push(grupo); };
      const titulo = esTituloMarkdown(texto);
      if (enCorte && !cambio) {
        // Costura de tanda: si el párrafo sigue al anterior, se une y el grupo se cierra
        // después; si no, se abre grupo aquí (y un «cabo» en minúscula va solo).
        const ultimaPrevia = anterior?.frases.at(-1);
        const sigue = !titulo && anterior && anterior.u0 < u.orden && !anterior.verso && !texto.includes('\n') && ultimaPrevia && !terminaFrase(ultimaPrevia.texto) && pareceCabo(texto);
        if (!sigue) {
          if (grupo.parrafos.length) abrir();
          cortePendiente = !titulo && pareceCabo(texto);
        }
      } else if (cortePendiente && !cambio) {
        if (grupo.parrafos.length) abrir();
        cortePendiente = false;
      } else if (cambio) cortePendiente = false;
      if (titulo) {
        grupo.parrafos.push({ frases: [{ texto: titulo.texto, u0: u.orden, u1: u.orden, p0: i, titulo: true }], titulo: true, verso: false, u0: u.orden, p0: i });
        anterior = null;
        return;
      }
      const verso = texto.includes('\n');
      // Párrafo que sigue de la página anterior: primer párrafo de la página, minúscula
      // inicial y el anterior no acabó frase.
      if (!cambio && i === 0 && anterior && anterior.u0 < u.orden && !anterior.verso && !verso) {
        const ultima = anterior.frases.at(-1) as Frase;
        if (!terminaFrase(ultima.texto) && pareceCabo(texto)) {
          const nuevas = frasesDe(texto, u.orden, i);
          const primera = nuevas.shift();
          if (primera) {
            const unida = /\p{L}-$/u.test(ultima.texto) ? ultima.texto.slice(0, -1) + primera.texto : `${ultima.texto} ${primera.texto}`;
            anterior.frases[anterior.frases.length - 1] = { texto: unida, u0: ultima.u0, u1: u.orden, p0: ultima.p0 };
          }
          anterior.frases.push(...nuevas);
          if (enCorte) cortePendiente = true;
          return;
        }
      }
      const p: Parrafo = { frases: frasesDe(texto, u.orden, i), titulo: false, verso, u0: u.orden, p0: i };
      if (p.frases.length) grupo.parrafos.push(p);
      anterior = p;
    });
  }
  return grupos.filter((g) => g.parrafos.length);
}

/** Notas: etiqueta de una nota («[^3]: …», «3. …», «³ …», «* …»). */
function etiquetaNota(nota: string): string | null {
  const m = /^\s*(?:\[\^([^\]]+)\]:?|([⁰¹²³⁴⁵⁶⁷⁸⁹]+)|(\d{1,3})[.)]?(?=\s)|([*†‡§]+))/u.exec(nota);
  if (!m) return null;
  return m[1] ?? (m[2] ? deVoladita(m[2]) : m[3] ?? m[4] ?? null);
}

function llamadas(texto: string): string[] {
  const s = new Set<string>();
  for (const m of texto.matchAll(/\[\^([^\]]+)\]/g)) s.add(m[1] as string);
  for (const m of texto.matchAll(/(?<=[\p{L}.,;:!?»”")])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/gu)) s.add(deVoladita(m[1] as string));
  return [...s];
}

export function trocear(unidades: UnidadLeida[], secciones: Seccion[], opciones: OpcionesTroceado = {}): FragmentoPlano[] {
  const minimo = opciones.minimo ?? 250, objetivo = opciones.objetivo ?? 350, maximo = opciones.maximo ?? 450;
  const porId = new Map(secciones.map((s) => [s.id, s]));
  const porOrden = new Map(unidades.map((u) => [u.orden, u]));
  const salida: FragmentoPlano[] = [];

  const anclaDe = (u: number, p: number): Ancla => {
    const un = porOrden.get(u);
    const a = un?.ancla ?? { tipo: 'pagina', fisica: un?.fisica ?? u + 1, impresa: null, romana: false, origen: 'ninguno', confianza: 0 };
    return a.tipo === 'seccion' || a.tipo === 'web' ? { ...a, parrafo: a.parrafo + p } : a;
  };

  for (const grupo of corriente(unidades, secciones, new Set(opciones.cortes ?? []))) {
    const ruta = rutaDe(grupo.seccion, porId);
    const seccionId = grupo.seccion?.id ?? null;
    const delGrupo: Array<{ frases: Frase[]; partes: string[] }> = [];
    let actual: { frases: Frase[]; partes: string[]; tokens: number } = { frases: [], partes: [], tokens: 0 };
    let cabecera: string | null = null; // título pendiente de pegar al siguiente texto

    const cerrar = () => {
      if (actual.frases.length) delGrupo.push({ frases: actual.frases, partes: actual.partes });
      actual = { frases: [], partes: [], tokens: 0 };
    };
    const anadir = (fs: Frase[], comoParrafoNuevo: boolean, verso: boolean) => {
      const texto = fs.map((f) => f.texto).join(verso ? '\n' : ' ');
      if (comoParrafoNuevo || !actual.partes.length) actual.partes.push((cabecera && !actual.partes.length ? '' : '') + texto);
      else actual.partes[actual.partes.length - 1] += (verso ? '\n' : ' ') + texto;
      actual.frases.push(...fs);
      actual.tokens = contarTokens(actual.partes.join('\n\n'));
    };

    for (const p of grupo.parrafos) {
      if (p.titulo) {
        // Un título dentro de la sección (subtítulo sin entrada propia): empieza fragmento si ya hay bastante.
        if (actual.tokens >= minimo * 0.6) cerrar();
        actual.partes.push(`## ${(p.frases[0] as Frase).texto}`);
        actual.frases.push(...p.frases);
        actual.tokens = contarTokens(actual.partes.join('\n\n'));
        cabecera = (p.frases[0] as Frase).texto;
        continue;
      }
      const tp = contarTokens(p.frases.map((f) => f.texto).join(' '));
      if (actual.tokens + tp <= maximo) {
        anadir(p.frases, true, p.verso);
        if (actual.tokens >= objetivo) cerrar();
        continue;
      }
      if (actual.tokens >= minimo) cerrar();
      if (actual.tokens + tp <= maximo) { anadir(p.frases, true, p.verso); if (actual.tokens >= objetivo) cerrar(); continue; }
      // Partir el párrafo por frases en trozos parejos: mejor 250+250 que 380+120.
      const frases = p.frases.flatMap((f) => partirLarga(f, maximo));
      const total = actual.tokens + tp;
      const k = Math.max(2, Math.ceil(total / objetivo));
      const meta = total / k;
      let primera = true;
      frases.forEach((f, i) => {
        const tf = contarTokens(f.texto);
        if (actual.tokens > 0 && (actual.tokens + tf > maximo || (actual.tokens >= meta * 0.92 && actual.tokens + tf / 2 > meta))) { cerrar(); primera = true; }
        anadir([f], primera, p.verso);
        primera = false;
        void i;
      });
      if (actual.tokens >= objetivo) cerrar();
    }
    cerrar();
    // Un resto pequeño al final de la sección se une al anterior si cabe.
    if (delGrupo.length >= 2) {
      const ultimo = delGrupo.at(-1) as (typeof delGrupo)[number];
      const penultimo = delGrupo.at(-2) as (typeof delGrupo)[number];
      const tu = contarTokens(ultimo.partes.join('\n\n'));
      if (tu < minimo * 0.4 && contarTokens(penultimo.partes.join('\n\n')) + tu <= maximo) {
        penultimo.partes.push(...ultimo.partes);
        penultimo.frases.push(...ultimo.frases);
        delGrupo.pop();
      }
    }
    for (const g of delGrupo) {
      const texto = g.partes.join('\n\n').trim();
      // Un fragmento que es solo un título no aporta nada.
      if (!texto || g.partes.every((x) => x.startsWith('## '))) continue;
      // El ancla es la del primer texto, no la del título que lo encabeza.
      const cuerpo = g.frases.filter((f) => !f.titulo);
      const primera = (cuerpo[0] ?? g.frases[0]) as Frase;
      const u0 = Math.min(...(cuerpo.length ? cuerpo : g.frases).map((f) => f.u0));
      const u1 = Math.max(...g.frases.map((f) => f.u1));
      const ancla = anclaDe(u0, primera.p0);
      const fr: FragmentoPlano = { id: nuevoId('fr'), orden: 0, unidad: u0, texto, contexto: '', seccion: ruta, seccionId, ancla, tokens: contarTokens(texto) };
      if (u1 !== u0) { fr.unidadFin = u1; fr.anclaFin = anclaDe(u1, 0); }
      salida.push(fr);
    }
  }

  // Notas al pie: con quien las llama; las demás, aparte.
  const usadas = new Set<string>();
  for (const fr of salida) {
    const ls = llamadas(fr.texto);
    if (!ls.length) continue;
    const anexas: string[] = [];
    for (let u = fr.unidad; u <= (fr.unidadFin ?? fr.unidad); u++) {
      const un = porOrden.get(u);
      un?.notas.forEach((n, i) => {
        const et = etiquetaNota(n);
        const clave = `${u}:${i}`;
        if (et && ls.includes(et) && !usadas.has(clave) && contarTokens(n) + fr.tokens <= maximo * 1.6) {
          usadas.add(clave);
          anexas.push(/^\s*\[\^/.test(n) ? n.trim() : `[^${et}]: ${n.replace(/^\s*(\d{1,3}[.)]?|[⁰¹²³⁴⁵⁶⁷⁸⁹]+|[*†‡§]+)\s*/u, '')}`);
        }
      });
    }
    if (anexas.length) { fr.texto += '\n\n' + anexas.join('\n'); fr.tokens = contarTokens(fr.texto); }
  }
  const huerfanas: FragmentoPlano[] = [];
  for (const u of unidades) {
    const libres = u.notas.filter((_, i) => !usadas.has(`${u.orden}:${i}`));
    if (!libres.length) continue;
    // Sección: la del último fragmento que toca la página.
    const ref = [...salida].reverse().find((f) => f.unidad <= u.orden && (f.unidadFin ?? f.unidad) >= u.orden) ?? [...salida].reverse().find((f) => f.unidad <= u.orden);
    let trozo: string[] = [];
    const volcar = () => {
      if (!trozo.length) return;
      const texto = trozo.join('\n');
      huerfanas.push({ id: nuevoId('fr'), orden: 0, unidad: u.orden, texto, contexto: '', seccion: ref?.seccion ?? [], seccionId: ref?.seccionId ?? null, ancla: anclaDe(u.orden, 0), tokens: contarTokens(texto) });
      trozo = [];
    };
    for (const n of libres) {
      if (contarTokens([...trozo, n].join('\n')) > maximo && trozo.length) volcar();
      trozo.push(n);
    }
    volcar();
  }
  // Las notas sueltas se insertan tras el último fragmento de su página.
  const todos = [...salida];
  for (const h of huerfanas) {
    let pos = todos.length;
    for (let i = todos.length - 1; i >= 0; i--) if ((todos[i] as FragmentoPlano).unidad <= h.unidad) { pos = i + 1; break; }
    todos.splice(pos, 0, h);
  }
  // Páginas repetidas (un escaneo con hojas duplicadas): el mismo fragmento solo una vez.
  const vistos = new Set<string>();
  for (let i = 0; i < todos.length; i++) {
    const f = todos[i] as FragmentoPlano;
    const clave = `${f.seccion.join('›')}|${f.texto}`;
    if (f.texto.length > 200 && vistos.has(clave)) { todos.splice(i, 1); i--; } else vistos.add(clave);
  }
  // Fuera los fragmentos sin contenido (llamadas de nota sueltas, «† ‡»).
  for (let i = todos.length - 1; i >= 0; i--) if (((todos[i] as FragmentoPlano).texto.match(/\p{L}/gu)?.length ?? 0) < 12) todos.splice(i, 1);
  todos.forEach((f, i) => { f.orden = i; f.texto = f.texto.replace(/\n{3,}/g, '\n\n'); });
  return todos;
}

/** Medios: cada tramo de 30-60 s es un fragmento (ya cortado en fin de frase). */
export function fragmentosDeMedio(unidades: UnidadLeida[]): FragmentoPlano[] {
  return unidades.filter((u) => u.texto.trim()).map((u, i) => ({
    id: nuevoId('fr'), orden: i, unidad: u.orden, texto: u.texto, contexto: '', seccion: [], seccionId: null,
    ancla: u.ancla ?? { tipo: 'tiempo', t0: u.t0 ?? 0, t1: u.t1 ?? 0 }, tokens: contarTokens(u.texto),
  }));
}

export function pasoFragmentos(
  unidades: UnidadLeida[],
  secciones: Seccion[],
  medio: boolean,
  opciones: OpcionesTroceado & { reloj?: () => number } = {},
): { fragmentos: FragmentoPlano[]; procedencia: Procedencia } {
  const reloj = opciones.reloj ?? Date.now;
  const t = reloj();
  const fragmentos = medio ? fragmentosDeMedio(unidades) : trocear(unidades, secciones, opciones);
  const tokens = fragmentos.map((f) => f.tokens).sort((a, b) => a - b);
  return {
    fragmentos,
    procedencia: {
      fase: 'estructura', proveedor: medio ? 'tramos' : 'troceador', ms: reloj() - t,
      detalle: { fragmentos: fragmentos.length, tokensMediana: tokens[Math.floor(tokens.length / 2)] ?? 0, tokensMax: tokens.at(-1) ?? 0, cruzan: fragmentos.filter((f) => f.anclaFin).length },
    },
  };
}

export { limpiarMarkdown };
