import { memo } from 'react';
import { cx } from '@scholaris/ui';

/**
 * La página cuando no hay imagen (demostración, documentos de texto): un
 * facsímil con su titulillo y su folio al pie, para que la página siga siendo
 * un objeto y no solo texto.
 */
export const Facsimil = memo(function Facsimil({ texto, folio, titulillo, apaisada, className }: { texto: string; folio?: string | null; titulillo?: string; apaisada?: boolean; className?: string }) {
  const titulo = /^#+\s+(.+)$/m.exec(texto)?.[1];
  const limpio = texto.replace(/\*+/g, '').replace(/^#+\s+.*$/gm, '').replace(/^\s*[-*]\s+/gm, '— ').trim();
  return (
    <div className={cx('facsimil relative w-full overflow-hidden rounded-md', apaisada ? 'aspect-[16/9]' : 'aspect-[1/1.414]', className)} aria-hidden>
      <div className="absolute inset-0 flex flex-col px-[11%] pb-[7%] pt-[8%] text-[2.05cqi]">
        {titulillo ? <p className="mb-[5%] text-center text-[0.8em] uppercase tracking-[0.18em] opacity-80">{titulillo}</p> : null}
        {titulo ? <p className="mb-[6%] mt-[8%] text-center text-[1.35em] tracking-[0.02em]">{titulo}</p> : null}
        <p className="flex-1 overflow-hidden text-justify text-[1em] leading-[1.48] [hyphens:auto]" style={{ textIndent: '1.5em' }}>{limpio}</p>
        {folio ? <p className="mt-[4%] text-center text-[0.95em] tnum">{folio}</p> : null}
      </div>
    </div>
  );
});
