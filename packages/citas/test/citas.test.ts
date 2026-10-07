import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AnclaPagina } from '@scholaris/nucleo';
import { emisionEnEspanol,
  aBibtex, aCSLJSON, aItemCSL, aRIS, analizarTemporal, autocitar, bibliografia, citaDocumento, combinarRPr, detectarAfirmacionNegativa, dividirAfirmaciones, dividirParrafos,
  extraerAnios, extraerTexto, fundirRangos, importarBibtex, insertarCitasDocx, insertarCitasTexto, latexAUnicode, leerDocx, listarEstilos, MotorCitas, nombreBibtex,
  puntoDeInsercion, terminosClaveAusentes, verificarAfirmacion, type DocumentoCitable, type ResultadoAutocita,
} from '../src/index.js';
import { bienFormado, DOCS, doc, docxDePrueba, montar } from './apoyo.js';

const pag = (fisica: number, impresa: string | null): AnclaPagina => ({ tipo: 'pagina', fisica, impresa, romana: false, origen: 'leido', confianza: 1 });

describe('lógica temporal (en código)', () => {
  it('extrae años, décadas y rangos', () => {
    expect(extraerAnios('Entre 1960-1975 y en los 1990s; no 123 ni 3000.')).toEqual([1960, 1975, 1990]);
  });
  it('cronología inversa: «Darwin anticipó a Copérnico» es imposible si la fuente es de 1859', () => {
    const r = analizarTemporal('Darwin anticipó a Copérnico al describir la selección natural.', 1859, 'APOYO_DIRECTO', ['Darwin']);
    expect(r.imposible).toBe(true);
    expect(r.relacionSugerida).toBe('IMPOSIBLE_TEMPORAL');
    expect(r.aviso).toMatch(/Copérnico/);
  });
  it('solo cuenta si el sujeto es la fuente', () => {
    const r = analizarTemporal('Copernicus anticipated Darwin in several respects.', 1859, 'APOYO_DIRECTO', ['Darwin']);
    expect(r.imposible).toBe(false);
  });
  it('dependencia imposible: un libro de 1859 no puede basarse en Freud (1899)', () => {
    const r = analizarTemporal('Darwin se basó en Freud para su lectura.', 1859, 'APOYO_DIRECTO', ['Darwin']);
    expect(r.imposible).toBe(true);
    expect(r.banderas).toContain('dependencia_imposible');
    expect(analizarTemporal('Darwin se basó en Newton y en la geología de 1830.', 1859, 'APOYO_DIRECTO', ['Darwin']).imposible).toBe(false);
  });
  it('regla de aplicación de marco: desfase > 20 años o término moderno', () => {
    const a = analizarTemporal('Esta idea se aplica a las redes de 2010.', 1975, 'APOYO_DIRECTO');
    expect(a.relacionSugerida).toBe('APLICACION_DE_MARCO');
    expect(a.desfase).toBe(35);
    const b = analizarTemporal('Los modelos de lenguaje grandes ordenan el cosmos.', 1964, 'APOYO_DIRECTO');
    expect(b.banderas).toContain('anacronismo:modelos de lenguaje grandes');
    expect(b.relacionSugerida).toBe('APLICACION_DE_MARCO');
    expect(analizarTemporal('Los transformers ordenan el lenguaje.', 2019, 'APOYO_DIRECTO').plausible).toBe(true);
  });
  it('detecta afirmaciones negativas y términos clave ausentes', () => {
    expect(detectarAfirmacionNegativa('Cervantes no menciona la imprenta de Gutenberg.')).toBe('la imprenta de Gutenberg');
    expect(detectarAfirmacionNegativa('Darwin does not discuss the printing press.')).toBe('the printing press');
    expect(detectarAfirmacionNegativa('El panóptico es una torre.')).toBeNull();
    expect(terminosClaveAusentes('El modelo de Bentham llegó al 40 % de las cárceles.', 'El Panóptico de Bentham es la figura')).toEqual(['40 %']);
  });
});

describe('segmentación', () => {
  it('párrafos y afirmaciones con posiciones exactas, sin cortar abreviaturas ni iniciales', () => {
    const t = '# Título\n\nComo explica C. R. Darwin en la p. 81, la selección conserva las variaciones favorables. Y otra frase bastante larga sigue aquí, cf. el capítulo 3.\n\nUna frase ya citada sobre los molinos de viento (Cervantes, 1605, p. 23).';
    const ps = dividirParrafos(t);
    expect(ps.length).toBe(1);
    const as = ps.flatMap((p) => dividirAfirmaciones(p));
    expect(as.map((a) => a.texto)).toEqual([
      'Como explica C. R. Darwin en la p. 81, la selección conserva las variaciones favorables.',
      'Y otra frase bastante larga sigue aquí, cf. el capítulo 3.',
      'Una frase ya citada sobre los molinos de viento (Cervantes, 1605, p. 23).',
    ]);
    for (const a of as) expect(t.slice(a.inicio, a.fin)).toBe(a.texto);
    expect(as[2]!.yaCitada).toBe(true);
    const a0 = as[0]!;
    expect(t.slice(0, puntoDeInsercion(t, a0.inicio, a0.fin, 'autor-fecha')).endsWith('favorables')).toBe(true);
    expect(t.slice(0, puntoDeInsercion(t, a0.inicio, a0.fin, 'nota')).endsWith('favorables.')).toBe(true);
  });
});

