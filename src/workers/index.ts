import { db } from "@/lib/db/client"
import { registerRepoWorker } from "@/lib/queue/registry"
import { processTask } from "./task-worker"

export async function startWorkers(): Promise<void> {
  // Load all enabled repos and register a BullMQ worker for each
  const repos = await db.repo.findMany({ where: { enabled: true } })

  for (const repo of repos) {
    registerRepoWorker(`${repo.owner}/${repo.name}`, processTask)
  }

  const count = repos.length
  console.log(`[workers] Started ${count} repo worker${count === 1 ? "" : "s"}`)

  // Start Telegram bot via BotManager (supports hot-reload from Settings)
  try {
    const { startTelegramBot } = await import("@/lib/bot-manager")
    await startTelegramBot()
  } catch (err) {
    console.error("[workers] Failed to start Telegram bot:", err)
  }

  // Start Slack bot (only if token is configured)
  try {
    const { getSetting, SETTINGS_KEYS } = await import("@/lib/settings")
    const slackToken =
      (await getSetting(SETTINGS_KEYS.SLACK_BOT_TOKEN)) ?? process.env.SLACK_BOT_TOKEN
    if (slackToken) {
      console.log("[workers] Slack bot token found — Slack webhook adapter is active")
    } else {
      console.log("[workers] No Slack bot token configured — skipping Slack initialization")
    }
  } catch (err) {
    console.error("[workers] Failed to initialize Slack bot:", err)
  }

  // Start cron scheduler
  try {
    const { startScheduler } = await import("@/lib/scheduler")
    await startScheduler()
  } catch (err) {
    console.error("[workers] Failed to start scheduler:", err)
  }

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    const { closeAllWorkers } = await import("@/lib/queue/registry")
    await closeAllWorkers()
    process.exit(0)
  })
}
