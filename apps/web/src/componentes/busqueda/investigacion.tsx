/**
 * Investigar, en directo. Mientras trabaja se ven el plan (qué obras intervienen,
 * con qué papel, y qué subpreguntas y pruebas hacen falta), cada paso con su
 * herramienta y lo que devolvió, y las pruebas según llegan, con su recorte de
 * página o de fotograma. Luego la respuesta se escribe con sus marcas, y al
 * final la sustituye la definitiva, con la verificación de cada frase, lo que
 * costó y el cuaderno donde quedó todo.
 *
 * Cada marca y cada prueba abren el lector en su sitio exacto: la página con los
 * caracteres subrayados o la región rodeada, o el vídeo en su fotograma.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ubicarPasajeEnUnidad } from '@scholaris/nucleo';
import type { EvidenciaInvestigacion, FraseVerificada, FuenteInvestigacion, PasoInvestigacion, PlanInvestigacion } from '@scholaris/contrato';
import { avisar, BarraAvance, Boton, Composicion, cx, Folio, Icono, Rotulo, type NombreIcono } from '@scholaris/ui';
import { busquedaDePrueba } from '../../lib/anclas';
import { etiquetaCorta } from '../../lib/formato';
import { textoLimpio } from '../../lib/texto';
import { numero } from '../../lib/numero';
import { analizarMarkdown, separarPruebas } from '../../lib/markdown-respuesta';
import {
  costeLegible, duracionLegible, etiquetaHerramienta, fraseDudosa, numeroDeMarca, pruebasCitadas, pruebasSinCitar, respuestaParaCopiar, resumirEntrada, VEREDICTO,
  type EstadoInvestigacion,
} from '../../lib/investigacion';
import { precargarLector } from '../../datos/consultas';
import { useInvestigacion } from '../../datos/investigacion';
import { mapaDeTexto, rango, registro } from '../lector/subrayado';
import { RecuadroMano } from '../comunes/recuadro-mano';
import { MarkdownRespuesta, type PintarCita } from './markdown-respuesta';

const ICONO_HERRAMIENTA: Record<string, NombreIcono> = {
  buscar: 'buscar', leer: 'lector', mapa: 'indice', entidad: 'explorar', citas: 'citar', relaciones: 'enlace',
  alinear: 'pila', ver: 'ojo', escuchar: 'audio', recordar: 'historial', anotar: 'escribir',
};
const ICONO_MODO: Record<EvidenciaInvestigacion['modo'], NombreIcono> = { texto: 'documento', imagen: 'imagen', video: 'video', audio: 'audio', dato: 'hoja' };
const NOMBRE_MODO: Record<EvidenciaInvestigacion['modo'], string> = { texto: 'Texto', imagen: 'Imagen', video: 'Vídeo', audio: 'Audio', dato: 'Dato' };
const NOMBRE_CAPA: Record<EvidenciaInvestigacion['capa'], string> = { literal: 'literal', comprension: 'comprensión', percepcion: 'percepción', memoria: 'memoria' };
/** Lo citado entre comillas latinas; las comillas de dentro pasan a inglesas (RAE: « “ ” »). */
const entreComillas = (t: string) => `«${t.replace(/«/g, '“').replace(/»/g, '”')}»`;
/** El texto de una prueba para la tarjeta: limpio de marcado (también las cursivas con guiones bajos). */
const textoPrueba = (t: string) => textoLimpio(t).replace(/(^|[\s(«“"'¡¿—-])_([^_\n]+)_(?=[\s.,;:)»”"'!?—-]|$)/g, '$1$2');

const NOMBRE_PRUEBA: Record<PlanInvestigacion['subpreguntas'][number]['pruebas'][number], string> = {
  literal: 'cita literal', visual: 'imagen', sonora: 'sonido', estructural: 'estructura', comparativa: 'comparación',
};

/** El reloj de la investigación, en segundos, mientras corre. */
function useAhora(activo: boolean): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!activo) return;
    const h = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(h);
  }, [activo]);
  return ahora;
}

export function Investigacion({ clave, alRepetir }: { clave: string; alRepetir: () => void }) {
  const e = useInvestigacion(clave);
  if (!e) return null;
  return <Vista e={e} alRepetir={alRepetir} />;
}

