/**
 * Las lentes y su elección (docs/COMPRENSION.md, «Lentes»): se eligen solas por
 * el tipo CSL, el tipo de entrada, una muestra del contenido y la disciplina, y
 * se pueden fijar a mano. Un documento puede llevar dos (un documental es cine y
 * argumento; un poema filmado, cine y poesía): la primera manda en la estructura.
 */
import type { Documento, Lente, MetadatosDocumento } from '@scholaris/nucleo';
import type { DefinicionLente } from '../tipos.js';
import { archivo } from './archivo.js';
import { cientifico } from './cientifico.js';
import { cine } from './cine.js';
import { clase } from './clase.js';
import { datos } from './datos.js';
import { documental } from './documental.js';
import { ensayo } from './ensayo.js';
import { entrevista } from './entrevista.js';
import { general } from './general.js';
import { juridico } from './juridico.js';
import { narrativa } from './narrativa.js';
import { periodismo } from './periodismo.js';
import { podcast } from './podcast.js';
import { poesia } from './poesia.js';
import { presentacion } from './presentacion.js';
import { teatro } from './teatro.js';

export { REGLAS_COMUNES, VERSION_COMPRENSION, esquemaFichaGlobal, esquemaFichasSegmento } from './comun.js';

export const DEFINICIONES_LENTES: Readonly<Record<Lente, DefinicionLente>> = {
  narrativa, poesia, teatro, cine, documental, periodismo, entrevista, podcast, clase, ensayo, cientifico, archivo, juridico, datos, presentacion, general,
};

export function lente(id: Lente): DefinicionLente {
  return DEFINICIONES_LENTES[id] ?? general;
}

/** «comprension@1 narrativa@1 cine@1»: la huella de lo que produjo la comprensión. */
export function versionDe(lentes: readonly Lente[], comun: string): string {
  return [comun, ...lentes.map((l) => lente(l).version)].join(' ');
}

// ---------------------------------------------------------------------------
// Elección automática
// ---------------------------------------------------------------------------

/** Lo que se mira para elegir. `muestra` son unos miles de caracteres del principio y del medio. */
export interface EntradaEleccion {
  tipo: Documento['tipo'];
  metadatos: Partial<Pick<MetadatosDocumento, 'tipoCSL' | 'titulo' | 'resumen' | 'coleccion' | 'contenedor'>> & { genero?: string; disciplina?: string };
  muestra: string;
  /** En medios: cuántas voces distintas hay. */
  hablantes?: number;
}

export interface Eleccion {
  lentes: Lente[];
  /** 0-1: por debajo de 0,5, conviene confirmar con el modelo. */
  confianza: number;
  motivo: string;
}

const PALABRAS = (t: string) => t.toLowerCase();

