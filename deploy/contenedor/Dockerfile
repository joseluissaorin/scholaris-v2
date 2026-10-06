# Conversor de Scholaris para Cloudflare Containers (o cualquier Docker):
# la imprenta de Node con ffmpeg (audio y vídeo), @napi-rs/canvas (PDF a
# imagen) y LibreOffice (diapositivas). Escucha en el 8080.
#
#   docker build --platform linux/amd64 -f deploy/contenedor/Dockerfile -t scholaris-conversor .
#   npx wrangler containers push scholaris-conversor:<etiqueta>

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable

FROM base AS construccion
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --prod --frozen-lockfile=false --filter "@scholaris/local..."

FROM base
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates libreoffice-impress libreoffice-writer-nogui fonts-dejavu fonts-liberation fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
# La imprenta carga @napi-rs/canvas con require(): lo encuentra en las dependencias de apps/local.
ENV NODE_ENV=production PORT=8080 NODE_PATH=/app/apps/local/node_modules
WORKDIR /app
COPY --from=construccion /app /app
EXPOSE 8080
WORKDIR /app/apps/local
CMD ["node", "--import", "tsx", "src/conversor.ts"]
