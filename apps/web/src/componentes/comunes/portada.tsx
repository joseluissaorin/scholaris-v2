import { memo, useState } from 'react';
import type { TipoEntrada } from '@scholaris/nucleo';
import { cx } from '@scholaris/ui';

/** Tintas fijas: una cubierta impresa no cambia con el tema de la pantalla. */
const T = { crema: '#faf7f0', papel: '#f1e9da', cafe: '#2c1810', rojo: '#b83e33', azul: '#2b4c7e', amarillo: '#e8a838', sepia: '#c4ae96' };
const FONDOS = [
  { fondo: T.crema, tinta: T.cafe },
  { fondo: T.papel, tinta: T.cafe },
  { fondo: T.cafe, tinta: T.crema },
  { fondo: T.azul, tinta: T.crema },
  { fondo: T.amarillo, tinta: T.cafe },
];

function hash(t: string) {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Las composiciones de cubierta. Cada tipo, su registro; cada documento, su variante. */
function Motivo({ tipo, h, fondo }: { tipo: TipoEntrada; h: number; fondo: string }) {
  const v = h % 3;
  const oscuro = fondo === T.cafe || fondo === T.azul;
  const negro = oscuro ? T.crema : T.cafe;
  if (tipo === 'audio') {
    // Kandinsky: círculos concéntricos y una línea que los cruza.
    return (
      <g>
        {[54, 40, 27, 14].map((r, i) => <circle key={r} cx="84" cy="118" r={r} fill={[T.azul, T.crema, T.amarillo, T.cafe][i]} />)}
        <line x1="0" y1="150" x2="120" y2="70" stroke={negro} strokeWidth="1.6" />
        <circle cx="20" cy="86" r="3" fill={T.rojo} />
      </g>
    );
  }
  if (tipo === 'video') {
    // El rojo es el cuadrado; el triángulo, el movimiento.
    return (
      <g>
        <rect x="26" y="70" width="80" height="80" fill={T.rojo} transform={`rotate(${v * 4 - 4} 66 110)`} />
        <path d="M54 92v36l30-18z" fill={T.crema} />
        <rect x="0" y="144" width="70" height="5" fill={negro} />
      </g>
    );
  }
  if (tipo === 'web') {
    // Puntos en tensión sobre una retícula.
    return (
      <g>
        {Array.from({ length: 16 }, (_, i) => <circle key={i} cx={24 + (i % 4) * 24} cy={78 + Math.floor(i / 4) * 20} r={i === (h % 16) ? 9 : 2.5} fill={i === (h % 16) ? T.azul : negro} />)}
        <line x1="10" y1="150" x2="110" y2="66" stroke={T.rojo} strokeWidth="1.4" />
      </g>
    );
  }
  if (tipo === 'presentacion' || tipo === 'hoja') {
    // Bauhaus: la retícula con las formas primarias.
    return (
      <g>
        <g stroke={oscuro ? '#ffffff33' : '#2c181022'} strokeWidth="1">{[30, 60, 90].map((x) => <line key={x} x1={x} y1="60" x2={x} y2="160" />)}{[90, 120].map((y) => <line key={y} x1="0" y1={y} x2="120" y2={y} />)}</g>
        <circle cx="30" cy="120" r="22" fill={T.azul} />
        <rect x="60" y="90" width="30" height="30" fill={T.rojo} />
        <path d="M90 150L105 120L120 150z" fill={T.amarillo} />
      </g>
    );
  }
  if (tipo === 'fotos' || tipo === 'pdf_escaneado' || tipo === 'imagen') {
    // Malevich: el cuadrado negro, dominante, y una barra que flota.
    return (
      <g>
        <rect x="40" y="70" width="66" height="66" fill={negro} transform={`rotate(${-6 - v * 3} 73 103)`} />
        <rect x="6" y="140" width="86" height="7" fill={T.rojo} transform="rotate(-18 49 143)" />
        <rect x="16" y="86" width="14" height="14" fill={T.amarillo} transform="rotate(20 23 93)" />
      </g>
    );
  }
  // Libros y documentos: suprematismo con barras en diagonal, en tres variantes.
  if (v === 0) {
    return (
      <g>
        <rect x="-10" y="112" width="110" height="12" fill={T.rojo} transform="rotate(-28 45 118)" />
        <rect x="58" y="74" width="40" height="40" fill={negro} transform="rotate(-10 78 94)" />
        <rect x="10" y="138" width="70" height="5" fill={T.azul} transform="rotate(-28 45 140)" />
        <circle cx="96" cy="140" r="6" fill={T.amarillo} />
      </g>
    );
  }
  if (v === 1) {
    return (
      <g>
        <circle cx="86" cy="108" r="34" fill={T.azul} />
        <path d="M20 150L46 98L72 150z" fill={T.amarillo} />
        <line x1="0" y1="92" x2="120" y2="150" stroke={negro} strokeWidth="1.6" />
      </g>
    );
  }
  return (
    <g>
      <path d="M120 66V160H26z" fill={T.rojo} />
      <rect x="18" y="82" width="34" height="34" fill={negro} transform="rotate(14 35 99)" />
      <circle cx="96" cy="94" r="5" fill={oscuro ? T.amarillo : T.cafe} />
    </g>
  );
}

/**
 * La portada: la imagen real si existe; si no, una cubierta generada con el
 * lenguaje de la casa (Malevich para los libros y los escaneos, Kandinsky para
 * el sonido, el cuadrado rojo para el vídeo). Siempre la misma para el mismo
 * documento. Con lomo y canto, como un libro sobre la mesa.
 */
export const Portada = memo(function Portada({ id, titulo, autores, tipo, url, className }: { id: string; titulo: string; autores?: string; tipo: TipoEntrada; url?: string; className?: string }) {
  const [rota, setRota] = useState(false);
  const h = hash(id);
  if (url && !rota) {
    return (
      <div className={cx('relative h-full w-full bg-white', className)}>
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setRota(true)} className="h-full w-full object-cover" />
        <span aria-hidden className="absolute inset-y-0 left-0 w-[6%] bg-gradient-to-r from-black/15 to-transparent" />
      </div>
    );
  }
  const p = FONDOS[h % FONDOS.length]!;
  return (
    <div className={cx('relative h-full w-full overflow-hidden', className)} style={{ background: p.fondo, color: p.tinta }} aria-hidden>
      <svg viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <Motivo tipo={tipo} h={h} fondo={p.fondo} />
      </svg>
      {/* Lomo: una sombra a la izquierda, el libro tiene cuerpo. */}
      <span className="absolute inset-y-0 left-0 w-[6%] bg-gradient-to-r from-black/20 to-transparent" />
      <div className="relative flex h-full flex-col p-[10%] pl-[13%]">
        <p className="line-clamp-4 text-[clamp(0.8rem,9.5cqi,1.35rem)] font-bold leading-[1.08] tracking-[-0.01em]" style={{ textWrap: 'balance' }}>{titulo}</p>
        {autores ? <p className="mt-1.5 truncate text-[clamp(0.55rem,5cqi,0.75rem)] font-semibold uppercase tracking-[0.06em] opacity-80">{autores}</p> : null}
      </div>
    </div>
  );
});
