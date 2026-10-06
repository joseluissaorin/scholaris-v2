import { beforeAll, describe, expect, it } from 'vitest';
import type { Fragmento } from '@scholaris/nucleo';
import { Buscador, IndiceVectorialSQL, analizarHeuristico, sinDuplicados, consultaFts, intencionHeuristica, plegar, resaltar, responder, responderCompleto } from '../src/index.js';
import { EmbebedorFalso, JuezFalso, RedactorFalso, RedactorFalsoConFlujo, ReordenadorFalso } from './apoyo/falsos.js';
import { cargarFixtura, contarFragmentos } from './apoyo/fixtura.js';
import { crearSQL, type SQLMedido } from './apoyo/sql-node.js';

async function montar(lat: { redactor?: number; emb?: number; reord?: number; juez?: number } = {}, plazo?: number) {
  const sql = crearSQL();
  const embebedor = new EmbebedorFalso(0);
  await cargarFixtura(sql, embebedor);
  embebedor.latencia = lat.emb ?? 0;
  const redactor = new RedactorFalso(lat.redactor ?? 0);
  const reordenador = new ReordenadorFalso(lat.reord ?? 0);
  const juez = new JuezFalso(lat.juez ?? 0);
  const indice = new IndiceVectorialSQL(sql, embebedor.espacio);
  const buscador = new Buscador({ sql, embebedor, indice, redactor, reordenador, juez, espacioNombres: 'pruebas' }, { plazoComprensionMs: plazo ?? 2000, ajustes: { comprender: true } });
  return { sql, embebedor, redactor, reordenador, juez, indice, buscador };
}

describe('texto', () => {
  it('pliega sin cambiar la longitud', () => {
    const s = 'Panóptico: CÁRCEL, ñandú, Ægidius';
    expect(plegar(s).length).toBe(s.length);
    expect(plegar(s)).toContain('panoptico: carcel, nandu');
  });
  it('escapa la sintaxis de FTS5 y respeta las frases', () => {
    expect(consultaFts('NEAR(a b) OR "x')).toBe('"near"');
    expect(consultaFts('el panóptico de Bentham')).toBe('"panoptico" OR "bentham"');
    expect(consultaFts('«ver y ser visto» Foucault')).toBe('"ver y ser visto"');
    expect(consultaFts('ser o no ser')).toBe('"ser" OR "no"');
    expect(consultaFts('***')).toBeNull();
  });
  it('resalta sin importar acentos y escapa HTML', () => {
    const r = resaltar('El <Panóptico> de Bentham y la vigilancia', ['panoptico', 'vigilancia']);
    expect(r).toBe('El &lt;<mark>Panóptico</mark>&gt; de Bentham y la <mark>vigilancia</mark>');
  });
});

describe('marcas de hablante en el resaltado', () => {
  const turno = (n: number) => `palabra${n} relleno de la conversación que sigue y sigue`;
  const larga = `**Julio Cortázar:** ${Array.from({ length: 12 }, (_, i) => turno(i)).join(' ')} Sí, exacto. **Joaquín Soler Serrano:** ¿Y el jazz? **Julio Cortázar:** El jazz es la libertad. ${Array.from({ length: 12 }, (_, i) => turno(i + 20)).join(' ')}`;
  it('ningún asterisco llega al resaltado, aunque la ventana parta la marca', () => {
    for (const q of [['jazz'], ['exacto'], ['libertad'], ['palabra11'], ['palabra25']]) {
      for (const v of [40, 90, 160, 280]) {
        const r = resaltar(larga, q, v);
        expect(r, `${q} ${v}`).not.toContain('*');
      }
    }
  });
  it('los turnos salen como etiqueta propia, también el que estaba en curso', () => {
    const r = resaltar(larga, ['jazz'], 120);
    expect(r).toContain('<b class="hablante">Joaquín Soler Serrano</b> ¿Y el <mark>jazz</mark>?');
    expect(r).toMatch(/^…<b class="hablante">Julio Cortázar<\/b> /);
  });
  it('quita las marcas partidas en los bordes del fragmento', () => {
    expect(resaltar('errano:** ¿Y el jazz? Mucho. **Julio Cort', ['jazz'])).toBe('¿Y el <mark>jazz</mark>? Mucho.');
  });
});

