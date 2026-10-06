#!/usr/bin/env node
/**
 * Bootstrap del despliegue de Scholaris v2 en Cloudflare. Idempotente: crea lo
 * que falte, rellena los ids de wrangler.jsonc, pone los secretos que no estén
 * y despliega en workers.dev. Volver a ejecutarlo = actualizar.
 *
 *   export CLOUDFLARE_ACCOUNT_ID=…
 *   node deploy/cloudflare/bootstrap.mjs [--sin-desplegar] [--sin-web] [--secretos-de <fichero.env>…]
 *
 * Recursos: D1 «scholaris», R2 «scholaris» (con CORS para subidas directas),
 * Vectorize «scholaris-gemini-1536» (1536, coseno) con sus índices de
 * metadatos, cola «scholaris-fondo», AI Gateway «scholaris» (si hay token de
 * API con permiso) y los secretos.
 *
 * Los secretos nunca se imprimen: se pasan a wrangler por la entrada estándar.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '../..');
const config = join(aqui, 'wrangler.jsonc');
const args = process.argv.slice(2);
const bandera = (b) => args.includes(b);

const D1 = 'scholaris';
const BUCKET = 'scholaris';
const INDICE = 'scholaris-gemini-1536';
const COLA = 'scholaris-fondo';
const GATEWAY = 'scholaris';
const METADATOS = [['documento', 'string'], ['tipo', 'string'], ['objetivo', 'string'], ['idioma', 'string'], ['anio', 'number']];

if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('Define CLOUDFLARE_ACCOUNT_ID antes de ejecutar el bootstrap.');
  process.exit(1);
}

function wrangler(argumentos, o = {}) {
  const r = spawnSync('npx', ['wrangler', ...argumentos], {
    cwd: join(raiz, 'apps/api'),
    encoding: 'utf8',
    input: o.entrada,
    stdio: [o.entrada !== undefined ? 'pipe' : 'inherit', 'pipe', 'pipe'],
    env: process.env,
  });
  const salida = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0 && !o.puedeFallar) {
    console.error(salida);
    throw new Error(`wrangler ${argumentos.slice(0, 3).join(' ')} falló (${r.status})`);
  }
  return salida;
}

const paso = (m) => console.log(`\n== ${m}`);
let texto = readFileSync(config, 'utf8');

// ---------------------------------------------------------------------------
paso('D1');
if (texto.includes('REPLACE_D1_ID')) {
  let id = /"?database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/.exec(wrangler(['d1', 'create', D1], { puedeFallar: true }))?.[1];
  if (!id) {
    const lista = wrangler(['d1', 'list', '--json']);
    id = JSON.parse(lista.slice(lista.indexOf('['))).find((d) => d.name === D1)?.uuid;
  }
  if (!id) throw new Error('No he podido obtener el id de la base D1');
  texto = texto.replace('REPLACE_D1_ID', id);
  writeFileSync(config, texto);
  console.log(`D1 ${D1}: ${id}`);
} else console.log('D1 ya configurada');

// ---------------------------------------------------------------------------
paso('R2');
if (!wrangler(['r2', 'bucket', 'list']).includes(`name:           ${BUCKET}\n`)) wrangler(['r2', 'bucket', 'create', BUCKET]);
else console.log(`Bucket ${BUCKET} ya existe`);
// CORS para las subidas directas (prefirmadas) desde el navegador: hay que leer el ETag.
const cors = join(tmpdir(), 'scholaris-cors.json');
writeFileSync(cors, JSON.stringify({ rules: [{ allowed: { origins: ['*'], methods: ['GET', 'PUT', 'HEAD'], headers: ['content-type', 'range'] }, exposeHeaders: ['ETag', 'Content-Range'], maxAgeSeconds: 86400 }] }));
wrangler(['r2', 'bucket', 'cors', 'set', BUCKET, '--file', cors, '--force'], { puedeFallar: true });

// ---------------------------------------------------------------------------
paso('Vectorize');
if (!wrangler(['vectorize', 'list']).includes(INDICE)) {
  wrangler(['vectorize', 'create', INDICE, '--dimensions', '1536', '--metric', 'cosine', '--description', 'Scholaris: Gemini Embedding 2 recortado a 1536']);
}
const existentes = wrangler(['vectorize', 'list-metadata-index', INDICE], { puedeFallar: true });
for (const [campo, tipo] of METADATOS) {
  if (existentes.includes(campo)) continue;
  wrangler(['vectorize', 'create-metadata-index', INDICE, '--propertyName', campo, '--type', tipo], { puedeFallar: true });
  console.log(`Índice de metadatos: ${campo} (${tipo})`);
}

// ---------------------------------------------------------------------------
paso('Cola');
if (!wrangler(['queues', 'list']).includes(COLA)) wrangler(['queues', 'create', COLA]);
else console.log(`Cola ${COLA} ya existe`);

// ---------------------------------------------------------------------------
paso('AI Gateway');
const token = process.env.CLOUDFLARE_API_TOKEN;
if (token) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways`;
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const hay = await fetch(`${base}/${GATEWAY}`, { headers: h });
  if (hay.status === 404 || !(await hay.clone().json().catch(() => ({}))).success) {
    const r = await fetch(base, { method: 'POST', headers: h, body: JSON.stringify({ id: GATEWAY, cache_ttl: 0, cache_invalidate_on_update: true, collect_logs: true, rate_limiting_interval: 0, rate_limiting_limit: 0, rate_limiting_technique: 'fixed', authentication: false }) });
    console.log(r.ok ? `Gateway ${GATEWAY} creado` : `No se pudo crear el gateway (${r.status}); se creará solo en la primera petición si la cuenta lo permite`);
  } else console.log(`Gateway ${GATEWAY} ya existe`);
} else console.log('Sin CLOUDFLARE_API_TOKEN: el gateway «scholaris» se crea solo con la primera petición (o desde el panel).');

// ---------------------------------------------------------------------------
paso('Secretos');
const yaHay = wrangler(['secret', 'list', '-c', config], { puedeFallar: true });
const poner = (nombre, valor) => {
  if (!valor) return;
  wrangler(['secret', 'put', nombre, '-c', config], { entrada: valor });
  console.log(`${nombre} guardado`);
};
for (const nombre of ['SECRETO', 'CLAVE_MAESTRA']) {
  if (!yaHay.includes(`"${nombre}"`)) poner(nombre, randomBytes(32).toString('base64url'));
  else console.log(`${nombre} ya definido`);
}
// Claves de proveedores desde ficheros .env (--secretos-de a.env b.env …) o del entorno.
const valores = {};
const i = args.indexOf('--secretos-de');
if (i >= 0) {
  for (const f of args.slice(i + 1).filter((x) => !x.startsWith('--'))) {
    if (!existsSync(f)) continue;
    for (const linea of readFileSync(f, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?([^"'\n]*)["']?\s*$/.exec(linea);
      if (m) valores[m[1]] = m[2];
    }
  }
}
const ALIAS = { GEMINI_API_KEY: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], OPENROUTER_API_KEY: ['OPENROUTER_API_KEY'], TYPESAFE_API_KEY: ['TYPESAFE_API_KEY', 'JEV_API_KEY'], CLERK_PUBLISHABLE_KEY: ['CLERK_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'VITE_CLERK_PUBLISHABLE_KEY'] };
for (const [nombre, alias] of Object.entries(ALIAS)) {
  const v = alias.map((a) => valores[a] ?? process.env[a]).find(Boolean);
  if (v && (bandera('--forzar-secretos') || !yaHay.includes(`"${nombre}"`))) poner(nombre, v);
}

// ---------------------------------------------------------------------------
if (!bandera('--sin-web')) {
  paso('Web');
  execFileSync('pnpm', ['--filter', '@scholaris/web', 'build'], { cwd: raiz, stdio: 'inherit' });
}

if (!bandera('--sin-desplegar')) {
  paso('Despliegue (workers.dev)');
  const salida = wrangler(['deploy', '-c', config]);
  const url = /https:\/\/[\w.-]+\.workers\.dev/.exec(salida)?.[0];
  console.log(url ? `Desplegado en ${url}` : salida.split('\n').slice(-12).join('\n'));
}
console.log('\nListo.');
