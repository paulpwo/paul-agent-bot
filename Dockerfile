# ── Stage 1: deps ─────────────────────────────────────────────────────────────
# Install all node_modules (including devDependencies needed for the build)
FROM node:20-slim AS deps

WORKDIR /app


COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
COPY prisma ./prisma

RUN \
  if [ -f package-lock.json ]; then npm ci; \
  elif [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
  else npm ci; \
  fi

# ── Stage 2: builder ───────────────────────────────────────────────────────────
# Build the Next.js application in standalone output mode
FROM node:20-slim AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Force install platform-specific native binaries (Tailwind v4 + lightningcss require linux x64 gnu on EC2)
RUN npm install --no-save lightningcss-linux-x64-gnu @tailwindcss/oxide-linux-x64-gnu 2>/dev/null || true

# Rebuild native modules for the target platform (fixes cross-compilation issues with better-sqlite3)
RUN npm rebuild better-sqlite3

# Generate Prisma client before building
RUN npx prisma generate

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# Compile worker to a single JS bundle (avoids needing tsx + src/ at runtime)
RUN npx esbuild src/workers/index.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --outfile=workers-entrypoint.js \
  --external:better-sqlite3 \
  --external:"@prisma/client" \
  --external:".prisma" \
  --tsconfig=tsconfig.json

# ── Stage 3: gh binary downloader ──────────────────────────────────────────────
# Download gh CLI tarball in a throwaway stage — binary only lands in runtime
FROM debian:bookworm-slim AS gh-bin
RUN apt-get update -qq && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL https://github.com/cli/cli/releases/download/v2.89.0/gh_2.89.0_linux_amd64.tar.gz \
     | tar xz -C /tmp \
  && mv /tmp/gh_2.89.0_linux_amd64/bin/gh /usr/local/bin/gh

# ── Stage 4: runtime ───────────────────────────────────────────────────────────
# Minimal production image — only the standalone output
FROM node:20-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Default workspace base — can be overridden at runtime via env or compose
ENV WORKSPACE_BASE=/data/workspaces

# Install git + claude CLI. Delete man pages/docs manually (purge would remove git too on bookworm)
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
  && rm -rf /usr/share/man /usr/share/doc \
  && npm install -g @anthropic-ai/claude-code \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy gh binary from downloader stage — no curl/keyring overhead in final image
COPY --from=gh-bin /usr/local/bin/gh /usr/bin/gh

# Create non-root user
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs

# Allow uid 1001 (nextjs) to traverse /root so it can read the bind-mounted ~/.claude credentials.
# The worker spawns claude as uid 1001 to satisfy --dangerously-skip-permissions; HOME stays /root.
RUN chmod 755 /root

# Copy the standalone Next.js build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy Prisma schema + generated client (needed for migrate deploy at startup)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
# effect is required by @prisma/config (prisma migrate deploy)
COPY --from=builder /app/node_modules/effect ./node_modules/effect

# Copy compiled worker bundle
COPY --from=builder /app/workers-entrypoint.js ./

# ~/.claude will be bind-mounted at runtime as /root/.claude — do NOT bake in
# WORKSPACE_BASE (/data/workspaces) will be mounted as a named volume

EXPOSE 3000

# Default CMD for the web service (paulbot).
# Override in docker-compose for paulbot-worker.
CMD ["node", "server.js"]
