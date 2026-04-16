# PaulAgentBot — Setup Guide

Two modes: **Local** (fastest, for dev) and **Docker** (mirrors production).

---

## Prerequisites (both modes)

```bash
# Node.js 20+, pnpm 9+
npm install -g pnpm

# Redis (required for BullMQ)
docker run -d -p 6379:6379 --name redis redis:7-alpine
redis-cli ping   # → PONG

# Claude Code CLI — must be authenticated
npm install -g @anthropic-ai/claude-code
claude           # log in once — saves credentials to ~/.claude
```

---

## Mode 1 — Local (pnpm dev)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Generate required secrets:

```bash
openssl rand -base64 32   # → paste as NEXTAUTH_SECRET
openssl rand -hex 32      # → paste as ENCRYPTION_KEY
openssl rand -hex 20      # → paste as GITHUB_APP_WEBHOOK_SECRET
```

Minimum `.env` to fill in:

| Variable | Value |
|----------|-------|
| `NEXTAUTH_SECRET` | output of `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | output of `openssl rand -hex 32` (**must be 64 hex chars**) |
| `BOOTSTRAP_ADMIN` | your GitHub username (case-sensitive) |
| `GITHUB_OAUTH_CLIENT_ID` | from your GitHub OAuth App |
| `GITHUB_OAUTH_CLIENT_SECRET` | from your GitHub OAuth App |

> Leave `DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_URL`, and `CLAUDE_AUTH_DIR` as their defaults in `.env.example` — they are correct for local dev.

### 3. GitHub OAuth App (required for login)

Go to [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**:

- **Homepage URL:** `http://localhost:3000`
- **Authorization callback URL:** `http://localhost:3000/api/auth/callback/github`

Copy the Client ID and Secret into `.env`.

### 4. Run database migrations

```bash
pnpm dlx prisma migrate dev --name init
```

Creates `dev.db` and generates the Prisma client. Run once on first setup.

### 5. Start

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) → sign in with GitHub.

> BullMQ workers, cron scheduler, and Telegram bot (if configured) start automatically inside the Next.js process — no separate terminal needed.

---

## Mode 2 — Docker (docker-compose)

Uses the same image as production. Runs app + worker + Redis + Caddy together.

### 1. Pre-flight

```bash
# Create persistent data directories on the host
mkdir -p /data/workspaces /data/caddy

# Create the SQLite database as a FILE (not directory — Docker gets this wrong)
touch /data/paulagentbot.db

# Verify Claude credentials exist
ls ~/.claude   # must contain: .credentials.json
```

### 2. Configure environment

```bash
cp .env.docker.example .env
```

Fill in all `[REQUIRED]` values:

| Variable | How to get it |
|----------|---------------|
| `PAULAGENTBOT_IMAGE` | Build locally: `docker build -t paulagentbot:latest .` → set `paulagentbot:latest` |
| `PAULAGENTBOT_DOMAIN` | Your domain — DNS A record must already point to this server |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://yourdomain.com` |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` (**must be 64 hex chars**) |
| `BOOTSTRAP_ADMIN` | Your GitHub username (case-sensitive) |
| `GITHUB_OAUTH_CLIENT_ID` | From your GitHub OAuth App (callback: `https://yourdomain.com/api/auth/callback/github`) |
| `GITHUB_OAUTH_CLIENT_SECRET` | From your GitHub OAuth App |
| `GITHUB_APP_ID` | Numeric App ID from GitHub App settings |
| `GITHUB_APP_PRIVATE_KEY` | Full `.pem` contents — convert newlines: `awk 'NF {ORS="\\n"; print}' key.pem` |
| `GITHUB_APP_WEBHOOK_SECRET` | `openssl rand -hex 20` |
| `GITHUB_APP_BOT_USERNAME` | e.g. `yourappname[bot]` — shown in GitHub App settings |
| `CLAUDE_AUTH_DIR` | Path to `~/.claude` on the host: `/root/.claude` (EC2) or `/Users/yourname/.claude` (macOS) |

### 3. Build image (if running locally)

```bash
docker build -t paulagentbot:latest .
```

