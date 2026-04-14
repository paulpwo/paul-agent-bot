import type { Bot } from "grammy"
import type { BotContext } from "./index"
import { setApprovalResult } from "@/lib/redis/pubsub"
import { redis } from "@/lib/redis/client"

export function registerApprovalHandler(bot: Bot<BotContext>): void {
  // Handle approve:<approvalId> callback
  bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
    const approvalId = ctx.match[1]
    await setApprovalResult(redis, approvalId, true)
    await ctx.editMessageText("✅ Approved")
    await ctx.answerCallbackQuery()
  })

  // Handle deny:<approvalId> callback
  bot.callbackQuery(/^deny:(.+)$/, async (ctx) => {
    const approvalId = ctx.match[1]
    await setApprovalResult(redis, approvalId, false)
    await ctx.editMessageText("❌ Denied")
    await ctx.answerCallbackQuery()
  })
}
