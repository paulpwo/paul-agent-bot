import { randomUUID } from "crypto"
import { isPathSafe } from "./workspace"
import { redis } from "@/lib/redis/client"
import { publishStream, pollApproval } from "@/lib/redis/pubsub"

const HITL_POLL_INTERVAL_MS = 500
const HITL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export type PermissionDecision = "allow" | "deny"

// R10: Path isolation guard — auto-deny any path outside WORKSPACE_BASE
export function checkPathPermission(toolName: string, toolInput: unknown): PermissionDecision | null {
  // Check if any string value in toolInput looks like a file path
  const inputs = JSON.stringify(toolInput)
  const pathMatches = inputs.match(/"([^"]*\/[^"]+)"/g)?.map(s => s.replace(/"/g, "")) ?? []

  for (const p of pathMatches) {
    if (p.startsWith("/") && !isPathSafe(p)) {
      console.warn(`[permissions] Path isolation violation (tool: ${toolName}): ${p}`)
      return "deny"
    }
  }
  return null // no path issue found
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
