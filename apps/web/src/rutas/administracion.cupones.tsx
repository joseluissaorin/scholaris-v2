import { useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorApi, type Concesion, type CuponAdmin, type LoteCreado, type ResumenLote } from '@scholaris/contrato';
import { avisar, Boton, Campo, cx, Esqueleto, Etiquetado, Selector } from '@scholaris/ui';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo, Seccion } from '../componentes/comunes/cabecera';
import { fecha, haceCuanto } from '../lib/formato';
import { numero } from '../lib/numero';

export const Route = createFileRoute('/administracion/cupones')({
  loader: ({ context }) => context.consultas.ensureQueryData(q.yo()),
  component: Cupones,
});

const DURACIONES: Array<[string, string]> = [['', 'De por vida'], ['30', '30 días'], ['90', '90 días'], ['180', '180 días'], ['365', 'Un año']];
const duracion = (dias: number | null) => (dias ? `${numero(dias)} días` : 'de por vida');
const mensaje = (e: unknown) => (e instanceof ErrorApi ? e.message : 'No se ha podido hacer. Vuelve a intentarlo.');

function descargar(nombre: string, csv: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `cupones-${nombre.replace(/[^\p{L}\p{N}._-]+/gu, '-')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function Cupones() {
  const { data: yo, isPending } = useQuery(q.yo());
  if (isPending || !yo) return <Lienzo ancho="estrecho"><Esqueleto className="h-40" /></Lienzo>;
  if (!yo.admin) {
    return (
      <Lienzo ancho="estrecho">
        <p className="rounded-xl bg-cream-200/60 px-4 py-3 text-[0.875rem] text-coffee-600 shadow-[var(--hundido)]">Esta parte solo la puede usar quien administra Scholaris.</p>
      </Lienzo>
    );
  }
  return (
    <Lienzo ancho="estrecho" className="space-y-5">
      <NuevoLote />
      <Lotes />
      <Concesiones />
    </Lienzo>
  );
}

function NuevoLote() {
  const qc = useQueryClient();
  const [cantidad, setCantidad] = useState('10');
  const [dias, setDias] = useState('');
  const [lote, setLote] = useState('');
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [creado, setCreado] = useState<LoteCreado | null>(null);

  async function crear(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api().admin.crearLote({ cantidad: Number(cantidad), plan: 'pro', dias: dias ? Number(dias) : null, ...(lote.trim() ? { lote: lote.trim() } : {}), ...(nota.trim() ? { nota: nota.trim() } : {}) });
      setCreado(r);
      setLote(''); setNota('');
      void qc.invalidateQueries({ queryKey: ['admin', 'lotes'] });
    } catch (err) { avisar(mensaje(err), { tono: 'error' }); } finally { setEnviando(false); }
  }

  return (
    <Seccion icono="mas" titulo="Nuevo lote de cupones" descripcion="Cupones Pro de un solo uso. Los códigos se ven una única vez: Scholaris solo guarda su huella.">
      <form onSubmit={(e) => void crear(e)} className="grid gap-4 sm:grid-cols-2">
        <Etiquetado etiqueta="Cuántos">
          {(id, d) => (
            <Campo id={id} aria-describedby={d} type="number" min={1} max={1000} value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
          )}
        </Etiquetado>
        <Etiquetado etiqueta="Duración del plan">
          {(id, d) => (
            <Selector id={id} aria-describedby={d} value={dias} onChange={(e) => setDias(e.target.value)}>
              {DURACIONES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </Selector>
          )}
        </Etiquetado>
        <Etiquetado etiqueta="Nombre del lote" ayuda="Si lo dejas vacío, lleva la fecha.">
          {(id, d) => (
            <Campo id={id} aria-describedby={d} value={lote} onChange={(e) => setLote(e.target.value)} maxLength={60} placeholder="Lanzamiento de otoño" />
          )}
        </Etiquetado>
        <Etiquetado etiqueta="Nota">
          {(id, d) => (
            <Campo id={id} aria-describedby={d} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Para quién son, por qué" />
          )}
        </Etiquetado>
        <div className="sm:col-span-2">
          <Boton type="submit" variante="tinta" className="tactil" cargando={enviando} disabled={!(Number(cantidad) >= 1 && Number(cantidad) <= 1000)}>Generar cupones</Boton>
        </div>
      </form>

      {creado ? (
        <div className="anim-sube mt-5 space-y-3 rounded-xl border border-cream-400 bg-cream-50 p-4 shadow-[var(--relieve)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.875rem] font-semibold text-coffee-800">«{creado.lote}»: {numero(creado.codigos.length)} cupones Pro {duracion(creado.dias)}</p>
            <div className="flex gap-2">
              <Boton variante="linea" tam="p" icono="copiar" className="tactil" onClick={() => { void navigator.clipboard.writeText(creado.codigos.join('\n')); avisar('Códigos copiados.'); }}>Copiar</Boton>
              <Boton variante="tinta" tam="p" icono="descargar" className="tactil" onClick={() => descargar(creado.lote, creado.csv)}>Descargar CSV</Boton>
            </div>
          </div>
          <p className="text-[0.8125rem] text-rojo">Guárdalos ahora: cuando salgas de esta pantalla no se podrán volver a ver.</p>
          <ul className="grid max-h-64 grid-cols-2 gap-x-4 gap-y-1 overflow-auto rounded-lg bg-cream-100 p-3 font-mono text-[0.8125rem] text-coffee-700 shadow-[var(--hundido)] sm:grid-cols-3">
            {creado.codigos.map((c) => <li key={c} className="select-all">{c}</li>)}
          </ul>
        </div>
      ) : null}
    </Seccion>
  );
}

function Lotes() {
  const { data: lotes, isPending } = useQuery({ queryKey: ['admin', 'lotes'], queryFn: () => api().admin.lotes() });
  const [abierto, setAbierto] = useState<string | null>(null);
  return (
    <Seccion icono="lista" titulo="Lotes" descripcion="Cuántos se han canjeado y cuántos se han anulado.">
      {isPending ? <Esqueleto className="h-24" /> : !lotes?.length ? (
        <p className="text-[0.8125rem] text-coffee-500">Aún no hay ningún lote.</p>
      ) : (
        <ul className="divide-y divide-cream-300 overflow-hidden rounded-xl border border-cream-300 bg-cream-100/50">
          {lotes.map((l) => <FilaLote key={l.lote} l={l} abierto={abierto === l.lote} alternar={() => setAbierto(abierto === l.lote ? null : l.lote)} />)}
        </ul>
      )}
    </Seccion>
  );
}

function FilaLote({ l, abierto, alternar }: { l: ResumenLote; abierto: boolean; alternar: () => void }) {
  const qc = useQueryClient();
  const { data: cupones } = useQuery({ queryKey: ['admin', 'lote', l.lote], queryFn: () => api().admin.cupones(l.lote), enabled: abierto });
  const libres = l.total - l.canjeados - l.revocados;

  async function anular(c?: CuponAdmin) {
    const que = c ? `el cupón ${c.pista}` : `los ${numero(libres)} cupones sin canjear de «${l.lote}»`;
    if (!window.confirm(`¿Anular ${que}? No se puede deshacer.`)) return;
    try {
      const r = await api().admin.revocarCupones(c ? { huellas: [c.huella] } : { lote: l.lote });
      avisar(r.revocados === 1 ? 'Un cupón anulado.' : `${numero(r.revocados)} cupones anulados.`);
      void qc.invalidateQueries({ queryKey: ['admin'] });
    } catch (err) { avisar(mensaje(err), { tono: 'error' }); }
  }

  return (
    <li>
      <button type="button" onClick={alternar} aria-expanded={abierto} className="tactil flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-cream-50">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.875rem] font-semibold text-coffee-800">{l.lote}</span>
          <span className="block text-[0.75rem] text-coffee-500">Pro {duracion(l.dias)} · {fecha(l.creado)}{l.nota ? ` · ${l.nota}` : ''}</span>
        </span>
        <span className="dato shrink-0 text-[0.8125rem] text-coffee-600">{numero(l.canjeados)} de {numero(l.total)} canjeados{l.revocados ? ` · ${numero(l.revocados)} anulados` : ''}</span>
      </button>
      {abierto ? (
        <div className="anim-sube space-y-2 px-4 pb-4">
          {libres > 0 ? <div className="flex justify-end"><Boton variante="linea" tam="p" className="tactil !text-rojo" onClick={() => void anular()}>Anular los {numero(libres)} libres</Boton></div> : null}
          {!cupones ? <Esqueleto className="h-16" /> : (
            <ul className="max-h-80 overflow-auto rounded-lg bg-cream-50 text-[0.8125rem] shadow-[var(--hundido)]">
              {cupones.map((c) => (
                <li key={c.huella} className="flex items-center gap-3 border-b border-cream-200 px-3 py-1.5 last:border-0">
                  <span className="font-mono text-coffee-700">{c.pista}</span>
                  <span className={cx('flex-1 truncate', c.canjeadoPor ? 'text-coffee-700' : c.revocado ? 'text-rojo' : 'text-coffee-400')}>
                    {c.canjeadoPor ? `Canjeado por ${c.canjeadoPor} ${haceCuanto(c.canjeadoEn!)}` : c.revocado ? 'Anulado' : 'Libre'}
                  </span>
                  {!c.canjeadoPor && !c.revocado ? <button type="button" className="text-[0.75rem] text-coffee-500 underline-offset-2 hover:text-rojo hover:underline" onClick={() => void anular(c)}>Anular</button> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}

function Concesiones() {
  const qc = useQueryClient();
  const { data: lista, isPending } = useQuery({ queryKey: ['admin', 'concesiones'], queryFn: () => api().admin.concesiones() });
  const [usuario, setUsuario] = useState('');
  const [dias, setDias] = useState('');
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function conceder(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const c = await api().admin.conceder({ usuario: usuario.trim(), plan: 'pro', dias: dias ? Number(dias) : null, ...(nota.trim() ? { nota: nota.trim() } : {}) });
      avisar(`Pro ${c.caduca ? `hasta el ${fecha(c.caduca)}` : 'de por vida'} concedido a ${c.usuario}.`);
      setUsuario(''); setNota('');
      void qc.invalidateQueries({ queryKey: ['admin', 'concesiones'] });
    } catch (err) { avisar(mensaje(err), { tono: 'error' }); } finally { setEnviando(false); }
  }

  async function revocar(c: Concesion) {
    if (!window.confirm(`¿Retirar el plan ${c.plan === 'pro' ? 'Pro' : c.plan} de ${c.usuario}?`)) return;
    try { await api().admin.revocarConcesion(c.id); avisar('Concesión retirada.'); void qc.invalidateQueries({ queryKey: ['admin', 'concesiones'] }); }
    catch (err) { avisar(mensaje(err), { tono: 'error' }); }
  }

  return (
    <Seccion icono="llave" titulo="Conceder un plan a mano" descripcion="Por el identificador de Clerk de la cuenta («user_…»). Nunca rebaja: manda el mejor plan.">
      <form onSubmit={(e) => void conceder(e)} className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Etiquetado etiqueta="Usuario">
          {(id, d) => (
            <Campo id={id} aria-describedby={d} value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="user_…" spellCheck={false} className="[&_input]:font-mono" required />
          )}
        </Etiquetado>
        <Etiquetado etiqueta="Duración">
          {(id, d) => (
            <Selector id={id} aria-describedby={d} value={dias} onChange={(e) => setDias(e.target.value)}>
              {DURACIONES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </Selector>
          )}
        </Etiquetado>
        <Etiquetado etiqueta="Nota" className="sm:col-span-2">
          {(id, d) => (
            <Campo id={id} aria-describedby={d} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Por qué" />
          )}
        </Etiquetado>
        <div className="sm:col-span-2"><Boton type="submit" variante="tinta" className="tactil" cargando={enviando} disabled={!/^[\w-]{3,80}$/.test(usuario.trim())}>Conceder Pro</Boton></div>
      </form>
      <div className="mt-5">
        {isPending ? <Esqueleto className="h-16" /> : !lista?.length ? <p className="text-[0.8125rem] text-coffee-500">Aún no hay concesiones.</p> : (
          <ul className="divide-y divide-cream-300 overflow-hidden rounded-xl border border-cream-300 bg-cream-100/50 text-[0.8125rem]">
            {lista.map((c) => (
              <li key={c.id} className={cx('flex items-center gap-3 px-4 py-2', c.revocada && 'opacity-55')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-coffee-800">{c.usuario}</span>
                  <span className="block text-[0.75rem] text-coffee-500">
                    Pro {c.caduca ? `hasta el ${fecha(c.caduca)}` : 'de por vida'} · {c.origen === 'cupon' ? `cupón ${c.cupon ?? ''}` : 'a mano'} · {haceCuanto(c.concedida)}{c.nota ? ` · ${c.nota}` : ''}{c.revocada ? ' · retirada' : ''}
                  </span>
                </span>
                {!c.revocada ? <button type="button" className="text-[0.75rem] text-coffee-500 underline-offset-2 hover:text-rojo hover:underline" onClick={() => void revocar(c)}>Retirar</button> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Seccion>
  );
}
