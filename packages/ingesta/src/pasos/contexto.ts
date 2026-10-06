/**
 * Paso de contexto: una línea que sitúa cada fragmento en la obra (recuperación
 * contextual al estilo de Anthropic). Una sola llamada al Redactor por sección
 * (o por ventana, si la sección es muy larga o no hay secciones): el texto de la
 * sección va una vez y el modelo escribe todas las líneas de golpe.
 */

import { enParalelo, reintentar, type MetadatosDocumento, type Redactor } from '@scholaris/nucleo';
import type { FragmentoPlano, Procedencia } from '../tipos.js';
import { nombreCompleto } from './autores.js';
import { Cobertura } from '../cobertura.js';

export interface GrupoContexto {
  seccion: string[];
  fragmentos: Array<{ id: string; texto: string; ancla: string }>;
}

const describirAncla = (f: FragmentoPlano): string => {
  const a = f.ancla;
  if (a.tipo === 'pagina') return a.impresa ? `p. ${a.impresa}` : `pág. física ${a.fisica}`;
  if (a.tipo === 'tiempo') { const m = Math.floor(a.t0 / 60), s = Math.round(a.t0 % 60); return `${m}:${String(s).padStart(2, '0')}${a.hablante ? `, ${a.hablante}` : ''}`; }
  if (a.tipo === 'diapositiva') return `diapositiva ${a.n}`;
  return '';
};

/** Agrupa los fragmentos por sección consecutiva, partiendo las secciones largas en ventanas. */
/** Grupos pequeños: la salida se genera en serie, así que 12 fragmentos por llamada terminan antes que 40 (y cuestan lo mismo). */
export function agruparPorSeccion(fragmentos: FragmentoPlano[], maxCaracteres = 30_000, maxFragmentos = 12): GrupoContexto[] {
  const grupos: GrupoContexto[] = [];
  let actual: GrupoContexto | null = null;
  let chars = 0;
  for (const f of fragmentos) {
    const clave = f.seccionId ?? f.seccion.join(' › ');
    const mismo = actual && (actual as GrupoContexto & { clave?: string }).clave === clave;
    if (!actual || !mismo || chars + f.texto.length > maxCaracteres || actual.fragmentos.length >= maxFragmentos) {
      actual = { seccion: f.seccion, fragmentos: [] };
      (actual as GrupoContexto & { clave?: string }).clave = clave;
      grupos.push(actual);
      chars = 0;
    }
    actual.fragmentos.push({ id: f.id, texto: f.texto, ancla: describirAncla(f) });
    chars += f.texto.length;
  }
  return grupos.map(({ seccion, fragmentos }) => ({ seccion, fragmentos }));
}

function ficha(m: MetadatosDocumento): string {
  const autores = m.autores.map(nombreCompleto).join(', ');
  return [m.titulo && `«${m.titulo}»`, autores && `de ${autores}`, m.anio && `(${m.anio})`].filter(Boolean).join(' ');
}

const ESQUEMA = {
  type: 'object',
  properties: {
    contextos: {
      type: 'array',
      items: { type: 'object', properties: { n: { type: 'integer' }, contexto: { type: 'string' } }, required: ['n', 'contexto'] },
    },
  },
  required: ['contextos'],
};