const TEXTO = `# Introducción

Don Quijote ve treinta o cuarenta molinos de viento en aquel campo y los toma por desaforados gigantes con quien hacer batalla. Sancho explica que los galeotes no van de su voluntad, sino condenados por sus delitos a servir al rey en las galeras de por fuerza.

Boecio, desde la prisión, imagina a la Fortuna haciendo girar su rueda. Darwin anticipó a Copérnico al describir la selección natural de las variaciones favorables.

Los transformers aplican al lenguaje la misma idea de la selección natural de las variaciones favorables. Don Quijote no ve treinta o cuarenta molinos de viento en aquel campo.

Según Kennedy, la Luna se elige porque es difícil (Kennedy, 1962). En este trabajo propongo una lectura nueva de todos estos textos.`;

describe('autocita', () => {
  let m: Awaited<ReturnType<typeof montar>>;
  let r: ResultadoAutocita;
  const eventos: string[] = [];
  beforeAll(async () => {
    m = await montar();
    r = await autocitar(TEXTO, { buscador: m.buscador, redactor: m.redactor, juez: m.juez }, { alProgreso: (e) => eventos.push(e.fase) });
  });
  const de = (inicio: string) => r.afirmaciones.find((a) => a.texto.startsWith(inicio))!;

  it('ninguna cita inventada: todo sale de fragmentos reales de la biblioteca', async () => {
    const todas = r.afirmaciones.flatMap((a) => a.citas);
    expect(todas.length).toBeGreaterThan(0);
    const frags = await m.buscador.estanteria.fragmentos(todas.map((c) => c.fragmento));
    for (const c of todas) {
      const f = frags.get(c.fragmento);
      expect(f, c.fragmento).toBeDefined();
      // Las citas de páginas cercanas se funden («pp. 3-4»): el pasaje contiene el del fragmento y el rango lo cubre.
      expect(c.pasaje).toContain(f!.texto);
      expect(c.documento).toBe(f!.documento);
      if (c.anclaFin) {
        const fis = (a: unknown) => (a as AnclaPagina).fisica;
        expect(fis(c.ancla)).toBeLessThanOrEqual(fis(f!.ancla));
        expect(fis(c.anclaFin)).toBeGreaterThanOrEqual(fis(f!.anclaFin ?? f!.ancla));
      } else expect(c.ancla).toEqual(f!.ancla);
    }
    expect(r.estadisticas.inventadas).toBeGreaterThan(0);
    expect(r.avisos.join(' ')).toMatch(/no correspondían a ningún candidato/);
  });

  it('acepta el apoyo directo y lo imprime con el folio impreso', () => {
    const a = de('Sancho explica que los galeotes');
    expect(a.citas[0]).toMatchObject({ estado: 'aceptada', relacion: 'APOYO_DIRECTO', fragmento: 'fr-q-07' });
    const p = r.propuestas.find((x) => x.afirmacion === a.texto)!;
    // El fragmento cruza de la 199 a la 200, pero sus oraciones están en la 199 (en la fixtura,
    // el texto de fr-q-07 vive en la unidad de la 199): la cita lleva la página del pasaje.
    expect(p.textoCita).toBe('(Cervantes Saavedra, 1605/1999, p. 199)');
    expect(p.cita.pasaje.startsWith('— No digo eso —respondió Sancho—, sino que es gente que, por sus delitos')).toBe(true);
    expect(p.cita.pasaje.length).toBeLessThan(400);
    expect(TEXTO.slice(p.insercion - 6, p.insercion + 1)).toBe('fuerza.');
    expect(de('Don Quijote ve treinta').citas[0]).toMatchObject({ estado: 'aceptada', fragmento: 'fr-q-04' });
  });

  it('descarta en código la cronología imposible sin preguntar al juez', () => {
    const a = de('Darwin anticipó a Copérnico');
    expect(a.citas.length).toBeGreaterThan(0);
    for (const c of a.citas) {
      expect(c.relacion).toBe('IMPOSIBLE_TEMPORAL');
      expect(c.estado).toBe('descartada');
      expect(c.relaciones).toBeUndefined(); // no pasó por el juez
    }
    const pares = m.juez.estados.flatMap((e) => (e as { pares: Array<{ afirmacion: string }> }).pares.map((p) => p.afirmacion));
    expect(pares.some((x) => x.startsWith('Darwin anticipó'))).toBe(false);
  });

  it('el anacronismo no se acepta como apoyo directo', () => {
    const a = de('Los transformers aplican');
    expect(a.citas.length).toBeGreaterThan(0);
    for (const c of a.citas) {
      expect(c.relacion).not.toBe('APOYO_DIRECTO');
      expect(c.temporal?.banderas.join(' ')).toMatch(/anacronismo:transformers/);
    }
  });

  it('la contradicción queda para revisar y no se inserta como cita', () => {
    const c = de('Don Quijote no ve').citas[0]!;
    expect(c.relacion).toBe('CONTRADICCION');
    expect(c.estado).toBe('revisar');
    expect(c.motivos[0]).toMatch(/contradice/);
  });

  it('no cita lo ya citado ni la contribución propia', () => {
    expect(de('Según Kennedy').yaCitada).toBe(true);
    expect(de('Según Kennedy').citas).toEqual([]);
    expect(de('En este trabajo propongo').citas).toEqual([]);
  });

  it('marca la evidencia que no es literal', () => {
    const conMotivo = r.afirmaciones.flatMap((a) => a.citas).filter((c) => c.motivos.some((x) => /no aparece literalmente/.test(x)));
    expect(conMotivo.length).toBeGreaterThan(0);
    for (const c of conMotivo) expect(c.evidencia).toBeUndefined();
    const buena = de('Don Quijote ve treinta').citas[0]!;
    expect(buena.evidencia).toBeDefined();
  });

  it('juez por lotes: una llamada por cada 8 pares', () => {
    const juzgadas = r.afirmaciones.flatMap((a) => a.citas).filter((c) => c.relaciones).length;
    // Se juzga antes de fundir rangos: puede haber más pares juzgados que citas finales.
    expect(r.estadisticas.llamadasJuez).toBeGreaterThanOrEqual(Math.ceil(juzgadas / 8));
    expect(r.estadisticas.llamadasJuez).toBeLessThanOrEqual(Math.ceil(juzgadas / 8) + 1);
    expect(eventos[0]).toBe('segmentacion');
    expect(eventos.at(-1)).toBe('listo');
  });

  it('bibliografía con lo citado', () => {
    expect(r.bibliografia[0]).toMatch(/^Cervantes Saavedra, M\. de \(1999\)\. Don Quijote/);
  });

  it('con un umbral más alto, menos aceptadas', async () => {
    const r2 = await autocitar(TEXTO, { buscador: m.buscador, redactor: m.redactor, juez: m.juez }, { umbral: 0.99 });
    expect(r2.estadisticas.aceptadas).toBe(0);
  });

  it('sin juez todo queda para revisar', async () => {
    const r2 = await autocitar(TEXTO, { buscador: m.buscador, redactor: m.redactor });
    expect(r2.afirmaciones.flatMap((a) => a.citas).filter((c) => c.estado === 'aceptada' && !c.revisar)).toEqual([]);
  });

  it('verifica una afirmación suelta', async () => {
    const v = await verificarAfirmacion('Don Quijote ve treinta o cuarenta molinos de viento y los toma por desaforados gigantes', { buscador: m.buscador, juez: m.juez });
    expect(v.veredicto).toBe('respaldada');
    expect(v.citas[0]!.fragmento).toBe('fr-q-04');
    expect(v.citas[0]!.citaCorta).toBe('(Cervantes Saavedra, 1605, p. 139)');
    const imposible = await verificarAfirmacion('Darwin anticipó a Copérnico con la selección natural de las variaciones favorables', { buscador: m.buscador, juez: m.juez }, { fragmentos: ['fr-dar-04'] });
    expect(imposible.citas[0]!.relacion).toBe('IMPOSIBLE_TEMPORAL');
    expect(imposible.veredicto).toBe('sin_respaldo');
  });
});