> On EC2 with GitHub Actions, the image is pushed to ECR automatically on push to `main`. Set `PAULAGENTBOT_IMAGE` to your ECR URL instead.

### 4. Start

```bash
docker-compose up -d
docker-compose logs -f   # watch for errors
```

Open `https://yourdomain.com` → sign in with GitHub.

### 5. Verify services

```bash
docker-compose ps        # all services should be "running"
docker-compose logs paulagentbot        # web — check for Prisma migration success
docker-compose logs paulagentbot-worker # worker — check for "Started N repo workers"
```

---

## GitHub App Setup

Required for the bot to receive webhook events and act on repositories.

1. Go to [github.com/settings/apps/new](https://github.com/settings/apps/new)
2. Fill in:
   - **Webhook URL:** `https://yourdomain.com/api/webhooks/github` (or ngrok for local dev)
   - **Webhook secret:** `openssl rand -hex 20` → copy to `GITHUB_APP_WEBHOOK_SECRET`
3. Set **Repository permissions:**
   - Contents: Read and write
   - Issues: Read and write
   - Pull requests: Read and write
   - Metadata: Read-only
4. Subscribe to events: Issue comment, Issues, Pull request, Pull request review comment
5. Click **Create GitHub App** — then on the next page:
   - Note the **App ID** → `GITHUB_APP_ID`
   - Generate a **Private key** (`.pem` downloads) → `GITHUB_APP_PRIVATE_KEY`
   - Note the **Bot username** (e.g. `yourapp[bot]`) → `GITHUB_APP_BOT_USERNAME`
6. Click **Install App** → select your account and repos

### Local dev with ngrok

GitHub webhooks require a public HTTPS URL:

```bash
brew install ngrok
ngrok config add-authtoken <your-token>
ngrok http 3000
# → use the https://abc.ngrok.io URL as your webhook URL
```

> The free ngrok URL changes on restart. Update it in GitHub App settings each time, or use a paid plan for a stable URL.

---

## Telegram (optional)

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → follow prompts
2. Copy the token into `.env`: `TELEGRAM_BOT_TOKEN=1234567890:ABCdef...`
3. Restart the app — bot starts automatically
4. Send `/notify` to your bot to register your chat ID for notifications

---

## Troubleshooting

### `connect ECONNREFUSED 127.0.0.1:6379`
Redis is not running.
```bash
docker run -d -p 6379:6379 --name redis redis:7-alpine
```

### `Not logged in to Claude Code` (Docker only)
`CLAUDE_AUTH_DIR` in `.env` doesn't point to a valid Claude session on the host.
```bash
ls $CLAUDE_AUTH_DIR   # must show .credentials.json
claude                # re-authenticate if empty
```

### First login denied (access denied)
`BOOTSTRAP_ADMIN` doesn't match your GitHub username exactly. Check case — it is case-sensitive.

### GitHub webhook 401
`GITHUB_APP_WEBHOOK_SECRET` in `.env` doesn't match what you set in GitHub App settings. They must be identical — no trailing spaces.

### `Could not locate the bindings file` — better-sqlite3 (macOS)

`better-sqlite3` is a native addon that must be compiled for your exact Node.js version and CPU architecture. The binary is not included in the repo.

**Step 1 — try the standard rebuild:**
```bash
pnpm rebuild better-sqlite3
```

**Step 2 — if that fails or produces no binary, force recompile with node-gyp:**
```bash
cd node_modules/better-sqlite3
npx node-gyp rebuild
cd ../..
```

**Step 3 — if node-gyp reports missing Xcode CLT:**
```bash
xcode-select --install
# then repeat Step 2
```

This affects every developer on a fresh clone, after switching Node.js versions, or after upgrading better-sqlite3. The binary is machine-specific — it is gitignored and never committed.

### Telegram `409 Conflict`
Another instance running with the same token. Stop all other instances before starting.

### `/data/paulagentbot.db is a directory` (Docker)
Docker created the bind-mount target as a directory. Fix:
```bash
docker-compose down
rm -rf /data/paulagentbot.db
touch /data/paulagentbot.db
docker-compose up -d
```
