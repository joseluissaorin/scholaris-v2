/** Crea una clave personal temporal (7 días, lectura+escritura) para un usuario de Clerk en un despliegue. No imprime secretos. */
import { writeFileSync, chmodSync } from 'node:fs';
import { crearCliente } from '@scholaris/contrato';
const [base, usuario, ruta] = process.argv.slice(2);
const clerk = async <T>(p: string, b?: unknown) => { const r = await fetch(`https://api.clerk.com/v1${p}`, { method: b ? 'POST' : 'GET', headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); if (!r.ok) throw new Error(`Clerk ${p}: ${r.status}`); return r.json() as Promise<T>; };
const s = await clerk<{ id: string }>('/sessions', { user_id: usuario });
const { jwt } = await clerk<{ jwt: string }>(`/sessions/${s.id}/tokens`, {});
const c = await crearCliente({ base: base as string, token: jwt }).claves.crear({ nombre: 'subida de la entrevista de Cortázar (temporal)', alcances: ['lectura', 'escritura'], dias: 1 } as never);
await clerk(`/sessions/${s.id}/revoke`, {});
writeFileSync(ruta as string, `${c.secreto}\n${c.id}\n`); chmodSync(ruta as string, 0o600);
console.log(`clave temporal creada (${c.id}); sesión revocada`);
