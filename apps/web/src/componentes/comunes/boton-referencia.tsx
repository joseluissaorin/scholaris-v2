/**
 * «Copiar referencia»: un botón partido. La parte grande copia la entrada de
 * bibliografía en el estilo del usuario; la flecha cambia de estilo en un clic.
 * Al pasar el ratón, una vista previa enseña exactamente lo que se copia.
 */
import { useState } from 'react';
import { HoverCard } from 'radix-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cx, Icono, MenuContenido, MenuDisparador, MenuElemento, MenuRaiz, MenuRotulo } from '@scholaris/ui';
import { ESTILOS_RAPIDOS } from '../../lib/formato';
import { htmlSeguroReferencia } from '../../lib/resaltado';
import { copiarReferencia, nombreEstilo, qReferencia, useEstilo } from '../../lib/referencia';

export function BotonReferencia({ documento, compacto, className }: { documento: string; compacto?: boolean; className?: string }) {
  const [estilo, ponerEstilo] = useEstilo();
  const qc = useQueryClient();
  const [abierta, setAbierta] = useState(false);
  const { data, isPending } = useQuery({ ...qReferencia(documento, estilo), enabled: abierta });
  const [hecho, setHecho] = useState(false);

  async function copiar() {
    setAbierta(false);
    const t = await copiarReferencia(documento, estilo);
    if (t) { setHecho(true); setTimeout(() => setHecho(false), 1600); }
  }

  return (
    <div className={cx('flex h-9 shrink-0 items-stretch overflow-hidden rounded-xl border border-cream-400 bg-[linear-gradient(180deg,var(--s-cream-50)_0%,var(--s-cream-100)_100%)] shadow-[var(--relieve)]', className)}>
      <HoverCard.Root openDelay={250} closeDelay={80} open={abierta} onOpenChange={(v) => { setAbierta(v); if (v) void qc.prefetchQuery(qReferencia(documento, estilo)); }}>
        <HoverCard.Trigger asChild>
          <button type="button" onClick={() => void copiar()} onFocus={() => void qc.prefetchQuery(qReferencia(documento, estilo))}
            className="flex items-center gap-1.5 px-3 text-[0.8125rem] font-semibold text-coffee-800 hover:bg-cream-50 active:shadow-[var(--pulsado)]"
            aria-label={`Copiar la referencia bibliográfica (${nombreEstilo(estilo)})`}>
            <Icono nombre={hecho ? 'hecho' : 'citar'} tam={15} className={hecho ? 'text-verde' : 'text-coffee-500'} />
            {compacto ? null : <span>{hecho ? 'Copiada' : 'Copiar referencia'}</span>}
          </button>
        </HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content side="bottom" align="start" sideOffset={8} avoidCollisions={false} className="pointer-events-none z-50 w-[26rem] max-w-[90vw] rounded-xl border border-cream-400 bg-cream-50 p-4 shadow-[var(--levantado-alto)] anim-dialogo">
            <p className="rotulo text-coffee-400">Se copiará · {nombreEstilo(estilo)}</p>
            {isPending && !data ? <div className="esqueleto mt-2 h-10" /> : (
              <p className="mt-2 pl-6 -indent-6 font-serif text-[0.9375rem] leading-relaxed text-coffee-800" dangerouslySetInnerHTML={{ __html: htmlSeguroReferencia(data?.html || data?.texto || '') }} />
            )}
            <p className="mt-3 text-[0.75rem] text-coffee-400">Con formato (cursivas) y en texto plano · <kbd className="dato">⇧⌘C</kbd></p>
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard.Root>
      <MenuRaiz>
        <MenuDisparador asChild>
          <button type="button" aria-label={`Estilo: ${nombreEstilo(estilo)}. Cambiar`} className="flex items-center gap-1 border-l border-cream-300 px-2 text-[0.75rem] font-medium text-coffee-500 hover:bg-cream-50 hover:text-coffee-800">
            {compacto ? null : <span>{nombreEstilo(estilo)}</span>}
            <Icono nombre="abajo" tam={13} />
          </button>
        </MenuDisparador>
        <MenuContenido>
          <MenuRotulo>Estilo de las citas y referencias</MenuRotulo>
          {ESTILOS_RAPIDOS.map((e) => <MenuElemento key={e.id} icono={e.id === estilo ? 'hecho' : undefined} alElegir={() => ponerEstilo(e.id)}>{e.nombre}</MenuElemento>)}
        </MenuContenido>
      </MenuRaiz>
    </div>
  );
}

/** El acceso pequeño (un icono) para tarjetas, resultados y fuentes. */
export function AccesoReferencia({ documento, className, etiqueta }: { documento: string; className?: string; etiqueta?: boolean }) {
  const [estilo] = useEstilo();
  const qc = useQueryClient();
  return (
    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void copiarReferencia(documento, estilo); }}
      onPointerEnter={() => void qc.prefetchQuery(qReferencia(documento, estilo))}
      title={`Copiar la referencia (${nombreEstilo(estilo)})`} aria-label={`Copiar la referencia (${nombreEstilo(estilo)})`}
      className={cx('flex h-8 items-center gap-1.5 rounded-lg px-2 text-[0.8125rem] font-medium text-coffee-500 hover:bg-cream-200 hover:text-coffee-800', className)}>
      <Icono nombre="lector" tam={14} />{etiqueta ? 'Referencia' : null}
    </button>
  );
}
