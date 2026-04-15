import { db } from "@/lib/db/client"
import { encrypt, decrypt } from "@/lib/crypto"

// 60-second in-process cache
const cache = new Map<string, { value: string; expiresAt: number }>()

export async function getSetting(key: string): Promise<string | null> {
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) return cached.value

  const row = await db.settings.findUnique({ where: { key } })
  if (!row) return null

  const value = decrypt(row.value)
  cache.set(key, { value, expiresAt: now + 60_000 })
  return value
}

export async function setSetting(key: string, value: string): Promise<void> {
  const encrypted = encrypt(value)
  await db.settings.upsert({
    where: { key },
    create: { key, value: encrypted },
    update: { value: encrypted },
  })
  cache.delete(key) // invalidate cache on write
}

export async function getSettingJson<T>(key: string): Promise<T | null> {
  const raw = await getSetting(key)
  if (!raw) return null
  return JSON.parse(raw) as T
}

export async function setSettingJson(key: string, value: unknown): Promise<void> {
  await setSetting(key, JSON.stringify(value))
}

// Known setting keys (type-safe access).
// NOTE: TELEGRAM_BOT_TOKEN and GitHub App/OAuth keys are intentionally absent —
// they are read exclusively from process.env, never stored in the DB.
export const SETTINGS_KEYS = {
  SLACK_BOT_TOKEN: "slack.botToken",
  SLACK_SIGNING_SECRET: "slack.signingSecret",
  SLACK_TEAM_ID: "slack.teamId",
  ALLOWLIST: "auth.allowlist",           // JSON: string[]
  SENDGRID_API_KEY: "email.sendgridApiKey",
  EMAIL_FROM_ADDRESS: "email.fromAddress",
  GITHUB_RATE_COMMENTS_PER_MINUTE: "github.rateLimitCommentsPerMinute",
  GITHUB_RATE_TASKS_PER_DAY: "github.rateLimitTasksPerDay",
  // Notifications (Telegram handled natively by grammy bot — no config needed here)
  NOTIF_SLACK_ENABLED:      "notifications.slackEnabled",
  NOTIF_SLACK_CHANNEL_ID:   "notifications.slackChannelId",
  NOTIF_EVENTS:             "notifications.events",
} as const
