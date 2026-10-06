# Scholaris en casa: la misma aplicación que en Cloudflare, sobre Node,
# SQLite (con sqlite-vec) y el disco. Un proceso, un volumen (/data), un
# puerto (8790). La inteligencia llega por API con tus claves; InferBox es
# opcional (compose.gpu.yml).
#
#   docker build -f deploy/docker/Dockerfile -t scholaris .
#   docker compose -f deploy/docker/compose.yml up -d

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable

# ---------- dependencias y web ----------
FROM base AS construccion
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile --filter "@scholaris/local..." --filter "@scholaris/web..." --filter scholaris
RUN pnpm --filter @scholaris/web build

# ---------- ejecución ----------
FROM base
# ffmpeg: audio y vídeo en la imprenta del servidor.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production DATA_DIR=/data PORT=8790 WEB_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=construccion /app /app
VOLUME /data
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:8790/api/v2/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/local/src/principal.ts"]
