/**
 * El orquestador local: corre los pasos con paralelismo real (Node, banco de
 * pruebas, versión local). En Cloudflare cada paso es un `step.do` del Workflow
 * y el orden es el mismo; aquí, además, se solapan los pasos que no dependen
 * entre sí:
 *
 *   lectura ──┬─► folios ─► estructura ─► fragmentos ─► contexto ─► vectores(texto) ─┐
 *             ├─► metadatos (en cuanto están las primeras páginas) ───┘               ├─► indexado
 *             └─► figuras ─► vectores(figuras) ──────────────────────────────────────┤
 *   vectores(imagen de página) ── desde el principio, no depende de la lectura ──────┘
 */

import { nuevoId, type Documento, type Embebedor, type FaseIngesta, type MetadatosDocumento, type Progreso, type Vector } from '@scholaris/nucleo';
import type { PaqueteConversion } from '@scholaris/imprenta';
import { planificar } from './planificar.js';
import type { FragmentoPlano, OpcionesIngesta, Plan, Procedencia, PuertosIngesta, Seccion, UnidadLeida } from './tipos.js';
import { leerPaginas } from './pasos/lectura.js';
import { segmentarTranscripcion, transcribirMedio } from './pasos/medios.js';
import { unidadesDeBloques } from './pasos/bloques.js';
import { pasoFolios, type OpcionesFolios } from './pasos/folios.js';
import { pasoEstructura } from './pasos/estructura.js';
import { pasoFragmentos } from './pasos/fragmentos.js';
import { pasoMetadatos } from './pasos/metadatos.js';
import { pasoContexto } from './pasos/contexto.js';
import { pasoFiguras, type FiguraConAncla } from './pasos/figuras.js';
import { textoVectorizable, vectorizar, type PiezaVector } from './pasos/vectores.js';
import { entradasIndice, escribirDocumento, escribirEspacio, escribirVectores } from './pasos/indexado.js';

export interface ResultadoIngesta {
  documento: Documento;
  plan: Plan;
  unidades: Array<UnidadLeida & { id: string; imagen?: string; miniatura?: string }>;
  secciones: Seccion[];
  fragmentos: FragmentoPlano[];
  figuras: FiguraConAncla[];
  procedencia: Procedencia[];
  avisos: string[];
  /** Milisegundos de reloj por fase (inicio → fin, con solapes) y total. */
  tiempos: Record<string, number>;
  vectores: Record<string, number>;
}

const PESOS: Partial<Record<FaseIngesta, number>> = { lectura: 0.5, folios: 0.02, metadatos: 0.03, estructura: 0.03, contexto: 0.15, vectores: 0.17, figuras: 0.05, indexado: 0.05 };

export interface OpcionesOrquestador extends OpcionesIngesta {
  documentoId?: string;
  pista?: string;
  /** Deductor de folios externo (`@scholaris/folios`). */
  deducirFolios?: OpcionesFolios['deducir'];
  /** Solo la deducción de folios propia, sin `@scholaris/folios` ni juez. */
  foliosPropios?: boolean;
  /** Describir con el Redactor las figuras sin descripción. */
  describirFiguras?: boolean;
  /** Tamaño de los tramos citables de audio y vídeo. */
  tramosMedio?: { minimo?: number; objetivo?: number; maximo?: number };
  troceado?: { minimo?: number; objetivo?: number; maximo?: number };
  bibliotecas?: string[];
  /** Espacio de nombres del índice vectorial (estantería). */
  espacioNombres?: string;
}

