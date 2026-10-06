/**
 * Exportación de un informe de concepto: CSV, JSON, JSONL, HTML, BibTeX,
 * TEI y XLSX (hoja mínima en OOXML, hecha a mano con fflate).
 */

import { strToU8, zipSync } from 'fflate';
import type { SQL } from '@scholaris/nucleo';
import { leerDocumentos } from '../estanteria.js';
import { ErrorFunciones } from '../util.js';
import { obtenerConcepto, obtenerInforme, todosLosTramos, type TramoCompleto } from './conceptos.js';

export const FORMATOS_EXPORTACION = ['csv', 'json', 'jsonl', 'html', 'bibtex', 'tei', 'xlsx'] as const;
export type FormatoExportacion = (typeof FORMATOS_EXPORTACION)[number];

export interface Exportacion {
  cuerpo: Uint8Array;
  tipo: string;
  nombre: string;
}

const COLUMNAS: Array<[keyof TramoCompleto, string]> = [
  ['documento', 'Documento'], ['titulo', 'Título'], ['anio', 'Año'], ['etiqueta', 'Lugar'], ['citaCorta', 'Cita'],
  ['texto', 'Forma'], ['lema', 'Lema'], ['frase', 'Frase'], ['uso', 'Uso'], ['puntuacion', 'Confianza'],
  ['tipoCoincidencia', 'Coincidencia'], ['idioma', 'Idioma'], ['veredicto', 'Juez'], ['etiquetaUsuario', 'Revisión'], ['fragmento', 'Fragmento'],
];

