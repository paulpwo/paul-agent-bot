import { Worker } from "bullmq"
import { redis } from "@/lib/redis/client"
import { repoToQueueName } from "./producer"

type JobProcessor = (data: import("./producer").TaskJobData) => Promise<void>

const workers = new Map<string, Worker>()

// Register a worker for a repo queue (concurrency: 1 — serializes tasks per repo)
export function registerRepoWorker(repo: string, processor: JobProcessor): Worker {
  const name = repoToQueueName(repo)

  if (workers.has(name)) return workers.get(name)!

  const worker = new Worker(
    name,
    async (job) => {
      await processor(job.data as import("./producer").TaskJobData)
    },
    {
      connection: redis,
      concurrency: 1,  // one task at a time per repo — prevents workspace race conditions
    }
  )

  worker.on("failed", (job, err) => {
    console.error(`[worker:${name}] job ${job?.id} failed:`, err.message)
  })

  workers.set(name, worker)
  return worker
}

// Get all active workers (for graceful shutdown)
export function getActiveWorkers(): Worker[] {
  return Array.from(workers.values())
}

// Graceful shutdown
export async function closeAllWorkers(): Promise<void> {
  await Promise.all(Array.from(workers.values()).map((w) => w.close()))
  workers.clear()
}
