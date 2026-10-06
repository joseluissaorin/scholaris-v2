import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Ajustes, AlcanceClave, ClaveApi, ClaveApiCreada, ProveedorClave } from '@scholaris/contrato';
import { avisar, Boton, Campo, conDeshacer, cx, Dialogo, Esqueleto, Etiquetado, Filete, Icono, Interruptor, Rotulo, Selector } from '@scholaris/ui';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo, Seccion } from '../componentes/comunes/cabecera';
import { haceCuanto } from '../lib/formato';
import { Boceto } from '../bocetos/boceto';

export const Route = createFileRoute('/ajustes/claves')({
  loader: ({ context }) => Promise.all([context.consultas.ensureQueryData(q.claves()), context.consultas.ensureQueryData(q.ajustes())]),
  component: Claves,
});

const PROVEEDORES: Array<{ id: ProveedorClave; nombre: string; uso: string }> = [
  { id: 'gemini', nombre: 'Google Gemini', uso: 'Lectura de páginas, vectores multimodales y respuestas' },
  { id: 'openrouter', nombre: 'OpenRouter', uso: 'Modelos alternativos de lectura y redacción' },
  { id: 'mistral', nombre: 'Mistral', uso: 'OCR de escaneos difíciles' },
  { id: 'typesafe', nombre: 'TypeSafe (Jev)', uso: 'El juez que verifica cada cita y los folios' },
  { id: 'voyage', nombre: 'Voyage', uso: 'Reordenación y vectores' },
  { id: 'zeroentropy', nombre: 'ZeroEntropy', uso: 'Reordenación (zerank)' },
  { id: 'cohere', nombre: 'Cohere', uso: 'Vectores y reordenación' },
  { id: 'jina', nombre: 'Jina', uso: 'Vectores con pesos abiertos (sin conexión)' },
];

const ALCANCES: Record<AlcanceClave, string> = { lectura: 'Leer y buscar', escritura: 'Añadir y editar', mcp: 'Servidor MCP' };

