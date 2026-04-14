import * as cron from "node-cron"
import type { ScheduledTask } from "node-cron"
import { CronExpressionParser } from "cron-parser"
import { db } from "@/lib/db/client"
import { enqueueTask } from "@/lib/queue/producer"
import type { CronJob } from "@prisma/client"

const scheduledJobs = new Map<string, ScheduledTask>()

export function computeNextRun(schedule: string): Date {
  const interval = CronExpressionParser.parse(schedule)
  return interval.next().toDate()
}

export async function startScheduler(): Promise<void> {
  const jobs = await db.cronJob.findMany({ where: { enabled: true } })
  for (const job of jobs) {
    scheduleCronJob(job)
  }
  console.log(`[scheduler] Started ${jobs.length} cron job${jobs.length === 1 ? "" : "s"}`)
}

export function scheduleCronJob(job: CronJob): void {
  // Stop existing task if present
  if (scheduledJobs.has(job.id)) {
    scheduledJobs.get(job.id)!.stop()
    scheduledJobs.delete(job.id)
  }

  const task = cron.schedule(
    job.schedule,
    async () => {
      try {
        // Create a Task record first, then enqueue
        const taskRecord = await db.task.create({
          data: {
            sessionId: await getOrCreateCronSession(job),
            channel: job.channel,
            channelId: job.channelId,
            threadId: job.threadId,
            repo: job.repo,
            prompt: job.prompt,
            status: "QUEUED",
          },
        })

        await enqueueTask({
          taskId: taskRecord.id,
          channel: job.channel,
          channelId: job.channelId,
          threadId: job.threadId,
          repo: job.repo,
          prompt: job.prompt,
        })

        // Update lastRun and nextRun
        const nextRun = computeNextRun(job.schedule)
        await db.cronJob.update({
          where: { id: job.id },
          data: { lastRun: new Date(), nextRun },
        })
      } catch (err) {
        console.error(`[scheduler] Error running cron job ${job.id} (${job.name}):`, err)
      }
    },
  )

  scheduledJobs.set(job.id, task)
}

export function unscheduleCronJob(jobId: string): void {
  const task = scheduledJobs.get(jobId)
  if (task) {
    task.stop()
    scheduledJobs.delete(jobId)
  }
}

export async function reloadCronJob(jobId: string): Promise<void> {
  unscheduleCronJob(jobId)
  const job = await db.cronJob.findUnique({ where: { id: jobId } })
  if (job && job.enabled) {
    scheduleCronJob(job)
  }
}

// -----------------------------------------------------------------------
// Internal: get or create a synthetic Session record for cron-fired tasks
// -----------------------------------------------------------------------
async function getOrCreateCronSession(job: CronJob): Promise<string> {
  const existing = await db.session.findUnique({
    where: {
      channel_channelId_threadId_repo: {
        channel: job.channel,
        channelId: job.channelId,
        threadId: job.threadId,
        repo: job.repo,
      },
    },
  })
  if (existing) return existing.id

  const session = await db.session.create({
    data: {
      channel: job.channel,
      channelId: job.channelId,
      threadId: job.threadId,
      repo: job.repo,
    },
  })
  return session.id
}
