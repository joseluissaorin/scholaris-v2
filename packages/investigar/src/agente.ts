/**
 * El agente de investigación (docs/COMPRENSION.md, «Responder: el modo Investigar»):
 *
 *   memoria (recordar) → catálogo → plan → bucle de herramientas con presupuesto
 *   de pasos, tiempo y coste (cada prueba al cuaderno de la investigación) →
 *   redacción con citas [E#] a pruebas materiales → verificación frase a frase
 *   (volviendo a mirar lo visual) → historial y cuaderno → fin.
 *
 * Es un generador: cada fase emite sus eventos según ocurren (EventoInvestigacion).
 */
import type { EventoInvestigacion, EvidenciaInvestigacion, FuenteInvestigacion, PasoInvestigacion, PlanInvestigacion } from '@scholaris/contrato';
import { detectarIdioma } from '@scholaris/funciones';
import { nuevoId } from '@scholaris/nucleo';
import type { Filtros } from '@scholaris/nucleo';
import { recortar, type ContextoHerramientas, type Herramienta, type ResultadoHerramienta } from './contexto.js';
import { HERRAMIENTAS_LECTURA } from './herramientas.js';
import { guardarEnCuaderno, guardarEnHistorial, HERRAMIENTAS_MEMORIA, type Investigacion } from './memoria.js';
import { Contabilidad, type MensajeAgente, type ParteMensaje } from './modelo.js';
import { candidatas, catalogo, planificar } from './plan.js';
import { presupuestoDe, type OpcionesInvestigar, type PuertosInvestigar } from './puertos.js';
import { CuadernoPruebas, fichaDocumento, vistaPrueba, type Prueba } from './pruebas.js';
import { nombreIdioma, Numerador, redactar } from './sintesis.js';
import { confianzaDe, marcarSinPrueba, verificar } from './verificacion.js';
import { escuchar, ver } from './vision.js';

/** Las herramientas que puede usar el agente con estos puertos. */
export function herramientasPara(p: PuertosInvestigar): Herramienta[] {
  return [...HERRAMIENTAS_LECTURA, ...(p.medios ? [ver, escuchar] : []), ...HERRAMIENTAS_MEMORIA];
}

export function sistemaAgente(presupuesto: { pasos: number; segundos: number }, idioma: string, conMedios: boolean): string {
  return `Eres un investigador académico que trabaja sobre la biblioteca de un usuario con herramientas. Tu trabajo es reunir las pruebas materiales con que se responderá la pregunta; la redacción viene después y la hace otro paso con tu cuaderno de pruebas.

Cómo trabajar:
1. Toda afirmación sobre las obras tiene que salir de pruebas [P#] que te devuelvan las herramientas. Las pruebas son lo único citable; las fichas de comprensión orientan, pero se citan sus pruebas.
2. Orientarte primero: «mapa» de cada obra que intervenga (estructura, recorrido, fotogramas descritos, entidades). Después «buscar» con consultas concretas, en las lenguas de las obras, y «leer» entero el tramo clave (páginas, minutos) antes de apoyarte en él: las búsquedas devuelven trozos. Para localizar una escena (la primera, la última, el final, cuando vuelve un motivo) no la supongas: sitúala con el recorrido del mapa o buscando el motivo, y comprueba leyendo lo que hay antes y después.
3. Lo visual (planos, escala, angulación, movimiento, composición, quién domina el encuadre, gestos, objetos, luz) solo se prueba con «ver» sobre el tramo concreto${conMedios ? '' : ' (en esta biblioteca no hay medios que mirar: usa los fotogramas descritos con «leer» y dilo)'}; lo sonoro, con «escuchar». La transcripción dice qué se dice, no cómo se filma. Pide tramos cortos y precisos (localízalos antes leyendo la transcripción).
4. Para comparar obras (un cuento y su película, un original y su traducción, dos ediciones), reúne pruebas de las dos y usa «alinear» con el tramo de una para encontrar lo que le corresponde en la otra; «entidad» sigue a un personaje, un lugar o un objeto por todas las obras.
5. Varias llamadas a la vez cuando sean independientes.
6. Apunta con «anotar» los hallazgos y las hipótesis importantes con sus pruebas.
7. Cuando cada subpregunta tenga sus pruebas, termina contestando con una nota breve de lo que has encontrado (sin llamar a más herramientas). No redactes la respuesta final.
Presupuesto: ${presupuesto.pasos} llamadas a herramientas y ${presupuesto.segundos} segundos. La respuesta se escribirá en ${nombreIdioma(idioma)}.`;
}

