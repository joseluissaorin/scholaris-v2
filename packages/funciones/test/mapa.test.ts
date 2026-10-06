import { describe, expect, it } from 'vitest';
import { normalizarVector, vectorABytes } from '@scholaris/nucleo';
import { aleatorio } from '../src/util.js';
import { construirMapa, metaMapa, miembrosGrupo, obtenerMapa, pulirEtiqueta } from '../src/mapa/construir.js';
import { ajustarPCA, elegirReduccion, kMedias, proyectarPCA, reducir } from '../src/mapa/algebra.js';
import type { EventoProgreso } from '../src/puertos.js';
import { estanteria, puertos, redactorFalso, sembrar } from './ayudas.js';

/** Vectores sintéticos: `c` centros gaussianos en `dims` dimensiones. */
function nube(n: number, dims: number, c: number, semilla = 1) {
  const azar = aleatorio(semilla);
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(azar(), 1e-12))) * Math.cos(2 * Math.PI * azar());
  const centros = Array.from({ length: c }, () => Float32Array.from({ length: dims }, normal));
  const etiquetas: number[] = [];
  const vectores: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const g = i % c;
    etiquetas.push(g);
    const v = new Float32Array(dims);
    for (let j = 0; j < dims; j++) v[j] = centros[g]![j]! + 0.35 * normal();
    vectores.push(normalizarVector(v));
  }
  return { etiquetas, vectores };
}

describe('álgebra del mapa', () => {
  it('k-medias en el espacio PCA recupera grupos bien separados', () => {
    const { etiquetas, vectores } = nube(1200, 128, 6);
    const r = elegirReduccion({ id: 'x', dims: 128 }, 64);
    expect(r.modo).toBe('proyeccion');
    const X = new Float32Array(1200 * 64);
    vectores.forEach((v, i) => reducir(v, r, X.subarray(i * 64, (i + 1) * 64)));
    const pca = ajustarPCA(X, 1200, 64, 16);
    expect(pca.varianzas[0]).toBeGreaterThanOrEqual(pca.varianzas[1]!);
    const Y = proyectarPCA(X, 1200, pca);
    const km = kMedias(Y, 1200, 16, 6);
    // Pureza: cada grupo encontrado debe estar dominado por un grupo real.
    let aciertos = 0;
    for (let c = 0; c < 6; c++) {
      const cuenta = new Map<number, number>();
      for (let i = 0; i < 1200; i++) if (km.etiquetas[i] === c) cuenta.set(etiquetas[i]!, (cuenta.get(etiquetas[i]!) ?? 0) + 1);
      aciertos += Math.max(0, ...cuenta.values());
    }
    expect(aciertos / 1200).toBeGreaterThan(0.95);
  });

  it('pule etiquetas', () => {
    expect(pulirEtiqueta('Nombres botánicos (S. apetala, C. salsoloides,')).toBe('Nombres botánicos');
    expect(pulirEtiqueta('«Shamash y Enkidu.»')).toBe('Shamash y Enkidu');
  });
});

describe('mapa de conceptos', () => {
  it('construye, etiqueta, emite progreso y se lee', async () => {
    const sql = await estanteria();
    const temas = [
      ['panóptico vigilancia disciplina prisión castigo', 'foucault'],
      ['banalidad mal totalitarismo juicio eichmann', 'arendt'],
      ['rizoma máquina deseo territorio nómada', 'deleuze'],
    ] as const;
    for (const [t, id] of temas) {
      await sembrar(sql, { id, titulo: id, bibliotecas: ['filosofia'], paginas: Array.from({ length: 12 }, (_, i) => `${t} ${t.split(' ')[i % 5]} página ${i}`) });
    }
    const redactor = redactorFalso((texto) => ({ etiqueta: texto.includes('panóptico') ? 'Vigilancia y castigo.' : 'Otro tema', descripcion: 'Un grupo.' }));
    const eventos: EventoProgreso[] = [];
    const r = await construirMapa(puertos(sql, { inteligencia: { redactor } }), { k: 3 }, (e) => void eventos.push(e));
    expect(r.grupos).toBe(3);
    expect(r.puntos).toBe(36);
    expect(redactor.llamadas).toBe(3);
    expect(eventos.at(-1)!.fase).toBe('fin');
    expect(eventos.map((e) => e.fase)).toContain('etiquetar');
    const mapa = await obtenerMapa(sql);
    expect(mapa.grupos.map((g) => g.etiqueta)).toContain('Vigilancia y castigo');
    expect(mapa.puntos).toHaveLength(36);
    expect(mapa.puntos.every((p) => Math.abs(p.x) <= 1.0001 && Math.abs(p.y) <= 1.0001)).toBe(true);
    // Cada documento cae entero en un grupo.
    for (const [, id] of temas) expect(new Set(mapa.puntos.filter((p) => p.documento === id).map((p) => p.grupo)).size).toBe(1);
    const g = mapa.grupos.find((x) => x.etiqueta === 'Vigilancia y castigo')!;
    const m = await miembrosGrupo(sql, g.indice, 5);
    expect(m.miembros[0]!.documento).toBe('foucault');
    expect(m.miembros[0]!.etiqueta).toMatch(/^p\. /);
    expect((await obtenerMapa(sql, { biblioteca: 'otra' })).puntos).toHaveLength(0);
    // Una segunda construcción sustituye a la primera.
    await construirMapa(puertos(sql), { k: 2 });
    expect((await metaMapa(sql)).grupos).toBe(2);
    expect((await sql.ejecutar('SELECT count(*) AS n FROM mapa_puntos'))[0]).toEqual({ n: 36 });
  });

  it('pide un mínimo de elementos', async () => {
    const sql = await estanteria();
    await sembrar(sql, { id: 'a', titulo: 'a', paginas: ['uno dos tres'] });
    await expect(construirMapa(puertos(sql))).rejects.toMatchObject({ codigo: 'peticion_invalida' });
  });

  it('rendimiento: 20 000 vectores de 1536 dimensiones en menos de 5 s', async () => {
    const sql = await estanteria();
    const { vectores } = nube(20_000, 1536, 30, 9);
    sql.db.exec(`INSERT INTO espacios (id, proveedor, modelo, dims, normalizado, modalidades) VALUES ('gemini-embedding-2@1536', 'google', 'gemini-embedding-2', 1536, 1, '["texto"]')`);
    const ins = sql.db.prepare(`INSERT INTO vectores (objetivo, id, espacio, documento, valores) VALUES ('fragmento', ?, 'gemini-embedding-2@1536', ?, ?)`);
    sql.db.transaction(() => {
      vectores.forEach((v, i) => ins.run(`f${i}`, `d${i % 200}`, Buffer.from(vectorABytes(v))));
    })();
    const t0 = performance.now();
    const r = await construirMapa(puertos(sql), {});
    const ms = performance.now() - t0;
    console.log(`mapa 20k: ${Math.round(ms)} ms`, r.tiempos);
    expect(r.puntos).toBe(20_000);
    // Los ejecutores de la CI son unas 2-3 veces más lentos que un portátil actual.
    expect(ms).toBeLessThan(process.env.CI ? 15_000 : 5000);
  }, 60_000);
});
