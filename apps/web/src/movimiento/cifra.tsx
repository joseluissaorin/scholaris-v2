/**
 * Una cifra que cuenta hasta su valor, como el cuentakilómetros de una
 * imprenta: rápido al principio, se posa al final. Para lectores de pantalla
 * solo existe el número final; el que corre es decorativo. Sin movimiento, el
 * número aparece ya hecho.
 */
import { useEffect, useRef, useState } from 'react';
import { quieto } from './preferencias';

export function Cifra({ valor, formato = (n) => String(n), duracion = 700, className }: {
  valor: number;
  formato?: (n: number) => string;
  duracion?: number;
  className?: string;
}) {
  const [visto, setVisto] = useState(valor);
  const desde = useRef(valor);
  const primera = useRef(true);
  useEffect(() => {
    // En el primer pintado cuenta desde cero solo si el número es pequeño (si no, distrae).
    const inicio = primera.current ? (valor <= 400 ? 0 : valor) : desde.current;
    primera.current = false;
    if (quieto() || inicio === valor) { setVisto(valor); desde.current = valor; return; }
    let raf = 0;
    const t0 = performance.now();
    const paso = (t: number) => {
      const u = Math.min(1, (t - t0) / duracion);
      const e = 1 - Math.pow(1 - u, 4);
      const n = Math.round(inicio + (valor - inicio) * e);
      setVisto(n);
      desde.current = n;
      if (u < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [valor, duracion]);
  return (
    <span className={className}>
      <span aria-hidden className="tnum">{formato(visto)}</span>
      <span className="sr-only">{formato(valor)}</span>
    </span>
  );
}
