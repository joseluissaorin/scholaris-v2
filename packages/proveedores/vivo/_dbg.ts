import { readFileSync, readdirSync } from 'node:fs';
import { aBase64, ESQUEMA_PAGINAS, instruccionesLector } from '../src/index.js';
const f = readdirSync('/tmp').find((x) => x.startsWith('p10') && x.endsWith('.jpg'))!;
const img = aBase64(new Uint8Array(readFileSync('/tmp/' + f)));
const cuerpo = { model: process.argv[2], temperature: 0, max_tokens: 6000, stream: false, think: false,
  response_format: { type: 'json_schema', json_schema: { name: 'r', strict: true, schema: ESQUEMA_PAGINAS } },
  messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}` } }, { type: 'text', text: instruccionesLector(1, 10, undefined, {}, 'imagenes') + '\nResponde SOLO con el objeto JSON, sin texto alrededor.' }] }] };
const r = await (await fetch('http://localhost:11435/v1/chat/completions', { method: 'POST', body: JSON.stringify(cuerpo) })).json() as { choices: Array<{ message: { content: string }; finish_reason: string }>; usage: unknown };
console.log(r.choices[0]!.finish_reason, JSON.stringify(r.usage)); console.log(r.choices[0]!.message.content.slice(0, 1500));
