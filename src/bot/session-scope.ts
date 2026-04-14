import type { Context } from "grammy"
import { db } from "@/lib/db/client"

export interface ScopeKey {
  channel: "telegram"
  channelId: string    // chat_id as string
  threadId: string     // message_thread_id or "0" for non-topic chats
}

export function getScopeKey(ctx: Context): ScopeKey {
  const chatId = String(ctx.chat?.id ?? "0")
  const threadId = String(
    ctx.message?.message_thread_id ??
    ctx.callbackQuery?.message?.message_thread_id ??
    0
  )
  return { channel: "telegram", channelId: chatId, threadId }
}

// Get or create a DB Session for this scope + repo
export async function getOrCreateSession(scope: ScopeKey, repo: string): Promise<string> {
  const session = await db.session.upsert({
    where: {
      channel_channelId_threadId_repo: {
        channel: scope.channel,
        channelId: scope.channelId,
        threadId: scope.threadId,
        repo,
      },
    },
    create: { ...scope, repo },
    update: {},
  })
  return session.id
}