describe('CSL', () => {
  it('lista los estilos', () => {
    expect(listarEstilos().map((e) => e.id)).toEqual(['apa', 'chicago-author-date', 'chicago-note-bibliography', 'mla', 'harvard', 'iso690', 'iso690-en', 'iso690-numerico', 'ieee']);
    expect(listarEstilos('notas')[0]!.formato).toBe('nota');
  });

  it('todos los estilos y locales citan y dan bibliografía', async () => {
    for (const e of listarEstilos()) {
      for (const idioma of ['es-ES', 'en-US', 'fr-FR', 'it-IT']) {
        const motor = await MotorCitas.crear({ estilo: e.id, idioma, documentos: DOCS });
        const { citas, bibliografia } = motor.citar([
          [{ documento: 'doc-quijote', ancla: pag(213, '199'), anclaFin: pag(214, '200') }],
          [{ documento: 'doc-kennedy', ancla: { tipo: 'tiempo', t0: 724, t1: 800 } }],
          [{ documento: 'doc-boecio', ancla: pag(51, '31') }],
          [{ documento: 'doc-darwin', ancla: pag(131, null) }],
        ]);
        expect(citas.every((c) => c.length > 3), `${e.id} ${idioma}`).toBe(true);
        // APA y Chicago no llevan a la bibliografía las entrevistas no publicadas.
        expect(bibliografia.length, `${e.id} ${idioma}`).toBeGreaterThanOrEqual(3);
        expect(bibliografia.join(' '), `${e.id} ${idioma}`).toMatch(/Cervantes|CERVANTES/);
        expect(citas[1], `${e.id} ${idioma}`).toContain('12:04');
        expect(citas[3], `${e.id} ${idioma}`).toContain('[131]'); // página sin folio impreso
      }
    }
  }, 30_000);

  it('APA, Chicago notas e IEEE con sus particularidades', async () => {
    const apa = await MotorCitas.crear({ estilo: 'apa', documentos: DOCS });
    expect(apa.citarUno([{ documento: 'doc-quijote', ancla: pag(213, '199'), anclaFin: pag(214, '200') }])).toBe('(Cervantes Saavedra, 1605/1999, pp. 199-200)');
    expect(apa.citarUno([{ documento: 'doc-quijote', ancla: pag(153, '139') }, { documento: 'doc-darwin', ancla: pag(95, '81') }])).toBe('(Cervantes Saavedra, 1605/1999, p. 139; Darwin, 1859, p. 81)');
    const en = await MotorCitas.crear({ estilo: 'apa', idioma: 'en', documentos: DOCS });
    expect(en.citarUno([{ documento: 'doc-quijote', ancla: pag(213, '199'), anclaFin: pag(214, '200') }])).toBe('(Cervantes Saavedra, 1605/1999, pp. 199–200)');
    const notas = await MotorCitas.crear({ estilo: 'chicago-note-bibliography', documentos: DOCS });
    expect(notas.esNotas).toBe(true);
    const { citas } = notas.citar([[{ documento: 'doc-quijote', ancla: pag(153, '139') }], [{ documento: 'doc-quijote', ancla: pag(213, '199') }]], 'markdown');
    expect(citas[0]).toBe('Miguel de Cervantes Saavedra, *Don Quijote* (1605; Project Gutenberg, 1999), 139, https://www.gutenberg.org/ebooks/2000.');
    expect(citas[1]).toMatch(/^(Ibid\.|Cervantes Saavedra, \*Don Quijote\*), 199\.$/);
    const ieee = await MotorCitas.crear({ estilo: 'ieee', documentos: DOCS });
    expect(ieee.esNumerico).toBe(true);
    expect(ieee.citar([[{ documento: 'doc-darwin', ancla: pag(95, '81') }], [{ documento: 'doc-quijote' }], [{ documento: 'doc-darwin' }]]).citas).toEqual(['[1, p. 81]', '[2]', '[1]']);
  });

  it('referencias de un documento y bibliografías', async () => {
    const c = await citaDocumento(doc('doc-boecio'), { estilo: 'chicago-note-bibliography' });
    expect(c.texto).toMatch(/^Boethius, Anicius Manlius Severinus\. De consolatione philosophiae\./);
    expect(c.html).toContain('<i>De consolatione philosophiae</i>');
    const b = await bibliografia(DOCS, { estilo: 'mla', formato: 'markdown' });
    expect(b.entradas.length).toBe(4);
    expect(b.entradas.some((e) => e.includes('*On the Origin of Species'))).toBe(true);
    expect(b.html).toMatch(/^<div class="csl-bib-body">/);
  });

  it('usa contenedor, traductores, título original, fecha completa y «s. f.» con horquilla', async () => {
    // Emisión real: «The War of the Worlds», The Mercury Theatre on the Air, CBS, 30 de octubre de 1938.
    const entrevista: DocumentoCitable = { id: 'doc-radio', tipo: 'audio', metadatos: {
      titulo: 'The War of the Worlds', autores: [{ nombre: 'Orson', apellidos: 'Welles' }], anio: 1938,
      fecha: '1938-10-30', contenedor: 'The Mercury Theatre on the Air', tipoCSL: 'broadcast', editorial: 'CBS', idioma: 'en' } };
    const comedia: DocumentoCitable = { id: 'doc-casamiento', tipo: 'pdf_escaneado', metadatos: {
      titulo: 'El casamiento en la muerte', autores: [{ nombre: 'Lope', apellidos: 'de Vega' }], lugar: 'Valencia',
      sinFecha: { desde: 1760, hasta: 1780, fundamento: 'años de actividad del impresor' }, idioma: 'es' } };
    // Primera traducción española de Darwin (Enrique Godínez, Madrid, Biblioteca Perojo, 1877).
    const traducido: DocumentoCitable = { id: 'doc-trad', tipo: 'pdf', metadatos: {
      titulo: 'Origen de las especies por medio de la selección natural', tituloOriginal: 'On the Origin of Species', autores: [{ nombre: 'Charles', apellidos: 'Darwin' }],
      traductores: [{ nombre: 'Enrique', apellidos: 'Godínez' }], anio: 1877, anioOriginal: 1859, lugar: 'Madrid',
      contenedor: 'Ignorado en un libro', tipoCSL: 'book', coleccion: 'Biblioteca Perojo', idioma: 'es' } };
    const i1 = aItemCSL(entrevista), i2 = aItemCSL(comedia), i3 = aItemCSL(traducido), i2en = aItemCSL(comedia, 'en-US');
    expect(i1['container-title']).toBe('The Mercury Theatre on the Air');
    expect(i1.issued).toEqual({ 'date-parts': [[1938, 10, 30]] });
    expect(i2.issued).toEqual({ literal: 's. f. [1760-1780]' });
    expect(i2en.issued).toEqual({ literal: 'n.d. [1760–1780]' });
    expect(i3['original-title']).toBe('On the Origin of Species');
    expect(i3['original-date']).toEqual({ 'date-parts': [[1859]] });
    expect(i3.translator).toEqual([{ family: 'Godínez', given: 'Enrique' }]);
    expect(i3['collection-title']).toBe('Biblioteca Perojo');
    const chicago = await MotorCitas.crear({ estilo: 'chicago-author-date', documentos: [entrevista, comedia, traducido] });
    const { bibliografia: b } = chicago.citar([[{ documento: 'doc-radio' }], [{ documento: 'doc-casamiento' }], [{ documento: 'doc-trad' }]]);
    const todo = b.join('\n');
    expect(todo).toContain('The Mercury Theatre on the Air');
    expect(todo).toContain('s. f. [1760-1780]');
    expect(todo).toMatch(/Godínez/);
    const apa = await MotorCitas.crear({ estilo: 'apa', documentos: [comedia, traducido] });
    expect(apa.citarUno([{ documento: 'doc-casamiento' }])).toContain('s. f. [1760-1780]');
    expect(apa.citarUno([{ documento: 'doc-trad' }])).toBe('(Darwin, 1859/1877)');
  });

  it('Chicago en español: «Emitido el…» con fecha y sin «Aired» colgando cuando solo hay año', async () => {
    // Emisiones reales de The Mercury Theatre on the Air (CBS): «The War of the Worlds» (30-10-1938) y «Dracula» (1938, solo el año).
    const tv: DocumentoCitable = { id: 'doc-tv', tipo: 'audio', metadatos: { titulo: 'The War of the Worlds',
      autores: [{ nombre: 'Orson', apellidos: 'Welles' }], anio: 1938, fecha: '1938-10-30', contenedor: 'The Mercury Theatre on the Air', tipoCSL: 'broadcast', editorial: 'CBS', idioma: 'es' } };
    const yt: DocumentoCitable = { id: 'doc-yt', tipo: 'audio', metadatos: { titulo: 'Dracula',
      autores: [{ nombre: 'Orson', apellidos: 'Welles' }], anio: 1938, contenedor: 'The Mercury Theatre on the Air', tipoCSL: 'broadcast', editorial: 'CBS', idioma: 'es' } };
    for (const estilo of ['chicago-author-date', 'chicago-note-bibliography']) {
      const m = await MotorCitas.crear({ estilo, documentos: [tv, yt] });
      const todo = m.citar([[{ documento: 'doc-tv' }], [{ documento: 'doc-yt' }]]).bibliografia.join('\n');
      expect(todo).not.toMatch(/aired/i);
      expect(todo).not.toMatch(/\. en CBS/);
      expect(todo).not.toMatch(/\.\s*\./);
    }
    expect(emisionEnEspanol('The Mercury Theatre on the Air. Aired, en CBS.')).toBe('The Mercury Theatre on the Air. En CBS.');
    expect(emisionEnEspanol('The Mercury Theatre on the Air. Aired 30 de octubre, en CBS.')).toBe('The Mercury Theatre on the Air. Emitido el 30 de octubre, en CBS.');
    expect(emisionEnEspanol('Dracula. Aired.')).toBe('Dracula.');
  });

  it('el motor se reutiliza: la segunda creación es inmediata', async () => {
    (await MotorCitas.crear({ estilo: 'chicago-author-date', documentos: DOCS })).citarUno([{ documento: 'doc-quijote' }]);
    const t = performance.now();
    const m2 = await MotorCitas.crear({ estilo: 'chicago-author-date', documentos: DOCS });
    m2.citarUno([{ documento: 'doc-darwin' }]);
    expect(performance.now() - t).toBeLessThan(100);
  });
});

