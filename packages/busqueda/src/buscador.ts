/**
 * El buscador de Scholaris: puro sobre puertos. Funciona igual en un Durable
 * Object, en Node y en el banco de pruebas.
 *
 *   consulta ─┬─ heurística (comillas, años, autores, «página X») ──────────────┐
 *             ├─ redactor rápido: intención, expansiones, traducciones, filtros │
 *             ├─ vía léxica  (FTS5 / BM25, sin acentos, frases exactas)          ├─ RRF ponderada → fundir contiguos
 *             ├─ vía densa   (Embebedor 'consulta' → IndiceVectorial)            │   → hidratar (SQL) → reordenar → juez
 *             └─ vía visual  (vectores de páginas y figuras)                     ┘
 *
 * Presupuesto: p50 < 600 ms sin respuesta. Todo lo independiente va en
 * paralelo; la comprensión tiene un plazo (si se pasa, se sigue con la
 * heurística y el resultado del modelo queda en caché para la próxima vez); las
 * citas literales van directas a FTS sin modelo ni vectores.
 */
import type { Embebedor, Filtros, Fragmento, IndiceVectorial, Juez, Redactor, Reordenador, Resultado, SQL } from '@scholaris/nucleo';
import { bytesAVector } from '@scholaris/nucleo';
import { CacheLRU, conPlazo } from './cache.js';
import { comprenderConModelo, comprenderSinModelo, unirFiltros } from './comprension.js';
import { Estanteria, type DocumentoBreve } from './estanteria.js';
import { fusionar, K_RRF, limpiar, normalizar, PESOS_POR_INTENCION, sinDuplicados, type Candidato, type ListaVia } from './fusion.js';
import { consultaFts, normalizarConsulta, plegar, resaltar, terminos } from './texto.js';
import type { Comprension, DestinoPagina, Expansion, Intencion, OpcionesBusqueda, RespuestaBusqueda, Via } from './tipos.js';

export interface PuertosBuscador {
  sql: SQL;
  embebedor?: Embebedor;
  indice?: IndiceVectorial;
  /** Espacio de nombres del índice (uno por estantería). */
  espacioNombres?: string;
  redactor?: Redactor;
  reordenador?: Reordenador;
  juez?: Juez;
}

/** Perillas medidas con el banco de calidad (bench/calidad). Los valores por defecto son los ganadores. */
export interface AjustesBusqueda {
  /** Pesos de cada vía por intención (sustituyen a los de PESOS_POR_INTENCION). */
  pesos?: Partial<Record<Intencion, Partial<Record<Via, number>>>>;
  /** Constante k de la fusión por rangos recíprocos. */
  kRrf?: number;
  /** Peso del reordenador frente a la fusión (0-1). */
  pesoReordenador?: number;
  /** Factor por cada acierto más en la misma unidad (1 = sin penalizar). */
  penalizacionUnidad?: number;
  /** Fundir fragmentos contiguos si la llamada no dice nada. */
  fundirContiguos?: boolean;
  /**
   * Llamar al redactor para entender la consulta si la llamada no dice nada (no:
   * en el banco las expansiones no subían el nDCG@10 y la segunda ronda de vectores
   * alargaba la búsqueda; los filtros de años y autores conocidos salen igual de la heurística).
   */
  comprender?: boolean;
  /** En una cita literal, añadir detrás de los pasajes exactos los afines por sentido (sí). */
  literalConAfines?: boolean;
  /** Caracteres de cada pasaje que ve el reordenador. */
  caracteresReordenar?: number;
  /** Margen mínimo entre el 1.º y el 2.º de la fusión (0-1) por debajo del cual se reordena; sin él, siempre. */
  margenReordenar?: number;
  /** Expansiones que pasan también por la vía léxica (por defecto, todas menos el HyDE). */
  expansionesLexicas?: Array<Expansion['tipo']>;
  /** Tipos de expansión de la comprensión que se usan para buscar. */
  expansiones?: Array<Expansion['tipo']>;
}

export interface ConfiguracionBuscador {
  /** Ajustes de la fusión, el reordenador y las expansiones. */
  ajustes?: AjustesBusqueda;
  /** Plazo de la comprensión con modelo antes de seguir sin ella (350 ms). */
  plazoComprensionMs?: number;
  /** Entradas de la caché de comprensiones (500) y de vectores de consulta (2000). */
  cacheComprension?: number;
  cacheVectores?: number;
  /** Resuelve bibliotecas → documentos si no están en la tabla `documentos`. */
  documentosDeBibliotecas?: (bibliotecas: string[]) => Promise<string[]>;
}

