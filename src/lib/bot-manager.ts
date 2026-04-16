/**
 * BotManager — hot-reload Telegram bot when token changes in Settings.
 * Runs as a module-level singleton within the same Node.js process.
 */
import type { Bot } from "grammy"
import type { BotContext } from "@/bot/index"
import { createLogger } from "@/lib/logger"

const logger = createLogger("bot-manager")

let currentBot: Bot<BotContext> | null = null
let isStarting = false

export async function startTelegramBot(): Promise<void> {
  if (isStarting || currentBot !== null) return  // guard against double-init (Next.js calls register() multiple times in dev)
  isStarting = true

  try {
    const { createBot } = await import("@/bot/index")
    const bot = await createBot()
    currentBot = bot

    logger.info("Starting Telegram bot...")
    bot.start({
      onStart: (info) => logger.info(`Bot @${info.username} running`),
    }).catch((err: unknown) => {
      logger.error("Telegram bot stopped with error:", err)
      currentBot = null
      // 409 = another getUpdates is still open (old container long-poll not yet expired).
      // Wait 35s for Telegram's 30s poll timeout to clear, then retry.
      const is409 = typeof err === "object" && err !== null && (err as { error_code?: number }).error_code === 409
      if (is409) {
        logger.info("409 conflict — retrying in 35s")
        setTimeout(() => startTelegramBot(), 35_000)
      }
    })
  } catch (err) {
    logger.error("Failed to initialize Telegram bot:", err)
    currentBot = null
  } finally {
    isStarting = false
  }
}

export async function stopTelegramBot(): Promise<void> {
  if (!currentBot) return
  try {
    await currentBot.stop()
    logger.info("Telegram bot stopped")
  } catch { /* ignore stop errors */ }
  currentBot = null
}

export async function restartTelegramBot(): Promise<void> {
  logger.info("Restarting Telegram bot with new token...")
  await stopTelegramBot()
  await startTelegramBot()
}

export function isBotRunning(): boolean {
  return currentBot !== null
}

export function getRunningBot(): Bot<BotContext> | null {
  return currentBot
}
