# PaulAgentBot

A self-hosted, multi-channel AI coding agent that handles GitHub issues, pull requests, and Telegram messages — autonomously, end to end. Powered by [Claude Code](https://claude.ai/code).

> Built and maintained by [Paul Osinga](https://github.com/paulpwo).

---

## What it does

PaulAgentBot listens to GitHub webhooks and Telegram messages, then uses Claude Code to autonomously:

- **Respond to GitHub @mentions** in issues and pull request comments
- **Open, review, and merge pull requests** based on issue instructions
- **Answer questions** about your codebase directly in GitHub threads
- **Execute tasks via Telegram** — send a message, get code shipped
- **Run scheduled jobs** via a built-in cron system
- **Notify you** on Telegram when important GitHub events occur

Everything is managed through a modern web dashboard with real-time task tracking.

---

## Screenshots

| Dashboard | Tasks |
|-----------|-------|
| ![Dashboard](https://raw.githubusercontent.com/paulpwo/paul-agent-bot/main/public/screenshots/dashboard.png) | ![Tasks](https://raw.githubusercontent.com/paulpwo/paul-agent-bot/main/public/screenshots/tasks.png) |

| Chat | Settings |
|------|----------|
| ![Chat](https://raw.githubusercontent.com/paulpwo/paul-agent-bot/main/public/screenshots/chat.png) | ![Settings](https://raw.githubusercontent.com/paulpwo/paul-agent-bot/main/public/screenshots/settings.png) |

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
    BullMQ Queue  ──────────────────────────────────┐
        │                                            │
        ▼                                            ▼
  Task Worker                               Cron Worker
  (spawns Claude Code CLI)                  (node-cron)
        │
        ▼
  Claude Code CLI
  (reads/writes code, runs commands, opens PRs)
        │
        ▼
  GitHub API / Git
```

**Stack:**
- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS v4
- **Backend:** Next.js API routes, BullMQ workers
- **Database:** Prisma 7 + PostgreSQL (production) / SQLite (development)
- **Queue:** BullMQ + Redis
- **AI Engine:** Claude Code CLI (spawned as subprocess)
- **Auth:** NextAuth v4 (GitHub OAuth)
- **Channels:** GitHub App, Telegram Bot, Slack (coming soon)

---

## Requirements

Before you begin, you need:

- **Node.js** 20+
- **Redis** (local or managed, e.g. Upstash)
- **PostgreSQL** (production) or SQLite (development — no extra setup)
- **[Claude Code](https://claude.ai/code)** installed and authenticated (`claude` CLI available in PATH)
- **GitHub App** created and installed on your target repositories
- **Telegram Bot** (optional, via [@BotFather](https://t.me/BotFather))

> **Important:** PaulAgentBot uses Claude Code as a local CLI tool, not the Anthropic API directly. Each user running this project needs their own Claude Code subscription and authentication. No API key is stored in this project.

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/paulpwo/paul-agent-bot.git
cd paul-agent-bot
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in all required values. See [Configuration](#configuration) below.

### 3. Set up the database

```bash
# Generate Prisma client
npx prisma generate

# Run migrations (creates the database schema)
npx prisma migrate deploy
```

### 4. Start development

```bash
# Terminal 1 — Next.js dev server
npm run dev

# Terminal 2 — BullMQ worker
npm run worker
```

Open [http://localhost:3000](http://localhost:3000) and log in with your GitHub account (or bootstrap username).

---

## Configuration

All configuration is done via environment variables. Copy `.env.example` to `.env` and fill in:

### Core (required)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | SQLite path for dev (e.g. `file:./dev.db`) or PostgreSQL for production |
| `REDIS_URL` | Redis connection string (e.g. `redis://localhost:6379`) |
| `NEXTAUTH_SECRET` | Random 32+ byte string for session encryption (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Your app's public URL (e.g. `http://localhost:3000`) |
| `ENCRYPTION_KEY` | Random 32-byte hex string for settings encryption (`openssl rand -hex 32`) |
| `BOOTSTRAP_ADMIN` | Your GitHub username — required for first login before OAuth is configured |

### GitHub OAuth (required for login)

Create an OAuth App at [github.com/settings/developers](https://github.com/settings/developers):
- **Authorization callback URL:** `http://localhost:3000/api/auth/callback/github`

| Variable | Description |
|----------|-------------|
| `GITHUB_OAUTH_CLIENT_ID` | OAuth app client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | OAuth app client secret |

### GitHub App (required for repo integration)

Create a GitHub App at [github.com/settings/apps/new](https://github.com/settings/apps/new):
- **Webhook URL:** `https://your-domain.com/api/webhooks/github`
- **Permissions:** Issues (R/W), Pull Requests (R/W), Contents (R/W), Metadata (R)
- **Events:** Issue comment, Issues, Pull request, Pull request review comment

| Variable | Description |
|----------|-------------|
| `GITHUB_APP_ID` | Your GitHub App's numeric ID |
| `GITHUB_APP_PRIVATE_KEY` | Contents of the `.pem` private key (newlines as `\n`) |
| `GITHUB_APP_WEBHOOK_SECRET` | Webhook secret set during app creation |
| `GITHUB_APP_BOT_USERNAME` | The bot's GitHub username (e.g. `paulagentbot[bot]`) |

### Telegram (optional)

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) |

After setting up the token, send `/notify` to your bot in Telegram to register your chat ID.

---

## Deployment

The project includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) for deploying to AWS ECS. You'll need to configure:

1. **AWS ECR repository** — update `ECR_REPOSITORY` in the workflow
2. **ECS cluster and services** — update `ECS_CLUSTER`, `ECS_SERVICE_WEB`, `ECS_SERVICE_WORKER`
3. **GitHub Secrets:**
   - `ECR_REGISTRY` — your ECR registry URL
   - `AWS_ROLE_TO_ASSUME` — IAM role ARN with ECS deploy permissions (OIDC)

For other platforms (Railway, Render, Fly.io), the app is a standard Node.js + Next.js application. Set all environment variables and run:

```bash
npm run build && npm start
```

Workers run separately via:
```bash
npm run worker
```

---

## Dashboard

The web dashboard (`/dashboard`) provides:

- **Overview** — live task stats, recent activity
- **Chat** — direct conversation with the agent
- **Tasks** — real-time task queue with streaming output
- **Repos** — manage which repositories the agent is active on
- **Skills** — manage Claude Code agent skills (`.md` files)
- **Cronjobs** — schedule recurring agent tasks
- **Settings** — configure integrations, notifications, and access control

---

## License

Copyright 2025 Paul Osinga

Licensed under the **Apache License, Version 2.0**. See [LICENSE](LICENSE) for the full text.

You are free to use, modify, and distribute this project — including commercially — as long as you include the copyright notice and license. No warranty is provided; use at your own risk.

---

## Acknowledgements

- [Anthropic](https://anthropic.com) — Claude Code CLI
- [grammY](https://grammy.dev) — Telegram bot framework
- [BullMQ](https://bullmq.io) — Redis-backed job queue
- [Prisma](https://prisma.io) — Database ORM
- [NextAuth.js](https://next-auth.js.org) — Authentication
