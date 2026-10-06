/** Módulos .wasm importados ya compilados (wrangler: regla CompiledWasm). */
declare module '*.wasm' {
  const modulo: WebAssembly.Module;
  export default modulo;
}
