# Scholaris en casa: la misma aplicación que en Cloudflare, sobre Node,
# SQLite (con sqlite-vec) y el disco. Un proceso, un volumen (/data), un
# puerto (8790). La inteligencia llega por API con tus claves; InferBox es
# opcional (compose.gpu.yml).
#
#   docker build -f deploy/docker/Dockerfile -t scholaris .
#   docker compose -f deploy/docker/compose.yml up -d
#
# Se construye igual en linux/amd64 y linux/arm64 (docker buildx --platform).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# ---------- fuentes ----------
FROM base AS fuentes
# Compiladores por si algún módulo nativo (better-sqlite3) no trae binario para la plataforma.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

# ---------- la web (vite y compañía solo viven aquí) ----------
FROM fuentes AS web
RUN pnpm install --frozen-lockfile --filter "@scholaris/web..." --filter scholaris
RUN pnpm --filter @scholaris/web build

# ---------- dependencias de ejecución (sin wrangler, vite ni typescript) ----------
FROM fuentes AS dependencias
RUN pnpm install --frozen-lockfile --prod --filter "@scholaris/local..."

# ---------- ejecución ----------
FROM base
# ffmpeg: audio y vídeo en la imprenta del servidor.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production DATA_DIR=/data PORT=8790 WEB_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=dependencias /app /app
COPY --from=web /app/apps/web/dist /app/apps/web/dist
# tsx es dependencia de @scholaris/local: se resuelve desde su carpeta.
WORKDIR /app/apps/local
VOLUME /data
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:8790/api/v2/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/principal.ts"]
