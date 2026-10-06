import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Concepto } from '@scholaris/contrato';
import { avisar, Boton, Campo, Chip, Dialogo, Esqueleto, Etiquetado, Icono, Rotulo, Tarjeta, Vacio } from '@scholaris/ui';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { haceCuanto } from '../lib/formato';

export const Route = createFileRoute('/explorar/conceptos')({
  loader: ({ context }) => context.consultas.ensureQueryData(q.conceptos()),
  component: Conceptos,
});

function Conceptos() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery(q.conceptos());
  const [nuevo, setNuevo] = useState(false);

  async function ejecutar(c: Concepto) {
    try { await api().conceptos.ejecutar(c.id); avisar(`Rastreando «${c.nombre}» por todo el corpus. Te avisamos al terminar.`); }
    catch { avisar('No se pudo lanzar el informe.', { tono: 'error' }); }
    void qc.invalidateQueries({ queryKey: ['conceptos'] });
  }

  return (
    <Lienzo>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-[1.125rem] font-semibold text-coffee-800">Sigue un concepto por todo lo que has leído.</h2>
          <p className="mt-1 text-tinta-2">Dónde se define, dónde se aplica, dónde se critica. Con sus variantes en otras lenguas, y cada aparición con su página.</p>
        </div>
        <Boton variante="tinta" icono="mas" onClick={() => setNuevo(true)}>Nuevo concepto</Boton>
      </div>
      <ul className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isPending ? [0, 1].map((i) => <Esqueleto key={i} className="h-44" />) : !data?.length ? (
          <li className="md:col-span-2"><Vacio forma="cuarto" titulo="Ningún concepto en seguimiento." accion={<Boton variante="tinta" onClick={() => setNuevo(true)}>Seguir uno</Boton>}>Por ejemplo, «abyección», con «abject» y «abjection» como variantes.</Vacio></li>
        ) : data.map((c) => (
          <li key={c.id}>
            <Tarjeta className="flex h-full flex-col p-5">
              <h3 className="text-[1.375rem] font-bold tracking-[-0.01em]">{c.nombre}</h3>
              {c.descripcion ? <p className="mt-2 text-[0.9375rem] text-tinta-2">{c.descripcion}</p> : null}
              <div className="mt-3 flex flex-wrap gap-1.5">{c.terminos.map((t) => <span key={t} className="rounded-full border border-filete-fuerte px-2 py-0.5 font-mono text-[0.75rem]">{t}</span>)}</div>
              <Rotulo className="mt-auto block pt-4">{c.ultimoInforme ? `Último informe ${haceCuanto(c.actualizado)}` : 'Sin informes todavía'}</Rotulo>
              <div className="mt-3 flex gap-2 border-t border-filete pt-3">
                <Boton variante="linea" tam="p" icono="rayo" onClick={() => void ejecutar(c)}>Rastrear</Boton>
                <Boton variante="fantasma" tam="p" comoHijo><Link to="/buscar" search={{ q: [c.nombre, ...c.terminos].join(' ') }}><Icono nombre="buscar" tam={15} />Ver pasajes</Link></Boton>
              </div>
            </Tarjeta>
          </li>
        ))}
      </ul>
      <NuevoConcepto abierto={nuevo} alCambiar={setNuevo} />
    </Lienzo>
  );
}

function NuevoConcepto({ abierto, alCambiar }: { abierto: boolean; alCambiar: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState('');
  const [termino, setTermino] = useState('');
  const [terminos, setTerminos] = useState<string[]>([]);
  async function crear() {
    alCambiar(false);
    try { await api().conceptos.crear({ nombre: nombre.trim(), terminos }); void qc.invalidateQueries({ queryKey: ['conceptos'] }); avisar(`Siguiendo «${nombre.trim()}».`, { tono: 'exito' }); }
    catch { avisar('No se pudo crear.', { tono: 'error' }); }
    setNombre(''); setTerminos([]);
  }
  return (
    <Dialogo abierto={abierto} alCambiar={alCambiar} titulo="Nuevo concepto" pie={<><Boton variante="fantasma" onClick={() => alCambiar(false)}>Cancelar</Boton><Boton variante="tinta" disabled={!nombre.trim()} onClick={() => void crear()}>Crear</Boton></>}>
      <div className="flex flex-col gap-4">
        <Etiquetado etiqueta="Concepto">{(id) => <Campo id={id} autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Abyección" />}</Etiquetado>
        <Etiquetado etiqueta="Variantes y otras lenguas" ayuda="Pulsa Intro para añadir cada una.">{(id, d) => (
          <Campo id={id} aria-describedby={d} value={termino} onChange={(e) => setTermino(e.target.value)} placeholder="abject, abjection…"
            onKeyDown={(e) => { if (e.key === 'Enter' && termino.trim()) { e.preventDefault(); setTerminos([...terminos, termino.trim()]); setTermino(''); } }} />
        )}</Etiquetado>
        {terminos.length ? <div className="flex flex-wrap gap-1.5">{terminos.map((t) => <Chip key={t} alQuitar={() => setTerminos(terminos.filter((x) => x !== t))}>{t}</Chip>)}</div> : null}
      </div>
    </Dialogo>
  );
}
