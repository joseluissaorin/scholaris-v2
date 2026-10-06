import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Ajustes } from '@scholaris/contrato';
import { avisar, cx, Filete, Rotulo, Selector } from '@scholaris/ui';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { ponerPreferencia, ponerTema, preferencia, useTema, type Tema } from '../lib/acciones';

export const Route = createFileRoute('/ajustes/apariencia')({ component: Apariencia });

const TEMAS: Array<{ id: Tema; nombre: string; papel: string; tinta: string }> = [
  { id: 'claro', nombre: 'Papel', papel: '#f3eee3', tinta: '#22160f' },
  { id: 'oscuro', nombre: 'Tinta', papel: '#1a1511', tinta: '#efe6d6' },
  { id: 'sistema', nombre: 'Como el sistema', papel: 'linear-gradient(135deg,#f3eee3 50%,#1a1511 50%)', tinta: '#b8321c' },
];

function Apariencia() {
  const tema = useTema();
  const qc = useQueryClient();
  const { data: ajustes } = useQuery(q.ajustes());
  const { data: estilos } = useQuery(q.estilos());
  const [densidad, setDensidad] = useState(() => preferencia('densidad', 'normal'));
  const [lectura, setLectura] = useState(() => Number(preferencia('lectura', '17')));

  const cambiarDensidad = (d: string) => { setDensidad(d); ponerPreferencia('densidad', d); if (d === 'normal') delete document.documentElement.dataset.densidad; else document.documentElement.dataset.densidad = d; };
  const cambiarLectura = (n: number) => { setLectura(n); ponerPreferencia('lectura', String(n)); document.documentElement.style.setProperty('--tam-lectura', `${n / 16}rem`); };
  async function estiloCita(id: string) {
    ponerPreferencia('estilo', id);
    qc.setQueryData<Ajustes>(['ajustes'], (a) => a && { ...a, preferencias: { ...a.preferencias, estiloCita: id } });
    try { await api().ajustes.preferencias({ estiloCita: id }); avisar('Estilo de cita guardado.'); } catch { avisar('No se pudo guardar.', { tono: 'error' }); }
  }

  return (
    <Lienzo ancho="estrecho">
      <Filete>Tema</Filete>
      <div role="radiogroup" aria-label="Tema" className="mt-4 grid grid-cols-3 gap-3">
        {TEMAS.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={tema === t.id} onClick={() => { ponerTema(t.id); void api().ajustes.preferencias({ tema: t.id }).catch(() => undefined); }}
            className={cx('group overflow-hidden rounded-m border text-left', tema === t.id ? 'border-tinta ring-2 ring-tinta ring-offset-2 ring-offset-papel' : 'border-filete hover:border-filete-fuerte')}>
            <div className="relative h-24" style={{ background: t.papel }}>
              <span className="absolute left-3 top-3 text-[1.75rem]" style={{ color: t.tinta, fontFamily: 'Georgia, serif' }}>Aa</span>
              <span className="absolute -bottom-6 -right-6 h-16 w-16 rounded-full bg-rojo" />
            </div>
            <p className="px-3 py-2 text-[0.9375rem]">{t.nombre}</p>
          </button>
        ))}
      </div>

      <Filete className="mt-12">Lectura</Filete>
      <div className="mt-4 grid gap-8 sm:grid-cols-2">
        <div>
          <label htmlFor="tam" className="rotulo flex justify-between text-tinta-2"><span>Tamaño del texto en el lector</span><span className="tnum text-tinta">{lectura} px</span></label>
          <input id="tam" type="range" min={15} max={22} value={lectura} onChange={(e) => cambiarLectura(Number(e.target.value))} className="mt-3 w-full accent-[var(--s-rojo)]" />
          <p className="lectura mt-3 text-tinta-2" style={{ fontSize: `${lectura / 16}rem` }}>El castigo deja de ser un espectáculo y se repliega hacia un ejercicio discreto.</p>
        </div>
        <div>
          <Rotulo className="text-tinta-2">Densidad de la interfaz</Rotulo>
          <div role="radiogroup" aria-label="Densidad" className="mt-3 flex rounded-s border border-filete-fuerte p-0.5">
            {[['compacta', 'Compacta'], ['normal', 'Normal'], ['amplia', 'Amplia']].map(([d, n]) => (
              <button key={d} type="button" role="radio" aria-checked={densidad === d} onClick={() => cambiarDensidad(d!)} className={cx('h-9 flex-1 rounded-md text-[0.875rem]', densidad === d ? 'bg-tinta text-sobre-tinta' : 'text-tinta-2 hover:text-tinta')}>{n}</button>
            ))}
          </div>
        </div>
      </div>

      <Filete className="mt-12">Citas</Filete>
      <div className="mt-4 max-w-sm">
        <label htmlFor="estilo-defecto" className="rotulo text-tinta-2">Estilo por defecto</label>
        <Selector id="estilo-defecto" className="mt-2" value={ajustes?.preferencias.estiloCita ?? preferencia('estilo', 'apa')} onChange={(e) => void estiloCita(e.target.value)}>
          {(estilos ?? []).map((e) => <option key={e.id} value={e.id}>{e.titulo}</option>)}
        </Selector>
        <p className="mt-2 text-[0.8125rem] text-apagado">Se usa al citar desde el lector, en la autocita y al copiar referencias.</p>
      </div>
    </Lienzo>
  );
}
