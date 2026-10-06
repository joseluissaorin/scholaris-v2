/**
 * Port fiel de `ScholarisWeb/backend/app/services/page_deducer.py` (v3).
 *
 * Numeración secuencial por zonas a partir de varias señales:
 *
 * 1. Anclas: lecturas fiables del folio (y zonas del VLM con su desplazamiento).
 * 2. Análisis del contenido: marcadores estructurales en el texto (CAPÍTULO,
 *    PRÓLOGO, ÍNDICE…) en una treintena de lenguas.
 * 3. Transición: la página física donde acaban los romanos y empiezan los arábigos.
 * 4. Propagación: desde las anclas y la transición se rellena cada página de
 *    forma aritmética dentro de su zona (romanos y arábigos crecen +1 por página;
 *    en doble página, +2).
 *
 * Convención de v3, que se conserva aquí: los romanos son enteros NEGATIVOS
 * (i = -1, ix = -9). `folios.ts` la traduce a `AnclaPagina`.
 *
 * Las diferencias con el original son solo de forma (nombres en español, mapas
 * en vez de diccionarios); el comportamiento es el mismo, incluidas sus
 * limitaciones (un único desplazamiento por zona). La capa de `folios.ts`
 * añade encima la interpolación por tramos y las láminas.
 */

export type Marcador = 'chapter_start' | 'contents' | 'preface' | 'introduction' | 'index' | 'bibliography' | 'appendix';

export type EstrategiaDeduccion = 'detectado' | 'deducido' | 'ninguno';
export type TipoPaginaDeduccion = 'portada' | 'blanca' | 'preliminar' | 'contenido' | 'final';
export type DisposicionDeduccion = 'SINGLE' | 'TWO_UP' | 'TWO_UP_RTL';

export interface Correspondencia {
  fisica: number;
  /** Folio con la convención v3: negativo = romano. null = sin número (portada). */
  folio: number | null;
  /** En doble página: [izquierda, derecha]. */
  folios?: [number, number];
  tipo: TipoPaginaDeduccion;
  confianza: number;
  origen: 'detectado' | 'deducido';
}

export interface ResultadoDeduccion {
  estrategia: EstrategiaDeduccion;
  disposicion: DisposicionDeduccion;
  correspondencias: Correspondencia[];
  primeraPaginaContenido: number;
  numeroInicial: number;
  totalDetectadas: number;
  totalDeducidas: number;
  transicion: number | null;
  /** Marcadores estructurales encontrados (página física → marcador). */
  marcadores: Map<number, Marcador>;
  /** Primera página numerada (antes: portada y guardas). */
  primeraNumerada: number;
  /** Anclas tras los filtros (convención v3). */
  anclasRomanas: Map<number, number>;
  anclasArabigas: Map<number, number>;
}

/** Zona de numeración del VLM: folio = física + desplazamiento. */
export interface ZonaNumeracion {
  tipo: 'arabic' | 'roman' | 'compound' | 'letter' | 'none' | 'uncertain';
  desde: number;
  hasta: number;
  desplazamiento: number | null;
  confianza: number;
}

export interface EntradaDeduccion {
  totalPaginas: number;
  disposicion?: DisposicionDeduccion;
  /** Confianza del OCR por página física. */
  confianzas?: Map<number, number>;
  /** Anclas: página física → { folio (negativo si romano), confianza }. */
  anclas?: Map<number, { folio: number; confianza: number }>;
  zonas?: ZonaNumeracion[];
  transiciones?: number[];
  /** Primeros ~300 caracteres del texto de cada página. */
  textos?: Map<number, string>;
  /** Marcadores de secciones detectados por un modelo (complementan las expresiones). */
  marcadoresExtra?: Map<number, Marcador>;
  /** Marcadores de capítulo estrictos (no está en el original; por defecto, como el original). */
  marcadoresEstrictos?: boolean;
  /** Registro de diagnóstico (el original usa logging). */
  registro?: (mensaje: string) => void;
}

// ---------------------------------------------------------------------------
// Marcadores estructurales (primeros ~300 caracteres de cada página)
// ---------------------------------------------------------------------------

