import { spawn } from "child_process"
import { createInterface } from "readline"
import { publishStream } from "@/lib/redis/pubsub"
import { redis } from "@/lib/redis/client"
import { checkPathPermission, requestHITLApproval } from "./permissions"
import { createLogger } from "@/lib/logger"
import path from "path"
import fs from "fs/promises"

// Repo-tracked agent config (skills, MCPs). Copied into agentHome/.claude/ before each spawn
// so the subprocess picks them up regardless of environment. Override via PAULBOT_AGENT_CONFIG.
const AGENT_CONFIG_DIR = process.env.PAULBOT_AGENT_CONFIG
  ?? path.resolve(process.cwd(), "agent-config")

async function prepareAgentHome(agentHome: string): Promise<void> {
  const targetDir = path.join(agentHome, ".claude")
  await fs.mkdir(targetDir, { recursive: true })
  try {
    await fs.cp(AGENT_CONFIG_DIR, targetDir, { recursive: true, force: true })
  } catch {
    // agent-config dir missing or unreadable — proceed without it
  }
}

const logger = createLogger("runner")

// Patterns to mask in tool inputs before publishing to the frontend.
// Prevents tokens/secrets from appearing in the chat UI.
const SECRET_PATTERNS: [RegExp, string][] = [
  [/GH_TOKEN=[^\s"']+/g, "GH_TOKEN=***"],
  [/GITHUB_TOKEN=[^\s"']+/g, "GITHUB_TOKEN=***"],
  [/x-access-token:[^@]+@/g, "x-access-token:***@"],
  [/ghp_[A-Za-z0-9]{36}/g, "ghp_***"],
  [/ghs_[A-Za-z0-9]{36}/g, "ghs_***"],
]

function sanitizeInput(input: unknown): unknown {
  if (typeof input === "string") {
    let out = input
    for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement)
    return out
  }
  if (typeof input === "object" && input !== null) {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, sanitizeInput(v)])
    )
  }
  return input
}

// Bash patterns that require explicit HITL approval — everything else auto-approves.
// Path isolation (checkPathPermission) already blocks workspace escapes.
const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+(-[rRfFidI]*\s+)*[~/]/, // rm targeting absolute or home paths
  /\bgit\s+push\b.*--force/,       // force push
  /\bgit\s+reset\s+--hard/,        // hard reset
  /\bgit\s+clean\s+-[^-]*[fd]/,    // git clean -fd (destroys untracked files)
  /\bsudo\b/,                       // privilege escalation
  /\|\s*(bash|sh|zsh|csh|fish)\b/, // pipe to shell
  /\beval\s+/,                      // eval
  /\bdrop\s+table\b/i,              // SQL destructive
  /\bdelete\s+from\b/i,
  /\btruncate\s+table\b/i,
]

function isBashDangerous(input: unknown): boolean {
  const cmd =
    typeof input === "object" && input !== null && "command" in input
      ? String((input as { command: unknown }).command)
      : String(input)
  return DANGEROUS_BASH_PATTERNS.some(p => p.test(cmd))
}

export interface RunAgentOptions {
  taskId: string
  prompt: string
  workspacePath: string
  systemPrompt: string   // pre-loaded skills content
  channel: string        // for HITL routing
  model?: string
  agentSessionId?: string
  abortSignal?: AbortSignal
  extraEnv?: Record<string, string>
  suppressStreamError?: boolean  // don't publish error events — caller handles retry
}

