import { PricingTable } from '@clerk/react';
import { CanjearCupon } from './cupon';

/** La tabla de planes de Clerk Billing y, debajo, «¿Tienes un cupón?». Solo se carga en la nube. */
export default function Precios({ conCupon = false }: { conCupon?: boolean }) {
  return (
    <div className="space-y-5">
      <PricingTable />
      {conCupon ? (
        <section className="rounded-xl border border-cream-400 bg-cream-100/60 p-4 shadow-[var(--hundido)]">
          <h3 className="mb-3 text-[0.9375rem] font-semibold text-coffee-800">¿Tienes un cupón?</h3>
          <CanjearCupon />
        </section>
      ) : null}
    </div>
  );
}
