/**
 * «Añadir a mi Scholaris» desde un enlace de solo lectura: seguir la colección
 * (en vivo, mientras el enlace funcione) o copiarla a tu biblioteca (tuya para
 * siempre, al instante y sin volver a leer nada).
 */
import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DERECHOS } from '@scholaris/contrato';
import { avisar, Boton, Esqueleto, Icono, Tarjeta, Vacio } from '@scholaris/ui';
import { api } from '../datos/api';
import { Cabecera } from '../componentes/comunes/cabecera';
import { numero } from '../lib/numero';
import { motivoEnlace } from '../componentes/comunes/errores';

export const Route = createFileRoute('/recibir/$token')({ component: Recibir });

function Recibir() {
  const { token } = Route.useParams();
  const navegar = useNavigate();
  const qc = useQueryClient();
  const pase = (() => { try { return sessionStorage.getItem(`scholaris.pase.${token}`) ?? undefined; } catch { return undefined; } })();
  const { data: v, error, isPending } = useQuery({ queryKey: ['enlace', token], queryFn: () => api().enlacePublico.vista(token), retry: false });
  const [haciendo, setHaciendo] = useState<'seguir' | 'copiar' | null>(null);
  const [avance, setAvance] = useState('');

  async function seguir() {
    setHaciendo('seguir');
    try {
      const s = await api().seguidas.porEnlace(token, pase);
      void qc.invalidateQueries({ queryKey: ['seguidas'] });
      void qc.invalidateQueries({ queryKey: ['bibliotecas'] });
      avisar(`Sigues «${s.nombre}».`, { tono: 'exito' });
      void navegar({ to: '/compartida/$id', params: { id: s.biblioteca } });
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo.', { tono: 'error' }); }
    finally { setHaciendo(null); }
  }

  async function copiar() {
    setHaciendo('copiar');
    try {
      const r = await api().copias.copiarTodo({ origen: { enlace: token, ...(pase ? { pase } : {}) } }, (p) => setAvance(`${numero(p.copiados.length + p.repetidos.length)} de ${numero(p.total)}`));
      void qc.invalidateQueries({ queryKey: ['bibliotecas'] });
      void qc.invalidateQueries({ queryKey: ['documentos'] });
      avisar(`En tu biblioteca: ${numero(r.copiados.length)} copiados${r.repetidos.length ? `, ${numero(r.repetidos.length)} ya los tenías` : ''}.`, { tono: 'exito' });
      void navegar({ to: '/', search: { col: r.biblioteca } });
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo copiar.', { tono: 'error' }); }
    finally { setHaciendo(null); setAvance(''); }
  }

  return (
    <>
      <Cabecera forma="circulo" titulo="Añadir a mi Scholaris" antetitulo="Alguien te ha mandado una colección o un documento" />
      <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-5 sm:px-6 lg:px-10">
        {isPending ? <Esqueleto className="h-48 rounded-2xl" /> : error || !v ? (
          <Vacio estilo="malevich" titulo="Este enlace ya no funciona.">{motivoEnlace(error)}</Vacio>
        ) : (
          <Tarjeta className="p-6">
            <p className="text-[0.8125rem] text-coffee-500">{v.de} comparte {v.tipo === 'biblioteca' ? `una colección de ${numero(v.documentos)} documentos` : 'un documento'}</p>
            <h2 className="mt-1 text-[1.5rem] font-semibold text-coffee-800">{v.titulo}</h2>
            {v.descripcion ? <p className="mt-2 text-[0.9375rem] text-coffee-600">{v.descripcion}</p> : null}
            <p className="mt-3 flex items-center gap-2 text-[0.8125rem] text-coffee-500"><Icono nombre="aviso" tam={14} />Derechos: {DERECHOS[v.derechos].nombre.toLowerCase()}{DERECHOS[v.derechos].abierto ? '' : '. Es para tu uso privado.'}</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {v.tipo === 'biblioteca' ? (
                <button type="button" disabled={!!haciendo} onClick={() => void seguir()} className="rounded-2xl border border-cream-400 bg-cream-50 p-4 text-left shadow-[var(--relieve)] transition-transform hover:-translate-y-px disabled:opacity-60">
                  <span className="flex items-center gap-2 text-[1rem] font-semibold text-coffee-800"><span className="h-3 w-3 rounded-full bg-azul" />Seguir</span>
                  <span className="mt-1 block text-[0.8125rem] text-coffee-600">La ves en vivo: cambia cuando {v.de} la cambia. Mientras el enlace funcione.</span>
                </button>
              ) : null}
              <button type="button" disabled={!!haciendo} onClick={() => void copiar()} className="rounded-2xl border border-cream-400 bg-cream-50 p-4 text-left shadow-[var(--relieve)] transition-transform hover:-translate-y-px disabled:opacity-60">
                <span className="flex items-center gap-2 text-[1rem] font-semibold text-coffee-800"><span className="h-3 w-3 bg-rojo" />Copiar a mi biblioteca</span>
                <span className="mt-1 block text-[0.8125rem] text-coffee-600">{haciendo === 'copiar' ? `Copiando ${avance}…` : 'Tuya para siempre, al instante: no se vuelve a leer nada.'}</span>
              </button>
            </div>
            <div className="mt-5"><Boton variante="fantasma" tam="p" icono="izquierda" onClick={() => { location.href = `/p/${token}`; }}>Volver a la vista de lectura</Boton></div>
          </Tarjeta>
        )}
      </div>
    </>
  );
}

