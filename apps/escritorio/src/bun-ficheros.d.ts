// Bun incrusta ficheros con `import ruta from '…' with { type: 'file' }` y devuelve su ruta.
declare module '*.wasm' {
  const ruta: string;
  export default ruta;
}
