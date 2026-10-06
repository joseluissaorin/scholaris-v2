import { memo, useState } from 'react';
import type { TipoEntrada } from '@scholaris/nucleo';
import { cx } from '@scholaris/ui';

/** Tintas fijas: una cubierta impresa no cambia con el tema de la pantalla. */
const PALETAS = [
  { fondo: '#b8321c', tinta: '#fbf5ec', forma: '#22160f' },
  { fondo: '#23457a', tinta: '#f6f1e6', forma: '#e2a52a' },
  { fondo: '#e2a52a', tinta: '#22160f', forma: '#b8321c' },
  { fondo: '#22160f', tinta: '#f6f1e6', forma: '#b8321c' },
  { fondo: '#faf7f0', tinta: '#22160f', forma: '#23457a' },
];

function hash(t: string) {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Portada: la imagen real si existe; si no, una cubierta Bauhaus generada a
 * partir del documento (siempre la misma para el mismo libro). Cada tipo tiene
 * su motivo: el audio ondas, el vídeo un fotograma, la web una retícula.
 */
export const Portada = memo(function Portada({ id, titulo, autores, tipo, url, className }: { id: string; titulo: string; autores?: string; tipo: TipoEntrada; url?: string; className?: string }) {
  const [rota, setRota] = useState(false);
  if (url && !rota) return <img src={url} alt="" loading="lazy" decoding="async" onError={() => setRota(true)} className={cx('h-full w-full object-cover', className)} />;
  const h = hash(id);
  const p = PALETAS[h % PALETAS.length]!;
  const giro = (h >> 4) % 4;
  return (
    <div className={cx('relative h-full w-full overflow-hidden', className)} style={{ background: p.fondo, color: p.tinta }} aria-hidden>
      <svg viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        {tipo === 'audio' ? (
          <g fill="none" stroke={p.forma} strokeWidth="5">{[0, 1, 2, 3].map((i) => <circle key={i} cx="120" cy="160" r={30 + i * 22} />)}</g>
        ) : tipo === 'video' ? (
          <g><rect x="18" y="70" width="104" height="62" fill={p.forma} /><path d="M58 88v26l22-13z" fill={p.fondo} /></g>
        ) : tipo === 'web' ? (
          <g fill={p.forma}>{Array.from({ length: 20 }, (_, i) => <circle key={i} cx={22 + (i % 5) * 22} cy={74 + Math.floor(i / 5) * 22} r={i % 3 === 0 ? 7 : 3} />)}</g>
        ) : tipo === 'presentacion' ? (
          <g><rect x="-6" y="78" width="96" height="58" fill={p.forma} /><rect x="60" y="66" width="70" height="44" fill="none" stroke={p.tinta} strokeWidth="2" /></g>
        ) : tipo === 'hoja' ? (
          <g stroke={p.forma} strokeWidth="2">{[0, 1, 2, 3, 4, 5].map((i) => <line key={i} x1="0" x2="120" y1={70 + i * 15} y2={70 + i * 15} />)}{[0, 1, 2].map((i) => <line key={`v${i}`} y1="60" y2="160" x1={30 + i * 32} x2={30 + i * 32} />)}</g>
        ) : giro === 0 ? (
          <circle cx="100" cy="120" r="56" fill={p.forma} />
        ) : giro === 1 ? (
          <path d="M120 54L120 160H6z" fill={p.forma} />
        ) : giro === 2 ? (
          <g><rect x="-10" y="96" width="96" height="96" fill={p.forma} transform="rotate(-14 38 144)" /><circle cx="98" cy="88" r="10" fill={p.tinta} /></g>
        ) : (
          <path d="M120 160V60A100 100 0 0020 160z" fill={p.forma} />
        )}
      </svg>
      <div className="relative flex h-full flex-col p-[9%]">
        <p className="line-clamp-4 text-[clamp(0.85rem,10.5cqi,1.6rem)] leading-[1.04] tracking-[-0.02em]" style={{ textWrap: 'balance' }}>{titulo}</p>
        {autores ? <p className="mt-auto truncate font-mono text-[clamp(0.5rem,4.4cqi,0.7rem)] pr-[18%] uppercase tracking-[0.08em] opacity-85">{autores}</p> : null}
      </div>
    </div>
  );
});
