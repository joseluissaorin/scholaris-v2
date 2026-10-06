/**
 * El alta: justo después de registrarse (o al volver de un enlace «?cupon=»),
 * elegir cómo se empieza. «¿Tienes un cupón?» aplica el plan al instante, el
 * sello se estampa y se va a la biblioteca sin pasar por el pago; si no, la
 * tabla de planes de Clerk o seguir con el gratuito.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { Concesion } from '@scholaris/contrato';
import { Boton, Dialogo, Esqueleto } from '@scholaris/ui';
import { CanjearCupon, SelloPlan } from './cupon';
import { olvidarCuponPendiente } from '../../lib/cupon-pendiente';
import { fecha } from '../../lib/formato';
import { claveAltaVista } from './alta-clave';

const Precios = lazy(() => import('./precios'));


export default function Alta({ usuario, cupon, nueva }: { usuario: string; cupon: string | null; nueva: boolean }) {
  const [abierto, setAbierto] = useState(true);
  const [canjeado, setCanjeado] = useState<Concesion | null>(null);
  const navegar = useNavigate();

  function terminar() {
    try { localStorage.setItem(claveAltaVista(usuario), new Date().toISOString()); } catch { /* nada */ }
    olvidarCuponPendiente();
    setAbierto(false);
  }

  // Con el plan ya en la cuenta: el sello se ve un momento y se va a la biblioteca.
  useEffect(() => {
    if (!canjeado) return;
    const t = setTimeout(() => { terminar(); void navegar({ to: '/' }); }, 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canjeado]);

  const cuanto = canjeado ? (canjeado.caduca ? `hasta el ${fecha(canjeado.caduca)}` : 'de por vida') : '';
  return (
    <Dialogo abierto={abierto} alCambiar={(v) => { if (!v) terminar(); }} ancho="g" className="max-h-[84vh] overflow-y-auto"
      titulo={canjeado ? 'Ya está' : cupon ? 'Tu cupón' : 'Te damos la bienvenida a Scholaris'}
      descripcion={canjeado ? undefined : cupon ? 'Lo estamos canjeando en tu cuenta.' : 'Elige cómo empiezas. Puedes cambiar de plan cuando quieras desde Ajustes.'}
      pie={canjeado
        ? <Boton variante="tinta" className="tactil" onClick={() => { terminar(); void navegar({ to: '/' }); }}>Ir a mi biblioteca</Boton>
        : <Boton variante="linea" className="tactil" onClick={terminar}>Empezar con el plan gratuito</Boton>}>
      {canjeado ? (
        <div role="status" className="flex flex-col items-center gap-5 py-6 text-center">
          <SelloPlan concesion={canjeado} grande />
          <p className="max-w-sm text-[0.9375rem] text-coffee-700">Tienes Pro {cuanto}, sin pagar nada. Te llevamos a tu biblioteca.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-xl border border-cream-400 bg-cream-100/60 p-4 shadow-[var(--hundido)]">
            <h3 className="mb-3 text-[0.9375rem] font-semibold text-coffee-800">¿Tienes un cupón?</h3>
            <CanjearCupon inicial={cupon ?? ''} auto={!!cupon} sinSello alCanjear={setCanjeado} />
          </section>
          {nueva || !cupon ? (
            <section>
              <h3 className="mb-3 text-[0.9375rem] font-semibold text-coffee-800">Planes</h3>
              <Suspense fallback={<Esqueleto className="h-72" />}><Precios /></Suspense>
            </section>
          ) : null}
        </div>
      )}
    </Dialogo>
  );
}
