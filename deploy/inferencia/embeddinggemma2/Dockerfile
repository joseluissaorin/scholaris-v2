# EmbeddingGemma 2 (texto, imagen, audio y vídeo) para el modo sin conexión de Scholaris.
#
#   CPU:  docker build -t scholaris-embeddinggemma2 deploy/inferencia/embeddinggemma2
#   GPU:  docker build --build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu128 -t scholaris-embeddinggemma2:cuda deploy/inferencia/embeddinggemma2
#
# Los pesos (1,5 GB) se bajan de Hugging Face la primera vez al volumen /modelos;
# después, con HF_HUB_OFFLINE=1, no vuelve a salir a la red.
FROM python:3.12-slim
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
# ffmpeg: torchcodec decodifica con él el audio y el vídeo.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir torch torchvision torchaudio --index-url ${TORCH_INDEX} \
 && pip install --no-cache-dir -r requirements.txt
COPY servidor.py .
ENV HF_HOME=/modelos EMBEDDINGGEMMA_ANFITRION=0.0.0.0 EMBEDDINGGEMMA_PUERTO=8812
VOLUME /modelos
EXPOSE 8812
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s CMD python -c "import urllib.request,sys; sys.exit(0 if b'\"ok\"' in urllib.request.urlopen('http://localhost:8812/v1/health').read() else 1)"
CMD ["python", "servidor.py"]
