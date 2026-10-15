# MM Marketing OS — web (Next.js standalone). Build from the repo root:
#   docker build -f docker/web.Dockerfile -t mm-web .
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget \
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
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run db:generate && npm run build --workspace=@mm/web

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN useradd --system --uid 1001 --create-home mm
COPY --from=build --chown=mm:mm /repo/apps/web/.next/standalone ./
COPY --from=build --chown=mm:mm /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=mm:mm /repo/apps/web/public ./apps/web/public
USER mm
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
