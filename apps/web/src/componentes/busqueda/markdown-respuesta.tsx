/**
 * Pinta el Markdown de una respuesta de Investigar con elementos de React (nunca
 * con innerHTML). Las marcas de las pruebas las pinta quien llama (`cita`): así
 * el mismo árbol sirve con las pruebas en vivo y con las definitivas.
 */
import { Fragment, memo, type ReactNode } from 'react';
import { juntarCitas, type Bloque, type EnLinea } from '../../lib/markdown-respuesta';

export type PintarCita = (ids: string[], clave: string) => ReactNode;

function enLinea(hijos: EnLinea[], cita: PintarCita, clave: string): ReactNode[] {
  return juntarCitas(hijos).map((h, i) => {
    const k = `${clave}.${i}`;
    switch (h.t) {
      case 'texto': return <Fragment key={k}>{h.v}</Fragment>;
      case 'negrita': return <strong key={k}>{enLinea(h.hijos, cita, k)}</strong>;
      case 'cursiva': return <em key={k}>{enLinea(h.hijos, cita, k)}</em>;
      case 'codigo': return <code key={k}>{h.v}</code>;
      case 'enlace': {
        const fuera = /^(https?:|mailto:)/i.test(h.href);
        return <a key={k} href={h.href} {...(fuera ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{enLinea(h.hijos, cita, k)}</a>;
      }
      case 'cita': return <Fragment key={k}>{cita(h.ids, k)}</Fragment>;
      case 'sin-prueba': return (
        <span key={k} data-cita="" className="sin-prueba" title="La verificación no encontró prueba para lo que se afirma aquí.">
          sin prueba
        </span>
      );
      case 'salto': return <br key={k} />;
    }
  });
}

const ALINEACION = { izquierda: 'left', centro: 'center', derecha: 'right' } as const;

function bloque(b: Bloque, cita: PintarCita, clave: string): ReactNode {
  switch (b.t) {
    case 'titulo': {
      // La pregunta es el h2 de la tarjeta: los títulos de la respuesta van por debajo.
      const N = b.nivel <= 2 ? 'h3' : 'h4';
      return <N key={clave}>{enLinea(b.hijos, cita, clave)}</N>;
    }
    case 'parrafo': return <p key={clave}>{enLinea(b.hijos, cita, clave)}</p>;
    case 'lista': {
      const elementos = b.elementos.map((e, i) => (
        <li key={i}>{e.length === 1 && e[0]!.t === 'parrafo' ? enLinea(e[0]!.hijos, cita, `${clave}.${i}`) : e.map((x, j) => bloque(x, cita, `${clave}.${i}.${j}`))}</li>
      ));
      return b.ordenada ? <ol key={clave} start={b.inicio !== 1 ? b.inicio : undefined}>{elementos}</ol> : <ul key={clave}>{elementos}</ul>;
    }
    case 'cita-bloque': return <blockquote key={clave}>{b.hijos.map((x, i) => bloque(x, cita, `${clave}.${i}`))}</blockquote>;
    case 'tabla': return (
      <div key={clave} className="tabla-respuesta" role="region" aria-label="Tabla" tabIndex={0}>
        <table>
          <thead><tr>{b.cabecera.map((c, i) => <th key={i} scope="col" style={b.alineacion[i] ? { textAlign: ALINEACION[b.alineacion[i]!] } : undefined}>{enLinea(c, cita, `${clave}.h${i}`)}</th>)}</tr></thead>
          <tbody>{b.filas.map((f, i) => <tr key={i}>{f.map((c, j) => <td key={j} style={b.alineacion[j] ? { textAlign: ALINEACION[b.alineacion[j]!] } : undefined}>{enLinea(c, cita, `${clave}.${i}.${j}`)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
    case 'separador': return <hr key={clave} />;
    case 'codigo': return <pre key={clave}><code>{b.v}</code></pre>;
  }
}

export const MarkdownRespuesta = memo(function MarkdownRespuesta({ bloques, cita, className, final }: {
  bloques: Bloque[]; cita: PintarCita; className?: string;
  /** Lo que va al final del último bloque mientras se escribe (la gota de tinta). */
  final?: ReactNode;
}) {
  return (
    <div className={['respuesta-md', className].filter(Boolean).join(' ')}>
      {bloques.map((b, i) => bloque(b, cita, String(i)))}
      {final}
    </div>
  );
});
