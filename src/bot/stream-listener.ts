import { redis } from "@/lib/redis/client"
import { streamToTelegram } from "@/lib/channels/telegram/adapter"
import { db } from "@/lib/db/client"
import type { Bot } from "grammy"

// Called when a new Telegram task is created (from message-handler.ts)
// The message-handler stores tg:ack:<taskId> and tg:chat:<taskId> in Redis
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function watchTaskStream(bot: Bot<any>, taskId: string): Promise<void> {
  const chatIdStr = await redis.get(`tg:chat:${taskId}`)
  const msgIdStr = await redis.get(`tg:ack:${taskId}`)

  if (!chatIdStr || !msgIdStr) {
    console.warn(`[tg-stream] Missing chat/msg for task ${taskId}`)
    return
  }

  const chatId = parseInt(chatIdStr, 10)
  const messageId = parseInt(msgIdStr, 10)

  // Race condition fallback: if task already completed before we subscribed, edit directly from DB
  const existing = await db.task.findUnique({ where: { id: taskId }, select: { status: true, result: true, errorMessage: true } })
  if (existing?.status === "COMPLETED") {
    try {
      await bot.api.editMessageText(chatId, messageId, `✅ Done\n\n${(existing.result ?? "").slice(0, 3800)}`)
    } catch { /* non-fatal */ }
    return
  }
  if (existing?.status === "FAILED" || existing?.status === "CANCELLED") {
    try {
      await bot.api.editMessageText(chatId, messageId, `❌ Error\n\n${existing.errorMessage ?? existing.status}`)
    } catch { /* non-fatal */ }
    return
  }

  try {
    await streamToTelegram({ bot, taskId, chatId, messageId })
  } catch (err) {
    console.error(`[tg-stream] Stream error for task ${taskId}:`, err)
    try {
      await bot.api.sendMessage(
        chatId,
        `❌ Task failed: ${err instanceof Error ? err.message : "Unknown error"}`
      )
    } catch { /* non-fatal */ }
  }
}
