/**
 * Una colección que sigues: la de otra persona, en vivo (la ves cambiar a la
 * vez que ella), con buscar dentro, leer con anclas, copiarla a tu biblioteca
 * (entera o un documento) y dejar de seguirla.
 */
import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DERECHOS } from '@scholaris/contrato';
import { avisar, Boton, Esqueleto, Icono, MenuContenido, MenuDisparador, MenuElemento, MenuRaiz, Vacio } from '@scholaris/ui';
import { api } from '../datos/api';
import { Cabecera } from '../componentes/comunes/cabecera';
import { LecturaCompartida, type Posicion } from '../componentes/biblioteca/lectura-compartida';
import { numero } from '../lib/numero';

interface Busqueda { doc?: string; u?: number; t?: number }

export const Route = createFileRoute('/compartida/$id')({
  validateSearch: (s: Record<string, unknown>): Busqueda => ({
    doc: typeof s.doc === 'string' ? s.doc : undefined,
    u: Number.isFinite(Number(s.u)) && s.u !== undefined ? Number(s.u) : undefined,
    t: Number.isFinite(Number(s.t)) && s.t !== undefined ? Number(s.t) : undefined,
  }),
  component: PaginaCompartida,
});

function PaginaCompartida() {
  const { id } = Route.useParams();
  const pos = Route.useSearch();
  const navegar = useNavigate({ from: '/compartida/$id' });
  const qc = useQueryClient();
  const cliente = api().compartida(id);
  const { data: seguidas, isPending } = useQuery({ queryKey: ['seguidas'], queryFn: () => api().seguidas.listar() });
  const { data: bib } = useQuery({ queryKey: ['ajena', id, 'biblioteca'], queryFn: () => cliente.bibliotecas.obtener(id), retry: false });
  const [copiando, setCopiando] = useState<{ hechos: number; total: number } | null>(null);
  const s = seguidas?.find((x) => x.biblioteca === id);

  async function copiar(documentos?: string[]) {
    setCopiando({ hechos: 0, total: documentos?.length ?? bib?.documentos ?? 0 });
    try {
      const r = await api().copias.copiarTodo({ origen: { biblioteca: id }, ...(documentos ? { documentos, destino: { nombre: `${bib?.nombre ?? 'Copia'} (selección)` } } : {}) },
        (p) => setCopiando({ hechos: p.copiados.length + p.repetidos.length + p.fallidos.length, total: p.total }));
      void qc.invalidateQueries({ queryKey: ['bibliotecas'] });
      void qc.invalidateQueries({ queryKey: ['documentos'] });
      const partes = [`${numero(r.copiados.length)} copiados`, r.repetidos.length ? `${numero(r.repetidos.length)} ya los tenías` : '', r.fallidos.length ? `${numero(r.fallidos.length)} con error` : ''].filter(Boolean);
      avisar(`Copiada a tu biblioteca: ${partes.join(', ')}. Sin volver a leer nada.`, { tono: r.fallidos.length ? 'error' : 'exito', accion: { etiqueta: 'Abrir', alPulsar: () => void navegar({ to: '/', search: { col: r.biblioteca } }) } });
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo copiar.', { tono: 'error' }); }
    finally { setCopiando(null); }
  }

  async function dejar() {
    try {
      await api().seguidas.dejar(id);
      void qc.invalidateQueries({ queryKey: ['seguidas'] });
      void qc.invalidateQueries({ queryKey: ['bibliotecas'] });
      avisar(`Ya no sigues «${s?.nombre ?? bib?.nombre}».`);
      void navegar({ to: '/' });
    } catch { avisar('No se pudo.', { tono: 'error' }); }
  }

  if (isPending) return <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 lg:px-10"><Esqueleto className="h-10 w-1/2" /><Esqueleto className="mt-6 h-64" /></div>;
  if (!s) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-12">
        <Vacio estilo="malevich" titulo="Ya no tienes acceso a esta colección." accion={<Boton variante="linea" onClick={() => void navegar({ to: '/invitaciones' })}>Ver invitaciones</Boton>}>
          Puede que quien la compartía la haya retirado, que haya caducado o que la dejaras de seguir.
        </Vacio>
      </div>
    );
  }

  const de = s.propietario.nombre || 'otra persona';
  const papel = s.permiso === 'lectura' ? 'solo lectura' : s.permiso === 'edicion' ? 'puedes editar' : 'la administras';
  return (
    <>
      <Cabecera forma="circulo" titulo={s.nombre} antetitulo={<>Compartida por {de} · {papel}{bib ? ` · ${numero(bib.documentos)} documentos` : ''} · {DERECHOS[s.derechos ?? 'sin_indicar'].nombre}</>} />
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-5 sm:px-6 lg:px-10">
        {s.descripcion && !pos.doc ? <p className="mb-5 max-w-3xl text-[0.9375rem] text-coffee-600">{s.descripcion}</p> : null}
        {copiando ? <p className="mb-4 flex items-center gap-2 rounded-xl bg-cream-100 px-4 py-2.5 text-[0.8125rem] text-coffee-600"><Icono nombre="copiar" tam={14} />Copiando {numero(copiando.hechos)} de {numero(copiando.total)}…</p> : null}
        <LecturaCompartida
          cliente={cliente} clave={id} posicion={pos as Posicion}
          alMover={(p) => void navegar({ search: p, replace: !!pos.doc && p.doc === pos.doc })}
          alCopiarDocumento={(d) => void copiar([d])}
          acciones={(
            <div className="flex gap-2">
              <Boton variante="tinta" icono="copiar" disabled={!!copiando} onClick={() => void copiar()}>Copiar a mi biblioteca</Boton>
              <MenuRaiz>
                <MenuDisparador asChild><Boton variante="linea" icono="opciones" aria-label="Más" /></MenuDisparador>
                <MenuContenido>
                  <MenuElemento icono="descargar" alElegir={() => void exportar(id, s.nombre)}>Descargar el paquete</MenuElemento>
                  <MenuElemento icono="salir" peligro alElegir={() => void dejar()}>Dejar de seguir</MenuElemento>
                </MenuContenido>
              </MenuRaiz>
            </div>
          )}
        />
        <p className="mt-10 text-[0.75rem] text-coffee-400">Lo que ves aquí cambia cuando {de} cambia la colección. Una copia en tu biblioteca es tuya: no cambia, y no se vuelve a leer nada al copiarla.</p>
      </div>
    </>
  );
}

async function exportar(id: string, nombre: string) {
  try {
    const r = await api().compartida(id).bibliotecas.paquete(id);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = `${nombre.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'biblioteca'}.scholaris`;
    a.click();
  } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo descargar.', { tono: 'error' }); }
}
