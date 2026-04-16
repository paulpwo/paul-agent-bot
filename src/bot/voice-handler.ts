import { execFile } from "child_process"
import { promisify } from "util"
import { join } from "path"
import { tmpdir } from "os"
import { randomUUID } from "crypto"
import type { Bot } from "grammy"
import type { BotContext } from "./index"
import { getScopeKey, getOrCreateSession } from "./session-scope"
import { enqueueTask } from "@/lib/queue/producer"
import { db } from "@/lib/db/client"
import { redis } from "@/lib/redis/client"
import { watchTaskStream } from "./stream-listener"
import { wantsVoiceReply } from "./voice-intent"
const exec = promisify(execFile)

// Download a Telegram file to a local temp path
async function downloadFile(fileId: string): Promise<string> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN environment variable not set")

  // Resolve file_path via Telegram API
  const metaRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)
  if (!metaRes.ok) throw new Error(`getFile failed: ${metaRes.status}`)
  const meta = (await metaRes.json()) as { ok: boolean; result: { file_path?: string } }
  if (!meta.ok || !meta.result.file_path) throw new Error("No file_path from Telegram")

  const url = `https://api.telegram.org/file/bot${token}/${meta.result.file_path}`

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to download file: ${response.status}`)

  const tmpPath = join(tmpdir(), `paulagentbot-voice-${randomUUID()}.oga`)
  const buffer = await response.arrayBuffer()
  await import("fs/promises").then(fs => fs.writeFile(tmpPath, Buffer.from(buffer)))

  return tmpPath
}

// Transcribe using local Whisper script
async function transcribeAudio(filePath: string, lang = "es"): Promise<string> {
  const script = `${process.env.HOME}/.claude/scripts/transcribe-voice.sh`
  const { stdout } = await exec("bash", [script, filePath, lang])
  return stdout.trim()
}

export function registerVoiceHandler(bot: Bot<BotContext>): void {
  bot.on("message:voice", async (ctx) => {
    const repo = ctx.session.repo
    if (!repo) {
      await ctx.reply("No repo associated. Use /repo owner/name first.")
      return
    }

    const statusMsg = await ctx.reply("🎤 Transcribing...", {
      reply_parameters: { message_id: ctx.message.message_id },
    })

    try {
      const filePath = await downloadFile(ctx.message.voice.file_id)
      const transcript = await transcribeAudio(filePath)

      // Clean up temp file (transcribe-voice.sh also removes it via trap, but be safe)
      await import("fs/promises").then(fs => fs.unlink(filePath).catch(() => {}))

      if (!transcript) {
        await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, "❌ Could not transcribe audio")
        return
      }

      const scope = getScopeKey(ctx)
      await getOrCreateSession(scope, repo)

      // Create task record (same flow as text message)
      const task = await db.task.create({
        data: {
          channel: "telegram",
          channelId: scope.channelId,
          threadId: scope.threadId,
          repo,
          prompt: transcript,
          status: "QUEUED",
          session: {
            connect: {
              channel_channelId_threadId_repo: {
                channel: scope.channel,
                channelId: scope.channelId,
                threadId: scope.threadId,
                repo,
              },
            },
          },
        },
      })

      const voiceReply = wantsVoiceReply(transcript)

      // Reuse the transcription status message as the ack — edit it to show
      // the transcript + working state. No second message needed.
      await bot.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        `🎤 _${transcript}_\n\n⚡ Working on it...`,
        { parse_mode: "Markdown" }
      )

      await redis.set(`tg:ack:${task.id}`, String(statusMsg.message_id), "EX", 3600)
      await redis.set(`tg:chat:${task.id}`, String(ctx.chat.id), "EX", 3600)
      // Set voice flag BEFORE watchTaskStream — stream-listener reads it immediately on subscribe
      if (voiceReply) await redis.set(`tg:voice:${task.id}`, "1", "EX", 3600)

      const jobId = await enqueueTask({
        taskId: task.id,
        channel: "telegram",
        channelId: scope.channelId,
        threadId: scope.threadId,
        repo,
        prompt: transcript,
        voiceReply,
      })

      await db.task.update({ where: { id: task.id }, data: { bullJobId: jobId } })

      // Watch task stream and edit the ack message with the result
      void watchTaskStream(bot, task.id)

    } catch (err) {
      console.error("[voice-handler] Error:", err)
      await bot.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        `❌ Voice error: ${err instanceof Error ? err.message : "Unknown"}`
      )
    }
  })
}
