# Server Debug Commands

Quick reference for connecting, debugging, and restarting PaulAgentBot on EC2.

---

## SSH

```bash
ssh -i ~/.ssh/file ubuntu@54.234.218.49
```

---

## EC2 Instances

| Name | Instance ID | IP | SSH Key |
|------|-------------|----|---------|
| paulagentbot | i-081d99ff74cdaf8cc | 54.234.218.49 | `~/.ssh/id_ed25519` |
| claude-tg-bot | i-0eef6e30daf1a4e3b | 3.94.235.48 | `~/.ssh/id_ed25519_agent` |

Start / stop EC2:
```bash
aws ec2 start-instances --instance-ids i-081d99ff74cdaf8cc --region us-east-1 --profile agent-pw
aws ec2 stop-instances  --instance-ids i-081d99ff74cdaf8cc --region us-east-1 --profile agent-pw
```

---

## Containers

```bash
cd /home/ubuntu/paulagentbot

# Status
docker compose ps

# Restart all
docker compose restart

# Restart only worker (most common)
docker compose restart paulagentbot-worker

# Restart web + worker (after .env changes)
docker compose up -d paulagentbot paulagentbot-worker

# Rebuild from latest ECR image
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 523516319006.dkr.ecr.us-east-1.amazonaws.com
docker compose pull && docker compose up -d --remove-orphans
```

---

## Logs

```bash
# All services, last 50 lines
docker compose logs --tail=50

# Follow worker in real time
docker compose logs -f paulagentbot-worker

# Follow web in real time
docker compose logs -f paulagentbot

# Last N lines from a specific service
docker compose logs --tail=100 paulagentbot-worker
docker compose logs --tail=100 paulagentbot
docker compose logs --tail=100 caddy
```

---

## Enter a Container

```bash
# Worker shell (as root)
docker exec -it paulagentbot-paulagentbot-worker-1 sh

# Worker shell as uid 1001 (same user claude runs as)
docker exec -it -u 1001 -e HOME=/tmp paulagentbot-paulagentbot-worker-1 sh

# Web shell
docker exec -it paulagentbot-paulagentbot-1 sh
```

---

## Test Claude Auth

Run inside the worker container (as uid 1001) to verify auth works:

```bash
docker exec -u 1001 paulagentbot-paulagentbot-worker-1 \
  sh -c 'mkdir -p /tmp/ch && HOME=/tmp/ch timeout 30 claude --print "di hola" --dangerously-skip-permissions 2>&1'
```

Expected: plain text response. If it shows a login screen or returns empty → check `CLAUDE_CODE_OAUTH_TOKEN` in `.env`.

---

## Environment

```bash
# View all env vars in running worker
docker exec paulagentbot-paulagentbot-worker-1 printenv | sort

# Check auth-related vars specifically
docker exec paulagentbot-paulagentbot-worker-1 printenv | grep -E 'CLAUDE|ANTHROPIC|HOME'

# Edit .env on server
nano /home/ubuntu/paulagentbot/.env

# After editing .env — restart to apply
docker compose up -d paulagentbot paulagentbot-worker
```

**Auth rules:**
- `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...` — correct, use this
- `ANTHROPIC_API_KEY=sk-ant-oat01-...` — wrong, takes precedence and breaks OAuth
- `ANTHROPIC_AUTH_TOKEN=sk-ant-oat01-...` — wrong, 401 from API
- `HOME` must point to a **writable** directory (`/tmp` works)

---

## Database (SQLite)

```bash
# Open SQLite shell
sqlite3 /data/paulagentbot.db

# Recent tasks
sqlite3 /data/paulagentbot.db "SELECT id, status, channel, prompt, createdAt FROM Task ORDER BY createdAt DESC LIMIT 10;"

# Stuck RUNNING tasks
sqlite3 /data/paulagentbot.db "SELECT id, status, createdAt FROM Task WHERE status='RUNNING';"

# Mark stuck task as FAILED manually
sqlite3 /data/paulagentbot.db "UPDATE Task SET status='FAILED', errorMessage='Manually failed' WHERE id='<taskId>';"
```

---

## Redis / BullMQ Queue

```bash
# All BullMQ keys
docker exec paulagentbot-redis-1 redis-cli KEYS 'bull:*'

# Jobs in wait (pending) — replace queue name as needed
docker exec paulagentbot-redis-1 redis-cli LRANGE 'bull:repo.paulpwo.portfolio:wait' 0 -1

# Jobs in active (should be empty when worker is idle)
docker exec paulagentbot-redis-1 redis-cli LRANGE 'bull:repo.paulpwo.portfolio:active' 0 -1

# Stale locks (cause queue to block — see troubleshooting #13)
docker exec paulagentbot-redis-1 redis-cli KEYS 'bull:repo.paulpwo.portfolio:*:lock'

# Clear a stale lock manually
docker exec paulagentbot-redis-1 redis-cli DEL 'bull:repo.paulpwo.portfolio:<jobId>:lock'

# Redis CLI interactive
docker exec -it paulagentbot-redis-1 redis-cli
```

---

## Disk

```bash
# Free space
df -h /

# Docker disk usage breakdown
docker system df

# Free space — remove unused images and build cache
docker image prune -a -f
docker builder prune -a -f
```

---

## Deploy Manually (without GitHub Actions)

```bash
# 1. Login to ECR
aws ecr get-login-password --region us-east-1 --profile agent-pw \
  | docker login --username AWS --password-stdin 523516319006.dkr.ecr.us-east-1.amazonaws.com

# 2. Build and push (from /Users/developer/Documents/1paul/PaulBot)
TAG="sha-$(git rev-parse --short HEAD)"
docker build -t 523516319006.dkr.ecr.us-east-1.amazonaws.com/paulagentbot:$TAG .
docker push 523516319006.dkr.ecr.us-east-1.amazonaws.com/paulagentbot:$TAG

# 3. Deploy on EC2
ssh -i ~/.ssh/id_ed25519 ubuntu@54.234.218.49 "
  cd /home/ubuntu/paulagentbot
  aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 523516319006.dkr.ecr.us-east-1.amazonaws.com
  sed -i 's|PAULAGENTBOT_IMAGE=.*|PAULAGENTBOT_IMAGE=523516319006.dkr.ecr.us-east-1.amazonaws.com/paulagentbot:$TAG|' .env
  docker compose pull && docker compose up -d --remove-orphans
  docker image prune -f
"
```