describe('inserción en texto', () => {
  const texto = 'Los galeotes van a las galeras por sus delitos. Don Quijote toma los molinos por gigantes.\n\nOtra cosa.';
  const citas = [
    { desde: 0, hasta: 47, cita: { documento: 'doc-quijote', ancla: pag(213, '199') } },
    { desde: 48, hasta: 89, cita: { documento: 'doc-quijote', ancla: pag(153, '139') } },
    { desde: 48, hasta: 89, cita: { documento: 'doc-darwin', ancla: pag(95, '81') } },
  ];
  it('autor-fecha: cita antes del punto y referencias al final', async () => {
    const r = await insertarCitasTexto(texto, citas, DOCS, { formato: 'markdown' });
    expect(r.texto).toContain('por sus delitos (Cervantes Saavedra, 1605/1999, p. 199). Don Quijote toma los molinos por gigantes (Cervantes Saavedra, 1605/1999, p. 139; Darwin, 1859, p. 81).');
    expect(r.texto).toContain('## Referencias\n\nCervantes Saavedra, M. de (1999). *Don Quijote*');
  });
  it('notas: llamada tras la puntuación y notas al pie', async () => {
    const r = await insertarCitasTexto(texto, citas, DOCS, { estilo: 'chicago-note-bibliography', formato: 'markdown' });
    expect(r.texto).toContain('por sus delitos.[^1] Don Quijote toma los molinos por gigantes.[^2]');
    expect(r.texto).toMatch(/\n\[\^1\]: Miguel de Cervantes Saavedra, \*Don Quijote\*/);
    expect(r.texto).toContain('## Bibliografía');
    const plano = await insertarCitasTexto(texto, citas, DOCS, { estilo: 'chicago-note-bibliography', formato: 'texto', bibliografia: false });
    expect(plano.texto).toContain('por sus delitos.¹ Don Quijote');
    expect(plano.texto).toContain('\n\nNotas\n\n1. Miguel de Cervantes Saavedra');
  });
  it('reescritura de aplicación de marco', async () => {
    const r = await insertarCitasTexto(texto, [{ ...citas[1]!, reescritura: 'Como en el Quijote, cada molino se vuelve un gigante.' }], DOCS, { bibliografia: false });
    expect(r.texto).toContain('Como en el Quijote, cada molino se vuelve un gigante (Cervantes Saavedra, 1605/1999, p. 139).');
  });
});