function Vista({ e, alRepetir }: { e: EstadoInvestigacion; alRepetir: () => void }) {
  const hecho = e.fase === 'hecho';
  const trabajando = !hecho && e.fase !== 'error';
  const enVivo = e.fase === 'empezando' || e.fase === 'planificando' || e.fase === 'investigando';
  const ahora = useAhora(trabajando);
  const [resaltada, setResaltada] = useState<string | null>(null);

  const citadas = useMemo(() => pruebasCitadas(e), [e.fin, e.marcas, e.pruebas]); // eslint-disable-line react-hooks/exhaustive-deps
  const sinCitar = useMemo(() => pruebasSinCitar(e), [e.fin, e.pruebas]); // eslint-disable-line react-hooks/exhaustive-deps
  const titulos = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of e.plan?.documentos ?? []) m.set(d.id, d.titulo);
    for (const p of e.pruebas) if (!m.has(p.documento)) m.set(p.documento, p.titulo);
    return m;
  }, [e.plan, e.pruebas]);

  const markdown = e.fin?.markdown ?? e.texto;
  const { cuerpo } = useMemo(() => separarPruebas(analizarMarkdown(markdown)), [markdown]);

  const cita = useCallback<PintarCita>((ids, k) => ids.map((id) => <ChipPrueba key={`${k}-${id}`} id={id} ev={citadas.get(id)} activa={!!resaltada && citadas.get(id)?.id === resaltada} alResaltar={setResaltada} />), [citadas, resaltada]);

  const respuesta = useRef<HTMLDivElement>(null);
  const dudosas = useMemo(() => (e.verificacion?.frases ?? []).filter(fraseDudosa), [e.verificacion]);
  useFrasesMarcadas(respuesta, hecho ? dudosas : [], cuerpo);

  async function copiar() {
    const { texto, html } = respuestaParaCopiar(markdown, citadas);
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([texto], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
      } else await navigator.clipboard.writeText(texto);
      avisar('Respuesta copiada con sus citas.', { tono: 'exito' });
    } catch {
      try { await navigator.clipboard.writeText(texto); avisar('Respuesta copiada con sus citas.', { tono: 'exito' }); }
      catch { avisar('El navegador no dejó copiar.', { tono: 'error' }); }
    }
  }

  const pruebasVisibles = e.fin ? e.fin.evidencias : e.pruebas;

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <section aria-label="Investigación" className="relative self-start overflow-hidden rounded-2xl border border-cream-400 bg-cream-50 p-5 shadow-[var(--levantado)] sm:p-6">
        {/* Mientras investiga, la composición gira despacio sobre su centro. */}
        <Composicion estilo="kandinsky" semilla={2} className={cx('pointer-events-none absolute -right-6 -top-4 h-24 w-36 opacity-90', trabajando && 'compo-pensando')} />
        <p className="rotulo relative text-coffee-400">Investigación</p>
        <h2 className="relative mt-1 max-w-[85%] text-[1.25rem] font-semibold leading-snug text-coffee-800">{e.pregunta}</h2>

        {trabajando ? <Estado e={e} ahora={ahora} /> : null}
        {e.fase === 'error' ? (
          <div role="alert" className="relative mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-rojo/30 bg-rojo-suave/50 px-4 py-3 text-[0.875rem] text-coffee-800">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 bg-rojo" />
            <span className="min-w-0 flex-1">{e.error}</span>
            <Boton variante="linea" tam="p" icono="rayo" className="bg-papel" onClick={alRepetir}>Volver a investigar</Boton>
          </div>
        ) : null}

        {enVivo && e.plan ? <Plan plan={e.plan} /> : null}
        {enVivo && e.pasos.length ? <Pasos pasos={e.pasos} titulos={titulos} vivo /> : null}

        {markdown ? (
          <div className="relative mt-6">
            {/* La respuesta se anuncia entera al terminar (aria-busy mientras se escribe). */}
            <div ref={respuesta} aria-live="polite" aria-busy={!hecho} className="lectura text-[1.0625rem] leading-[1.65] text-coffee-900">
              <MarkdownRespuesta bloques={cuerpo} cita={cita} final={e.fase === 'escribiendo' ? <span className="gota-tinta" aria-hidden /> : null} />
            </div>
            {e.fase === 'escribiendo' ? <p className="mt-3 flex items-center gap-2 text-[0.8125rem] text-apagado"><span className="h-1.5 w-1.5 rounded-full bg-azul anim-pulso" />Escribiendo; al terminar, cada frase se comprueba contra sus pruebas.</p> : null}
          </div>
        ) : null}

        {hecho && e.fin ? <Pie e={e} alCopiar={() => void copiar()} alRepetir={alRepetir} /> : null}
        {hecho && e.verificacion ? <Verificacion frases={e.verificacion.frases} /> : null}

        {!enVivo && (e.plan || e.pasos.length) ? (
          <div className="relative mt-5 flex flex-col gap-1 border-t border-cream-200 pt-3">
            {e.plan ? <Plegable titulo="El plan de la investigación"><Plan plan={e.plan} sinRotulo /></Plegable> : null}
            {e.pasos.length ? (
              <Plegable titulo={`Cómo se investigó: ${e.pasos.length} ${e.pasos.length === 1 ? 'paso' : 'pasos'}${e.fin ? `, ${duracionLegible(e.fin.coste.ms || e.fin.ms)}` : ''}`}>
                <Pasos pasos={e.pasos} titulos={titulos} />
              </Plegable>
            ) : null}
          </div>
        ) : null}
      </section>

      <aside aria-label="Pruebas" className="flex flex-col gap-8">
        <div>
          <div className="flex items-baseline gap-2">
            <Rotulo>{e.fin ? 'Pruebas citadas' : 'Pruebas'}</Rotulo>
            <span className="dato text-apagado">{pruebasVisibles.length || ''}</span>
          </div>
          {pruebasVisibles.length ? (
            <ol className="mt-3 flex flex-col gap-3">
              {pruebasVisibles.map((p, i) => (
                <TarjetaPrueba key={`${e.fin ? 'f' : 'v'}-${p.id}`} ev={p} final={!!e.fin} indice={i} activa={resaltada === p.id} alResaltar={setResaltada} />
              ))}
            </ol>
          ) : trabajando ? (
            <ol className="mt-3 flex flex-col gap-3" aria-hidden>{[0, 1, 2].map((i) => <li key={i} className="esqueleto h-28 rounded-xl" />)}</ol>
          ) : <p className="mt-3 text-[0.875rem] text-apagado">No se reunió ninguna prueba.</p>}
          {sinCitar.length ? (
            <Plegable titulo={`Otras pruebas reunidas: ${sinCitar.length}`} className="mt-4">
              <ol className="flex flex-col gap-3 opacity-80">
                {sinCitar.map((p, i) => <TarjetaPrueba key={`s-${p.id}`} ev={p} final={false} indice={i} activa={false} alResaltar={() => undefined} compacta />)}
              </ol>
            </Plegable>
          ) : null}
        </div>
        {e.fin?.fuentes.length ? <Fuentes fuentes={e.fin.fuentes} /> : null}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado, plan y pasos
