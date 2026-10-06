/**
 * El reproductor del lector: el escenario (vídeo, o la onda del audio), la
 * línea del tiempo con los turnos y los capítulos, los mandos y la
 * transcripción sincronizada. En escritorio, el escenario a la izquierda
 * (pegado) y la transcripción a la derecha; en el móvil, el escenario arriba,
 * pegado, y la transcripción debajo.
 *
 * El medio lo lleva el motor (uno para toda la aplicación): al salir del
 * lector mientras suena, sigue sonando en el reproductor pequeño.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as PE, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DetalleDocumento } from '@scholaris/contrato';
import { avisar, Boton, cx, Dialogo, Icono, MenuContenido, MenuDisparador, MenuElemento, MenuRaiz, MenuRotulo, Teclas, Consejo } from '@scholaris/ui';
import { api } from '../../datos/api';
import { q } from '../../datos/consultas';
import { autores, tiempoACadena } from '../../lib/formato';
import { BarraSeleccion } from '../lector/seleccion';
import { motor, type FuenteMedio, type Instantanea } from './motor';
import { idYoutubeDeUrl } from './medio-youtube';
import { VELOCIDADES } from './maquina';
import { fotogramaEn, useFotogramas, useMenosMovimiento, useMotor, useRelojDom, useSegundo, useTranscripcion } from './ganchos';
import { aVtt, buscarEnTranscripcion, buscarIndice, parrafoEn, type Transcripcion } from './transcripcion';
import { LineaTiempo, type Capitulo } from './linea';
import { Onda } from './onda';
import { TranscripcionVista, type ManejadorTranscripcion } from './transcripcion-vista';
import { FormaHablante } from './hablantes';
import { IconoR } from './iconos';
import { ATAJOS, useTeclado } from './teclado';
import { enlaceAlMinuto, useSeleccionTranscripcion } from './citar';
import { TiraFotogramas, useEscenas } from '../inspector/fotogramas';

export interface ManejadorMedio { irA: (t: number) => void }

interface Props {
  doc: DetalleDocumento;
  /** Instante pedido por el enlace (?t=). Solo cuenta al abrir. */
  inicial?: number;
  /** Términos de la búsqueda que abrió el documento. */
  resaltar?: string;
  alVer: (orden: number, t: number) => void;
  /** Tramos que faltan por leer (ingesta en curso). */
  pendientes?: number;
}

