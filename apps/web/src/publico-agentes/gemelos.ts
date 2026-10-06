/**
 * Los gemelos en Markdown de las páginas públicas que ya existían: la portada
 * (/acerca, /en) y la guía de la API (/api, /en/api). Salen de los mismos
 * textos que su HTML, así que no pueden desincronizarse.
 */
import { TEXTOS as PORTADA } from '../portada/textos';
import { TEXTOS as GUIA } from '../guia-api/textos';
import { EJEMPLOS } from '../guia-api/pagina';
import sesion from '../guia-api/sesion.json';
import { ORIGEN } from './origen';
import type { Lengua } from './contenido';

/** HTML mínimo de los textos → Markdown. */
const md = (t: string) =>
  t
    .replace(/<em>(.*?)<\/em>/g, '*$1*')
    .replace(/<strong[^>]*>(.*?)<\/strong>/g, '**$1**')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&');
/** «campo» de la guía → `campo`. */
const conCodigo = (t: string) => t.replace(/«([^»]+)»/g, '`$1`');

function frontal(titulo: string, descripcion: string, ruta: string, lengua: Lengua, otra: string, fecha: string): string {
  return `---
title: ${JSON.stringify(titulo)}
description: ${JSON.stringify(descripcion)}
url: ${ORIGEN}${ruta}
markdown: ${ORIGEN}${ruta}.md
lang: ${lengua}
alternate_${lengua === 'es' ? 'en' : 'es'}: ${ORIGEN}${otra}.md
updated: ${fecha}
author: José Luis Saorín Ferrer (https://joseluissaorin.com)
---
`;
}

export function portadaMd(l: Lengua, fecha: string): string {
  const t = PORTADA[l];
  const saber = l === 'es' ? `${ORIGEN}/saber.md` : `${ORIGEN}/en/knowledge.md`;
  const partes: string[] = [
    frontal(t.titulo, t.descripcion, t.ruta, l, t.otra.ruta, fecha),
    `# ${t.heroe.titular}`,
    '',
    `> ${t.heroe.entradilla}`,
    '',
    l === 'es'
      ? `Esta es la portada de Scholaris, escrita como un ensayo en ocho capítulos. Los detalles técnicos (formatos, citas, privacidad, API, rendimiento) están en la base de conocimiento: ${saber}`
      : `This is Scholaris's front page, written as an essay in eight chapters. The technical details (formats, citations, privacy, API, performance) are in the knowledge base: ${saber}`,
    '',
  ];
  const capitulo = (numero: string, rubrica: string, parrafos: string[], glosa?: string) => {
    partes.push(`## ${numero} ${rubrica}`, '', ...parrafos.flatMap((p) => [md(p), '']));
    if (glosa) partes.push(`> ${md(glosa)}`, '');
  };
  t.capitulos.forEach((c, i) => {
    capitulo(c.numero, c.rubrica, c.parrafos, c.glosa);
    if (c.id === 'mano') {
      const e = t.especimen;
      partes.push(`> «${e.cita}»`, `> ${md(e.fuente)}, ${e.folio}`, '', e.minuto, '');
    }
    void i;
  });
  partes.push(`## ${t.hace.numero} ${t.hace.rubrica}`, '');
  for (const c of t.hace.cosas) partes.push(`- **${c.que}** (${c.dato}). ${c.como}`);
  partes.push('');
  capitulo(t.quien.numero, t.quien.rubrica, t.quien.parrafos);
  partes.push(`## ${t.colofon.titulo}`, '', t.colofon.texto, '', `*${t.colofon.firma}*`, '');
  partes.push(
    l === 'es'
      ? `Empezar: ${ORIGEN}/?entrar · Probar sin cuenta: ${ORIGEN}/?demostracion`
      : `Start: ${ORIGEN}/?entrar · Try it without an account: ${ORIGEN}/?demostracion`,
    '',
  );
  return partes.join('\n');
}

export function guiaMd(l: Lengua, fecha: string): string {
  const t = GUIA[l];
  const B = `${ORIGEN}/api/v1`;
  const bloque = (c: string, lengua = 'sh') => `\`\`\`${lengua}\n${c}\n\`\`\``;
  const p: string[] = [
    frontal(t.titulo, t.descripcion, t.ruta, l, t.otra.ruta, fecha),
    `# ${t.heroe.titular}`,
    '',
    `> ${t.heroe.entradilla}`,
    '',
    `${l === 'es' ? 'Base' : 'Base URL'}: \`${B}\` · OpenAPI: ${B}/openapi.json · llms.txt: ${B}/llms.txt`,
    '',
    `## ${t.minuto.rubrica}`,
    '',
    ...t.minuto.pasos.map((x, i) => `${i + 1}. ${conCodigo(x)}`),
    '',
    bloque(EJEMPLOS.minuto!),
    '',
    t.minuto.despues,
    '',
    `## ${t.verbos.rubrica}`,
    '',
    t.verbos.intro,
    '',
  ];
  for (const v of t.verbos.lista) {
    p.push(`### ${v.metodo} /api/v1${v.ruta}`, '', conCodigo(v.que), '', bloque(EJEMPLOS[v.ejemplo]!), '');
  }
  p.push(conCodigo(t.verbos.formato), '', conCodigo(t.verbos.espera), '');
  p.push(`## ${t.sesion.rubrica}`, '', t.sesion.intro, '');
  sesion.sesion.forEach((s, i) => {
    p.push(`### ${t.sesion.comandos[i] ?? ''}`, '', bloque(s.comando), '', bloque(s.salida, 'text'), '');
  });
  p.push(`## ${t.js.rubrica}`, '', t.js.intro, '', bloque(EJEMPLOS.js!, 'js'), '');
  p.push(`## ${t.py.rubrica}`, '', `${t.py.intro} ${t.py.instalar}`, '', bloque(EJEMPLOS.pyInstalar!), '', bloque(EJEMPLOS.py!, 'py'), '');
  p.push(`## ${t.agentes.rubrica}`, '', t.agentes.intro, '', conCodigo(t.agentes.claudeCode), '', bloque(EJEMPLOS.claudeCode!), '', t.agentes.claudeApp, '', bloque(EJEMPLOS.claudeApp!, 'text'), '', t.agentes.otros, '', bloque(EJEMPLOS.otros!, 'json'), '', t.agentes.llms, '', bloque(EJEMPLOS.llms!), '');
  p.push(...t.agentes.reglas.map((r, i) => `${i + 1}. ${conCodigo(r)}`), '');
  p.push(`## ${t.errores.rubrica}`, '', conCodigo(t.errores.intro), '', `| ${t.errores.cabecera.join(' | ')} |`, '| --- | --- | --- |');
  for (const [c, h, q] of t.errores.codigos) p.push(`| \`${c}\` | ${h} | ${conCodigo(q)} |`);
  p.push('', t.errores.ritmo, '', t.errores.idem, '');
  p.push(`## ${t.anclas.rubrica}`, '', ...t.anclas.parrafos.flatMap((x) => [conCodigo(x), '']));
  return p.join('\n');
}

/** Título y descripción de las páginas viejas (para llms.txt y el sitemap). */
export function fichaDe(ruta: string): { titulo: string; descripcion: string; lengua: Lengua } {
  const p = Object.values(PORTADA).find((t) => t.ruta === ruta);
  if (p) return { titulo: p.titulo, descripcion: p.descripcion, lengua: p.lengua };
  const g = Object.values(GUIA).find((t) => t.ruta === ruta)!;
  return { titulo: g.titulo, descripcion: g.descripcion, lengua: g.lengua };
}
