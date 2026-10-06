/** Caché LRU mínima con caducidad opcional. Vive en memoria del isolate / proceso. */
export class CacheLRU<V> {
  private mapa = new Map<string, { v: V; hasta: number }>();
  constructor(private maximo = 500, private ttlMs = 0) {}

  obtener(clave: string): V | undefined {
    const e = this.mapa.get(clave);
    if (!e) return undefined;
    if (e.hasta && e.hasta < Date.now()) { this.mapa.delete(clave); return undefined; }
    this.mapa.delete(clave);
    this.mapa.set(clave, e);
    return e.v;
  }

  poner(clave: string, v: V): void {
    this.mapa.delete(clave);
    this.mapa.set(clave, { v, hasta: this.ttlMs ? Date.now() + this.ttlMs : 0 });
    while (this.mapa.size > this.maximo) {
      const primera = this.mapa.keys().next().value as string;
      this.mapa.delete(primera);
    }
  }

  get tam(): number { return this.mapa.size; }
  vaciar(): void { this.mapa.clear(); }
}

/** Resuelve `p` o, si tarda más de `ms`, undefined (la promesa sigue viva). */
export function conPlazo<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  if (!Number.isFinite(ms)) return p;
  return new Promise((resolver) => {
    const t = setTimeout(() => resolver(undefined), ms);
    p.then((v) => { clearTimeout(t); resolver(v); }, () => { clearTimeout(t); resolver(undefined); });
  });
}
