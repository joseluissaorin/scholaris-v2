import { useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RelacionCita } from '@scholaris/nucleo';
import { ErrorApi, type DetalleAutocita, type PropuestaCita } from '@scholaris/contrato';
import {
  AreaTexto, avisar, Boton, cx, EsqueletoTexto, Folio, Icono, MenuContenido, MenuDisparador, MenuElemento, MenuRaiz, MenuRotulo, Rotulo, Selector, Tarjeta, Teclas,
} from '@scholaris/ui';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { anclaABusqueda } from '../lib/anclas';
import { anclaACita, etiquetaCorta } from '../lib/formato';
import { textoLimpio } from '../lib/texto';
import { preferencia, ponerPreferencia } from '../lib/acciones';

export const Route = createFileRoute('/escribir/')({
  validateSearch: (s: Record<string, unknown>): { a?: string } => ({ a: typeof s.a === 'string' ? s.a : undefined }),
  component: Autocita,
});

const RELACION: Record<RelacionCita, { texto: string; tono: 'bien' | 'medio' | 'mal' }> = {
  APOYO_DIRECTO: { texto: 'Lo respalda', tono: 'bien' },
  APLICACION_DE_MARCO: { texto: 'Aplica su marco', tono: 'bien' },
  CONTEXTO: { texto: 'Da contexto', tono: 'medio' },
  OPINION_REFERIDA: { texto: 'Opinión referida', tono: 'medio' },
  CONTRIBUCION_PROPIA: { texto: 'Es aportación tuya', tono: 'medio' },
  IMPOSIBLE_TEMPORAL: { texto: 'Imposible por fechas', tono: 'mal' },
  CONTRADICCION: { texto: 'Lo contradice', tono: 'mal' },
  AFIRMACION_NEGATIVA: { texto: 'Lo niega', tono: 'mal' },
};

const EJEMPLO = `El castigo moderno ya no se dirige al cuerpo que sufre, sino al alma que se corrige. La disciplina fabrica individuos útiles distribuyéndolos en el espacio y ordenándolos en el tiempo.

El dispositivo panóptico induce en el detenido una conciencia permanente de visibilidad, de modo que el poder funciona solo. Hoy las plataformas reproducen ese efecto sin necesidad de torre.

Lo abyecto no es lo sucio, sino aquello que perturba una identidad y no respeta los límites. En las cartas de Emilia Llanos el duelo se inscribe en la forma más que en el tema.`;

function Autocita() {
  const { a } = Route.useSearch();
  const navegar = useNavigate({ from: '/escribir/' });
  return a ? <Revision id={a} alNuevo={() => void navegar({ search: {} })} /> : <Editor alListo={(id) => void navegar({ search: { a: id } })} />;
}

