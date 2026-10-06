"""
Servidor de vectores EmbeddingGemma 2 para el modo sin conexión de Scholaris.

EmbeddingGemma 2 (Google DeepMind, 6-10-2026, Apache 2.0) pone texto, imagen,
vídeo y audio en un único espacio de 768 dimensiones (Matryoshka a 512, 256 y
128). Ollama lo sirve solo para texto (ignora las imágenes); este servidor usa
sentence-transformers con el procesador multimodal oficial y habla el mismo
contrato que InferBox, así que Scholaris lo usa igual que a InferBox:

  POST /v1/embed        {"input": [...], "images": [...], "audio": [...], "video": [...],
                         "task": "consulta"|"documento"|"ninguna", "dimensions": 768}
                        → {"model", "embeddings": [[...]], "dims"}
      input[i] es el texto del elemento i; images[i], audio[i] y video[i] (base64,
      data: URI o null) se le añaden. Un elemento solo de imagen va con input[i] = "".
      Los prefijos de tarea solo se aplican al texto solo («task: search result |
      query: …», «title: none | text: …»), como pide la ficha del modelo.
  POST /v1/embeddings   (OpenAI, solo texto; «dimensions» opcional)
  POST /v1/rerank       {"query", "documents", "top_n"} → {"results": [{"index", "relevance_score"}]}
      (opcional, con --reordenador BAAI/bge-reranker-v2-m3: Ollama no tiene reordenador)
  GET  /v1/health, GET /v1/models

Dispositivo: CUDA (bfloat16) → MPS en el Mac (bfloat16) → CPU (float32).
Nunca float16: el modelo da NaN (lo advierte la ficha).

  pip install -r requirements.txt
  python servidor.py --puerto 8812 [--modalidades texto,imagen,audio,video] [--clave …]

Variables: EMBEDDINGGEMMA_MODELO (google/embeddinggemma-2 o una carpeta local),
EMBEDDINGGEMMA_CLAVE, EMBEDDINGGEMMA_DISPOSITIVO, HF_HUB_OFFLINE=1 tras la
primera descarga (así no vuelve a mirar Hugging Face).
"""
from __future__ import annotations

import argparse
import base64
import io
import os
import tempfile
import threading
import time
from typing import Any

import numpy as np
import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

PREFIJOS = {
    "consulta": "task: search result | query: ",
    "documento": "title: none | text: ",
    "ninguna": "",
}
DIMENSIONES = (768, 512, 256, 128)
EXTENSION = {"audio": ".wav", "video": ".mp4"}

estado: dict[str, Any] = {"modelo": None, "dispositivo": None, "cargado": 0.0, "peticiones": 0, "modalidades": []}
cerrojo = threading.Lock()


def elegir_dispositivo(pedido: str | None) -> tuple[str, torch.dtype]:
    if pedido:
        return pedido, (torch.float32 if pedido == "cpu" else torch.bfloat16)
    if torch.cuda.is_available():
        return "cuda", (torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32)
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps", torch.bfloat16
    return "cpu", torch.float32


def cargar(nombre: str, dispositivo: str | None, modalidades: list[str]) -> None:
    from sentence_transformers import SentenceTransformer

    disp, dtype = elegir_dispositivo(dispositivo)
    config_kwargs: dict[str, Any] = {}
    # Carga selectiva de codificadores (ficha del modelo, «Selective Encoder Loading»).
    if "imagen" not in modalidades and "video" not in modalidades:
        config_kwargs["vision_config"] = None
    if "audio" not in modalidades:
        config_kwargs["audio_config"] = None
    t0 = time.time()
    modelo = SentenceTransformer(nombre, device=disp, model_kwargs={"torch_dtype": dtype}, config_kwargs=config_kwargs or None)
    estado.update(modelo=modelo, dispositivo=f"{disp} ({str(dtype).replace('torch.', '')})", cargado=time.time() - t0, modalidades=modalidades, nombre=nombre)


