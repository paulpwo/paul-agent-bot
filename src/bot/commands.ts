import type { Bot } from "grammy"
import type { BotContext } from "./index"
import { db } from "@/lib/db/client"
import { getScopeKey } from "./session-scope"

export function registerCommands(bot: Bot<BotContext>): void {
  // /repo <owner/name> — associate this chat/topic with a repo
  bot.command("repo", async (ctx) => {
    const repoArg = ctx.match?.trim()
    if (!repoArg || !repoArg.includes("/")) {
      await ctx.reply("Usage: /repo owner/name")
      return
    }

    const [owner, name] = repoArg.split("/")
    const repoRecord = await db.repo.findFirst({ where: { owner, name, enabled: true } })
    if (!repoRecord) {
      await ctx.reply(`❌ Repo \`${repoArg}\` not found or not enabled. Check /dashboard/repos.`, { parse_mode: "Markdown" })
      return
    }

    ctx.session.repo = repoArg
    await ctx.reply(`✅ Associated with \`${repoArg}\`. Send any message to start a task.`, { parse_mode: "Markdown" })
  })

  // /new — reset session (start fresh conversation)
  bot.command("new", async (ctx) => {
    ctx.session.claudeSessionId = null
    await ctx.reply("🔄 New conversation started.")
  })

  // /status — show current task status
  bot.command("status", async (ctx) => {
    const scope = getScopeKey(ctx)
    const repo = ctx.session.repo
    if (!repo) {
      await ctx.reply("No repo associated. Use /repo owner/name first.")
      return
    }

    const task = await db.task.findFirst({
      where: { channel: "telegram", channelId: scope.channelId, threadId: scope.threadId },
      orderBy: { createdAt: "desc" },
    })

    if (!task) {
      await ctx.reply("No tasks found for this chat.")
      return
    }

    const emoji = { QUEUED: "⏳", RUNNING: "⚡", COMPLETED: "✅", FAILED: "❌", CANCELLED: "🚫" }[task.status] ?? "❓"
    await ctx.reply(`${emoji} *${task.status}*\n\n${task.prompt.slice(0, 200)}`, { parse_mode: "Markdown" })
  })

  // /stop — cancel the running task
  bot.command("stop", async (ctx) => {
    const scope = getScopeKey(ctx)

    const task = await db.task.findFirst({
      where: {
        channel: "telegram",
        channelId: scope.channelId,
        threadId: scope.threadId,
        status: "RUNNING",
      },
      orderBy: { createdAt: "desc" },
    })

    if (!task) {
      await ctx.reply("No running task to stop.")
      return
    }

    const { redis } = await import("@/lib/redis/client")
    await redis.set(`cancel:${task.id}`, "1", "EX", 60)
    await db.task.update({ where: { id: task.id }, data: { status: "CANCELLED" } })
    await ctx.reply("🚫 Task cancelled.")
  })

  // /push — push current branch (manual trigger)
  bot.command("push", async (ctx) => {
    await ctx.reply("Push is handled automatically after each task. Use /pr to open a pull request.")
  })

  // /pr — open a PR for the last completed task (placeholder)
  bot.command("pr", async (ctx) => {
    await ctx.reply("PR creation is automatic when a task completes on a GitHub-triggered session. Manual PR from Telegram coming in a future update.")
  })
}
