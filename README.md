# PaulAgentBot

A self-hosted, multi-channel AI coding agent. Mention `@paulagentbot` in a GitHub issue, send a message on Telegram, or use the web dashboard — the agent reads your code, makes changes, opens pull requests, and reports back. Powered by [Claude Code](https://claude.ai/code).

> Built and maintained by [Paul Osinga](https://github.com/paulpwo).

---

## What it does

- **GitHub-native workflow** — mention `@paulagentbot` in any issue or PR comment; it clones the repo, makes the changes, opens a PR, and comments the result
- **Telegram chat** — send a message, get code shipped; supports voice notes, `/stop`, and per-topic repo assignment
- **Scheduled tasks** — set recurring jobs in plain English (`"every Monday at 9am, review open PRs"`)
- **Web dashboard** — real-time task tracking, repo management, skills editor, settings panel
- **Cross-channel flows** — trigger from GitHub, get notified on Telegram; trigger from Telegram, see the PR on GitHub

---

## Architecture

```
GitHub Webhook / Telegram message
        │
        ▼
  Next.js API Route
  (HMAC-verified, deduplicated via Redis)
        │
        ▼
    BullMQ Queue  ──────────────────────────────┐
        │                                        │
        ▼                                        ▼
  Task Worker                           Cron Worker
  (spawns Claude Code)                  (node-cron)
        │
        ▼
  @anthropic-ai/claude-code
  (reads/writes code, runs commands, opens PRs)
        │
        ▼
  GitHub API / Git
```

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · BullMQ + Redis · Prisma (SQLite dev / PostgreSQL prod) · NextAuth v4 · grammY (Telegram)

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| pnpm | 9+ | `npm install -g pnpm` |
| Redis | 7+ | Docker, Homebrew, or managed (Upstash) |
| Claude Code CLI | latest | `npm install -g @anthropic-ai/claude-code` — must be authenticated |
| GitHub account | — | For OAuth login and the GitHub App |
| Docker | optional | Easiest way to run Redis locally |

> **Important:** PaulAgentBot does not use the Anthropic API directly — it uses the Claude Code CLI (`claude`) installed on the host machine. You need a Claude Code subscription and a valid `~/.claude/` auth directory. No Anthropic API key is stored in this project.

---

## Quick Start (Local Development)

### 1. Clone and install

```bash
git clone https://github.com/paulpwo/paul-agent-bot.git
cd paul-agent-bot
pnpm install
```

### 2. Rebuild the native SQLite module

`better-sqlite3` requires a binary compiled for your exact Node.js version:

```bash
pnpm rebuild better-sqlite3
```

> **macOS:** If this fails, run `xcode-select --install` first to install the Xcode Command Line Tools.

### 3. Authenticate Claude Code

The agent runs the `claude` CLI directly — you need an active Claude Code subscription and a valid auth session on the host machine:

```bash
# Install Claude Code CLI (if not already installed)
npm install -g @anthropic-ai/claude-code

# Authenticate (one-time, opens browser)
claude
```

Your credentials are saved to `~/.claude/`. You do not need to set `CLAUDE_AUTH_DIR` for local development — the app reads `~/.claude` automatically.

### 4. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in the required values. Generate the secrets with these commands:

```bash
# NEXTAUTH_SECRET
openssl rand -base64 32

# ENCRYPTION_KEY
openssl rand -hex 32

# GITHUB_APP_WEBHOOK_SECRET
openssl rand -hex 20
```

Minimum required to start:

```
NEXTAUTH_SECRET=<output of openssl rand -base64 32>
ENCRYPTION_KEY=<output of openssl rand -hex 32>
BOOTSTRAP_ADMIN=<your-github-username>
GITHUB_OAUTH_CLIENT_ID=<from GitHub OAuth App>
GITHUB_OAUTH_CLIENT_SECRET=<from GitHub OAuth App>
```

Leave `DATABASE_URL`, `REDIS_URL`, and `NEXTAUTH_URL` as the defaults in `.env.example` — they are correct for local development.

> **GitHub App and Telegram** can be added later. The dashboard works without them — you just won't receive webhook events until the GitHub App is configured.

### 5. Start Redis

Redis is required for the task queue. Choose one option:

```bash
# Option A — Docker (recommended, no install)
docker run -d -p 6379:6379 --name redis redis:7-alpine

# Option B — Homebrew (macOS)
brew install redis && brew services start redis
```

Verify it's running:

```bash
redis-cli ping   # should print: PONG
```

### 6. Run database migrations

```bash
pnpm dlx prisma migrate dev --name init
```

Creates `dev.db` and generates the Prisma client. Run once on first setup, and again when the schema changes.

### 7. Start the development server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in with GitHub — the first login requires your username to match `BOOTSTRAP_ADMIN`.

> BullMQ workers, the cron scheduler, and Telegram bot (if configured) all start automatically inside the Next.js process via `instrumentation.ts`. No separate process needed for local dev.

---

## Environment Variables

For local development: `cp .env.example .env`
For Docker Compose: `cp .env.docker.example .env`

### Core

| Variable | Local | Docker | Description | How to get it |
|----------|-------|--------|-------------|---------------|
| `DATABASE_URL` | Yes | Set by compose | Database connection string | `file:./dev.db` for SQLite; `postgresql://user:pass@host:5432/db` for PostgreSQL |
| `DB_PROVIDER` | No | No | `sqlite` (default) or `postgresql` | Only set when switching to PostgreSQL |
| `REDIS_URL` | Yes | Set by compose | Redis connection | `redis://localhost:6379` locally; `redis://redis:6379` in Docker |
| `NEXTAUTH_SECRET` | Yes | Yes | Signs session cookies | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Yes | Yes | Public app URL | `http://localhost:3000` locally; `https://yourdomain.com` in production |
| `ENCRYPTION_KEY` | Yes | Yes | AES-256 key for DB-stored secrets | `openssl rand -hex 32` (must be 64 hex chars) |
| `BOOTSTRAP_ADMIN` | Yes | Yes | Your GitHub username — first login bootstrap | Your exact GitHub username (case-sensitive) |
| `CLAUDE_AUTH_DIR` | No | Yes | Path to `~/.claude` on the HOST | macOS: `/Users/yourname/.claude` · Linux/EC2: `/root/.claude` |
| `WORKSPACE_BASE` | No | Set by compose | Where repos are cloned | Default: `./workspaces`. Production: `/data/workspaces` |

> **`CLAUDE_AUTH_DIR` local vs Docker:** For `pnpm dev`, leave it blank — the app runs `claude` from your host PATH and reads `~/.claude` automatically. For Docker, this is required: `docker-compose.yml` bind-mounts this directory into the container as `/root/.claude`.

### GitHub OAuth (required for dashboard login)

Create an **OAuth App** (not a GitHub App) at [github.com/settings/developers](https://github.com/settings/developers):
- **Authorization callback URL:** `http://localhost:3000/api/auth/callback/github` (local) or `https://yourdomain.com/api/auth/callback/github` (production)

| Variable | Description |
|----------|-------------|
| `GITHUB_OAUTH_CLIENT_ID` | Client ID shown after creating the OAuth App |
| `GITHUB_OAUTH_CLIENT_SECRET` | Client secret from the OAuth App settings |

### GitHub App (required for repo integration)

See [GitHub App Setup](#github-app-setup) for step-by-step instructions.

| Variable | Description |
|----------|-------------|
| `GITHUB_APP_ID` | Numeric App ID from the app's settings page |
| `GITHUB_APP_PRIVATE_KEY` | Full `.pem` contents — replace newlines with `\n` for single-line env format |
| `GITHUB_APP_WEBHOOK_SECRET` | `openssl rand -hex 20` — must match what you enter in GitHub App settings |
| `GITHUB_APP_BOT_USERNAME` | Bot's GitHub username, e.g. `mybot[bot]` |

### Telegram (optional)

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Token from [@BotFather](https://t.me/BotFather) — bot starts automatically when set |

### Slack (optional)

Both vars required to enable Slack. Create an app at [api.slack.com/apps](https://api.slack.com/apps).

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | OAuth & Permissions → Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | Basic Information → App Credentials → Signing Secret |

### Email (optional)

Both vars required to enable inbound email via SendGrid Inbound Parse.

| Variable | Description |
|----------|-------------|
| `SENDGRID_API_KEY` | API key from [sendgrid.com/settings/api_keys](https://app.sendgrid.com/settings/api_keys) |
| `EMAIL_FROM_ADDRESS` | Sender address (must be verified in SendGrid) |

### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_FILE` | `false` | `true` to write logs to `logs/worker-YYYY-MM-DD.log` |
| `LOG_LEVEL` | `info` | `debug` · `info` · `warn` · `error` |
| `LOG_MAX_DAYS` | `7` | Days to keep log files before auto-deletion |

### Docker / production only

| Variable | Description |
|----------|-------------|
| `PAULAGENTBOT_IMAGE` | Docker image to run. Build locally: `docker build -t paulagentbot .` then set `paulagentbot:latest` |
| `PAULAGENTBOT_DOMAIN` | Domain for Caddy reverse proxy (e.g. `paulagentbot.yourdomain.com`) |

---

## GitHub App Setup

The GitHub App lets PaulAgentBot receive webhook events and act as a bot in your repositories.

### 1. Create the app

Go to [github.com/settings/apps/new](https://github.com/settings/apps/new) and fill in:

- **GitHub App name:** anything unique, e.g. `mypaulagentbot`
- **Homepage URL:** `http://localhost:3000` (or your domain)
- **Webhook URL:**
  - Local dev: use ngrok (see [Local Development with ngrok](#local-development-with-ngrok)) — e.g. `https://abc123.ngrok.io/api/webhooks/github`
  - Production: `https://yourdomain.com/api/webhooks/github`
- **Webhook secret:** generate a random string (`openssl rand -hex 20`) and paste it here — copy this to `GITHUB_APP_WEBHOOK_SECRET`

### 2. Set permissions

Under **Repository permissions**, set:

| Permission | Level |
|------------|-------|
| Contents | Read and write |
| Issues | Read and write |
| Pull requests | Read and write |
| Metadata | Read-only (required) |

### 3. Subscribe to events

Under **Subscribe to events**, enable:

- [x] Issue comment
- [x] Issues
- [x] Pull request
- [x] Pull request review comment

### 4. Create and configure

Click **Create GitHub App**. On the next page:

1. Note the **App ID** (numeric) — this is `GITHUB_APP_ID`
2. Scroll down to **Private keys** and click **Generate a private key**
3. A `.pem` file downloads automatically — open it and copy the full contents into `GITHUB_APP_PRIVATE_KEY` (include the `-----BEGIN RSA PRIVATE KEY-----` header and footer lines)
4. Note the **Bot username** shown on the page (e.g. `yourappname[bot]`) — this is `GITHUB_APP_BOT_USERNAME`

### 5. Install the app on repositories

From the app settings page, click **Install App** in the left sidebar. Select your account and choose which repositories the bot should have access to. You can change this at any time at `github.com/settings/installations`.

---

## Telegram Bot Setup (Optional)

If you want to send tasks via Telegram:

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. BotFather will give you a token like `1234567890:ABCdef...`
4. Set `TELEGRAM_BOT_TOKEN=<token>` in your `.env`
5. Restart the app — the bot connects automatically when the token is present

**Register your Telegram chat ID:** After the bot starts, send `/notify` to your bot in Telegram. This registers your chat ID so the bot can send you notifications.

---

## Local Development with ngrok

GitHub webhooks require a public HTTPS URL. For local development, use [ngrok](https://ngrok.com) to expose your local server:

```bash
# Install ngrok (macOS)
brew install ngrok

# Authenticate (one-time, free account)
ngrok config add-authtoken <your-token>

# Expose port 3000
ngrok http 3000
```

ngrok prints a URL like `https://abc123.ngrok.io`. Use this as your webhook URL in the GitHub App settings:

```
https://abc123.ngrok.io/api/webhooks/github
```

> Note: The free ngrok URL changes every time you restart ngrok. Update the webhook URL in your GitHub App settings each time, or use a paid plan for a stable URL.

---

## Dashboard

The web dashboard at `/dashboard` provides:

| Section | What it does |
|---------|-------------|
| Overview | Live task stats and recent activity feed |
| Chat | Direct conversation with the agent |
| Tasks | Real-time task queue with streaming output |
| Repos | Enable/disable which repositories the agent monitors |
| Skills | Edit global agent skills (Markdown instruction files) |
| Cronjobs | Schedule recurring tasks in plain English |
| Settings | Configure integrations, notifications, and access control |

---

## Production Deploy

### Docker Compose (recommended)

The included `docker-compose.yml` runs the full stack: app, worker, Redis, and Caddy (HTTPS).

#### Pre-flight checklist

Before running compose for the first time:

```bash
# 1. Authenticate Claude Code on the host machine (one-time)
claude   # log in when prompted — saves credentials to ~/.claude

# 2. Create persistent data directories
mkdir -p /data/workspaces /data/caddy

# 3. Create the SQLite database FILE (not a directory — Docker gets this wrong if the file is missing)
touch /data/paulagentbot.db

# 4. Point DNS — your domain's A record must point to this server's IP
#    Caddy auto-provisions a Let's Encrypt cert once DNS resolves.
```

#### Start

```bash
cp .env.docker.example .env
# Edit .env — fill in all [REQUIRED] values

docker-compose up -d
docker-compose logs -f   # watch for errors
```

The `paulagentbot` service runs the Next.js dashboard; `paulagentbot-worker` runs the BullMQ agent workers separately. Redis and Caddy run alongside.

> **SQLite file vs directory gotcha:** Docker creates bind-mount sources as directories if they don't exist. Run `touch /data/paulagentbot.db` before first boot — if Docker already created it as a directory, remove it and re-create the file.

### Terraform (AWS EC2)

Infrastructure-as-code for AWS is in `terraform/`. It provisions an EC2 instance, EIP, security groups, and EventBridge schedules:

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Fill in terraform.tfvars, then:
terraform init
terraform apply
```

### Other platforms (Railway, Render, Fly.io)

```bash
# Build
pnpm build

# Start web process
pnpm start

# Start worker process (run as a separate service/dyno)
pnpm worker
```

Set all environment variables in your platform's dashboard. Use a managed Redis (e.g. Upstash) and PostgreSQL for production.

---

## Troubleshooting

### Claude authentication fails inside Docker

```
Error: Not logged in to Claude Code
```

The container cannot find your Claude credentials. Check `CLAUDE_AUTH_DIR` in `.env` — it must point to a directory on the **host** that contains a valid Claude Code session. The docker-compose.yml bind-mounts this path into the container at `/root/.claude`.

```bash
# Verify credentials exist on the host
ls $CLAUDE_AUTH_DIR   # should show: .credentials.json  settings.json  etc.

# If empty or missing, authenticate on the host first:
claude   # log in once — credentials are saved to ~/.claude
```

### Redis not running

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

Redis is not running. Start it:
```bash
docker run -d -p 6379:6379 --name redis redis:7-alpine
# or
brew services start redis
```

### GitHub webhook returning 401

The webhook secret in your GitHub App settings does not match `GITHUB_APP_WEBHOOK_SECRET` in `.env`. Make sure they are identical — copy/paste carefully, no trailing spaces.

### GitHub webhook not reaching localhost

ngrok is either not running or the URL has changed. Run `ngrok http 3000`, copy the new `https://` URL, and update the webhook URL in your GitHub App settings.

### Telegram 409 Conflict error

```
TelegramError: 409: Conflict: terminated by other getUpdates request
```

Another instance of the bot is running with the same token. Stop all other instances, then restart. In development, make sure you are not running the bot in multiple terminals simultaneously.

### `better-sqlite3` build error on macOS

```
gyp: No Xcode or CLT version detected
```

Install Xcode Command Line Tools:
```bash
xcode-select --install
pnpm rebuild better-sqlite3
```

### First login not working (access denied)

Make sure `BOOTSTRAP_ADMIN` in `.env` exactly matches your GitHub username (case-sensitive). This grants you admin access on the very first login before OAuth is fully configured.

### Prisma client not found

```
Error: @prisma/client did not initialize yet
```

Run `pnpm install` — the `postinstall` script runs `prisma generate` automatically. If it still fails, run `pnpm dlx prisma generate` manually.

---

## License

Copyright 2025 Paul Osinga. Licensed under the [Apache License, Version 2.0](LICENSE).

---

## Screenshots

| Login | Dashboard |
|-------|-----------|
| ![Login](screenshots/01-login-dark.png) | ![Dashboard](screenshots/02-dashboard.png) |

| Chat | Tasks |
|------|-------|
| ![Chat](screenshots/03-chat.png) | ![Tasks](screenshots/04-tasks.png) |

---

## Contributors

[![Contributors](https://contrib.rocks/image?repo=paulpwo/paul-agent-bot)](https://github.com/paulpwo/paul-agent-bot/graphs/contributors)

---

## Acknowledgements

- [Anthropic](https://anthropic.com) — Claude Code CLI
- [grammY](https://grammy.dev) — Telegram bot framework
- [BullMQ](https://bullmq.io) — Redis-backed job queue
- [Prisma](https://prisma.io) — Database ORM
- [NextAuth.js](https://next-auth.js.org) — Authentication