describe('DOCX', () => {
  const bytes = docxDePrueba();
  const { texto } = leerDocx(bytes);
  const posicion = (frase: string) => { const i = texto.indexOf(frase); return { desde: i, hasta: i + frase.length }; };

  it('lee el texto: runs, entidades, tabuladores, hipervínculos', () => {
    expect(texto).toBe('Molinos y galeotes\n\nDon Quijote ve treinta o cuarenta molinos de viento en aquel campo y los toma por desaforados gigantes. Los galeotes van a las galeras por sus delitos & de por fuerza.\n\nTabla\tcon tabulador y un enlace.\n\n\n\nLa rueda de la Fortuna no se detiene nunca, según Boecio.');
    expect(extraerTexto(bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').texto).toBe(texto);
    expect(extraerTexto(new TextEncoder().encode('<p>Hola &amp; adiós</p><p>Dos</p>'), 'text/html').parrafos).toEqual(['Hola & adiós', 'Dos']);
  });

  it('inserta citas autor-fecha conservando el formato del run y añade la bibliografía', async () => {
    const citas = [
      { ...posicion('Don Quijote ve treinta o cuarenta molinos de viento en aquel campo y los toma por desaforados gigantes.'), cita: { documento: 'doc-quijote', ancla: pag(153, '139') } },
      { ...posicion('Los galeotes van a las galeras por sus delitos & de por fuerza.'), cita: { documento: 'doc-quijote', ancla: pag(213, '199') } },
      { ...posicion('La rueda de la Fortuna no se detiene nunca, según Boecio.'), cita: { documento: 'doc-boecio', ancla: pag(51, '31') } },
    ];
    const { docx, avisos } = await insertarCitasDocx(bytes, citas, DOCS);
    expect(avisos).toEqual([]);
    const xml = strFromU8(unzipSync(docx)['word/document.xml']!);
    expect(bienFormado(xml)).toBe(true);
    // La cita hereda Georgia 12 del run donde acaba la afirmación.
    expect(xml).toContain('gigantes</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve"> (Cervantes Saavedra, 1605/1999, p. 139)</w:t></w:r>');
    expect(xml).toContain('por fuerza</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve"> (Cervantes Saavedra, 1605/1999, p. 199)</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">.</w:t>');
    expect(xml).toContain('<w:b/></w:rPr><w:t xml:space="preserve"> (Boethius, 524, p. 31)</w:t>');
    // Bibliografía antes del sectPr, con el estilo de título del documento y la cursiva de CSL.
    expect(xml).toMatch(/<w:pStyle w:val="Heading1"\/><\/w:pPr><w:r><w:t xml:space="preserve">Referencias<\/w:t><\/w:r><\/w:p>.*<w:sectPr>/s);
    expect(xml).toContain('<w:rPr><w:i/><w:iCs/></w:rPr><w:t xml:space="preserve">Don Quijote</w:t>');
    // El texto leído de nuevo contiene las citas en su sitio.
    const despues = leerDocx(docx).texto;
    expect(despues).toContain('desaforados gigantes (Cervantes Saavedra, 1605/1999, p. 139). Los galeotes');
    expect(despues).toContain('Tabla\tcon tabulador y un enlace.');
  });

  it('en estilos de notas crea notas al pie de Word de verdad', async () => {
    const citas = [{ ...posicion('La rueda de la Fortuna no se detiene nunca, según Boecio.'), cita: { documento: 'doc-boecio', ancla: pag(51, '31') } },
      { ...posicion('Tabla\tcon tabulador y un enlace.'), cita: { documento: 'doc-darwin', ancla: pag(95, '81') } }];
    const { docx } = await insertarCitasDocx(bytes, citas, DOCS, { estilo: 'chicago-note-bibliography' });
    const z = unzipSync(docx);
    const xml = strFromU8(z['word/document.xml']!);
    const notas = strFromU8(z['word/footnotes.xml']!);
    expect(bienFormado(xml)).toBe(true);
    expect(bienFormado(notas)).toBe(true);
    expect(xml).toContain('<w:footnoteReference w:id="1"/>');
    expect(xml).toContain('<w:footnoteReference w:id="2"/>');
    expect(xml.indexOf('w:id="1"')).toBeLessThan(xml.indexOf('w:id="2"')); // orden del documento
    expect(xml).toMatch(/según Boecio\.<\/w:t><\/w:r><w:r><w:rPr><w:b\/><w:vertAlign w:val="superscript"\/><\/w:rPr><w:footnoteReference w:id="2"\/>/);
    expect(notas).toContain('<w:footnote w:type="separator" w:id="-1">');
    expect(notas).toMatch(/<w:footnote w:id="1">.*Darwin.*<\/w:footnote>/s);
    expect(strFromU8(z['word/_rels/document.xml.rels']!)).toContain('Target="footnotes.xml"');
    expect(strFromU8(z['[Content_Types].xml']!)).toContain('PartName="/word/footnotes.xml"');
    expect(xml).toContain('Bibliografía');
  });

  it('combina propiedades de run en el orden del esquema', () => {
    expect(combinarRPr('<w:rPr><w:sz w:val="24"/><w:rFonts w:ascii="X"/><w:vertAlign w:val="subscript"/></w:rPr>', { cursiva: true, versalitas: true }))
      .toBe('<w:rPr><w:rFonts w:ascii="X"/><w:i/><w:iCs/><w:smallCaps/><w:sz w:val="24"/></w:rPr>');
  });
});

describe('exportación', () => {
  it('BibTeX con claves únicas, escapes y origdate', () => {
    // Una segunda copia del Quijote con caracteres que BibTeX debe escapar en la editorial.
    const b = aBibtex([...DOCS, { id: 'x', tipo: 'pdf', metadatos: { titulo: 'Don Quijote', autores: [{ nombre: 'Miguel de', apellidos: 'Cervantes Saavedra' }], anioOriginal: 1605, anio: 1999, editorial: 'Gutenberg & Co. al 100 %' } }]);
    expect(b).toContain('@book{cervantessaavedra1605don,');
    expect(b).toContain('@book{cervantessaavedra1605donb,');
    expect(b).toContain('author = {Cervantes Saavedra, Miguel de}');
    expect(b).toContain('origdate = {1605}');
    expect(b).toContain('publisher = {Gutenberg \\& Co. al 100 \\%}');
    expect(b).toContain('@misc{kennedy1962address,');
    expect(b).toContain('langid = {latin}');
  });
  it('RIS y CSL-JSON', () => {
    const r = aRIS([doc('doc-darwin')]);
    expect(r.split('\r\n')).toEqual(expect.arrayContaining(['TY  - BOOK', 'AU  - Darwin, Charles', 'PY  - 1859', 'PB  - John Murray', 'ER  - ']));
    const j = aCSLJSON([doc('doc-quijote')])[0]!;
    expect(j).toMatchObject({ id: 'doc-quijote', type: 'book', 'original-date': { 'date-parts': [[1605]] }, issued: { 'date-parts': [[1999]] }, URL: 'https://www.gutenberg.org/ebooks/2000' });
  });
  it('ida y vuelta BibTeX → importación', () => {
    const { entradas, errores } = importarBibtex(aBibtex(DOCS));
    expect(errores).toEqual([]);
    expect(entradas.length).toBe(4);
    const f = entradas.find((e) => e.clave === 'darwin1859origin')!;
    expect(f.metadatos).toMatchObject({ titulo: 'On the Origin of Species', subtitulo: 'By Means of Natural Selection, or the Preservation of Favoured Races in the Struggle for Life', anio: 1859, editorial: 'John Murray', lugar: 'London', idioma: 'en', autores: [{ nombre: 'Charles', apellidos: 'Darwin' }] });
    const q = entradas.find((e) => e.clave === 'cervantessaavedra1605don')!;
    expect(q.metadatos).toMatchObject({ anio: 1999, anioOriginal: 1605, editorial: 'Project Gutenberg' });
    const b = entradas.find((e) => e.clave.startsWith('boethius'))!;
    expect(b.metadatos.idioma).toBe('la');
  });
});

describe('importación BibTeX', () => {
  const BIB = `
% Comentario con una @ suelta: jl@example.org
@string{ siglo = "Siglo XXI" }
@comment{ esto no es una entrada @book{nada, title={x}} }
@Book{foucault1975,
  author    = {Foucault, Michel},
  title     = {Vigilar y castigar: nacimiento de la prisi{\\'o}n},
  publisher = siglo # " Editores",
  address   = {M{\\'e}xico},
  year      = 1976,
  origdate  = {1975},
  langid    = {spanish},
}
@article{einstein1935,
  author = {Einstein, Albert and Boris Podolsky and others},
  title = "{Can Quantum-Mechanical Description of Physical Reality Be Considered {\\it Complete}?}",
  journaltitle = {Physical Review},
  volume = {47}, number = 10, pages = {777--780},
  date = {1935-05},
  doi = {https://doi.org/10.1103/PhysRev.47.777},
  month = may,
}
@incollection{roto,
  title = {Sin cerrar
@misc{ultimo, title = {Sigue funcionando}, year = {2001}}
`;
  it('analiza macros, concatenación, acentos LaTeX, nombres y tipos', () => {
    const { entradas, errores } = importarBibtex(BIB);
    expect(entradas.map((e) => e.clave)).toEqual(['foucault1975', 'einstein1935', 'ultimo']);
    expect(errores.length).toBe(1);
    expect(errores[0]!.clave).toBe('roto');
    const f = entradas[0]!.metadatos;
    expect(f).toMatchObject({ titulo: 'Vigilar y castigar', subtitulo: 'nacimiento de la prisión', editorial: 'Siglo XXI Editores', lugar: 'México', anio: 1976, anioOriginal: 1975, idioma: 'es', tipoCSL: 'book' });
    const g = entradas[1]!.metadatos;
    expect(g.autores).toEqual([
      { nombre: 'Albert', apellidos: 'Einstein' },
      { nombre: 'Boris', apellidos: 'Podolsky' },
    ]);
    expect(g).toMatchObject({ titulo: 'Can Quantum-Mechanical Description of Physical Reality Be Considered Complete?', revista: 'Physical Review', volumen: '47', numero: '10', paginas: '777-780', anio: 1935, doi: '10.1103/PhysRev.47.777', tipoCSL: 'article-journal' });
    expect(entradas[1]!.campos.month).toBe('5');
  });
  it('LaTeX a Unicode y nombres sueltos', () => {
    expect(latexAUnicode('{\\"u}ber \\c{c}a \\v{s} \\ss{} \\o{} \\aa{} \\l{}\\\'odz ``x\'\' 1--2 a~b y 1---2')).toBe('über ça š ß ø å łódz “x” 1–2 a b y 1—2');
    expect(nombreBibtex('de la Fontaine, Jean')).toEqual({ nombre: 'Jean', apellidos: 'de la Fontaine' });
    expect(nombreBibtex('Jean de la Fontaine')).toEqual({ nombre: 'Jean', apellidos: 'de la Fontaine' });
    expect(nombreBibtex('King, Jr., Martin Luther')).toEqual({ nombre: 'Martin Luther', apellidos: 'King, Jr.' });
  });
});

describe('fundir rangos de citas', () => {
  it('si el mejor pasaje es el último, el rango llega hasta su página', () => {
    const cita = (fisica: number, respaldo: number) => ({
      id: `c${fisica}`, documento: 'doc-darwin', fragmento: `f${fisica}`, ancla: pag(fisica, String(fisica - 6)), relacion: 'APOYO_DIRECTO', respaldo,
      pasaje: `pasaje ${fisica}`, estado: 'aceptada',
    }) as unknown as Parameters<typeof fundirRangos>[0][number];
    const r = fundirRangos([cita(25, 0.6), cita(26, 0.9)]);
    expect(r).toHaveLength(1);
    expect(r[0]!.fragmento).toBe('f26');
    expect((r[0]!.ancla as AnclaPagina).fisica).toBe(25);
    expect((r[0]!.anclaFin as AnclaPagina).fisica).toBe(26);
  });

  it('no une páginas con un hueco sin comprobar: van como citas separadas', () => {
    const cita = (fisica: number, respaldo: number) => ({
      id: `c${fisica}`, documento: 'doc-darwin', fragmento: `f${fisica}`, ancla: pag(fisica, String(fisica)), relacion: 'APOYO_DIRECTO', respaldo,
      pasaje: `pasaje ${fisica}`, estado: 'aceptada',
    }) as unknown as Parameters<typeof fundirRangos>[0][number];
    const r = fundirRangos([cita(10, 0.8), cita(11, 0.7), cita(13, 0.9)]);
    expect(r).toHaveLength(2);
    expect(r.map((c) => [(c.ancla as AnclaPagina).fisica, (c.anclaFin as AnclaPagina | undefined)?.fisica])).toEqual([[10, 11], [13, undefined]]);
  });
});
