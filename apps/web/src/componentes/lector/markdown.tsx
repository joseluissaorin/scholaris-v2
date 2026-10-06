/**
 * Markdown ligero (el que producen los lectores): párrafos, títulos con #,
 * listas, tablas, cursivas y negritas. Se pinta con elementos de React, nunca
 * con innerHTML, y sabe resaltar términos de búsqueda.
 */
import { Fragment, memo, type ReactNode } from 'react';
import { limpiarMarcadoOCR } from '@scholaris/nucleo';
import { useMarcadorEntidades, type MarcadorEntidades } from './contexto-entidades';

const normal = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function raicesDe(q?: string): string[] {
  if (!q) return [];
  return normal(q).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 3).map((t) => t.slice(0, Math.max(4, t.length - 2)));
}

function conMarcas(texto: string, raices: string[], clave: string, m?: MarcadorEntidades | null): ReactNode {
  // Las entidades se marcan cuando no hay términos de búsqueda que resaltar (nunca las dos cosas a la vez).
  if (!raices.length) return m?.marcar(texto, clave) ?? texto;
  const partes = texto.split(/([\p{L}\p{M}]+)/u);
  return partes.map((p, i) => (i % 2 === 1 && raices.some((r) => normal(p).startsWith(r)) ? <mark key={`${clave}-${i}`}>{p}</mark> : <Fragment key={`${clave}-${i}`}>{p}</Fragment>));
}

function enLinea(t: string, raices: string[], clave: string, ent?: MarcadorEntidades | null): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;
  let ultimo = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(t))) {
    if (m.index > ultimo) out.push(<Fragment key={`${clave}t${k++}`}>{conMarcas(t.slice(ultimo, m.index), raices, `${clave}a${k}`, ent)}</Fragment>);
    const s = m[0];
    if (s.startsWith('**')) out.push(<strong key={`${clave}b${k++}`}>{conMarcas(s.slice(2, -2), raices, `${clave}b${k}`, ent)}</strong>);
    else out.push(<em key={`${clave}i${k++}`}>{conMarcas(s.slice(1, -1), raices, `${clave}i${k}`, ent)}</em>);
    ultimo = m.index + s.length;
  }
  if (ultimo < t.length) out.push(<Fragment key={`${clave}f`}>{conMarcas(t.slice(ultimo), raices, `${clave}f`, ent)}</Fragment>);
  return out;
}

export const Markdown = memo(function Markdown({ texto, q, className, destacar }: { texto: string; q?: string; className?: string; destacar?: string }) {
  const raices = raicesDe(q);
  const ent = useMarcadorEntidades();
  const destacado = destacar ? normal(destacar).slice(0, 60) : null;
  const bloques = limpiarMarcadoOCR(texto).split(/\n\s*\n/);
  return (
    <div className={['prosa', className].filter(Boolean).join(' ')}>
      {bloques.map((b, i) => {
        const t = b.trim();
        if (!t) return null;
        const h = /^(#{1,6})\s+(.*)$/.exec(t);
        if (h) { const N = h[1]!.length <= 2 ? 'h2' : 'h3'; return <N key={i}>{enLinea(h[2]!, raices, `h${i}`, ent)}</N>; }
        if (t.startsWith('|')) {
          const filas = t.split('\n').filter((l) => !/^\|\s*-/.test(l)).map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
          const [cab, ...cuerpo] = filas;
          return (
            <div key={i} className="overflow-x-auto"><table><thead><tr>{cab?.map((c, j) => <th key={j}>{c}</th>)}</tr></thead><tbody>{cuerpo.map((f, j) => <tr key={j}>{f.map((c, k) => <td key={k}>{enLinea(c, raices, `t${i}${j}${k}`, ent)}</td>)}</tr>)}</tbody></table></div>
          );
        }
        if (/^[-*]\s/.test(t)) return <ul key={i}>{t.split('\n').map((l, j) => <li key={j}>{enLinea(l.replace(/^[-*]\s+/, ''), raices, `l${i}${j}`, ent)}</li>)}</ul>;
        const esDestacado = destacado && normal(t).includes(destacado);
        // Los saltos de línea se respetan: el verso y el teatro son líneas, no párrafos.
        const lineas = t.split('\n');
        return (
          <p key={i} data-destacado={esDestacado || undefined} className={esDestacado ? '-mx-3 border-l-[3px] border-rojo bg-rojo-suave/50 px-3 py-1' : undefined}>
            {lineas.map((l, j) => <Fragment key={j}>{j ? <br /> : null}{enLinea(l, raices, `p${i}l${j}`, ent)}</Fragment>)}
          </p>
        );
      })}
    </div>
  );
});
