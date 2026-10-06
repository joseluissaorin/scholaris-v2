/**
 * Lector sin conexión en vivo: páginas de la comedia de Lope (escaneado del
 * siglo XVIII) leídas por un modelo de visión local, contra la transcripción
 * de oro de la página 10 y la lectura de Gemini 3.8 Flash del banco.
 *
 *   npx tsx vivo/sin-conexion-lector.ts [modelo] [url] [desde] [hasta]
 *   npx tsx vivo/sin-conexion-lector.ts qwen2.5vl:7b http://localhost:11434 8 12
 *
 * Mide: s por página, CER contra el oro (p. 10) y contra Gemini, folio leído
 * (esperado: física − 6) y si la salida es JSON válido a la primera.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { crearOpenAICompatible, deducirSabor } from '../src/index.js';
import { AQUI, ORIGINALES, RAIZ, cer } from './comun-vivo.js';

const [modelo = 'qwen2.5vl:7b', url = 'http://localhost:11434', d = '8', h = '12'] = process.argv.slice(2);
const desde = Number(d), hasta = Number(h);
const pdf = join(ORIGINALES, 'el-casamiento-en-la-muerte-y-hechos-de-b.pdf');
const dir = mkdtempSync(join(tmpdir(), 'lector-local-'));
// 1600 px de lado mayor, como la imprenta para un escaneado.
execFileSync('pdftoppm', ['-f', String(desde), '-l', String(hasta), '-scale-to', '1600', '-jpeg', '-jpegopt', 'quality=85', pdf, join(dir, 'p')]);
const ficheros = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
const imagenes = ficheros.map((f) => ({ bytes: new Uint8Array(readFileSync(join(dir, f))), mime: 'image/jpeg' }));

const bd = new DatabaseSync(join(RAIZ, 'bench', 'datos', 'calidad-publica', 'el-casamiento-en-la-.tmp.sqlite'), { readOnly: true });
const gemini = new Map((bd.prepare('SELECT orden, texto FROM unidades').all() as Array<{ orden: number; texto: string }>).map((u) => [u.orden + 1, u.texto]));
const oro = readFileSync(join(AQUI, 'oro', 'casamiento-p10.txt'), 'utf8');

const c = crearOpenAICompatible({ url, sabor: deducirSabor(url), modelos: { lector: modelo }, concurrencia: Number(process.env.CONCURRENCIA ?? 2) });
const pista = 'Comedia famosa española del siglo XVII (Lope de Vega, «El casamiento en la muerte»), impresión antigua a dos columnas, en verso.';
const t0 = performance.now();
const paginas = await c.lector().leerPliego({ imagenes, primeraFisica: desde, pista });
const s = (performance.now() - t0) / 1000;
const filas = paginas.map((p) => {
  const g = gemini.get(p.fisica) ?? '';
  return {
    fisica: p.fisica, folio: p.folio, folioEsperado: String(p.fisica - 6), caracteres: p.texto.length,
    cerGemini: g ? Number(cer(p.texto, g).toFixed(3)) : null,
    cerOro: p.fisica === 10 ? Number(cer(p.texto, oro).toFixed(3)) : null,
    confianza: p.confianza,
  };
});
console.table(filas);
const tot = c.contador.total();
console.log(JSON.stringify({
  modelo, paginas: paginas.length, segundos: Number(s.toFixed(1)), sPorPagina: Number((s / paginas.length).toFixed(1)),
  tokensSalida: tot.tokensSalida, tokensEntrada: tot.tokensEntrada,
  cerGeminiMedio: Number((filas.reduce((a, f) => a + (f.cerGemini ?? 0), 0) / filas.length).toFixed(3)),
  foliosBien: filas.filter((f) => f.folio === f.folioEsperado).length,
}));
console.log('\n--- página', paginas[Math.min(2, paginas.length - 1)]?.fisica, '---\n', paginas[Math.min(2, paginas.length - 1)]?.texto.slice(0, 600));
