/**
 * Compila el ejecutable de escritorio para cada sistema (desde la raíz del
 * repositorio, con la web ya construida):
 *
 *   bun run apps/escritorio/build.ts [macos-arm64 macos-x64 windows-x64 linux-x64 linux-arm64]
 *
 * La web (apps/web/dist) se embebe con `import … with { type: 'file' }` desde
 * un módulo generado; los datos viven fuera, en ~/Scholaris.
 */
import { mkdir, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const raiz = resolve(import.meta.dir, '../..');
const web = join(raiz, 'apps/web/dist');
const salida = join(raiz, 'apps/escritorio/dist');
const generado = join(raiz, 'apps/escritorio/src/web-embebida.ts');
const pkg = JSON.parse(await readFile(join(raiz, 'package.json'), 'utf8')) as { version: string };

const OBJETIVOS: Record<string, Bun.Build.CompileTarget> = {
  'macos-arm64': 'bun-darwin-arm64', 'macos-x64': 'bun-darwin-x64', 'windows-x64': 'bun-windows-x64', 'linux-x64': 'bun-linux-x64', 'linux-arm64': 'bun-linux-arm64',
};
const pedidos = process.argv.slice(2);
const nombres = pedidos.length ? pedidos : [`${process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'}-${process.arch}`];

async function ficheros(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await ficheros(p)));
    else out.push(p);
  }
  return out;
}

if (!(await stat(join(web, 'index.html')).catch(() => null))) {
  console.error('Falta la web: ejecuta antes «pnpm --filter @scholaris/web build».');
  process.exit(1);
}
const lista = await ficheros(web);
const original = await readFile(generado, 'utf8');
await writeFile(generado, `/** Generado por build.ts: la web embebida en el ejecutable. */\n${lista.map((f, i) => `import f${i} from ${JSON.stringify(f)} with { type: 'file' };`).join('\n')}\nexport const WEB: Record<string, string> = {\n${lista.map((f, i) => `  ${JSON.stringify('/' + relative(web, f).split('\\').join('/'))}: f${i},`).join('\n')}\n};\n`);

await rm(salida, { recursive: true, force: true });
await mkdir(salida, { recursive: true });
try {
  for (const n of nombres) {
    const objetivo = OBJETIVOS[n];
    if (!objetivo) throw new Error(`Objetivo desconocido: ${n}. Válidos: ${Object.keys(OBJETIVOS).join(', ')}`);
    const r = await Bun.build({
      entrypoints: [join(raiz, 'apps/escritorio/src/main.ts')],
      compile: { target: objetivo, outfile: join(salida, `scholaris-${n}`) },
      // Lo que no viaja en el ejecutable: módulos nativos de Node y la imprenta del servidor (el navegador convierte).
      external: ['better-sqlite3', '@napi-rs/canvas', 'pdfjs-dist', 'undici', 'ws', '@hono/node-server'],
      minify: true,
      sourcemap: 'linked',
      define: { SCHOLARIS_VERSION: JSON.stringify(pkg.version) },
    });
    if (!r.success) { for (const l of r.logs) console.error(l); throw new Error('La compilación falló'); }
    for (const o of r.outputs) console.log(`${o.path} (${(o.size / 1048576).toFixed(1)} MB)`);
  }
} finally {
  await writeFile(generado, original);
}