const re = (fuente: string, flags = 'u') => new RegExp(fuente, flags);

export const MARCADORES: Array<[Marcador, RegExp]> = [
  // CAPÍTULO / PARTE: inicio del cuerpo
  ['chapter_start', re(
    '^\\s*(?:' +
    'CHAPTER|CHAPITRE|CAP[ÍI]TULO|CAPITOLO|KAPITEL|KAPITTEL|KAPITOLA' +
    '|HOOFDSTUK|ROZDZIA[ŁL]|FEJEZET|LUKU|CAPITOL|BAB|CABA[ÍI]DIL' +
    '|POGLAVLJE|ГЛАВА|РОЗДІЛ' +
    '|ΚΕΦ[ΑΆ]ΛΑΙΟ' +
    '|CAPUT' +
    ')\\s+[IVXLCDM\\d]', 'iu')],
  ['chapter_start', re(
    '^\\s*(?:' +
    'PART|PARTIE|PARTE|TEIL|DEEL|DEL|OSA|RÉSZ|ČÁST|CZĘŚ[ĆC]' +
    '|ЧАСТЬ|ΜΕΡΟΣ|PARS|KISIM|BÖLÜM' +
    ')\\s+[IVXLCDM\\d]', 'iu')],
  ['chapter_start', re('第\\s*[\\d一二三四五六七八九十百]+\\s*[章部篇]')],
  ['chapter_start', re('제\\s*[\\d일이삼사오육칠팔구십]+\\s*[장부]')],
  ['chapter_start', re('^\\s*(?:الفصل|الباب)\\s+[\\d\\u0660-\\u0669]')],
  ['chapter_start', re('^\\s*פרק\\s+[\\dא-ת]')],
  ['chapter_start', re('^\\s*अध्याय\\s+[\\d\\u0966-\\u096F]')],
  ['chapter_start', re('^\\s*บทที่\\s*[\\d๐-๙]')],
  ['chapter_start', re('^\\s*فصل\\s+[\\d\\u06F0-\\u06F9]')],

  // ÍNDICE / SUMARIO: preliminares
  ['contents', re(
    '^\\s*(?:' +
    'CONTENTS|TABLE\\s+OF\\s+CONTENTS' +
    '|TABLE\\s+DES\\s+MATI[ÈE]RES|SOMMAIRE' +
    '|[ÍI]NDICE(?:\\s+(?:GENERAL|DE\\s+CONTENIDOS?))?' +
    '|SUM[ÁA]RIO|CONTE[ÚU]DO' +
    '|INDICE|SOMMARIO' +
    '|INHALTSVERZEICHNIS|INHALT' +
    '|INHOUDSOPGAVE|INHOUD' +
    '|INNEH[ÅA]LL(?:SFÖRTECKNING)?' +
    '|INNHOLD(?:SFORTEGNELSE)?' +
    '|INDHOLD(?:SFORTEGNELSE)?' +
    '|SIS[ÄA]LLYSLUETTELO|SIS[ÄA]LT[ÖO]' +
    '|SPIS\\s+TRE[ŚS]CI' +
    '|OBSAH' +
    '|TARTALOMJEGYZ[ÉE]K|TARTALOM' +
    '|CUPRINS' +
    '|İ[ÇC]İNDEK[İI]LER' +
    '|СОДЕРЖАНИЕ|ОГЛАВЛЕНИЕ' +
    '|ΠΕΡΙΕΧ[ΌO]ΜΕΝΑ' +
    '|DAFTAR\\s+ISI' +
    ')', 'iu')],
  ['contents', re('^\\s*目\\s*[次录錄]')],
  ['contents', re('^\\s*목\\s*차')],
  ['contents', re('^\\s*(?:المحتويات|فهرس(?:ت)?|الفهرس)')],
  ['contents', re('^\\s*תוכן\\s+העני[יו]נים')],
  ['contents', re('^\\s*विषय\\s+सूची')],
  ['contents', re('^\\s*สารบัญ')],

  // PRÓLOGO / PREFACIO: preliminares
  ['preface', re(
    '^\\s*(?:' +
    'PREFACE|FOREWORD|PREF[ÁA]CIO|PREFACIO' +
    '|PR[ÉE]FACE|AVANT[\\s-]PROPOS' +
    '|PR[ÓO]LOGO' +
    '|PREFAZIONE|PREMESSA' +
    '|VORWORT|GELEITWORT' +
    '|VOORWOORD' +
    '|F[ÖO]RORD|FORORD' +
    '|ESIPUHE' +
    '|PRZEDMOWA|WST[ĘE]P' +
    '|P[ŘR]EDMLUVA' +
    '|EL[ŐO]SZ[ÓO]' +
    '|PREFA[ȚT][ĂA]|CUV[ÂA]NT\\s+[ÎI]NAINTE' +
    '|[ÖO]NS[ÖO]Z' +
    '|ПРЕДИСЛОВИЕ' +
    '|ΠΡ[ΌO]ΛΟΓΟΣ' +
    '|PRAEFATIO' +
    ')', 'iu')],
  ['preface', re('^\\s*(?:序[文言]|前[言書书]|はしがき|まえがき)')],
  ['preface', re('^\\s*(?:서문|머리말)')],
  ['preface', re('^\\s*(?:تمهيد|مقدمة\\s+الكتاب)')],
  ['preface', re('^\\s*הקדמה')],
  ['preface', re('^\\s*(?:प्रस्तावना|भूमिका)')],
  ['preface', re('^\\s*คำนำ')],

  // INTRODUCCIÓN: preliminar o inicio del cuerpo, según el contexto
  ['introduction', re(
    '^\\s*(?:' +
    'INTRODUCTION' +
    '|INTRODUCCI[ÓO]N|INTRODUÇÃO|INTRODUZIONE' +
    '|EINLEITUNG|EINF[ÜU]HRUNG' +
    '|INLEIDING' +
    '|INLEDNING|INNLEDNING|INDLEDNING' +
    '|JOHDANTO' +
    '|WPROWADZENIE' +
    '|[ÚU]VOD' +
    '|BEVEZET[ÉE]S' +
    '|INTRODUCERE' +
    '|GİRİŞ' +
    '|ВВЕДЕНИЕ' +
    '|ΕΙΣΑΓΩΓ[ΉH]' +
    '|PENGANTAR' +
    ')', 'iu')],
  ['introduction', re('^\\s*(?:序論|緒論|はじめに|引[言论論]|导论|導論|绪论|緒論)')],
  ['introduction', re('^\\s*서론')],
  ['introduction', re('^\\s*مقدمة(?!\\s+الكتاب)')],
  ['introduction', re('^\\s*מבוא')],
  ['introduction', re('^\\s*परिचय')],

  // ÍNDICE ANALÍTICO: final
  ['index', re(
    '^\\s*(?:' +
    '(?:SUBJECT\\s+|NAME\\s+|AUTHOR\\s+)?INDEX' +
    '|[ÍI]NDICE\\s+(?:ANAL[ÍI]TICO|DE\\s+NOMBRES|REMISSIVO|ONOMÁSTICO)' +
    '|INDICE\\s+(?:ANALITICO|DEI\\s+NOMI)' +
    '|(?:SACH|NAMEN|STICHWORT)(?:REGISTER|VERZEICHNIS)' +
    '|REGISTER' +
    '|REJST[ŘR][ÍI]K' +
    '|SKOROWIDZ|INDEKS' +
    '|T[ÁA]RGYMUTAT[ÓO]|N[ÉE]VMUTAT[ÓO]' +
    '|HAKEMISTO' +
    '|D[İI]Z[İI]N' +
    '|УКАЗАТЕЛЬ|ИМЕННОЙ\\s+УКАЗАТЕЛЬ' +
    '|ΕΥΡΕΤ[ΉH]ΡΙΟ' +
    ')', 'iu')],
  ['index', re('^\\s*索引')],
  ['index', re('^\\s*색인')],
  ['index', re('^\\s*(?:فهرس\\s+الأعلام|فهرس\\s+الموضوعات)')],
  ['index', re('^\\s*מפתח')],
  ['index', re('^\\s*अनुक्रमणिका')],

  // BIBLIOGRAFÍA: final
  ['bibliography', re(
    '^\\s*(?:' +
    'BIBLIOGRAPHY|REFERENCES|WORKS\\s+CITED|SOURCES' +
    '|BIBLIOGRA(?:PH|F)[ÍI][AE]|REFERENCIAS' +
    '|BIBLIOGRAFIA|RIFERIMENTI' +
    '|LITERATURVERZEICHNIS|BIBLIOGRAPHIE|QUELLENVERZEICHNIS' +
    '|BIBLIOGRAFIE|LITERATUURLIJST' +
    '|LITTERATURF[ÖO]RTECKNING|LITTERATURLISTE' +
    '|KIRJALLISUUS|L[ÄA]HDELUETTELO' +
    '|KAYNAKÇA|KAYNAKLAR' +
    '|БИБЛИОГРАФИЯ|ЛИТЕРАТУРА|СПИСОК\\s+ЛИТЕРАТУРЫ' +
    '|ΒΙΒΛΙΟΓΡΑΦ[ΊI]Α' +
    '|DAFTAR\\s+PUSTAKA' +
    ')', 'iu')],
  ['bibliography', re('^\\s*(?:参考文献|參考文獻|引用文献)')],
  ['bibliography', re('^\\s*참고문헌')],
  ['bibliography', re('^\\s*(?:المراجع|قائمة\\s+المراجع)')],
  ['bibliography', re('^\\s*ביבליוגרפיה')],
  ['bibliography', re('^\\s*(?:संदर्भ\\s+सूची|ग्रंथ\\s+सूची)')],

  // APÉNDICE: final
  ['appendix', re(
    '^\\s*(?:' +
    'APPENDIX|APPENDICE|AP[ÉE]NDICE|ANEXO' +
    '|ANNEXE' +
    '|ANHANG|ANLAGE' +
    '|BIJLAGE' +
    '|BILAGA|VEDLEGG|TILLEGG|BILAG' +
    '|LIITE' +
    '|DODATEK|ZA[ŁL][ĄA]CZNIK|ANEKS' +
    '|P[ŘR][ÍI]LOHA' +
    '|F[ÜU]GGEL[ÉE]K|MELL[ÉE]KLET' +
    '|ANEX[ĂA]' +
    '|EK(?:\\s+\\d)?' +
    '|ПРИЛОЖЕНИЕ' +
    '|ΠΑΡ[ΆA]ΡΤΗΜΑ' +
    '|LAMPIRAN' +
    ')', 'iu')],
  ['appendix', re('^\\s*(?:付録|附[録录錄])')],
  ['appendix', re('^\\s*부록')],
  ['appendix', re('^\\s*(?:ملحق|ملاحق)')],
  ['appendix', re('^\\s*נספח')],
  ['appendix', re('^\\s*परिशिष्ट')],
];

