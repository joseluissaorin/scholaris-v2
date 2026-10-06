/**
 * Genera los archivos sintéticos de prueba (DOCX, EPUB, XLSX, ODT, PPTX…).
 * Uso: npx tsx packages/imprenta/test/fixtures/generar.ts
 */
import { writeFileSync } from 'node:fs';
import { strToU8, zipSync, type Zippable } from 'fflate';
import * as XLSX from 'xlsx';

const dir = new URL('.', import.meta.url).pathname;
const escribir = (nombre: string, datos: Uint8Array | string) => writeFileSync(dir + nombre, datos);
const zip = (archivos: Record<string, string>, mimetypePrimero?: string): Uint8Array => {
  const z: Zippable = {};
  if (mimetypePrimero) z.mimetype = [strToU8(mimetypePrimero), { level: 0 }];
  for (const [k, v] of Object.entries(archivos)) z[k] = strToU8(v);
  return zipSync(z, { level: 6 });
};

// --- DOCX -------------------------------------------------------------------
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const p = (texto: string, estilo?: string) => `<w:p>${estilo ? `<w:pPr><w:pStyle w:val="${estilo}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${texto}</w:t></w:r></w:p>`;
escribir('prueba.docx', zip({
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>`,
  'word/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Ttulo2"><w:name w:val="heading 2"/></w:style><w:style w:type="paragraph" w:styleId="Cita"><w:name w:val="Quote"/></w:style></w:styles>`,
  'word/footnotes.xml': `<?xml version="1.0" encoding="UTF-8"?><w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>Foucault, Vigilar y castigar, p. 23.</w:t></w:r></w:p></w:footnote></w:footnotes>`,
  'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${[
    p('El panóptico', 'Ttulo1'),
    p('Primer párrafo de la introducción.'),
    `<w:p><w:r><w:t xml:space="preserve">Segundo párrafo con una nota</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:t>.</w:t></w:r></w:p>`,
    p('3.2 La mirada', 'Ttulo2'),
    p('La visibilidad es una trampa.', 'Cita'),
    p('Párrafo final de la sección.'),
  ].join('')}</w:body></w:document>`,
  'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>Ensayo sobre el panóptico</dc:title><dc:creator>Ana García López</dc:creator><dcterms:created>2024-03-01T10:00:00Z</dcterms:created></cp:coreProperties>`,
}));

// --- EPUB 3 con lista de páginas ---------------------------------------------
const xhtml = (cuerpo: string) => `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title></head><body>${cuerpo}</body></html>`;
escribir('prueba.epub', zip({
  'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:isbn:9788420674209</dc:identifier><dc:title>Vigilar y castigar</dc:title><dc:creator id="c1">Michel Foucault</dc:creator><meta refines="#c1" property="role">aut</meta><dc:language>es</dc:language><dc:date>1975</dc:date><dc:publisher>Siglo XXI</dc:publisher></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="texto/cap1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="texto/cap2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  'OEBPS/nav.xhtml': xhtml(`<nav epub:type="toc"><ol><li><a href="texto/cap1.xhtml">I. Suplicio</a><ol><li><a href="texto/cap1.xhtml#s2">El cuerpo de los condenados</a></li></ol></li><li><a href="texto/cap2.xhtml">II. Castigo</a></li></ol></nav><nav epub:type="page-list"><ol><li><a href="texto/cap1.xhtml#p11">11</a></li><li><a href="texto/cap1.xhtml#p12">12</a></li><li><a href="texto/cap2.xhtml#p13">13</a></li></ol></nav>`),
  'OEBPS/texto/cap1.xhtml': xhtml(`<span epub:type="pagebreak" id="p11" title="11"/><h1>I. Suplicio</h1><p>Damiens fue condenado.<a epub:type="noteref" href="#n1">1</a></p><h2 id="s2">El cuerpo de los condenados</h2><p>Primer párrafo de la sección.</p><span epub:type="pagebreak" id="p12" title="12"/><p>Párrafo de la página doce.</p><aside epub:type="footnote" id="n1"><p>Pièces originales et procédures, 1757.</p></aside>`),
  'OEBPS/texto/cap2.xhtml': xhtml(`<h1>II. Castigo</h1><p>Sigue en la página doce.</p><div epub:type="pagebreak" id="p13" title="13"></div><blockquote><p>Una cita larga.</p></blockquote><ul><li>uno</li><li>dos</li></ul>`),
}, 'application/epub+zip'));

