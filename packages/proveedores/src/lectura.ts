/**
 * Lo que comparten todos los lectores: las instrucciones, el esquema JSON de
 * la respuesta, la normalización a `PaginaLeida` y los controles de calidad
 * que usa la cascada para decidir si pasa al siguiente lector.
 *
 * Decisiones de transcripción (documentadas aquí y en el prompt):
 *
 * - **Fidelidad ortográfica.** Nada de modernizar: «dixo», «assi», «muger»,
 *   «dirè», «Cauallero», la u/v, la i/j/y, la ç, las tildes y los apóstrofos se
 *   copian como están impresos. Tampoco se corrigen erratas.
 * - **La s larga (ſ) se transcribe como «s».** Es un alógrafo tipográfico, no
 *   una grafía con valor ortográfico (como la forma de la r redonda), y es la
 *   norma de casi todas las ediciones filológicas. Además, conservarla rompe la
 *   búsqueda léxica («ſobre» no casa con «sobre») y es precisamente la letra que
 *   el OCR confunde con la «f» («fobre», «defvelas»): pedir «s» al modelo le
 *   obliga a decidir entre ſ y f, que es lo que interesa. Quien quiera la
 *   transcripción diplomática pasa `sLarga: 'conservar'`.
 * - Las abreviaturas y ligaduras se dejan como están (q̃ → «q̃», «&»), salvo
 *   las ligaduras puramente tipográficas (ﬁ, ﬂ, æ en tipos modernos) que se
 *   escriben con sus letras.
 * - Prosa: las líneas se unen en párrafos y se rehacen las palabras partidas
 *   con guion a final de línea. Verso: un verso por línea. Teatro: el nombre
 *   del personaje como aparece impreso («Cel.», «BEL.»), al principio del
 *   parlamento.
 * - Cabecera (titulillo), pie, folio, reclamo y signatura de pliego van fuera
 *   del cuerpo: el reclamo y la signatura («A2», «B»), en `pie`.
 */

import type { PaginaLeida } from '@scholaris/nucleo';

export interface OpcionesTranscripcion {
  /** Qué hacer con la s larga. Por defecto, «s». */
  sLarga?: 'normalizar' | 'conservar';
  /** Pedir regiones de figuras (cuesta algo de salida). Por defecto, sí. */
  figuras?: boolean;
}