const ahora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function igualesFiltros(a: Filtros, b: Filtros): boolean {
  return JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());
}

export class Buscador {
  readonly estanteria: Estanteria;
  private comprensiones: CacheLRU<Comprension>;
  private vectores: CacheLRU<Float32Array>;
  private enVuelo = new Map<string, Promise<Comprension>>();

  constructor(readonly puertos: PuertosBuscador, private config: ConfiguracionBuscador = {}) {
    this.estanteria = new Estanteria(puertos.sql, { ...(config.documentosDeBibliotecas ? { documentosDeBibliotecas: config.documentosDeBibliotecas } : {}) });
    this.comprensiones = new CacheLRU(config.cacheComprension ?? 500, 24 * 3600_000);
    this.vectores = new CacheLRU(config.cacheVectores ?? 2000, 24 * 3600_000);
  }

  private get ajustes(): AjustesBusqueda { return this.config.ajustes ?? {}; }

  private fusionar(listas: ListaVia[], intencion: Intencion): Candidato[] {
    const a = this.ajustes;
    const pesos = a.pesos?.[intencion] ? { ...PESOS_POR_INTENCION[intencion], ...a.pesos[intencion] } : undefined;
    return fusionar(listas, intencion, a.kRrf ?? K_RRF, pesos);
  }

  private get ns(): string { return this.puertos.espacioNombres ?? 'estanteria'; }

  /** Olvida cachés de documentos (llamar tras una ingesta). */
  invalidar(): void { this.estanteria.invalidar(); }

  // -------------------------------------------------------------------------
  // Comprensión y vectores de consulta, con caché
  // -------------------------------------------------------------------------

  /** Entiende la consulta (con caché y deduplicación de peticiones en vuelo). */
  async comprender(consulta: string, conModelo = true): Promise<Comprension> {
    const ctx = await this.estanteria.contexto();
    if (!conModelo || !this.puertos.redactor) return comprenderSinModelo(consulta, ctx);
    const clave = normalizarConsulta(consulta);
    const guardada = this.comprensiones.obtener(clave);
    if (guardada) return { ...guardada, consulta, origen: 'cache' };
    let p = this.enVuelo.get(clave);
    if (!p) {
      p = comprenderConModelo(this.puertos.redactor, consulta, ctx).then((c) => {
        if (c.origen === 'modelo') this.comprensiones.poner(clave, c);
        return c;
      }).finally(() => this.enVuelo.delete(clave));
      this.enVuelo.set(clave, p);
    }
    return p;
  }

  /** Vectores de consulta en UNA llamada al embebedor para todo lo que no esté en caché. */
  async vectorizarConsultas(textos: string[]): Promise<Float32Array[]> {
    const emb = this.puertos.embebedor;
    if (!emb || !textos.length) return [];
    const claves = textos.map((t) => `${emb.espacio.id}|${normalizarConsulta(t)}`);
    const faltan: number[] = [];
    claves.forEach((c, i) => { if (!this.vectores.obtener(c)) faltan.push(i); });
    if (faltan.length) {
      const vs = await emb.vectorizar(faltan.map((i) => ({ modalidad: 'texto' as const, texto: textos[i] as string })), 'consulta');
      faltan.forEach((i, k) => { const v = vs[k]; if (v) this.vectores.poner(claves[i] as string, v); });
    }
    return claves.map((c) => this.vectores.obtener(c)).filter((v): v is Float32Array => !!v);
  }

  // -------------------------------------------------------------------------
  // Vías
  // -------------------------------------------------------------------------

  private async viaLexica(textos: Array<{ texto: string; peso: number }>, k: number, permitidos: Set<string> | null): Promise<ListaVia[]> {
    const normalizada = await this.estanteria.capaNormalizada();
    const listas = await Promise.all(textos.map(async ({ texto, peso }): Promise<ListaVia | null> => {
      const match = consultaFts(texto, { normalizada });
      if (!match) return null;
      try {
        const filas = await this.estanteria.lexica(match, k, permitidos);
        return { via: 'lexica', ids: filas.map((f) => f.id), peso };
      } catch {
        return null; // una consulta FTS rara no tumba la búsqueda
      }
    }));
    return listas.filter((l): l is ListaVia => !!l && l.ids.length > 0);
  }

