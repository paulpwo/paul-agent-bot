import { randomUUID } from "crypto"
import path from "path"
import { isPathSafe } from "./workspace"
import { redis } from "@/lib/redis/client"
import { publishStream, pollApproval } from "@/lib/redis/pubsub"

const HITL_POLL_INTERVAL_MS = 500
const HITL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export type PermissionDecision = "allow" | "deny"

// Tools that only read — never modify the filesystem.
// These get relaxed path checking: allowed everywhere except sensitive paths.
const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "LS"])

// Paths that must never be read regardless of tool — credentials, keys, personal configs.
// Computed once at module load so HOME is resolved from the actual running environment.
const home = process.env.HOME ?? "/root"
const SENSITIVE_READ_PREFIXES: string[] = [
  path.join(home, ".ssh"),
  path.join(home, ".aws"),
  path.join(home, ".gcp"),
  path.join(home, ".azure"),
  path.join(home, ".claude"),
  path.join(home, ".gnupg"),
  path.join(home, ".netrc"),
  "/etc/passwd",
  "/etc/shadow",
  "/etc/sudoers",
]

function isSensitivePath(filePath: string): boolean {
  const resolved = path.resolve(filePath)
  return SENSITIVE_READ_PREFIXES.some(prefix => resolved === prefix || resolved.startsWith(prefix + "/"))
}

// Path isolation guard.
//
// Write tools (Edit, Write, Bash, …): strict — only workspace paths allowed.
// Read-only tools (Read, Glob, Grep): relaxed — allowed everywhere except
//   SENSITIVE_READ_PREFIXES (credentials, keys, personal configs).
//
// This lets the agent read package caches (pub-cache, npm, gradle, flutter SDK, …)
// and system paths without escaping the project workspace for writes.
export function checkPathPermission(toolName: string, toolInput: unknown): PermissionDecision | null {
  const inputs = JSON.stringify(toolInput)
  const pathMatches = inputs.match(/"([^"]*\/[^"]+)"/g)?.map(s => s.replace(/"/g, "")) ?? []

  for (const p of pathMatches) {
    if (!p.startsWith("/")) continue

    if (READ_ONLY_TOOLS.has(toolName)) {
      if (isSensitivePath(p)) {
        console.warn(`[permissions] Sensitive path read denied (tool: ${toolName}): ${p}`)
        return "deny"
      }
    } else {
      if (!isPathSafe(p)) {
        console.warn(`[permissions] Path isolation violation (tool: ${toolName}): ${p}`)
        return "deny"
      }
    }
  }
  return null
}

// HITL for interactive channels (Telegram, Slack)
export async function requestHITLApproval(opts: {
  taskId: string
  tool: string
  input: unknown
  channel: string
}): Promise<PermissionDecision> {
  const approvalId = randomUUID()

  // Publish approval_needed event — channel adapter will send button to user
  await publishStream(redis, opts.taskId, {
    type: "approval_needed",
    taskId: opts.taskId,
    approvalId,
    tool: opts.tool,
    input: opts.input,
  })

  // Poll Redis for the user's response
  const deadline = Date.now() + HITL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, HITL_POLL_INTERVAL_MS))
    const result = await pollApproval(redis, approvalId)
    if (result === "approved") return "allow"
    if (result === "denied") return "deny"
  }

  // Timeout → auto-deny
  console.warn(`[permissions] HITL timeout for task ${opts.taskId}, tool ${opts.tool}`)
  return "deny"
}
