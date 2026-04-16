import type { Bot } from "grammy"
import type { BotContext } from "./index"
import { db } from "@/lib/db/client"
import { getScopeKey } from "./session-scope"
import { InlineKeyboard } from "grammy"

export function registerCommands(bot: Bot<BotContext>): void {
  // /repo [owner/name or partial name] — associate this chat/topic with a repo
  // No args → show enabled repos as inline keyboard
  // Partial arg (e.g. "portfolio") → fuzzy match by repo name
  // Exact arg (e.g. "paulpwo/portfolio") → direct assignment
  bot.command("repo", async (ctx) => {
    const repoArg = ctx.match?.trim()
    const enabledRepos = await db.repo.findMany({ where: { enabled: true }, orderBy: [{ owner: "asc" }, { name: "asc" }] })

    if (enabledRepos.length === 0) {
      await ctx.reply("No repos enabled. Go to the dashboard → Repos and enable one.")
      return
    }

    // No arg → show keyboard
    if (!repoArg) {
      const keyboard = new InlineKeyboard()
      enabledRepos.forEach((repo, i) => {
        keyboard.text(`${repo.owner}/${repo.name}`, `set-repo:${repo.owner}/${repo.name}`)
        if (i % 2 === 1) keyboard.row()
      })
      const current = ctx.session.repo ? `\n\nCurrent: \`${ctx.session.repo}\`` : ""
      await ctx.reply(`📋 *Select a repo for this topic:*${current}`, { parse_mode: "Markdown", reply_markup: keyboard })
      return
    }

    // Exact match: owner/name
    let matched = enabledRepos.find(r => `${r.owner}/${r.name}`.toLowerCase() === repoArg.toLowerCase())

    // Partial match: just repo name (e.g. "portfolio" → "paulpwo/portfolio")
    if (!matched) {
      const partial = enabledRepos.filter(r => r.name.toLowerCase().includes(repoArg.toLowerCase()))
      if (partial.length === 1) {
        matched = partial[0]
      } else if (partial.length > 1) {
        const keyboard = new InlineKeyboard()
        partial.forEach((repo, i) => {
          keyboard.text(`${repo.owner}/${repo.name}`, `set-repo:${repo.owner}/${repo.name}`)
          if (i % 2 === 1) keyboard.row()
        })
        await ctx.reply(`Multiple repos match \`${repoArg}\`. Pick one:`, { parse_mode: "Markdown", reply_markup: keyboard })
        return
      }
    }

    if (!matched) {
      await ctx.reply(`❌ No enabled repo matches \`${repoArg}\`.`, { parse_mode: "Markdown" })
      return
    }

    const fullName = `${matched.owner}/${matched.name}`
    ctx.session.repo = fullName
    await ctx.reply(`✅ Associated with \`${fullName}\`. Send any message to start a task.`, { parse_mode: "Markdown" })
  })

  // Handle repo selection from /repo keyboard
  bot.callbackQuery(/^set-repo:(.+)$/, async (ctx) => {
    const fullName = ctx.match[1]
    ctx.session.repo = fullName
    await ctx.editMessageText(`✅ Associated with \`${fullName}\`. Send any message to start a task.`, { parse_mode: "Markdown" })
    await ctx.answerCallbackQuery()
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