  private filtroVectorial(objetivo: string | string[], permitidos: Set<string> | null): Record<string, unknown> {
    const f: Record<string, unknown> = { objetivo: Array.isArray(objetivo) ? { $in: objetivo } : objetivo };
    if (permitidos && permitidos.size <= 100) f.documento = { $in: [...permitidos] };
    return f;
  }

  private async viaDensa(vectores: Array<{ v: Float32Array; peso: number }>, k: number, permitidos: Set<string> | null): Promise<ListaVia[]> {
    const indice = this.puertos.indice;
    if (!indice || (permitidos && permitidos.size === 0)) return [];
    const kk = permitidos && permitidos.size > 100 ? k * 3 : k;
    const listas = await Promise.all(vectores.map(async ({ v, peso }) => {
      const r = await indice.consultar(this.ns, v, { k: kk, filtro: this.filtroVectorial('fragmento', permitidos), conMetadatos: true });
      const ids = r.filter((c) => !permitidos || !c.metadatos?.documento || permitidos.has(String(c.metadatos.documento))).map((c) => c.id);
      return { via: 'densa' as const, ids: ids.slice(0, k), peso };
    }));
    return listas.filter((l) => l.ids.length > 0);
  }

  /** Vía visual: vectores de páginas y figuras → fragmentos de esas páginas. */
  private async viaVisual(vectores: Array<{ v: Float32Array; peso: number }>, k: number, permitidos: Set<string> | null, sinteticos: Map<string, Fragmento>): Promise<Array<ListaVia & { porUnidad: Map<string, string[]> }>> {
    const { indice, embebedor } = this.puertos;
    if (!indice || !embebedor?.admite('imagen') || (permitidos && permitidos.size === 0)) return [];
    const salida: Array<ListaVia & { porUnidad: Map<string, string[]> }> = [];
    await Promise.all(vectores.map(async ({ v, peso }) => {
      const r = await indice.consultar(this.ns, v, { k, filtro: this.filtroVectorial(['unidad', 'figura'], permitidos), conMetadatos: true });
      const filtrados = r.filter((c) => !permitidos || !c.metadatos?.documento || permitidos.has(String(c.metadatos.documento)));
      const unidades = new Map(await this.estanteria.unidadesExisten(filtrados.map((c) => c.id)));
      const figurasIds = filtrados.filter((c) => !unidades.has(c.id)).map((c) => c.id);
      const figuras = await this.estanteria.figuras(figurasIds);
      const figuraPorId = new Map(figuras.map((f) => [f.id, f]));
      const unidadesBuscadas = [...new Set([...unidades.keys(), ...figuras.map((f) => f.unidad)])];
      const frags = await this.estanteria.fragmentosDeUnidades(unidadesBuscadas);
      const porUnidad = new Map<string, string[]>();
      for (const f of frags) { const l = porUnidad.get(f.unidad) ?? []; l.push(f.id); porUnidad.set(f.unidad, l); }
      const ids: string[] = [];
      for (const c of filtrados) {
        const unidad = unidades.has(c.id) ? c.id : figuraPorId.get(c.id)?.unidad;
        if (!unidad) continue;
        const enUnidad = porUnidad.get(unidad);
        if (enUnidad?.length) { ids.push(`u:${unidad}`); continue; }
        // Lámina sin texto: un fragmento sintético con el pie de la figura y su ancla.
        const fig = figuraPorId.get(c.id);
        if (fig && (fig.pie || fig.descripcion)) {
          sinteticos.set(fig.id, { id: fig.id, documento: fig.documento, unidad: fig.unidad, orden: -1, texto: [fig.pie, fig.descripcion].filter(Boolean).join('. '), contexto: '', seccion: [], ancla: fig.ancla });
          ids.push(fig.id);
        }
      }
      salida.push({ via: 'visual', ids, peso, porUnidad });
    }));
    return salida;
  }

  // -------------------------------------------------------------------------
  // Búsqueda
  // -------------------------------------------------------------------------

