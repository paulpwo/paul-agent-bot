import { getSetting, SETTINGS_KEYS } from "@/lib/settings"

export type NotificationEvent =
  | { type: "mention";       repo: string; threadId: string; title: string; url: string; actor: string; body?: string }
  | { type: "issue_opened";  repo: string; threadId: string; title: string; url: string; actor: string }
  | { type: "pr_opened";     repo: string; threadId: string; title: string; url: string; actor: string }
  | { type: "pr_merged";     repo: string; threadId: string; title: string; url: string; actor: string }

const DEFAULT_EVENTS = ["mention", "issue_opened", "pr_opened", "pr_merged"]

function formatTelegramMessage(event: NotificationEvent): string {
  switch (event.type) {
    case "mention":
      return `👋 *${event.actor}* mentioned me in [${event.repo}#${event.threadId}](${event.url})\n\n_${event.title}_${event.body ? `\n\n"${event.body}"` : ""}`
    case "issue_opened":
      return `📋 New issue in *${event.repo}*: [${event.title}](${event.url}) (by @${event.actor})`
    case "pr_opened":
      return `🔀 New PR in *${event.repo}*: [${event.title}](${event.url}) (by @${event.actor})`
    case "pr_merged":
      return `✅ PR merged in *${event.repo}*: [${event.title}](${event.url}) (by @${event.actor})`
  }
}

function formatSlackMessage(event: NotificationEvent): string {
  switch (event.type) {
    case "mention":
      return `👋 *${event.actor}* mentioned me in <${event.url}|${event.repo}#${event.threadId}>\n_${event.title}_${event.body ? `\n"${event.body}"` : ""}`
    case "issue_opened":
      return `📋 New issue in *${event.repo}*: <${event.url}|${event.title}> (by @${event.actor})`
    case "pr_opened":
      return `🔀 New PR in *${event.repo}*: <${event.url}|${event.title}> (by @${event.actor})`
    case "pr_merged":
      return `✅ PR merged in *${event.repo}*: <${event.url}|${event.title}> (by @${event.actor})`
  }
}

async function dispatchTelegram(event: NotificationEvent): Promise<void> {
  try {
    const enabled = await getSetting(SETTINGS_KEYS.NOTIF_TELEGRAM_ENABLED)
    if (enabled !== "true") return

    const chatId = await getSetting(SETTINGS_KEYS.NOTIF_TELEGRAM_CHAT_ID)
    if (!chatId) return

    // Use direct HTTP call — works from any process (Next.js server, workers, etc.)
    const token = (await getSetting(SETTINGS_KEYS.TELEGRAM_BOT_TOKEN)) ?? process.env.TELEGRAM_BOT_TOKEN
    if (!token) return

    const text = formatTelegramMessage(event)
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error("[notifications] Telegram API error:", res.status, body)
    }
  } catch (err) {
    console.error("[notifications] Telegram dispatch failed:", err)
  }
}

async function dispatchSlack(event: NotificationEvent): Promise<void> {
  try {
    const enabled = await getSetting(SETTINGS_KEYS.NOTIF_SLACK_ENABLED)
    if (enabled !== "true") return

    const channelId = await getSetting(SETTINGS_KEYS.NOTIF_SLACK_CHANNEL_ID)
    const token = (await getSetting(SETTINGS_KEYS.SLACK_BOT_TOKEN)) ?? process.env.SLACK_BOT_TOKEN
    if (!channelId || !token) return

    const { WebClient } = await import("@slack/web-api")
    const client = new WebClient(token)
    const text = formatSlackMessage(event)
    await client.chat.postMessage({ channel: channelId, text })
  } catch (err) {
    console.error("[notifications] Slack dispatch failed:", err)
  }
}

export async function dispatchNotification(event: NotificationEvent): Promise<void> {
  try {
    const eventsRaw = await getSetting(SETTINGS_KEYS.NOTIF_EVENTS)
    const enabledEvents: string[] = eventsRaw ? JSON.parse(eventsRaw) : DEFAULT_EVENTS
    if (!enabledEvents.includes(event.type)) return

    await Promise.allSettled([dispatchTelegram(event), dispatchSlack(event)])
  } catch (err) {
    console.error("[notifications] dispatchNotification failed:", err)
  }
}
