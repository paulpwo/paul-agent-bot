# Deployment Troubleshooting

Issues encountered during the first EC2 production deployment.

---

## 1. `spawn git ENOENT` — git not in Docker image

**Symptom:** Tasks fail immediately with `spawn git ENOENT`.

**Cause:** The `node:20-slim` base image doesn't include `git`. The worker spawns `git` and `gh` directly.

**Fix:** Add to the `runtime` stage in `Dockerfile`:
```dockerfile
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
  && rm -rf /usr/share/man /usr/share/doc \
  && apt-get clean && rm -rf /var/lib/apt/lists/*
```

---

## 2. `apt-get purge git-man --auto-remove` silently removes `git`

**Symptom:** `git` disappears from the container after what looks like a successful build.

**Cause:** On Debian bookworm, `git` has `git-man` as a hard dependency. Running `apt-get purge git-man --auto-remove` removes `git` along with it.

**Fix:** Never use `purge --auto-remove` on packages that are hard deps of something you want to keep. Delete docs manually instead:
```dockerfile
&& rm -rf /usr/share/man /usr/share/doc
```

---

## 3. `--dangerously-skip-permissions cannot be used with root/sudo privileges`

**Symptom:** Tasks fail in ~2 seconds with this error in the task detail.

**Cause:** The worker container runs as root (`UID 0`), and Claude Code refuses `--dangerously-skip-permissions` when the spawning process UID is 0.

**Fix (two parts):**

**Part A — Drop to UID 1001 when spawning claude** (`src/lib/agent/runner.ts`):
```ts
const isRoot = process.getuid?.() === 0
const child = spawn("claude", args, {
  cwd: opts.workspacePath,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, HOME: "/root", ...(opts.extraEnv ?? {}) },
  ...(isRoot ? { uid: 1001, gid: 1001 } : {}),  // drop from root
})
```
`HOME` stays `/root` so the bind-mounted `~/.claude` credentials are found. The `uid`/`gid` options on `spawn` only affect the child process — the worker itself stays root.

**Part B — Fix filesystem permissions** (run once inside the container as root, or add to `user_data.sh`):
```bash
docker exec <worker-container> bash -c \
  "chmod 755 /root && chmod -R o+rX /root/.claude && chown -R 1001:1001 /data/workspaces"
```
- `chmod 755 /root` — lets uid 1001 enter the HOME directory to find `.claude`
- `chmod -R o+rX /root/.claude` — lets uid 1001 read credentials inside `.claude`
- `chown -R 1001:1001 /data/workspaces` — lets uid 1001 create workspace directories

---

## 4. GitHub webhook returns 401

**Symptom:** Webhooks arrive but return 401. No tasks are created.

**Cause:** `GITHUB_APP_WEBHOOK_SECRET` is missing from the EC2 `.env`. The webhook handler rejects requests with invalid HMAC signatures.

**Fix:** Add to `/home/ubuntu/paulagentbot/.env`:
```
GITHUB_APP_WEBHOOK_SECRET=<your-secret-from-github-app-settings>
```
Then restart: `docker compose up -d --no-deps paulagentbot`

---

## 5. `ANTHROPIC_API_KEY` missing from EC2

**Symptom:** Tasks fail or Claude agent doesn't run.

**Cause:** The API key is in the local `.env` but was never added to the EC2 deployment env.

**Fix:**
```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> /home/ubuntu/paulagentbot/.env
docker compose up -d --no-deps paulagentbot paulagentbot-worker
```

---

## 6. Webhook deduplication blocks redeliveries

**Symptom:** Redelivering the same webhook from GitHub delivers 200 but no task is created. App logs show nothing after startup.

**Cause:** The webhook handler stores each `X-Github-Delivery` ID in Redis and rejects duplicates. Redeliveries reuse the same delivery ID.