export interface RunAgentResult {
  success: boolean
  output: string
  error?: string
  sessionId?: string
}

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const isRoot = process.getuid?.() === 0

  // Use an isolated agent HOME so the subprocess does NOT read the user's personal
  // ~/.claude/CLAUDE.md (which contains personal assistant instructions like voice-note
  // bash scripts that conflict with the bot's TTS pipeline).
  // - Local dev (non-root): .agent-home/ in the project root — has a minimal CLAUDE.md.
  //   macOS Keychain handles auth so HOME doesn't affect credentials.
  // - Docker (root): per-task temp dir owned by uid 1001 — avoids /tmp/.claude ownership
  //   conflicts when a previous run created the dir as root.
  let agentHome: string
  if (isRoot) {
    agentHome = `/tmp/paulbot-${opts.taskId}`
    await fs.mkdir(agentHome, { recursive: true })
    await fs.chown(agentHome, 1001, 1001)
  } else {
    agentHome = process.env.PAULBOT_AGENT_HOME ?? path.resolve(process.cwd(), ".agent-home")
  }

  // Copy agent-config/ (skills, MCPs) into agentHome/.claude/ so the subprocess picks
  // them up. Must happen before spawn — await is valid here in the async function body.
  await prepareAgentHome(agentHome)

  return new Promise((resolve) => {
    const args: string[] = [
      "--print",
      "--verbose",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",  // we handle permissions ourselves via the stream
    ]

    if (opts.systemPrompt) {
      args.push("--system-prompt", opts.systemPrompt)
    }

    if (opts.model) {
      args.push("--model", opts.model)
    }

    if (opts.agentSessionId) {
      args.push("--resume", opts.agentSessionId)
    }

    args.push("--", opts.prompt)  // "--" ends flag parsing — prevents prompts starting with "-" from being treated as options

    const child = spawn("claude", args, {
      cwd: opts.workspacePath,
      stdio: ["ignore", "pipe", "pipe"],  // stdin → /dev/null, capture stdout/stderr
      env: { ...process.env, HOME: agentHome, ...(opts.extraEnv ?? {}) },
      // detached: put claude in its own process group so Next.js dev hot-reload SIGTERM
      // doesn't propagate to active tasks. We still read stdout/stderr via pipes.
      // The abort handler and timeout still work via child.kill().
      detached: true,
      ...(isRoot ? { uid: 1001, gid: 1001 } : {}),
    })

    // Handle abort
    opts.abortSignal?.addEventListener("abort", () => {
      console.warn(`[runner] AbortSignal fired for task ${opts.taskId} — killing claude`)
      child.kill("SIGTERM")
    })

    const rl = createInterface({ input: child.stdout })
    const outputLines: string[] = []
    let capturedSessionId: string | undefined

    rl.on("line", async (line) => {
      if (!line.trim()) return
      try {
        const event = JSON.parse(line) as Record<string, unknown>

        if (event.type === "result" && typeof event.session_id === "string") {
          capturedSessionId = event.session_id
        }

        if (event.type === "assistant") {
          const message = event.message as Record<string, unknown> | undefined
          const content = message?.content
          if (!Array.isArray(content)) return

          for (const block of content as Record<string, unknown>[]) {
            if (block.type === "text" && typeof block.text === "string") {
              outputLines.push(block.text)
              await publishStream(redis, opts.taskId, {
                type: "token",
                taskId: opts.taskId,
                text: block.text,
              })
            }

            if (block.type === "tool_use") {
              const toolName = typeof block.name === "string" ? block.name : String(block.name)

              // Check path safety before publishing tool use
              const pathDecision = checkPathPermission(toolName, block.input)
              if (pathDecision === "deny") {
                console.warn(`[runner] Path isolation kill — task ${opts.taskId} tool ${toolName} input: ${JSON.stringify(block.input)}`)
                child.kill("SIGTERM")
                return
              }

              // HITL gate — only for dangerous Bash patterns; safe reads auto-approve
              if (toolName === "Bash" && isBashDangerous(block.input)) {
                rl.pause()
                const decision = await requestHITLApproval({
                  taskId: opts.taskId,
                  tool: toolName,
                  input: block.input,
                  channel: opts.channel,
                })
                if (decision === "deny") {
                  await publishStream(redis, opts.taskId, {
                    type: "error",
                    taskId: opts.taskId,
                    message: `Tool "${toolName}" was denied by the user.`,
                  })
                  child.kill("SIGTERM")
                  return
                }
                rl.resume()
              }

              await publishStream(redis, opts.taskId, {
                type: "tool_use",
                taskId: opts.taskId,
                tool: toolName,
                input: sanitizeInput(block.input),
              })
            }
          }
        }

        // result event — handled by process close
      } catch {
        // Non-JSON line (e.g. debug output) — ignore
      }
    })

    let stderrOutput = ""
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stderrOutput += text
      // Log stderr lines immediately so they appear in the log file even if process dies
      text.split("\n").filter(Boolean).forEach(line => logger.warn(`[stderr] ${line}`))
    })

    child.on("close", async (code) => {
      // Clean up per-task home dir (Docker only)
      if (isRoot) fs.rm(agentHome, { recursive: true, force: true }).catch(() => {})

      const output = outputLines.join("")
      if (code === 0) {
        await publishStream(redis, opts.taskId, {
          type: "done",
          taskId: opts.taskId,
          result: output,
        })
        resolve({ success: true, output, sessionId: capturedSessionId })
      } else {
        const errMsg = stderrOutput || `Process exited with code ${code}`
        // Only suppress stream error for stale session failures — all other errors must be published
        const isStaleSession = errMsg.includes("No conversation found with session ID")
        if (!opts.suppressStreamError || !isStaleSession) {
          await publishStream(redis, opts.taskId, {
            type: "error",
            taskId: opts.taskId,
            message: errMsg,
          })
        }
        resolve({ success: false, output, error: errMsg })
      }
    })

    child.on("error", async (err) => {
      await publishStream(redis, opts.taskId, {
        type: "error",
        taskId: opts.taskId,
        message: err.message,
      })
      resolve({ success: false, output: "", error: err.message })
    })
  })
}
