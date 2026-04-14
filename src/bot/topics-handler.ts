import type { Bot } from "grammy"
import type { BotContext } from "./index"
import { db } from "@/lib/db/client"
import { InlineKeyboard } from "grammy"

export function registerTopicsHandler(bot: Bot<BotContext>): void {
  // When bot is added to a group/supergroup
  bot.on("my_chat_member", async (ctx) => {
    const newStatus = ctx.myChatMember.new_chat_member.status
    if (newStatus !== "member" && newStatus !== "administrator") return

    const chat = ctx.chat
    if (chat.type !== "supergroup" && chat.type !== "group") return

    const isForum = (chat as { is_forum?: boolean }).is_forum === true

    if (isForum) {
      await ctx.reply(
        `👋 *PaulAgentBot joined!*\n\nI detected this group has topics. Use /topics to assign repos to each topic.`,
        { parse_mode: "Markdown" }
      )
    } else {
      await ctx.reply(
        `👋 *PaulAgentBot joined!*\n\nThis is a regular group — I'll use a single session here. Set a repo with /repo owner/name.`,
        { parse_mode: "Markdown" }
      )
    }
  })

  // /topics — show topic → repo assignment UI
  bot.command("topics", async (ctx) => {
    const chatId = ctx.chat?.id
    if (!chatId) return

    const repos = await db.repo.findMany({
      where: { enabled: true },
      orderBy: [{ owner: "asc" }, { name: "asc" }],
    })

    if (repos.length === 0) {
      await ctx.reply("No repos enabled yet. Go to the dashboard → Repos and enable repos first.")
      return
    }

    // Build repo selection keyboard (2 per row)
    const keyboard = new InlineKeyboard()
    repos.forEach((repo, i) => {
      keyboard.text(`${repo.owner}/${repo.name}`, `set-repo:${chatId}:${repo.owner}/${repo.name}`)
      if (i % 2 === 1) keyboard.row()
    })

    await ctx.reply(
      `📋 *Topic → Repo assignment*\n\nFor the current topic, select a repo:`,
      {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      }
    )
  })

  // Handle repo selection from /topics keyboard
  bot.callbackQuery(/^set-repo:(-?\d+):(.+)$/, async (ctx) => {
    const repoName = ctx.match[2]

    ctx.session.repo = repoName

    await ctx.editMessageText(
      `✅ Topic associated with \`${repoName}\`\n\nSend any message to start a task.`,
      { parse_mode: "Markdown" }
    )
    await ctx.answerCallbackQuery()
  })
}