  async buscar(consulta: string, opciones: OpcionesBusqueda = {}): Promise<RespuestaBusqueda> {
    const t0 = ahora();
    const tiempos: Record<string, number> = {};
    const avisos: string[] = [];
    const marca = (fase: string, desde: number) => { tiempos[fase] = Math.round((ahora() - desde) * 10) / 10; };
    const limite = opciones.limite ?? 10;
    const k = opciones.candidatos ?? 40;
    const vias = new Set<Via>(opciones.vias ?? ['lexica', 'densa', 'visual']);
    const explicitos = opciones.filtros ?? {};

    const ctx = await this.estanteria.contexto();
    const heur = comprenderSinModelo(consulta, ctx);

    // «Ir a la página X (de tal libro)»
    if (heur.irA) {
      const destino = await this.resolverIrA(heur.irA, explicitos);
      if (destino) {
        const resultados = await this.resultadosDePagina(destino, consulta);
        tiempos.total = Math.round(ahora() - t0);
        return { resultados, comprension: heur, irA: destino, tiempos, candidatos: resultados.length, avisos };
      }
    }

    // Cita literal: la frase exacta por FTS, sin modelo; los pasajes que la contienen van
    // primero y detrás, si hay vectores, los afines por sentido (en el banco, el pasaje
    // exacto ya salía primero, pero la lista se quedaba en uno o dos resultados).
    if (heur.literales.length && vias.has('lexica')) {
      const tl = ahora();
      const filtros = unirFiltros(explicitos, heur.filtros);
      const permitidos = await this.estanteria.documentosPermitidos(filtros);
      const quiereDensa = vias.has('densa') && !!this.puertos.embebedor && !!this.puertos.indice && this.ajustes.literalConAfines !== false;
      const pDensa = quiereDensa
        ? this.vectorizarConsultas([heur.literales.join(' ')]).then((vs) => this.viaDensa(vs.map((v) => ({ v, peso: 1 })), k, permitidos)).catch(() => [] as ListaVia[])
        : Promise.resolve([] as ListaVia[]);
      const listas = await this.viaLexica([{ texto: consulta, peso: 1 }], k, permitidos);
      marca('lexica', tl);
      if (listas.length) {
        const exactos = new Set(listas.flatMap((l) => l.ids));
        const densas = await pDensa;
        if (densas.length) marca('densa', tl);
        const fusion = this.fusionar([...listas, ...densas], 'cita');
        const ordenados = [...fusion.filter((c) => exactos.has(c.id)), ...fusion.filter((c) => !exactos.has(c.id))];
        // Los exactos por encima de cualquier afín, también tras normalizar las puntuaciones.
        ordenados.forEach((c, i) => { c.puntos = (exactos.has(c.id) ? 2 : 1) - i * 1e-3; });
        const r = await this.terminar(ordenados, heur, filtros, opciones, new Map(), tiempos, avisos, { reordenar: false });
        tiempos.total = Math.round(ahora() - t0);
        return { ...r, comprension: heur, tiempos, avisos };
      }
      void pDensa.catch(() => undefined);
      avisos.push('La frase exacta no aparece; se busca por sentido.');
    }

    // Comprensión (con plazo) en paralelo con la primera ronda de vías.
    const tc = ahora();
    const conModelo = (opciones.comprender ?? this.ajustes.comprender ?? false) && !!this.puertos.redactor;
    const enCache = conModelo ? this.comprensiones.obtener(normalizarConsulta(consulta)) : undefined;
    const compP = conModelo ? this.comprender(consulta, true) : Promise.resolve(heur);
    compP.then(() => marca('comprension', tc), () => undefined);

    const filtrosA = unirFiltros(explicitos, (enCache ?? heur).filtros);
    const permitidosA = await this.estanteria.documentosPermitidos(filtrosA);
    const sinteticos = new Map<string, Fragmento>();
    const listas: ListaVia[] = [];
    const porUnidadVisual = new Map<string, string[]>();
    const quiereVectores = (vias.has('densa') || vias.has('visual')) && !!this.puertos.embebedor && !!this.puertos.indice;

    // Textos de la primera ronda: con caché de comprensión, ya van todas las expansiones.
    const expansionesA = enCache ? enCache.expansiones.filter((e) => e.tipo === 'original' || (this.ajustes.expansiones ?? ['parafrasis', 'enunciado', 'hyde', 'traduccion']).includes(e.tipo)) : [{ texto: consulta, tipo: 'original' as const, peso: 1 }];
    const ronda = async (exps: Array<{ texto: string; peso: number; tipo: string }>, permitidos: Set<string> | null, fase: string) => {
      const tr = ahora();
      // El HyDE es largo: solo para vectores. Las demás expansiones, las que digan los ajustes.
      const tiposLex = this.ajustes.expansionesLexicas ?? [];
      const lexicas = exps.filter((e) => e.tipo !== 'hyde' && (!tiposLex || e.tipo === 'original' || tiposLex.includes(e.tipo as Expansion['tipo'])));
      const pLex = vias.has('lexica') ? this.viaLexica(lexicas, k, permitidos).then((l) => { marca(`lexica${fase}`, tr); return l; }) : Promise.resolve([]);
      const pVec = quiereVectores
        ? this.vectorizarConsultas(exps.map((e) => e.texto)).then(async (vs) => {
          marca(`vectorizacion${fase}`, tr);
          const conPeso = vs.map((v, i) => ({ v, peso: exps[i]?.peso ?? 1 }));
          const [d, vi] = await Promise.all([
            vias.has('densa') ? this.viaDensa(conPeso, k, permitidos) : Promise.resolve([]),
            // La vía visual solo con la consulta original y su enunciado: el HyDE la despista.
            // Con filtro de documentos se pide más: Vectorize no indexa «documento» y el filtro se aplica después.
            vias.has('visual') ? this.viaVisual(conPeso.filter((_, i) => exps[i]?.tipo !== 'hyde').slice(0, 2), permitidos ? Math.min(100, k * 5) : Math.ceil(k / 2), permitidos, sinteticos) : Promise.resolve([]),
          ]);
          marca(`vectores${fase}`, tr);
          return [d, vi] as const;
        }).catch((e) => { avisos.push(`Vía densa no disponible: ${(e as Error).message}`); return [[], []] as const; })
        : Promise.resolve([[], []] as const);
      const [lex, [densas, visuales]] = await Promise.all([pLex, pVec]);
      listas.push(...lex, ...densas);
      for (const v of visuales) {
        listas.push(v);
        for (const [u, ids] of v.porUnidad) porUnidadVisual.set(u, ids);
      }
    };

    const primera = ronda(expansionesA, permitidosA, 'A');
    let comprension: Comprension = enCache ? { ...enCache, consulta, origen: 'cache' } : heur;
    if (conModelo && !enCache) {
      const c = await conPlazo(compP, this.config.plazoComprensionMs ?? 350);
      if (c) comprension = c;
      else avisos.push('La comprensión de la consulta tardó demasiado; se usa la heurística.');
    }
    const filtros = unirFiltros(explicitos, comprension.filtros);
    let permitidos = permitidosA;
    if (!igualesFiltros(filtros, filtrosA)) permitidos = await this.estanteria.documentosPermitidos(filtros);
    const usar = new Set(this.ajustes.expansiones ?? ['parafrasis', 'enunciado', 'hyde', 'traduccion']);
    const extra = enCache ? [] : comprension.expansiones.filter((e) => e.tipo !== 'original' && usar.has(e.tipo));
    await Promise.all([primera, extra.length ? ronda(extra, permitidos, 'B') : Promise.resolve()]);

    // Fusión: los aciertos visuales «u:unidad» se traducen al mejor fragmento de esa unidad.
    const tf = ahora();
    const previos = this.fusionar(listas.filter((l) => l.via !== 'visual'), comprension.intencion);
    const rango = new Map(previos.map((c, i) => [c.id, i]));
    for (const l of listas) {
      if (l.via !== 'visual') continue;
      l.ids = l.ids.map((id) => {
        if (!id.startsWith('u:')) return id;
        const enUnidad = porUnidadVisual.get(id.slice(2)) ?? [];
        return [...enUnidad].sort((a, b) => (rango.get(a) ?? 1e9) - (rango.get(b) ?? 1e9))[0] ?? id;
      }).filter((id) => !id.startsWith('u:'));
    }
    const fusionados = this.fusionar(listas, comprension.intencion);
    marca('fusion', tf);
    const r = await this.terminar(fusionados, comprension, filtros, opciones, sinteticos, tiempos, avisos, {}, permitidos);
    tiempos.total = Math.round(ahora() - t0);
    return { ...r, comprension, tiempos, avisos };
  }

