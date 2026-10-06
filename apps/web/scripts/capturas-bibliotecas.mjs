/**
 * Capturas de las bibliotecas como objetos sociales (apps/web/capturas/bibliotecas/),
 * con Chrome sin cabeza por el protocolo de DevTools (sin dependencias: el
 * WebSocket de Node).
 *
 *   node scripts/capturas-bibliotecas.mjs <base> <pasos.json>
 *
 * pasos.json: [{ "nombre": "01-biblioteca", "url": "/?token=…", "ancho": 1440, "alto": 900,
 *               "acciones": [{ "clic": "texto del botón" } | { "js": "…" } | { "espera": 800 }] }]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [base, ficheroPasos] = process.argv.slice(2);
const pasos = JSON.parse(readFileSync(ficheroPasos, 'utf8'));
const salida = resolve(dirname(fileURLToPath(import.meta.url)), '../capturas/bibliotecas');
mkdirSync(salida, { recursive: true });

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const puerto = 9333;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${puerto}`, '--user-data-dir=/tmp/sch/chrome-capturas', '--hide-scrollbars', '--force-device-scale-factor=2', 'about:blank'], { stdio: 'ignore' });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
    const p = l.find((x) => x.type === 'page');
    if (p) ws = new WebSocket(p.webSocketDebuggerUrl);
  } catch { await dormir(200); }
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pendientes = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pendientes.has(d.id)) { pendientes.get(d.id)(d); pendientes.delete(d.id); } });
const cdp = (method, params = {}) => new Promise((r) => { const n = ++id; pendientes.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluar = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await cdp('Page.enable');
for (const p of pasos) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: p.ancho ?? 1440, height: p.alto ?? 900, deviceScaleFactor: 2, mobile: (p.ancho ?? 1440) < 600 });
  if (p.url) { await cdp('Page.navigate', { url: `${base}${p.url}` }); await dormir(p.carga ?? 3500); }
  for (const a of p.acciones ?? []) {
    if (a.espera) await dormir(a.espera);
    if (a.js) await evaluar(a.js);
    if (a.clic) {
      const ok = await evaluar(`(() => { const t = ${JSON.stringify(a.clic)}; const el = [...document.querySelectorAll('button, a, [role=tab], [role=radio]')].find((e) => e.textContent.trim().startsWith(t) || e.getAttribute('aria-label') === t); if (!el) return false; el.click(); return true; })()`);
      if (!ok) console.warn(`  ${p.nombre}: no encuentro «${a.clic}»`);
      await dormir(a.tras ?? 900);
    }
  }
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!p.completa });
  writeFileSync(join(salida, `${p.nombre}.png`), Buffer.from(r.result.data, 'base64'));
  console.log(`  ${p.nombre}.png`);
}
ws.close();
chrome.kill();