// ---------------------------------------------------------------------------

function Estado({ e, ahora }: { e: EstadoInvestigacion; ahora: number }) {
  const fase = e.fase === 'empezando' ? 'Preparando la investigación…'
    : e.fase === 'planificando' ? 'Planificando: qué obras intervienen y qué pruebas hacen falta…'
    : e.fase === 'investigando' ? 'Investigando en tu biblioteca…'
    : 'Escribiendo la respuesta con sus pruebas…';
  const pasos = e.presupuesto?.pasos;
  return (
    <div className="relative mt-5 rounded-xl bg-cream-100/80 px-4 py-3 shadow-[var(--hundido)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-rojo anim-pulso" />
        <p role="status" className="min-w-0 flex-1 text-[0.875rem] font-medium text-coffee-700">{fase}</p>
        <span aria-hidden className="dato text-coffee-500">
          {e.pasos.length ? `${e.pasos.length}${pasos ? ` de ${pasos}` : ''} pasos · ` : ''}{e.pruebas.length} pruebas · {duracionLegible(Math.max(0, ahora - e.empezada))}
        </span>
      </div>
      {pasos && e.fase !== 'escribiendo' ? <BarraAvance valor={Math.min(1, e.pasos.length / pasos)} tono="azul" etiqueta="Pasos usados del presupuesto" className="mt-2.5" /> : null}
    </div>
  );
}