export function instruccionesLector(n: number, primeraFisica: number, pista: string | undefined, o: OpcionesTranscripcion = {}, origen: 'pdf' | 'imagenes' = 'pdf'): string {
  const ultima = primeraFisica + n - 1;
  const sLarga = o.sLarga === 'conservar'
    ? 'Copia la s larga como «ſ».'
    : 'La s larga (ſ) se escribe «s»; fíjate bien en el trazo para no confundirla con la «f» (ſobre → «sobre», no «fobre»; deſvelas → «desvelas»).';
  return [
    `Eres un paleógrafo y tipógrafo experto. Transcribe ${n === 1 ? 'la página' : `las ${n} páginas`} ${origen === 'pdf' ? 'de este PDF' : 'de estas imágenes, en el orden en que llegan'}.`,
    `Son las páginas físicas ${primeraFisica}${n > 1 ? ` a ${ultima}` : ''} del documento: devuelve exactamente ${n} ${n === 1 ? 'objeto' : 'objetos'} en «paginas», uno por página, en orden, con «fisica» de ${primeraFisica} a ${ultima}.`,
    pista ? `Contexto del documento: ${pista}` : '',
    '',
    'Reglas de transcripción:',
    '1. Fidelidad absoluta. Copia exactamente lo impreso: NO modernices la ortografía (deja «dixo», «assi», «muger», «Cauallero», «dirè», u/v, i/j/y, ç, tildes y acentos tal como aparecen), NO corrijas erratas, NO traduzcas, NO resumas, NO inventes ni completes texto ilegible: marca lo ilegible con «[…]».',
    `2. ${sLarga} Las ligaduras tipográficas (ﬁ, ﬂ) se escriben con sus letras; las abreviaturas se dejan como están.`,
    '3. «texto» es SOLO el cuerpo de la página, en Markdown ligero: títulos con # según su nivel, *cursiva* y **negrita** solo donde lo están en el impreso, listas y tablas en Markdown. En prosa une las líneas en párrafos (línea en blanco entre párrafos) y junta las palabras partidas con guion al final de línea. En verso, un verso por línea. En teatro, el nombre del personaje tal como aparece («Cel.», «BEL.») al principio de su parlamento, y las acotaciones en cursiva.',
    '4. Fuera del cuerpo: «cabecera» = titulillo o encabezado corriente (sin el número de página); «pie» = pie de página, reclamo y signatura de pliego (p. ej. «A2»); «notas» = cada nota al pie como un elemento, con su llamada («1», «*», «a») al principio. En el cuerpo deja la llamada de nota en su sitio como [^1].',
    '5. «folio» = el número de página IMPRESO tal como se ve («23», «xiv», «A-3»), o "" si la página no lo lleva. Nunca lo deduzcas ni lo calcules: solo lo que está escrito. La signatura de pliego no es el folio.',
    '6. «titulos» = los títulos de sección que EMPIEZAN en esta página, con su nivel (1 = parte o capítulo, 2 = sección, 3 = subsección…), copiados igual que en el cuerpo.',
    o.figuras === false
      ? '7. «figuras» = lista vacía.'
      : '7. «figuras» = ilustraciones, grabados, gráficos, esquemas o tablas que son imagen: su pie tal cual (o "" si no lo tiene), una descripción breve en el idioma del documento, y su región normalizada 0-1 (x, y desde la esquina superior izquierda, w, h). Los adornos tipográficos, viñetas y capitulares no son figuras.',
    '8. «vacia» = true si la página no tiene texto (en blanco, guarda, lámina sin texto). Una página con solo una figura no está vacía si la figura tiene pie.',
    '9. «idioma» = código BCP-47 del cuerpo («es», «la», «en», «fr»…). «confianza» = 0-1, cuánta seguridad tienes en tu transcripción de esa página.',
  ].filter((l) => l !== '').join('\n');
}

/** Esquema JSON (subconjunto compatible con Gemini `responseJsonSchema` y con `json_schema` estricto de OpenAI). */
export const ESQUEMA_PAGINAS = {
  type: 'object',
  properties: {
    paginas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fisica: { type: 'integer' },
          vacia: { type: 'boolean' },
          cabecera: { type: 'string' },
          folio: { type: 'string' },
          titulos: {
            type: 'array',
            items: {
              type: 'object',
              properties: { nivel: { type: 'integer' }, texto: { type: 'string' } },
              required: ['nivel', 'texto'],
              additionalProperties: false,
            },
          },
          texto: { type: 'string' },
          notas: { type: 'array', items: { type: 'string' } },
          pie: { type: 'string' },
          figuras: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                pie: { type: 'string' },
                descripcion: { type: 'string' },
                region: {
                  type: 'object',
                  properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
                  required: ['x', 'y', 'w', 'h'],
                  additionalProperties: false,
                },
              },
              required: ['pie', 'descripcion', 'region'],
              additionalProperties: false,
            },
          },
          idioma: { type: 'string' },
          confianza: { type: 'number' },
        },
        required: ['fisica', 'vacia', 'cabecera', 'folio', 'titulos', 'texto', 'notas', 'pie', 'figuras', 'idioma', 'confianza'],
        additionalProperties: false,
      },
    },
  },
  required: ['paginas'],
  additionalProperties: false,
} as const;

interface PaginaCruda {
  fisica?: unknown; vacia?: unknown; cabecera?: unknown; folio?: unknown; titulos?: unknown; texto?: unknown;
  notas?: unknown; pie?: unknown; figuras?: unknown; idioma?: unknown; confianza?: unknown;
}