describe('comprensión heurística', () => {
  it('extrae autores conocidos y años', () => {
    const h = analizarHeuristico('el poder en Foucault antes de 1980', { autores: ['Foucault', 'Lewis'] });
    expect(h.filtros).toEqual({ anioHasta: 1979, autores: ['Foucault'] });
    expect(analizarHeuristico('cosmos entre 1960 y 1970').filtros).toEqual({ anioDesde: 1960, anioHasta: 1970 });
    expect(analizarHeuristico('libertad después de 2000').filtros).toEqual({ anioDesde: 2001 });
  });
  it('reconoce «ir a la página» y las citas', () => {
    expect(analizarHeuristico('página 199 de Vigilar y castigar').irA).toEqual({ folio: '199', pista: 'Vigilar y castigar' });
    expect(analizarHeuristico('ir a la p. xiv').irA).toEqual({ folio: 'xiv' });
    expect(intencionHeuristica('«ver y ser visto»')).toBe('cita');
    expect(intencionHeuristica('lámina de las esferas')).toBe('visual');
    expect(intencionHeuristica('¿cuándo se escribió?')).toBe('temporal');
  });
});

describe('Buscador', () => {
  let m: Awaited<ReturnType<typeof montar>>;
  beforeAll(async () => { m = await montar(); });

  it('la fixtura tiene 30 fragmentos en 4 documentos', () => {
    expect(contarFragmentos()).toBe(30);
  });

  it('encuentra el panóptico por las tres vías, sin acentos, con resaltado', async () => {
    const r = await m.buscador.buscar('panoptico y vigilancia');
    const ids = r.resultados.map((x) => x.fragmento.id);
    expect(ids.slice(0, 3).some((id) => ['fr-fou-06', 'fr-fou-07', 'fr-fou-08'].includes(id))).toBe(true);
    const primero = r.resultados[0]!;
    expect(primero.vias).toContain('lexica');
    expect(primero.vias).toContain('densa');
    expect(primero.resaltado).toMatch(/<mark>Panóptico<\/mark>/);
    expect(primero.documento.metadatos.titulo).toBe('Vigilar y castigar');
    expect(r.comprension.origen).toBe('modelo');
    expect(r.tiempos.total).toBeGreaterThanOrEqual(0);
  });

  it('funde fragmentos contiguos solo si se pide', async () => {
    const r = await m.buscador.buscar('panóptico torre anillo visibilidad', { fundirContiguos: true });
    const fou = r.resultados.filter((x) => ['fr-fou-06', 'fr-fou-07', 'fr-fou-08'].includes(x.fragmento.id));
    expect(fou.length).toBeLessThanOrEqual(2);
    const sinFundir = await m.buscador.buscar('panóptico torre anillo visibilidad');
    expect(sinFundir.resultados.filter((x) => x.fragmento.documento === 'doc-foucault').length).toBeGreaterThan(fou.length);
  });

  it('no devuelve dos veces el mismo pasaje (mismo id, o mismo documento, ancla y texto)', async () => {
    const r = await m.buscador.buscar('panóptico torre anillo visibilidad', { limite: 30 });
    const ids = r.resultados.map((x) => x.fragmento.id);
    expect(new Set(ids).size).toBe(ids.length);
    const claves = r.resultados.map((x) => `${x.documento.id}|${JSON.stringify(x.fragmento.ancla)}|${x.fragmento.texto.slice(0, 120)}`);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('busca entre lenguas: la rueda de la Fortuna llega al latín y al inglés', async () => {
    const r = await m.buscador.buscar('la rueda de la fortuna');
    const docs = new Set(r.resultados.slice(0, 5).map((x) => x.documento.id));
    expect(docs.has('doc-boecio')).toBe(true);
    expect(docs.has('doc-lewis')).toBe(true);
    expect(r.comprension.traducciones.la).toContain('rota');
  });

  it('aplica los filtros dichos en lenguaje natural', async () => {
    const r = await m.buscador.buscar('vigilancia del poder antes de 1980');
    expect(r.comprension.filtros.anioHasta).toBe(1979);
    expect(r.resultados.length).toBeGreaterThan(0);
    expect(r.resultados.every((x) => x.documento.id !== 'doc-serrat')).toBe(true);
    const f = await m.buscador.buscar('la libertad en Serrat');
    expect(f.resultados.every((x) => x.documento.id === 'doc-serrat')).toBe(true);
  });

  it('el año que filtra es el de la obra original', async () => {
    // Vigilar y castigar: edición de 2002, original de 1975.
    const r = await m.buscador.buscar('disciplina', { filtros: { anioHasta: 1980 } });
    expect(r.resultados.some((x) => x.documento.id === 'doc-foucault')).toBe(true);
  });

  it('respeta los filtros explícitos de idioma y documento', async () => {
    const r = await m.buscador.buscar('fortuna', { filtros: { idiomas: ['la'] } });
    expect(r.resultados.length).toBeGreaterThan(0);
    expect(r.resultados.every((x) => x.documento.id === 'doc-boecio')).toBe(true);
    const d = await m.buscador.buscar('cuerpo', { filtros: { documentos: ['doc-foucault'] } });
    expect(d.resultados.every((x) => x.documento.id === 'doc-foucault')).toBe(true);
  });

  it('las citas literales van a FTS sin modelo; el pasaje exacto primero y detrás los afines', async () => {
    const llamadasR = m.redactor.contador.llamadas, llamadasE = m.embebedor.contador.llamadas;
    const r = await m.buscador.buscar('"ver y ser visto"');
    expect(r.resultados[0]!.fragmento.id).toBe('fr-fou-08');
    expect(r.resultados.length).toBeGreaterThan(1);
    expect(r.comprension.intencion).toBe('cita');
    expect(m.redactor.contador.llamadas).toBe(llamadasR);
    expect(m.embebedor.contador.llamadas).toBeLessThanOrEqual(llamadasE + 1);
    expect(r.resultados[0]!.resaltado).toContain('<mark>ver</mark> y <mark>ser</mark> <mark>visto</mark>');
  });

  it('la vía visual encuentra una lámina sin texto', async () => {
    const r = await m.buscador.buscar('lámina de las esferas del cosmos', { vias: ['visual'] });
    const fig = r.resultados.find((x) => x.fragmento.id === 'fg-lew-01');
    expect(fig).toBeDefined();
    expect(fig!.vias).toEqual(['visual']);
    expect(fig!.fragmento.ancla).toMatchObject({ tipo: 'pagina', fisica: 109 });
  });

  it('resuelve «ir a la página X»', async () => {
    const r = await m.buscador.buscar('página 199 de Vigilar y castigar');
    expect(r.irA).toMatchObject({ documento: 'doc-foucault', unidad: 'un-fou-199', fragmento: 'fr-fou-06' });
    expect(r.resultados.map((x) => x.fragmento.id)).toEqual(['fr-fou-06', 'fr-fou-07']);
    expect(await m.buscador.irAPagina('doc-foucault', 'XIV')).toMatchObject({ unidad: 'un-fou-xiv' });
    // Sin folio impreso, la página física.
    expect(await m.buscador.irAPagina('doc-lewis', '109')).toMatchObject({ unidad: 'un-lew-099' });
    expect(await m.buscador.irAPagina('doc-lewis', '5000')).toBeNull();
  });

  it('busca documentos por título, autor y año', async () => {
    const r = await m.buscador.buscarDocumentos('Lewis discarded image');
    expect(r[0]!.documento.id).toBe('doc-lewis');
    expect((await m.buscador.buscarDocumentos('vigilar 1975'))[0]!.documento.id).toBe('doc-foucault');
    expect((await m.buscador.buscarDocumentos('boecio consolatione'))[0]!.documento.id).toBe('doc-boecio');
  });

  it('más como esto: excluye el propio fragmento y sus vecinos', async () => {
    const r = await m.buscador.similares('fr-fou-07');
    const ids = r.map((x) => x.fragmento.id);
    expect(ids).not.toContain('fr-fou-07');
    expect(ids).not.toContain('fr-fou-06');
    expect(ids).not.toContain('fr-fou-08');
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain('fr-ser-04'); // la vigilancia del poder, en la entrevista
  });

  it('el juez filtra lo que no responde', async () => {
    const sin = await m.buscador.buscar('felicidad y dios');
    const r = await m.buscador.buscar('felicidad y dios', { juez: true, umbralJuez: 0.3 });
    expect(m.juez.contador.llamadas).toBe(1);
    expect(r.resultados.length).toBeGreaterThan(0);
    expect(r.resultados.length).toBeLessThan(sin.resultados.length);
    expect(r.resultados[0]!.documento.id).toBe('doc-boecio');
  });

  it('no se rompe con consultas hostiles', async () => {
    for (const q of ['NEAR(', '"', '*', 'AND OR NOT', "'; DROP TABLE fragmentos; --", '']) {
      const r = await m.buscador.buscar(q);
      expect(Array.isArray(r.resultados)).toBe(true);
    }
    const n = await m.sql.ejecutar<{ n: number }>('SELECT count(*) AS n FROM fragmentos');
    expect(n[0]!.n).toBe(30);
  });
});

describe('caché y plazos', () => {
  it('cachea la comprensión y los vectores de consulta', async () => {
    const m = await montar();
    await m.buscador.buscar('el cuerpo dócil');
    const r1 = m.redactor.contador.llamadas, e1 = m.embebedor.contador.llamadas;
    const r = await m.buscador.buscar('El  cuerpo DÓCIL');
    expect(m.redactor.contador.llamadas).toBe(r1);
    expect(m.embebedor.contador.llamadas).toBe(e1);
    expect(r.comprension.origen).toBe('cache');
    expect(r.resultados[0]!.fragmento.id).toBe('fr-fou-04');
  });

  it('con caché, todas las expansiones van en una sola llamada al embebedor', async () => {
    const m = await montar();
    await m.buscador.comprender('la rueda de la fortuna');
    const antes = m.embebedor.contador.llamadas;
    await m.buscador.buscar('la rueda de la fortuna');
    expect(m.embebedor.contador.llamadas - antes).toBe(1);
  });

  it('si la comprensión se pasa del plazo, sigue con la heurística y la guarda para después', async () => {
    const m = await montar({ redactor: 300 }, 50);
    const r = await m.buscador.buscar('disciplina del cuerpo');
    expect(r.comprension.origen).toBe('heuristica');
    expect(r.avisos.join(' ')).toMatch(/tardó demasiado/);
    expect(r.resultados.length).toBeGreaterThan(0);
    await new Promise((res) => setTimeout(res, 320));
    const r2 = await m.buscador.buscar('disciplina del cuerpo');
    expect(r2.comprension.origen).toBe('cache');
  });

  it('si el redactor falla, la búsqueda sigue', async () => {
    const m = await montar();
    m.redactor.fallar = true;
    const r = await m.buscador.buscar('cárcel y libertad');
    expect(r.comprension.origen).toBe('heuristica');
    expect(r.resultados.length).toBeGreaterThan(0);
  });
});

describe('responder', () => {
  it('solo deja citar pasajes del contexto y resuelve las notas por el ancla', async () => {
    const m = await montar();
    const r = await responderCompleto(m.buscador, m.redactor, '¿Qué efecto tiene el panóptico sobre el detenido?');
    expect(r.descartadas).toEqual(['F99', 'frinventado']);
    expect(r.fuentes.length).toBe(2);
    expect(r.markdown).not.toMatch(/\[F\d+|frinventado/);
    expect(r.markdown).toMatch(/\[\^1\]\./);
    expect(r.markdown).toContain('[^2][^1]');
    // La nota sale del ancla, no del modelo.
    for (const f of r.fuentes) {
      const res = r.busqueda.resultados.find((x) => x.fragmento.id === f.fragmento);
      expect(res).toBeDefined();
      expect(r.markdown).toContain(`[^${f.n}]: `);
    }
    expect(r.literalesNoVerificados).toEqual(['una frase que no existe en ningún pasaje del contexto']);
    expect(r.avisos.length).toBeGreaterThanOrEqual(2);
  });

  it('las notas de un fragmento que cruza páginas imprimen el rango', async () => {
    const m = await montar();
    const r = await responderCompleto(m.buscador, m.redactor, 'estado consciente y permanente de visibilidad', { busqueda: { fundirContiguos: false } });
    const nota = r.fuentes.find((f) => f.fragmento === 'fr-fou-07');
    expect(nota?.nota).toBe('Foucault, *Vigilar y castigar* (1975/2002), pp. 199-200.');
  });

  it('en streaming, ningún delta deja ver una marca sin resolver', async () => {
    const m = await montar();
    const redactor = new RedactorFalsoConFlujo();
    const deltas: string[] = [];
    let fin: string | undefined;
    for await (const e of responder(m.buscador, redactor, 'la disciplina y los cuerpos dóciles')) {
      if (e.tipo === 'texto') deltas.push(e.delta);
      if (e.tipo === 'fin') fin = e.markdown;
    }
    expect(deltas.length).toBeGreaterThan(5);
    for (const d of deltas) expect(d).not.toMatch(/\[F|F\d+\]|frinv/);
    expect(fin).toContain('[^1]');
  });

  it('sin resultados lo dice y no inventa', async () => {
    const m = await montar();
    const r = await responderCompleto(m.buscador, m.redactor, 'xyzzy', { busqueda: { vias: ['lexica'] } });
    expect(r.fuentes).toEqual([]);
    expect(r.markdown).toMatch(/No he encontrado/);
  });
});

describe('latencia (puertos falsos con latencias realistas)', () => {
  it('p50 < 600 ms sin respuesta', async () => {
    // Redactor rápido 300 ms, embebedor 90 ms, reordenador 120 ms; índice de fuerza bruta en SQL.
    const m = await montar({ redactor: 300, emb: 90, reord: 120 }, 350);
    const consultas = ['vigilancia y poder', 'la rueda de la fortuna', 'cuerpos dóciles', 'el cosmos medieval', 'censura y canción', 'felicidad y dios',
      'prisión y libertad', 'el modelo del universo', 'castigo público', 'Machado y la poesía', 'Boecio en la cárcel', 'esferas transparentes'];
    const frio: number[] = [], caliente: number[] = [];
    for (const q of consultas) { const t = performance.now(); await m.buscador.buscar(q); frio.push(performance.now() - t); }
    for (const q of consultas) { const t = performance.now(); await m.buscador.buscar(q); caliente.push(performance.now() - t); }
    const t = performance.now(); await m.buscador.buscar('"ver y ser visto"'); const literal = performance.now() - t;
    const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;
    console.log(`latencia fría p50=${p50(frio).toFixed(0)} ms p95=${p95(frio).toFixed(0)} ms · caliente p50=${p50(caliente).toFixed(0)} ms · literal=${literal.toFixed(1)} ms`);
    expect(p50(frio)).toBeLessThan(600);
    expect(p50(caliente)).toBeLessThan(300);
    expect(literal).toBeLessThan(50 + 90); // FTS + un vector de consulta para los afines
  }, 60_000);
});

export type { SQLMedido };

describe('sin repetidos', () => {
  it('quita el mismo pasaje con otro id (copia del documento o reintento de ingesta) y conserva sus vías', () => {
    const ancla = { tipo: 'pagina' as const, fisica: 3, impresa: '3', romana: false, origen: 'leido' as const, confianza: 1 };
    const texto = 'El panóptico de Bentham es una figura arquitectónica de la vigilancia, una torre en el centro de un anillo.';
    const f = (id: string, documento: string, t = texto): [string, Fragmento] => [id, { id, documento, unidad: `${documento}-u3`, orden: 1, texto: t, contexto: '', seccion: [], ancla }];
    const frags = new Map([f('a', 'd1'), f('b', 'd1'), f('c', 'd2'), f('d', 'd1', 'Otro pasaje distinto de la misma página, con su propio texto y bastante largo.')]);
    const cs = [
      { id: 'a', puntos: 4, vias: new Set(['lexica' as const]) },
      { id: 'b', puntos: 3, vias: new Set(['densa' as const]) },
      { id: 'c', puntos: 2, vias: new Set(['visual' as const]) },
      { id: 'd', puntos: 1, vias: new Set(['densa' as const]) },
      { id: 'a', puntos: 0.5, vias: new Set(['densa' as const]) },
    ];
    const r = sinDuplicados(cs, frags);
    expect(r.map((c) => c.id)).toEqual(['a', 'd']);
    expect([...r[0]!.vias].sort()).toEqual(['densa', 'lexica', 'visual']);
  });
});

describe('valores por defecto medidos', () => {
  it('sin ajustes no llama al redactor y avisa con el orden preliminar antes de reordenar', async () => {
    const sql = crearSQL();
    const embebedor = new EmbebedorFalso(0);
    await cargarFixtura(sql, embebedor);
    const redactor = new RedactorFalso(0);
    const b = new Buscador({ sql, embebedor, indice: new IndiceVectorialSQL(sql, embebedor.espacio), redactor, reordenador: new ReordenadorFalso(0), espacioNombres: 'pruebas' });
    let preliminar: number | undefined;
    const r = await b.buscar('panoptico y vigilancia', { alPreliminar: (rs) => { preliminar = rs.length; } });
    expect(r.comprension.origen).toBe('heuristica');
    expect(redactor.contador.llamadas).toBe(0);
    expect(preliminar).toBeGreaterThan(0);
    expect(r.tiempos.reordenacion).toBeDefined();
  });
});
