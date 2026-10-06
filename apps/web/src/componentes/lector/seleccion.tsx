/**
 * Al seleccionar texto en el lector aparece una barra: «Citar» copia la cita
 * con su localizador exacto (la página impresa, el segundo); «Parecidos» busca
 * pasajes cercanos; «Al cuaderno» guarda el pasaje.
 */
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Ancla, MetadatosDocumento } from '@scholaris/nucleo';
import type { UnidadVista } from '@scholaris/contrato';
import { avisar, Icono, MenuContenido, MenuDisparador, MenuElemento, MenuRaiz, MenuRotulo } from '@scholaris/ui';
import { api } from '../../datos/api';
import { q } from '../../datos/consultas';
import { citaEnTexto } from '../../lib/formato';
import { preferencia } from '../../lib/acciones';

export interface Seleccion {
  texto: string;
  ancla: Ancla;
  fin?: Ancla;
  orden: number;
  rect: { x: number; y: number; w: number };
}

/** Busca la unidad de un nodo del DOM: cada unidad lleva `data-orden`. */
function ordenDe(n: Node | null): number | null {
  const el = (n instanceof Element ? n : n?.parentElement)?.closest('[data-orden]');
  return el ? Number(el.getAttribute('data-orden')) : null;
}

export function useSeleccion(contenedor: RefObject<HTMLElement | null>, unidad: (orden: number) => UnidadVista | undefined) {
  const [sel, setSel] = useState<Seleccion | null>(null);
  useEffect(() => {
    let h = 0;
    const leer = () => {
      cancelAnimationFrame(h);
      h = requestAnimationFrame(() => {
        const s = document.getSelection();
        if (!s || s.isCollapsed || !s.rangeCount || !contenedor.current) { setSel(null); return; }
        const r = s.getRangeAt(0);
        if (!contenedor.current.contains(r.commonAncestorContainer)) { setSel(null); return; }
        const texto = s.toString().replace(/\s+/g, ' ').trim();
        const a = ordenDe(r.startContainer), b = ordenDe(r.endContainer);
        if (!texto || a == null) { setSel(null); return; }
        const ua = unidad(a), ub = b != null ? unidad(b) : undefined;
        if (!ua) { setSel(null); return; }
        const caja = r.getBoundingClientRect();
        setSel({ texto, ancla: ua.ancla, ...(ub && b !== a ? { fin: ub.ancla } : {}), orden: a, rect: { x: caja.left, y: caja.top, w: caja.width } });
      });
    };
    document.addEventListener('selectionchange', leer);
    window.addEventListener('scroll', leer, { passive: true });
    return () => { document.removeEventListener('selectionchange', leer); window.removeEventListener('scroll', leer); cancelAnimationFrame(h); };
  }, [contenedor, unidad]);
  return [sel, () => { document.getSelection()?.removeAllRanges(); setSel(null); }] as const;
}

export function citaCompleta(texto: string, meta: MetadatosDocumento, ancla: Ancla, fin?: Ancla) {
  const estilo = preferencia('estilo', 'apa');
  const recorte = texto.length > 600 ? `${texto.slice(0, 600)}…` : texto;
  const cita = citaEnTexto(meta, ancla, estilo, fin);
  return { estilo, cita, completa: estilo === 'chicago-note-bibliography' ? `«${recorte}»\n\n${cita}` : `«${recorte}» ${cita}` };
}

export function BarraSeleccion({ sel, documento, meta, alCerrar, extra }: { sel: Seleccion; documento: string; meta: MetadatosDocumento; alCerrar: () => void; /** Acciones propias (el reproductor añade «Enlace»). */ extra?: (clase: string) => ReactNode }) {
  const navegar = useNavigate();
  const qc = useQueryClient();
  const { data: cuadernos } = useQuery(q.cuadernos());

  async function citar() {
    const { completa, cita } = citaCompleta(sel.texto, meta, sel.ancla, sel.fin);
    try { await navigator.clipboard.writeText(completa); avisar(`Cita copiada: ${cita}`, { tono: 'exito' }); }
    catch { avisar('El navegador no dejó copiar.', { tono: 'error' }); }
    alCerrar();
  }

  async function guardar(cuaderno: string, titulo: string) {
    try {
      await api().cuadernos.crearTarjeta(cuaderno, { tipo: 'unidad', documento, objetivo: `u-${documento}-${sel.orden}`, contenido: { texto: sel.texto } });
      void qc.invalidateQueries({ queryKey: ['tarjetas', cuaderno] });
      void qc.invalidateQueries({ queryKey: ['cuadernos'] });
      avisar(`Guardado en «${titulo}».`, { tono: 'exito', accion: { etiqueta: 'Ver', alPulsar: () => void navegar({ to: '/escribir/cuadernos', search: { c: cuaderno } }) } });
    } catch { avisar('No se pudo guardar el pasaje.', { tono: 'error' }); }
    alCerrar();
  }

  const arriba = sel.rect.y > 64;
  const estilo = { left: Math.max(8, Math.min(window.innerWidth - (extra ? 420 : 330), sel.rect.x + sel.rect.w / 2 - 160)), top: arriba ? sel.rect.y - 52 : sel.rect.y + 28 };
  const boton = 'flex h-9 items-center gap-2 rounded-lg px-3 text-[0.8125rem] font-semibold hover:bg-white/10';
  return (
    <div role="toolbar" aria-label="Acciones con el texto seleccionado" style={estilo} className="fixed z-40 flex items-center gap-0.5 rounded-xl border border-[#1a0f0a] bg-[#2c1810] p-1 text-[#faf7f0] shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_8px_24px_rgb(44_24_16/0.3)] anim-dialogo" onMouseDown={(e) => e.preventDefault()}>
      <button type="button" className={boton} onClick={() => void citar()}><Icono nombre="citar" tam={16} />Citar</button>
      <button type="button" className={boton} onClick={() => { void navegar({ to: '/buscar', search: { q: sel.texto.slice(0, 240) } }); alCerrar(); }}><Icono nombre="buscar" tam={16} />Parecidos</button>
      {extra?.(boton)}
      <MenuRaiz>
        <MenuDisparador asChild><button type="button" className={boton}><Icono nombre="marcador" tam={15} />Al cuaderno</button></MenuDisparador>
        <MenuContenido alinear="center">
          <MenuRotulo>Guardar en</MenuRotulo>
          {(cuadernos ?? []).map((c) => <MenuElemento key={c.id} icono="escribir" alElegir={() => void guardar(c.id, c.titulo)}>{c.titulo}</MenuElemento>)}
          {!cuadernos?.length ? <p className="px-2.5 py-2 text-[0.875rem] text-apagado">Aún no tienes cuadernos.</p> : null}
        </MenuContenido>
      </MenuRaiz>
    </div>
  );
}