function Claves() {
  const qc = useQueryClient();
  const { data: claves, isPending } = useQuery(q.claves());
  const { data: ajustes } = useQuery(q.ajustes());
  const [crear, setCrear] = useState(false);
  const [creada, setCreada] = useState<ClaveApiCreada | null>(null);

  function revocar(k: ClaveApi) {
    const previo = qc.getQueryData(['claves']);
    qc.setQueryData<ClaveApi[]>(['claves'], (l) => l?.filter((x) => x.id !== k.id));
    conDeshacer(`Clave «${k.nombre}» revocada.`, () => qc.setQueryData(['claves'], previo), () => void api().claves.revocar(k.id));
  }

  async function usarPropias(v: boolean) {
    qc.setQueryData<Ajustes>(['ajustes'], (a) => a && { ...a, preferencias: { ...a.preferencias, usarClavesPropias: v } });
    try { qc.setQueryData(['ajustes'], await api().ajustes.preferencias({ usarClavesPropias: v })); } catch { avisar('No se pudo guardar.', { tono: 'error' }); }
  }

  return (
    <Lienzo ancho="estrecho" className="space-y-5">
      <Seccion icono="llave" titulo="Claves de API" descripcion="Para usar tu biblioteca desde el SDK de Python o desde cualquier agente por MCP (Claude, por ejemplo), con citas verificadas."
        accion={<Boton variante="tinta" tam="p" icono="mas" onClick={() => setCrear(true)}>Nueva clave</Boton>}>
        {isPending ? <Esqueleto className="h-14" /> : !claves?.length ? (
          <div className="anim-sube rounded-xl border border-dashed border-cream-500 bg-cream-100/60 px-4 py-6 text-center shadow-[var(--hundido)]">
            {/* La llave antigua con su etiqueta «API», dibujada a mano. */}
            <Boceto nombre="llave" decorativo className="mx-auto mb-2 w-52 max-w-full" />
            <p className="text-[0.875rem] font-medium text-coffee-700">Aún no hay claves de API</p>
            <p className="mt-1 text-[0.8125rem] text-coffee-500">Crea una para que los agentes hablen con tu Scholaris.</p>
          </div>
        ) : (
          <ul className="cascada overflow-hidden rounded-xl border border-cream-300 bg-cream-100/50">
            {claves.map((k, i) => (
              <li key={k.id} style={{ ['--i' as string]: i }} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-cream-200 px-4 py-3 last:border-0">
                <Icono nombre="llave" tam={16} className="text-coffee-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-[0.875rem] font-medium">{k.nombre}</p>
                  <p className="text-[0.75rem] text-coffee-400">{k.alcances.map((a) => ALCANCES[a]).join(' · ')} · creada {haceCuanto(k.creada)}{k.ultimoUso ? ` · usada ${haceCuanto(k.ultimoUso)}` : ' · sin usar'}</p>
                </div>
                <code className="dato hidden text-coffee-500 sm:inline">{k.prefijo}…</code>
                <Boton variante="fantasma" tam="p" className="!text-rojo" onClick={() => revocar(k)}>Revocar</Boton>
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      <Seccion icono="ajustes" titulo="Claves propias" descripcion="Si pones tu clave de un proveedor, las llamadas a ese proveedor van a tu cuenta y no gastan tu plan. Se guardan cifradas; nunca volvemos a enseñarlas."
        accion={<label className="flex shrink-0 items-center gap-2.5 text-[0.8125rem] font-medium text-coffee-700">Usarlas<Interruptor activo={!!ajustes?.preferencias.usarClavesPropias} alCambiar={(v) => void usarPropias(v)} etiqueta="Usar mis claves cuando las haya" /></label>}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {PROVEEDORES.map((p) => <Proveedor key={p.id} p={p} guardada={ajustes?.claves.find((c) => c.proveedor === p.id)} />)}
        </ul>
      </Seccion>

      <NuevaClave abierta={crear} alCambiar={setCrear} alCrear={(k) => { setCreada(k); void qc.invalidateQueries({ queryKey: ['claves'] }); }} />
      <Dialogo abierto={!!creada} alCambiar={(v) => !v && setCreada(null)} titulo="Tu clave nueva" descripcion="Cópiala ahora: es la única vez que se enseña entera." ancho="g"
        pie={<Boton variante="tinta" onClick={() => setCreada(null)}>Ya la he guardado</Boton>}>
        {creada ? <SecretoCreado k={creada} /> : null}
      </Dialogo>
    </Lienzo>
  );
}

function SecretoCreado({ k }: { k: ClaveApiCreada }) {
  const mcp = JSON.stringify({ mcpServers: { scholaris: { url: `${location.origin}/mcp`, headers: { Authorization: `Bearer ${k.secreto}` } } } }, null, 2);
  const copiar = async (t: string, que: string) => { try { await navigator.clipboard.writeText(t); avisar(`${que} copiada.`, { tono: 'exito' }); } catch { avisar('No se pudo copiar.', { tono: 'error' }); } };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-xl border border-cream-400 bg-cream-100 p-3 shadow-[var(--hundido)]">
        <code className="min-w-0 flex-1 break-all font-mono text-[0.875rem]">{k.secreto}</code>
        <Boton variante="tinta" tam="p" icono="copiar" onClick={() => void copiar(k.secreto, 'Clave')}>Copiar</Boton>
      </div>
      {k.alcances.includes('mcp') ? (
        <div>
          <div className="flex items-center justify-between"><span className="text-[0.8125rem] font-medium text-coffee-700">Configuración MCP</span><Boton variante="fantasma" tam="p" icono="copiar" onClick={() => void copiar(mcp, 'Configuración')}>Copiar</Boton></div>
          <pre className="mt-2 overflow-x-auto rounded-xl bg-[#2c1810] p-4 font-mono text-[0.75rem] leading-relaxed text-[#faf7f0] shadow-[var(--hundido)]">{mcp}</pre>
        </div>
      ) : null}
    </div>
  );
}

function NuevaClave({ abierta, alCambiar, alCrear }: { abierta: boolean; alCambiar: (v: boolean) => void; alCrear: (k: ClaveApiCreada) => void }) {
  const [nombre, setNombre] = useState('');
  const [alcances, setAlcances] = useState<AlcanceClave[]>(['lectura', 'mcp']);
  const [dias, setDias] = useState('');
  async function crear() {
    alCambiar(false);
    try { alCrear(await api().claves.crear({ nombre: nombre.trim(), alcances, ...(dias ? { dias: Number(dias) } : {}) })); }
    catch { avisar('No se pudo crear la clave.', { tono: 'error' }); }
    setNombre('');
  }
  return (
    <Dialogo abierto={abierta} alCambiar={alCambiar} titulo="Nueva clave de API" pie={<><Boton variante="fantasma" onClick={() => alCambiar(false)}>Cancelar</Boton><Boton variante="tinta" disabled={!nombre.trim() || !alcances.length} onClick={() => void crear()}>Crear</Boton></>}>
      <div className="flex flex-col gap-4">
        <Etiquetado etiqueta="Para qué es">{(id) => <Campo id={id} autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Claude (MCP)" />}</Etiquetado>
        <fieldset>
          <legend className="rotulo text-tinta-2">Permisos</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(ALCANCES) as AlcanceClave[]).map((a) => (
              <label key={a} className={cx('flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[0.8125rem] font-medium transition-[background,box-shadow]', alcances.includes(a) ? 'border-[#1a0f0a] bg-coffee-800 text-cream-50 shadow-[inset_0_1px_3px_rgb(0_0_0/0.35)]' : 'border-cream-400 bg-cream-50 text-coffee-600 shadow-[var(--relieve)]')}>
                <input type="checkbox" className="sr-only" checked={alcances.includes(a)} onChange={(e) => setAlcances(e.target.checked ? [...alcances, a] : alcances.filter((x) => x !== a))} />
                {ALCANCES[a]}
              </label>
            ))}
          </div>
        </fieldset>
        <Etiquetado etiqueta="Caduca">{(id) => <Selector id={id} value={dias} onChange={(e) => setDias(e.target.value)}><option value="">Nunca</option><option value="30">En 30 días</option><option value="90">En 90 días</option><option value="365">En un año</option></Selector>}</Etiquetado>
      </div>
    </Dialogo>
  );
}

function Proveedor({ p, guardada }: { p: (typeof PROVEEDORES)[number]; guardada?: Ajustes['claves'][number] }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  async function guardar() {
    try { qc.setQueryData(['ajustes'], await api().ajustes.guardarClave(p.id, valor.trim())); avisar(`Clave de ${p.nombre} guardada.`, { tono: 'exito' }); setEditando(false); setValor(''); }
    catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo guardar.', { tono: 'error' }); }
  }
  async function quitar() {
    try { qc.setQueryData(['ajustes'], await api().ajustes.borrarClave(p.id)); avisar(`Clave de ${p.nombre} quitada.`); } catch { avisar('No se pudo quitar.', { tono: 'error' }); }
  }
  return (
    <li className={cx('rounded-xl border p-4 transition-shadow', guardada ? 'border-cream-500 bg-cream-50 shadow-[var(--relieve-alto)]' : 'border-cream-300 bg-cream-100/70 shadow-[var(--hundido)]')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1"><p className="text-[0.875rem] font-semibold">{p.nombre}</p><p className="text-[0.75rem] text-coffee-500">{p.uso}</p></div>
        {guardada ? <span className="dato rounded-md bg-amarillo px-1.5 py-0.5 text-coffee-800 shadow-[var(--relieve)]">•••• {guardada.final}</span> : null}
      </div>
      {editando ? (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (valor.trim()) void guardar(); }}>
          <Campo autoFocus type="password" autoComplete="off" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Pega la clave" aria-label={`Clave de ${p.nombre}`} className="flex-1" />
          <Boton type="submit" variante="tinta" disabled={!valor.trim()}>Guardar</Boton>
        </form>
      ) : (
        <div className="mt-3 flex gap-1">
          <Boton variante="linea" tam="p" onClick={() => setEditando(true)}>{guardada ? 'Cambiar' : 'Añadir clave'}</Boton>
          {guardada ? <Boton variante="fantasma" tam="p" onClick={() => void quitar()}>Quitar</Boton> : null}
        </div>
      )}
    </li>
  );
}
