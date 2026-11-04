/**
 * La transcripción revisada de los audios y los vídeos y la percepción de los
 * medios de la biblioteca (contrato/medios.ts): la revisión guardada de cada
 * medio (con su cobertura y sus huecos), revisarla, y estimar y lanzar el
 * trabajo de muchos a la vez. Mientras trabaja, se mira cada pocos segundos.
 */
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { EstimacionMedios, MediosLanzados, PedirMediosBiblioteca, RevisarTranscripcion, RevisionLanzada, RevisionSimulada, RevisionTranscripcionVista } from '@scholaris/contrato';
import { api } from './api';

const trabajando = (r: RevisionTranscripcionVista | null | undefined) => r?.tarea?.estado === 'en_cola' || r?.tarea?.estado === 'procesando';

export const qm = {
  /** La revisión de la transcripción de un medio; null si no se ha revisado nunca. */
  revision: (documento: string) => queryOptions({
    queryKey: ['medios', 'revision', documento],
    queryFn: async (): Promise<RevisionTranscripcionVista | null> => {
      try { return await api().medios.revision(documento); } catch (e) { if ((e as { estado?: number }).estado === 404) return null; throw e; }
    },
    staleTime: 60_000,
    retry: 0,
    refetchInterval: (q) => (trabajando(q.state.data) ? 8000 : false),
  }),
};

export const revisionEnMarcha = trabajando;

/** Lo que costaría revisar la transcripción de un medio (no lanza nada). */
export function simularRevision(documento: string, p: Omit<RevisarTranscripcion, 'simular'> = {}): Promise<RevisionSimulada> {
  return api().medios.revisar(documento, { ...p, simular: true }) as Promise<RevisionSimulada>;
}

/** Lanza la revisión (o la percepción y la revisión) de un medio. */
export async function lanzarRevision(qcl: QueryClient, documento: string, p: Omit<RevisarTranscripcion, 'simular'> = {}): Promise<RevisionLanzada> {
  const r = await api().medios.revisar(documento, p) as RevisionLanzada;
  await qcl.invalidateQueries({ queryKey: ['medios', 'revision', documento] });
  await qcl.invalidateQueries({ queryKey: ['tareas'] });
  return r;
}

/** Estima (sin `confirmar`) o lanza la percepción de los medios de la biblioteca; con `soloTranscripcion`, solo la revisión de sus transcripciones. */
export async function mediosDeBiblioteca(p: PedirMediosBiblioteca & { soloTranscripcion?: boolean }, qcl?: QueryClient): Promise<EstimacionMedios | MediosLanzados> {
  const { soloTranscripcion, ...cuerpo } = p;
  const r = soloTranscripcion ? await api().medios.revisarBiblioteca(cuerpo) : await api().medios.percibir(cuerpo);
  if (r.lanzada && qcl) {
    await qcl.invalidateQueries({ queryKey: ['tareas'] });
    await qcl.invalidateQueries({ queryKey: ['medios', 'revision'] });
  }
  return r;
}

/** Los huecos que quedan en la transcripción (los de después de aplicar la revisión, si se aplicó). */
export function huecosDeRevision(r: RevisionTranscripcionVista | null | undefined) {
  const c = r?.cobertura;
  return (c?.despues ?? c?.antes)?.lista ?? [];
}
