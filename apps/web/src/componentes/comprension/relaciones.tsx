/**
 * Las relaciones entre obras, a mano: el estado de su alineación (con su avance,
 * «Alineando 3 de 9 grupos», o el error con «Volver a alinear»), confirmarlas,
 * rechazarlas (la detección no las vuelve a proponer), ponerlas a mano y pedir
 * que se busquen en toda la biblioteca.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RelacionVista } from '@scholaris/contrato';
import type { TipoRelacion } from '@scholaris/nucleo';
import { AreaTexto, avisar, BarraAvance, Boton, cx, Dialogo, Etiquetado, Icono, Selector } from '@scholaris/ui';
import { alinear, confirmarRelacion, crearRelacion, detectarEnBiblioteca, rechazarRelacion } from '../../datos/comprension';
import { q } from '../../datos/consultas';
import { NOMBRE_RELACION, pedidoRelacion, textoAlineacion, TIPOS_RELACION_MANUAL, verboRelacion } from '../../lib/comprension';
import { costeLegible } from '../../lib/investigacion';

const mensaje = (e: unknown, defecto: string) => (e instanceof Error && e.message ? e.message : defecto);

/** En qué va la alineación de una relación: el avance, el error con «Volver a alinear», o nada si está hecha. */
export function EstadoAlineacion({ r, documento, className }: { r: RelacionVista; documento: string; className?: string }) {
  const qcl = useQueryClient();
  const [pidiendo, setPidiendo] = useState(false);
  const t = textoAlineacion(r.estadoAlineacion);
  if (!t || t.tono === 'hecho') {
    return r.estadoAlineacion?.avisos.length ? (
      <ul className={cx('flex flex-col gap-1', className)} aria-label="Avisos de la alineación">
        {r.estadoAlineacion.avisos.slice(0, 4).map((a, i) => <li key={i} className="flex items-start gap-2 text-[0.75rem] text-coffee-600"><Icono nombre="aviso" tam={13} className="mt-0.5 shrink-0 text-ocre" />{a}</li>)}
      </ul>
    ) : null;
  }
  const realinear = async () => {
    setPidiendo(true);
    try { await alinear(qcl, documento, r.id, true); avisar('Se vuelven a alinear las dos obras.', { tono: 'exito' }); }
    catch (e) { avisar(mensaje(e, 'No se pudo pedir la alineación.'), { tono: 'error' }); }
    finally { setPidiendo(false); }
  };
  if (t.tono === 'error') {
    return (
      <div role="alert" className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-rojo/30 bg-rojo-suave/50 px-3 py-2 text-[0.8125rem] text-coffee-800', className)}>
        <span aria-hidden className="h-2 w-2 shrink-0 bg-rojo" />
        <span className="min-w-0 flex-1">La alineación se detuvo. {t.texto}</span>
        <Boton variante="linea" tam="p" icono="rayo" className="bg-papel" cargando={pidiendo} onClick={() => void realinear()}>Volver a alinear</Boton>
      </div>
    );
  }
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <p role="status" className="flex items-center gap-2 text-[0.8125rem] text-coffee-700">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-rojo anim-pulso" />{t.texto}
        {r.estadoAlineacion?.usd ? <span className="dato text-apagado">· {costeLegible(r.estadoAlineacion.usd)}</span> : null}
      </p>
      <BarraAvance {...(t.valor != null ? { valor: t.valor } : {})} tono="azul" etiqueta="Avance de la alineación" />
    </div>
  );
}