const cadena = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num01 = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

/** Página de relleno cuando el lector no devolvió una: confianza 0 para que la cascada la repita. */
export function paginaFaltante(fisica: number): PaginaLeida {
  return { fisica, texto: '', notas: [], cabecera: '', pie: '', folio: null, titulos: [], figuras: [], vacia: false, confianza: 0 };
}

function aPagina(c: PaginaCruda, fisica: number, sLarga: 'normalizar' | 'conservar'): PaginaLeida {
  const arreglar = (s: string) => {
    let t = s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    t = t.replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl');
    if (sLarga === 'normalizar') t = t.replace(/ſ/g, 's');
    return t;
  };
  const folioCrudo = arreglar(cadena(c.folio)).replace(/^[[(]|[\])]$/g, '').trim();
  const titulos = Array.isArray(c.titulos)
    ? (c.titulos as Array<{ nivel?: unknown; texto?: unknown }>)
        .map((t) => ({ nivel: Math.min(6, Math.max(1, Math.round(Number(t?.nivel) || 1))), texto: arreglar(cadena(t?.texto)).replace(/^#+\s*/, '') }))
        .filter((t) => t.texto)
    : [];
  const figuras = Array.isArray(c.figuras)
    ? (c.figuras as Array<{ pie?: unknown; descripcion?: unknown; region?: { x?: unknown; y?: unknown; w?: unknown; h?: unknown } }>).map((f) => {
        const r = f?.region;
        const region = r && [r.x, r.y, r.w, r.h].every((v) => typeof v === 'number' && Number.isFinite(v))
          ? normalizarRegion({ x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number })
          : undefined;
        const pie = arreglar(cadena(f?.pie));
        const descripcion = cadena(f?.descripcion).trim();
        return { ...(pie ? { pie } : {}), ...(descripcion ? { descripcion } : {}), ...(region ? { region } : {}) };
      })
    : [];
  const texto = arreglar(cadena(c.texto));
  const idioma = cadena(c.idioma).trim();
  return {
    fisica,
    texto,
    notas: Array.isArray(c.notas) ? (c.notas as unknown[]).map((n) => arreglar(cadena(n))).filter(Boolean) : [],
    cabecera: arreglar(cadena(c.cabecera)),
    pie: arreglar(cadena(c.pie)),
    folio: folioCrudo ? folioCrudo : null,
    titulos,
    figuras,
    vacia: c.vacia === true && texto.length < 40,
    ...(idioma ? { idioma } : {}),
    confianza: num01(c.confianza, 0.8),
  };
}

/** Regiones en 0-1. Si el modelo devolvió 0-1000 (convención de Gemini para cajas), se escala. */
export function normalizarRegion(r: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const escala = Math.max(r.x, r.y, r.w, r.h) > 1.5 ? 1000 : 1;
  const c = (v: number) => Math.min(1, Math.max(0, v / escala));
  return { x: c(r.x), y: c(r.y), w: c(r.w), h: c(r.h) };
}

/**
 * Convierte la respuesta del modelo en exactamente `n` páginas con `fisica`
 * absoluta (`primeraFisica`, `primeraFisica + 1`…). Acepta que el modelo
 * numere en relativo (1…n) o en absoluto; si sobran o faltan páginas, se
 * rellenan con páginas de confianza 0 que la cascada volverá a pedir.
 */
export function normalizarPaginas(json: unknown, n: number, primeraFisica: number, o: OpcionesTranscripcion = {}): PaginaLeida[] {
  const lista: PaginaCruda[] = Array.isArray(json) ? json : Array.isArray((json as { paginas?: unknown })?.paginas) ? (json as { paginas: PaginaCruda[] }).paginas : [];
  const sLarga = o.sLarga ?? 'normalizar';
  const salida: PaginaLeida[] = [];
  const nums = lista.map((p) => Number(p?.fisica));
  const absolutas = nums.every((x) => Number.isInteger(x) && x >= primeraFisica && x < primeraFisica + n);
  const relativas = !absolutas && nums.every((x) => Number.isInteger(x) && x >= 1 && x <= n);
  const porIndice = new Map<number, PaginaCruda>();
  lista.forEach((p, i) => {
    const idx = absolutas ? (nums[i] as number) - primeraFisica : relativas ? (nums[i] as number) - 1 : i;
    if (idx >= 0 && idx < n && !porIndice.has(idx)) porIndice.set(idx, p);
  });
  for (let i = 0; i < n; i++) {
    const c = porIndice.get(i);
    salida.push(c ? aPagina(c, primeraFisica + i, sLarga) : paginaFaltante(primeraFisica + i));
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Calidad
// ---------------------------------------------------------------------------

/** Proporción de caracteres «raros» (ni letras, ni números, ni puntuación habitual). */
export function proporcionBasura(texto: string): number {
  const t = texto.replace(/\s+/g, '');
  if (!t) return 0;
  let raros = 0;
  for (const ch of t) {
    if (/[\p{L}\p{N}]/u.test(ch)) continue;
    if (/[.,;:!?¡¿'"«»“”‘’()[\]{}\-–—_/\\*#&%$€£@+=<>|~^`…·•§¶†‡°ºª]/.test(ch)) continue;
    raros++;
  }
  return raros / t.length;
}

/** Detecta bucles de repetición (el fallo típico de los modelos de visión pequeños). */
export function hayBucle(texto: string): boolean {
  const lineas = texto.split('\n').map((l) => l.trim()).filter((l) => l.length > 3);
  if (lineas.length >= 8) {
    const cuenta = new Map<string, number>();
    for (const l of lineas) cuenta.set(l, (cuenta.get(l) ?? 0) + 1);
    const max = Math.max(...cuenta.values());
    if (max >= 6 && max / lineas.length > 0.4) return true;
  }
  // Una misma secuencia corta repetida muchas veces seguidas.
  return /(.{4,40}?)\1{12,}/s.test(texto);
}

export interface VeredictoCalidad {
  aceptable: boolean;
  motivo?: string;
}

/** ¿Es aceptable esta página o hay que pasarla al siguiente lector? */
export function evaluarPagina(p: PaginaLeida, opciones: { maxBasura?: number; minConfianza?: number; minCaracteres?: number } = {}): VeredictoCalidad {
  const maxBasura = opciones.maxBasura ?? 0.15;
  const minConfianza = opciones.minConfianza ?? 0.2;
  const minCaracteres = opciones.minCaracteres ?? 15;
  if (p.vacia) return { aceptable: true };
  if (p.confianza < minConfianza) return { aceptable: false, motivo: `confianza ${p.confianza.toFixed(2)}` };
  const todo = [p.texto, ...p.notas].join('\n');
  const largo = todo.trim().length + p.cabecera.trim().length + p.pie.trim().length;
  // Sin nada de texto y sin figuras: si el modelo está seguro, es una página en blanco mal marcada
  // (portadas, guardas); si duda, se repite con el siguiente lector.
  if (largo === 0 && p.figuras.length === 0) {
    return p.confianza >= 0.8 ? { aceptable: true } : { aceptable: false, motivo: 'sin texto en una página no vacía' };
  }
  // Un texto corto («I», «PARTE PRIMERA») es legítimo: solo se miran basura y bucles si hay de qué.
  if (todo.trim().length < minCaracteres) return { aceptable: true };
  const basura = proporcionBasura(todo);
  if (basura > maxBasura) return { aceptable: false, motivo: `basura ${(basura * 100).toFixed(0)} %` };
  if (hayBucle(todo)) return { aceptable: false, motivo: 'bucle de repetición' };
  return { aceptable: true };
}
