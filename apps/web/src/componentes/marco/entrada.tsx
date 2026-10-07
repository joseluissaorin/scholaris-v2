/**
 * La puerta de entrada: toda la ventana acepta archivos. Soltar, pegar (un
 * archivo o un enlace), elegir, fotografiar. Sin pantalla de «subir»: lo que
 * entra aparece en la mesa de la biblioteca en el mismo instante.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { avisar, FormaBauhaus } from '@scholaris/ui';
import { ingerirArchivos, ingerirUrl, cancelarIngesta } from '../../datos/ingesta';
import { api } from '../../datos/api';
import { clienteConsultas } from '../../datos/consultas';
import { alDisparar, disparar, obtenerBibliotecaActiva } from '../../lib/acciones';
import { BocetoPerezoso } from '../../bocetos/perezoso';

const ES_URL = /^https?:\/\/\S+$/i;
const DialogoEnlace = lazy(() => import('./dialogo-enlace'));

function esCampoDeTexto(el: EventTarget | null) {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.isContentEditable);
}

export function Entrada() {
  const navegar = useNavigate();
  const enBiblioteca = useRouterState({ select: (s) => s.location.pathname === '/' });
  const archivos = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  const spdf = useRef<HTMLInputElement>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [enlace, setEnlace] = useState(false);

  function entrar(lista: File[]) {
    if (!lista.length) return;
    const hechas = ingerirArchivos(lista, { biblioteca: obtenerBibliotecaActiva() });
    const fotos = hechas.find((h) => h.tipo === 'fotos');
    if (fotos) {
      avisar(`Tomé las ${fotos.unidades} fotos como páginas de un mismo libro.`, {
        accion: { etiqueta: 'Son sueltas', alPulsar: () => { void cancelarIngesta(fotos.id); ingerirArchivos(lista.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name)), { fotosSueltas: true }); } },
      });
    } else if (!enBiblioteca) {
      avisar(hechas.length === 1 ? `«${hechas[0]!.nombre}» va a la imprenta.` : `${hechas.length} archivos van a la imprenta.`, { accion: { etiqueta: 'Ver', alPulsar: () => void navegar({ to: '/' }) } });
    }
  }

  async function entrarUrl(u: string) {
    await ingerirUrl(u.trim(), obtenerBibliotecaActiva());
    if (!enBiblioteca) avisar('El enlace va a la imprenta.', { accion: { etiqueta: 'Ver', alPulsar: () => void navegar({ to: '/' }) } });
  }

  // La manícula de la zona de soltar se prepara en un rato ocioso: al arrastrar ya está lista.
  useEffect(() => {
    const precargar = () => void import('../../bocetos/boceto').then((m) => m.precargarBoceto('manicula-suelta'));
    const h = 'requestIdleCallback' in window ? requestIdleCallback(precargar, { timeout: 6000 }) : setTimeout(precargar, 4000);
    return () => { if ('cancelIdleCallback' in window) cancelIdleCallback(h as number); };
  }, []);

  useEffect(() => {
    const quitar = [
      alDisparar('archivos', () => archivos.current?.click()),
      alDisparar('camara', () => camara.current?.click()),
      alDisparar('spdf', () => spdf.current?.click()),
      alDisparar('enlace', () => setEnlace(true)),
    ];
    return () => quitar.forEach((q) => q());
  }, []);

  // Arrastrar y soltar en cualquier parte de la ventana.
  useEffect(() => {
    let profundidad = 0;
    const tieneArchivos = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const entra = (e: DragEvent) => { if (!tieneArchivos(e)) return; e.preventDefault(); profundidad++; setArrastrando(true); };
    const sobre = (e: DragEvent) => { if (!tieneArchivos(e)) return; e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; };
    const sale = (e: DragEvent) => { if (!tieneArchivos(e)) return; profundidad = Math.max(0, profundidad - 1); if (!profundidad) setArrastrando(false); };
    const suelta = (e: DragEvent) => {
      if (!tieneArchivos(e)) return;
      e.preventDefault(); profundidad = 0; setArrastrando(false);
      entrar([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', entra);
    window.addEventListener('dragover', sobre);
    window.addEventListener('dragleave', sale);
    window.addEventListener('drop', suelta);
    return () => {
      window.removeEventListener('dragenter', entra);
      window.removeEventListener('dragover', sobre);
      window.removeEventListener('dragleave', sale);
      window.removeEventListener('drop', suelta);
    };
  });

  // Pegar: archivos o un enlace, siempre que no se esté escribiendo en un campo.
  useEffect(() => {
    const pega = (e: ClipboardEvent) => {
      if (esCampoDeTexto(e.target)) return;
      const fs = [...(e.clipboardData?.files ?? [])];
      if (fs.length) { e.preventDefault(); entrar(fs); return; }
      const t = e.clipboardData?.getData('text/plain')?.trim() ?? '';
      if (ES_URL.test(t)) { e.preventDefault(); void entrarUrl(t); }
    };
    window.addEventListener('paste', pega);
    return () => window.removeEventListener('paste', pega);
  });

  // Atajos globales.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); disparar('paleta'); return; }
      if (mod && e.key.toLowerCase() === 'u') { e.preventDefault(); archivos.current?.click(); return; }
      if (esCampoDeTexto(e.target) || mod || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); void navegar({ to: '/buscar' }).then(() => document.getElementById('caja-busqueda')?.focus()); }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [navegar]);

  async function importarSpdf(f: File) {
    try {
      const r = await api().documentos.importar(f, { biblioteca: obtenerBibliotecaActiva() });
      void clienteConsultas.invalidateQueries({ queryKey: ['documentos'] });
      avisar(r.avisos.length ? `Importado, con ${r.avisos.length === 1 ? 'un aviso' : `${r.avisos.length} avisos`}: ${r.avisos[0]}` : 'SPDF importado. Ya se puede buscar.', { tono: 'exito', accion: { etiqueta: 'Abrir', alPulsar: () => void navegar({ to: '/lector/$id', params: { id: r.documento } }) } });
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo importar el SPDF.', { tono: 'error' });
    }
  }

  return (
    <>
      <input ref={archivos} type="file" multiple hidden onChange={(e) => { entrar([...(e.target.files ?? [])]); e.target.value = ''; }} />
      <input ref={camara} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { entrar([...(e.target.files ?? [])]); e.target.value = ''; }} />
      <input ref={spdf} type="file" accept=".spdf,application/x-spdf,application/vnd.spdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importarSpdf(f); e.target.value = ''; }} />

      {arrastrando ? (
        // Toda la ventana es la zona de soltar: el papel rojo sube, las formas entran de lado y la manícula, a mano, señala dónde.
        <div className="soltar pointer-events-none fixed inset-0 z-[70] overflow-hidden bg-rojo/95 text-[#fbf5ec]" aria-hidden>
          <FormaBauhaus forma="circulo" color="var(--s-amarillo)" className="soltar-sol absolute -bottom-40 -right-24 h-[34rem] w-[34rem]" />
          <FormaBauhaus forma="triangulo" color="#22160f" className="soltar-tri absolute -left-16 top-16 h-72 w-72 opacity-90" />
          <BocetoPerezoso nombre="manicula-suelta" decorativo dibujar="ya" ritmo={0.7} className="sobre-color soltar-mano absolute right-[12%] top-[8%] hidden w-[min(15rem,30vw)] md:block" />
          <div className="soltar-texto relative flex h-full flex-col justify-end p-8 md:p-16">
            <p className="rotulo">PDF · escaneos · fotos · audio · vídeo · DOCX · EPUB · diapositivas · hojas</p>
            <p className="mt-4 text-[1.5rem] font-bold tracking-[-0.01em]">Suelta.</p>
            <p className="mt-2 max-w-md text-[1.125rem]">Lo leemos y, en cuanto haya páginas, las verás aparecer.</p>
          </div>
        </div>
      ) : null}

      {enlace ? <Suspense fallback={null}><DialogoEnlace alCerrar={() => setEnlace(false)} alEnviar={(u) => void entrarUrl(u)} /></Suspense> : null}
    </>
  );
}
