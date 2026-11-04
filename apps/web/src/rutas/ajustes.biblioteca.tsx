/**
 * Ajustes › Biblioteca: el trabajo que Scholaris puede hacer con toda la
 * biblioteca de una vez, cada cosa con lo que costaría antes de confirmarla:
 * comprender los documentos, percibir los audios y los vídeos (o solo revisar
 * sus transcripciones) y buscar las relaciones entre obras.
 */
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Boton } from '@scholaris/ui';
import { Lienzo, Seccion } from '../componentes/comunes/cabecera';
import { ComprensionBiblioteca } from '../componentes/comprension/biblioteca';
import { MediosBiblioteca } from '../componentes/medios/biblioteca';
import { DetectarBiblioteca } from '../componentes/comprension/relaciones';

export const Route = createFileRoute('/ajustes/biblioteca')({
  component: Biblioteca,
});

function Biblioteca() {
  const [detectar, setDetectar] = useState(false);
  return (
    <Lienzo ancho="estrecho">
      <div className="flex flex-col gap-5">
        <Seccion icono="chispa" titulo="Comprender la biblioteca" descripcion="La estructura, las fichas, los personajes y la ficha global de cada documento que aún no los tiene.">
          <ComprensionBiblioteca />
        </Seccion>
        <Seccion icono="video" titulo="Audios y vídeos" descripcion="Mirar y escuchar los medios enteros para que la película plano a plano, las regiones de cada personaje y la transcripción revisada estén completas.">
          <MediosBiblioteca />
        </Seccion>
        <Seccion icono="pila" titulo="Relaciones entre obras" descripcion="Adaptaciones, traducciones, ediciones y obras que se comentan, con sus correspondencias pasaje a pasaje."
          accion={<Boton variante="linea" tam="p" icono="pila" onClick={() => setDetectar(true)}>Buscar relaciones</Boton>}>
          <p className="text-[0.8125rem] text-coffee-600">Las que encuentre aparecen en la comprensión de cada obra, en Relaciones, donde se confirman, se rechazan o se ponen a mano.</p>
        </Seccion>
      </div>
      <DetectarBiblioteca abierto={detectar} alCambiar={setDetectar} />
    </Lienzo>
  );
}
