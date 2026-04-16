import { redis } from "@/lib/redis/client"
import { streamToTelegram } from "@/lib/channels/telegram/adapter"
import { db } from "@/lib/db/client"
import type { Bot } from "grammy"
import { createLogger } from "@/lib/logger"

const logger = createLogger("tg-stream")

// Called when a new Telegram task is created (from message-handler.ts / voice-handler.ts)
// Reads tg:ack:<taskId> and tg:chat:<taskId> from Redis, streams result to Telegram.
// If tg:voice:<taskId> is set, converts result to voice via OpenAI TTS and sends as voice note.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function watchTaskStream(bot: Bot<any>, taskId: string): Promise<void> {
  const chatIdStr = await redis.get(`tg:chat:${taskId}`)
  const msgIdStr = await redis.get(`tg:ack:${taskId}`)

  if (!chatIdStr || !msgIdStr) {
    logger.warn(`Missing chat/msg for task ${taskId}`)
    return
  }

  const chatId = parseInt(chatIdStr, 10)
  const messageId = parseInt(msgIdStr, 10)
  const isVoice = (await redis.get(`tg:voice:${taskId}`)) === "1"

  // Race condition fallback: task already completed before we subscribed
  const existing = await db.task.findUnique({
    where: { id: taskId },
    select: { status: true, result: true, errorMessage: true },
  })

  if (existing?.status === "COMPLETED") {
    await resolveTask({ bot, chatId, messageId, taskId, result: existing.result ?? "", isVoice })
    return
  }
  if (existing?.status === "FAILED" || existing?.status === "CANCELLED") {
    await resolveError({ bot, chatId, messageId, error: existing.errorMessage ?? existing.status ?? "Unknown" })
    return
  }

  try {
    await streamToTelegram({ bot, taskId, chatId, messageId, isVoice })
  } catch (err) {
    logger.error(`Stream error for task ${taskId}:`, err)
    try {
      await bot.api.sendMessage(chatId, `❌ Task failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } catch { /* non-fatal */ }
  }
}

// Edit the ack message on error
async function resolveError(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot: Bot<any>
  chatId: number
  messageId: number
  error: string
}): Promise<void> {
  try {
    await opts.bot.api.editMessageText(opts.chatId, opts.messageId, `❌ Error\n\n${opts.error}`)
  } catch { /* non-fatal */ }
}

// On task completion: either send voice note or edit ack message with text result
export async function resolveTask(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot: Bot<any>
  chatId: number
  messageId: number
  taskId: string
  result: string
  isVoice: boolean
}): Promise<void> {
  const { bot, chatId, messageId, result, isVoice } = opts

  if (!isVoice) {
    try {
      await bot.api.editMessageText(chatId, messageId, `✅ Done\n\n${result.slice(0, 3800)}`)
    } catch { /* non-fatal */ }
    return
  }

  // Extract VOICE_SUMMARY section injected by task-worker, fallback to trimmed result
  const summaryMatch = result.match(/VOICE_SUMMARY:\s*([\s\S]+?)(?:\n\n|\n#|$)/)
  const voiceText = (summaryMatch?.[1]?.trim() ?? result.replace(/```[\s\S]*?```/g, "").trim()).slice(0, 1000)

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    logger.warn("OPENAI_API_KEY not set — falling back to text response")
    try {
      await bot.api.editMessageText(chatId, messageId, `✅ Done\n\n${result.slice(0, 3800)}`)
    } catch { /* non-fatal */ }
    return
  }

  try {
    // Generate audio via OpenAI TTS
    const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: voiceText,
        voice: "nova",
        response_format: "opus",  // .ogg — Telegram accepts as voice note
      }),
    })

    if (!ttsRes.ok) {
      const err = await ttsRes.text()
      throw new Error(`OpenAI TTS error ${ttsRes.status}: ${err}`)
    }

    const audioBuffer = Buffer.from(await ttsRes.arrayBuffer())

    // Send as Telegram voice note
    const token = process.env.TELEGRAM_BOT_TOKEN!
    const form = new FormData()
    form.append("chat_id", String(chatId))
    form.append("voice", new Blob([audioBuffer], { type: "audio/ogg" }), "response.ogg")

    const sendRes = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, {
      method: "POST",
      body: form,
    })

    if (!sendRes.ok) {
      const err = await sendRes.text()
      throw new Error(`sendVoice error ${sendRes.status}: ${err}`)
    }

    // Delete the "Working on it..." status message
    await bot.api.deleteMessage(chatId, messageId).catch(() => {})

  } catch (err) {
    logger.error("Voice reply failed — falling back to text:", err)
    try {
      await bot.api.editMessageText(chatId, messageId, `✅ Done\n\n${result.slice(0, 3800)}`)
    } catch { /* non-fatal */ }
  }
}
