import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { convertir, convertirEnMemoria } from '../src/node/index.js';
import { abrirCortador } from '../src/pdf/cortar.js';
import type { ContenidoDocumento, ContenidoHoja, ContenidoImagenes, ContenidoMedio, ContenidoPdf, ContenidoPresentacion, EventoConversion } from '../src/tipos.js';

const DATOS = new URL('../../../bench/datos/originales/', import.meta.url).pathname;
const FIX = new URL('./fixtures/', import.meta.url).pathname;
const hay = (f: string) => existsSync(DATOS + f);
const hayFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version']); return true; } catch { return false; } })();

describe('PDF', () => {
  it.skipIf(!hay('attention_2017.pdf'))('digital: texto, esquema, imágenes y partes, en el mismo hilo', async () => {
    const eventos: EventoConversion['tipo'][] = [];
    const { paquete, datos } = await convertirEnMemoria(DATOS + 'attention_2017.pdf', { hilos: 0 }, (e) => eventos.push(e.tipo));
    const c = paquete.contenido as ContenidoPdf;
    expect(paquete.tipo).toBe('pdf');
    expect(paquete.unidades).toBe(15);
    expect(c.paginas).toHaveLength(15);
    expect(c.paginas.every((p) => p.clase === 'pdf')).toBe(true);
    expect(c.esquema[0]).toMatchObject({ titulo: 'Introduction', nivel: 1, fisica: 2 });
    expect(c.paginas[0]?.cuerpo).toContain('Attention Is All You Need');
    expect(c.paginas[2]?.pie.map((l) => l.texto)).toEqual(['3']);
    expect(c.paginas[2]?.candidatosFolio[0]).toMatchObject({ texto: '3', zona: 'pie', lado: 'centro' });
    expect(c.paginas[2]?.imagenes.length).toBeGreaterThan(0); // figura 1
    expect(eventos[0]).toBe('inicio');
    expect(eventos.at(-1)).toBe('fin');
    // Cada página nombra partes que ya llegaron.
    for (const p of c.paginas) {
      expect(datos.has(p.imagen as string)).toBe(true);
      expect(datos.has(p.miniatura as string)).toBe(true);
    }
    const jpeg = datos.get('paginas/0001.jpg') as Uint8Array;
    expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]);
    expect(JSON.parse(JSON.stringify(paquete))).toEqual(paquete); // serializable
  }, 60_000);

  it.skipIf(!hay('the_discarded_image_an_introduction_t_z.pdf'))('etiquetas de página y grupo de trabajadores', async () => {
    const { paquete } = await convertirEnMemoria(DATOS + 'the_discarded_image_an_introduction_t_z.pdf', { hilos: 2, paginas: [1, 4, 14, 30] });
    const c = paquete.contenido as ContenidoPdf;
    expect(c.paginas.map((p) => p.etiqueta)).toEqual(['dj A', 'i', '1', '17']);
    expect(c.paginas[0]?.clase).toBe('pdf_escaneado'); // sobrecubierta: solo imagen
    expect(c.paginas[3]?.clase).toBe('pdf');
    expect(c.paginas[3]?.pie.some((l) => l.texto === '17')).toBe(true);
    expect(c.paginas[3]?.cabecera.map((l) => l.texto)).toEqual(['Reservations']);
    expect(paquete.metadatos.autores).toEqual([{ nombre: 'C. S.', apellidos: 'Lewis' }]);
    expect(c.esquema.length).toBeGreaterThan(10);
  }, 60_000);

  it.skipIf(!hay('el-casamiento-en-la-muerte-y-hechos-de-b.pdf'))('escaneado con OCR malo: va a visión, a más resolución', async () => {
    const { paquete } = await convertirEnMemoria(DATOS + 'el-casamiento-en-la-muerte-y-hechos-de-b.pdf', { hilos: 0, paginas: [1, 10] });
    const c = paquete.contenido as ContenidoPdf;
    expect(c.paginas.map((p) => p.clase)).toEqual(['pdf_escaneado', 'pdf_escaneado']);
    expect(c.paginas[1]?.texto.origen).toBe('ocr');
    expect(paquete.tipo).toBe('pdf_escaneado');
    const parte = paquete.partes.find((p) => p.id === 'paginas/0010.jpg');
    expect(Math.max(parte?.ancho ?? 0, parte?.alto ?? 0)).toBe(1600);
  }, 60_000);

  it.skipIf(!hay('attention_2017.pdf'))('cortar pliegos', async () => {
    const bytes = new Uint8Array(readFileSync(DATOS + 'attention_2017.pdf'));
    const c = await abrirCortador(bytes);
    expect(c.paginas).toBe(15);
    const pliego = await c.cortar(3, 5);
    const otra = await abrirCortador(pliego);
    expect(otra.paginas).toBe(3);
    await expect(c.cortar(20, 30)).rejects.toThrow();
  }, 30_000);

  it.skipIf(!hay('attention_2017.pdf'))('se puede abandonar a medias', async () => {
    let paginas = 0;
    for await (const e of convertir({ nombre: 'a.pdf', bytes: new Uint8Array(readFileSync(DATOS + 'attention_2017.pdf')) }, { hilos: 0 })) {
      if (e.tipo === 'pagina_pdf' && ++paginas === 2) break;
    }
    expect(paginas).toBe(2);
  }, 30_000);
});