/** Recorta las respuestas viejas de las herramientas cuando el historial crece (las firmas de Gemini van en los turnos del modelo, que no se tocan). */
export function compactar(mensajes: MensajeAgente[], limite = 160_000, conservar = 3): void {
  const tam = () => mensajes.reduce((n, m) => n + m.partes.reduce((k, p) => k + (p.tipo === 'respuesta' ? JSON.stringify(p.contenido).length : p.tipo === 'texto' ? p.texto.length : 200), 0), 0);
  if (tam() <= limite) return;
  const usuarios = mensajes.map((m, i) => ({ m, i })).filter(({ m }) => m.rol === 'usuario' && m.partes.some((p) => p.tipo === 'respuesta'));
  for (const { m } of usuarios.slice(0, Math.max(0, usuarios.length - conservar))) {
    m.partes = m.partes.map((p) => {
      if (p.tipo !== 'respuesta') return p;
      const c = p.contenido as { resumen?: string; pruebas?: string[] };
      return { ...p, contenido: { resultado: `(Resultado ya leído y resumido: ${c.resumen ?? ''}. Sus pruebas siguen en el cuaderno: ${(c.pruebas ?? []).join(', ') || 'ninguna'}.)`, resumen: c.resumen ?? '', pruebas: c.pruebas ?? [] } };
    });
    if (tam() <= limite) return;
  }
}

/** Ejecuta varias promesas con un tope de concurrencia, conservando el orden. */
async function enParalelo<T, R>(xs: T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (i < xs.length) { const k = i++; salida[k] = await f(xs[k] as T, k); }
  }));
  return salida;
}

const ETIQUETA_PRUEBAS: Record<string, string> = { es: 'Pruebas', en: 'Evidence', fr: 'Preuves', it: 'Prove', pt: 'Provas', ca: 'Proves' };

/** La lista de pruebas que cierra el Markdown. */
export function listaPruebas(evidencias: EvidenciaInvestigacion[], idioma: string): string {
  if (!evidencias.length) return '';
  const titulo = ETIQUETA_PRUEBAS[idioma.slice(0, 2)] ?? 'Pruebas';
  return `\n\n## ${titulo}\n\n${evidencias.map((e) => {
    const cita = e.cita ? `: «${recortar(e.cita, 400)}»` : '';
    return `- [${e.id}] ${e.citaCorta.replace(/^\(|\)$/g, '')}, *${e.titulo}*${cita}${e.traduccion ? ` («${recortar(e.traduccion, 400)}»)` : ''}`;
  }).join('\n')}`;
}

/** Las traducciones que la respuesta pone detrás de las citas: «original» [E3] («traducción»). */
export function traducciones(markdown: string): Map<string, string> {
  const salida = new Map<string, string>();
  for (const m of markdown.matchAll(/\[(E\d+)\](?:\[E\d+\])*\s*\(\s*(?:trad\.?:?\s*)?«([^»]{3,600})»\s*\)/g)) if (!salida.has(m[1] as string)) salida.set(m[1] as string, (m[2] as string).trim());
  return salida;
}

