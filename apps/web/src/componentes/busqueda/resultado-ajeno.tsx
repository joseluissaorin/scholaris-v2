/**
 * Un pasaje de una colección que sigues: como los tuyos, pero dice de dónde
 * sale («de Rosa · Seminario de Foucault») y se abre en la vista de esa
 * colección, en su folio o su minuto.
 */
import { Resaltado } from '../../lib/resaltado';
import { Link } from '@tanstack/react-router';
import type { ResultadoConjunto } from '@scholaris/contrato';
import { Folio } from '@scholaris/ui';

export function ResultadoAjeno({ r }: { r: ResultadoConjunto }) {
  const a = r.fragmento.ancla;
  const destino = a.tipo === 'tiempo' ? { doc: r.documento.id, t: Math.floor(a.t0) } : a.tipo === 'pagina' ? { doc: r.documento.id, u: a.fisica } : { doc: r.documento.id };
  return (
    <article className="grid gap-x-6 gap-y-2 border-b border-cream-300 py-5 md:grid-cols-[7rem_1fr]">
      <div className="flex items-start gap-2 md:flex-col"><Folio>{r.etiqueta}</Folio></div>
      <div className="min-w-0">
        <p className="mb-1 flex flex-wrap items-center gap-x-2 text-[0.75rem] text-coffee-500">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-azul/30 bg-azul/5 px-2 py-0.5 text-azul">
            <span className="h-2 w-2 rounded-full border-2 border-azul" />{r.origen.nombre}
          </span>
          {r.origen.de ? <span>de {r.origen.de}</span> : null}
        </p>
        <Link to="/compartida/$id" params={{ id: r.origen.biblioteca! }} search={destino} className="block">
          <h3 className="truncate text-[0.9375rem] font-semibold text-coffee-800 hover:underline">{r.documento.metadatos.titulo}</h3>
          <p className="mt-1.5 line-clamp-4 font-[Georgia] text-[0.9375rem] leading-relaxed text-coffee-800"><Resaltado html={r.resaltado ?? r.fragmento.texto} /></p>
        </Link>
        <p className="mt-1.5 text-[0.75rem] text-coffee-400">{r.citaCorta}</p>
      </div>
    </article>
  );
}