describe('documentos', () => {
  const doc = async (f: string) => (await convertirEnMemoria(FIX + f)).paquete;

  it('DOCX: títulos, ruta, cita y notas al pie', async () => {
    const p = await doc('prueba.docx');
    const c = p.contenido as ContenidoDocumento;
    expect(p.tipo).toBe('documento');
    expect(p.metadatos).toMatchObject({ titulo: 'Ensayo sobre el panóptico', autores: [{ nombre: 'Ana García', apellidos: 'López' }] });
    expect(c.bloques.map((b) => b.tipo)).toEqual(['titulo', 'parrafo', 'parrafo', 'titulo', 'cita', 'parrafo']);
    expect(c.bloques[5]?.ruta).toEqual(['El panóptico', '3.2 La mirada']);
    expect(c.bloques[5]?.parrafo).toBe(2);
    expect(c.notas).toEqual([{ id: 'footnote-1', texto: 'Foucault, Vigilar y castigar, p. 23.', bloque: 2 }]);
  });

  it('EPUB: lomo, índice, metadatos OPF y folios impresos', async () => {
    const p = await doc('prueba.epub');
    const c = p.contenido as ContenidoDocumento;
    expect(p.tipo).toBe('epub');
    expect(p.metadatos).toMatchObject({ titulo: 'Vigilar y castigar', autores: [{ nombre: 'Michel', apellidos: 'Foucault' }], anio: 1975, idioma: 'es', isbn: '9788420674209' });
    expect(c.paginasImpresas.map((x) => x.etiqueta)).toEqual(['11', '12', '13']);
    const pagina = (t: string) => c.bloques.find((b) => b.texto.startsWith(t))?.impresa;
    expect(pagina('Damiens')).toBe('11');
    expect(pagina('Párrafo de la página doce')).toBe('12');
    expect(pagina('Sigue en la página doce')).toBe('12');
    expect(pagina('Una cita larga')).toBe('13');
    expect(c.esquema.map((e) => [e.titulo, e.nivel, e.bloque])).toEqual([['I. Suplicio', 1, 0], ['El cuerpo de los condenados', 2, 2], ['II. Castigo', 1, 5]]);
    expect(c.notas[0]).toMatchObject({ id: 'n1', bloque: 1 });
  });

  it('ODT, RTF, Markdown, HTML y TXT', async () => {
    const odt = (await doc('prueba.odt')).contenido as ContenidoDocumento;
    expect(odt.notas[0]?.texto).toBe('La nota del ODT.');
    expect(odt.bloques[1]?.texto).toBe('Texto con espacio y nota[^ftn1].');
    const rtf = await doc('prueba.rtf');
    expect(rtf.metadatos.titulo).toBe('Documento RTF');
    expect((rtf.contenido as ContenidoDocumento).bloques[0]).toMatchObject({ tipo: 'titulo', texto: 'Título del RTF' });
    const md = await doc('prueba.md');
    expect(md.metadatos.autores).toEqual([{ nombre: 'José Luis', apellidos: 'Saorín' }]);
    const html = await doc('prueba.html');
    expect(html.metadatos).toMatchObject({ titulo: 'Un artículo', doi: '10.1234/abcd.5678', anio: 2021 });
    expect((html.contenido as ContenidoDocumento).bloques.some((b) => b.texto === 'Menú')).toBe(false);
    const txt = (await doc('prueba.txt')).contenido as ContenidoDocumento;
    expect(txt.bloques[1]?.texto).toContain('acordarme');
  });

  it('PPTX: texto y notas; las imágenes, al servidor', async () => {
    const p = await doc('prueba.pptx');
    const c = p.contenido as ContenidoPresentacion;
    expect(c.diapositivas).toEqual([
      { n: 1, titulo: 'Introducción', texto: '- Primera idea\n- Segunda idea', notas: '' },
      { n: 2, titulo: 'Conclusiones', texto: 'Todo cuadra', notas: 'Recordar citar a Foucault.' },
    ]);
    expect(p.reserva?.tareas).toContain('imagenes_diapositivas');
  });

  it('XLSX y CSV: tablas Markdown por tramos de filas', async () => {
    const x = (await doc('prueba.xlsx')).contenido as ContenidoHoja;
    expect(x.hojas.map((h) => h.nombre)).toEqual(['Obras', 'Resumen']);
    expect(x.hojas[0]?.tramos.map((t) => [t.filaDesde, t.filaHasta])).toEqual([[2, 51], [52, 101], [102, 121]]);
    const csv = (await doc('prueba.csv')).contenido as ContenidoHoja;
    expect(csv.hojas[0]?.cabecera).toEqual(['nombre', 'edad']);
  });
});

