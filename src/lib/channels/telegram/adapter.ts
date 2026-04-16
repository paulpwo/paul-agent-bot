import { redisSub, redis } from "@/lib/redis/client"
import { STREAM_CHANNEL, setApprovalResult } from "@/lib/redis/pubsub"
import type { StreamEvent } from "@/lib/redis/pubsub"
import { Bot, InlineKeyboard } from "grammy"
import { createLogger } from "@/lib/logger"

const logger = createLogger("tg-adapter")

// Rate limit: Telegram allows ~1 edit/second per message
const EDIT_INTERVAL_MS = 1000

function toolSummary(tool: string, input: unknown): string {
  if (typeof input !== "object" || input === null) return tool
  const inp = input as Record<string, unknown>
  const str = (v: unknown, max = 60) => String(v ?? "").slice(0, max)
  const lastSegments = (p: unknown, n = 2) => str(p).split("/").filter(Boolean).slice(-n).join("/")

  switch (tool) {
    case "Bash":   return `Bash: \`${str(inp.command, 60)}\``
    case "Read":   return `Read: \`${lastSegments(inp.file_path ?? inp.path)}\``
    case "Write":  return `Write: \`${lastSegments(inp.file_path ?? inp.path)}\``
    case "Edit":   return `Edit: \`${lastSegments(inp.file_path ?? inp.path)}\``
    case "Glob":   return `Glob: \`${str(inp.pattern, 50)}\``
    case "Grep":   return `Grep: \`${str(inp.pattern, 50)}\``
    case "Agent":  return `Agent: ${str(inp.description ?? inp.prompt, 60)}`
    case "WebFetch": return `Fetch: \`${str(inp.url, 60)}\``
    case "WebSearch": return `Search: \`${str(inp.query, 60)}\``
    default:       return tool
  }
}

interface StreamToTelegramOpts {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot: Bot<any>
  taskId: string
  chatId: number
  messageId: number   // the ack message to edit
  isVoice?: boolean
  threadId?: number
}

export async function streamToTelegram(opts: StreamToTelegramOpts): Promise<void> {
  const { bot, taskId, chatId, messageId, isVoice, threadId } = opts
  const channel = STREAM_CHANNEL(taskId)

  // Lazy import to avoid circular dependency (stream-listener imports adapter and vice versa)
  const { resolveTask } = await import("@/bot/stream-listener")

  return new Promise((resolve, reject) => {
    let buffer = "⚡ Working...\n\n"
    let lastSent = buffer
    let editTimer: ReturnType<typeof setInterval> | null = null

    const flushEdit = async () => {
      if (buffer === lastSent) return
      try {
        await bot.api.editMessageText(chatId, messageId, buffer, {
          parse_mode: "Markdown",
        })
        lastSent = buffer
      } catch (err: unknown) {
        // Ignore "message is not modified" Telegram error (400)
        if ((err as { error_code?: number })?.error_code !== 400) {
          logger.error("editMessageText failed:", err)
        }
      }
    }

    editTimer = setInterval(flushEdit, EDIT_INTERVAL_MS)

    const handler = async (ch: string, message: string) => {
      if (ch !== channel) return
      try {
        const event: StreamEvent = JSON.parse(message)

        switch (event.type) {
          case "token":
            buffer += event.text
            break

          case "tool_use":
            buffer += `\n\n_🔧 ${toolSummary(event.tool, event.input)}_`
            break

          case "approval_needed":
            await handleApprovalRequest({ bot, chatId, event, taskId, threadId })
            break

          case "done":
            clearInterval(editTimer!)
            cleanup()
            await resolveTask({ bot, chatId, messageId, taskId, result: event.result, isVoice: isVoice ?? false, threadId })
            resolve()
            break

          case "error":
            buffer = `❌ Error\n\n${event.message}`
            clearInterval(editTimer!)
            await flushEdit()
            cleanup()
            reject(new Error(event.message))
            break
        }
      } catch (err) {
        logger.error("Stream parse error:", err)
      }
    }

    const cleanup = () => {
      redisSub.removeListener("message", handler)
      redisSub.unsubscribe(channel).catch(() => {})
    }

    redisSub.on("message", handler)
    redisSub.subscribe(channel).catch(reject)
  })
}

// Send approval inline keyboard and wait for user response
async function handleApprovalRequest(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot: Bot<any>
  chatId: number
  event: Extract<StreamEvent, { type: "approval_needed" }>
  taskId: string
  threadId?: number
}): Promise<void> {
  const { bot, chatId, event, threadId } = opts

  const keyboard = new InlineKeyboard()
    .text("✅ Approve", `approve:${event.approvalId}`)
    .text("❌ Deny", `deny:${event.approvalId}`)

  await bot.api.sendMessage(
    chatId,
    `🔒 *Permission request*\n\nTool: \`${event.tool}\`\n\nApprove?`,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard,
      ...(threadId ? { message_thread_id: threadId } : {}),
    }
  )
}