function Plan({ plan, sinRotulo }: { plan: PlanInvestigacion; sinRotulo?: boolean }) {
  return (
    <section aria-label="Plan" className={cx('relative anim-sube', !sinRotulo && 'mt-6')}>
      {!sinRotulo ? <Rotulo>El plan</Rotulo> : null}
      <p className="mt-1.5 max-w-[62ch] text-[0.9375rem] text-tinta-2">{plan.enfoque}</p>
      {plan.documentos.length ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {plan.documentos.map((d) => (
            <li key={d.id} className="flex items-baseline gap-2 text-[0.875rem]">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-rojo" />
              <span className="min-w-0"><Link to="/lector/$id" params={{ id: d.id }} className="italic text-coffee-800 underline-offset-4 hover:underline">{d.titulo}</Link><span className="text-apagado">: {d.papel}</span></span>
            </li>
          ))}
        </ul>
      ) : null}
      {plan.subpreguntas.length ? (
        <ol className="mt-4 flex flex-col gap-2">
          {plan.subpreguntas.map((s, i) => (
            <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-1 text-[0.875rem]">
              <span className="dato pt-0.5 text-coffee-400">{i + 1}</span>
              <div>
                <p className="text-coffee-800">{s.pregunta}</p>
                {s.pruebas.length ? (
                  <p className="mt-1 flex flex-wrap gap-1">
                    <span className="sr-only">Pruebas que hacen falta:</span>
                    {s.pruebas.map((p) => <span key={p} className="rounded-md border border-cream-400 bg-cream-100 px-1.5 py-px text-[0.6875rem] text-coffee-600">{NOMBRE_PRUEBA[p] ?? p}</span>)}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {plan.idiomas.length > 1 ? <p className="mt-3 text-[0.75rem] text-apagado">Busca en {plan.idiomas.length} lenguas.</p> : null}
    </section>
  );
}

const Pasos = memo(function Pasos({ pasos, titulos, vivo }: { pasos: PasoInvestigacion[]; titulos: Map<string, string>; vivo?: boolean }) {
  const t = (id: string) => titulos.get(id);
  return (
    <section aria-label="Pasos de la investigación" className={cx('relative', vivo && 'mt-6')}>
      {vivo ? <Rotulo>Pasos</Rotulo> : null}
      <ol className={cx('flex flex-col', vivo && 'mt-2')}>
        {pasos.map((p) => {
          const entrada = resumirEntrada(p.entrada, t);
          return (
            <li key={p.n} className={cx('grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-x-3 border-b border-cream-200 py-2.5 last:border-b-0', vivo && 'anim-sube')}>
              <span aria-hidden className={cx('grid h-7 w-7 place-items-center rounded-full bg-cream-200 shadow-[var(--hundido)]', p.error ? 'text-rojo' : 'text-coffee-600')}>
                <Icono nombre={ICONO_HERRAMIENTA[p.herramienta] ?? 'chispa'} tam={14} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[0.875rem]">
                  <span className="font-semibold text-coffee-800">{etiquetaHerramienta(p.herramienta)}</span>
                  {entrada ? <span className="text-coffee-500"> {entrada}</span> : null}
                </p>
                {p.error ? <p className="mt-0.5 text-[0.8125rem] text-rojo">{p.error}</p> : p.resumen ? <p className="mt-0.5 text-[0.8125rem] text-tinta-2">{p.resumen}</p> : null}
                {p.evidencias.length ? <p className="mt-1 text-[0.6875rem] font-medium text-azul">{p.evidencias.length === 1 ? 'Una prueba nueva' : `${p.evidencias.length} pruebas nuevas`}</p> : null}
              </div>
              <span className="dato pt-1 text-coffee-400">{p.ms >= 1000 ? `${numero(p.ms / 1000, { maximumFractionDigits: 1 })} s` : `${Math.round(p.ms)} ms`}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
});

// ---------------------------------------------------------------------------
// La respuesta: marcas, verificación y pie
// ---------------------------------------------------------------------------

/** Una marca de la respuesta: el número de la prueba y su folio; abre el lector justo ahí. */
function ChipPrueba({ id, ev, activa, alResaltar }: { id: string; ev?: EvidenciaInvestigacion; activa: boolean; alResaltar: (id: string | null) => void }) {
  const qc = useQueryClient();
  const n = numeroDeMarca(id);
  if (!ev) {
    // Aún no se sabe a qué prueba remite (llega con la respuesta definitiva).
    return <sup data-cita="" className="mx-0.5 font-mono text-[0.7em] text-apagado" title="La prueba se enlaza al terminar">[{n}]</sup>;
  }
  const destino = busquedaDePrueba(ev);
  const precargar = () => { alResaltar(ev.id); void Promise.resolve(precargarLector(qc, ev.documento, destino.u ?? 1, destino.t != null)).catch(() => undefined); };
  return (
    <Link data-cita="" to="/lector/$id" params={{ id: ev.documento }} search={destino}
      onMouseEnter={precargar} onFocus={precargar} onMouseLeave={() => alResaltar(null)} onBlur={() => alResaltar(null)}
      aria-label={`Prueba ${n}: ${ev.titulo}, ${ev.etiqueta}`} title={`${ev.titulo}, ${ev.etiqueta}`}
      className={cx('tactil anim-sello mx-0.5 inline-flex -translate-y-[0.12em] items-baseline gap-1 whitespace-nowrap rounded-md border bg-cream-100 px-1.5 align-baseline font-mono text-[0.68em] text-coffee-700 no-underline shadow-[var(--relieve)] hover:-translate-y-[0.2em] hover:border-cream-500', activa ? 'border-azul' : 'border-cream-400')}>
      <span className="font-bold text-azul">{n}</span>{etiquetaCorta(ev.ancla, ev.etiqueta)}
    </Link>
  );
}

/** Las frases que sus pruebas no sostienen, subrayadas a puntos en la respuesta (CSS Custom Highlight API). */
function useFrasesMarcadas(ref: RefObject<HTMLElement | null>, frases: FraseVerificada[], version: unknown) {
  useEffect(() => {
    const el = ref.current;
    const h = frases.length ? registro('frase-dudosa') : null;
    if (!el || !h) return;
    const mapa = mapaDeTexto(el, (n) => !!n.parentElement?.closest('[data-cita]'));
    const rangos: Range[] = [];
    for (const f of frases) {
      const aguja = f.frase.replace(/\[(?:E\d[^\]]*|sin prueba)\]/g, ' ').replace(/[*_`#>|]/g, ' ').replace(/\s+/g, ' ').trim();
      if (aguja.length < 12) continue;
      const pos = ubicarPasajeEnUnidad(mapa.todo, aguja);
      if (!pos || pos.parte !== 'entero') continue;
      const r = rango(mapa, pos.desde, pos.hasta);
      if (r) { h.add(r); rangos.push(r); }
    }
    return () => { for (const r of rangos) h.delete(r); };
  }, [ref, frases, version]);
}

function Pie({ e, alCopiar, alRepetir }: { e: EstadoInvestigacion; alCopiar: () => void; alRepetir: () => void }) {
  const fin = e.fin!;
  const v = e.verificacion;
  return (
    <div className="relative mt-6 border-t border-cream-200 pt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={cx('rounded-lg px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.04em] shadow-[var(--relieve)]', fin.confianza === 'alta' ? 'bg-amarillo text-coffee-800' : fin.confianza === 'media' ? 'bg-cream-200 text-coffee-700' : 'bg-rojo-suave text-rojo')}>Confianza {fin.confianza}</span>
        {v && v.total ? (
          <span className="flex items-center gap-2 text-[0.8125rem] text-coffee-700">
            <BarraAvance valor={v.respaldadas / v.total} tono={v.respaldadas === v.total ? 'azul' : 'tinta'} etiqueta="Frases respaldadas por sus pruebas" className="w-16" />
            <span className="whitespace-nowrap"><strong className="font-semibold">{v.respaldadas}</strong> de {v.total} {v.total === 1 ? 'frase respaldada' : 'frases respaldadas'}</span>
          </span>
        ) : null}
        <span className="dato text-coffee-500" title={`${fin.coste.modelo} · ${numero(fin.coste.tokensEntrada)} tokens de entrada y ${numero(fin.coste.tokensSalida)} de salida · ${fin.coste.llamadas} llamadas`}>
          {costeLegible(fin.coste.usd)} · {fin.coste.pasos} {fin.coste.pasos === 1 ? 'paso' : 'pasos'} · {duracionLegible(fin.coste.ms || fin.ms)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Boton variante="linea" tam="p" icono="copiar" onClick={alCopiar}>Copiar con citas</Boton>
        {fin.cuaderno ? (
          <Boton variante="linea" tam="p" comoHijo>
            <Link to="/escribir/cuadernos" search={{ c: fin.cuaderno }}><Icono nombre="escribir" tam={15} />Abrir el cuaderno</Link>
          </Boton>
        ) : null}
        <Boton variante="fantasma" tam="p" icono="rayo" onClick={alRepetir}>Volver a investigar</Boton>
      </div>
      {fin.avisos.length ? (
        <ul className="mt-3 flex flex-col gap-1">
          {fin.avisos.map((a, i) => <li key={i} className="flex items-start gap-2 text-[0.8125rem] text-coffee-600"><Icono nombre="aviso" tam={14} className="mt-0.5 shrink-0 text-ocre" />{a}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function Verificacion({ frases }: { frases: FraseVerificada[] }) {
  const dudosas = frases.filter(fraseDudosa);
  const parciales = frases.filter((f) => f.veredicto === 'parcial');
  if (!dudosas.length && !parciales.length) return null;
  const lista = [...dudosas, ...parciales];
  return (
    <Plegable titulo={dudosas.length ? `${dudosas.length === 1 ? 'Una frase' : `${dudosas.length} frases`} sin respaldo${parciales.length ? ` y ${parciales.length} en parte` : ''}` : `${parciales.length === 1 ? 'Una frase respaldada' : `${parciales.length} frases respaldadas`} solo en parte`} abierto={dudosas.length > 0} className="relative mt-4">
      <p className="mb-2 text-[0.8125rem] text-apagado">Van subrayadas a puntos en la respuesta. Léelas con cuidado antes de citarlas.</p>
      <ul className="flex flex-col gap-2.5">
        {lista.map((f, i) => (
          <li key={i} className="text-[0.875rem]">
            <p className="lectura text-coffee-800">{entreComillas(textoPrueba(f.frase.replace(/\s*\[(?:E\d[^\]]*|sin prueba)\]/g, '')))}</p>
            <p className={cx('mt-0.5 text-[0.75rem]', fraseDudosa(f) ? 'text-rojo' : 'text-ocre')}>
              {VEREDICTO[f.veredicto]}{f.revisada ? ', comprobado volviendo a mirar' : ''}{f.nota ? `. ${f.nota}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </Plegable>
  );
}

// ---------------------------------------------------------------------------
// Las pruebas
// ---------------------------------------------------------------------------

const TarjetaPrueba = memo(function TarjetaPrueba({ ev, final, indice, activa, alResaltar, compacta }: {
  ev: EvidenciaInvestigacion; final: boolean; indice: number; activa: boolean; alResaltar: (id: string | null) => void; compacta?: boolean;
}) {
  const qc = useQueryClient();
  const destino = busquedaDePrueba(ev);
  const literal = ev.modo === 'texto' || ev.modo === 'audio';
  const region = ev.ancla.region;
  const precargar = () => { alResaltar(ev.id); void Promise.resolve(precargarLector(qc, ev.documento, destino.u ?? 1, destino.t != null)).catch(() => undefined); };
  return (
    <li className="anim-sube" style={{ animationDelay: `calc(${Math.min(indice, 6)} * var(--escalon))` }}>
      <Link to="/lector/$id" params={{ id: ev.documento }} search={destino} onMouseEnter={precargar} onFocus={precargar} onMouseLeave={() => alResaltar(null)} onBlur={() => alResaltar(null)}
        className={cx('levanta group block rounded-xl border bg-cream-50 p-3 shadow-[var(--levantado)]', activa ? 'border-azul' : 'border-cream-400')}>
        <div className="flex items-center gap-2">
          {final ? (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-azul px-1 text-[0.6875rem] font-bold text-cream-50">{numeroDeMarca(ev.id)}</span>
          ) : (
            <span className="dato shrink-0 rounded-md bg-cream-200 px-1.5 py-0.5 text-[0.625rem] text-coffee-500 shadow-[var(--hundido)]">{ev.id}</span>
          )}
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] italic text-coffee-800">{ev.titulo}</span>
          <Folio className="shrink-0">{etiquetaCorta(ev.ancla, ev.etiqueta)}</Folio>
        </div>
        {ev.imagenUrl && !compacta ? (
          // La página o el fotograma entero, con la región rodeada como en el lector.
          <div className="mt-2.5 flex justify-center rounded-lg bg-[rgb(26_15_10/0.88)] p-1.5 shadow-[var(--hundido)]">
            <div className="relative inline-block max-w-full">
              <img src={ev.imagenUrl} alt="" loading="lazy" decoding="async" className="block max-h-44 w-auto max-w-full rounded-[3px] bg-white" />
              {region ? <RecuadroMano region={region} clave={`${ev.documento}|${ev.id}`} etiqueta={`La región de la prueba en ${ev.etiqueta}`} /> : null}
            </div>
          </div>
        ) : null}
        {ev.cita ? (
          literal
            ? <p className={cx('lectura mt-2 text-[0.875rem] leading-snug text-coffee-800', compacta ? 'line-clamp-2' : 'line-clamp-5')}>{entreComillas(textoPrueba(ev.cita))}</p>
            : <p className={cx('mt-2 text-[0.8125rem] leading-snug text-coffee-700', compacta ? 'line-clamp-2' : 'line-clamp-4')}><span className="sr-only">Lo que se ve: </span>{textoPrueba(ev.cita)}</p>
        ) : null}
        {ev.traduccion && !compacta ? <p className="mt-1 line-clamp-3 text-[0.75rem] text-apagado"><span className="sr-only">Traducción: </span>{ev.traduccion}</p> : null}
        {ev.nota && !compacta ? <p className="mt-1.5 text-[0.75rem] text-coffee-600">{ev.nota}</p> : null}
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[0.6875rem] text-coffee-500">
          <Icono nombre={ICONO_MODO[ev.modo] ?? 'documento'} tam={12} className="text-coffee-400" />
          <span>{NOMBRE_MODO[ev.modo] ?? ev.modo}</span>
          <span aria-hidden>·</span><span>capa {NOMBRE_CAPA[ev.capa] ?? ev.capa}</span>
          <span aria-hidden>·</span><span>{etiquetaHerramienta(ev.herramienta)}</span>
        </p>
      </Link>
    </li>
  );
});

function Fuentes({ fuentes }: { fuentes: FuenteInvestigacion[] }) {
  return (
    <section aria-label="Obras citadas">
      <Rotulo>Obras citadas</Rotulo>
      <ul className="mt-3 flex flex-col gap-2">
        {fuentes.map((f) => (
          <li key={f.documento} className="text-[0.8125rem] leading-snug">
            <Link to="/lector/$id" params={{ id: f.documento }} className="group block rounded-lg px-2 py-1.5 hover:bg-cream-200">
              <span className="text-coffee-700">{f.autores || 'Sin autor'}{f.anio ? ` (${f.anio})` : ''}. </span>
              <em className="text-coffee-800 group-hover:underline group-hover:underline-offset-4">{f.titulo}</em>
              <span className="text-apagado">. {f.evidencias.length === 1 ? 'Una prueba' : `${f.evidencias.length} pruebas`}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------

/** Un apartado que se abre y se cierra (el plan, los pasos, las frases dudosas). */
function Plegable({ titulo, children, abierto: inicial = false, className }: { titulo: string; children: ReactNode; abierto?: boolean; className?: string }) {
  const [abierto, setAbierto] = useState(inicial);
  const id = useId();
  return (
    <div className={className}>
      <button type="button" aria-expanded={abierto} aria-controls={id} onClick={() => setAbierto((x) => !x)}
        className="flex w-full items-center gap-2 rounded-lg py-1.5 text-left text-[0.8125rem] font-medium text-coffee-600 hover:text-coffee-800">
        <Icono nombre="abajo" tam={14} className={cx('shrink-0 transition-transform duration-200', !abierto && '-rotate-90')} />
        {titulo}
      </button>
      <div id={id} hidden={!abierto} className="pb-2 pl-6 pt-1">{abierto ? children : null}</div>
    </div>
  );
}
