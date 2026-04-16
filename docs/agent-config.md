# agent-config/

Git-tracked directory that provides the Claude agent subprocess with a
baseline set of skills and MCP servers. Replaces relying on a developer's
personal `~/.claude/` config — environment-agnostic and replicable across
machines and deployments.

---

## Structure

```
agent-config/
  settings.json       MCP server definitions
  skills/
    coding.md         Base coding principles
    git.md            Git workflow conventions
```

The structure mirrors a `.claude/` directory. Any file valid inside
`~/.claude/` is valid here.

---

## How it gets applied

Before every agent spawn, `runner.ts` copies the contents of `agent-config/`
into `{agentHome}/.claude/`:

| Environment | `agentHome` | Result path |
|-------------|-------------|-------------|
| Local dev   | `.agent-home/` (project root) | `.agent-home/.claude/` |
| Docker      | `/tmp` | `/tmp/.claude/` |

The Claude subprocess is spawned with `HOME={agentHome}`, so it reads
`~/.claude/settings.json` and `~/.claude/skills/` from that location.

The copy runs on every task spawn — changes to `agent-config/` are picked
up on the next task without restarting the server.

---

## MCP servers

Defined in `agent-config/settings.json` under `mcpServers`. The included
example uses the official MCP memory server — no API keys, no external
services required:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

To add an MCP that requires credentials, use environment variables in the
MCP server definition — never hardcode keys in this file since it is
committed to git:

```json
{
  "mcpServers": {
    "my-service": {
      "command": "npx",
      "args": ["-y", "mcp-server-my-service"],
      "env": {
        "API_KEY": "${MY_SERVICE_API_KEY}"
      }
    }
  }
}
```

---

## Skills

Markdown files in `agent-config/skills/` are loaded by the Claude agent
as context. Add a file per concern. Keep them concise — one topic per file.

Files included by default:

| File | Purpose |
|------|---------|
| `coding.md` | Coding principles: follow conventions, minimal scope, no unsolicited refactors |
| `git.md` | Commit format, branch naming, safety rules |

---

## Overriding per deployment (Docker)

The image bakes in `agent-config/` at build time. To override on a server
without rebuilding:

1. Copy the directory to a persistent path on the host:
   ```bash
   cp -r agent-config/ /data/agent-config/
   ```
2. Edit `/data/agent-config/settings.json` or add skills.
3. Uncomment the bind-mount in `docker-compose.yml`:
   ```yaml
   - type: bind
     source: /data/agent-config
     target: /app/agent-config
     read_only: true
   ```
4. Restart the worker:
   ```bash
   docker compose up -d --no-deps paulagentbot-worker
   ```

Changes take effect on the next task spawn — no rebuild needed.

---

## Overriding the config path

Set `PAULBOT_AGENT_CONFIG` in `.env` to point to a different directory:

```bash
PAULBOT_AGENT_CONFIG=/absolute/path/to/my-agent-config
```

Useful for running multiple bot instances with different agent profiles.

---

## What this is NOT

- Not a replacement for the system prompt injected per task (see `task-worker.ts`).
- Not for personal developer tools (git-paul, caveman, etc.) — those belong in `~/.claude/`.
- Not read by the Next.js web process — only by the agent subprocess spawned by the worker.
