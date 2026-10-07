/**
 * La paleta (⌘K): un solo sitio para ir, hacer y encontrar. Documentos por
 * título o autor al instante (de la caché), pasajes de la biblioteca mientras
 * se escribe, y «Preguntar» para lo que no es una búsqueda.
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { cx, Folio, Icono, Teclas, type NombreIcono } from '@scholaris/ui';
import type { ResultadoVista } from '@scholaris/contrato';
import { clienteConsultas, q } from '../../datos/consultas';
import { disparar, ponerTema, recientes, esOscuro } from '../../lib/acciones';
import { etiquetaCorta, ICONO_TIPO, NOMBRE_TIPO } from '../../lib/formato';
import { busquedaDeResultado, sembrarFragmento } from '../../datos/recorrido';
import { Resaltado } from '../../lib/resaltado';
import { useFlip } from '../../lib/flip';
import { copiarReferencia } from '../../lib/referencia';

interface Opcion {
  id: string;
  grupo: string;
  icono: NombreIcono;
  titulo: ReactNode;
  detalle?: ReactNode;
  folio?: string;
  hacer: () => void;
}

const normal = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export default function Paleta({ abierta, alCambiar }: { abierta: boolean; alCambiar: (v: boolean) => void }) {
  const navegar = useNavigate();
  const ruta = useRouterState({ select: (x) => x.location.pathname });
  const [texto, setTexto] = useState('');
  const [activa, setActiva] = useState(0);
  const lista = useRef<HTMLDivElement>(null);
  const diferido = useDeferredValue(texto);
  const [consulta, setConsulta] = useState('');

  // La búsqueda de pasajes espera 160 ms de calma: los documentos no esperan.
  useEffect(() => {
    const h = setTimeout(() => setConsulta(texto.trim()), 160);
    return () => clearTimeout(h);
  }, [texto]);

  const { data: docs } = useQuery({ ...q.documentos(), enabled: abierta });
  const pasajes = useQuery({ ...q.busqueda(consulta, {}), enabled: abierta && consulta.length > 2 });

  const cerrar = () => { alCambiar(false); setTexto(''); setActiva(0); };
  const ir = (f: () => void) => () => { cerrar(); f(); };

  const opciones = useMemo<Opcion[]>(() => {
    const t = normal(diferido.trim());
    const out: Opcion[] = [];
    const elementos = docs?.elementos ?? [];
    if (!t) {
      const rec = recientes().map((id) => elementos.find((d) => d.id === id)).filter(Boolean).slice(0, 4);
      for (const d of rec) out.push({ id: `r-${d!.id}`, grupo: 'Abiertos hace poco', icono: ICONO_TIPO[d!.tipo], titulo: d!.titulo, detalle: d!.autores, hacer: ir(() => void navegar({ to: '/lector/$id', params: { id: d!.id } })) });
    }
    const lugares: Array<[string, NombreIcono, () => void]> = [
      ['Biblioteca', 'biblioteca', () => void navegar({ to: '/' })],
      ['Buscar y preguntar', 'buscar', () => void navegar({ to: '/buscar' })],
      ['Autocita', 'citar', () => void navegar({ to: '/escribir' })],
      ['Cuadernos', 'escribir', () => void navegar({ to: '/escribir/cuadernos' })],
      ['Mapa de conceptos', 'explorar', () => void navegar({ to: '/explorar' })],
      ['Grafo de citas', 'explorar', () => void navegar({ to: '/explorar/grafo' })],
      ['Vigilantes y alertas', 'vigilante', () => void navegar({ to: '/buscar/vigilantes' })],
      ['Historial de búsquedas', 'historial', () => void navegar({ to: '/buscar/historial' })],
      ['Ajustes', 'ajustes', () => void navegar({ to: '/ajustes' })],
      ['Claves de API y MCP', 'llave', () => void navegar({ to: '/ajustes/claves' })],
    ];
    const enLector = /^\/lector\/([^/]+)/.exec(ruta)?.[1];
    const acciones: Array<[string, NombreIcono, () => void]> = [
      ...(enLector ? [['Copiar referencia de este documento', 'citar', () => void copiarReferencia(decodeURIComponent(enLector))] as [string, NombreIcono, () => void]] : []),
      ['Añadir archivos', 'subir', () => disparar('archivos')],
      ['Añadir desde un enlace', 'enlace', () => disparar('enlace')],
      ['Fotografiar páginas', 'camara', () => disparar('camara')],
      [esOscuro() ? 'Tema claro' : 'Tema oscuro', esOscuro() ? 'sol' : 'luna', () => ponerTema(esOscuro() ? 'claro' : 'oscuro')],
    ];
    for (const [n, i, f] of acciones) if (!t || normal(n).includes(t)) out.push({ id: `a-${n}`, grupo: 'Acciones', icono: i, titulo: n, hacer: ir(f) });
    for (const [n, i, f] of lugares) if (t ? normal(n).includes(t) : out.length < 9) out.push({ id: `l-${n}`, grupo: 'Ir a', icono: i, titulo: n, hacer: ir(f) });
    if (t) {
      const encontrados = elementos.filter((d) => normal(`${d.titulo} ${d.autores}`).includes(t)).slice(0, 5);
      for (const d of encontrados) out.unshift({ id: `d-${d.id}`, grupo: 'Documentos', icono: ICONO_TIPO[d.tipo], titulo: d.titulo, detalle: `${d.autores}${d.anio ? `, ${d.anio}` : ''} · ${NOMBRE_TIPO[d.tipo]}`, hacer: ir(() => void navegar({ to: '/lector/$id', params: { id: d.id } })) });
      if (t.length > 2) {
        for (const r of (pasajes.data?.resultados ?? []).slice(0, 6)) out.push(opcionPasaje(r, ir, navegar));
        out.push({ id: 'preguntar', grupo: 'Preguntar', icono: 'chispa', titulo: <>Preguntar a la biblioteca: <em>«{diferido.trim()}»</em></>, hacer: ir(() => void navegar({ to: '/buscar', search: { q: diferido.trim(), modo: 'preguntar' } })) });
        out.push({ id: 'buscar', grupo: 'Preguntar', icono: 'buscar', titulo: <>Ver todos los resultados de <em>«{diferido.trim()}»</em></>, hacer: ir(() => void navegar({ to: '/buscar', search: { q: diferido.trim() } })) });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diferido, docs, pasajes.data, ruta]);

  useEffect(() => setActiva(0), [diferido]);
  useFlip(lista, opciones.map((o) => o.id).join('|'));
  useEffect(() => {
    lista.current?.querySelector(`[data-indice="${activa}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activa]);

  const grupos = useMemo(() => {
    const m = new Map<string, Array<Opcion & { i: number }>>();
    opciones.forEach((o, i) => { if (!m.has(o.grupo)) m.set(o.grupo, []); m.get(o.grupo)!.push({ ...o, i }); });
    return [...m.entries()];
  }, [opciones]);

  return (
    <Dialog.Root open={abierta} onOpenChange={(v) => (v ? alCambiar(true) : cerrar())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgb(26_15_10/0.55)] backdrop-blur-sm anim-aparece" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[8vh] z-50 flex max-h-[min(36rem,80dvh)] w-[calc(100vw-1rem)] max-w-2xl -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-cream-400 bg-cream-100 shadow-[var(--levantado-alto)] anim-dialogo"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActiva((a) => Math.min(opciones.length - 1, a + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActiva((a) => Math.max(0, a - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); opciones[activa]?.hacer(); }
          }}
        >
          <Dialog.Title className="sr-only">Buscar en todo</Dialog.Title>
          <div className="m-2 flex items-center gap-3 rounded-xl border border-cream-400 bg-cream-50 px-4 shadow-[var(--hundido)]">
            <Icono nombre="buscar" tam={20} className="text-apagado" />
            <input
              autoFocus
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Busca un pasaje, un libro, una acción…"
              className="h-12 flex-1 bg-transparent text-[1rem] text-coffee-800 outline-none placeholder:text-coffee-300"
              role="combobox"
              aria-expanded
              aria-controls="paleta-lista"
              aria-activedescendant={opciones[activa] ? `paleta-${activa}` : undefined}
            />
            {pasajes.isFetching ? <span className="h-2 w-2 rounded-full bg-rojo anim-pulso" aria-label="Buscando" /> : null}
            <Teclas>Esc</Teclas>
          </div>
          <div ref={lista} id="paleta-lista" role="listbox" aria-label="Resultados" className="flex-1 overflow-y-auto overscroll-contain p-2">
            {grupos.map(([grupo, ops]) => (
              <div key={grupo} role="group" aria-label={grupo} className="mb-1">
                <p className="rotulo px-2.5 pb-1 pt-2.5 text-coffee-400">{grupo}</p>
                {ops.map((o) => (
                  <div
                    key={o.id}
                    data-flip={o.id}
                    id={`paleta-${o.i}`}
                    data-indice={o.i}
                    role="option"
                    aria-selected={o.i === activa}
                    onMouseMove={() => setActiva(o.i)}
                    onClick={o.hacer}
                    className={cx('flex cursor-default items-start gap-3 rounded-s px-2.5 py-2', o.i === activa ? 'bg-cream-50 text-coffee-800 shadow-[var(--relieve)]' : 'text-coffee-700')}
                  >
                    <Icono nombre={o.icono} tam={17} className="mt-0.5 shrink-0 opacity-80" />
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-[0.875rem] font-medium leading-snug">{o.titulo}</div>
                      {o.detalle ? <div className="mt-0.5 truncate text-[0.75rem] text-coffee-400">{o.detalle}</div> : null}
                    </div>
                    {o.folio ? <Folio>{o.folio}</Folio> : null}
                  </div>
                ))}
              </div>
            ))}
            {!opciones.length ? <p className="px-3 py-8 text-center text-apagado">Nada por aquí. Prueba con otras palabras.</p> : null}
          </div>
          <div className="hidden items-center gap-4 border-t border-cream-300 bg-cream-200/50 px-4 py-2 text-[0.75rem] text-coffee-400 sm:flex">
            <span><Teclas>↑</Teclas> <Teclas>↓</Teclas> moverse</span>
            <span><Teclas>↵</Teclas> abrir</span>
            <span className="ml-auto">Los pasajes abren el lector en su página exacta.</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function opcionPasaje(r: ResultadoVista, ir: (f: () => void) => () => void, navegar: ReturnType<typeof useNavigate>): Opcion {
  return {
    id: `p-${r.fragmento.id}`,
    grupo: 'Pasajes',
    icono: 'citar',
    titulo: <Resaltado html={r.resaltado ?? r.fragmento.texto} />,
    detalle: <><em>{r.documento.metadatos.titulo}</em> · {r.citaCorta}</>,
    folio: etiquetaCorta(r.pasaje?.ancla ?? r.fragmento.ancla, r.etiqueta),
    hacer: ir(() => { sembrarFragmento(clienteConsultas, r); void navegar({ to: '/lector/$id', params: { id: r.documento.id }, search: busquedaDeResultado(r) }); }),
  };
}
