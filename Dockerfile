# One Dockerfile for both apps: `--target api` or `--target web`.
# Debian rather than Alpine: sharp and Next ship glibc builds first.
FROM node:22.23-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# Dependencies first, so code changes do not reinstall them.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Next.js reads its proxy targets when it builds, so they are fixed here. These
# are addresses on the deployment's private Docker network.
ARG API_INTERNAL_URL=http://api:4000
ARG KRATOS_INTERNAL_URL=http://kratos:4433
ENV API_INTERNAL_URL=$API_INTERNAL_URL KRATOS_INTERNAL_URL=$KRATOS_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# The API with only its production dependencies (the db package included).
FROM build AS api-bundle
RUN pnpm --filter @heynaija/api deploy --prod --legacy /out

# --- API, its CLI commands and database migrations ---
FROM base AS api
ENV NODE_ENV=production
COPY --from=api-bundle --chown=node:node /out /app
USER node
WORKDIR /app
EXPOSE 4000
CMD ["node", "dist/main.js"]

# --- Web app: Next.js's standalone server and its static files ---
FROM node:22.23-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