function Editor({ alListo }: { alListo: (id: string) => void }) {
  const [texto, setTexto] = useState(() => preferencia('borrador-autocita', ''));
  const [estilo, setEstilo] = useState(() => preferencia('estilo', 'apa'));
  const [umbral, setUmbral] = useState(0.7);
  const [enviando, setEnviando] = useState(false);
  const [extrayendo, setExtrayendo] = useState(false);
  /** Fichero original subido para la autocita: su formato se conserva al exportar a DOCX. */
  const [original, setOriginal] = useState<{ clave: string; nombre: string; texto: string } | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const { data: estilos } = useQuery(q.estilos());
  const parrafos = texto.split(/\n\s*\n/).filter((p) => p.trim()).length;

  useEffect(() => { const h = setTimeout(() => ponerPreferencia('borrador-autocita', texto), 400); return () => clearTimeout(h); }, [texto]);

  async function extraer(f: File) {
    setExtrayendo(true);
    try {
      if (/\.pdf$/i.test(f.name)) {
        const r = await api().citas.extraerTexto(f, f.type || 'application/pdf');
        setTexto(r.parrafos.join('\n\n') || r.texto); setOriginal(null);
      } else {
        const mime = f.type || (/\.docx$/i.test(f.name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain');
        const r = await api().citas.subir(f, mime, f.name);
        const t = r.parrafos.join('\n\n') || r.texto;
        setTexto(t); setOriginal({ clave: r.clave, nombre: r.nombre, texto: t });
      }
    } catch { avisar('No se pudo leer ese archivo.', { tono: 'error' }); }
    setExtrayendo(false);
  }

  async function enviar() {
    setEnviando(true);
    try {
      // Si el texto sigue siendo el del DOCX subido, se manda la clave: así la exportación conserva su formato.
      const conOriginal = original && original.texto === texto;
      const r = await api().citas.autocita({ ...(conOriginal ? { subida: original.clave, titulo: original.nombre.replace(/\.[^.]+$/, '') } : { texto, titulo: texto.trim().slice(0, 60) }), estilo, umbral });
      ponerPreferencia('estilo', estilo);
      alListo(r.autocita);
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo empezar.', { tono: 'error' }); setEnviando(false); }
  }

  return (
    <Lienzo>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div>
          <h2 className="text-[1.625rem] tracking-[-0.015em]">Pega tu texto. Cada afirmación recibirá su cita verificada.</h2>
          <p className="mt-2 max-w-2xl text-tinta-2">Buscamos en tu biblioteca el pasaje que respalda cada frase, un juez comprueba que de verdad la respalda y la cita sale con su página impresa o su minuto. Si no hay respaldo, no hay cita.</p>
          <div className="relative mt-6">
            <AreaTexto value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe o pega aquí tu borrador. Separa los párrafos con una línea en blanco." aria-label="Texto a citar" className="lectura min-h-[22rem] resize-y bg-hoja p-5" />
            {extrayendo ? <div className="absolute inset-0 grid place-items-center rounded-s bg-hoja/80"><span className="flex items-center gap-2 text-tinta-2"><span className="h-2 w-2 rounded-full bg-rojo anim-pulso" />Leyendo el archivo…</span></div> : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input ref={archivo} type="file" hidden accept=".docx,.pdf,.txt,.md,.odt,.rtf" onChange={(e) => { const f = e.target.files?.[0]; if (f) void extraer(f); e.target.value = ''; }} />
            <Boton variante="linea" icono="subir" onClick={() => archivo.current?.click()}>Abrir DOCX, PDF o TXT</Boton>
            {!texto ? <Boton variante="fantasma" onClick={() => setTexto(EJEMPLO)}>Probar con un ejemplo</Boton> : <Boton variante="fantasma" onClick={() => { setTexto(''); setOriginal(null); }}>Vaciar</Boton>}
            {original && original.texto === texto ? <span className="flex items-center gap-1.5 text-[0.8125rem] text-tinta-2"><Icono nombre="documento" tam={14} />{original.nombre} · se conserva su formato</span> : null}
            <Rotulo className="ml-auto">{parrafos} párrafos · {texto.trim() ? texto.trim().split(/\s+/).length : 0} palabras</Rotulo>
          </div>
        </div>
        <aside className="flex flex-col gap-6 lg:pt-[4.5rem]">
          <div>
            <label htmlFor="estilo" className="rotulo text-tinta-2">Estilo de cita</label>
            <Selector id="estilo" className="mt-2" value={estilo} onChange={(e) => setEstilo(e.target.value)}>
              {(estilos ?? [{ id: 'apa', titulo: 'APA 7.ª edición' }]).map((e) => <option key={e.id} value={e.id}>{e.titulo}</option>)}
            </Selector>
            <p className="mt-1.5 text-[0.8125rem] text-apagado">Cualquier estilo del repositorio CSL.</p>
          </div>
          <div>
            <label htmlFor="umbral" className="rotulo flex justify-between text-tinta-2"><span>Respaldo mínimo</span><span className="tnum text-tinta">{Math.round(umbral * 100)} %</span></label>
            <input id="umbral" type="range" min={0.5} max={0.95} step={0.05} value={umbral} onChange={(e) => setUmbral(Number(e.target.value))} className="mt-3 w-full accent-[var(--s-rojo)]" />
            <p className="mt-1.5 text-[0.8125rem] text-apagado">Por debajo, la cita no se propone.</p>
          </div>
          <Boton variante="rojo" tam="g" icono="citar" cargando={enviando} disabled={!texto.trim()} onClick={() => void enviar()}>Buscar las citas</Boton>
        </aside>
      </div>
    </Lienzo>
  );
}

function Revision({ id, alNuevo }: { id: string; alNuevo: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['autocita', id],
    queryFn: () => api().citas.detalleAutocita(id),
    refetchInterval: (c) => (!c.state.data || c.state.data.estado === 'en_cola' || c.state.data.estado === 'procesando' ? 900 : false),
  });
  const [activa, setActiva] = useState<string | null>(null);
  const propuestas = data?.propuestas ?? [];
  const actual = propuestas.find((p) => p.id === activa) ?? propuestas[0];
  const aceptadas = propuestas.filter((p) => p.decision === 'aceptada').length;

  async function decidir(ids: string[], decision: 'aceptada' | 'rechazada') {
    qc.setQueryData<DetalleAutocita>(['autocita', id], (d) => d && { ...d, propuestas: d.propuestas.map((p) => (ids.includes(p.id) ? { ...p, decision } : p)) });
    try { await api().citas.decidir(id, { decisiones: ids.map((propuesta) => ({ propuesta, decision })) }); }
    catch { avisar('No se pudo guardar la decisión.', { tono: 'error' }); void qc.invalidateQueries({ queryKey: ['autocita', id] }); }
  }

  const siguiente = (d: 1 | -1) => {
    const i = propuestas.findIndex((p) => p.id === actual?.id);
    const n = propuestas[Math.max(0, Math.min(propuestas.length - 1, i + d))];
    if (n) { setActiva(n.id); document.getElementById(`cita-${n.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  };

  // Teclado: J/K para moverse, A acepta, R rechaza.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
      if (e.key === 'j') siguiente(1);
      else if (e.key === 'k') siguiente(-1);
      else if (e.key === 'a' && actual) { void decidir([actual.id], 'aceptada'); siguiente(1); }
      else if (e.key === 'r' && actual) { void decidir([actual.id], 'rechazada'); siguiente(1); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  async function exportar(formato: 'docx' | 'md' | 'txt' | 'latex') {
    try {
      let blob: Blob;
      try {
        blob = await api().citas.exportarAutocita(id, formato);
      } catch (e) {
        // Sin DOCX original (texto pegado), el DOCX se arma aquí con el Markdown ya citado.
        if (formato !== 'docx' || !(e instanceof ErrorApi) || e.codigo !== 'peticion_invalida') throw e;
        const md = await (await api().citas.exportarAutocita(id, 'md')).text();
        blob = (await import('../lib/docx')).markdownADocx(md);
      }
      if (formato === 'docx' && blob.type.startsWith('text/')) blob = (await import('../lib/docx')).markdownADocx(await blob.text());
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(data?.titulo ?? 'texto citado').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'texto citado'}.${formato === 'latex' ? 'tex' : formato}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo exportar.', { tono: 'error' }); }
  }

  if (!data || data.estado === 'en_cola' || data.estado === 'procesando') {
    return (
      <Lienzo>
        <p className="flex items-center gap-2 text-tinta-2"><span className="h-2 w-2 rounded-full bg-rojo anim-pulso" />Buscando y verificando las citas de cada párrafo…</p>
        <div className="mt-8 flex max-w-3xl flex-col gap-8">{[0, 1, 2].map((i) => <EsqueletoTexto key={i} lineas={4} />)}</div>
      </Lienzo>
    );
  }
  if (data.estado === 'error') return <Lienzo><p className="text-rojo">{data.error ?? 'La autocita falló.'}</p><Boton className="mt-4" variante="linea" onClick={alNuevo}>Volver</Boton></Lienzo>;

  return (
    <Lienzo>
      <div className="sticky top-[6.5rem] z-10 -mx-5 mb-6 flex flex-wrap items-center gap-2 border-b border-filete bg-papel/95 px-5 py-3 backdrop-blur md:top-12 md:-mx-12 md:px-12">
        <p className="text-[0.9375rem]"><span className="tnum">{propuestas.length}</span> citas propuestas · <span className="tnum">{aceptadas}</span> aceptadas</p>
        <Rotulo className="hidden md:inline">{data.estilo}</Rotulo>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Boton variante="fantasma" tam="p" icono="hecho" onClick={() => void decidir(propuestas.filter((p) => !p.decision && p.cita.respaldo >= 0.85).map((p) => p.id), 'aceptada')}>Aceptar las de respaldo ≥ 85 %</Boton>
          <MenuRaiz>
            <MenuDisparador asChild><Boton variante="tinta" tam="p" icono="descargar">Exportar</Boton></MenuDisparador>
            <MenuContenido>
              <MenuRotulo>Con las citas aceptadas</MenuRotulo>
              <MenuElemento icono="documento" alElegir={() => void exportar('docx')}>Word (DOCX)</MenuElemento>
              <MenuElemento icono="documento" alElegir={() => void exportar('md')}>Markdown</MenuElemento>
              <MenuElemento icono="documento" alElegir={() => void exportar('latex')}>LaTeX</MenuElemento>
              <MenuElemento icono="documento" alElegir={() => void exportar('txt')}>Texto plano</MenuElemento>
            </MenuContenido>
          </MenuRaiz>
          <Boton variante="linea" tam="p" icono="mas" onClick={alNuevo}>Otro texto</Boton>
        </div>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <article className="lectura max-w-[44rem] text-[1.125rem] leading-[1.75]">
          {data.parrafos.map((p, i) => <ParrafoCitado key={i} texto={p} propuestas={propuestas.filter((x) => x.parrafo === i)} activa={actual?.id} alElegir={setActiva} />)}
          {aceptadas ? (
            <section className="mt-12 border-t border-tinta pt-4">
              <Rotulo>Bibliografía</Rotulo>
              <ul className="mt-3 flex flex-col gap-2 text-[0.9375rem]">{data.bibliografia.map((b) => <li key={b} className="pl-6 -indent-6">{b}</li>)}</ul>
            </section>
          ) : null}
        </article>
        <aside className="lg:sticky lg:top-[11rem] lg:self-start">
          {actual ? <Propuesta p={actual} alDecidir={(d) => { void decidir([actual.id], d); siguiente(1); }} /> : <p className="text-apagado">Ninguna afirmación del texto tiene respaldo suficiente en tu biblioteca.</p>}
          <p className="mt-4 hidden text-[0.8125rem] text-apagado lg:block"><Teclas>J</Teclas> <Teclas>K</Teclas> moverse · <Teclas>A</Teclas> aceptar · <Teclas>R</Teclas> rechazar</p>
        </aside>
      </div>
    </Lienzo>
  );
}

/** Un párrafo con sus citas en el sitio: aceptadas en tinta, propuestas en lápiz, rechazadas fuera. */
function ParrafoCitado({ texto, propuestas, activa, alElegir }: { texto: string; propuestas: PropuestaCita[]; activa?: string; alElegir: (id: string) => void }) {
  const trozos = useMemo(() => {
    const orden = [...propuestas].sort((a, b) => a.hasta - b.hasta);
    const out: Array<{ t: string; p?: PropuestaCita }> = [];
    let i = 0;
    // La cita va antes del punto que cierra la afirmación, como se imprime.
    for (const p of orden) {
      let corte = Math.min(p.hasta, texto.length);
      while (corte > i && /[\s]/.test(texto[corte - 1]!)) corte--;
      if (corte > i && /[.;:]/.test(texto[corte - 1]!)) corte--;
      out.push({ t: texto.slice(i, corte) }, { t: '', p });
      i = corte;
    }
    out.push({ t: texto.slice(i) });
    return out;
  }, [texto, propuestas]);
  return (
    <p className="mb-6">
      {trozos.map((x, k) => x.p ? (
        <button key={k} id={`cita-${x.p.id}`} type="button" onClick={() => alElegir(x.p!.id)} aria-pressed={activa === x.p.id}
          className={cx('mx-1 inline rounded-[3px] px-1.5 py-0.5 align-baseline font-mono text-[0.72em] transition-colors',
            x.p.decision === 'aceptada' ? 'bg-tinta text-sobre-tinta' : x.p.decision === 'rechazada' ? 'text-apagado line-through decoration-rojo' : 'border border-dashed border-tinta-2 bg-amarillo-suave text-tinta',
            activa === x.p.id && 'ring-2 ring-rojo ring-offset-2 ring-offset-papel')}>
          {x.p.textoCita}
        </button>
      ) : <span key={k}>{x.t}</span>)}
    </p>
  );
}

function Pasaje({ texto }: { texto: string }) {
  const [entero, setEntero] = useState(false);
  const largo = texto.length > 420;
  return (
    <div className="mt-4">
      <blockquote className={cx('border-l-[3px] border-rojo pl-3 text-[0.9375rem] leading-relaxed', largo && !entero && 'line-clamp-[8]')}>{texto}</blockquote>
      {largo ? <button type="button" onClick={() => setEntero(!entero)} className="mt-1 pl-3 text-[0.8125rem] text-tinta-2 underline underline-offset-4">{entero ? 'Ver menos' : 'Ver el pasaje entero'}</button> : null}
    </div>
  );
}

function Propuesta({ p, alDecidir }: { p: PropuestaCita; alDecidir: (d: 'aceptada' | 'rechazada') => void }) {
  const r = RELACION[p.cita.relacion];
  const { data: doc } = useQuery(q.documento(p.cita.documento));
  return (
    <Tarjeta className="overflow-hidden">
      <div className="border-b border-filete p-4">
        <Rotulo>Afirmación</Rotulo>
        <p className="mt-1 italic">«{p.afirmacion}»</p>
      </div>
      <div className="p-4">
        <div className="flex items-center gap-2">
          <span className={cx('rotulo rounded-full px-2 py-1', r.tono === 'bien' ? 'bg-amarillo text-tinta' : r.tono === 'medio' ? 'bg-hondo text-tinta' : 'bg-rojo text-[#fbf5ec]')}>{r.texto}</span>
          <span className="tnum ml-auto font-mono text-[0.8125rem]">{Math.round(p.cita.respaldo * 100)} %</span>
        </div>
        <div className="mt-2 h-[3px] bg-hondo"><div className="h-full bg-tinta" style={{ width: `${p.cita.respaldo * 100}%` }} /></div>
        <Pasaje texto={textoLimpio(p.cita.pasaje)} />
        <div className="mt-3 flex items-center gap-2 text-[0.8125rem] text-tinta-2">
          <Folio className="shrink-0">{etiquetaCorta(p.cita.ancla, anclaACita(p.cita.ancla, p.cita.anclaFin))}</Folio>
          <span className="min-w-0 flex-1 truncate italic">{doc?.metadatos.titulo ?? '…'}</span>
          <Link to="/lector/$id" params={{ id: p.cita.documento }} search={anclaABusqueda(p.cita.ancla)} className="shrink-0 underline underline-offset-4">Ver en el libro</Link>
        </div>
        <p className="mt-3 font-mono text-[0.8125rem]">{p.textoCita}</p>
      </div>
      <div className="flex gap-2 border-t border-filete p-3">
        <Boton variante={p.decision === 'aceptada' ? 'tinta' : 'linea'} className="flex-1" icono="hecho" onClick={() => alDecidir('aceptada')}>Aceptar</Boton>
        <Boton variante={p.decision === 'rechazada' ? 'rojo' : 'fantasma'} className="flex-1" icono="cerrar" onClick={() => alDecidir('rechazada')}>Rechazar</Boton>
      </div>
      {p.alternativas?.length ? (
        <details className="border-t border-filete px-4 py-3 text-[0.875rem]">
          <summary className="cursor-pointer text-tinta-2">{p.alternativas.length} pasajes alternativos</summary>
          <ul className="mt-2 flex flex-col gap-2">{p.alternativas.map((x) => <li key={x.fragmento} className="flex gap-2"><Folio className="shrink-0">{etiquetaCorta(x.ancla, anclaACita(x.ancla))}</Folio><span className="line-clamp-2 text-tinta-2">{textoLimpio(x.pasaje)}</span></li>)}</ul>
        </details>
      ) : null}
    </Tarjeta>
  );
}

