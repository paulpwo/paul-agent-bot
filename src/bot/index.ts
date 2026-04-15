import { Bot, Context, session, SessionFlavor } from "grammy"
import { registerCommands } from "./commands"
import { registerMessageHandler } from "./message-handler"
import { registerApprovalHandler } from "./approval-handler"
import { registerVoiceHandler } from "./voice-handler"
import { registerTopicsHandler } from "./topics-handler"

export interface SessionData {
  repo: string | null           // associated repo for this chat/topic
  claudeSessionId: string | null
}

export type BotContext = Context & SessionFlavor<SessionData>

export async function createBot(): Promise<Bot<BotContext>> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN environment variable not set")

  const bot = new Bot<BotContext>(token)

  // Session middleware — per (chat_id + thread_id) key
  bot.use(session<SessionData, BotContext>({
    initial: (): SessionData => ({ repo: null, claudeSessionId: null }),
    getSessionKey: (ctx) => {
      const chatId = ctx.chat?.id
      const threadId = ctx.message?.message_thread_id ?? 0
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
