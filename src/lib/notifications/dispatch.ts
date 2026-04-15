import { getSetting, SETTINGS_KEYS } from "@/lib/settings"
import { createLogger } from "@/lib/logger"

const logger = createLogger("notifications")

export type NotificationEvent =
  | { type: "mention";       repo: string; threadId: string; title: string; url: string; actor: string; body?: string }
  | { type: "issue_opened";  repo: string; threadId: string; title: string; url: string; actor: string }
  | { type: "pr_opened";     repo: string; threadId: string; title: string; url: string; actor: string }
  | { type: "pr_merged";     repo: string; threadId: string; title: string; url: string; actor: string }

const DEFAULT_EVENTS = ["mention", "issue_opened", "pr_opened", "pr_merged"]

// Note: Telegram notifications are handled natively by the grammy bot (stream-listener routes
// task updates directly to the originating chat). No separate dispatch needed.

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
    logger.error("Slack dispatch failed", err)
  }
}

export async function dispatchNotification(event: NotificationEvent): Promise<void> {
  try {
    const eventsRaw = await getSetting(SETTINGS_KEYS.NOTIF_EVENTS)
    const enabledEvents: string[] = eventsRaw ? JSON.parse(eventsRaw) : DEFAULT_EVENTS
    if (!enabledEvents.includes(event.type)) return

    await dispatchSlack(event)
  } catch (err) {
    logger.error("dispatchNotification failed", err)
  }
}
