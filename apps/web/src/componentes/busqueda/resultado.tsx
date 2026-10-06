import { memo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ResultadoVista } from '@scholaris/contrato';
import { avisar, cx, Folio, Icono, MenuContenido, MenuDisparador, MenuElemento, MenuRaiz, MenuRotulo, Rotulo } from '@scholaris/ui';
import { api } from '../../datos/api';
import { q } from '../../datos/consultas';
import { anclaABusqueda } from '../../lib/anclas';
import { Resaltado } from '../../lib/resaltado';
import { autoresCorto, ICONO_TIPO } from '../../lib/formato';

const VIA: Record<string, string> = { lexica: 'léxica', densa: 'semántica', visual: 'visual' };

/** Un pasaje encontrado: el texto, de dónde es, su folio, y lo que se puede hacer con él. */
export const Resultado = memo(function Resultado({ r, consulta, indice, compacto }: { r: ResultadoVista; consulta?: string; indice: number; compacto?: boolean }) {
  const qc = useQueryClient();
  const [parecidos, setParecidos] = useState<ResultadoVista[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [menu, setMenu] = useState(false);
  const { data: cuadernos } = useQuery({ ...q.cuadernos(), enabled: menu });
  const m = r.documento.metadatos;
  const destino = { to: '/lector/$id' as const, params: { id: r.documento.id }, search: anclaABusqueda(r.fragmento.ancla, { q: consulta }) };

  async function copiar() {
    try { await navigator.clipboard.writeText(`«${r.fragmento.texto}» ${r.citaCorta}`); avisar(`Cita copiada: ${r.citaCorta}`, { tono: 'exito' }); }
    catch { avisar('El navegador no dejó copiar.', { tono: 'error' }); }
  }
  async function verParecidos() {
    if (parecidos) { setParecidos(null); return; }
    setCargando(true);
    try { const s = await api().busqueda.similares({ fragmento: r.fragmento.id, k: 5 }); setParecidos(s.resultados); }
    catch { avisar('No se pudieron buscar parecidos.', { tono: 'error' }); }
    setCargando(false);
  }
  async function guardar(c: { id: string; titulo: string }) {
    try {
      await api().cuadernos.crearTarjeta(c.id, { tipo: 'fragmento', documento: r.documento.id, objetivo: r.fragmento.id });
      void qc.invalidateQueries({ queryKey: ['tarjetas', c.id] });
      avisar(`Guardado en «${c.titulo}».`, { tono: 'exito' });
    } catch { avisar('No se pudo guardar.', { tono: 'error' }); }
  }

  return (
    <article className={cx('group relative grid grid-cols-[minmax(0,1fr)] gap-3 border-b border-filete py-5 anim-entra md:grid-cols-[7rem_minmax(0,1fr)] md:gap-6', compacto && 'py-4')} style={{ animationDelay: `${Math.min(indice, 8) * 25}ms` }}>
      <div className="flex items-center gap-3 md:flex-col md:items-start md:gap-2">
        <Folio grande>{r.etiqueta}</Folio>
        <Rotulo className="hidden md:block">{r.vias.map((v) => VIA[v] ?? v).join(' · ')}</Rotulo>
      </div>
      <div className="min-w-0">
        <Link {...destino} className="block">
          <p className="lectura text-tinta decoration-filete-fuerte underline-offset-4 group-hover:underline">
            <Resaltado html={r.resaltado ?? r.fragmento.texto} />
          </p>
        </Link>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-tinta-2">
          <Icono nombre={ICONO_TIPO[r.documento.tipo]} tam={14} className="text-apagado" />
          <span className="min-w-0 truncate"><em>{m.titulo}</em> · {autoresCorto(m)}{m.anio ? `, ${m.anioOriginal && m.anioOriginal !== m.anio ? `${m.anioOriginal}/${m.anio}` : m.anio}` : ''}</span>
          {r.fragmento.seccion.length ? <span className="hidden truncate text-apagado lg:inline">{r.fragmento.seccion.at(-1)}</span> : null}
          <span className="ml-auto flex items-center gap-1 md:opacity-0 md:transition-opacity md:group-focus-within:opacity-100 md:group-hover:opacity-100">
            <button type="button" onClick={() => void copiar()} className="flex h-8 items-center gap-1.5 rounded-s px-2 hover:bg-hondo hover:text-tinta"><Icono nombre="citar" tam={14} />Citar</button>
            <button type="button" onClick={() => void verParecidos()} aria-expanded={!!parecidos} className="flex h-8 items-center gap-1.5 rounded-s px-2 hover:bg-hondo hover:text-tinta"><Icono nombre="pila" tam={14} />{cargando ? 'Buscando…' : 'Parecidos'}</button>
            <MenuRaiz onOpenChange={setMenu}>
              <MenuDisparador asChild><button type="button" className="flex h-8 items-center gap-1.5 rounded-s px-2 hover:bg-hondo hover:text-tinta"><Icono nombre="marcador" tam={13} />Guardar</button></MenuDisparador>
              <MenuContenido>
                <MenuRotulo>Guardar en el cuaderno</MenuRotulo>
                {(cuadernos ?? []).map((c) => <MenuElemento key={c.id} icono="escribir" alElegir={() => void guardar(c)}>{c.titulo}</MenuElemento>)}
              </MenuContenido>
            </MenuRaiz>
          </span>
        </div>
        {parecidos ? (
          <div className="mt-4 border-l-2 border-azul pl-4">
            <Rotulo>Pasajes parecidos</Rotulo>
            {parecidos.length ? parecidos.map((p, i) => <Resultado key={p.fragmento.id} r={p} indice={i} compacto />) : <p className="mt-2 text-apagado">No hay pasajes parecidos en otros documentos.</p>}
          </div>
        ) : null}
      </div>
    </article>
  );
});