// --- XLSX -------------------------------------------------------------------
const libro = XLSX.utils.book_new();
const filas: unknown[][] = [['Año', 'Autor', 'Obra']];
for (let i = 0; i < 120; i++) filas.push([1900 + i, `Autor ${i}`, `Obra | ${i}`]);
XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), 'Obras');
XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['Clave', 'Valor'], ['a', 1], ['b', 2]]), 'Resumen');
escribir('prueba.xlsx', new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));

// --- ODT --------------------------------------------------------------------
escribir('prueba.odt', zip({
  'content.xml': `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:h text:outline-level="1">Capítulo uno</text:h><text:p>Texto con<text:s/>espacio y nota<text:note text:id="ftn1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>La nota del ODT.</text:p></text:note-body></text:note>.</text:p><text:list><text:list-item><text:p>elemento</text:p></text:list-item></text:list></office:text></office:body></office:document-content>`,
  'meta.xml': `<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"><office:meta><dc:title>Documento ODT</dc:title><meta:initial-creator>Luis Pérez</meta:initial-creator></office:meta></office:document-meta>`,
}, 'application/vnd.oasis.opendocument.text'));

// --- PPTX -------------------------------------------------------------------
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const forma = (tipo: string, parrafos: string[]) => `<p:sp><p:nvSpPr><p:cNvPr id="1" name="x"/><p:cNvSpPr/><p:nvPr><p:ph type="${tipo}"/></p:nvPr></p:nvSpPr><p:txBody>${parrafos.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
const diapo = (titulo: string, cuerpo: string[]) => `<?xml version="1.0" encoding="UTF-8"?><p:sld ${P}><p:cSld><p:spTree>${forma('title', [titulo])}${forma('body', cuerpo)}</p:spTree></p:cSld></p:sld>`;
const rel = (id: string, tipo: string, destino: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${tipo}" Target="${destino}"/>`;
const rels = (r: string) => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r}</Relationships>`;
escribir('prueba.pptx', zip({
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
  'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>`,
  'ppt/_rels/presentation.xml.rels': rels(rel('rId2', 'slide', 'slides/slide1.xml') + rel('rId3', 'slide', 'slides/slide2.xml')),
  'ppt/slides/slide1.xml': diapo('Introducción', ['Primera idea', 'Segunda idea']),
  'ppt/slides/slide2.xml': diapo('Conclusiones', ['Todo cuadra']),
  'ppt/slides/_rels/slide2.xml.rels': rels(rel('rId1', 'notesSlide', '../notesSlides/notesSlide2.xml')),
  'ppt/notesSlides/notesSlide2.xml': `<?xml version="1.0" encoding="UTF-8"?><p:notes ${P}><p:cSld><p:spTree>${forma('sldImg', [])}${forma('body', ['Recordar citar a Foucault.'])}${forma('sldNum', ['2'])}</p:spTree></p:cSld></p:notes>`,
}));

// --- Texto ------------------------------------------------------------------
escribir('prueba.md', `---\ntitle: Notas de lectura\nauthor: José Luis Saorín\n---\n\n# Primera parte\n\nUn párrafo con *cursiva* y una nota[^a].\n\n## Sección\n\n- uno\n- dos\n\n> Una cita.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[^a]: El texto de la nota.\n`);
escribir('prueba.html', `<!doctype html><html lang="es"><head><title>Artículo</title><meta name="citation_title" content="Un artículo"><meta name="citation_author" content="Ruiz, Marta"><meta name="citation_doi" content="10.1234/abcd.5678"><meta name="citation_publication_date" content="2021/05/01"></head><body><nav>Menú</nav><article><h1>Un artículo</h1><p>Primero<p>Segundo con <em>énfasis</em> &amp; entidad.<h2>Parte</h2><table><tr><th>x</th><th>y</th></tr><tr><td>1</td><td>2</td></tr></table></article></body></html>`);
escribir('prueba.rtf', String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times;}}{\info{\title Documento RTF}{\author Carmen Ruiz}}{\pard\outlinelevel0 T\'edtulo del RTF\par}{\pard Un p\'e1rrafo con \u241?e y nota{\footnote\pard Nota al pie RTF.}.\par}{\pard Segundo p\'e1rrafo.\par}}`);
escribir('prueba.txt', 'CAPÍTULO I\n\nEn un lugar de la Mancha, de cuyo nombre no quiero acordar-\nme, no ha mucho tiempo.\n\nSegundo párrafo.\n');
escribir('prueba.csv', 'nombre;edad\nAna;30\nLuis;41\n');
console.log('Fixtures generados en', dir);