export async function* investigar(p: PuertosInvestigar, pregunta: string, o: OpcionesInvestigar = {}): AsyncGenerator<EventoInvestigacion> {
  const reloj = p.ahora ?? Date.now;
  const t0 = reloj();
  const id = o.id ?? nuevoId('inv');
  const presupuesto = presupuestoDe(o);
  const cuentas = new Contabilidad();
  const filtros: Filtros = o.filtros ?? {};
  const avisos: string[] = [];
  const pendientes: Prueba[] = [];
  const { porId: docs } = await p.buscador.estanteria.documentos();
  const hayFiltros = Object.values(filtros).some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null));
  const ambito = hayFiltros ? await p.buscador.estanteria.documentosPermitidos(filtros) : null;
  const idiomaPregunta = o.idioma ?? (detectarIdioma(pregunta) || 'es');
  const ctx: ContextoHerramientas = {
    p, pruebas: new CuadernoPruebas(), docs, fichas: new Map([...docs.values()].map((d) => [d.id, fichaDocumento(d)])), ambito, filtros, notas: [], cuentas,
    segundosVer: presupuesto.segundosVer, resultadosPorBusqueda: presupuesto.resultadosPorBusqueda, idioma: idiomaPregunta,
    alPrueba: (x) => { pendientes.push(x); }, avisos, ...(o.signal ? { signal: o.signal } : {}),
  };
  const urls = new Map<string, string | undefined>();
  const urlDe = async (x: Prueba) => {
    if (!x.imagen || !p.medios?.url) return undefined;
    const k = `${x.evidencia.documento}|${x.imagen}`;
    if (!urls.has(k)) urls.set(k, await p.medios.url(x.evidencia.documento, x.imagen).catch(() => undefined));
    return urls.get(k);
  };
  async function* vaciar(): AsyncGenerator<EventoInvestigacion> {
    while (pendientes.length) {
      const x = pendientes.shift()!;
      const url = await urlDe(x);
      yield { tipo: 'evidencia', evidencia: vistaPrueba(x, ctx.fichas.get(x.evidencia.documento), url ? { imagenUrl: url } : {}) };
    }
  }
  const herramientas = herramientasPara(p);
  const porNombre = new Map(herramientas.map((h) => [h.declaracion.nombre, h]));
  const eventos: Array<{ ms: number; etapa?: string; datos: unknown }> = [];
  let n = 0;
  async function ejecutar(nombre: string, args: Record<string, unknown>): Promise<{ r: ResultadoHerramienta; paso: PasoInvestigacion }> {
    const h = porNombre.get(nombre);
    const ti = reloj();
    let r: ResultadoHerramienta;
    if (!h) r = { texto: `ERROR: no existe la herramienta «${nombre}».`, resumen: 'herramienta desconocida', pruebas: [], error: 'herramienta desconocida' };
    else {
      try { r = await h.ejecutar(args, ctx); } catch (e) {
        const m = (e as Error).message ?? String(e);
        r = { texto: `ERROR: ${m}`, resumen: `falló: ${recortar(m, 120)}`, pruebas: [], error: m };
      }
    }
    const paso: PasoInvestigacion = { n: ++n, herramienta: nombre, entrada: args, resumen: r.resumen, ms: Math.round(reloj() - ti), evidencias: r.pruebas, ...(r.error ? { error: r.error } : {}) };
    eventos.push({ ms: reloj() - t0, etapa: 'paso', datos: paso });
    return { r, paso };
  }

  const modeloAgente = p.modelos.agente.nombre;
  let plan: PlanInvestigacion | null = null;
  let markdown = '';
  try {
    yield { tipo: 'inicio', id, modelo: modeloAgente, presupuesto: { pasos: presupuesto.pasos, segundos: presupuesto.segundos, usd: presupuesto.usd } };

    // 1. La memoria, antes de buscar.
    const memoria = await ejecutar('recordar', { consulta: pregunta });
    yield { tipo: 'paso', ...memoria.paso };
    yield* vaciar();

    // 2. Catálogo y plan.
    const ids = await candidatas(ctx, pregunta);
    const textoCatalogo = await catalogo(ctx, ids);
    try {
      plan = await planificar(ctx, pregunta, textoCatalogo, memoria.r.pruebas.length || !memoria.r.error ? memoria.r.texto : '', idiomaPregunta);
    } catch (e) {
      avisos.push(`El plan falló: ${(e as Error).message}`);
      plan = { enfoque: 'Reunir pruebas en las obras que intervienen y responder parte por parte.', documentos: ids.slice(0, 4).map((d) => ({ id: d, titulo: docs.get(d)?.metadatos.titulo ?? d, papel: '' })), subpreguntas: [{ pregunta, pruebas: ['literal'] }], idiomas: [idiomaPregunta], idiomaRespuesta: idiomaPregunta };
    }
    const idioma = o.idioma ?? plan.idiomaRespuesta ?? idiomaPregunta;
    ctx.idioma = idioma;
    eventos.push({ ms: reloj() - t0, etapa: 'plan', datos: plan });
    yield { tipo: 'plan', plan };

    // 3. El bucle de herramientas.
    const sistema = sistemaAgente(presupuesto, idioma, !!p.medios);
    const mensajes: MensajeAgente[] = [{
      rol: 'usuario',
      partes: [{
        tipo: 'texto',
        texto: [
          `PREGUNTA: ${pregunta}`,
          `PLAN:\n${plan.enfoque}\n${plan.subpreguntas.map((s, i) => `${i + 1}. ${s.pregunta} (pruebas: ${s.pruebas.join(', ') || 'literal'}${s.documentos?.length ? `; obras: ${s.documentos.join(', ')}` : ''})`).join('\n')}${plan.idiomas.length ? `\nLenguas: ${plan.idiomas.join(', ')}` : ''}`,
          `OBRAS:\n${textoCatalogo || '(la biblioteca está vacía)'}`,
          memoria.r.pruebas.length ? `MEMORIA (investigaciones anteriores; sus pruebas ya están en tu cuaderno):\n${recortar(memoria.r.texto, 6000)}` : '',
          'Empieza.',
        ].filter(Boolean).join('\n\n'),
      }],
    }];
    let pasos = 0;
    let empujado = false;
    let reflexion = '';
    const agotado = () => pasos >= presupuesto.pasos || reloj() - t0 > presupuesto.segundos * 1000 || cuentas.usd >= presupuesto.usd;
    while (!agotado()) {
      if (o.signal?.aborted) throw new Error('Investigación cancelada.');
      compactar(mensajes);
      const quedan = presupuesto.pasos - pasos;
      const r = await p.modelos.agente.turno({ sistema, mensajes, herramientas: herramientas.map((h) => h.declaracion), pensamiento: 'bajo', maxTokens: 8000, ...(o.signal ? { signal: o.signal } : {}) });
      cuentas.apuntar(r.uso);
      mensajes.push(r.mensaje);
      if (!r.llamadas.length) {
        if (!ctx.pruebas.tamano && !empujado) {
          empujado = true;
          mensajes.push({ rol: 'usuario', partes: [{ tipo: 'texto', texto: 'Aún no hay ninguna prueba en el cuaderno: usa las herramientas para reunirlas antes de terminar.' }] });
          continue;
        }
        reflexion = r.texto;
        break;
      }
      const llamadas = r.llamadas;
      const ejecutables = llamadas.slice(0, quedan);
      const hechas = await enParalelo(ejecutables, 4, (l) => ejecutar(l.nombre, l.args));
      pasos += ejecutables.length;
      const partes: ParteMensaje[] = [];
      for (const [i, l] of llamadas.entries()) {
        const h = hechas[i];
        partes.push({ tipo: 'respuesta', ...(l.id ? { id: l.id } : {}), nombre: l.nombre, contenido: h ? { resultado: h.r.texto, resumen: h.r.resumen, pruebas: h.r.pruebas } : { resultado: 'No ejecutada: presupuesto de pasos agotado.' } });
      }
      for (const h of hechas) {
        yield { tipo: 'paso', ...h.paso };
        yield* vaciar();
      }
      const seg = Math.round(presupuesto.segundos - (reloj() - t0) / 1000);
      const restantes = presupuesto.pasos - pasos;
      if (restantes <= 3 || seg <= 40) partes.push({ tipo: 'texto', texto: `Quedan ${Math.max(0, restantes)} llamadas y unos ${Math.max(0, seg)} segundos: prioriza lo que falta y termina a tiempo.` });
      mensajes.push({ rol: 'usuario', partes });
    }
    if (agotado()) avisos.push(`La investigación agotó su presupuesto (${pasos} pasos, ${Math.round((reloj() - t0) / 1000)} s, ${cuentas.usd.toFixed(3)} $).`);

    // 4. La redacción.
    const numerador = new Numerador(ctx, (x) => (x.imagen ? urls.get(`${x.evidencia.documento}|${x.imagen}`) : undefined));
    for (const x of ctx.pruebas.todas()) await urlDe(x);
    let texto = '';
    if (!ctx.pruebas.tamano) {
      texto = idioma.startsWith('en') ? 'I could not find evidence in your library to answer this question.' : 'No he encontrado en tu biblioteca pruebas con que responder a esta pregunta.';
      yield { tipo: 'texto', delta: texto };
    } else {
      for await (const t of redactar(ctx, numerador, pregunta, plan, ctx.notas, reflexion, idioma)) {
        texto += t.delta;
        yield { tipo: 'texto', delta: t.delta, ...(Object.keys(t.marcas).length ? { marcas: t.marcas } : {}) };
      }
    }
    if (numerador.descartadas.length) avisos.push(`Se quitaron ${numerador.descartadas.length} marcas que no correspondían a ninguna prueba.`);

    // 5. La verificación.
    const v = await verificar(ctx, numerador, texto, presupuesto.revisiones);
    const respaldadas = v.frases.filter((f) => f.veredicto === 'respaldada').length;
    yield { tipo: 'verificacion', frases: v.frases, respaldadas, total: v.frases.length };
    const confianza = numerador.marcadas.length ? confianzaDe(v.frases) : 'baja';

    // 6. El resultado: traducciones, pruebas, fuentes.
    const trad = traducciones(texto);
    const evidencias = numerador.marcadas.map((m) => {
      const t = trad.get(m.id);
      return t && m.evidencia.idioma && !idioma.startsWith(m.evidencia.idioma.slice(0, 2)) ? { ...m.evidencia, traduccion: t } : m.evidencia;
    });
    markdown = `${marcarSinPrueba(texto.trim(), v.detalle)}${listaPruebas(evidencias, idioma)}`;
    const fuentes: FuenteInvestigacion[] = [];
    for (const e of evidencias) {
      let f = fuentes.find((x) => x.documento === e.documento);
      if (!f) {
        const d = docs.get(e.documento);
        const fd = ctx.fichas.get(e.documento);
        f = { documento: e.documento, titulo: d?.metadatos.titulo ?? e.titulo, autores: fd?.autor ?? '', ...(d?.metadatos.anio ? { anio: d.metadatos.anio } : {}), tipo: d?.tipo ?? '', evidencias: [] };
        fuentes.push(f);
      }
      f.evidencias.push(e.id);
    }
    const ms = Math.round(reloj() - t0);
    const inv: Investigacion = { id, pregunta, plan, markdown, evidencias, frases: v.frases, notas: ctx.notas, confianza, modelo: modeloAgente, ms };

    // 7. La memoria.
    let cuaderno: string | undefined;
    if (o.cuaderno !== false) {
      try {
        cuaderno = await guardarEnCuaderno(p.sql, inv, typeof o.cuaderno === 'string' ? o.cuaderno : undefined, p.usuario ?? { id: 'local' });
      } catch (e) { avisos.push(`No se pudo guardar el cuaderno: ${(e as Error).message}`); }
    }
    const evento = o.sinHistorial ? undefined : await guardarEnHistorial(p.sql, inv, { filtros, pro: !!p.usuario?.pro, eventos });
    yield {
      tipo: 'fin', markdown, evidencias, fuentes, ...(cuaderno ? { cuaderno } : {}), ...(evento ? { evento } : {}), confianza,
      coste: { usd: Math.round(cuentas.usd * 10000) / 10000, tokensEntrada: cuentas.entrada, tokensSalida: cuentas.salida, llamadas: cuentas.llamadas, pasos: n, ms, modelo: modeloAgente },
      avisos: [...new Set(avisos)], ms,
    };
  } catch (e) {
    const m = (e as Error).message ?? String(e);
    if (!o.sinHistorial) {
      await guardarEnHistorial(p.sql, { id, pregunta, plan, markdown, evidencias: [], frases: [], notas: ctx.notas, confianza: 'baja', modelo: modeloAgente, ms: Math.round(reloj() - t0) }, { filtros, error: m, eventos });
    }
    console.error(JSON.stringify({ que: 'investigar', id, error: m }));
    yield { tipo: 'error', mensaje: /cancelada/.test(m) ? 'Investigación cancelada.' : 'No he podido terminar la investigación. Vuelve a intentarlo.' };
  }
}

/** Lo mismo que `investigar`, pero espera al final (para el MCP, el SDK bloqueante y el banco). */
export async function investigarCompleto(p: PuertosInvestigar, pregunta: string, o: OpcionesInvestigar = {}, alEvento?: (e: EventoInvestigacion) => void): Promise<Extract<EventoInvestigacion, { tipo: 'fin' }> & { plan: PlanInvestigacion | null; pasos: PasoInvestigacion[] }> {
  let plan: PlanInvestigacion | null = null;
  const pasos: PasoInvestigacion[] = [];
  for await (const e of investigar(p, pregunta, o)) {
    alEvento?.(e);
    if (e.tipo === 'plan') plan = e.plan;
    if (e.tipo === 'paso') { const { tipo: _t, ...paso } = e; pasos.push(paso); }
    if (e.tipo === 'fin') return { ...e, plan, pasos };
  }
  throw new Error('La investigación terminó sin resultado.');
}