export async function contextualizarGrupo(
  grupo: GrupoContexto,
  metadatos: MetadatosDocumento,
  redactor: Redactor,
  cobertura?: Cobertura,
): Promise<Record<string, string>> {
  const idioma = metadatos.idioma ?? 'el del texto';
  const cuerpo = grupo.fragmentos.map((f, i) => `<fragmento n="${i + 1}"${f.ancla ? ` lugar="${f.ancla}"` : ''}>\n${f.texto}\n</fragmento>`).join('\n');
  const llamar = <T,>(fn: () => Promise<T>) => (cobertura ? cobertura.llamar(fn) : fn());
  const r = await reintentar(() => llamar(() => redactor.generar<{ contextos: Array<{ n: number; contexto: string }> }>({
    sistema:
      'Escribes, para cada fragmento de una obra, UNA línea breve (15-35 palabras) que lo sitúa para un buscador: de qué obra y parte es, ' +
      'quién habla o de qué trata y a qué se refieren los pronombres o elipsis («él», «este método», «la reina»). ' +
      'No resumas la obra entera ni repitas el fragmento; no inventes nada que no esté en el texto. ' +
      `Escribe en ${idioma === 'el del texto' ? 'el idioma del texto' : `el idioma «${idioma}»`}.`,
    mensajes: [{
      rol: 'usuario',
      partes: [{ texto: `Obra: ${ficha(metadatos)}\nSección: ${grupo.seccion.join(' › ') || '(sin título)'}\n\n${cuerpo}\n\nDevuelve una línea de contexto para cada uno de los ${grupo.fragmentos.length} fragmentos, con su número n.` }],
    }],
    esquema: ESQUEMA,
    temperatura: 0.2,
    maxTokens: Math.min(8192, 120 + grupo.fragmentos.length * 90),
    calidad: 'rapida',
  })), { intentos: 3, base: 1500 });
  const salida: Record<string, string> = {};
  for (const c of r.json?.contextos ?? []) {
    const f = grupo.fragmentos[c.n - 1];
    if (f && c.contexto?.trim()) salida[f.id] = c.contexto.trim().replace(/\s+/g, ' ');
  }
  return salida;
}

export async function pasoContexto(
  fragmentos: FragmentoPlano[],
  metadatos: MetadatosDocumento,
  redactor: Redactor,
  opciones: { concurrencia?: number; reloj?: () => number; alGrupo?: (hechos: number, total: number) => void; limiteMs?: number } = {},
): Promise<{ contextos: Record<string, string>; procedencia: Procedencia }> {
  const reloj = opciones.reloj ?? Date.now;
  const t = reloj();
  const grupos = agruparPorSeccion(fragmentos);
  let hechos = 0, fallidos = 0;
  const cobertura = new Cobertura(15_000, 2, reloj);
  const partes = await enParalelo(grupos, opciones.concurrencia ?? 16, async (g) => {
    try {
      const llamada = contextualizarGrupo(g, metadatos, redactor, cobertura);
      if (!opciones.limiteMs) return await llamada;
      // Con límite: un grupo que se atasca (el redactor cae a una reserva lenta) se deja sin
      // contexto; la consolidación lo completa después.
      let temporizador: ReturnType<typeof setTimeout> | undefined;
      const tope = new Promise<Record<string, string>>((_, mal) => { temporizador = setTimeout(() => mal(new Error('tope')), opciones.limiteMs); });
      try { return await Promise.race([llamada, tope]); } finally { clearTimeout(temporizador); }
    }
    catch { fallidos++; return {}; }
    finally { opciones.alGrupo?.(++hechos, grupos.length); }
  });
  const contextos: Record<string, string> = Object.assign({}, ...partes);
  return {
    contextos,
    procedencia: { fase: 'contexto', proveedor: redactor.nombre, ms: reloj() - t, detalle: { grupos: grupos.length, fallidos, cubiertas: cobertura.cubiertas, cubiertos: Object.keys(contextos).length, fragmentos: fragmentos.length } },
  };
}

/**
 * Línea de contexto sin modelo, para los fragmentos que el Redactor no quiso o
 * no pudo situar (filtros de seguridad con textos literarios sobre drogas o
 * violencia, reservas que tardan demasiado): la ficha, la sección y el lugar.
 */
export function contextoExtractivo(f: FragmentoPlano, m: MetadatosDocumento): string {
  const lugar = describirAncla(f);
  const autores = m.autores.map(nombreCompleto).join(', ');
  return [`«${m.titulo}»`, autores, m.anio ? String(m.anio) : '', f.seccion.length ? f.seccion.join(' › ') : '', lugar].filter(Boolean).join(', ') + '.';
}