/** Señales del contenido, contadas sobre la muestra. */
export function senales(muestra: string) {
  const lineas = muestra.split('\n').map((l) => l.trim()).filter(Boolean);
  const cortas = lineas.filter((l) => l.length > 0 && l.length <= 60 && !/[.:;]$/.test(l) && !/^[#*|-]/.test(l)).length;
  const dialogoGuion = (muestra.match(/(^|\n)\s*[—–-]\s*[¿¡A-ZÁÉÍÓÚÑ]/g) ?? []).length;
  // Solo cuentan como diálogo las réplicas que abren línea: un ensayo cita entre comillas sin parar.
  const comillasDialogo = (muestra.match(/(^|\n)\s*["“«][^"”»\n]{3,200}["”»]/g) ?? []).length;
  const primeraPersona = (muestra.match(/\b(yo|me|mi|conmigo|nosotros)\b/gi) ?? []).length;
  const pasado = (muestra.match(/\b\w+(aba|ía|ió|aron|ieron)\b/gi) ?? []).length;
  const acotaciones = (muestra.match(/(^|\n)\s*\([^)\n]{5,200}\)/g) ?? []).length;
  const personajesMayus = (muestra.match(/(^|\n)\s*[A-ZÁÉÍÓÚÑ]{3,}(\s[A-ZÁÉÍÓÚÑ]{2,})?\s*[.:—]/g) ?? []).length;
  const academico = (muestra.match(/\b(et al\.|cf\.|ibid|op\. cit\.|vid\.|\(\d{4}\)|\d{4}[a-z]?, p\. \d+|hipótesis|metodolog|resultados|muestra|análisis|abstract|keywords|palabras clave)\b/gi) ?? []).length;
  const imryd = /\b(introducci[oó]n|m[eé]todo|metodolog[ií]a|resultados|discusi[oó]n|conclusiones|introduction|methods|results|discussion)\b/gi;
  const secciones = new Set((muestra.match(imryd) ?? []).map((s) => s.toLowerCase().slice(0, 5))).size;
  const juridico = (muestra.match(/\b(art[íi]culo \d+|disposici[oó]n (adicional|transitoria|final|derogatoria)|real decreto|ley org[aá]nica|boe|apartado \d|cap[íi]tulo [ivx]+)\b/gi) ?? []).length;
  const archivo = (muestra.match(/\b(sepan quantos|sepan cuantos|escriuano|escribano|otorgo|otorgamos|en testimonio de verdad|por ante m[ií]|vezino|vecino de|maravedís|maravedis|reales de vellón|fecho en)\b/gi) ?? []).length;
  const prensa = (muestra.match(/\b(según fuentes|ha declarado|declaró|agencia|efe|europa press|reuters|redacción|corresponsal)\b/gi) ?? []).length;
  return { lineas: lineas.length, cortas, dialogoGuion, comillasDialogo, primeraPersona, pasado, acotaciones, personajesMayus, academico, secciones, juridico, archivo, prensa };
}

/**
 * Elige las lentes sin modelo: tipo CSL, tipo de entrada, género y disciplina,
 * y señales del contenido. Si la confianza sale baja, el plan puede preguntar
 * al modelo rápido (`elegirConModelo`).
 */
export function elegirLentes(e: EntradaEleccion): Eleccion {
  const csl = PALABRAS(e.metadatos.tipoCSL ?? '');
  const pistas = PALABRAS([e.metadatos.genero, e.metadatos.disciplina, e.metadatos.coleccion, e.metadatos.titulo, e.metadatos.resumen].filter(Boolean).join(' '));
  const s = senales(e.muestra);
  const ok = (lentes: Lente[], confianza: number, motivo: string): Eleccion => ({ lentes: [...new Set(lentes)].slice(0, 2), confianza, motivo });

  // Medios.
  if (e.tipo === 'video' || csl === 'motion_picture' || csl === 'broadcast') {
    if (/documental|documentary/.test(pistas)) return ok(['cine', 'documental'], 0.85, 'vídeo documental');
    if (/clase|lecci[oó]n|conferencia|seminario|lecture|curso/.test(pistas)) return ok(['clase', 'cine'], 0.75, 'vídeo de una clase');
    if (/entrevista|interview/.test(pistas) || csl === 'interview') return ok(['entrevista', 'cine'], 0.8, 'entrevista filmada');
    if (/noticiario|telediario|informativo|reportaje/.test(pistas)) return ok(['periodismo', 'cine'], 0.75, 'pieza informativa');
    if (/poema|poes[ií]a|recital/.test(pistas)) return ok(['cine', 'poesia'], 0.7, 'poesía filmada');
    return ok(['cine'], csl === 'motion_picture' ? 0.9 : 0.7, 'vídeo');
  }
  if (e.tipo === 'audio' || csl === 'song' || csl === 'speech') {
    if (csl === 'song' || /canci[oó]n|poema|recital/.test(pistas)) return ok(['poesia'], 0.7, 'canción o recital');
    if (csl === 'speech' || /clase|lecci[oó]n|conferencia|lecture|seminario/.test(pistas)) return ok(['clase'], 0.75, 'clase o conferencia');
    if (csl === 'interview' || /entrevista|interview/.test(pistas)) return ok(['entrevista'], 0.85, 'entrevista');
    if (/podcast|programa|episodio|radio/.test(pistas) || (e.hablantes ?? 0) >= 3) return ok(['podcast'], 0.7, 'pódcast o programa');
    if ((e.hablantes ?? 0) === 2) return ok(['entrevista'], 0.6, 'dos voces');
    return ok(['clase'], 0.45, 'audio de una voz');
  }
  if (e.tipo === 'presentacion') return ok(['presentacion'], 0.9, 'presentación');
  if (e.tipo === 'hoja' || csl === 'dataset') return ok(['datos'], 0.9, 'hoja de datos');

  // Tipos CSL que deciden solos.
  if (['legislation', 'legal_case', 'bill', 'regulation', 'treaty'].includes(csl)) return ok(['juridico'], 0.9, `CSL ${csl}`);
  if (csl === 'manuscript' && (s.archivo > 0 || /archivo|protocolo|legajo|carta|privilegio|escritura/.test(pistas))) return ok(['archivo'], 0.85, 'manuscrito de archivo');
  if (['article-newspaper', 'article-magazine'].includes(csl)) return ok(['periodismo'], 0.85, `CSL ${csl}`);
  if (csl === 'interview') return ok(['entrevista'], 0.85, 'entrevista');
  if (['article-journal', 'paper-conference', 'report', 'thesis', 'preprint'].includes(csl)) {
    return s.secciones >= 3 || /ciencia|science|medic|biolog|f[ií]sica|qu[ií]mica|ingenier|psicolog|econom/.test(pistas)
      ? ok(['cientifico'], 0.85, 'artículo con estructura IMRyD')
      : ok(['ensayo'], 0.75, 'artículo de humanidades');
  }
  if (s.juridico >= 4) return ok(['juridico'], 0.75, 'articulado normativo');
  if (s.archivo >= 2) return ok(['archivo'], 0.7, 'fórmulas notariales o diplomáticas');

  // Literatura y ensayo por el contenido.
  const poesia = /poes[ií]a|poemas|poemario|versos|sonetos|rimas|cancionero/.test(pistas) || (s.lineas >= 8 && s.cortas / s.lineas > 0.7);
  const teatro = /teatro|drama|comedia|tragedia|auto sacramental|entrem[eé]s|sainete/.test(pistas) || (s.personajesMayus >= 6 && s.acotaciones >= 2);
  const narrativa = /novela|cuento|relato|narrativa|nouvelle|f[aá]bula/.test(pistas) || ((s.dialogoGuion + s.comillasDialogo) >= 4 && s.pasado >= 15 && s.academico < 4);
  const ensayoS = /ensayo|filosof|cr[ií]tica|teor[ií]a|historia de|estudio/.test(pistas) || s.academico >= 4;
  if (teatro) return ok(['teatro'], 0.8, 'texto dramático');
  if (poesia && !narrativa) return ok(['poesia'], 0.8, 'verso');
  // Sin pistas de género (título, colección, género), la narración se deduce solo del contenido y es
  // fácil confundirla con un ensayo que cita y cuenta en pasado: que decida el modelo rápido.
  if (narrativa && ensayoS && !/novela|cuento|relato|narrativa|nouvelle|f[aá]bula/.test(pistas)) return ok(['ensayo'], 0.45, 'prosa con citas y relato: dudosa entre ensayo y narración');
  if (narrativa) return ok(['narrativa'], /novela|cuento|relato/.test(pistas) ? 0.9 : 0.45, 'narración');
  if (ensayoS) return ok(['ensayo'], 0.65, 'prosa argumentativa');
  if (['book', 'chapter'].includes(csl)) return ok(['general'], 0.4, 'libro sin señales claras');
  return ok(['general'], 0.35, 'sin señales');
}

/** Esquema de la pregunta al modelo rápido cuando la elección automática duda. */
export const ESQUEMA_ELECCION = {
  type: 'object',
  properties: {
    lentes: { type: 'array', items: { type: 'string', enum: Object.keys(DEFINICIONES_LENTES) }, description: 'Una o dos, la principal primero.' },
    motivo: { type: 'string' },
  },
  required: ['lentes', 'motivo'],
} as const;

export const SISTEMA_ELECCION = `Clasifica un documento por la disciplina con que debe analizarlo un especialista. Lentes posibles: narrativa (cuento, novela), poesia, teatro, cine (película, ficción audiovisual), documental, periodismo, entrevista, podcast, clase (clase, conferencia, lección), ensayo (humanidades, argumentación), cientifico (artículo con método y resultados), archivo (documento histórico de archivo, diplomática), juridico (normas, sentencias), datos (tablas), presentacion (diapositivas), general. Elige una o dos (la principal primero; la segunda solo si la obra pide de verdad las dos). Responde solo con el JSON.`;