describe('imágenes', () => {
  it('fotos de un libro: orden numérico y orientación EXIF', async () => {
    const { paquete, datos } = await convertirEnMemoria([FIX + 'foto-10.jpg', FIX + 'foto-2.jpg', FIX + 'foto-1-rot6.jpg']);
    const c = paquete.contenido as ContenidoImagenes;
    expect(paquete.tipo).toBe('fotos');
    expect(c.paginas.map((p) => p.nombre)).toEqual(['foto-1-rot6.jpg', 'foto-2.jpg', 'foto-10.jpg']);
    expect(c.paginas[0]).toMatchObject({ orientacionExif: 6, anchoOriginal: 1200, altoOriginal: 1800 });
    expect(c.paginas[0]?.alto).toBe(1600);
    expect(datos.get('paginas/0001.jpg')?.[0]).toBe(0xff);
  });
});

describe.skipIf(!hayFfmpeg)('medios (Node con ffmpeg)', () => {
  it.skipIf(!hay('audio_conference.mp3'))('audio: un tramo Ogg/Opus a 16 kHz', async () => {
    const { paquete, datos } = await convertirEnMemoria(DATOS + 'audio_conference.mp3', { tramo: 25, solape: 2 });
    const c = paquete.contenido as ContenidoMedio;
    expect(paquete.duracion).toBeCloseTo(60, 0);
    expect(c.audio?.tramos.map((t) => [t.t0, t.t1])).toEqual([[0, 25], [23, 50], [48, 60]]);
    expect(c.audio?.mime).toBe('audio/ogg');
    const b = datos.get('audio/0001.ogg') as Uint8Array;
    expect(new TextDecoder().decode(b.subarray(0, 4))).toBe('OggS');
  }, 60_000);
  it.skipIf(!hay('3b1b_1min_real.mp4'))('vídeo: audio y fotogramas clave con instante', async () => {
    const { paquete } = await convertirEnMemoria(DATOS + '3b1b_1min_real.mp4');
    const c = paquete.contenido as ContenidoMedio;
    expect(paquete.tipo).toBe('video');
    expect(c.video?.fotogramas[0]).toMatchObject({ t: 0, motivo: 'inicio' });
    expect(c.video?.fotogramas.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < (c.video?.fotogramas.length ?? 0); i++) expect((c.video?.fotogramas[i]?.t ?? 0) - (c.video?.fotogramas[i - 1]?.t ?? 0)).toBeGreaterThanOrEqual(3);
    expect(c.audio?.tramos).toHaveLength(1);
  }, 60_000);
});