/** Confirmar, volver a alinear y rechazar (con confirmación: la detección no la vuelve a proponer). */
export function AccionesRelacion({ r, documento, alRechazar, className }: { r: RelacionVista; documento: string; alRechazar?: () => void; className?: string }) {
  const qcl = useQueryClient();
  const [ocupado, setOcupado] = useState<'confirmar' | 'alinear' | 'rechazar' | null>(null);
  const [rechazo, setRechazo] = useState(false);
  const hacer = async (que: 'confirmar' | 'alinear' | 'rechazar') => {
    setOcupado(que);
    try {
      if (que === 'confirmar') { await confirmarRelacion(qcl, r.id); avisar('Relación confirmada: la detección ya no la cambia.', { tono: 'exito' }); }
      else if (que === 'alinear') { await alinear(qcl, documento, r.id, true); avisar('Se vuelven a alinear las dos obras.', { tono: 'exito' }); }
      else { setRechazo(false); await rechazarRelacion(qcl, r.id); avisar('Relación rechazada: no se volverá a proponer.', { tono: 'exito' }); alRechazar?.(); }
    } catch (e) { avisar(mensaje(e, 'No se pudo.'), { tono: 'error' }); }
    finally { setOcupado(null); }
  };
  const enMarcha = r.estadoAlineacion?.estado === 'en_marcha';
  return (
    <div className={cx('flex flex-wrap items-center gap-1.5', className)}>
      {!r.confirmada ? <Boton variante="fantasma" tam="p" icono="hecho" cargando={ocupado === 'confirmar'} onClick={() => void hacer('confirmar')}>Confirmar</Boton> : null}
      {r.estadoAlineacion?.estado !== 'error' ? <Boton variante="fantasma" tam="p" icono="rayo" cargando={ocupado === 'alinear'} disabled={enMarcha} onClick={() => void hacer('alinear')} title={enMarcha ? 'Ya se está alineando' : 'Vuelve a calcular las correspondencias (gasta modelo)'}>Volver a alinear</Boton> : null}
      <Boton variante="fantasma" tam="p" icono="papelera" cargando={ocupado === 'rechazar'} onClick={() => setRechazo(true)}>No es una relación</Boton>
      <Dialogo abierto={rechazo} alCambiar={setRechazo} titulo="¿Rechazar esta relación?"
        pie={<><Boton variante="linea" onClick={() => setRechazo(false)}>Cancelar</Boton><Boton variante="rojo" icono="papelera" onClick={() => void hacer('rechazar')}>Rechazar</Boton></>}>
        <p className="text-[0.9375rem] text-coffee-700">
          Se borran la relación con <em>{r.otro.titulo}</em>, su ficha y sus {r.alineaciones} {r.alineaciones === 1 ? 'correspondencia' : 'correspondencias'}. La detección no la volverá a proponer; si te equivocas, puedes ponerla a mano.
        </p>
      </Dialogo>
    </div>
  );
}