  /** Hidrata, filtra, funde contiguos, reordena, juzga y resalta. */
  private async terminar(
    fusionados: Candidato[], comprension: Comprension, filtros: Filtros, opciones: OpcionesBusqueda,
    sinteticos: Map<string, Fragmento>, tiempos: Record<string, number>, avisos: string[],
    forzar: { reordenar?: boolean } = {}, permitidosPrevios?: Set<string> | null,
  ): Promise<Omit<RespuestaBusqueda, 'comprension' | 'tiempos' | 'avisos'>> {
    const limite = opciones.limite ?? 10;
    const top = Math.max(limite, opciones.reordenarTop ?? 30);
    const th = ahora();
    const permitidos = permitidosPrevios !== undefined ? permitidosPrevios : await this.estanteria.documentosPermitidos(filtros);
    const ids = fusionados.slice(0, top * 2).map((c) => c.id);
    const [frags, { porId: docs }] = await Promise.all([this.estanteria.fragmentos(ids.filter((id) => !sinteticos.has(id))), this.estanteria.documentos()]);
    for (const [id, f] of sinteticos) frags.set(id, f);
    // Filtros en SQL siempre: el índice vectorial solo prefiltra.
    let candidatos = fusionados.filter((c) => {
      const f = frags.get(c.id);
      return f && docs.has(f.documento) && (!permitidos || permitidos.has(f.documento));
    });
    candidatos = limpiar(sinDuplicados(candidatos, frags), frags, opciones.fundirContiguos ?? this.ajustes.fundirContiguos ?? false, this.ajustes.penalizacionUnidad ?? 1).slice(0, top);
    tiempos.hidratacion = Math.round((ahora() - th) * 10) / 10;

    // Reordenación sobre el texto (no sobre la imagen).
    let puntuaciones = normalizar(candidatos.map((c) => c.puntos));
    const margen = this.ajustes.margenReordenar;
    const p0 = candidatos[0]?.puntos ?? 0, p1 = candidatos[1]?.puntos ?? 0;
    const clara = margen !== undefined && p0 > 0 && (p0 - p1) / p0 >= margen;
    const reordenar = (forzar.reordenar ?? opciones.reordenar ?? true) && !!this.puertos.reordenador && candidatos.length > 1 && !clara;
    if (reordenar && opciones.alPreliminar) {
      // Respuesta rápida: el orden de la fusión, antes de esperar al reordenador.
      try {
        const ts = terminos(comprension.consulta);
        opciones.alPreliminar(candidatos.slice(0, limite).map((c, i) => {
          const f = frags.get(c.id) as Fragmento;
          return { fragmento: f, documento: docs.get(f.documento) as DocumentoBreve, puntuacion: Math.round((puntuaciones[i] ?? 0) * 1e4) / 1e4, vias: [...c.vias].sort(), resaltado: resaltar(f.texto, ts) };
        }));
      } catch { /* un oyente roto no tumba la búsqueda */ }
    }
    if (reordenar) {
      const tr = ahora();
      try {
        const textos = candidatos.map((c) => {
          const f = frags.get(c.id) as Fragmento;
          return `${f.seccion.length ? f.seccion.join(' › ') + '\n' : ''}${f.texto}`.slice(0, this.ajustes.caracteresReordenar ?? 2000);
        });
        const r = await this.puertos.reordenador!.reordenar(comprension.consulta, textos);
        const nr = normalizar(r);
        // Fusión ponderada: 0,2 la fusión y 0,8 el reordenador (Jev), medido con el banco.
        const w = this.ajustes.pesoReordenador ?? 0.8;
        puntuaciones = puntuaciones.map((p, i) => (1 - w) * p + w * (nr[i] ?? 0));
      } catch (e) {
        avisos.push(`Reordenador no disponible: ${(e as Error).message}`);
      }
      tiempos.reordenacion = Math.round((ahora() - tr) * 10) / 10;
    }
    let orden = candidatos.map((c, i) => ({ c, p: puntuaciones[i] ?? 0 })).sort((a, b) => b.p - a.p);

    if (opciones.juez && this.puertos.juez && orden.length) {
      const tj = ahora();
      try {
        const evaluar = orden.slice(0, Math.min(orden.length, limite + 5));
        const pasajes: Record<string, string> = {};
        const preguntas: Record<string, { tipo: 'si_no'; instrucciones: string; criterios: { si: string; no: string } }> = {};
        evaluar.forEach((x, i) => {
          pasajes[`r${i}`] = (frags.get(x.c.id) as Fragmento).texto.slice(0, 1500);
          preguntas[`r${i}`] = {
            tipo: 'si_no',
            instrucciones: `Does the passage \`pasajes.r${i}\` contain information that helps answer the search query \`consulta\`?`,
            criterios: { si: 'The passage addresses what the query asks for.', no: 'The passage is off-topic or only shares words with the query.' },
          };
        });
        const r = await this.puertos.juez.juzgar({ consulta: comprension.consulta, pasajes }, preguntas);
        const umbral = opciones.umbralJuez ?? 0.15;
        orden = evaluar
          .map((x, i) => {
            const res = r[`r${i}`];
            const prob = res?.tipo === 'si_no' ? res.probabilidad : 0.5;
            return { c: x.c, p: 0.5 * x.p + 0.5 * prob, prob };
          })
          .filter((x) => x.prob >= umbral)
          .sort((a, b) => b.p - a.p);
      } catch (e) {
        avisos.push(`Juez no disponible: ${(e as Error).message}`);
      }
      tiempos.juez = Math.round((ahora() - tj) * 10) / 10;
    }

    const terminosResaltado = [
      ...terminos(comprension.consulta),
      ...comprension.literales.flatMap((l) => terminos(l, { conVacias: true })),
      ...Object.values(comprension.traducciones).flatMap((t) => terminos(t)),
    ];
    const resultados: Resultado[] = orden.slice(0, limite).map(({ c, p }) => {
      const f = frags.get(c.id) as Fragmento;
      const d = docs.get(f.documento) as DocumentoBreve;
      return {
        fragmento: f,
        documento: d,
        puntuacion: Math.round(p * 1e4) / 1e4,
        vias: [...c.vias].sort(),
        resaltado: resaltar(f.texto, terminosResaltado),
      };
    });
    return { resultados, candidatos: fusionados.length };
  }