export const MARCADORES_PRELIMINARES = new Set<Marcador>(['contents', 'preface']);
export const MARCADORES_INICIO_CUERPO = new Set<Marcador>(['chapter_start', 'introduction']);
export const MARCADORES_FINALES = new Set<Marcador>(['index', 'bibliography', 'appendix']);

/** Los dos patrones de capítulo/parte en alfabeto latino (los que admiten «Del mismo modo…»). */
const CAPITULO_LATINO = new Set<RegExp>([(MARCADORES[0] as [Marcador, RegExp])[1], (MARCADORES[1] as [Marcador, RegExp])[1]]);

/**
 * Paso 1: busca marcadores estructurales al principio del texto de cada página.
 *
 * `estricto` (no está en el original) exige que tras «CHAPTER», «PARTE», «DEL»…
 * venga un número o un romano en mayúsculas completo: sin él, una página que
 * empieza por «Del mismo modo» o «Parte de la crítica» cuenta como inicio de capítulo.
 */
export function detectarMarcadores(textos: Map<number, string>, opciones: { estricto?: boolean } = {}): Map<number, Marcador> {
  const marcadores = new Map<number, Marcador>();
  for (const [fisica, texto] of textos) {
    if (!texto) continue;
    let limpio = texto.replace(/<[^>]+>/g, ' ');
    limpio = limpio.replace(/#+\s*/g, '');
    // «C H APTER» → «CHAPTER» (mayúsculas espaciadas por el OCR)
    limpio = limpio.replace(/\b((?:[A-Z] )+)([A-Z][A-Za-z]*)/g, (_m, a: string, b: string) => a.replace(/ /g, '') + b);
    limpio = limpio.replace(/\s+/g, ' ').trim();
    const fragmento = limpio.slice(0, 300);
    for (const [nombre, patron] of MARCADORES) {
      if (patron.test(fragmento)) {
        if (opciones.estricto && CAPITULO_LATINO.has(patron)) {
          const m = /^\s*\S+\s+([^\s.,:;]+)/u.exec(fragmento);
          if (!m || !/^(?:[IVXLCDM]+|\d+)$/u.test(m[1] as string)) continue;
        }
        marcadores.set(fisica, nombre);
        break;
      }
    }
  }
  return marcadores;
}

// ---------------------------------------------------------------------------
// El deductor
// ---------------------------------------------------------------------------

const minClave = (m: Map<number, unknown>) => Math.min(...m.keys());
const maxClave = (m: Map<number, unknown>) => Math.max(...m.keys());

export class DeductorPaginas {
  deducir(e: EntradaDeduccion): ResultadoDeduccion {
    const disposicion = e.disposicion ?? 'SINGLE';
    const log = e.registro ?? (() => {});
    const vacio = (): ResultadoDeduccion => ({
      estrategia: 'ninguno', disposicion, correspondencias: [], primeraPaginaContenido: 1, numeroInicial: 1,
      totalDetectadas: 0, totalDeducidas: 0, transicion: null, marcadores: new Map(), primeraNumerada: 1,
      anclasRomanas: new Map(), anclasArabigas: new Map(),
    });
    if (!e.totalPaginas) return vacio();

    const porFisica = disposicion === 'TWO_UP' || disposicion === 'TWO_UP_RTL' ? 2 : 1;
    const textos = e.textos ?? new Map<number, string>();

    // Paso 1: análisis del contenido
    const marcadores = detectarMarcadores(textos, { estricto: e.marcadoresEstrictos ?? false });
    if (e.marcadoresExtra) {
      for (const [p, m] of e.marcadoresExtra) if (!marcadores.has(p)) marcadores.set(p, m);
    }

    // Paso 2: anclas romanas y arábigas
    let romanas = new Map<number, number>();
    let arabigas = new Map<number, number>();
    for (const [p, d] of e.anclas ?? []) {
      if (d.folio < 0) romanas.set(p, d.folio);
      else if (d.folio > 0) arabigas.set(p, d.folio);
    }
    // 2b. zonas del VLM
    for (const z of e.zonas ?? []) {
      if (z.desplazamiento === null || z.desplazamiento === undefined || z.confianza < 0.5) continue;
      const muestra = z.desde + z.desplazamiento;
      if (z.tipo === 'roman' && muestra !== 0) {
        if (!romanas.has(z.desde)) romanas.set(z.desde, muestra > 0 ? -Math.abs(muestra) : muestra);
      } else if (z.tipo === 'arabic' && muestra > 0) {
        if (!arabigas.has(z.desde)) arabigas.set(z.desde, muestra);
      }
    }
    // 2c. Un romano en una página de «CHAPTER I» es casi siempre el número del capítulo mal leído.
    for (const [p, f] of [...romanas]) {
      const m = marcadores.get(p);
      if (m && MARCADORES_INICIO_CUERPO.has(m)) {
        log(`Reclasificada el ancla de la página ${p}: ${f} → ${Math.abs(f)} (romano en inicio de capítulo)`);
        romanas.delete(p);
        arabigas.set(p, Math.abs(f));
      }
    }
    // 2d. Anclas absurdas o inconsistentes
    arabigas = this.filtrarAnclasAtipicas(arabigas, e.totalPaginas, porFisica, log);
    romanas = this.filtrarAnclasAtipicas(romanas, e.totalPaginas, porFisica, log);
    const totalAnclas = romanas.size + arabigas.size;

    // Paso 3: transición romanos → arábigos
    const transicion = this.buscarTransicion(e.totalPaginas, romanas, arabigas, marcadores, e.transiciones, porFisica);

    // Paso 4: portada y páginas en blanco iniciales
    const primeraNumerada = this.primeraPaginaNumerada(e.totalPaginas, textos, marcadores, romanas, e.confianzas);

    // Paso 5: propagación secuencial
    const correspondencias = this.propagar(e.totalPaginas, transicion, primeraNumerada, romanas, arabigas, marcadores, porFisica, disposicion);

    // Paso 6: validación (las anclas mandan)
    this.validar(correspondencias, romanas, arabigas, log);

    const totalDetectadas = correspondencias.filter((m) => m.origen === 'detectado').length;
    const totalDeducidas = correspondencias.filter((m) => m.origen === 'deducido').length;
    let estrategia: EstrategiaDeduccion = 'deducido';
    if (totalAnclas === 0 && marcadores.size === 0) estrategia = 'ninguno';
    else if (totalDetectadas > e.totalPaginas * 0.5) estrategia = 'detectado';

    return {
      estrategia,
      disposicion,
      correspondencias,
      primeraPaginaContenido: transicion ?? 1,
      numeroInicial: 1,
      totalDetectadas,
      totalDeducidas,
      transicion,
      marcadores,
      primeraNumerada,
      anclasRomanas: romanas,
      anclasArabigas: arabigas,
    };
  }

  // -------------------------------------------------------------------------
  // Paso 3
  // -------------------------------------------------------------------------

  buscarTransicion(
    total: number,
    romanas: Map<number, number>,
    arabigas: Map<number, number>,
    marcadores: Map<number, Marcador>,
    transicionesVlm: number[] | undefined,
    porFisica: number,
  ): number | null {
    const candidatas: Array<[number, number]> = [];

    // 1. Transiciones explícitas del VLM
    for (const t of transicionesVlm ?? []) if (t >= 1 && t <= total) candidatas.push([t, 3.0]);

    // 2. Marcador de capítulo (o, en su defecto, de introducción)
    const capitulos = [...marcadores].filter(([, m]) => m === 'chapter_start').map(([p]) => p).sort((a, b) => a - b);
    const intros = [...marcadores].filter(([, m]) => m === 'introduction').map(([p]) => p).sort((a, b) => a - b);
    if (capitulos.length) candidatas.push([capitulos[0] as number, 2.5]);
    else if (intros.length) candidatas.push([intros[0] as number, 1.8]);

    // 3. Frontera entre la última ancla romana y la primera arábiga
    if (romanas.size && arabigas.size) {
      const ultimaRomana = maxClave(romanas);
      const primeraArabiga = minClave(arabigas);
      if (primeraArabiga > ultimaRomana) candidatas.push([primeraArabiga, 2.0]);
    }

    // 4. Hacia atrás desde la primera ancla arábiga
    if (arabigas.size) {
      const p = minClave(arabigas);
      const f = arabigas.get(p) as number;
      if (f > 0) {
        const estimada = p - Math.floor((f - 1) / porFisica);
        if (estimada >= 1) {
          let apoyo = 0;
          for (const q of arabigas.keys()) if (q >= estimada) apoyo++;
          candidatas.push([estimada, 1.5 + Math.min(1.5, apoyo / 10)]);
        }
      }
    }

    // 5. Hacia delante desde la última ancla romana (confianza baja)
    if (romanas.size && !arabigas.size && !capitulos.length) {
      candidatas.push([maxClave(romanas) + 2, 0.5]);
    }

    if (!candidatas.length) {
      const prelim = [...marcadores].filter(([, m]) => MARCADORES_PRELIMINARES.has(m)).map(([p]) => p);
      if (prelim.length) candidatas.push([Math.max(...prelim) + 2, 0.3]);
      else return null;
    }

    candidatas.sort((a, b) => b[1] - a[1]);
    const mejor = (candidatas[0] as [number, number])[0];
    return Math.max(1, Math.min(mejor, total));
  }

  // -------------------------------------------------------------------------
  // Paso 4
  // -------------------------------------------------------------------------

  primeraPaginaNumerada(
    total: number,
    textos: Map<number, string>,
    marcadores: Map<number, Marcador>,
    romanas: Map<number, number>,
    confianzas: Map<number, number> | undefined,
  ): number {
    if (romanas.size) {
      const primera = minClave(romanas);
      let p0 = primera;
      for (let p = primera - 1; p > 0; p--) {
        if ((textos.get(p) ?? '').trim().length > 50) p0 = p;
        else break;
      }
      return Math.max(1, p0);
    }
    const prelim = [...marcadores].filter(([, m]) => MARCADORES_PRELIMINARES.has(m)).map(([p]) => p).sort((a, b) => a - b);
    if (prelim.length) return prelim[0] as number;
    for (let p = 1; p < Math.min(total + 1, 15); p++) {
      const t = textos.get(p) ?? '';
      const c = confianzas?.get(p) ?? 0.5;
      if (t.trim().length > 50 && c >= 0.2) return p;
    }
    return 1;
  }

  // -------------------------------------------------------------------------
  // Paso 5
  // -------------------------------------------------------------------------

  propagar(
    total: number,
    transicionInicial: number | null,
    primeraNumerada: number,
    romanas: Map<number, number>,
    arabigas: Map<number, number>,
    marcadores: Map<number, Marcador>,
    porFisica: number,
    disposicion: DisposicionDeduccion,
  ): Correspondencia[] {
    let transicion = transicionInicial;
    const salida: Correspondencia[] = [];
    const zonaRomana = new Map([...romanas].filter(([p]) => (transicion === null || p < transicion) && p >= primeraNumerada));
    const zonaArabiga = new Map([...arabigas].filter(([p]) => transicion === null || p >= transicion));
    let anclaRomana = this.mejorAncla(zonaRomana);
    let anclaArabiga = this.mejorAncla(zonaArabiga);

    // Transición sin ancla romana: se sintetiza (la página anterior a la transición es el último romano).
    if (transicion && !anclaRomana && primeraNumerada < transicion) {
      const cuantas = transicion - primeraNumerada;
      anclaRomana = [transicion - 1, -cuantas];
    }
    // Transición sin ancla arábiga: el cuerpo empieza en 1.
    if (transicion && !anclaArabiga) anclaArabiga = [transicion, 1];
    // Sin transición ni romanos: todo es arábigo.
    if (transicion === null && !anclaRomana) {
      if (!anclaArabiga) anclaArabiga = [primeraNumerada, 1];
      transicion = primeraNumerada;
    }

    const doble = disposicion === 'TWO_UP' || disposicion === 'TWO_UP_RTL';
    for (let p = 1; p <= total; p++) {
      if (p < primeraNumerada) {
        salida.push({ fisica: p, folio: null, tipo: 'portada', confianza: 0.3, origen: 'deducido' });
        continue;
      }
      if (transicion && p < transicion) {
        const folio = anclaRomana ? anclaRomana[1] - porFisica * (p - anclaRomana[0]) : -(transicion - p);
        const detectada = romanas.has(p);
        const m = marcadores.get(p);
        const tipo: TipoPaginaDeduccion = m && MARCADORES_FINALES.has(m) ? 'final' : 'preliminar';
        const c: Correspondencia = { fisica: p, folio, tipo, confianza: detectada ? 0.9 : 0.7, origen: detectada ? 'detectado' : 'deducido' };
        if (doble && porFisica >= 2) {
          let izq = folio, der = folio - 1;
          if (disposicion === 'TWO_UP_RTL') [izq, der] = [der, izq];
          c.folio = izq;
          c.folios = [izq, der];
        }
        salida.push(c);
        continue;
      }
      let folio: number;
      if (anclaArabiga) folio = anclaArabiga[1] + porFisica * (p - anclaArabiga[0]);
      else if (transicion) folio = 1 + porFisica * (p - transicion);
      else folio = p;
      const detectada = arabigas.has(p);
      const m = marcadores.get(p);
      const tipo: TipoPaginaDeduccion = m && MARCADORES_FINALES.has(m) ? 'final' : 'contenido';
      const c: Correspondencia = { fisica: p, folio, tipo, confianza: detectada ? 0.9 : 0.7, origen: detectada ? 'detectado' : 'deducido' };
      if (doble && porFisica >= 2) {
        let izq = folio, der = folio + 1;
        if (disposicion === 'TWO_UP_RTL') [izq, der] = [der, izq];
        c.folio = izq;
        c.folios = [izq, der];
      }
      salida.push(c);
    }
    return salida;
  }

  // -------------------------------------------------------------------------
  // Paso 6
  // -------------------------------------------------------------------------

  validar(correspondencias: Correspondencia[], romanas: Map<number, number>, arabigas: Map<number, number>, log: (m: string) => void): void {
    const todas = new Map([...romanas, ...arabigas]);
    for (const c of correspondencias) {
      const esperado = todas.get(c.fisica);
      if (esperado !== undefined && c.folio !== null && c.folio !== esperado) {
        log(`Página ${c.fisica}: calculado ${c.folio}, el ancla dice ${esperado}. Se confía en el ancla.`);
        c.folio = esperado;
        c.origen = 'detectado';
        c.confianza = 0.9;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  /** Quita anclas imposibles (un año, un número de figura) y las que rompen la secuencia mayoritaria. */
  filtrarAnclasAtipicas(anclas: Map<number, number>, total: number, porFisica: number, log: (m: string) => void = () => {}): Map<number, number> {
    if (!anclas.size) return anclas;
    const maximo = total * porFisica * 2;
    let filtradas = new Map<number, number>();
    for (const [p, f] of anclas) {
      if (Math.abs(f) > maximo) log(`Ancla atípica descartada: página ${p} = ${f} (máximo razonable ±${maximo})`);
      else filtradas.set(p, f);
    }
    if (filtradas.size >= 3) filtradas = DeductorPaginas.filtrarAnclasInconsistentes(filtradas, porFisica, log);
    return filtradas;
  }

  static filtrarAnclasInconsistentes(anclas: Map<number, number>, porFisica: number, log: (m: string) => void = () => {}): Map<number, number> {
    const ordenadas = [...anclas].sort((a, b) => a[0] - b[0]);
    if (ordenadas.length < 3) return anclas;
    const incrementos: Array<[number, number]> = [];
    for (let i = 1; i < ordenadas.length; i++) {
      const dp = (ordenadas[i] as [number, number])[0] - (ordenadas[i - 1] as [number, number])[0];
      const df = (ordenadas[i] as [number, number])[1] - (ordenadas[i - 1] as [number, number])[1];
      if (dp > 0) incrementos.push([i, df / dp]);
    }
    if (!incrementos.length) return anclas;
    const valores = incrementos.map(([, v]) => v).sort((a, b) => a - b);
    const mediana = valores[Math.floor(valores.length / 2)] as number;
    const buenas = new Set<number>([0]);
    for (const [i, inc] of incrementos) {
      if (Math.abs(inc - mediana) <= porFisica * 2) {
        buenas.add(i);
        buenas.add(i - 1);
      }
    }
    const salida = new Map<number, number>();
    ordenadas.forEach(([p, f], i) => {
      if (buenas.has(i)) salida.set(p, f);
      else log(`Ancla inconsistente descartada: página ${p} = ${f} (incremento mediano ${mediana.toFixed(1)})`);
    });
    return salida;
  }

  /** El original prefiere la primera ancla (propagar hacia delante es más fiable). */
  mejorAncla(anclas: Map<number, number>): [number, number] | null {
    if (!anclas.size) return null;
    const p = minClave(anclas);
    return [p, anclas.get(p) as number];
  }
}
