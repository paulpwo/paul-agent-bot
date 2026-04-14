// Key builders
export const STREAM_CHANNEL = (taskId: string) => `task:${taskId}:stream`
export const APPROVAL_KEY = (approvalId: string) => `approval:${approvalId}`
export const DELIVERY_KEY = (deliveryId: string) => `gh-delivery:${deliveryId}`

// StreamEvent union type — published by worker, consumed by channel adapters
export type StreamEvent =
  | { type: "token"; taskId: string; text: string }
  | { type: "tool_use"; taskId: string; tool: string; input: unknown }
  | { type: "approval_needed"; taskId: string; approvalId: string; tool: string; input: unknown }
  | { type: "done"; taskId: string; result: string }
  | { type: "error"; taskId: string; message: string }

// Publish a StreamEvent to Redis pub/sub
export async function publishStream(redis: import("ioredis").Redis, taskId: string, event: StreamEvent): Promise<void> {
  await redis.publish(STREAM_CHANNEL(taskId), JSON.stringify(event))
}

// Check and set delivery dedup (returns true if already seen)
export async function checkAndSetDelivery(redis: import("ioredis").Redis, deliveryId: string): Promise<boolean> {
  const key = DELIVERY_KEY(deliveryId)
  const result = await redis.set(key, "1", "EX", 86400, "NX") // 24h TTL, set only if not exists
  return result === null // null means key already existed
}

// Set approval result
export async function setApprovalResult(redis: import("ioredis").Redis, approvalId: string, approved: boolean): Promise<void> {
  await redis.set(APPROVAL_KEY(approvalId), approved ? "approved" : "denied", "EX", 360) // 6min TTL
}

// Poll for approval result (returns null if still pending)
export async function pollApproval(redis: import("ioredis").Redis, approvalId: string): Promise<"approved" | "denied" | null> {
  const result = await redis.get(APPROVAL_KEY(approvalId))
  if (result === "approved") return "approved"
  if (result === "denied") return "denied"
  return null
}
