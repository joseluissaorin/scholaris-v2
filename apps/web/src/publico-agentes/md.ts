/**
 * Un Markdown pequeño y suficiente para las páginas públicas: el texto de cada
 * página se escribe una sola vez en Markdown (que es también su gemelo .md para
 * agentes) y de aquí sale el HTML semántico. Sin dependencias.
 *
 * Bloques: encabezados (#…####, con id), párrafos, listas (- y 1.), tablas con
 * barras, código entre ```, citas (>), reglas (---) y listas de definiciones:
 *
 *   Término
 *   : definición
 *
 * En línea: **negrita**, *cursiva*, `código` y [enlaces](url).
 */

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Identificador estable para un encabezado: minúsculas, sin tildes, con guiones. */
export function idDe(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[`*_[\]()«»"“”‘’'¿?¡!.,:;/]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

export function enLinea(t: string): string {
  const codigos: string[] = [];
  let s = t.replace(/`([^`]+)`/g, (_, c: string) => {
    codigos.push(`<code>${esc(c)}</code>`);
    return `\u0000${codigos.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt: string, url: string) => {
    const fuera = /^https?:\/\//.test(url) && !url.includes('scholaris');
    return `<a href="${url}"${fuera ? ' rel="noopener"' : ''}>${txt}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codigos[Number(i)]!);
}

export interface Encabezado { nivel: number; texto: string; id: string }

export interface Resultado { html: string; encabezados: Encabezado[] }

export function aHtml(md: string, o: { nivelBase?: number; copiar?: string } = {}): Resultado {
  const lineas = md.replace(/\r/g, '').split('\n');
  const fuera: string[] = [];
  const encabezados: Encabezado[] = [];
  const usados = new Set<string>();
  let i = 0;
  const esInicioDeBloque = (l: string) =>
    /^(#{1,6} |```|> |- |\* |\d+\. |\||---\s*$)/.test(l) || l.trim() === '';

  while (i < lineas.length) {
    const l = lineas[i]!;
    if (l.trim() === '') { i++; continue; }

    const h = /^(#{1,6}) (.+?)\s*(?:\{#([\w-]+)\})?$/.exec(l);
    if (h) {
      const nivel = Math.min(6, h[1]!.length + (o.nivelBase ?? 0));
      let id = h[3] ?? idDe(h[2]!);
      while (usados.has(id)) id += '-2';
      usados.add(id);
      encabezados.push({ nivel, texto: h[2]!.replace(/[`*]/g, ''), id });
      fuera.push(`<h${nivel} id="${id}">${enLinea(h[2]!)}</h${nivel}>`);
      i++;
      continue;
    }

    if (l.startsWith('```')) {
      const lengua = l.slice(3).trim();
      const cuerpo: string[] = [];
      i++;
      while (i < lineas.length && !lineas[i]!.startsWith('```')) cuerpo.push(lineas[i++]!);
      i++;
      fuera.push(`<div class="codigo"><button class="copiar" type="button">${o.copiar ?? 'Copiar'}</button><pre><code${lengua ? ` class="l-${lengua}"` : ''}>${esc(cuerpo.join('\n'))}</code></pre></div>`);
      continue;
    }

    if (/^---\s*$/.test(l)) { fuera.push('<hr>'); i++; continue; }

    if (l.startsWith('> ')) {
      const cuerpo: string[] = [];
      while (i < lineas.length && lineas[i]!.startsWith('>')) cuerpo.push(lineas[i++]!.replace(/^> ?/, ''));
      fuera.push(`<blockquote>${aHtml(cuerpo.join('\n'), o).html}</blockquote>`);
      continue;
    }

    if (l.startsWith('|')) {
      const filas: string[][] = [];
      while (i < lineas.length && lineas[i]!.startsWith('|')) {
        filas.push(lineas[i++]!.replace(/^\||\|\s*$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|')));
      }
      const [cab, sep, ...resto] = filas;
      const cuerpo = sep && sep.every((c) => /^:?-+:?$/.test(c)) ? resto : [sep!, ...resto].filter(Boolean);
      const der = sep ? sep.map((c) => c.endsWith(':') && !c.startsWith(':')) : [];
      const td = (c: string, k: number, tag: string, extra = '') => `<${tag}${extra}${der[k] ? ' class="num"' : ''}>${enLinea(c)}</${tag}>`;
      fuera.push(`<div class="tabla"><table><thead><tr>${cab!.map((c, k) => td(c, k, 'th', ' scope="col"')).join('')}</tr></thead><tbody>${cuerpo
        .map((f) => `<tr>${f.map((c, k) => (k === 0 ? td(c, k, 'th', ' scope="row"') : td(c, k, 'td'))).join('')}</tr>`)
        .join('')}</tbody></table></div>`);
      continue;
    }

    const lista = /^(- |\* |\d+\. )/.exec(l);
    if (lista) {
      const ordenada = /^\d/.test(lista[1]!);
      const items: string[] = [];
      while (i < lineas.length && /^(- |\* |\d+\. )/.test(lineas[i]!) === true) {
        let item = lineas[i++]!.replace(/^(- |\* |\d+\. )/, '');
        while (i < lineas.length && /^ {2,}\S/.test(lineas[i]!)) item += ' ' + lineas[i++]!.trim();
        items.push(`<li>${enLinea(item)}</li>`);
      }
      fuera.push(ordenada ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    // Lista de definiciones: una línea suelta seguida de «: …».
    if (lineas[i + 1]?.startsWith(': ')) {
      const partes: string[] = [];
      while (i < lineas.length && lineas[i + 1]?.startsWith(': ')) {
        const termino = lineas[i++]!;
        const id = idDe(termino);
        partes.push(`<dt id="${id}">${enLinea(termino)}</dt>`);
        while (i < lineas.length && lineas[i]!.startsWith(': ')) {
          let def = lineas[i++]!.slice(2);
          while (i < lineas.length && /^ {2,}\S/.test(lineas[i]!)) def += ' ' + lineas[i++]!.trim();
          partes.push(`<dd>${enLinea(def)}</dd>`);
        }
        while (i < lineas.length && lineas[i]!.trim() === '') i++;
      }
      fuera.push(`<dl>${partes.join('')}</dl>`);
      continue;
    }

    const parrafo: string[] = [l];
    i++;
    while (i < lineas.length && !esInicioDeBloque(lineas[i]!) && !lineas[i + 1]?.startsWith(': ')) parrafo.push(lineas[i++]!);
    fuera.push(`<p>${enLinea(parrafo.join(' '))}</p>`);
  }
  return { html: fuera.join('\n'), encabezados };
}

/** El texto plano de un trozo de Markdown (para JSON-LD y descripciones). */
export function textoPlano(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*]/g, '')
    .replace(/^[#>:-]+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
