import type { Bot } from "grammy"
import type { BotContext } from "./index"
import { getScopeKey, getOrCreateSession } from "./session-scope"
import { enqueueTask } from "@/lib/queue/producer"
import { db } from "@/lib/db/client"
import { watchTaskStream } from "./stream-listener"
import { wantsVoiceReply } from "./voice-intent"

export function registerMessageHandler(bot: Bot<BotContext>): void {
  bot.on("message:text", async (ctx) => {
    let repo = ctx.session.repo
    if (!repo) {
      // Auto-select if exactly one enabled repo exists
      const enabledRepos = await db.repo.findMany({ where: { enabled: true } })
      if (enabledRepos.length === 1) {
        repo = enabledRepos[0].fullName
        ctx.session.repo = repo
      } else if (enabledRepos.length === 0) {
        await ctx.reply("No repos enabled. Go to the dashboard → Repos and enable one.")
        return
      } else {
        await ctx.reply(
          "Multiple repos available. Use /repo owner/name to select one.\n\n" +
          enabledRepos.map((r) => `• ${r.fullName}`).join("\n")
        )
        return
      }
    }

    const prompt = ctx.message.text
    const voiceReply = wantsVoiceReply(prompt)
    const scope = getScopeKey(ctx)

    // Upsert session in DB
    await getOrCreateSession(scope, repo)

    // Create task record
    const task = await db.task.create({
      data: {
        channel: "telegram",
        channelId: scope.channelId,
        threadId: scope.threadId,
        repo,
        prompt,
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

    // Send ack message (will be edited with streaming output)
    const ackMsg = await ctx.reply("⚡ Working...", { reply_parameters: { message_id: ctx.message.message_id } })

    // Store ack message ID for streaming
    const { redis } = await import("@/lib/redis/client")
    await redis.set(`tg:ack:${task.id}`, String(ackMsg.message_id), "EX", 3600)
    await redis.set(`tg:chat:${task.id}`, String(ctx.chat.id), "EX", 3600)

    // Enqueue task
    const jobId = await enqueueTask({
      taskId: task.id,
      channel: "telegram",
      channelId: scope.channelId,
      threadId: scope.threadId,
      repo,
      prompt,
      voiceReply,
    })

    await db.task.update({ where: { id: task.id }, data: { bullJobId: jobId } })

    // Start listening to stream and editing the ack message
    void watchTaskStream(bot, task.id)
  })
}
