/**
 * BotManager — hot-reload Telegram bot when token changes in Settings.
 * Runs as a module-level singleton within the same Node.js process.
 */
import type { Bot } from "grammy"
import type { BotContext } from "@/bot/index"

let currentBot: Bot<BotContext> | null = null
let isStarting = false

export async function startTelegramBot(): Promise<void> {
  if (isStarting) return
  isStarting = true

  try {
    const { createBot } = await import("@/bot/index")
    const bot = await createBot()
    currentBot = bot

    console.log("[bot-manager] Starting Telegram bot...")
    bot.start({
      onStart: (info) => console.log(`[bot-manager] Bot @${info.username} running`),
    }).catch((err: unknown) => {
      console.error("[bot-manager] Telegram bot stopped with error:", err)
      currentBot = null
      // 409 = another getUpdates is still open (old container long-poll not yet expired).
      // Wait 35s for Telegram's 30s poll timeout to clear, then retry.
      const is409 = typeof err === "object" && err !== null && (err as { error_code?: number }).error_code === 409
      if (is409) {
        console.log("[bot-manager] 409 conflict — retrying in 35s")
        setTimeout(() => startTelegramBot(), 35_000)
      }
    })
  } catch (err) {
    console.error("[bot-manager] Failed to initialize Telegram bot:", err)
    currentBot = null
  } finally {
    isStarting = false
  }
}

export async function stopTelegramBot(): Promise<void> {
  if (!currentBot) return
  try {
    await currentBot.stop()
    console.log("[bot-manager] Telegram bot stopped")
  } catch { /* ignore stop errors */ }
  currentBot = null
}

export async function restartTelegramBot(): Promise<void> {
  console.log("[bot-manager] Restarting Telegram bot with new token...")
  await stopTelegramBot()
  await startTelegramBot()
}

export function isBotRunning(): boolean {
  return currentBot !== null
}

export function getRunningBot(): Bot<BotContext> | null {
  return currentBot
}