  // -------------------------------------------------------------------------
  // Ir a la página
  // -------------------------------------------------------------------------

  /** «Ir a la página X» en un documento. */
  async irAPagina(documento: string, folio: string): Promise<DestinoPagina | null> {
    const r = await this.estanteria.paginaImpresa(documento, folio);
    return r ? { documento, ...r } : null;
  }

  private async resolverIrA(irA: { folio: string; pista?: string }, filtros: Filtros): Promise<DestinoPagina | null> {
    let documento: string | undefined;
    if (filtros.documentos?.length === 1) documento = filtros.documentos[0];
    else if (irA.pista) documento = (await this.buscarDocumentos(irA.pista, { limite: 1 }))[0]?.documento.id;
    else {
      const { filas } = await this.estanteria.documentos();
      if (filas.length === 1) documento = filas[0]?.id;
    }
    return documento ? this.irAPagina(documento, irA.folio) : null;
  }

  private async resultadosDePagina(destino: DestinoPagina, consulta: string): Promise<Resultado[]> {
    const filas = await this.estanteria.fragmentosDeUnidades([destino.unidad]);
    const frags = await this.estanteria.fragmentos(filas.map((f) => f.id));
    const { porId } = await this.estanteria.documentos();
    const d = porId.get(destino.documento);
    if (!d) return [];
    return filas.map((f) => frags.get(f.id)).filter((f): f is Fragmento => !!f).map((f, i) => ({
      fragmento: f, documento: d, puntuacion: 1 - i * 0.01, vias: ['lexica'], resaltado: resaltar(f.texto, terminos(consulta)),
    }));
  }

