/**
 * Lectura de la capa de texto de un PDF digital, sin modelos. La imprenta ya
 * separa cabecera y pie y agrupa las líneas en bloques con su cuerpo de letra;
 * aquí se decide qué bloque es título (cuerpo mayor y corto), qué es nota al pie
 * (cuerpo menor, abajo) y qué folio se ve.
 */

import type { PaginaPdf } from '@scholaris/imprenta';
import type { UnidadLeida } from '../tipos.js';
import { normalizar } from '../texto.js';

/** Cuerpo de letra dominante del documento (ponderado por caracteres). */
export function cuerpoDominante(paginas: PaginaPdf[]): number {
  const peso = new Map<number, number>();
  for (const p of paginas) for (const b of p.bloques) {
    const t = Math.round(b.tam * 2) / 2;
    peso.set(t, (peso.get(t) ?? 0) + b.texto.length);
  }
  let mejor = 10, max = -1;
  for (const [t, n] of peso) if (n > max) { max = n; mejor = t; }
  return mejor;
}

/** Elige el folio visible entre los candidatos de cabecera y pie. */
export function folioVisible(p: PaginaPdf): string | null {
  const c = p.candidatosFolio;
  if (!c.length) return null;
  // Preferir lados exteriores y centro del pie; un número suelto, no un año.
  const ordenados = [...c].sort((a, b) => puntuar(b) - puntuar(a));
  const m = ordenados[0];
  return m ? (m.romano ? m.texto.toLowerCase() : m.valor !== null ? String(m.valor) : m.texto) : null;
}

function puntuar(c: PaginaPdf['candidatosFolio'][number]): number {
  let s = 0;
  if (c.lado !== 'centro' || c.zona === 'pie') s += 1;
  if (c.valor !== null && c.valor > 0 && c.valor < 3000) s += 1;
  if (c.valor !== null && c.valor >= 1400 && c.valor <= 2100 && !c.romano) s -= 1.5; // probablemente un año
  return s;
}

/**
 * Convierte una página digital en unidad leída. `base` es el cuerpo de letra
 * dominante del documento.
 */
export function leerCapaPagina(p: PaginaPdf, orden: number, base: number): UnidadLeida {
  const partes: string[] = [];
  const notas: string[] = [];
  const titulos: UnidadLeida['titulos'] = [];
  const bloques = p.bloques.length
    ? p.bloques
    : p.cuerpo.split(/\n\s*\n/).map((texto) => ({ texto, tam: base, y: 0.5, h: 0, x: 0, w: 1, lineas: [] }));
  let enNotas = false;
  for (let i = 0; i < bloques.length; i++) {
    const b = bloques[i] as (typeof bloques)[number];
    const texto = b.texto.trim();
    if (!texto) continue;
    const corto = texto.length < 140 && !/[.;,]$/.test(texto);
    // Notas al pie: cuerpo menor en la mitad inferior; una vez empiezan, siguen.
    const pequeno = b.tam > 0 && b.tam < base * 0.88;
    if (enNotas || (pequeno && b.y > 0.55 && i > 0 && /^(\d{1,3}|[*†‡§]|\[\d+\])\s?\S/.test(texto))) {
      if (pequeno || enNotas) { enNotas = true; notas.push(texto); continue; }
    }
    if (b.tam >= base * 1.18 && corto && texto.split(/\s+/).length <= 16) {
      const nivel = b.tam >= base * 1.6 ? 1 : b.tam >= base * 1.35 ? 2 : 3;
      titulos.push({ nivel, texto: texto.replace(/\s+/g, ' ') });
      partes.push(`${'#'.repeat(nivel)} ${texto.replace(/\s+/g, ' ')}`);
      continue;
    }
    partes.push(texto);
  }
  const texto = partes.join('\n\n');
  return {
    orden,
    fisica: p.fisica,
    texto,
    notas,
    cabecera: p.cabecera.map((l) => l.texto).join(' / '),
    pie: p.pie.map((l) => l.texto).join(' / '),
    folioVisto: folioVisible(p),
    etiqueta: p.etiqueta,
    titulos,
    figuras: [],
    vacia: normalizar(texto).length === 0 && notas.length === 0,
    lector: 'capa-pdf',
    confianza: Math.max(0.5, Math.min(0.98, p.texto.calidad)),
  };
}

export function leerCapa(paginas: PaginaPdf[]): UnidadLeida[] {
  const base = cuerpoDominante(paginas);
  return paginas.map((p, i) => leerCapaPagina(p, i, base));
}
