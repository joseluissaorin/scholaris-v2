/**
 * Un DOCX mínimo y válido a partir de Markdown ligero (párrafos, títulos con #,
 * cursivas y negritas). Para cuando la autocita salió de un texto pegado y no
 * hay un DOCX original al que devolver las citas. Se carga solo al exportar.
 */
import { zipSync, strToU8 } from 'fflate';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function tramos(linea: string): string {
  const out: string[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;
  let ultimo = 0, m: RegExpExecArray | null;
  const tramo = (t: string, b = false, i = false) => out.push(`<w:r><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>${b ? '<w:b/>' : ''}${i ? '<w:i/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`);
  while ((m = re.exec(linea))) {
    if (m.index > ultimo) tramo(linea.slice(ultimo, m.index));
    const s = m[0];
    if (s.startsWith('**')) tramo(s.slice(2, -2), true); else tramo(s.slice(1, -1), false, true);
    ultimo = m.index + s.length;
  }
  if (ultimo < linea.length) tramo(linea.slice(ultimo));
  return out.join('');
}

export function markdownADocx(md: string): Blob {
  const parrafos = md.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((b) => {
    const h = /^(#{1,3})\s+(.*)$/.exec(b);
    if (h) return `<w:p><w:pPr><w:pStyle w:val="Heading${h[1]!.length}"/></w:pPr>${tramos(h[2]!)}</w:p>`;
    return `<w:p><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr>${b.split('\n').map(tramos).join('<w:r><w:br/></w:r>')}</w:p>`;
  });
  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parrafos.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701"/></w:sectPr></w:body></w:document>`;
  const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/><w:lang w:val="es-ES"/></w:rPr></w:rPrDefault></w:docDefaults>${[1, 2, 3].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:sz w:val="${36 - n * 4}"/></w:rPr></w:style>`).join('')}</w:styles>`;
  const archivos = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'word/document.xml': strToU8(documento),
    'word/styles.xml': strToU8(estilos),
  };
  return new Blob([zipSync(archivos) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