  // -------------------------------------------------------------------------
  // Documentos y «más como esto»
  // -------------------------------------------------------------------------

  /** Búsqueda a nivel de documento por título, subtítulo, autores y año. */
  async buscarDocumentos(texto: string, opciones: { limite?: number; filtros?: Filtros } = {}): Promise<Array<{ documento: DocumentoBreve; puntuacion: number }>> {
    const { filas } = await this.estanteria.documentos();
    const permitidos = opciones.filtros ? await this.estanteria.documentosPermitidos(opciones.filtros) : null;
    const ts = terminos(texto);
    const frase = plegar(texto).replace(/\s+/g, ' ').trim();
    const anios = (texto.match(/\b\d{4}\b/g) ?? []).map(Number);
    const salida: Array<{ documento: DocumentoBreve; puntuacion: number }> = [];
    for (const d of filas) {
      if (permitidos && !permitidos.has(d.id)) continue;
      const m = d.metadatos;
      const titulo = plegar(`${m.titulo} ${m.subtitulo ?? ''}`);
      const autores = plegar([...m.autores, ...(m.editores ?? [])].map((a) => `${a.nombre} ${a.apellidos}`).join(' '));
      const palabrasTitulo = new Set(terminos(titulo));
      const palabrasAutor = new Set(terminos(autores));
      let p = 0;
      for (const t of ts) {
        if (palabrasAutor.has(t)) p += 1.5;
        else if (palabrasTitulo.has(t)) p += 1;
        else if (t.length >= 4 && [...palabrasTitulo].some((w) => w.startsWith(t))) p += 0.5;
      }
      if (frase.length > 3 && titulo.includes(frase)) p += 3;
      const anio = m.anio, original = m.anioOriginal;
      if (anios.some((a) => a === anio || a === original)) p += 1;
      if (p > 0) salida.push({ documento: d, puntuacion: ts.length ? p / (ts.length * 1.5 + 3) : p });
    }
    return salida.sort((a, b) => b.puntuacion - a.puntuacion).slice(0, opciones.limite ?? 10);
  }

