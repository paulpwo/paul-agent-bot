import { Bot, Context, session, SessionFlavor } from "grammy"
import type { StorageAdapter } from "grammy"
import { registerCommands } from "./commands"
import { registerMessageHandler } from "./message-handler"
import { registerApprovalHandler } from "./approval-handler"
import { registerVoiceHandler } from "./voice-handler"
import { registerTopicsHandler } from "./topics-handler"
import { redis } from "@/lib/redis/client"

export interface SessionData {
  repo: string | null           // associated repo for this chat/topic
  claudeSessionId: string | null
}

export type BotContext = Context & SessionFlavor<SessionData>

// Redis-backed session storage — persists across bot restarts
const SESSION_TTL = 60 * 60 * 24 * 90  // 90 days
const redisSessionStorage: StorageAdapter<SessionData> = {
  async read(key) {
    const val = await redis.get(`tg:session:${key}`)
    return val ? (JSON.parse(val) as SessionData) : undefined
  },
  async write(key, value) {
    await redis.set(`tg:session:${key}`, JSON.stringify(value), "EX", SESSION_TTL)
  },
  async delete(key) {
    await redis.del(`tg:session:${key}`)
  },
}

export async function createBot(): Promise<Bot<BotContext>> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN environment variable not set")

  const bot = new Bot<BotContext>(token)

  // Session middleware — per (chat_id + thread_id) key, persisted in Redis
  bot.use(session<SessionData, BotContext>({
    initial: (): SessionData => ({ repo: null, claudeSessionId: null }),
    storage: redisSessionStorage,
    getSessionKey: (ctx) => {
      const chatId = ctx.chat?.id
      const threadId = ctx.message?.message_thread_id ?? ctx.callbackQuery?.message?.message_thread_id ?? 0
      return chatId ? `${chatId}:${threadId}` : undefined
    },
  }))

  registerCommands(bot)
  registerMessageHandler(bot)
  registerApprovalHandler(bot)
  registerVoiceHandler(bot)
  registerTopicsHandler(bot)

  return bot
}

export async function startBot(): Promise<void> {
  const bot = await createBot()
  console.log("[telegram] Bot starting...")
  bot.start({
    onStart: (info) => console.log(`[telegram] Bot @${info.username} running`),
  })
}
