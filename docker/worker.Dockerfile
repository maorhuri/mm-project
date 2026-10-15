# MM Marketing OS — background worker. Build from the repo root:
#   docker build -f docker/worker.Dockerfile -t mm-worker .
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
RUN npm ci --no-audit --no-fund

FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
RUN npm run db:generate && npm run build --workspace=@mm/worker

FROM base AS runner
ENV NODE_ENV=production
RUN useradd --system --uid 1001 --create-home mm
COPY --from=build --chown=mm:mm /repo/node_modules ./node_modules
COPY --from=build --chown=mm:mm /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=mm:mm /repo/apps/worker/package.json ./apps/worker/package.json
USER mm
CMD ["node", "apps/worker/dist/index.js"]
