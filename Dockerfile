# ── Stage 1: deps ─────────────────────────────────────────────────────────────
# Install all node_modules (including devDependencies needed for the build)
FROM node:20-alpine AS deps

WORKDIR /app

# Install libc compat for native modules on Alpine
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./

RUN \
  if [ -f package-lock.json ]; then npm ci; \
  elif [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
  else npm ci; \
  fi

# ── Stage 2: builder ───────────────────────────────────────────────────────────
# Build the Next.js application in standalone output mode
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client before building
RUN npx prisma generate

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ── Stage 3: runtime ───────────────────────────────────────────────────────────
# Minimal production image — only the standalone output
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Default workspace base — can be overridden at runtime via env or compose
ENV WORKSPACE_BASE=/data/workspaces

# Create non-root user
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Copy the standalone Next.js build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy Prisma schema + generated client (needed for migrate deploy at startup)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy worker entrypoint (runs as a separate process — paulbot-worker service)
COPY --from=builder /app/workers-entrypoint.js* ./
# Also copy tsx/ts-node if workers-entrypoint is TypeScript
COPY --from=builder /app/node_modules/.bin/tsx* ./node_modules/.bin/
COPY --from=builder /app/node_modules/tsx* ./node_modules/tsx/

# ~/.claude will be bind-mounted at runtime as /root/.claude — do NOT bake in
# WORKSPACE_BASE (/data/workspaces) will be mounted as a named volume

EXPOSE 3000

# Default CMD for the web service (paulbot).
# Override in docker-compose for paulbot-worker.
CMD ["node", "server.js"]
