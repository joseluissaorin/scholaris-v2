/**
 * `pnpm bench calidad remapear`: cuando la estantería se reconstruye con SPDF
 * reingeridos (ids de fragmento nuevos, troceado algo distinto), lleva los
 * juicios a los fragmentos nuevos por su huella (los primeros 80 caracteres del
 * pasaje juzgado): el fragmento nuevo que contiene esa huella hereda la nota
 * (la mayor si hereda de varios). Lo que quede sin juzgar lo completa
 * `pool` + `juzgar`, que solo juzga pares nuevos. También remapea las semillas
 * de las consultas y el oro de las citas.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { abrirEstanteria } from './estanteria.js';
import { cargarConsultas, cargarJuicios, guardarJuicios, RUTA_CITAS, RUTA_CONSULTAS, type Juicios } from './juego.js';

const plano = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function remapear(): void {
  const sql = abrirEstanteria();
  const frags = sql.bd.prepare('SELECT id, texto FROM fragmentos').all() as Array<{ id: string; texto: string }>;
  const existe = new Set(frags.map((f) => f.id));
  const planos = frags.map((f) => ({ id: f.id, t: plano(f.texto) }));
  const cache = new Map<string, string | null>();
  /** Fragmento nuevo que contiene la huella (o su primera mitad, por si el corte cayó dentro). */
  const buscar = (huella: string): string | null => {
    if (cache.has(huella)) return cache.get(huella)!;
    const h = plano(huella);
    let r: string | null = null;
    if (h.length >= 12) {
      r = planos.find((f) => f.t.includes(h))?.id ?? null;
      if (!r && h.length >= 40) r = planos.find((f) => f.t.includes(h.slice(0, Math.floor(h.length / 2))))?.id ?? null;
    }
    cache.set(huella, r);
    return r;
  };
  const viejos = cargarJuicios();
  const mapa = new Map<string, string>(); // id viejo → id nuevo
  const nuevos: Juicios = {};
  let llevados = 0, perdidos = 0, mantenidos = 0;
  for (const [q, js] of Object.entries(viejos)) {
    nuevos[q] = {};
    for (const [id, j] of Object.entries(js)) {
      if (j.fuente === 'regla') continue; // las de página se recalculan con `juzgar`
      if (existe.has(id)) { nuevos[q]![id] = j; mantenidos++; continue; }
      const n = j.huella ? buscar(j.huella) : null;
      if (!n) { perdidos++; continue; }
      mapa.set(id, n);
      const previo = nuevos[q]![n];
      if (!previo || previo.nota < j.nota) nuevos[q]![n] = { ...j, huella: (frags.find((f) => f.id === n)?.texto ?? '').slice(0, 80) };
      llevados++;
    }
  }
  guardarJuicios(nuevos);
  const remap = (ids: string[]) => [...new Set(ids.map((x) => (existe.has(x) ? x : mapa.get(x))).filter((x): x is string => !!x))];
  const consultas = cargarConsultas().map((c) => ({ ...c, semilla: remap(c.semilla) }));
  writeFileSync(RUTA_CONSULTAS, JSON.stringify(consultas, null, 1) + '\n');
  const citas = JSON.parse(readFileSync(RUTA_CITAS, 'utf8')) as Array<{ oro: string[]; negativos: string[] }>;
  for (const c of citas) { c.oro = remap(c.oro); c.negativos = remap(c.negativos); }
  writeFileSync(RUTA_CITAS, JSON.stringify(citas, null, 1) + '\n');
  console.error(`Juicios: ${mantenidos} siguen igual, ${llevados} llevados a fragmentos nuevos, ${perdidos} sin destino. Citas sin oro tras remapear: ${citas.filter((c) => !c.oro.length && (c as unknown as { tipo: string }).tipo === 'apoyo').length}.`);
}
