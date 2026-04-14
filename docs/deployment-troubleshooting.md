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

**Cause:** The worker container runs as root, and Claude Code refuses `--dangerously-skip-permissions` when the process UID is 0.

**Fix:** Add to the EC2 `.env` (or docker-compose environment):
```
CLAUDE_CODE_ALLOW_ROOT_EXECUTION=1
```

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

## 9. EC2 `.env` variables lost after redeploy

**Symptom:** After a GitHub Actions deploy, manually added env vars disappear.

**Cause:** The deploy SSH step runs `docker compose up -d`, which re-reads `/home/ubuntu/paulagentbot/.env`. Any vars added after the last deploy survive — but if the file itself is replaced, they're gone.

**Fix:** The `.env` file on EC2 is the source of truth. After adding any var manually, add it permanently to the GitHub Actions secrets or the `.env.example` so it's not forgotten.
