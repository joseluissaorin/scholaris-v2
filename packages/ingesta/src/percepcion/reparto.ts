/**
 * El reparto: quién es quién en toda la obra. Se parte de lo que se sabe
 * (Wikidata P161 con P453, los hablantes de la transcripción) y se completa con
 * lo que ve cada ventana; los nombres que da el modelo se llevan a una sola forma.
 */
import type { PersonaPercibida } from '@scholaris/nucleo';
import type { Http } from '../tipos.js';

export function normalNombre(n: string): string {
  return n.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
}

const VACIAS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'y', 'a', 'un', 'una', 'en', 'con']);
const fichas = (n: string) => normalNombre(n).split(' ').filter((t) => t && !VACIAS.has(t));

/**
 * Lleva cada nombre a su forma canónica: la del reparto conocido si coincide
 * (por el nombre, por el actor o por el nombre de pila sin ambigüedad), y si
 * no, la primera forma con que apareció.
 */
export class Unificador {
  private readonly formas = new Map<string, string>();
  private readonly conocidos: PersonaPercibida[];

  constructor(conocidos: PersonaPercibida[] = []) {
    this.conocidos = conocidos.filter((p) => p.nombre?.trim());
    for (const p of this.conocidos) {
      this.formas.set(normalNombre(p.nombre), p.nombre);
      if (p.actor) this.formas.set(normalNombre(p.actor), p.nombre);
    }
  }

  canonico(nombre: string): string {
    const limpio = nombre.replace(/\s+/g, ' ').trim();
    const n = normalNombre(limpio);
    if (!n) return limpio;
    const directo = this.formas.get(n);
    if (directo) return directo;
    const fs = fichas(limpio);
    // «Diego el artista» → Diego; «David Álvarez» → David (si solo un conocido encaja).
    const contiene = this.conocidos.filter((p) => {
      const fp = fichas(p.nombre);
      if (!fp.length) return false;
      const dentro = fp.every((t) => fs.includes(t)) && fs.length <= fp.length + 2;
      const fuera = fs.length > 0 && fs.every((t) => fp.includes(t));
      return dentro || fuera;
    });
    if (contiene.length === 1) {
      this.formas.set(n, contiene[0]!.nombre);
      return contiene[0]!.nombre;
    }
    this.formas.set(n, limpio);
    return limpio;
  }
}

/**
 * Fusiona fichas de personas con el mismo nombre canónico: los campos que
 * faltan se completan y de las descripciones se queda la más larga.
 */
export function fusionarReparto(listas: PersonaPercibida[][], u: Unificador): PersonaPercibida[] {
  const por = new Map<string, PersonaPercibida>();
  for (const lista of listas) {
    for (const p of lista) {
      if (!p?.nombre?.trim()) continue;
      const nombre = u.canonico(p.nombre);
      const previa = por.get(nombre);
      if (!previa) { por.set(nombre, { ...limpiarPersona(p), nombre }); continue; }
      const masLarga = (a?: string, b?: string) => ((b?.length ?? 0) > (a?.length ?? 0) ? b : a);
      const d = masLarga(previa.descripcionVisual, p.descripcionVisual);
      const v = masLarga(previa.voz, p.voz);
      por.set(nombre, {
        ...previa,
        ...(previa.ficticia === undefined && p.ficticia !== undefined ? { ficticia: p.ficticia } : {}),
        ...(!previa.actor && p.actor ? { actor: p.actor } : {}),
        ...(d ? { descripcionVisual: d } : {}),
        ...(v ? { voz: v } : {}),
      });
    }
  }
  return [...por.values()];
}

function limpiarPersona(p: PersonaPercibida): PersonaPercibida {
  return {
    nombre: p.nombre.trim(),
    ...(typeof p.ficticia === 'boolean' ? { ficticia: p.ficticia } : {}),
    ...(p.actor?.trim() ? { actor: p.actor.trim() } : {}),
    ...(p.descripcionVisual?.trim() ? { descripcionVisual: p.descripcionVisual.trim() } : {}),
    ...(p.voz?.trim() ? { voz: p.voz.trim() } : {}),
  };
}

/**
 * Separa los personajes (o personas con nombre propio en la obra) de los
 * intérpretes sin papel conocido: Wikidata a veces da el reparto sin P453, y un
 * actor no es un personaje de la obra. Los intérpretes se le dan al modelo
 * aparte, para que diga quién interpreta a quién.
 */
export function separarInterpretes(reparto: PersonaPercibida[] = []): { personajes: PersonaPercibida[]; interpretes: string[] } {
  const personajes: PersonaPercibida[] = [];
  const interpretes: string[] = [];
  for (const p of reparto) {
    if (p.actor && p.ficticia === undefined && normalNombre(p.actor) === normalNombre(p.nombre)) interpretes.push(p.actor);
    else personajes.push(p);
  }
  return { personajes, interpretes };
}

/** Reparto inicial: el que se da y los hablantes con nombre de la transcripción que no estén ya. */
export function repartoInicial(dado: PersonaPercibida[] = [], hablantes: string[] = []): PersonaPercibida[] {
  const u = new Unificador(dado);
  const out = dado.map(limpiarPersona);
  const vistos = new Set(out.map((p) => p.nombre));
  for (const h of hablantes) {
    const c = u.canonico(h);
    if (!vistos.has(c)) { vistos.add(c); out.push({ nombre: c }); }
  }
  return out;
}

/**
 * El reparto de una obra en Wikidata: P161 (reparto) con el personaje (P453) o
 * el nombre del papel (P4633). Las personas sin papel conocido van como reales.
 */
export async function repartoDeWikidata(qid: string, http: Http = (u, i) => fetch(u, i), idioma = 'es'): Promise<PersonaPercibida[]> {
  if (!/^Q\d+$/.test(qid)) return [];
  const consulta = `SELECT ?actorLabel ?personajeLabel ?papel WHERE {
    wd:${qid} p:P161 ?st . ?st ps:P161 ?actor .
    OPTIONAL { ?st pq:P453 ?personaje . }
    OPTIONAL { ?st pq:P4633 ?papel . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "${idioma},en". }
  }`;
  const r = await http(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(consulta)}`, { headers: { accept: 'application/sparql-results+json', 'user-agent': 'Scholaris/2 (https://scholaris.joseluissaorin.com)' } });
  if (!r.ok) return [];
  const j = (await r.json()) as { results?: { bindings?: Array<Record<string, { value: string } | undefined>> } };
  const out: PersonaPercibida[] = [];
  const vistos = new Set<string>();
  for (const b of j.results?.bindings ?? []) {
    const actor = b.actorLabel?.value;
    const personaje = b.personajeLabel?.value ?? b.papel?.value;
    const valido = (x?: string) => x && !/^Q\d+$/.test(x);
    if (!valido(actor)) continue;
    const nombre = valido(personaje) ? personaje! : actor!;
    const clave = `${nombre}|${actor}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(valido(personaje) ? { nombre: personaje!, ficticia: true, actor: actor! } : { nombre: actor!, actor: actor! });
  }
  return out;
}
