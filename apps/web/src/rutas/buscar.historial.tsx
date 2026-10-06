import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventoBusqueda, Pagina } from '@scholaris/contrato';
import { avisar, Boton, Campo, Chip, conDeshacer, cx, Esqueleto, Icono, Rotulo, Vacio } from '@scholaris/ui';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { haceCuanto } from '../lib/formato';

export const Route = createFileRoute('/buscar/historial')({
  loader: ({ context }) => context.consultas.ensureQueryData(q.historial()),
  component: Historial,
});

const TIPO: Record<EventoBusqueda['tipo'], string> = { busqueda: 'Búsqueda', respuesta: 'Pregunta', multilingue: 'Multilingüe', verificacion: 'Verificación', similares: 'Parecidos' };

function grupoFecha(iso: string) {
  const d = new Date(iso), hoy = new Date();
  const dias = Math.floor((new Date(hoy.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  return dias === 0 ? 'Hoy' : dias === 1 ? 'Ayer' : dias < 7 ? 'Esta semana' : dias < 31 ? 'Este mes' : 'Antes';
}

function Historial() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery(q.historial());
  const { data: grabacion } = useQuery(q.grabacion());
  const [texto, setTexto] = useState('');
  const [fijados, setFijados] = useState(false);
  const lista = useMemo(() => (data?.elementos ?? []).filter((e) => (!fijados || e.fijado) && e.consulta.toLowerCase().includes(texto.toLowerCase())), [data, texto, fijados]);
  const grupos = useMemo(() => { const m = new Map<string, EventoBusqueda[]>(); for (const e of lista) { const g = e.fijado && !fijados ? 'Fijadas' : grupoFecha(e.cuando); if (!m.has(g)) m.set(g, []); m.get(g)!.push(e); } return [...m.entries()].sort(([a]) => (a === 'Fijadas' ? -1 : 0)); }, [lista, fijados]);

  const parchear = (fn: (l: EventoBusqueda[]) => EventoBusqueda[]) => qc.setQueryData<Pagina<EventoBusqueda>>(['historial'], (p) => p && { ...p, elementos: fn(p.elementos) });

  async function fijar(e: EventoBusqueda) {
    parchear((l) => l.map((x) => (x.id === e.id ? { ...x, fijado: !x.fijado } : x)));
    try { await api().historial.fijar(e.id, !e.fijado); } catch { avisar('No se pudo fijar.', { tono: 'error' }); }
  }
  function borrar(e: EventoBusqueda) {
    const previo = qc.getQueryData(['historial']);
    parchear((l) => l.filter((x) => x.id !== e.id));
    conDeshacer('Búsqueda borrada del historial.', () => qc.setQueryData(['historial'], previo), () => void api().historial.borrar(e.id));
  }

  return (
    <Lienzo ancho="estrecho">
      {grabacion && !grabacion.activa ? (
        <p className="mb-6 flex items-center gap-2 rounded-s border border-filete-fuerte bg-hoja px-3 py-2 text-[0.875rem]"><Icono nombre="ojo" tam={15} />El historial está en pausa. <Link to="/ajustes/privacidad" className="underline underline-offset-4">Cambiarlo</Link></p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Campo icono="filtro" placeholder="Filtrar el historial" value={texto} onChange={(e) => setTexto(e.target.value)} className="w-full max-w-xs" aria-label="Filtrar el historial" />
        <Chip icono="fijar" activo={fijados} onClick={() => setFijados(!fijados)}>Solo fijadas</Chip>
      </div>
      {isPending ? <div className="mt-8 flex flex-col gap-2">{Array.from({ length: 6 }, (_, i) => <Esqueleto key={i} className="h-14" />)}</div>
        : !lista.length ? <Vacio className="mt-8" forma="cuadrado" titulo={texto || fijados ? 'Nada coincide.' : 'Aún no has buscado nada.'}>{texto || fijados ? 'Prueba con otro filtro.' : 'Lo que busques y preguntes aparecerá aquí para repetirlo, fijarlo o borrarlo.'}</Vacio>
        : grupos.map(([g, es]) => (
          <section key={g} className="mt-8">
            <Rotulo>{g}</Rotulo>
            <ul className="mt-2 border-t border-cream-400">
              {es.map((e) => (
                <li key={e.id} className="group flex items-center gap-3 border-b border-filete py-3">
                  <Icono nombre={e.tipo === 'respuesta' ? 'chispa' : 'buscar'} tam={16} className="shrink-0 text-apagado" />
                  <Link to="/buscar" search={{ q: e.consulta, ...(e.tipo === 'respuesta' ? { modo: 'preguntar' as const } : {}) }} className="min-w-0 flex-1">
                    <p className="truncate text-[1rem] group-hover:underline group-hover:underline-offset-4">{e.consulta}</p>
                    <Rotulo>{TIPO[e.tipo]} · {e.resultados} resultados{e.confianza ? ` · confianza ${e.confianza}` : ''} · {haceCuanto(e.cuando)}</Rotulo>
                  </Link>
                  <button type="button" onClick={() => void fijar(e)} aria-pressed={e.fijado} aria-label={e.fijado ? 'Desfijar' : 'Fijar'} className={cx('grid h-9 w-9 place-items-center rounded-s hover:bg-hondo', e.fijado ? 'text-rojo' : 'text-apagado md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100')}><Icono nombre="fijar" tam={15} /></button>
                  <button type="button" onClick={() => borrar(e)} aria-label="Borrar del historial" className="grid h-9 w-9 place-items-center rounded-s text-apagado hover:bg-hondo hover:text-rojo md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"><Icono nombre="papelera" tam={15} /></button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {lista.length ? <div className="mt-10"><Boton variante="fantasma" tam="p" comoHijo><Link to="/ajustes/privacidad">Privacidad del historial</Link></Boton></div> : null}
    </Lienzo>
  );
}
