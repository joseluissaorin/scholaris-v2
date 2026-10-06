import { useState } from 'react';
import { Boton, Campo, Dialogo } from '@scholaris/ui';

const ES_URL = /^https?:\/\/\S+$/i;

/** «Desde un enlace»: se carga al pedirlo, no con el marco. */
export default function DialogoEnlace({ alCerrar, alEnviar }: { alCerrar: () => void; alEnviar: (url: string) => void }) {
  const [url, setUrl] = useState('');
  const valido = ES_URL.test(url.trim());
  const enviar = () => { if (valido) { alEnviar(url.trim()); alCerrar(); } };
  return (
    <Dialogo
      abierto
      alCambiar={(v) => !v && alCerrar()}
      titulo="Desde un enlace"
      descripcion="Una página web, un PDF en línea, un vídeo de YouTube o Vimeo, o un episodio de pódcast. De las webs guardamos una copia fechada para que la cita no caduque; de los medios, la transcripción con sus marcas de tiempo."
      pie={<><Boton variante="fantasma" onClick={alCerrar}>Cancelar</Boton><Boton variante="tinta" disabled={!valido} onClick={enviar}>Añadir</Boton></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); enviar(); }}>
        <Campo autoFocus icono="enlace" type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Enlace" />
      </form>
    </Dialogo>
  );
}