const escaparHTML = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const escaparXML = (s: string) => escaparHTML(s).replace(/'/g, '&apos;');
const valor = (t: TramoCompleto, k: keyof TramoCompleto) => (t[k] === undefined || t[k] === null ? '' : String(t[k]));

function csv(tramos: TramoCompleto[]): string {
  const celda = (s: string) => (/[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  // BOM para que Excel abra bien las tildes.
  return '﻿' + [COLUMNAS.map(([, n]) => n).join(','), ...tramos.map((t) => COLUMNAS.map(([k]) => celda(valor(t, k))).join(','))].join('\r\n') + '\r\n';
}

function resaltar(t: TramoCompleto): string {
  const frase = t.frase ?? t.texto;
  const i = frase.toLowerCase().indexOf(t.texto.toLowerCase());
  if (i < 0) return escaparHTML(frase);
  return escaparHTML(frase.slice(0, i)) + '<mark>' + escaparHTML(frase.slice(i, i + t.texto.length)) + '</mark>' + escaparHTML(frase.slice(i + t.texto.length));
}

function html(nombre: string, resumen: string | undefined, tramos: TramoCompleto[]): string {
  const porDoc = new Map<string, TramoCompleto[]>();
  for (const t of tramos) porDoc.set(t.documento, [...(porDoc.get(t.documento) ?? []), t]);
  const secciones = [...porDoc.values()].map((ts) => `
  <section>
    <h2>${escaparHTML(ts[0]!.titulo || ts[0]!.documento)}</h2>
    <ol>${ts.map((t) => `
      <li><blockquote>${resaltar(t)}</blockquote><p class="pie">${escaparHTML(t.citaCorta ?? t.etiqueta)}${t.uso ? ` · ${escaparHTML(t.uso)}` : ''} · confianza ${t.puntuacion.toFixed(2)}</p></li>`).join('')}
    </ol>
  </section>`).join('');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escaparHTML(nombre)}: informe de Scholaris</title>
<style>
  body { font-family: Georgia, serif; max-width: 46rem; margin: 3rem auto; padding: 0 1rem; color: #2b2622; background: #fbf7f0; line-height: 1.55; }
  h1 { font-weight: normal; } h2 { font-size: 1.15rem; margin-top: 2.5rem; border-bottom: 1px solid #d9cfc0; }
  blockquote { margin: 0.4rem 0; } mark { background: #f1d9c9; color: inherit; } .pie { color: #8a7d70; font-size: 0.85rem; margin: 0 0 0.9rem; }
</style>
</head>
<body>
<h1>${escaparHTML(nombre)}</h1>
<p>${tramos.length} tramos en ${porDoc.size} documentos.</p>
${resumen ? `<p>${escaparHTML(resumen)}</p>` : ''}${secciones}
</body>
</html>
`;
}

function claveBib(autores: string[], anio: number | undefined, id: string): string {
  const a = (autores[0] ?? 'anonimo').split(/\s+/).pop()!.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z]/g, '').toLowerCase() || 'anonimo';
  return `${a}${anio ?? 'sf'}${id.slice(-4)}`;
}

async function bibtex(sql: SQL, tramos: TramoCompleto[]): Promise<string> {
  const docs = await leerDocumentos(sql, [...new Set(tramos.map((t) => t.documento))]);
  return [...docs.values()].map((d) => {
    const m = d.metadatos;
    const campos: Array<[string, string | number | undefined]> = [
      ['title', d.titulo], ['author', (m.autores ?? []).map((a) => `${a.apellidos}, ${a.nombre}`).join(' and ') || undefined],
      ['year', d.anio ?? undefined], ['publisher', m.editorial], ['address', m.lugar], ['journal', m.revista],
      ['volume', m.volumen], ['number', m.numero], ['pages', m.paginas], ['doi', m.doi], ['isbn', m.isbn], ['url', m.url],
      ['note', `${tramos.filter((t) => t.documento === d.id).length} tramos en el informe`],
    ];
    const tipo = m.revista ? 'article' : 'book';
    return `@${tipo}{${claveBib(d.autores, d.anio ?? undefined, d.id)},\n${campos.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `  ${k} = {${String(v).replace(/[{}]/g, '')}}`).join(',\n')}\n}`;
  }).join('\n\n') + '\n';
}

function tei(nombre: string, tramos: TramoCompleto[]): string {
  const items = tramos.map((t) => `      <item xml:id="${escaparXML(t.id)}" ana="#${escaparXML(t.uso ?? 'sin_uso')}" cert="${t.puntuacion.toFixed(3)}">
        <quote>${escaparXML(t.frase ?? t.texto)}</quote>
        <term>${escaparXML(t.texto)}</term>
        <bibl><title>${escaparXML(t.titulo)}</title>${t.anio ? `<date>${t.anio}</date>` : ''}<citedRange>${escaparXML(t.etiqueta)}</citedRange><ptr target="scholaris:${escaparXML(t.fragmento)}"/></bibl>
      </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>${escaparXML(nombre)}: informe de concepto</title></titleStmt>
      <publicationStmt><p>Generado por Scholaris.</p></publicationStmt>
      <sourceDesc><p>Biblioteca personal del usuario.</p></sourceDesc>
    </fileDesc>
  </teiHeader>
  <text>
    <body>
      <list type="spans">
${items}
      </list>
    </body>
  </text>
</TEI>
`;
}

/** Hoja de cálculo mínima (una hoja, cadenas en línea). */
export function xlsx(cabecera: string[], filas: string[][]): Uint8Array {
  const col = (i: number) => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
  const celda = (v: string, r: number, c: number) => {
    const ref = `${col(c)}${r}`;
    if (v !== '' && /^-?\d+(\.\d+)?$/.test(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escaparXML(v)}</t></is></c>`;
  };
  const filasXML = [cabecera, ...filas].map((f, r) => `<row r="${r + 1}">${f.map((v, c) => celda(v, r + 1, c)).join('')}</row>`).join('');
  const archivos: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tramos" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${filasXML}</sheetData></worksheet>`),
  };
  return zipSync(archivos, { level: 6 });
}

export async function exportarInforme(sql: SQL, informe: string, formato: string): Promise<Exportacion> {
  if (!FORMATOS_EXPORTACION.includes(formato as FormatoExportacion)) {
    throw new ErrorFunciones('peticion_invalida', `Formato no admitido: «${formato}». Usa ${FORMATOS_EXPORTACION.map((f) => `«${f}»`).join(', ')}.`);
  }
  const inf = await obtenerInforme(sql, informe);
  const concepto = await obtenerConcepto(sql, inf.concepto);
  const tramos = await todosLosTramos(sql, informe);
  const base = `concepto-${concepto.nombre.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-${informe.slice(-6)}`;
  switch (formato as FormatoExportacion) {
    case 'csv': return { cuerpo: strToU8(csv(tramos)), tipo: 'text/csv; charset=utf-8', nombre: `${base}.csv` };
    case 'json': return { cuerpo: strToU8(JSON.stringify({ concepto, informe: inf, tramos }, null, 2)), tipo: 'application/json; charset=utf-8', nombre: `${base}.json` };
    case 'jsonl': return { cuerpo: strToU8(tramos.map((t) => JSON.stringify(t)).join('\n') + '\n'), tipo: 'application/x-ndjson; charset=utf-8', nombre: `${base}.jsonl` };
    case 'html': return { cuerpo: strToU8(html(concepto.nombre, inf.resumen, tramos)), tipo: 'text/html; charset=utf-8', nombre: `${base}.html` };
    case 'bibtex': return { cuerpo: strToU8(await bibtex(sql, tramos)), tipo: 'application/x-bibtex; charset=utf-8', nombre: `${base}.bib` };
    case 'tei': return { cuerpo: strToU8(tei(concepto.nombre, tramos)), tipo: 'application/tei+xml; charset=utf-8', nombre: `${base}.xml` };
    case 'xlsx':
      return {
        cuerpo: xlsx(COLUMNAS.map(([, n]) => n), tramos.map((t) => COLUMNAS.map(([k]) => valor(t, k)))),
        tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        nombre: `${base}.xlsx`,
      };
  }
}