export async function ejecutarIngesta(paquete: PaqueteConversion, puertos: PuertosIngesta, opciones: OpcionesOrquestador = {}): Promise<ResultadoIngesta> {
  const reloj = puertos.reloj ?? Date.now;
  const inicio = reloj();
  const ia = puertos.inteligencia;
  const docId = opciones.documentoId ?? nuevoId('doc');
  const tarea = opciones.tarea ?? docId;
  const procedencia: Procedencia[] = [];
  const avisos: string[] = [...paquete.avisos];
  const tiempos: Record<string, number> = {};
  const marcar = (fase: string, t0: number) => { tiempos[fase] = reloj() - t0; };

  // --- progreso -----------------------------------------------------------
  const avance: Partial<Record<FaseIngesta, number>> = {};
  let unidadesListas = 0;
  const emitir = (fase: FaseIngesta, a: number, mensaje?: string) => {
    avance[fase] = Math.max(avance[fase] ?? 0, Math.min(1, a));
    let total = 0;
    for (const [f, p] of Object.entries(PESOS)) total += (p as number) * (avance[f as FaseIngesta] ?? 0);
    const p: Progreso = { tarea, documento: docId, fase, avance: avance[fase] ?? 0, total: Math.min(0.999, total), unidadesListas, transcurrido: reloj() - inicio, ...(mensaje ? { mensaje } : {}) };
    opciones.onProgreso?.(p);
  };

  const plan = planificar(paquete, opciones);
  if (plan.notas.length) avisos.push(...plan.notas);
  emitir('lectura', 0, `${plan.unidades} unidades; ${plan.pliegos.length} pliegos de visión`);

  // --- vectores: sumidero común -------------------------------------------
  const embebedores: Embebedor[] = [ia.embebedor, ...(ia.embebedoresExtra ?? [])];
  if (puertos.sql) for (const e of embebedores) await escribirEspacio(puertos.sql, e.espacio);
  const cuentaVectores: Record<string, number> = {};
  const tiemposVector = new Map<string, number>();
  let documentoParcial: Documento | null = null;
  const pendientesIndice: Vector[] = [];
  const alIndice = async (vs: Vector[]) => {
    if (!puertos.indice || !documentoParcial || !vs.length) return;
    const porEspacio = new Map<string, Vector[]>();
    for (const v of vs) porEspacio.set(v.espacio, [...(porEspacio.get(v.espacio) ?? []), v]);
    for (const [esp, lista] of porEspacio) {
      const e = embebedores.find((x) => x.espacio.id === esp);
      if (e) await puertos.indice.insertar(e.espacio, entradasIndice(documentoParcial, lista, tiemposVector));
    }
  };
  const guardar = async (vs: Vector[]) => {
    for (const v of vs) cuentaVectores[v.espacio] = (cuentaVectores[v.espacio] ?? 0) + 1;
    if (puertos.sql) await escribirVectores(puertos.sql, docId, vs);
    if (puertos.indice) {
      if (documentoParcial) await alIndice(vs);
      else pendientesIndice.push(...vs);
    }
  };
  const vectorizarEnTodos = async (piezas: PiezaVector[], etiqueta: string) => {
    if (!piezas.length) return;
    const t0 = reloj();
    const ps = await Promise.all(embebedores.map((e) => vectorizar(piezas, e, puertos.fuente, guardar, { concurrencia: 8, reloj })));
    procedencia.push(...ps.map((p) => ({ ...p, detalle: { ...p.detalle, que: etiqueta } })));
    tiempos[`vectores:${etiqueta}`] = reloj() - t0;
  };

  // Vía visual: la imagen de cada página se vectoriza ya, en paralelo con la lectura.
  const unidadIdPorFisica = new Map<number, string>();
  const idUnidad = (fisica: number) => {
    let id = unidadIdPorFisica.get(fisica);
    if (!id) { id = nuevoId('un'); unidadIdPorFisica.set(fisica, id); }
    return id;
  };
  const vistaPaginas = plan.paginasImagen.length
    ? vectorizarEnTodos(plan.paginasImagen.map((p) => ({ objetivo: 'unidad', id: idUnidad(p.fisica), parte: p.parte })), 'paginas')
    : Promise.resolve();
  // Se espera más abajo; esto solo evita el aviso de promesa rechazada sin manejar mientras tanto.
  vistaPaginas.catch(() => {});

  // --- lectura ------------------------------------------------------------
  const tLectura = reloj();
  let unidades: UnidadLeida[] = [];
  let idiomaLectura: string | undefined;
  // Metadatos en cuanto estén las primeras páginas (o el primer tramo).
  let resolverPrimeras: (u: UnidadLeida[]) => void = () => {};
  const primeras = new Promise<UnidadLeida[]>((r) => { resolverPrimeras = r; });
  const leidasPrimeras = new Map<number, UnidadLeida>();
  const nPrimeras = Math.min(5, plan.unidades || 1);

  if (plan.modo === 'paginas') {
    const r = await (async () => {
      const lectores = [ia.lector, ...(ia.lectoresReserva ?? [])];
      return leerPaginas(plan, paquete, puertos.fuente, lectores, {
        ...(opciones.pista ? { pista: opciones.pista } : {}),
        reloj,
        alLeer: (us) => {
          unidadesListas += us.length;
          for (const u of us) if (u.fisica <= nPrimeras) leidasPrimeras.set(u.fisica, u);
          if (leidasPrimeras.size >= nPrimeras) resolverPrimeras([...leidasPrimeras.values()].sort((a, b) => a.fisica - b.fisica));
          emitir('lectura', unidadesListas / Math.max(1, plan.unidades));
        },
      });
    })();
    unidades = r.unidades;
    procedencia.push(...r.procedencia);
    avisos.push(...r.avisos);
    const idiomas = new Map<string, number>();
    for (const u of unidades) if (u.idioma) idiomas.set(u.idioma, (idiomas.get(u.idioma) ?? 0) + u.texto.length);
    idiomaLectura = [...idiomas].sort((a, b) => b[1] - a[1])[0]?.[0];
  } else if (plan.modo === 'medio') {
    const tramosHechos: Array<{ n: number; texto: string }> = [];
    const r = await transcribirMedio(plan.tramos, puertos.fuente, ia.transcriptor, plan.concurrencia, {
      reloj,
      ...(opciones.pista ? { pista: opciones.pista } : {}),
      alTramo: (t) => {
        unidadesListas += 1;
        tramosHechos.push({ n: t.n, texto: t.palabras.map((p) => p.texto).join(' ') });
        if (t.n === plan.tramos[0]?.n) {
          const seg = segmentarTranscripcion(t.palabras, opciones.tramosMedio);
          resolverPrimeras(seg.slice(0, 8));
        }
        emitir('lectura', tramosHechos.length / Math.max(1, plan.tramos.length));
      },
    });
    procedencia.push(...r.procedencia);
    idiomaLectura = r.idioma;
    unidades = segmentarTranscripcion(r.palabras, opciones.tramosMedio);
    unidadesListas = unidades.length;
  } else {
    unidades = unidadesDeBloques(paquete);
    unidadesListas = unidades.length;
    procedencia.push({ fase: 'lectura', proveedor: 'imprenta', ms: reloj() - tLectura, detalle: { unidades: unidades.length } });
  }
  resolverPrimeras(unidades.slice(0, nPrimeras));
  marcar('lectura', tLectura);
  emitir('lectura', 1, `${unidades.length} unidades leídas`);

  // --- metadatos (arrancó con las primeras páginas) ----------------------
  const tMeta = reloj();
  const metadatosP = (plan.modo === 'medio' ? Promise.resolve(unidades) : primeras).then(async (prim) => {
    const r = await pasoMetadatos(
      {
        ficha: paquete.metadatos,
        nombreArchivo: paquete.origen.nombre,
        tipo: paquete.tipo,
        epub: paquete.contenido.clase === 'documento' && paquete.contenido.formato === 'epub',
        ...(paquete.duracion ? { duracion: paquete.duracion } : {}),
        unidades: plan.modo === 'medio' ? unidades : prim.length ? prim : unidades.slice(0, nPrimeras),
        ...(opciones.metadatosUsuario ? { usuario: opciones.metadatosUsuario } : {}),
      },
      { redactor: ia.redactor, ...(puertos.http ? { http: puertos.http } : {}), ...(puertos.correoContacto ? { correo: puertos.correoContacto } : {}), reloj },
      { ...(opciones.sinVerificacion ? { sinVerificacion: true } : {}) },
    );
    procedencia.push(...r.procedencia);
    marcar('metadatos', tMeta);
    emitir('metadatos', 1, r.metadatos.titulo);
    return r;
  });

  // --- folios -------------------------------------------------------------
  if (plan.modo === 'paginas') {
    const t = reloj();
    const r = await pasoFolios(unidades, { ...(opciones.deducirFolios ? { deducir: opciones.deducirFolios } : {}), ...(opciones.foliosPropios ? { propio: true } : { juez: ia.juez }), reloj });
    unidades.forEach((u, i) => { u.ancla = r.anclas[i]; });
    procedencia.push(r.procedencia);
    marcar('folios', t);
  }
  emitir('folios', 1);

  // --- estructura y fragmentos --------------------------------------------
  const tEst = reloj();
  const indice = paquete.contenido.clase === 'pdf' ? paquete.contenido.esquema.map((e) => ({ titulo: e.titulo, nivel: e.nivel, fisica: e.fisica })) : undefined;
  const est = plan.modo === 'medio' ? { secciones: [] as Seccion[], procedencia: { fase: 'estructura' as const, proveedor: 'medio', ms: 0 } } : pasoEstructura(unidades, indice, { reloj });
  procedencia.push(est.procedencia);
  const frag = pasoFragmentos(unidades, est.secciones, plan.modo === 'medio', { ...opciones.troceado, reloj });
  procedencia.push(frag.procedencia);
  const fragmentos = frag.fragmentos;
  marcar('estructura', tEst);
  emitir('estructura', 1, `${est.secciones.length} secciones, ${fragmentos.length} fragmentos`);

  // --- figuras (en paralelo con contexto) ---------------------------------
  const tFig = reloj();
  const figurasP = (async () => {
    const meta = (await metadatosP.catch(() => null))?.metadatos ?? null;
    const r = await pasoFiguras(paquete, unidades, puertos.fuente, ia.redactor, {
      reloj,
      describir: opciones.describirFiguras !== false,
      ...(meta?.idioma ? { idioma: meta.idioma } : {}),
      ...(meta ? { contexto: `«${meta.titulo}»` } : {}),
    });
    procedencia.push(r.procedencia);
    marcar('figuras', tFig);
    emitir('figuras', 1, `${r.figuras.length} figuras`);
    for (const f of r.figuras) if (f.t !== undefined) tiemposVector.set(f.id, f.t);
    const piezas: PiezaVector[] = r.figuras
      .filter((f) => (f.t !== undefined && f.parte) || (f.region && f.parte && puertos.fuente.recorte))
      .map((f) => (f.t !== undefined ? { objetivo: 'figura', id: f.id, parte: f.parte as string } : { objetivo: 'figura', id: f.id, recorte: { parte: f.parte as string, region: f.region as NonNullable<typeof f.region> } }));
    // Los pies y descripciones también se vectorizan como texto del mismo objetivo si no hay imagen.
    await vectorizarEnTodos(piezas, 'figuras');
    return r.figuras;
  })();

  metadatosP.catch(() => {});
  figurasP.catch(() => {});

  // --- contexto y vectores de texto ---------------------------------------
  const { metadatos, hablantes } = await metadatosP;
  // Hablantes con nombre: «H0» → «Facundo Cabral» en el texto y en el ancla.
  if (hablantes) {
    const nombre = (h?: string) => (h && hablantes[h.split('·')[0] as string]) || h;
    for (const u of unidades) {
      if (u.hablante) u.hablante = nombre(u.hablante);
      if (u.ancla?.tipo === 'tiempo' && u.ancla.hablante) u.ancla = { ...u.ancla, hablante: nombre(u.ancla.hablante) as string };
      u.texto = u.texto.replace(/\*\*([^*:]+):\*\*/g, (m, h: string) => `**${nombre(h) ?? h}:**`);
    }
    for (const f of fragmentos) {
      if (f.ancla.tipo === 'tiempo' && f.ancla.hablante) f.ancla = { ...f.ancla, hablante: nombre(f.ancla.hablante) as string };
      f.texto = f.texto.replace(/\*\*([^*:]+):\*\*/g, (m, h: string) => `**${nombre(h) ?? h}:**`);
    }
    procedencia.push({ fase: 'metadatos', proveedor: 'hablantes', ms: 0, detalle: { hablantes } });
  }
  if (!opciones.sinContexto && fragmentos.length) {
    const t = reloj();
    const r = await pasoContexto(fragmentos, metadatos, ia.redactor, { concurrencia: plan.concurrencia, reloj, alGrupo: (h, n) => emitir('contexto', h / n) });
    for (const f of fragmentos) f.contexto = r.contextos[f.id] ?? '';
    procedencia.push(r.procedencia);
    marcar('contexto', t);
  }
  emitir('contexto', 1);

  // El documento ya se puede describir: las entradas del índice llevan sus metadatos.
  const ahora = new Date().toISOString();
  const documento: Documento = {
    id: docId,
    tipo: paquete.tipo,
    metadatos,
    estado: 'listo',
    huella: paquete.origen.huella,
    original: '',
    mime: paquete.origen.mime,
    bytes: paquete.origen.bytes,
    unidades: unidades.length,
    ...(paquete.duracion ? { duracion: paquete.duracion } : {}),
    creado: ahora,
    actualizado: ahora,
    bibliotecas: opciones.bibliotecas ?? [],
  };
  documentoParcial = documento;
  await alIndice(pendientesIndice.splice(0));

  for (const f of fragmentos) { const a = f.ancla; if (a.tipo === 'tiempo') tiemposVector.set(f.id, a.t0); }
  const tVec = reloj();
  await vectorizarEnTodos(fragmentos.map((f) => ({ objetivo: 'fragmento', id: f.id, texto: textoVectorizable(f) })), 'fragmentos');
  const figuras = await figurasP;
  if (hablantes) for (const g of figuras) if (g.ancla.tipo === 'tiempo' && g.ancla.hablante) g.ancla = { ...g.ancla, hablante: hablantes[g.ancla.hablante.split('·')[0] as string] ?? g.ancla.hablante };
  await vistaPaginas;
  marcar('vectores', tVec);
  emitir('vectores', 1);

  // --- indexado -----------------------------------------------------------
  const tIdx = reloj();
  const paginasPdf = paquete.contenido.clase === 'pdf' ? new Map(paquete.contenido.paginas.map((p) => [p.fisica, p])) : null;
  const paginasImg = paquete.contenido.clase === 'imagenes' ? new Map(paquete.contenido.paginas.map((p) => [p.fisica, p])) : null;
  const unidadesFinales = unidades.map((u) => {
    const pdf = paginasPdf?.get(u.fisica), img = paginasImg?.get(u.fisica);
    const imagen = pdf?.imagen ?? img?.imagen;
    const miniatura = pdf?.miniatura ?? img?.miniatura;
    return { ...u, id: plan.modo === 'paginas' ? idUnidad(u.fisica) : nuevoId('un'), ...(imagen ? { imagen } : {}), ...(miniatura ? { miniatura } : {}) };
  });
  const tiempoTotal = reloj() - inicio;
  procedencia.push({ fase: 'indexado', proveedor: 'ingesta', ms: tiempoTotal, detalle: { tiempos, vectores: cuentaVectores } });
  if (puertos.sql) {
    await escribirDocumento(puertos.sql, { documento, unidades: unidadesFinales, secciones: est.secciones, fragmentos, figuras, procedencia });
  }
  marcar('indexado', tIdx);
  tiempos.total = reloj() - inicio;
  emitir('indexado', 1);
  opciones.onProgreso?.({ tarea, documento: docId, fase: 'listo', avance: 1, total: 1, unidadesListas: unidades.length, transcurrido: tiempos.total });

  return { documento, plan, unidades: unidadesFinales, secciones: est.secciones, fragmentos, figuras, procedencia, avisos, tiempos, vectores: cuentaVectores };
}

export type { MetadatosDocumento };
