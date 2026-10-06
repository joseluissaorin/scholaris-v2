/**
 * Canjear un cupón: un campo hundido en el papel, un botón con relieve y, si
 * vale, el plan se estampa como un sello de tinta (muelle «sello»). Y la
 * etiqueta del plan con su origen: «Pro de por vida (cupón)».
 */
import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorApi, type Concesion, type Plan, type Yo } from '@scholaris/contrato';
import { avisar, Boton, Campo, cx } from '@scholaris/ui';
import { api } from '../../datos/api';
import { fecha } from '../../lib/formato';

const NOMBRE: Record<Plan, string> = { gratis: 'Gratuito', pro: 'Pro' };

/** «Pro de por vida (cupón)», «Pro hasta el 6 de octubre de 2027 (regalo)», «Pro» o «Gratuito». */
export function etiquetaPlan(yo: Pick<Yo, 'plan' | 'concesion'>): string {
  const c = yo.concesion;
  if (!c || c.plan !== yo.plan) return NOMBRE[yo.plan];
  const cuanto = c.caduca ? `hasta el ${fecha(c.caduca)}` : 'de por vida';
  return `${NOMBRE[c.plan]} ${cuanto} (${c.origen === 'cupon' ? 'cupón' : 'regalo'})`;
}

/** Lo que se teclea, con la forma SCHO-XXXX-XXXX a medida que se escribe. */
function formatear(bruto: string): string {
  let s = bruto.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Aún escribiendo el prefijo (o borrándolo): tal cual.
  if ('SCHO'.startsWith(s)) return s;
  if (s.startsWith('SCHO')) s = s.slice(4);
  s = s.slice(0, 8);
  return `SCHO-${s.slice(0, 4)}${s.length > 4 ? `-${s.slice(4)}` : ''}`;
}

export function CanjearCupon() {
  const qc = useQueryClient();
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sello, setSello] = useState<Concesion | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const completo = /^SCHO-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codigo);

  async function canjear(e: FormEvent) {
    e.preventDefault();
    if (!completo || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await api().cupones.canjear(codigo);
      setSello(r.concesion);
      setCodigo('');
      qc.setQueryData<Yo>(['yo'], (yo) => yo && { ...yo, plan: r.plan, concesion: r.concesion });
      void qc.invalidateQueries({ queryKey: ['yo'] });
      avisar(`Cupón canjeado: ya tienes ${etiquetaPlan({ plan: r.plan, concesion: r.concesion }).replace(/ \(cupón\)$/, '')}.`);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se ha podido canjear el cupón. Comprueba la conexión y vuelve a intentarlo.');
      campo.current?.focus();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => void canjear(e)} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <Campo
            ref={campo}
            value={codigo}
            onChange={(e) => { setCodigo(formatear(e.target.value)); setError(null); }}
            placeholder="SCHO-XXXX-XXXX"
            aria-label="Código del cupón"
            aria-invalid={!!error}
            aria-describedby={error ? 'cupon-error' : undefined}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            icono="marcador"
            className={cx('[&_input]:font-mono [&_input]:tracking-[0.12em]', error && '[&_input]:border-rojo/70')}
          />
        </div>
        <Boton type="submit" variante="tinta" className="tactil" disabled={!completo} cargando={enviando}>Canjear</Boton>
      </form>
      {error ? <p id="cupon-error" role="alert" className="anim-sube text-[0.8125rem] text-rojo">{error}</p> : null}
      {sello ? (
        <div role="status" className="flex items-center gap-4 rounded-xl bg-cream-100/70 px-4 py-3 shadow-[var(--hundido)]">
          {/* El sello: tinta roja, doble filete, un pelo torcido; se estampa con el muelle «sello». */}
          <span key={sello.id} aria-hidden
            className="anim-sello grid shrink-0 -rotate-6 place-items-center rounded-lg border-2 border-double border-rojo px-3 py-1.5 text-center font-mono text-[0.6875rem] font-bold uppercase leading-tight tracking-[0.18em] text-rojo [mix-blend-mode:multiply] dark:[mix-blend-mode:normal]">
            <span className="text-[0.9375rem] tracking-[0.24em]">{NOMBRE[sello.plan]}</span>
            <span>{sello.caduca ? `hasta ${new Date(sello.caduca).toLocaleDateString('es-ES')}` : 'de por vida'}</span>
          </span>
          <p className="text-[0.875rem] text-coffee-700">
            {sello.caduca ? `Tienes ${NOMBRE[sello.plan]} hasta el ${fecha(sello.caduca)}.` : `Tienes ${NOMBRE[sello.plan]} de por vida.`} Gracias por estar aquí.
          </p>
        </div>
      ) : (
        <p className="text-[0.8125rem] text-coffee-500">Cada cupón vale una sola vez. Si ya tienes un plan igual o mejor, no se gasta: guárdalo para otra persona.</p>
      )}
    </div>
  );
}