def extension(datos: bytes, clave: str) -> str:
    """La extensión por los primeros bytes (torchcodec decide el demultiplexor por ella)."""
    c = datos[:12]
    if c.startswith(b"RIFF"):
        return ".wav"
    if c.startswith(b"ID3") or c[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return ".mp3"
    if c.startswith(b"OggS"):
        return ".ogg"
    if c.startswith(b"fLaC"):
        return ".flac"
    if c[4:8] == b"ftyp":
        return ".m4a" if clave == "audio" else ".mp4"
    if c.startswith(b"\x1a\x45\xdf\xa3"):
        return ".webm"
    return EXTENSION[clave]


def decodificar(b64: str) -> bytes:
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    return base64.b64decode(b64)


class PeticionEmbed(BaseModel):
    model: str | None = None
    input: list[str] = []
    images: list[str | None] | None = None
    audio: list[str | None] | None = None
    video: list[str | None] | None = None
    task: str | None = None
    instruction: str | None = None
    dimensions: int | None = None


class PeticionOpenAI(BaseModel):
    model: str | None = None
    input: str | list[str]
    dimensions: int | None = None


def comprobar_clave(authorization: str | None = Header(default=None), x_api_key: str | None = Header(default=None)) -> None:
    clave = os.environ.get("EMBEDDINGGEMMA_CLAVE")
    if not clave:
        return
    dada = x_api_key or (authorization or "").removeprefix("Bearer ").strip()
    if dada != clave:
        raise HTTPException(401, "clave incorrecta")


def vectorizar(elementos: list[Any], dims: int, prompt: str | None) -> list[list[float]]:
    if dims not in DIMENSIONES:
        raise HTTPException(400, f"dimensions debe ser una de {DIMENSIONES}")
    modelo = estado["modelo"]
    with cerrojo:  # una GPU, un inquilino: en serie, por lotes
        v = modelo.encode(elementos, normalize_embeddings=True, batch_size=8, truncate_dim=dims, prompt=prompt, convert_to_numpy=True)
    estado["peticiones"] += 1
    v = np.asarray(v, dtype=np.float32)
    if not np.isfinite(v).all():
        raise HTTPException(500, "el modelo devolvió NaN (¿float16?)")
    return v.tolist()


app = FastAPI(title="EmbeddingGemma 2 para Scholaris")


@app.get("/v1/health")
def salud() -> dict[str, Any]:
    return {"status": "ok" if estado["modelo"] is not None else "cargando", "model": "embeddinggemma-2", "device": estado["dispositivo"],
            "modalities": estado["modalidades"], "load_seconds": round(estado["cargado"], 1), "requests": estado["peticiones"]}


@app.get("/v1/models")
def modelos() -> dict[str, Any]:
    return {"object": "list", "data": [{"id": "embeddinggemma-2", "object": "model", "owned_by": "google", "dims": list(DIMENSIONES)}]}


@app.post("/v1/embed", dependencies=[Depends(comprobar_clave)])
def embed(p: PeticionEmbed) -> dict[str, Any]:
    n = max(len(p.input), len(p.images or []), len(p.audio or []), len(p.video or []))
    if n == 0:
        raise HTTPException(400, "hace falta input, images, audio o video")
    textos = list(p.input) + [""] * (n - len(p.input))
    tarea = p.task or ("ninguna" if p.instruction is None else None)
    prefijo = PREFIJOS.get(tarea, "") if tarea else (p.instruction or "")
    medios = {"image": p.images or [], "audio": p.audio or [], "video": p.video or []}
    for clave, lista in medios.items():
        if any(lista) and {"image": "imagen", "audio": "audio", "video": "video"}[clave] not in estado["modalidades"]:
            raise HTTPException(400, f"este servidor no carga el codificador de {clave} (--modalidades)")
    temporales: list[str] = []
    try:
        elementos: list[Any] = []
        for i in range(n):
            item: dict[str, Any] = {}
            marcas = ""
            for clave, lista in medios.items():
                b = lista[i] if i < len(lista) else None
                if not b:
                    continue
                datos = decodificar(b)
                if clave == "image":
                    from PIL import Image
                    item["image"] = Image.open(io.BytesIO(datos)).convert("RGB")
                else:
                    f = tempfile.NamedTemporaryFile(delete=False, suffix=extension(datos, clave))
                    f.write(datos)
                    f.close()
                    temporales.append(f.name)
                    item[clave] = f.name
                marcas += f" <|{clave}|>"
            if item:
                texto = textos[i].strip()
                if texto:
                    item["text"] = f"{texto}{marcas}"
                elementos.append(item)
            else:
                elementos.append(prefijo + textos[i])
        return {"model": "embeddinggemma-2", "dims": p.dimensions or 768, "embeddings": vectorizar(elementos, p.dimensions or 768, None)}
    finally:
        for t in temporales:
            try:
                os.unlink(t)
            except OSError:
                pass


@app.post("/v1/embeddings", dependencies=[Depends(comprobar_clave)])
def embeddings(p: PeticionOpenAI) -> dict[str, Any]:
    textos = [p.input] if isinstance(p.input, str) else p.input
    v = vectorizar(textos, p.dimensions or 768, None)
    return {"object": "list", "model": "embeddinggemma-2", "data": [{"object": "embedding", "index": i, "embedding": x} for i, x in enumerate(v)],
            "usage": {"prompt_tokens": 0, "total_tokens": 0}}


class PeticionRerank(BaseModel):
    model: str | None = None
    query: str
    documents: list[str]
    top_n: int | None = None


@app.post("/v1/rerank", dependencies=[Depends(comprobar_clave)])
def rerank(p: PeticionRerank) -> dict[str, Any]:
    cruzado = estado.get("reordenador")
    if cruzado is None:
        raise HTTPException(404, "este servidor no tiene reordenador (arráncalo con --reordenador)")
    if not p.documents:
        return {"results": []}
    with cerrojo:
        puntos = cruzado.predict([(p.query, d) for d in p.documents], batch_size=16, convert_to_numpy=True)
    # CrossEncoder ya aplica la sigmoide a los modelos de una salida (bge-reranker): 0-1.
    puntos = np.asarray(puntos, dtype=np.float64)
    orden = sorted(range(len(p.documents)), key=lambda i: -puntos[i])[: p.top_n or len(p.documents)]
    return {"model": estado.get("nombre_reordenador"), "results": [{"index": i, "relevance_score": float(puntos[i])} for i in orden]}


def main() -> None:
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--anfitrion", default=os.environ.get("EMBEDDINGGEMMA_ANFITRION", "127.0.0.1"))
    a.add_argument("--puerto", type=int, default=int(os.environ.get("EMBEDDINGGEMMA_PUERTO", "8812")))
    a.add_argument("--modelo", default=os.environ.get("EMBEDDINGGEMMA_MODELO", "google/embeddinggemma-2"))
    a.add_argument("--dispositivo", default=os.environ.get("EMBEDDINGGEMMA_DISPOSITIVO"))
    a.add_argument("--modalidades", default=os.environ.get("EMBEDDINGGEMMA_MODALIDADES", "texto,imagen,audio,video"))
    a.add_argument("--reordenador", default=os.environ.get("EMBEDDINGGEMMA_REORDENADOR"), help="p. ej. BAAI/bge-reranker-v2-m3 (opcional)")
    x = a.parse_args()
    cargar(x.modelo, x.dispositivo, [m.strip() for m in x.modalidades.split(",") if m.strip()])
    if x.reordenador:
        from sentence_transformers import CrossEncoder
        disp, dtype = elegir_dispositivo(x.dispositivo)
        estado["reordenador"] = CrossEncoder(x.reordenador, device=disp, model_kwargs={"torch_dtype": dtype if disp != "cpu" else torch.float32})
        estado["nombre_reordenador"] = x.reordenador
        print(f"Reordenador {x.reordenador} en {disp}", flush=True)
    print(f"EmbeddingGemma 2 en {estado['dispositivo']} ({estado['cargado']:.1f} s), modalidades: {', '.join(estado['modalidades'])}", flush=True)
    import uvicorn
    uvicorn.run(app, host=x.anfitrion, port=x.puerto, log_level="warning")


if __name__ == "__main__":
    main()
