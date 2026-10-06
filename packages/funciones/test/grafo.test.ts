import { describe, expect, it } from 'vitest';
import { analizarBibliografia, analizarEntrada } from '../src/grafo/bibliografia.js';
import { actualizarGrafoDocumento, detalleNodo, obtenerGrafo, parecidoTitulos, reconstruirGrafo, referenciasHuerfanas } from '../src/grafo/grafo.js';
import { estanteria, sembrar } from './ayudas.js';

// Referencias reales con sus datos; el DOI usa el prefijo de pruebas de Crossref (10.5555), no es de la obra.
const BIBLIOGRAFIA = `Bibliografía

Foucault, M. (1975). Surveiller et punir. Naissance de la prison. Paris: Gallimard.
Arendt, H. (1963). Eichmann in Jerusalem: A Report on the Banality of Evil. New York: Viking.
Deleuze, G. y Guattari, F. (1980). Mille plateaux. Paris: Minuit. https://doi.org/10.5555/mp.1980
Agamben, G. (1995). Homo sacer. Il potere sovrano e la nuda vita. Torino: Einaudi.
Butler, J. (1990). Gender Trouble. New York: Routledge.`;

describe('bibliografía', () => {
  it('analiza entradas con DOI, año, título y apellidos', () => {
    const e = analizarEntrada('Deleuze, G. y Guattari, F. (1980). Mille plateaux. Paris: Minuit. doi:10.5555/mp.1980.');
    expect(e.doi).toBe('10.5555/mp.1980');
    expect(e.anio).toBe(1980);
    expect(e.titulo).toBe('Mille plateaux');
    expect(e.autores).toEqual(['Deleuze', 'Guattari']);
    const lista = analizarBibliografia([{ fragmento: 'f', texto: BIBLIOGRAFIA }]);
    expect(lista).toHaveLength(5);
    expect(lista[1]!.titulo).toBe('Eichmann in Jerusalem: A Report on the Banality of Evil');
  });

  it('compara títulos', () => {
    expect(parecidoTitulos('Vigilar y castigar: nacimiento de la prisión', 'Vigilar y castigar. Nacimiento de la prisión')).toBe(1);
    expect(parecidoTitulos('Homo sacer', 'Gender trouble')).toBe(0);
  });
});

describe('grafo de citas', () => {
  it('resuelve por DOI, título y autor-año, y deja huérfanas', async () => {
    const sql = await estanteria();
    await sembrar(sql, { id: 'tesis', titulo: 'Una tesis sobre el poder', autores: [['Ana', 'López']], anio: 2020,
      paginas: ['Introducción. Esta tesis revisa cinco libros.', BIBLIOGRAFIA] });
    await sembrar(sql, { id: 'surveiller', titulo: 'Surveiller et punir: naissance de la prison', autores: [['Michel', 'Foucault']], anio: 1975, paginas: ['…'] });
    await sembrar(sql, { id: 'eichmann', titulo: 'Eichmann en Jerusalén', autores: [['Hannah', 'Arendt']], anio: 1963, paginas: ['…'] });
    await sembrar(sql, { id: 'mp', titulo: 'Mil mesetas', autores: [['Gilles', 'Deleuze']], anio: 1980, doi: '10.5555/MP.1980', paginas: ['…'] });
    const r = await reconstruirGrafo(sql);
    expect(r.aristas).toBe(3);
    expect(r.huerfanas).toBe(2);
    const g = await obtenerGrafo(sql);
    const vias = Object.fromEntries(g.aristas.map((a) => [a.hacia, a.via]));
    expect(vias).toEqual({ surveiller: 'titulo_anio', eichmann: 'autor_anio', mp: 'doi' });
    expect(g.aristas.find((a) => a.hacia === 'mp')!.unidades).toEqual([2]);
    const nodo = g.nodos.find((n) => n.documento === 'tesis')!;
    expect(nodo.citas).toBe(3);
    const det = await detalleNodo(sql, 'surveiller');
    expect(det.citadoEn).toEqual([{ documento: 'tesis', titulo: 'Una tesis sobre el poder', etiquetas: ['p. 12'] }]);
    const h = await referenciasHuerfanas(sql);
    expect(h.map((x) => x.anio).sort()).toEqual([1990, 1995]);

    // Llega Homo sacer: la referencia huérfana se resuelve sola.
    await sembrar(sql, { id: 'homo', titulo: 'Homo sacer: il potere sovrano e la nuda vita', autores: [['Giorgio', 'Agamben']], anio: 1995, paginas: ['…'] });
    await actualizarGrafoDocumento(sql, 'homo');
    expect((await detalleNodo(sql, 'homo')).citadoEn).toHaveLength(1);
    expect(await referenciasHuerfanas(sql)).toHaveLength(1);
  });
});
