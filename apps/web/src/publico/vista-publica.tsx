/**
 * La vista de solo lectura de un enlace (`/p/<token>`), sin cuenta: la
 * colección (o el documento) con buscar dentro y el lector con anclas
 * (`?doc=…&u=145`, `&t=754`). Si el enlace tiene contraseña, primero la pide.
 * «Añadir a mi Scholaris» lleva a entrar y a seguirla o copiarla.
 *
 * Vive fuera del marco (sin barra lateral ni Clerk): solo se carga aquí.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { crearCliente, DERECHOS } from '@scholaris/contrato';
import { Boton, Campo, Composicion, Esqueleto, Icono, Tostadora, Vacio } from '@scholaris/ui';
import { Logo } from '../componentes/marco/logo';
import { LecturaCompartida, type Posicion } from '../componentes/biblioteca/lectura-compartida';
import { numero } from '../lib/numero';
import { motivoEnlace } from '../componentes/comunes/errores';

const token = decodeURIComponent(location.pathname.split('/')[2] ?? '');
const base = (import.meta.env.VITE_API as string | undefined) ?? '';
const clavePase = `scholaris.pase.${token}`;

function leerPosicion(): Posicion {
  const q = new URLSearchParams(location.search);
  const n = (k: string) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined);
  return { ...(q.get('doc') ? { doc: q.get('doc')! } : {}), ...(n('u') != null ? { u: n('u') } : {}), ...(n('t') != null ? { t: n('t') } : {}) };
}

export default function VistaPublica() {
  const [pase, setPase] = useState<string | undefined>(() => { try { return sessionStorage.getItem(clavePase) ?? undefined; } catch { return undefined; } });
  const [pos, setPos] = useState<Posicion>(leerPosicion);
  const anonimo = useMemo(() => crearCliente({ base }), []);
  const cliente = useMemo(() => anonimo.publico(token, pase), [anonimo, pase]);
  const { data: v, error, isPending } = useQuery({ queryKey: ['publico', token], queryFn: () => anonimo.enlacePublico.vista(token), retry: false });

  useEffect(() => {
    const alVolver = () => setPos(leerPosicion());
    window.addEventListener('popstate', alVolver);
    return () => window.removeEventListener('popstate', alVolver);
  }, []);
  useEffect(() => { if (v) document.title = `${v.titulo} · Scholaris`; }, [v]);

  function mover(p: Posicion) {
    const q = new URLSearchParams();
    if (p.doc) q.set('doc', p.doc);
    if (p.u != null) q.set('u', String(p.u));
    if (p.t != null) q.set('t', String(p.t));
    history.pushState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
    setPos(p);
    if (!p.u && !p.t) window.scrollTo({ top: 0 });
  }

  return (
    <div className="fondo-bauhaus min-h-dvh">
      <header className="border-b border-barra-2 bg-barra">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-10">
          <a href="/" className="flex items-center gap-2.5"><Logo tam={28} sobreOscuro /><span className="text-[1.0625rem] font-semibold tracking-wide text-sobre-barra">Scholaris</span></a>
          <span className="ml-1 hidden rounded-full border border-white/15 px-2.5 py-0.5 text-[0.6875rem] uppercase tracking-wider text-sobre-barra-2 sm:inline">Solo lectura</span>
          <div className="ml-auto">
            {v && !error ? (
              <button type="button" onClick={() => { location.href = `/recibir/${encodeURIComponent(token)}`; }}
                className="flex h-9 items-center gap-2 rounded-xl border border-[#9a3128] bg-[linear-gradient(180deg,#cc5246_0%,#b83e33_100%)] px-3.5 text-[0.8125rem] font-semibold text-[#fdf8f1] shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_2px_6px_rgb(0_0_0/0.35)] transition-transform hover:-translate-y-px">
                <Icono nombre="mas" tam={15} grosor={2.2} />Añadir a mi Scholaris
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6 lg:px-10">
        {isPending ? <><Esqueleto className="h-9 w-1/2" /><Esqueleto className="mt-6 h-64 rounded-2xl" /></> : error || !v ? (
          <Vacio estilo="malevich" titulo="Este enlace ya no funciona." className="mx-auto mt-10 max-w-2xl">
            {motivoEnlace(error)}
          </Vacio>
        ) : v.conClave && !pase ? (
          <Contrasena alEntrar={(p) => { try { sessionStorage.setItem(clavePase, p); } catch { /* sin almacenamiento */ } setPase(p); }} />
        ) : (
          <>
            <div className="mb-7 flex items-start gap-6">
              <div className="min-w-0 flex-1">
                <p className="text-[0.8125rem] text-coffee-500">{v.de} comparte contigo {v.tipo === 'biblioteca' ? `una colección de ${numero(v.documentos)} documentos` : 'un documento'}</p>
                <h1 className="mt-1 text-[1.625rem] font-bold tracking-[-0.01em] text-coffee-800 sm:text-[1.875rem]">{v.titulo}</h1>
                {v.descripcion ? <p className="mt-2 max-w-3xl text-[0.9375rem] text-coffee-600">{v.descripcion}</p> : null}
                <p className="mt-2 text-[0.75rem] text-coffee-400">
                  {DERECHOS[v.derechos].nombre}{DERECHOS[v.derechos].abierto ? '' : ' · para uso privado de quien recibe el enlace'}{v.caduca ? ` · disponible hasta el ${new Date(v.caduca).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
                </p>
              </div>
              <Composicion estilo="kandinsky" semilla={3} className="hidden h-[76px] w-[114px] shrink-0 sm:block" />
            </div>
            <LecturaCompartida cliente={cliente} clave={`p:${token}`} posicion={pos} alMover={mover} />
          </>
        )}
      </main>
      <Tostadora />
    </div>
  );
}

function Contrasena({ alEntrar }: { alEntrar: (pase: string) => void }) {
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);
  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEntrando(true); setError('');
    try { alEntrar((await crearCliente({ base }).enlacePublico.acceso(token, clave)).pase); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo entrar.'); }
    finally { setEntrando(false); }
  }
  return (
    <form onSubmit={(e) => void entrar(e)} className="mx-auto mt-12 max-w-md rounded-2xl border border-cream-300 bg-cream-50 p-6 shadow-[var(--levantado)]">
      <Icono nombre="llave" tam={22} className="text-coffee-400" />
      <h1 className="mt-3 text-[1.25rem] font-semibold text-coffee-800">Este enlace tiene contraseña</h1>
      <p className="mt-1 text-[0.875rem] text-coffee-600">Pídesela a quien te lo mandó.</p>
      <Campo autoFocus type="password" value={clave} onChange={(e) => setClave(e.target.value)} aria-label="Contraseña" className="mt-4" />
      {error ? <p className="mt-2 text-[0.8125rem] text-rojo">{error}</p> : null}
      <Boton type="submit" variante="tinta" className="mt-4 w-full" cargando={entrando} disabled={!clave}>Entrar</Boton>
    </form>
  );
}
