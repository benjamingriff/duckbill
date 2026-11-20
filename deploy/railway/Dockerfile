# The web app: Hono API plus the built dashboard, one Node process.
# Build context is the repo root: docker build -f deploy/railway/Dockerfile .
# Railway passes service variables to declared build ARGs, so the Clerk
# publishable key (public by design) reaches the Vite build.
FROM node:24.18.0-slim AS web
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @duckbill/web...
COPY apps/api apps/api
COPY apps/web apps/web
ARG CLERK_PUBLISHABLE_KEY
RUN VITE_CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY}" pnpm --filter @duckbill/web build

FROM node:24.18.0-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter @duckbill/api
COPY apps/api/src apps/api/src
COPY --from=web /app/apps/web/dist apps/web/dist
ENV NODE_ENV=production \
    DUCKBILL_API_HOST=0.0.0.0 \
    CLERK_TELEMETRY_DISABLED=1
USER node
CMD ["node", "apps/api/src/server.ts"]
