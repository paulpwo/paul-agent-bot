import { db } from "@/lib/db/client"
import { registerRepoWorker } from "@/lib/queue/registry"
import { enqueueTask } from "@/lib/queue/producer"
import { processTask } from "./task-worker"
import { createLogger } from "@/lib/logger"

const logger = createLogger("workers")

async function recoverStuckTasks(): Promise<void> {
  // On startup, any task left in RUNNING state has no active worker behind it.
  // Mark them FAILED so the UI doesn't show infinite spinners.
  const stuck = await db.task.updateMany({
    where: { status: "RUNNING" },
    data: {
      status: "FAILED",
      errorMessage: "Worker restarted while task was running. Please retry.",
    },
  })
  if (stuck.count > 0) {
    logger.info(`Recovered ${stuck.count} stuck RUNNING task(s) → FAILED`)
  }

  // On startup, re-enqueue any QUEUED tasks whose BullMQ jobs may have been lost
  // (e.g. repo was enabled after worker started, or Redis was flushed).
  const orphaned = await db.task.findMany({
    where: { status: "QUEUED" },
    select: { id: true, repo: true, channel: true, channelId: true, threadId: true, prompt: true },
  })
  for (const task of orphaned) {
    await enqueueTask({
      taskId: task.id,
      repo: task.repo,
      channel: task.channel,
      channelId: task.channelId,
      threadId: task.threadId,
      prompt: task.prompt,
    })
  }
  if (orphaned.length > 0) {
    logger.info(`Re-enqueued ${orphaned.length} orphaned QUEUED task(s)`)
  }
}

export async function startWorkers(): Promise<void> {
  await recoverStuckTasks()

  // Load all enabled repos and register a BullMQ worker for each
  const repos = await db.repo.findMany({ where: { enabled: true } })

  for (const repo of repos) {
    registerRepoWorker(`${repo.owner}/${repo.name}`, processTask)
  }

  const count = repos.length
  logger.info(`Started ${count} repo worker${count === 1 ? "" : "s"}`)

  // Start Telegram bot via BotManager — only if TELEGRAM_BOT_TOKEN is set in env
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const { startTelegramBot } = await import("@/lib/bot-manager")
      await startTelegramBot()
    } catch (err) {
      logger.error("Failed to start Telegram bot:", err)
    }
  } else {
    logger.info("TELEGRAM_BOT_TOKEN not set — skipping Telegram bot")
  }

  // Start Slack bot (only if token is configured)
  try {
    const { getSetting, SETTINGS_KEYS } = await import("@/lib/settings")
    const slackToken =
      (await getSetting(SETTINGS_KEYS.SLACK_BOT_TOKEN)) ?? process.env.SLACK_BOT_TOKEN
    if (slackToken) {
      logger.info("Slack bot token found — Slack webhook adapter is active")
    } else {
      logger.info("No Slack bot token configured — skipping Slack initialization")
    }
  } catch (err) {
    logger.error("Failed to initialize Slack bot:", err)
  }

  // Start cron scheduler
  try {
    const { startScheduler } = await import("@/lib/scheduler")
    await startScheduler()
  } catch (err) {
    logger.error("Failed to start scheduler:", err)
  }

  // Graceful shutdown — stop Telegram bot first so the long-poll is released
  // before the process exits. Without this, the next container startup gets a
  // 409 conflict because Telegram keeps the old getUpdates connection open.
  process.on("SIGTERM", async () => {
    const [{ closeAllWorkers }, { stopTelegramBot }] = await Promise.all([
      import("@/lib/queue/registry"),
      import("@/lib/bot-manager"),
    ])
    await Promise.all([closeAllWorkers(), stopTelegramBot()])
    process.exit(0)
  })
}

// Auto-start only when this file is run directly as a worker entrypoint (WORKER_ONLY=true).
// When imported by instrumentation.ts, startWorkers() is called explicitly — no auto-run needed.
if (process.env.WORKER_ONLY === "true") {
  startWorkers().catch((err) => {
    logger.error("Fatal error:", err)
    process.exit(1)
  })
}
