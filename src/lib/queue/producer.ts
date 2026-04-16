import { Queue } from "bullmq"
import { redis } from "@/lib/redis/client"

export interface TaskJobData {
  taskId: string
  channel: string
  channelId: string
  threadId: string
  repo: string        // "owner/name"
  prompt: string
  modelHint?: "complex" | "coding" | "simple"
  voiceReply?: boolean  // user requested a voice note response
}

// Sanitize repo name to valid queue name: "owner/name" → "repo.owner.name"
// BullMQ does not allow colons in queue names
export function repoToQueueName(repo: string): string {
  return `repo.${repo.replace("/", ".")}`
}

// Get or create a queue for a repo (concurrency enforced by worker registry)
const queues = new Map<string, Queue>()

export function getQueue(repo: string): Queue {
  const name = repoToQueueName(repo)
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, { connection: redis }))
  }
  return queues.get(name)!
}

// Enqueue a task job
export async function enqueueTask(data: TaskJobData): Promise<string> {
  const queue = getQueue(data.repo)
  const job = await queue.add("task", data, {
    attempts: 1,           // no retries — failures are reported to the user
    removeOnComplete: 100, // keep last 100 completed
    removeOnFail: 200,     // keep last 200 failed for debugging
  })
  return job.id!
}