**Fix:** Create a **new comment** in GitHub (don't redeliver) to generate a fresh delivery ID.

---

## 7. GitHub OAuth redirect_uri mismatch in production

**Symptom:** Login with GitHub shows "The redirect_uri is not associated with this application."

**Cause:** The GitHub App only had `http://localhost:3000/api/auth/callback/github` as a callback URL.

**Fix:** Add the production URL in [github.com/settings/apps/paulagentbot](https://github.com/settings/apps/paulagentbot) → Callback URLs:
```
https://agente.paulosinga.net/api/auth/callback/github
```

---

## 8. Telegram bot token stored with wrong key name

**Symptom:** Worker logs `TELEGRAM_BOT_TOKEN not configured in Settings` on repeat.

**Cause:** Settings are stored encrypted under the key `telegram.botToken` (not `TELEGRAM_BOT_TOKEN`). Writing directly to SQLite with the wrong key name has no effect.

**Fix:** Always configure the token via the dashboard at `/dashboard/settings → Telegram → Bot Token`. The Settings UI handles encryption and uses the correct key.

---

## 10. `fatal: detected dubious ownership` in workspace repos

**Symptom:** Tasks fail with `git pull --ff-only` error: `fatal: detected dubious ownership in repository at '/data/workspaces/...'`.

**Cause:** The worker spawns claude as uid 1001 (nextjs) to bypass the root restriction (see #3). Repos cloned by root (uid 0) are rejected by git's ownership check when accessed by a different uid.

**Fix (built into the image):** `git config --system --add safe.directory '*'` in the Dockerfile runtime stage. This sets the trust globally for all users in the container.

If a stale workspace was cloned before this fix, chown it manually:
```bash
docker exec paulagentbot-paulagentbot-worker-1 chown -R 1001:1001 /data/workspaces/
```

---

## 11. Claude auth — `CLAUDE_CODE_OAUTH_TOKEN` ignored, agent exits silently

**Symptom:** Tasks show RUNNING in the dashboard but the agent produces no output and exits with code 0 (no error, no response).

**Cause (three compounding issues):**

1. **Wrong variable name.** The OAuth token (`sk-ant-oat01-...`) was stored as `ANTHROPIC_API_KEY`. Claude Code CLI ignores it there and exits silently without authenticating.

2. **Wrong variable name (attempt 2).** Switching to `ANTHROPIC_AUTH_TOKEN` makes the CLI bypass the login screen, but then sends the token directly to `api.anthropic.com` as a Bearer token, which returns `401 — OAuth authentication is currently not supported`. The `sk-ant-oat01-` format is for the Claude.ai OAuth flow, not the raw Anthropic API.

3. **HOME pointed to a read-only directory.** `HOME=/root` pointed to the bind-mounted `.claude` directory (`read_only: true`, empty). Claude Code tries to write session state and settings there. When it can't, it exits silently with code 0.

**Fix:**

In `/home/ubuntu/paulagentbot/.env`:
```bash
# WRONG — these will fail
ANTHROPIC_API_KEY=sk-ant-oat01-...      # wrong var name for OAuth token
ANTHROPIC_AUTH_TOKEN=sk-ant-oat01-...  # 401 from api.anthropic.com

# CORRECT
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
```

In `/home/ubuntu/paulagentbot/docker-compose.yml`, add `HOME: /tmp` to the worker environment:
```yaml
paulagentbot-worker:
  environment:
    HOME: /tmp   # writable — claude needs to create ~/.claude/ for session state
```

In `src/lib/agent/runner.ts`:
```ts
env: { ...process.env, HOME: "/tmp", ...(opts.extraEnv ?? {}) },
```

Remove the read-only `~/.claude` bind mount from both services — it's no longer needed since auth is via env var.

**How to generate the token:**
```bash
claude setup-token   # run once locally, token is valid for 1 year
```
Then add the output to `.env` as `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...`.

**Key rule:** `CLAUDE_CODE_OAUTH_TOKEN` requires a writable HOME. Claude Code writes `.claude/` for session state. Point HOME at any writable directory (`/tmp` works for containers).

---

## 12. Disk full on EC2 — Docker image pull silently fails

**Symptom:** GitHub Actions deploy shows "success" but the running container still has the old image SHA.

**Cause:** The EC2 root volume fills up with accumulated Docker images and build cache. `docker compose pull` fails silently when there's no space, and `docker compose up -d` starts the old cached image without error.

**Diagnosis:**
```bash
df -h /          # check free space
docker system df  # show image/cache sizes
```

**Fix:**
```bash
docker image prune -a -f    # remove unused images (~10GB freed)
docker builder prune -a -f  # remove build cache (~4GB freed)
# Then retry the pull
docker compose pull && docker compose up -d --remove-orphans
```

**Prevention:** The deploy script already runs `docker image prune -f` (dangling only). Change to `docker image prune -a -f --filter "until=72h"` to also remove old tagged images after 72h.

---

## 13. BullMQ stale lock blocks queue — worker starts but processes no jobs

**Symptom:** Worker starts ("Started 1 repo worker"), tasks are QUEUED in the database, but nothing gets processed. No agent logs appear.

**Cause:** When the worker process is killed mid-job (container restart, OOM, disk full), BullMQ leaves the job in the `active` list with a lock key (`bull:<queue>:<jobId>:lock`). On restart, the new worker sees a job "in progress" and waits. With `concurrency: 1`, all new jobs queue behind the ghost job indefinitely.

**Diagnosis:**
```bash
# Check active vs wait queues in Redis
docker exec paulagentbot-redis-1 redis-cli LRANGE 'bull:repo.paulpwo.portfolio:active' 0 -1
docker exec paulagentbot-redis-1 redis-cli LRANGE 'bull:repo.paulpwo.portfolio:wait' 0 -1
docker exec paulagentbot-redis-1 redis-cli KEYS 'bull:repo.paulpwo.portfolio:*:lock'
```

If there's a job in `active` with a stale lock, that's the ghost.

**Fix — restart the worker:**
```bash
docker compose restart paulagentbot-worker
```
The `recoverStuckTasks()` function marks DB tasks as FAILED on startup, but does NOT clean BullMQ Redis state. A full restart lets the lock TTL expire and BullMQ's stalled-job checker clean it up.

**Root cause fix needed:** `recoverStuckTasks()` in `src/workers/index.ts` should also drain stale BullMQ jobs from Redis on startup.

---

## 9. EC2 `.env` variables lost after redeploy

**Symptom:** After a GitHub Actions deploy, manually added env vars disappear.

**Cause:** The deploy SSH step runs `docker compose up -d`, which re-reads `/home/ubuntu/paulagentbot/.env`. Any vars added after the last deploy survive — but if the file itself is replaced, they're gone.

**Fix:** The `.env` file on EC2 is the source of truth. After adding any var manually, add it permanently to the GitHub Actions secrets or the `.env.example` so it's not forgotten.
