import { lazy, Suspense, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { Cuota } from '@scholaris/contrato';
import { avisar, Boton, Campo, cx, Dialogo, Esqueleto } from '@scholaris/ui';
import { modoIngesta, ponerModoIngesta, type ModoIngesta } from '../datos/ingesta';
import { api, esSimulado } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo, Seccion } from '../componentes/comunes/cabecera';
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
      <div className="flex items-baseline justify-between gap-2"><span className="text-[0.8125rem] font-medium text-coffee-700">{nombre}</span><span className="dato text-coffee-500">{formato(cuota.usados)}{cuota.limite ? ` de ${formato(cuota.limite)}` : ' · sin límite'}</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream-200 shadow-[var(--hundido)]"><div className={pct > 0.9 ? 'h-full rounded-full bg-rojo' : 'h-full rounded-full bg-coffee-700'} style={{ width: `${cuota.limite ? pct * 100 : 100}%`, opacity: cuota.limite ? 1 : 0.15 }} /></div>
    </div>
  );
}

function ModoIngestaAjuste() {
  const [modo, setModo] = useState<ModoIngesta>(modoIngesta);
  const opciones: Array<[ModoIngesta, string, string]> = [
    ['rapido', 'Rápido', 'Lo nuevo se puede leer en segundos y buscar en unos minutos.'],
    ['economico', 'Económico', 'Se procesa por lotes: listo en unas horas, a mitad de precio. Bien para bibliotecas enteras.'],
  ];
  return (
    <div role="radiogroup" aria-label="Modo de lectura" className="grid gap-3 sm:grid-cols-2">
      {opciones.map(([m, n, d]) => (
        <button key={m} type="button" role="radio" aria-checked={modo === m} onClick={() => { ponerModoIngesta(m); setModo(m); }}
          className={cx('rounded-xl border p-4 text-left transition-[box-shadow,transform]', modo === m ? 'border-coffee-500 bg-cream-50 shadow-[var(--relieve-alto)]' : 'border-cream-400 bg-cream-100 shadow-[var(--hundido)] hover:bg-cream-50')}>
          <span className="flex items-center gap-2 text-[0.9375rem] font-semibold">{modo === m ? <span className="h-2.5 w-2.5 rounded-full bg-rojo" /> : <span className="h-2.5 w-2.5 rounded-full border border-cream-500" />}{n}</span>
          <span className="mt-1 block text-[0.8125rem] text-coffee-500">{d}</span>
        </button>
      ))}
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
    <Lienzo ancho="estrecho" className="space-y-5">
      <Seccion icono="ajustes" titulo={yo.usuario.nombre} descripcion={yo.usuario.correo}
        accion={sesion.abrirPerfil ? <Boton variante="linea" tam="p" onClick={sesion.abrirPerfil}>Correo y contraseña</Boton> : undefined}>
        {yo.via === 'local' ? (
          <p className="rounded-xl bg-cream-200/60 px-4 py-3 text-[0.8125rem] text-coffee-600 shadow-[var(--hundido)]">{esSimulado() ? 'Estás viendo Scholaris con una biblioteca de ejemplo. Nada de lo que hagas sale de este navegador.' : 'Versión local: un solo usuario, sin cuenta y sin límites de plan. Tus datos viven en este ordenador.'}</p>
        ) : null}
      </Seccion>

      <Seccion icono="rayo" titulo="Facturación y uso" descripcion={`Plan actual: ${yo.plan === 'pro' ? 'Pro' : 'Gratuito'}`}
        accion={<span className={cx('rounded-lg px-2 py-0.5 text-[0.6875rem] font-semibold shadow-[var(--relieve)]', yo.plan === 'pro' ? 'bg-amarillo text-coffee-800' : 'bg-cream-200 text-coffee-700')}>{yo.plan === 'pro' ? 'Pro' : 'Gratuito'}</span>}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Medidor nombre="Páginas leídas este mes" cuota={yo.cuotas.paginasMes} />
          <Medidor nombre="Documentos" cuota={yo.cuotas.documentos} />
          <Medidor nombre="Autocitas este mes" cuota={yo.cuotas.autocitasMes} />
          <Medidor nombre="Almacenamiento" cuota={yo.cuotas.bytes} formato={bytes} />
        </div>
      </Seccion>

      <Seccion icono="documento" titulo="Lectura de documentos" descripcion="Cómo se leen los archivos que añades. Se puede cambiar también al añadirlos.">
        <ModoIngestaAjuste />
      </Seccion>

      {sesion.modo === 'clerk' ? (
        <Seccion icono="marcador" titulo="Planes">
          <Suspense fallback={<Esqueleto className="h-72" />}><Precios /></Suspense>
        </Seccion>
      ) : null}

      {sesion.modo === 'clerk' ? (
        <Seccion icono="aviso" titulo="Borrar la cuenta" descripcion="Se borran tus documentos, tus búsquedas, tus cuadernos y tus claves. No se puede deshacer." className="border-rojo/40"
          accion={<Boton variante="linea" tam="p" className="!text-rojo" onClick={() => setBorrar(true)}>Borrar mi cuenta…</Boton>} />
      ) : null}

      <Dialogo abierto={borrar} alCambiar={setBorrar} titulo="¿Borrar la cuenta entera?" descripcion="Esto no se puede deshacer. Escribe BORRAR para confirmarlo."
        pie={<><Boton variante="fantasma" onClick={() => setBorrar(false)}>Cancelar</Boton><Boton variante="rojo" disabled={confirmacion !== 'BORRAR'} onClick={() => void borrarCuenta()}>Borrar para siempre</Boton></>}>
        <Campo autoFocus value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} aria-label="Escribe BORRAR" />
      </Dialogo>
    </Lienzo>
  );
}
