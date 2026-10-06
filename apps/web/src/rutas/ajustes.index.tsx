import { lazy, Suspense, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { Cuota } from '@scholaris/contrato';
import { avisar, Boton, Campo, Dialogo, Esqueleto, Filete, Rotulo, Tarjeta } from '@scholaris/ui';
import { api, esSimulado } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { useSesion } from '../sesion';
import { bytes } from '../lib/formato';
import { numero } from '../lib/numero';

const Precios = lazy(() => import('../componentes/cuenta/precios'));

export const Route = createFileRoute('/ajustes/')({
  loader: ({ context }) => context.consultas.ensureQueryData(q.yo()),
  component: Cuenta,
});

function Medidor({ nombre, cuota, formato = (n: number) => numero(n) }: { nombre: string; cuota: Cuota; formato?: (n: number) => string }) {
  const pct = cuota.limite ? Math.min(1, cuota.usados / cuota.limite) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2"><span className="text-[0.9375rem]">{nombre}</span><span className="tnum font-mono text-[0.8125rem] text-tinta-2">{formato(cuota.usados)}{cuota.limite ? ` de ${formato(cuota.limite)}` : ' · sin límite'}</span></div>
      <div className="mt-2 h-[3px] bg-hondo"><div className={pct > 0.9 ? 'h-full bg-rojo' : 'h-full bg-tinta'} style={{ width: `${cuota.limite ? pct * 100 : 100}%`, opacity: cuota.limite ? 1 : 0.15 }} /></div>
    </div>
  );
}

function Cuenta() {
  const sesion = useSesion();
  const { data: yo, isPending } = useQuery(q.yo());
  const [borrar, setBorrar] = useState(false);
  const [confirmacion, setConfirmacion] = useState('');

  async function borrarCuenta() {
    try { await api().auth.borrarCuenta(); avisar('Cuenta borrada.'); sesion.salir?.(); }
    catch { avisar('No se pudo borrar la cuenta.', { tono: 'error' }); }
  }

  if (isPending || !yo) return <Lienzo ancho="estrecho"><Esqueleto className="h-40" /></Lienzo>;
  return (
    <Lienzo ancho="estrecho">
      <section className="flex flex-wrap items-center gap-5">
        {yo.usuario.imagen ? <img src={yo.usuario.imagen} alt="" className="h-16 w-16 rounded-full" /> : <span className="grid h-16 w-16 place-items-center rounded-full bg-tinta text-[1.75rem] italic text-sobre-tinta">{yo.usuario.nombre.charAt(0)}</span>}
        <div className="min-w-0 flex-1">
          <h2 className="text-[1.75rem] leading-tight">{yo.usuario.nombre}</h2>
          <p className="text-tinta-2">{yo.usuario.correo}</p>
        </div>
        {sesion.abrirPerfil ? <Boton variante="linea" onClick={sesion.abrirPerfil}>Correo y contraseña</Boton> : null}
      </section>

      {yo.via === 'local' ? (
        <Tarjeta className="mt-8 p-5">
          <Rotulo>{esSimulado() ? 'Demostración' : 'Versión local'}</Rotulo>
          <p className="mt-2">{esSimulado() ? 'Estás viendo Scholaris con una biblioteca de ejemplo. Nada de lo que hagas sale de este navegador.' : 'Un solo usuario, sin cuenta y sin límites de plan. Tus datos viven en este ordenador.'}</p>
        </Tarjeta>
      ) : null}

      <Filete className="mt-10">Plan {yo.plan === 'pro' ? 'Pro' : 'gratuito'}</Filete>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Medidor nombre="Páginas leídas este mes" cuota={yo.cuotas.paginasMes} />
        <Medidor nombre="Documentos" cuota={yo.cuotas.documentos} />
        <Medidor nombre="Autocitas este mes" cuota={yo.cuotas.autocitasMes} />
        <Medidor nombre="Almacenamiento" cuota={yo.cuotas.bytes} formato={bytes} />
      </div>

      {sesion.modo === 'clerk' ? (
        <section className="mt-12">
          <Filete>Planes</Filete>
          <div className="mt-6"><Suspense fallback={<Esqueleto className="h-72" />}><Precios /></Suspense></div>
        </section>
      ) : null}

      {sesion.modo === 'clerk' ? (
        <section className="mt-16 rounded-m border border-rojo/60 p-5">
          <h3 className="text-[1.125rem]">Borrar la cuenta</h3>
          <p className="mt-1 text-[0.9375rem] text-tinta-2">Se borran tus documentos, tus búsquedas, tus cuadernos y tus claves. No se puede deshacer.</p>
          <Boton className="mt-4" variante="linea" onClick={() => setBorrar(true)}>Borrar mi cuenta…</Boton>
        </section>
      ) : null}

      <Dialogo abierto={borrar} alCambiar={setBorrar} titulo="¿Borrar la cuenta entera?" descripcion="Esto no se puede deshacer. Escribe BORRAR para confirmarlo."
        pie={<><Boton variante="fantasma" onClick={() => setBorrar(false)}>Cancelar</Boton><Boton variante="rojo" disabled={confirmacion !== 'BORRAR'} onClick={() => void borrarCuenta()}>Borrar para siempre</Boton></>}>
        <Campo autoFocus value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} aria-label="Escribe BORRAR" />
      </Dialogo>
    </Lienzo>
  );
}
