/**
 * La bandeja de invitaciones: lo que otros comparten contigo, con Aceptar
 * (empiezas a seguir la colección) o Rechazar; debajo, las colecciones que ya
 * sigues y los avisos. El enlace de un correo de invitación llega aquí con
 * `?token=`.
 */
import { useEffect } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DERECHOS, type InvitacionRecibida } from '@scholaris/contrato';
import { avisar, Boton, Esqueleto, Rotulo, Tarjeta, Vacio } from '@scholaris/ui';
import { api } from '../datos/api';
import { Cabecera } from '../componentes/comunes/cabecera';
import { Boceto } from '../bocetos/boceto';
import { fecha, haceCuanto } from '../lib/formato';

export const Route = createFileRoute('/invitaciones')({
  validateSearch: (s: Record<string, unknown>): { token?: string } => (typeof s.token === 'string' && s.token ? { token: s.token } : {}),
  component: PaginaInvitaciones,
});

const PAPEL = { lectura: 'para leer', edicion: 'para leer y editar', administrador: 'para administrar' } as const;

function PaginaInvitaciones() {
  const { token } = Route.useSearch();
  const qc = useQueryClient();
  const navegar = useNavigate();
  const { data: pendientes, isPending } = useQuery({ queryKey: ['invitaciones'], queryFn: () => api().invitaciones.listar() });
  const { data: porToken } = useQuery({ queryKey: ['invitacion', token], queryFn: () => api().invitaciones.porToken(token!), enabled: !!token, retry: false });
  const { data: seguidas = [] } = useQuery({ queryKey: ['seguidas'], queryFn: () => api().seguidas.listar() });
  const { data: avisos = [] } = useQuery({ queryKey: ['notificaciones'], queryFn: () => api().notificaciones.listar() });

  // Al abrir la bandeja, los avisos quedan vistos (el distintivo de la barra se apaga).
  useEffect(() => {
    if (avisos.some((a) => !a.leida)) void api().notificaciones.leidas().then(() => qc.invalidateQueries({ queryKey: ['notificaciones'] }));
  }, [avisos]); // eslint-disable-line react-hooks/exhaustive-deps

  const lista: InvitacionRecibida[] = [...(porToken && porToken.estado === 'pendiente' && !pendientes?.some((p) => p.id === porToken.id) ? [porToken] : []), ...(pendientes ?? [])];

  async function responder(inv: InvitacionRecibida, aceptar: boolean) {
    try {
      const clave = porToken?.id === inv.id && token ? token : inv.id;
      if (aceptar) {
        await api().invitaciones.aceptar(clave);
        avisar(`Sigues «${inv.nombre}». La verás cambiar a la vez que ${inv.de.nombre || 'quien la comparte'}.`, { tono: 'exito' });
      } else {
        await api().invitaciones.rechazar(clave);
        avisar('Invitación rechazada.');
      }
      for (const k of ['invitaciones', 'seguidas', 'bibliotecas', 'notificaciones']) void qc.invalidateQueries({ queryKey: [k] });
      if (token) void navegar({ to: '/invitaciones', search: {}, replace: true });
      if (aceptar) void navegar({ to: '/compartida/$id', params: { id: inv.biblioteca } });
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo responder.', { tono: 'error' }); }
  }

  return (
    <>
      <Cabecera forma="circulo" titulo="Invitaciones" antetitulo="Lo que otros comparten contigo: síguelo o cópialo a tu Scholaris" />
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-5 sm:px-6 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <section aria-label="Invitaciones pendientes">
            <h2 className="rotulo mb-3 text-[0.75rem] text-coffee-700">Pendientes</h2>
            {isPending ? <Esqueleto className="h-32 rounded-2xl" /> : !lista.length ? (
              <Vacio estilo="kandinsky" titulo="No tienes invitaciones pendientes." dibujo={<Boceto nombre="sobre" decorativo className="w-56" />}>
                Cuando alguien comparta una colección contigo, aparecerá aquí para que la aceptes.
              </Vacio>
            ) : (
              <ul className="cascada space-y-4">
                {lista.map((inv, i) => (
                  <li key={inv.id} style={{ '--i': i } as React.CSSProperties}>
                    <Tarjeta className="grid gap-4 p-5 sm:grid-cols-[7rem_minmax(0,1fr)]">
                      <Boceto nombre="sobre" decorativo className="hidden w-28 sm:block" />
                      <div className="min-w-0">
                        <p className="text-[0.8125rem] text-coffee-500">{inv.de.nombre || inv.de.correo || 'Alguien'} te invita {PAPEL[inv.permiso]} · {haceCuanto(inv.creada)}</p>
                        <h3 className="mt-1 text-[1.25rem] font-semibold text-coffee-800">{inv.nombre}</h3>
                        {inv.descripcion ? <p className="mt-1 text-[0.875rem] text-coffee-600">{inv.descripcion}</p> : null}
                        {inv.mensaje ? <blockquote className="mt-3 border-l-2 border-rojo pl-3 font-[Georgia] text-[0.9375rem] italic text-coffee-700">{inv.mensaje}</blockquote> : null}
                        <p className="mt-3 text-[0.75rem] text-coffee-400">
                          Derechos: {DERECHOS[inv.derechos ?? 'sin_indicar'].nombre.toLowerCase()}{inv.caduca ? ` · el acceso caduca el ${fecha(inv.caduca)}` : ''}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Boton variante="tinta" icono="hecho" onClick={() => void responder(inv, true)}>Aceptar y seguir</Boton>
                          <Boton variante="fantasma" onClick={() => void responder(inv, false)}>Rechazar</Boton>
                        </div>
                      </div>
                    </Tarjeta>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className="space-y-6">
            <div>
              <h2 className="rotulo mb-2.5 text-[0.75rem] text-coffee-700">Colecciones que sigues</h2>
              {!seguidas.length ? <p className="px-1 text-[0.8125rem] text-coffee-400">Todavía ninguna.</p> : (
                <ul className="space-y-0.5">
                  {seguidas.map((s) => (
                    <li key={s.biblioteca}>
                      <Link to="/compartida/$id" params={{ id: s.biblioteca }} className="block rounded-lg px-3 py-2 hover:bg-cream-200">
                        <span className="block truncate text-[0.8125rem] font-medium text-coffee-800">{s.nombre}</span>
                        <span className="block truncate text-[0.75rem] text-coffee-400">{s.propietario.nombre || 'Compartida'}{s.porEnlace ? ' · por enlace' : ''} · {s.permiso === 'lectura' ? 'lectura' : s.permiso === 'edicion' ? 'edición' : 'administración'}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h2 className="rotulo mb-2.5 text-[0.75rem] text-coffee-700">Avisos</h2>
              {!avisos.length ? <p className="px-1 text-[0.8125rem] text-coffee-400">Sin avisos.</p> : (
                <ul className="space-y-2">
                  {avisos.slice(0, 20).map((a) => (
                    <li key={a.id} className="rounded-lg bg-cream-100 px-3 py-2 text-[0.8125rem] text-coffee-700">
                      {a.destino ? <a href={a.destino} className="hover:underline">{a.texto}</a> : a.texto}
                      <Rotulo className="mt-0.5 block">{haceCuanto(a.creada)}</Rotulo>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
