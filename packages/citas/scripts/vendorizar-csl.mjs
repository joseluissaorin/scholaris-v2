#!/usr/bin/env node
// Descarga los estilos y las configuraciones regionales CSL oficiales y los
// convierte en módulos TypeScript (una cadena por fichero), para que viajen en el
// paquete sin depender del sistema de ficheros (Workers, Durable Objects, navegador).
//
// Uso: node scripts/vendorizar-csl.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'csl', 'vendor');
const ESTILOS = 'https://raw.githubusercontent.com/citation-style-language/styles/master';
const LOCALES = 'https://raw.githubusercontent.com/citation-style-language/locales/master';

/** id interno → fichero del repositorio oficial. */
const estilos = {
  apa: 'apa.csl',
  'chicago-author-date': 'chicago-author-date.csl',
  // El repositorio renombró la variante de notas con la 18.ª edición.
  'chicago-note-bibliography': 'chicago-notes-bibliography.csl',
  mla: 'modern-language-association.csl',
  harvard: 'harvard-cite-them-right.csl',
  iso690: 'iso690-author-date-es.csl',
  'iso690-en': 'iso690-author-date-en.csl',
  'iso690-numerico': 'iso690-numeric-en.csl',
  ieee: 'ieee.csl',
};
const locales = ['es-ES', 'en-US', 'fr-FR', 'it-IT'];

function nombreModulo(id) {
  return id.replace(/[^a-z0-9]+/gi, '-');
}

async function bajar(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}

await mkdir(join(raiz, 'estilos'), { recursive: true });
await mkdir(join(raiz, 'locales'), { recursive: true });
for (const [id, fichero] of Object.entries(estilos)) {
  const xml = await bajar(`${ESTILOS}/${fichero}`);
  await writeFile(join(raiz, 'estilos', `${nombreModulo(id)}.ts`),
    `// Generado por scripts/vendorizar-csl.mjs desde ${ESTILOS}/${fichero} (CC BY-SA 3.0).\nexport default ${JSON.stringify(xml)};\n`);
  console.log('estilo', id, xml.length);
}
for (const l of locales) {
  const xml = await bajar(`${LOCALES}/locales-${l}.xml`);
  await writeFile(join(raiz, 'locales', `${l}.ts`),
    `// Generado por scripts/vendorizar-csl.mjs desde ${LOCALES}/locales-${l}.xml (CC BY-SA 3.0).\nexport default ${JSON.stringify(xml)};\n`);
  console.log('locale', l, xml.length);
}