  /** «Más como esto»: pasajes parecidos a un fragmento, de otros sitios de la estantería. */
  async similares(fragmentoId: string, opciones: { limite?: number; filtros?: Filtros; mismoDocumento?: boolean } = {}): Promise<Resultado[]> {
    const limite = opciones.limite ?? 10;
    const base = (await this.estanteria.fragmentos([fragmentoId])).get(fragmentoId);
    if (!base) return [];
    const permitidos = await this.estanteria.documentosPermitidos(opciones.filtros ?? {});
    const listas: ListaVia[] = [];
    const { embebedor, indice } = this.puertos;
    const tareas: Promise<void>[] = [];
    if (embebedor && indice) {
      tareas.push((async () => {
        const guardado = await this.estanteria.vector('fragmento', fragmentoId, embebedor.espacio.id).catch(() => null);
        const v = guardado ? bytesAVector(guardado) : (await embebedor.vectorizar([{ modalidad: 'texto', texto: `${base.contexto}\n${base.texto}` }], 'documento'))[0];
        if (v) listas.push(...(await this.viaDensa([{ v, peso: 1 }], limite * 4, permitidos)));
      })());
    }
    // Léxica: los términos más largos del pasaje como aproximación a los más raros.
    const distintivos = [...new Set(terminos(base.texto))].sort((a, b) => b.length - a.length).slice(0, 12);
    if (distintivos.length) tareas.push(this.viaLexica([{ texto: distintivos.join(' '), peso: 0.7 }], limite * 4, permitidos).then((l) => { listas.push(...l); }));
    await Promise.all(tareas);
    const fusionados = this.fusionar(listas, 'conceptual');
    const frags = await this.estanteria.fragmentos(fusionados.slice(0, limite * 4).map((c) => c.id));
    const { porId } = await this.estanteria.documentos();
    const candidatos = limpiar(fusionados.filter((c) => {
      const f = frags.get(c.id);
      if (!f || c.id === fragmentoId || !porId.has(f.documento)) return false;
      if (f.documento === base.documento) {
        if (opciones.mismoDocumento === false) return false;
        if (Math.abs(f.orden - base.orden) <= 1) return false;
      }
      return true;
    }), frags);
    const ps = normalizar(candidatos.map((c) => c.puntos));
    const ts = terminos(base.texto).slice(0, 30);
    return candidatos.slice(0, limite).map((c, i) => {
      const f = frags.get(c.id) as Fragmento;
      return { fragmento: f, documento: porId.get(f.documento) as DocumentoBreve, puntuacion: Math.round((ps[i] ?? 0) * 1e4) / 1e4, vias: [...c.vias].sort(), resaltado: resaltar(f.texto, ts) };
    });
  }
}
