/** Montaje común de las pruebas de citas: la biblioteca de prueba de busqueda + un redactor de autocita falso. */
import { Buscador, IndiceVectorialSQL } from '@scholaris/busqueda';
import { strToU8, zipSync } from 'fflate';
import { EmbebedorFalso, JuezFalso, RedactorFalso, ReordenadorFalso, concepto } from '../../busqueda/test/apoyo/falsos.js';
import { cargarFixtura, DOCUMENTOS } from '../../busqueda/test/apoyo/fixtura.js';
import { crearSQL } from '../../busqueda/test/apoyo/sql-node.js';
import { terminos } from '@scholaris/busqueda';
import type { DocumentoCitable } from '../src/index.js';

export { DOCUMENTOS };

export const DOCS: DocumentoCitable[] = DOCUMENTOS.map((d) => ({ id: d.id, tipo: d.tipo, metadatos: d.metadatos }));
export const doc = (id: string) => DOCS.find((d) => d.id === id)!;

/**
 * Redactor de autocita falso: para cada afirmación propone el candidato con más
 * conceptos en común (y un segundo si también coincide), con la primera frase del
 * pasaje como evidencia. Además, a propósito, una propuesta inventada (C99) y una
 * evidencia que no está en el pasaje.
 */
export function redactorAutocita(latencia = 0): RedactorFalso {
  const r = new RedactorFalso(latencia);
  r.manejadores.push({
    si: /asistente de citación/,
    responder: (p) => {
      const u = p.mensajes[0]!.partes.map((x) => ('texto' in x ? x.texto : '')).join('');
      const afirmaciones = [...u.matchAll(/^\[(A\d+\.\d+)\] (.+)$/gm)].map((m) => ({ id: m[1]!, texto: m[2]! }));
      const candidatos = [...u.matchAll(/^\[(C\d+)\] [^\n]*\n([^\n]+)/gm)].map((m) => ({ id: m[1]!, texto: m[2]! }));
      const citas: unknown[] = [];
      for (const a of afirmaciones) {
        const ca = new Set(terminos(a.texto).map(concepto));
        const puntuados = candidatos.map((c) => {
          const cc = new Set(terminos(c.texto).map(concepto));
          let n = 0;
          for (const x of ca) if (cc.has(x)) n++;
          return { c, n };
        }).filter((x) => x.n >= 2).sort((x, y) => y.n - x.n).slice(0, 2);
        puntuados.forEach(({ c, n }, i) => {
          const evidencia = i === 0 ? c.texto.split(/(?<=[.:;])\s/)[0]!.replace(/[.:;]$/, '') : 'una frase que el pasaje no contiene';
          citas.push({ afirmacion: a.id, candidato: c.id, relacion: n >= 3 ? 'APOYO_DIRECTO' : 'CONTEXTO', evidencia, confianza: Math.min(0.95, 0.5 + n * 0.1), reescritura: /transformers/i.test(a.texto) ? 'Siguiendo la selección natural que describe Darwin, los transformers conservan las variaciones favorables' : null });
        });
      }
      if (afirmaciones[0]) citas.push({ afirmacion: afirmaciones[0].id, candidato: 'C99', relacion: 'APOYO_DIRECTO', evidencia: 'x', confianza: 0.99 });
      citas.push({ afirmacion: 'A99.9', candidato: 'C1', relacion: 'APOYO_DIRECTO', confianza: 0.99 });
      const json = { citas };
      return { texto: JSON.stringify(json), json };
    },
  });
  return r;
}

export async function montar(lat: { redactor?: number; emb?: number; juez?: number; reord?: number } = {}) {
  const sql = crearSQL();
  const embebedor = new EmbebedorFalso(0);
  await cargarFixtura(sql, embebedor);
  embebedor.latencia = lat.emb ?? 0;
  const juez = new JuezFalso(lat.juez ?? 0);
  const redactor = redactorAutocita(lat.redactor ?? 0);
  const buscador = new Buscador({ sql, embebedor, indice: new IndiceVectorialSQL(sql, embebedor.espacio), reordenador: new ReordenadorFalso(lat.reord ?? 0), redactor, juez, espacioNombres: 'pruebas' });
  return { sql, embebedor, juez, redactor, buscador };
}

/** Un DOCX mínimo pero realista: estilos, runs con formato, entidades, tabulador e hipervínculo. */
export function docxDePrueba(parrafos: string[] = []): Uint8Array {
  const cuerpo = parrafos.length ? parrafos.join('') : [
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Molinos y galeotes</w:t></w:r></w:p>',
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">Don Quijote ve treinta o cuarenta molinos de </w:t></w:r>'
      + '<w:r><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:i/><w:sz w:val="24"/></w:rPr><w:t>viento</w:t></w:r>'
      + '<w:r><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve"> en aquel campo y los toma por desaforados gigantes. Los galeotes van a las galeras por sus delitos &amp; de por fuerza.</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Tabla</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">con tabulador y </w:t></w:r><w:hyperlink r:id="rId9"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>un enlace</w:t></w:r></w:hyperlink><w:r><w:t>.</w:t></w:r></w:p>',
    '<w:p/>',
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">La rueda de la Fortuna no se detiene nunca, según Boecio.</w:t></w:r></w:p>',
  ].join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${cuerpo}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;
  const estilos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/></w:style></w:styles>';
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org" TargetMode="External"/></Relationships>'),
    'word/document.xml': strToU8(doc),
    'word/styles.xml': strToU8(estilos),
  });
}

/** Comprobación de buena formación: etiquetas equilibradas y entidades válidas. */
export function bienFormado(xml: string): boolean {
  const pila: string[] = [];
  for (const m of xml.replace(/<\?[^>]*\?>/g, '').matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) { if (pila.pop() !== m[2]) return false; } else pila.push(m[2]!);
  }
  return pila.length === 0 && !/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/i.test(xml);
}
