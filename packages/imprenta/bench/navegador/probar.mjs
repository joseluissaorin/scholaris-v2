// Prueba la imprenta en Chrome sin cabeza: sirve el arnés, abre Chrome y convierte por CDP.
// Uso: node bench/navegador/probar.mjs <carpeta construida> archivo [archivo…]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';

const [carpeta, ...archivos] = process.argv.slice(2);
const DATOS = new URL('../../../../bench/datos/originales/', import.meta.url).pathname;
const FIX = new URL('../../test/fixtures/', import.meta.url).pathname;
const PDFJS = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const TIPOS = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm' };
const pagina = `<!doctype html><meta charset="utf-8"><script type="module">
const w = new Worker('/arnes.js', { type: 'module' });
const esperas = [];
w.onmessage = (e) => esperas.shift()?.(e.data);
window.convertir = (url, nombre, opciones) => new Promise((r) => { esperas.push(r); w.postMessage({ url, nombre, opciones }); });
window.listo = true;
</script>`;
const servidor = createServer(async (req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    let f;
    if (u === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(pagina); }
    if (u.startsWith('/datos/')) f = join(DATOS, u.slice(7));
    else if (u.startsWith('/fix/')) f = join(FIX, u.slice(5));
    else if (u.startsWith('/pdfjs/')) f = join(PDFJS, u.slice(7));
    else f = join(carpeta, u);
    const b = await readFile(f);
    res.writeHead(200, { 'content-type': TIPOS[extname(f)] ?? 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => servidor.listen(8777, r));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9333', '--user-data-dir=/tmp/imprenta-chrome', '--no-first-run', '--enable-features=SharedArrayBuffer', 'about:blank'], { stdio: 'ignore' });
let lista;
for (let i = 0; i < 50 && !lista; i++) { await new Promise((r) => setTimeout(r, 200)); lista = await fetch('http://127.0.0.1:9333/json').then((r) => r.json()).catch(() => null); }
const objetivo = lista.find((t) => t.type === 'page');
const ws = new WebSocket(objetivo.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pendientes = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pendientes.has(m.id)) { pendientes.get(m.id)(m); pendientes.delete(m.id); } else if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') console.error('[chrome]', JSON.stringify(m.params).slice(0, 400)); });
const cdp = (method, params = {}) => new Promise((r) => { const n = ++id; pendientes.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await cdp('Runtime.enable');
await cdp('Page.navigate', { url: 'http://localhost:8777/' });
for (let i = 0; i < 50; i++) { const r = await cdp('Runtime.evaluate', { expression: 'window.listo === true', returnByValue: true }); if (r.result?.result?.value) break; await new Promise((r) => setTimeout(r, 100)); }
const ver = await cdp('Runtime.evaluate', { expression: 'navigator.userAgent + " | núcleos " + navigator.hardwareConcurrency', returnByValue: true });
console.log(ver.result.result.value);
for (const a of archivos) {
  const [nombre, opciones] = a.split('@');
  const url = existsFix(nombre) ? `/fix/${nombre}` : `/datos/${nombre}`;
  const r = await cdp('Runtime.evaluate', { expression: `window.convertir(${JSON.stringify(url)}, ${JSON.stringify(nombre)}, ${opciones ?? '{}'})`, awaitPromise: true, returnByValue: true, timeout: 600000 });
  const v = r.result?.result?.value ?? r;
  for (const [id, b64] of Object.entries(v.muestras ?? {})) {
    const destino = join('/tmp', 'imprenta-muestras', nombre + '-' + id.replace(/\//g, '_'));
    await (await import('node:fs/promises')).mkdir(dirname(destino), { recursive: true });
    await (await import('node:fs/promises')).writeFile(destino, Buffer.from(b64, 'base64'));
    v.muestras[id] = destino;
  }
  console.log(JSON.stringify(v, null, 1));
}
ws.close(); chrome.kill(); servidor.close();
function existsFix(n) { return /^prueba\.|^foto-/.test(n); }
