/**
 * Canjear un cupón: un campo hundido en el papel, un botón con relieve y, si
 * vale, el plan se estampa como un sello de tinta (muelle «sello»). Y la
 * etiqueta del plan con su origen: «Pro de por vida (cupón)».
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
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

/** El sello: tinta roja, doble filete, un pelo torcido; se estampa con el muelle «sello». */
export function SelloPlan({ concesion, grande }: { concesion: Pick<Concesion, 'id' | 'plan' | 'caduca'>; grande?: boolean }) {
  return (
    <span key={concesion.id} aria-hidden
      className={cx('anim-sello grid shrink-0 -rotate-6 place-items-center rounded-lg border-2 border-double border-rojo text-center font-mono font-bold uppercase leading-tight text-rojo [mix-blend-mode:multiply] dark:[mix-blend-mode:normal]',
        grande ? 'px-5 py-3 text-[0.8125rem] tracking-[0.2em]' : 'px-3 py-1.5 text-[0.6875rem] tracking-[0.18em]')}>
      <span className={cx(grande ? 'text-[1.5rem] tracking-[0.28em]' : 'text-[0.9375rem] tracking-[0.24em]')}>{NOMBRE[concesion.plan]}</span>
      <span>{concesion.caduca ? `hasta ${new Date(concesion.caduca).toLocaleDateString('es-ES')}` : 'de por vida'}</span>
    </span>
  );
}

export interface PropsCanjear {
  /** Código con el que empieza el campo (un enlace «?cupon=»). */
  inicial?: string;
  /** Canjear nada más montarse (el cupón pendiente al volver con sesión). */
  auto?: boolean;
  /** Tras canjear (el alta lleva a la biblioteca). */
  alCanjear?: (c: Concesion) => void;
  /** Sin el sello propio (quien lo usa pinta el suyo). */
  sinSello?: boolean;
}

export function CanjearCupon({ inicial = '', auto = false, alCanjear, sinSello = false }: PropsCanjear = {}) {
  const qc = useQueryClient();
  const [codigo, setCodigo] = useState(() => formatear(inicial));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sello, setSello] = useState<Concesion | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const completo = /^SCHO-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codigo);

  const lanzado = useRef(false);
  useEffect(() => {
    if (auto && completo && !lanzado.current) { lanzado.current = true; void canjear(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function canjear(e?: FormEvent) {
    e?.preventDefault();
    if (!completo || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await api().cupones.canjear(codigo);
      setSello(r.concesion);
      setCodigo('');
      // Lo que dice el canje es la verdad: sin volver a pedir /auth/yo (otra réplica podría tardar unos segundos en verlo).
      qc.setQueryData<Yo>(['yo'], (yo) => yo && { ...yo, plan: r.plan, concesion: r.concesion });
      alCanjear?.(r.concesion);
      if (!sinSello) avisar(`Cupón canjeado: ya tienes ${etiquetaPlan({ plan: r.plan, concesion: r.concesion }).replace(/ \(cupón\)$/, '')}.`);
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
      {sello && !sinSello ? (
        <div role="status" className="flex items-center gap-4 rounded-xl bg-cream-100/70 px-4 py-3 shadow-[var(--hundido)]">
          <SelloPlan concesion={sello} />
          <p className="text-[0.875rem] text-coffee-700">
            {sello.caduca ? `Tienes ${NOMBRE[sello.plan]} hasta el ${fecha(sello.caduca)}.` : `Tienes ${NOMBRE[sello.plan]} de por vida.`} Gracias por estar aquí.
          </p>
        </div>
      ) : sello ? null : (
        <p className="text-[0.8125rem] text-coffee-500">Cada cupón vale una sola vez. Si ya tienes un plan igual o mejor, no se gasta: guárdalo para otra persona.</p>
      )}
    </div>
  );
}