/** Poner a mano una relación de esta obra con otra de la biblioteca (y alinearlas, si se quiere). */
export function NuevaRelacion({ documento, titulo, abierto, alCambiar }: { documento: string; titulo: string; abierto: boolean; alCambiar: (v: boolean) => void }) {
  const qcl = useQueryClient();
  const navegar = useNavigate();
  const { data: docs } = useQuery({ ...q.documentos(), enabled: abierto });
  const otras = useMemo(() => (docs?.elementos ?? []).filter((d) => d.id !== documento && d.estado === 'listo').sort((a, b) => a.titulo.localeCompare(b.titulo, 'es')), [docs, documento]);
  const [otra, setOtra] = useState('');
  const [tipo, setTipo] = useState<TipoRelacion>('adaptacion_de');
  const [sentido, setSentido] = useState<'origen' | 'destino'>('destino');
  const [nota, setNota] = useState('');
  const [alinearYa, setAlinearYa] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const simetrica = tipo === 'misma_obra' || tipo === 'relacionado';
  const tituloOtra = otras.find((d) => d.id === otra)?.titulo ?? 'la otra obra';

  const enviar = async () => {
    if (!otra) return;
    setEnviando(true);
    try {
      const r = await crearRelacion(qcl, pedidoRelacion(documento, otra, tipo, simetrica ? 'origen' : sentido, nota));
      if (alinearYa) await alinear(qcl, documento, r.id, false).catch(() => undefined);
      avisar(alinearYa ? 'Relación puesta. Se están alineando las dos obras.' : 'Relación puesta.', { tono: 'exito' });
      alCambiar(false);
      setOtra(''); setNota('');
      void navegar({ to: '/documentos/$id/comprension', params: { id: documento }, search: { ver: 'relaciones' } });
    } catch (e) { avisar(mensaje(e, 'No se pudo poner la relación.'), { tono: 'error' }); }
    finally { setEnviando(false); }
  };

  return (
    <Dialogo abierto={abierto} alCambiar={alCambiar} titulo="Añadir una relación" ancho="g"
      descripcion="Cuando la detección no la ve: una adaptación, una traducción, otra edición o una obra que comenta a esta."
      pie={<><Boton variante="linea" onClick={() => alCambiar(false)}>Cancelar</Boton><Boton variante="tinta" icono="mas" cargando={enviando} disabled={!otra} onClick={() => void enviar()}>Añadir la relación</Boton></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        <Etiquetado etiqueta="La otra obra">
          {(id, ayuda) => (
            <Selector id={id} aria-describedby={ayuda} value={otra} onChange={(e) => setOtra(e.target.value)} required>
              <option value="">Elige una obra de tu biblioteca</option>
              {otras.map((d) => <option key={d.id} value={d.id}>{d.titulo}{d.autores ? `, de ${d.autores}` : ''}</option>)}
            </Selector>
          )}
        </Etiquetado>
        <Etiquetado etiqueta="Qué relación">
          {(id) => (
            <Selector id={id} value={tipo} onChange={(e) => setTipo(e.target.value as TipoRelacion)}>
              {TIPOS_RELACION_MANUAL.map((t) => <option key={t} value={t}>{NOMBRE_RELACION[t]}</option>)}
            </Selector>
          )}
        </Etiquetado>
        {!simetrica ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[0.8125rem] font-medium text-coffee-700">Quién es quién</legend>
            {(['destino', 'origen'] as const).map((s) => (
              <label key={s} className="flex items-start gap-2.5 text-[0.875rem] text-coffee-800">
                <input type="radio" name="sentido" checked={sentido === s} onChange={() => setSentido(s)} className="mt-1 h-4 w-4 accent-[var(--s-coffee-800)]" />
                <span><em>{titulo}</em> {verboRelacion(tipo, s)} <em>{tituloOtra}</em></span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <Etiquetado etiqueta="Nota (opcional)" ayuda="Lo que sabes de la relación: quién firma el guion, de qué edición se tradujo…">
          {(id, ayuda) => <AreaTexto id={id} aria-describedby={ayuda} value={nota} maxLength={2000} onChange={(e) => setNota(e.target.value)} className="min-h-20" />}
        </Etiquetado>
        <label className="flex items-start gap-2.5 text-[0.875rem] text-coffee-800">
          <input type="checkbox" checked={alinearYa} onChange={(e) => setAlinearYa(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--s-coffee-800)]" />
          <span>Alinear ahora las dos obras, pasaje a pasaje (gasta modelo; las dos tienen que estar comprendidas para que salga bien).</span>
        </label>
      </form>
    </Dialogo>
  );
}

/** Buscar relaciones en toda la biblioteca (y alinearlas, si se quiere). */
export function DetectarBiblioteca({ abierto, alCambiar }: { abierto: boolean; alCambiar: (v: boolean) => void }) {
  const qcl = useQueryClient();
  const [alinearlas, setAlinearlas] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const lanzar = async () => {
    setEnviando(true);
    try {
      const r = await detectarEnBiblioteca(qcl, { alinear: alinearlas });
      avisar(r.instancia ? `Buscando relaciones en tu biblioteca (hay ${r.relaciones} ahora). Aparecerán en la comprensión de cada obra.` : 'No hay quien lleve el trabajo ahora mismo: vuelve a intentarlo en un rato.', { tono: r.instancia ? 'exito' : 'error' });
      alCambiar(false);
    } catch (e) { avisar(mensaje(e, 'No se pudo lanzar la búsqueda de relaciones.'), { tono: 'error' }); }
    finally { setEnviando(false); }
  };
  return (
    <Dialogo abierto={abierto} alCambiar={alCambiar} titulo="¿Buscar relaciones en toda la biblioteca?"
      pie={<><Boton variante="linea" onClick={() => alCambiar(false)}>Cancelar</Boton><Boton variante="tinta" icono="pila" cargando={enviando} onClick={() => void lanzar()}>Buscar relaciones</Boton></>}>
      <div className="flex flex-col gap-3 text-[0.9375rem] text-coffee-700">
        <p>Se comparan las obras de tu biblioteca por sus metadatos, Wikidata y los personajes que comparten para encontrar adaptaciones, traducciones, ediciones y obras que se comentan. Las que rechazaste no vuelven.</p>
        <label className="flex items-start gap-2.5 text-[0.875rem] text-coffee-800">
          <input type="checkbox" checked={alinearlas} onChange={(e) => setAlinearlas(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--s-coffee-800)]" />
          <span>Alinear también las que se encuentren, pasaje a pasaje. Gasta modelo, más cuanto más largas sean las obras.</span>
        </label>
      </div>
    </Dialogo>
  );
}
