/**
 * La onda del audio, barata: se dibuja una vez en dos lienzos (lo pendiente en
 * crema, lo oído en tinta) y el reloj solo cambia el ancho del de encima.
 *
 * Los picos salen, por orden de preferencia:
 *   1. de la caché local (se calculan una vez por documento);
 *   2. del propio archivo si es corto (hasta 40 MB y 40 min), decodificado a
 *      8 kHz en el navegador;
 *   3. de la transcripción: la densidad del habla por instante, que en una
 *      entrevista dibuja la misma respiración que la onda.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { cx } from '@scholaris/ui';
import { motor } from './motor';
import { densidad, type Transcripcion } from './transcripcion';

const CUBOS = 480;
const clave = (doc: string) => `scholaris.picos.${doc}`;

function leerCache(doc: string): Float32Array | null {
  try {
    const s = localStorage.getItem(clave(doc));
    if (!s) return null;
    const b = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    return Float32Array.from(b, (x) => x / 255);
  } catch { return null; }
}

function guardarCache(doc: string, p: Float32Array) {
  try { localStorage.setItem(clave(doc), btoa(String.fromCharCode(...Array.from(p, (x) => Math.round(Math.max(0, Math.min(1, x)) * 255))))); } catch { /* lleno */ }
}

async function picosDelArchivo(url: string): Promise<Float32Array | null> {
  const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctx) return null;
  const r = await fetch(url);
  if (!r.ok) return null;
  const buf = await r.arrayBuffer();
  const audio = await new Ctx(1, 1, 8000).decodeAudioData(buf);
  const canal = audio.getChannelData(0);
  const out = new Float32Array(CUBOS);
  const paso = canal.length / CUBOS;
  let max = 0;
  for (let i = 0; i < CUBOS; i++) {
    let m = 0;
    const a = Math.floor(i * paso), b = Math.floor((i + 1) * paso);
    for (let j = a; j < b; j += 4) { const v = Math.abs(canal[j]!); if (v > m) m = v; }
    out[i] = m;
    if (m > max) max = m;
  }
  if (max) for (let i = 0; i < CUBOS; i++) out[i] = Math.sqrt(out[i]! / max);
  return out;
}

export function Onda({ documento, duracion, bytes, url, transcripcion, className }: { documento: string; duracion: number; bytes: number; url: string | null; transcripcion: Transcripcion | null; className?: string }) {
  const [picos, setPicos] = useState<Float32Array | null>(() => leerCache(documento));
  const [origen, setOrigen] = useState<'archivo' | 'habla'>(() => (leerCache(documento) ? 'archivo' : 'habla'));
  const base = useRef<HTMLCanvasElement>(null);
  const oida = useRef<HTMLCanvasElement>(null);
  const capa = useRef<HTMLDivElement>(null);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (picos || !url || bytes > 40 * 1024 * 1024 || duracion > 40 * 60) return;
    let vivo = true;
    void picosDelArchivo(url).then((p) => { if (vivo && p) { setPicos(p); setOrigen('archivo'); guardarCache(documento, p); } }).catch(() => undefined);
    return () => { vivo = false; };
  }, [documento, url, bytes, duracion, picos]);

  const valores = useMemo(() => picos ?? (transcripcion && duracion ? densidad(transcripcion, duracion, CUBOS) : null), [picos, transcripcion, duracion]);

  // Dibujo: al cambiar los valores o el tamaño.
  useEffect(() => {
    const dibujar = () => {
      for (const [lienzo, color] of [[base.current, '--s-cream-500'], [oida.current, '--s-coffee-800']] as const) {
        if (!lienzo || !valores) continue;
        const r = lienzo.parentElement!.getBoundingClientRect();
        const anchoTotal = raiz.current?.getBoundingClientRect().width ?? r.width;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        lienzo.width = Math.round(anchoTotal * dpr);
        lienzo.height = Math.round(r.height * dpr);
        lienzo.style.width = `${anchoTotal}px`;
        const c = lienzo.getContext('2d')!;
        c.clearRect(0, 0, lienzo.width, lienzo.height);
        c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(color).trim() || '#2c1810';
        const barras = Math.max(24, Math.floor(anchoTotal / 4));
        const ancho = lienzo.width / barras;
        const alto = lienzo.height;
        for (let i = 0; i < barras; i++) {
          const v = valores[Math.min(valores.length - 1, Math.floor((i / barras) * valores.length))] ?? 0;
          const h = Math.max(2 * dpr, v * alto * 0.92);
          c.fillRect(i * ancho + ancho * 0.18, (alto - h) / 2, ancho * 0.64, h);
        }
      }
    };
    dibujar();
    const ro = new ResizeObserver(dibujar);
    if (raiz.current) ro.observe(raiz.current);
    return () => ro.disconnect();
  }, [valores]);

  useEffect(() => motor().escucharTiempo((t) => {
    if (capa.current && duracion) capa.current.style.width = `${Math.max(0, Math.min(1, t / duracion)) * 100}%`;
  }), [duracion]);

  const ir = (e: PointerEvent<HTMLDivElement>) => {
    const r = raiz.current!.getBoundingClientRect();
    motor().irA(((e.clientX - r.left) / r.width) * duracion);
  };

  return (
    <div ref={raiz} className={cx('relative h-20 cursor-pointer select-none', className)} onPointerDown={ir} onPointerMove={(e) => { if (e.buttons === 1) ir(e); }} aria-hidden title={origen === 'habla' ? 'Densidad del habla' : undefined}>
      <canvas ref={base} className="absolute inset-y-0 left-0 h-full" />
      <div ref={capa} className="absolute inset-y-0 left-0 w-0 overflow-hidden">
        <canvas ref={oida} className="absolute inset-y-0 left-0 h-full" />
      </div>
    </div>
  );
}
