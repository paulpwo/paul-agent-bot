# ── Stage 1: sqlite-binary ────────────────────────────────────────────────────
# Dedicated stage to compile the better-sqlite3 native addon.
# Isolated so build tools (python3/make/g++) don't pollute other stages.
FROM node:20-slim AS sqlite-binary

RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --prefix /tmp/sqlite better-sqlite3@12.9.0
# Binary lands at /tmp/sqlite/node_modules/better-sqlite3/build/Release/better_sqlite3.node

# ── Stage 2: prod-deps ────────────────────────────────────────────────────────
# Production-only node_modules — prisma (now in dependencies) + all runtime deps.
# --ignore-scripts skips better-sqlite3 native build here; binary comes from sqlite-binary.
FROM node:20-slim AS prod-deps

WORKDIR /app

COPY package.json pnpm-lock.yaml .npmrc ./
COPY prisma ./prisma

RUN corepack enable pnpm \
  && pnpm i --frozen-lockfile --prod --ignore-scripts \
  && pnpm exec prisma generate

# ── Stage 3: deps ─────────────────────────────────────────────────────────────
# Full install (dev + prod) needed by the builder for TypeScript compilation.
FROM node:20-slim AS deps

WORKDIR /app

COPY package.json pnpm-lock.yaml .npmrc ./
COPY prisma ./prisma

RUN corepack enable pnpm && pnpm i --frozen-lockfile

# ── Stage 4: builder ───────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

RUN corepack enable pnpm

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Force install platform-specific native binaries (Tailwind v4 + lightningcss require linux x64 gnu on EC2)
RUN pnpm add --no-save lightningcss-linux-x64-gnu @tailwindcss/oxide-linux-x64-gnu 2>/dev/null || true

# Generate Prisma client before building
RUN pnpm exec prisma generate

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=3072

RUN pnpm run build

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

# ── Stage 5: gh binary downloader ──────────────────────────────────────────────
FROM debian:bookworm-slim AS gh-bin
RUN apt-get update -qq && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL https://github.com/cli/cli/releases/download/v2.89.0/gh_2.89.0_linux_amd64.tar.gz \
     | tar xz -C /tmp \
  && mv /tmp/gh_2.89.0_linux_amd64/bin/gh /usr/local/bin/gh

# ── Stage 6: runtime ───────────────────────────────────────────────────────────
# Minimal production image — standalone Next.js + prod node_modules + sqlite binary
FROM node:20-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV WORKSPACE_BASE=/data/workspaces

# Install git + claude CLI
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
  && rm -rf /usr/share/man /usr/share/doc \
  && npm install -g @anthropic-ai/claude-code \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy gh binary
COPY --from=gh-bin /usr/local/bin/gh /usr/bin/gh

# Create non-root user
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs

# Allow uid 1001 to traverse /root for bind-mounted ~/.claude credentials
RUN chmod 755 /root

# Trust all git directories (workspaces owned by root, accessed by uid 1001)
RUN git config --system --add safe.directory '*'

# ── App files ──────────────────────────────────────────────────────────────────

# Standalone Next.js build (includes its own minimal node_modules for the server)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Production node_modules — full dep tree including prisma CLI and all its transitive deps
# This replaces the standalone's minimal node_modules with the complete production set.
COPY --from=prod-deps /app/node_modules ./node_modules

# Prisma generated client from builder (schema-aware, must match the app build)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prod-deps /app/prisma ./prisma

# better-sqlite3 native binary from dedicated build stage
# prod-deps used --ignore-scripts so the binary was never compiled there — inject it here.
RUN mkdir -p ./node_modules/better-sqlite3/build/Release
COPY --from=sqlite-binary /tmp/sqlite/node_modules/better-sqlite3/build/Release/better_sqlite3.node \
  ./node_modules/better-sqlite3/build/Release/better_sqlite3.node

# Agent config — skills and MCPs tracked in git, customizable per deployment
COPY --from=builder /app/agent-config ./agent-config

# Compiled worker bundle
COPY --from=builder /app/workers-entrypoint.js ./

EXPOSE 3000

CMD ["node", "server.js"]