/** La fuente del motor para un documento: la primera URL de la caché (precargada), las siguientes nuevas. */
function useFuente(doc: DetalleDocumento): FuenteMedio {
  const qc = useQueryClient();
  // YouTube: su reproductor insertado, sin descargar el vídeo; la portada, su miniatura.
  const youtube = doc.mime === 'application/x-youtube' ? idYoutubeDeUrl(doc.metadatos.url) : null;
  return useMemo(() => ({
    ...(youtube ? { youtube } : {}),
    documento: doc.id,
    tipo: doc.tipo === 'video' ? 'video' : 'audio',
    titulo: doc.metadatos.titulo || 'Sin título',
    autores: autores(doc.metadatos),
    ...(doc.portadaUrl ? { portada: doc.portadaUrl } : youtube ? { portada: `https://i.ytimg.com/vi/${youtube}/hqdefault.jpg` } : {}),
    ...(doc.duracion ? { duracion: doc.duracion } : {}),
    url: async (renovar?: boolean) => {
      // La primera vez vale la de la caché (el cargador del lector ya la pidió); al renovar, una nueva.
      if (!renovar) return (await qc.fetchQuery(q.original(doc.id))).url || null;
      const r = await api().documentos.original(doc.id);
      qc.setQueryData(q.original(doc.id).queryKey, r);
      return r.url || null;
    },
  } satisfies FuenteMedio), [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const Reproductor = forwardRef<ManejadorMedio, Props>(function Reproductor({ doc, inicial, resaltar, alVer, pendientes }, ref) {
  const m = motor();
  const inst = useMotor();
  const fuente = useFuente(doc);
  const esVideo = doc.tipo === 'video';
  const { transcripcion: tr, unidades } = useTranscripcion(doc);
  const trRef = useRef<Transcripcion | null>(null);
  trRef.current = tr;
  const fotogramas = useFotogramas(doc);
  // Lo que se ve en cada escena, marcado en la transcripción.
  const escenas = useEscenas(doc.id, doc.tipo === 'video');
  const capitulos = useCapitulos(doc);
  const propio = inst.documento === doc.id;
  const duracion = (propio && inst.duracion) || doc.duracion || 0;

  // Cargar el documento (si ya sonaba, como al volver del reproductor pequeño, no se recarga).
  const instanteInicial = useRef(inicial);
  useEffect(() => { void m.cargar(fuente, { t: instanteInicial.current }); }, [fuente]); // eslint-disable-line react-hooks/exhaustive-deps

  // El escenario acoge el marco del motor.
  const hueco = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const n = hueco.current!;
    m.alojar(n, 'lector');
    return () => m.desalojar(n);
  }, [m]);

  // Subtítulos generados de la transcripción.
  useEffect(() => {
    if (!tr || !propio || !esVideo || !tr.lineas.length) return;
    m.ponerPista(aVtt(tr));
  }, [tr, propio, esVideo, m]);

  useImperativeHandle(ref, () => ({ irA: (t) => { m.irA(t, { sonar: true }); setSeguir(true); } }), [m]);

  // El lector sabe por dónde va (la URL, el folio de la barra).
  const segundo = useSegundo(1);
  useEffect(() => {
    if (!propio || !tr) return;
    const p = tr.parrafos[parrafoEn(tr, segundo)];
    alVer(p?.orden ?? 1, segundo);
  }, [segundo, propio, tr]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seguir la voz, buscar dentro, citar.
  const [seguir, setSeguir] = useState(true);
  const [buscarMovil, setBuscarMovil] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [indiceCoincidencia, setIndiceCoincidencia] = useState(0);
  const coincidencias = useMemo(() => (tr && busqueda.trim().length > 1 ? buscarEnTranscripcion(tr.palabras, busqueda) : []), [tr, busqueda]);
  const marcadas = useMemo(() => {
    if (!tr || !coincidencias.length) return null;
    const a = new Uint8Array(tr.palabras.length);
    for (const c of coincidencias) for (let k = 0; k < c.largo; k++) a[c.desde + k] = 1;
    return a;
  }, [tr, coincidencias]);
  const vista = useRef<ManejadorTranscripcion>(null);
  const irACoincidencia = (i: number) => {
    if (!coincidencias.length) return;
    const k = ((i % coincidencias.length) + coincidencias.length) % coincidencias.length;
    setIndiceCoincidencia(k);
    setSeguir(false);
    requestAnimationFrame(() => vista.current?.verPalabra(coincidencias[k]!.desde));
  };
  useEffect(() => { setIndiceCoincidencia(0); if (coincidencias.length) { setSeguir(false); requestAnimationFrame(() => vista.current?.verPalabra(coincidencias[0]!.desde)); } }, [coincidencias]);

  const columnaEscenario = useRef<HTMLDivElement>(null);
  const columnaTexto = useRef<HTMLDivElement>(null);
  const barraDesktop = useRef<HTMLDivElement>(null);
  const margenSuperior = useCallback(() => {
    const e = columnaEscenario.current?.getBoundingClientRect();
    const t = columnaTexto.current?.getBoundingClientRect();
    const escritorio = window.innerWidth >= 1024;
    const base = escritorio ? 68 + (barraDesktop.current?.getBoundingClientRect().height ?? 0) : 124;
    if (e && t && e.right > t.left + 1 && e.left < t.right - 1) return Math.max(base, e.bottom);
    return base;
  }, []);

  const zonaTexto = useRef<HTMLDivElement>(null);
  const [sel, limpiarSel] = useSeleccionTranscripcion(zonaTexto, tr);

  const pantalla = useRef<HTMLDivElement>(null);
  const [ayuda, setAyuda] = useState(false);
  const abrirAyuda = useCallback(() => setAyuda(true), []);
  useTeclado({ transcripcion: trRef, pantalla, ayuda: abrirAyuda, activo: true });

  const barraBusqueda = (
    <BarraBusqueda valor={busqueda} alCambiar={setBusqueda} total={coincidencias.length} indice={indiceCoincidencia} alIr={irACoincidencia}
      seguir={seguir} alSeguir={() => setSeguir(true)} hayTexto={!!tr?.palabras.length} />
  );

  return (
    <div className="reproductor -mx-5 md:-mx-12 lg:grid lg:grid-cols-[minmax(22rem,1fr)_minmax(0,1.2fr)] 2xl:grid-cols-[minmax(26rem,1fr)_minmax(0,1.15fr)]">
      {/* Escenario y mandos */}
      <div ref={columnaEscenario} className="sticky top-[7.75rem] z-20 border-b border-cream-300 bg-cream-50 px-3 pb-2 pt-2 shadow-[var(--shadow-soft)] sm:px-5 lg:top-[4.25rem] lg:h-[calc(100dvh-4.25rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:border-b-0 lg:border-r lg:bg-cream-100/60 lg:px-8 lg:pb-8 lg:pt-6 lg:shadow-none lg:backdrop-blur-none">
        <div ref={pantalla} className={cx('reproductor-pantalla', inst.pantallaCompleta && propio && 'en-pantalla')}>
          {esVideo ? (
            <EscenarioVideo hueco={hueco} inst={inst} propio={propio} pantalla={pantalla} />
          ) : (
            <EscenarioAudio hueco={hueco} doc={doc} inst={inst} propio={propio} transcripcion={tr} duracion={duracion} />
          )}
          <Controles inst={inst} propio={propio} duracion={duracion} esVideo={esVideo} transcripcion={tr} capitulos={capitulos} fotogramas={fotogramas}
            marca={instanteInicial.current && instanteInicial.current > 0 ? instanteInicial.current : null} pantalla={pantalla} documento={doc.id} alAyuda={abrirAyuda} buscar={buscarMovil} alBuscar={() => setBuscarMovil((x) => !x)} />
        </div>
        <div className="hidden lg:block">
          {tr && tr.hablantes.length ? <Hablantes tr={tr} /> : null}
          {capitulos.length ? <Capitulos capitulos={capitulos} /> : null}
          {esVideo ? <TiraFotogramas documento={doc.id} cargar={propio && inst.estado !== 'vacio' && inst.estado !== 'cargando'} /> : null}
          <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem] text-apagado">
            <Teclas>Espacio</Teclas> reproduce · <Teclas>J</Teclas><Teclas>L</Teclas> 10 s · <Teclas>[</Teclas><Teclas>]</Teclas> velocidad ·
            <button type="button" onClick={abrirAyuda} className="underline decoration-filete-fuerte underline-offset-4 hover:text-coffee-800">todas las teclas</button>
          </p>
        </div>
        {buscarMovil ? <div className="mt-1 lg:hidden">{barraBusqueda}</div> : null}
      </div>

      {/* Transcripción */}
      <div ref={columnaTexto} className="min-w-0 px-5 md:px-12 lg:px-10 xl:px-14">
        <div ref={barraDesktop} className="sticky top-[4.25rem] z-10 -mx-2 hidden bg-cream-100/90 px-2 py-3 backdrop-blur lg:block">{barraBusqueda}</div>
        <div ref={zonaTexto} className="mx-auto max-w-[46rem] pb-24 pt-2" onPointerDown={(e) => { if (e.pointerType === 'mouse' && !(e.target as HTMLElement).closest('button')) setSeguir(false); }}>
          <TranscripcionVista ref={vista} transcripcion={tr} marcadas={marcadas} foco={coincidencias[indiceCoincidencia]?.desde ?? null} resaltar={resaltar}
            margenSuperior={margenSuperior} seguir={seguir} alCambiarSeguir={setSeguir} escenas={escenas} pendientes={pendientes ?? (unidades && doc.estado === 'procesando' ? undefined : 0)} />
        </div>
      </div>

      {!seguir && propio && (inst.estado === 'sonando' || inst.estado === 'esperando') ? (
        <button type="button" onClick={() => setSeguir(true)} className="fixed bottom-[calc(8.5rem+env(safe-area-inset-bottom))] left-1/2 z-30 flex h-10 -translate-x-1/2 items-center gap-2 rounded-full border border-[#1a0f0a] bg-[linear-gradient(180deg,#4a2e1a_0%,#2c1810_100%)] px-4 text-[0.8125rem] font-semibold text-cream-50 shadow-[var(--relieve-oscuro),0_8px_20px_rgb(44_24_16/0.25)] anim-tostada lg:bottom-8 lg:left-[calc(50%+14rem)]">
          <Icono nombre="audio" tam={15} />Volver a la voz
        </button>
      ) : null}

      {sel ? (
        <BarraSeleccion sel={sel} documento={doc.id} meta={doc.metadatos} alCerrar={limpiarSel}
          extra={(clase) => (
            <button type="button" className={clase} onClick={() => { void copiar(enlaceAlMinuto(doc.id, sel.t0), `Enlace al minuto ${tiempoACadena(sel.t0)} copiado.`); limpiarSel(); }}>
              <IconoR nombre="enlace" tam={15} />Enlace
            </button>
          )} />
      ) : null}

      <Dialogo abierto={ayuda} alCambiar={setAyuda} titulo="Teclas del reproductor">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-2.5 text-[0.875rem]">
          {ATAJOS.map(([ts, d]) => (
            <div key={d} className="contents">
              <dt className="flex gap-1">{ts.map((t) => <Teclas key={t}>{t}</Teclas>)}</dt>
              <dd className="text-coffee-700">{d}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[0.8125rem] text-apagado">En el móvil, dos toques a la izquierda o a la derecha del vídeo saltan 10 segundos; deslizar sobre él lo recorre.</p>
      </Dialogo>
    </div>
  );
});

async function copiar(texto: string, aviso: string) {
  try { await navigator.clipboard.writeText(texto); avisar(aviso, { tono: 'exito' }); }
  catch { avisar('El navegador no dejó copiar.', { tono: 'error' }); }
}

/** Capítulos: las secciones del documento con su instante (por el mapa de folios). */
function useCapitulos(doc: DetalleDocumento): Capitulo[] {
  const { data: secciones } = useQuery(q.secciones(doc.id));
  const { data: folios } = useQuery(q.folios(doc.id));
  return useMemo(() => (secciones ?? []).filter((s) => s.nivel <= 2).map((s) => ({ t0: folios?.folios[s.unidadDesde - 1]?.t0 ?? 0, titulo: s.titulo })).filter((c, i, a) => i === 0 || c.t0 > a[i - 1]!.t0), [secciones, folios]);
}

// ---------------------------------------------------------------------------
// Escenarios
// ---------------------------------------------------------------------------

function EscenarioVideo({ hueco, inst, propio, pantalla }: { hueco: React.RefObject<HTMLDivElement | null>; inst: Instantanea; propio: boolean; pantalla: React.RefObject<HTMLDivElement | null> }) {
  const aspecto = (propio && inst.aspecto) || 16 / 9;
  return (
    <div className="escenario relative mx-auto w-full max-w-[calc(var(--alto-escenario)*var(--aspecto))] overflow-hidden rounded-xl bg-coffee-900 shadow-[var(--levantado)] ring-1 ring-[#1a0f0a]/60 [--alto-escenario:27dvh] lg:[--alto-escenario:52dvh]" style={{ aspectRatio: String(aspecto), ['--aspecto' as string]: String(aspecto) }}>
      <div ref={hueco} className="absolute inset-0" />
      {propio && inst.virtual ? <LaminaVirtual /> : null}
      <Superposicion inst={inst} propio={propio} pantalla={pantalla} />
    </div>
  );
}

/** Sin archivo (demostración): una lámina con el cuadrado rojo del vídeo y el reloj. */
function LaminaVirtual() {
  const reloj = useRef<HTMLSpanElement>(null);
  useRelojDom(reloj);
  return (
    <div className="absolute inset-0 grid place-items-center overflow-hidden bg-azul">
      <svg viewBox="0 0 160 90" className="absolute inset-0 h-full w-full" aria-hidden><circle cx="122" cy="70" r="46" fill="var(--s-amarillo)" /><rect x="14" y="16" width="62" height="40" fill="#22160f" /></svg>
      <span ref={reloj} className="relative font-mono text-[2rem] tnum text-cream-50">0:00</span>
    </div>
  );
}

function EscenarioAudio({ hueco, doc, inst, propio, transcripcion, duracion }: { hueco: React.RefObject<HTMLDivElement | null>; doc: DetalleDocumento; inst: Instantanea; propio: boolean; transcripcion: Transcripcion | null; duracion: number }) {
  const { data: original } = useQuery(q.original(doc.id));
  const sonando = propio && (inst.estado === 'sonando');
  return (
    <div className="escenario-audio relative flex items-center gap-4 rounded-2xl border border-cream-400 bg-cream-50 p-3 shadow-[var(--levantado)] sm:p-4">
      <div ref={hueco} className="absolute h-0 w-0 overflow-hidden" />
      <Disco sonando={sonando} duracion={duracion} />
      <Onda documento={doc.id} duracion={duracion} bytes={doc.bytes} url={original?.url || null} transcripcion={transcripcion} className="min-w-0 flex-1" />
      {propio && inst.estado === 'error' ? <TarjetaError inst={inst} compacta /> : null}
    </div>
  );
}

/** Kandinsky en pequeño: círculos concéntricos y una aguja que da la vuelta en lo que dura el audio. */
function Disco({ sonando, duracion }: { sonando: boolean; duracion: number }) {
  const aguja = useRef<SVGLineElement>(null);
  useEffect(() => motor().escucharTiempo((t) => {
    if (aguja.current && duracion) aguja.current.setAttribute('transform', `rotate(${(t / duracion) * 360} 32 32)`);
  }), [duracion]);
  return (
    <button type="button" onClick={() => motor().alternar()} aria-label={sonando ? 'Pausa' : 'Reproducir'} className="relative h-16 w-16 shrink-0 rounded-full transition-transform hover:scale-[1.03] active:scale-[0.98]">
      <svg viewBox="0 0 64 64" className="h-16 w-16" aria-hidden>
        <circle cx="32" cy="32" r="31" fill="var(--s-azul)" />
        <circle cx="32" cy="32" r="22" fill="var(--s-cream-50)" />
        <circle cx="32" cy="32" r="14" fill="var(--s-amarillo)" />
        <line ref={aguja} x1="32" y1="32" x2="32" y2="3" stroke="var(--s-rojo)" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="32" cy="32" r="5" fill="var(--s-coffee-800)" />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-cream-50">
        {sonando ? null : <span className="ml-0.5 grid h-7 w-7 place-items-center rounded-full bg-coffee-800/85"><Icono nombre="play" tam={12} /></span>}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Superposición del vídeo: gestos, botón grande, espera, error, avisos
// ---------------------------------------------------------------------------

function Superposicion({ inst, propio, pantalla }: { inst: Instantanea; propio: boolean; pantalla: React.RefObject<HTMLDivElement | null> }) {
  const m = motor();
  const reducido = useMenosMovimiento();
  const [ondas, setOndas] = useState<Array<{ id: number; lado: 'izq' | 'der'; texto: string }>>([]);
  const toque = useRef<{ t: number; x: number; lado: 'izq' | 'der'; temporizador: number; acumulado: number } | null>(null);
  const deslizar = useRef<{ x0: number; y0: number; t0: number; activo: boolean; id: number } | null>(null);
  const [recorrido, setRecorrido] = useState<string | null>(null);

  const estado = propio ? inst.estado : 'vacio';
  // El botón grande, solo antes de la primera vez o al terminar: en una pausa a mitad no tapa la imagen.
  const quieto = !(propio && inst.quiere) && estado !== 'error' && (!propio || !inst.haSonado || estado === 'terminado');
  const esperando = estado === 'esperando' || estado === 'buscando' || estado === 'cargando';
  const [esperaVisible, setEsperaVisible] = useState(false);
  useEffect(() => {
    if (!esperando) { setEsperaVisible(false); return; }
    const h = setTimeout(() => setEsperaVisible(true), 300);
    return () => clearTimeout(h);
  }, [esperando]);

  const onda = (lado: 'izq' | 'der', texto: string) => {
    const id = Math.random();
    setOndas((o) => [...o.slice(-2), { id, lado, texto }]);
    setTimeout(() => setOndas((o) => o.filter((x) => x.id !== id)), 650);
  };

  const alBajar = (e: PE<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return;
    deslizar.current = { x0: e.clientX, y0: e.clientY, t0: m.tiempo(), activo: false, id: e.pointerId };
  };
  const alMover = (e: PE<HTMLDivElement>) => {
    const d = deslizar.current;
    if (!d || e.pointerType === 'mouse') return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.activo && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.4) { d.activo = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }
    if (d.activo) {
      const ancho = (e.currentTarget as HTMLElement).getBoundingClientRect().width;
      const dur = inst.duracion || 600;
      const t = Math.max(0, Math.min(dur, d.t0 + (dx / ancho) * Math.min(dur, 300)));
      const dif = Math.round(t - d.t0);
      setRecorrido(`${tiempoACadena(t)}  (${dif >= 0 ? '+' : '−'}${Math.abs(dif)} s)`);
    }
  };
  const alSoltar = (e: PE<HTMLDivElement>) => {
    const d = deslizar.current;
    deslizar.current = null;
    if (e.pointerType === 'mouse') {
      if (e.button === 0) m.alternar();
      return;
    }
    if (d?.activo) {
      const ancho = (e.currentTarget as HTMLElement).getBoundingClientRect().width;
      const dur = inst.duracion || 600;
      m.irA(Math.max(0, Math.min(dur, d.t0 + ((e.clientX - d.x0) / ancho) * Math.min(dur, 300))));
      setRecorrido(null);
      return;
    }
    // Toques: uno alterna (tras esperar al segundo); dos o más a un lado saltan 10 s cada uno.
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const lado = e.clientX - r.left < r.width / 2 ? 'izq' : 'der';
    const ahora = performance.now();
    const previo = toque.current;
    if (previo && ahora - previo.t < 320 && previo.lado === lado) {
      clearTimeout(previo.temporizador);
      const acumulado = previo.acumulado + 10;
      m.saltar(lado === 'izq' ? -10 : 10);
      onda(lado, `${lado === 'izq' ? '−' : '+'}${acumulado} s`);
      toque.current = { ...previo, t: ahora, acumulado, temporizador: window.setTimeout(() => { toque.current = null; }, 320) };
      return;
    }
    const temporizador = window.setTimeout(() => { toque.current = null; m.alternar(); }, 260);
    toque.current = { t: ahora, x: e.clientX, lado, temporizador, acumulado: 0 };
  };

  // Aviso breve (OSD): aparece y se va.
  const [osd, setOsd] = useState<string | null>(null);
  useEffect(() => {
    if (!inst.osd || !propio) return;
    setOsd(inst.osd.texto);
    const h = setTimeout(() => setOsd(null), 900);
    return () => clearTimeout(h);
  }, [inst.osd?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="absolute inset-0 select-none" onPointerDown={alBajar} onPointerMove={alMover} onPointerUp={alSoltar} onDoubleClick={(e) => { if ((e.nativeEvent as PointerEvent).pointerType !== 'touch') void m.alternarPantallaCompleta(pantalla.current); }} style={{ touchAction: 'pan-y' }}>
      {quieto ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_center,rgb(26_15_10/0.25),transparent_60%)]">
          <span className="grid h-16 w-16 place-items-center rounded-full border border-[#1a0f0a] bg-[linear-gradient(180deg,#4a2e1a_0%,#2c1810_100%)] text-cream-50 shadow-[var(--relieve-oscuro),0_10px_28px_rgb(0_0_0/0.35)]">
            <Icono nombre="play" tam={24} />
          </span>
        </div>
      ) : null}

      {esperaVisible && estado !== 'error' ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-black/30" role="progressbar" aria-label="Cargando">
          <div className={cx('h-full w-1/3 bg-amarillo', reducido ? 'opacity-80' : 'anim-carga')} />
        </div>
      ) : null}

      {propio && inst.retomado != null && estado !== 'sonando' && estado !== 'error' ? (
        <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-[rgb(26_15_10/0.82)] py-1 pl-3 pr-1 text-[0.8125rem] text-cream-50 shadow-[0_4px_12px_rgb(0_0_0/0.3)]" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <span>Seguías en {tiempoACadena(inst.retomado)}</span>
          <button type="button" onClick={() => motor().desdeElPrincipio()} className="ml-1 rounded-full px-2.5 py-1 font-semibold text-amarillo hover:bg-white/10">Desde el principio</button>
        </div>
      ) : null}

      {ondas.map((o) => (
        <div key={o.id} className={cx('pointer-events-none absolute inset-y-0 grid w-1/2 place-items-center', o.lado === 'izq' ? 'left-0' : 'right-0')}>
          <span className={cx('grid h-20 w-20 place-items-center rounded-full bg-cream-50/20 font-mono text-[0.9375rem] font-semibold text-cream-50 backdrop-blur-sm', !reducido && 'anim-onda')}>{o.texto}</span>
        </div>
      ))}

      {recorrido || osd ? (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-[rgb(26_15_10/0.82)] px-3.5 py-1.5 font-mono text-[0.875rem] font-medium tnum text-cream-50 shadow-[0_4px_12px_rgb(0_0_0/0.3)] anim-aparece">
          {recorrido ?? osd}
        </div>
      ) : null}

      {propio && estado === 'error' ? <TarjetaError inst={inst} /> : null}
    </div>
  );
}

function TarjetaError({ inst, compacta }: { inst: Instantanea; compacta?: boolean }) {
  const formato = inst.tipoError === 'formato';
  return (
    <div className={cx('absolute inset-0 z-10 grid place-items-center p-4', compacta ? 'rounded-2xl bg-cream-50/95' : 'bg-[rgb(26_15_10/0.78)]')} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} role="alert">
      <div className={cx('max-w-sm rounded-2xl border border-cream-400 bg-cream-50 p-4 text-center shadow-[var(--levantado-alto)]', compacta && 'border-0 bg-transparent p-0 shadow-none')}>
        <span className="mx-auto mb-2 block h-3 w-3 bg-rojo" aria-hidden />
        <p className="text-[0.9375rem] font-semibold text-coffee-800">{formato ? 'Este navegador no puede reproducirlo' : 'Se ha cortado la reproducción'}</p>
        <p className="mt-1 text-[0.8125rem] text-coffee-600">{formato ? 'El archivo usa un formato que este navegador no sabe abrir. Prueba en otro navegador o descárgalo.' : (inst.error ?? 'No se pudo cargar el archivo.')}</p>
        {!formato ? <Boton variante="tinta" tam="p" className="mt-3" onClick={() => motor().reintentar()}><IconoR nombre="reintentar" tam={15} />Reintentar</Boton> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mandos
// ---------------------------------------------------------------------------

function BotonMando({ etiqueta, alPulsar, children, activo, deshabilitado, className, oscuro }: { etiqueta: string; alPulsar: () => void; children: ReactNode; activo?: boolean; deshabilitado?: boolean; className?: string; oscuro?: boolean }) {
  return (
    <Consejo texto={etiqueta}>
      <button type="button" onClick={alPulsar} aria-label={etiqueta} aria-pressed={activo} disabled={deshabilitado}
        className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-[background,color,box-shadow,transform] disabled:opacity-40',
          oscuro ? 'text-cream-200 hover:bg-white/10 hover:text-cream-50' : 'text-coffee-500 hover:bg-cream-200 hover:text-coffee-800 active:translate-y-px',
          activo && (oscuro ? 'bg-white/15 text-cream-50' : 'bg-coffee-800 text-cream-50 shadow-[inset_0_1px_3px_rgb(0_0_0/0.35)] hover:bg-coffee-700 hover:text-cream-50'),
          className)}>
        {children}
      </button>
    </Consejo>
  );
}

function Controles({ inst, propio, duracion, esVideo, transcripcion, capitulos, fotogramas, marca, pantalla, documento, alAyuda, buscar, alBuscar }: {
  inst: Instantanea; propio: boolean; duracion: number; esVideo: boolean; transcripcion: Transcripcion | null; capitulos: Capitulo[];
  fotogramas: ReturnType<typeof useFotogramas>; marca: number | null; pantalla: React.RefObject<HTMLDivElement | null>; documento: string; alAyuda: () => void;
  buscar: boolean; alBuscar: () => void;
}) {
  const m = motor();
  const reloj = useRef<HTMLSpanElement>(null);
  useRelojDom(reloj);
  const sonando = propio && inst.quiere && inst.estado !== 'error';
  const oscuro = inst.pantallaCompleta && propio;
  const anuncio = !propio ? '' : inst.estado === 'cargando' ? 'Cargando' : inst.estado === 'esperando' ? 'Esperando datos' : inst.estado === 'error' ? (inst.error ?? 'Error') : inst.estado === 'terminado' ? 'Terminado' : '';
  return (
    <div className={cx('controles mt-2', oscuro && 'controles-oscuros')}>
      <LineaTiempo duracion={duracion} transcripcion={transcripcion} capitulos={capitulos} fotogramas={esVideo ? fotogramas : null} marca={marca} oscura={oscuro} />
      <div className={cx('-mt-2.5 mb-1 flex justify-between font-mono text-[0.75rem] tnum', oscuro ? 'text-cream-200' : 'text-coffee-600')}>
        <span ref={reloj}>0:00</span><span className={oscuro ? 'text-cream-300' : 'text-apagado'}>{tiempoACadena(duracion)}</span>
      </div>
      <div className="flex items-center gap-0.5 sm:gap-1">
        <button type="button" onClick={() => m.alternar()} aria-label={sonando ? 'Pausa' : 'Reproducir'}
          className="mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#1a0f0a] bg-[linear-gradient(180deg,#4a2e1a_0%,#2c1810_100%)] text-cream-50 shadow-[var(--relieve-oscuro)] transition-transform hover:-translate-y-px active:translate-y-px active:shadow-[var(--pulsado)]">
          <Icono nombre={sonando ? 'pausa' : 'play'} tam={17} grosor={2.4} />
        </button>
        <BotonMando etiqueta="10 segundos atrás (J)" alPulsar={() => m.saltar(-10)} oscuro={oscuro}><IconoR nombre="atras" tam={19} /></BotonMando>
        <BotonMando etiqueta="10 segundos adelante (L)" alPulsar={() => m.saltar(10)} oscuro={oscuro}><IconoR nombre="adelante" tam={19} /></BotonMando>
        <QuienHabla transcripcion={transcripcion} oscuro={oscuro} />
        <MenuVelocidad velocidad={inst.velocidad} oscuro={oscuro} />
        {esVideo ? <BotonMando etiqueta={inst.subtitulos ? 'Quitar subtítulos (C)' : 'Subtítulos (C)'} activo={inst.subtitulos} deshabilitado={!inst.hayPista} alPulsar={() => m.alternarSubtitulos()} oscuro={oscuro}><IconoR nombre="subtitulos" tam={19} /></BotonMando> : null}
        <Volumen inst={inst} oscuro={oscuro} />
        {esVideo ? <BotonMando etiqueta={inst.pantallaCompleta ? 'Salir de pantalla completa (F)' : 'Pantalla completa (F)'} alPulsar={() => void m.alternarPantallaCompleta(pantalla.current)} oscuro={oscuro}><IconoR nombre={inst.pantallaCompleta ? 'reducir' : 'ampliar'} tam={18} /></BotonMando> : null}
        <BotonMando etiqueta="Buscar en la transcripción" activo={buscar} alPulsar={alBuscar} className="lg:hidden" oscuro={oscuro}><Icono nombre="buscar" tam={18} /></BotonMando>
        <MenuMas documento={documento} esVideo={esVideo} pip={inst.pip} alAyuda={alAyuda} />
      </div>
      <p className="sr-only" aria-live="polite">{anuncio}</p>
    </div>
  );
}

/** En el hueco central de los mandos: quién habla ahora (cambia solo al cambiar de turno). */
function QuienHabla({ transcripcion: tr, oscuro }: { transcripcion: Transcripcion | null; oscuro: boolean }) {
  const [h, setH] = useState(-1);
  useEffect(() => {
    if (!tr?.turnos.length) return;
    return motor().escucharTiempo((t) => {
      const i = buscarIndice(tr.iniciosTurno, t + 0.25);
      setH(i >= 0 ? tr.turnos[i]!.h : -1);
    });
  }, [tr]);
  return (
    <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-1" aria-hidden>
      {tr && h >= 0 ? (
        <span className="hidden min-w-0 items-center gap-1.5 sm:flex">
          <FormaHablante h={h} tam={8} />
          <span className={cx('truncate text-[0.75rem] font-medium', oscuro ? 'text-cream-100' : 'text-coffee-600')}>{tr.hablantes[h]}</span>
        </span>
      ) : null}
    </span>
  );
}

function MenuVelocidad({ velocidad, oscuro }: { velocidad: number; oscuro: boolean }) {
  return (
    <MenuRaiz>
      <Consejo texto="Velocidad ([ y ])">
        <MenuDisparador asChild>
          <button type="button" aria-label={`Velocidad: ${String(velocidad).replace('.', ',')}×`}
            className={cx('h-8 min-w-[3.25rem] shrink-0 rounded-lg border px-2 font-mono text-[0.75rem] font-medium tnum transition-transform hover:-translate-y-px active:translate-y-px',
              oscuro ? 'border-white/20 bg-white/10 text-cream-50' : 'border-cream-400 bg-cream-50 text-coffee-800 shadow-[var(--relieve)] active:shadow-[var(--pulsado)]',
              velocidad !== 1 && !oscuro && 'border-coffee-500')}>
            {String(velocidad).replace('.', ',')}×
          </button>
        </MenuDisparador>
      </Consejo>
      <MenuContenido alinear="end" lado="top">
        <MenuRotulo>Velocidad (sin cambiar el tono)</MenuRotulo>
        {VELOCIDADES.map((v) => <MenuElemento key={v} icono={v === velocidad ? 'hecho' : undefined} alElegir={() => motor().ponerVelocidad(v)}>{v === 1 ? 'Normal' : `${String(v).replace('.', ',')}×`}</MenuElemento>)}
      </MenuContenido>
    </MenuRaiz>
  );
}

function Volumen({ inst, oscuro }: { inst: Instantanea; oscuro: boolean }) {
  const m = motor();
  const v = inst.silencio ? 0 : inst.volumen;
  return (
    <div className="group/volumen hidden items-center md:flex">
      <BotonMando etiqueta={inst.silencio ? 'Devolver el sonido (M)' : 'Quitar el sonido (M)'} alPulsar={() => m.alternarSilencio()} oscuro={oscuro}>
        <IconoR nombre={v === 0 ? 'silencio' : 'volumen'} tam={19} />
      </BotonMando>
      <input type="range" min={0} max={1} step={0.05} value={v} onChange={(e) => m.ponerVolumen(Number(e.target.value))} aria-label="Volumen" aria-valuetext={`${Math.round(v * 100)} %`}
        className="volumen h-1 w-0 cursor-pointer appearance-none rounded-full opacity-0 transition-[width,opacity] duration-200 group-focus-within/volumen:w-20 group-focus-within/volumen:opacity-100 group-hover/volumen:w-20 group-hover/volumen:opacity-100"
        style={{ background: `linear-gradient(to right, var(--s-coffee-800) ${v * 100}%, var(--s-cream-400) ${v * 100}%)` }} />
    </div>
  );
}

function MenuMas({ documento, esVideo, pip, alAyuda }: { documento: string; esVideo: boolean; pip: boolean; alAyuda: () => void }) {
  const m = motor();
  return (
    <MenuRaiz>
      <MenuDisparador asChild>
        <button type="button" aria-label="Más opciones del reproductor" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-coffee-500 hover:bg-cream-200 hover:text-coffee-800">
          <Icono nombre="opciones" tam={18} />
        </button>
      </MenuDisparador>
      <MenuContenido alinear="end" lado="top">
        {esVideo && m.pipDisponible ? <MenuElemento icono="video" alElegir={() => void m.alternarPip()}>{pip ? 'Salir de imagen dentro de imagen' : 'Imagen dentro de imagen'}</MenuElemento> : null}
        <MenuElemento icono="enlace" alElegir={() => void copiar(enlaceAlMinuto(documento, m.tiempo()), `Enlace al minuto ${tiempoACadena(m.tiempo())} copiado.`)}>Copiar enlace a este minuto</MenuElemento>
        <MenuElemento icono="teclado" alElegir={alAyuda}>Teclas del reproductor</MenuElemento>
      </MenuContenido>
    </MenuRaiz>
  );
}

// ---------------------------------------------------------------------------
// Hablantes, capítulos, búsqueda
// ---------------------------------------------------------------------------

function Hablantes({ tr }: { tr: Transcripcion }) {
  const total = tr.tiempoHablado.reduce((a, b) => a + b, 0) || 1;
  const siguienteTurno = (h: number) => {
    const t = motor().tiempo();
    const turno = tr.turnos.find((x) => x.h === h && x.t0 > t + 0.5) ?? tr.turnos.find((x) => x.h === h);
    if (turno) motor().irA(turno.t0, { sonar: true, osd: tr.hablantes[h] });
  };
  return (
    <section className="mt-6" aria-label="Quién habla">
      <h2 className="rotulo text-apagado">Quién habla</h2>
      <ul className="mt-2 flex flex-col gap-1">
        {tr.hablantes.map((n, h) => (
          <li key={n}>
            <button type="button" onClick={() => siguienteTurno(h)} className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[0.875rem] hover:bg-cream-200" aria-label={`${n}: ir a su siguiente intervención`}>
              <FormaHablante h={h} tam={11} />
              <span className="min-w-0 flex-1 truncate font-medium text-coffee-800">{n}</span>
              <span className="font-mono text-[0.75rem] tnum text-apagado">{Math.round((tr.tiempoHablado[h]! / total) * 100)} %</span>
              <span className="text-[0.75rem] text-apagado opacity-0 transition-opacity group-hover:opacity-100">siguiente</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Capitulos({ capitulos }: { capitulos: Capitulo[] }) {
  return (
    <section className="mt-6" aria-label="Capítulos">
      <h2 className="rotulo text-apagado">Capítulos</h2>
      <ol className="mt-2 flex flex-col">
        {capitulos.map((c) => (
          <li key={`${c.t0}-${c.titulo}`}>
            <button type="button" onClick={() => motor().irA(c.t0, { sonar: true })} className="flex w-full items-baseline gap-3 rounded-lg px-2 py-1.5 text-left text-[0.875rem] text-coffee-700 hover:bg-cream-200">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full border-2 border-azul" aria-hidden />
              <span className="min-w-0 flex-1">{c.titulo}</span>
              <span className="font-mono text-[0.75rem] tnum text-apagado">{tiempoACadena(c.t0)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function BarraBusqueda({ valor, alCambiar, total, indice, alIr, seguir, alSeguir, hayTexto }: { valor: string; alCambiar: (v: string) => void; total: number; indice: number; alIr: (i: number) => void; seguir: boolean; alSeguir: () => void; hayTexto: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <label className="relative flex h-9 min-w-0 flex-1 items-center rounded-xl border border-cream-400 bg-cream-50 shadow-[var(--hundido)] focus-within:border-coffee-500">
        <Icono nombre="buscar" tam={15} className="ml-3 shrink-0 text-apagado" />
        <span className="sr-only">Buscar en la transcripción</span>
        <input type="search" value={valor} disabled={!hayTexto} onChange={(e) => alCambiar(e.target.value)} placeholder="Buscar en la transcripción"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); alIr(e.shiftKey ? indice - 1 : indice + 1); } else if (e.key === 'Escape') alCambiar(''); }}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-[0.875rem] text-coffee-800 outline-none placeholder:text-apagado" />
        {valor.trim().length > 1 ? (
          <span className="mr-1 flex shrink-0 items-center gap-0.5">
            <span className="px-1 font-mono text-[0.75rem] tnum text-apagado" aria-live="polite">{total ? `${indice + 1} de ${total}` : 'Nada'}</span>
            <button type="button" onClick={() => alIr(indice - 1)} disabled={!total} aria-label="Anterior" className="grid h-7 w-7 place-items-center rounded-lg text-coffee-500 hover:bg-cream-200 disabled:opacity-40"><Icono nombre="arriba" tam={14} /></button>
            <button type="button" onClick={() => alIr(indice + 1)} disabled={!total} aria-label="Siguiente" className="grid h-7 w-7 place-items-center rounded-lg text-coffee-500 hover:bg-cream-200 disabled:opacity-40"><Icono nombre="abajo" tam={14} /></button>
          </span>
        ) : null}
      </label>
      <Consejo texto={seguir ? 'La transcripción sigue a la voz' : 'Volver a seguir la voz'}>
        <button type="button" onClick={alSeguir} aria-pressed={seguir} aria-label="Seguir la voz"
          className={cx('flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-[0.8125rem] font-medium',
            seguir ? 'border-[#1a0f0a] bg-coffee-800 text-cream-50 shadow-[inset_0_1px_3px_rgb(0_0_0/0.35)]' : 'border-cream-400 bg-cream-50 text-coffee-600 shadow-[var(--relieve)] hover:text-coffee-800')}>
          <Icono nombre="audio" tam={15} /><span className="hidden sm:inline">Seguir</span>
        </button>
      </Consejo>
    </div>
  );
}
