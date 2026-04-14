import { requireAuth } from "@/lib/auth/session"
import { getSetting, SETTINGS_KEYS } from "@/lib/settings"
import SettingsForm, { type SettingEntry } from "@/components/settings/SettingsForm"

// Env fallback map: setting key → environment variable name
const ENV_FALLBACKS: Record<string, string> = {
  "github.appId": "GITHUB_APP_ID",
  [SETTINGS_KEYS.GITHUB_APP_WEBHOOK_SECRET]: "GITHUB_APP_WEBHOOK_SECRET",
  "github.botUsername": "GITHUB_APP_BOT_USERNAME",
  [SETTINGS_KEYS.GITHUB_OAUTH_CLIENT_ID]: "GITHUB_CLIENT_ID",
  [SETTINGS_KEYS.GITHUB_OAUTH_CLIENT_SECRET]: "GITHUB_CLIENT_SECRET",
  [SETTINGS_KEYS.TELEGRAM_BOT_TOKEN]: "TELEGRAM_BOT_TOKEN",
}

const SENSITIVE_KEYS = new Set<string>([
  SETTINGS_KEYS.GITHUB_APP_WEBHOOK_SECRET,
  SETTINGS_KEYS.GITHUB_OAUTH_CLIENT_SECRET,
  SETTINGS_KEYS.TELEGRAM_BOT_TOKEN,
  SETTINGS_KEYS.SLACK_BOT_TOKEN,
])

function maskValue(value: string): string {
  if (value.length <= 10) return "••••"
  return `${value.slice(0, 4)}•••••••••••••••${value.slice(-4)}`
}

const SETTINGS_DEFS: Array<{
  key: string
  label: string
  section: string
  masked: boolean
  placeholder?: string
  disabled?: boolean
  phase?: string
  type?: "toggle" | "multiselect"
}> = [
  { key: "github.appId", label: "GitHub App ID", section: "github-app", masked: false, placeholder: "123456" },
  { key: SETTINGS_KEYS.GITHUB_APP_WEBHOOK_SECRET, label: "Webhook Secret", section: "github-app", masked: true, placeholder: "whsec_..." },
  { key: "github.botUsername", label: "Bot Username", section: "github-app", masked: false, placeholder: "paulbot[bot]" },
  { key: SETTINGS_KEYS.GITHUB_OAUTH_CLIENT_ID, label: "OAuth Client ID", section: "github-oauth", masked: false, placeholder: "Iv1.abc..." },
  { key: SETTINGS_KEYS.GITHUB_OAUTH_CLIENT_SECRET, label: "OAuth Client Secret", section: "github-oauth", masked: true, placeholder: "••••••••" },
  { key: SETTINGS_KEYS.TELEGRAM_BOT_TOKEN, label: "Bot Token", section: "telegram", masked: true, placeholder: "123456:ABC-..." },
  { key: SETTINGS_KEYS.SLACK_BOT_TOKEN, label: "Bot Token", section: "slack", masked: true, placeholder: "xoxb-...", disabled: true, phase: "Phase 4" },
  { key: SETTINGS_KEYS.ALLOWLIST, label: "Allowed GitHub Logins", section: "auth", masked: false, placeholder: "alice, bob, charlie" },
  { key: SETTINGS_KEYS.GITHUB_RATE_COMMENTS_PER_MINUTE, label: "Max comments per thread per minute", section: "github-rate-limits", masked: false, placeholder: "5" },
  { key: SETTINGS_KEYS.GITHUB_RATE_TASKS_PER_DAY, label: "Max GitHub tasks per day (global)", section: "github-rate-limits", masked: false, placeholder: "100" },
  { key: "notifications.telegramEnabled", label: "Telegram notifications", section: "notifications", masked: false, type: "toggle" as const },
  { key: "notifications.slackEnabled",    label: "Slack notifications",    section: "notifications", masked: false, type: "toggle" as const },
  { key: "notifications.telegramChatId",  label: "Telegram Chat ID",       section: "notifications", masked: false, placeholder: "Set via /notify command in Telegram" },
  { key: "notifications.slackChannelId",  label: "Slack Channel ID",       section: "notifications", masked: false, placeholder: "C0123456789" },
  { key: "notifications.events",          label: "Notify on events",       section: "notifications", masked: false, type: "multiselect" as const },
]

async function loadSettings(): Promise<SettingEntry[]> {
  const entries: SettingEntry[] = []

  for (const def of SETTINGS_DEFS) {
    let dbValue: string | null = null
    try {
      dbValue = await getSetting(def.key)
    } catch {
      // ENCRYPTION_KEY not set, skip DB
    }

    const envVar = ENV_FALLBACKS[def.key]
    const envValue = envVar ? (process.env[envVar] ?? null) : null
    const rawValue = dbValue ?? envValue
    const source: "db" | "env" | null = dbValue ? "db" : envValue ? "env" : null

    let displayValue: string | null = null
    let clientValue: string | null = null

    if (rawValue) {
      const isSensitive = SENSITIVE_KEYS.has(def.key)
      displayValue = isSensitive ? maskValue(rawValue) : rawValue
      clientValue = isSensitive ? null : rawValue
    }

    // Special case: allowlist stored as JSON array, display as comma-separated
    if (def.key === SETTINGS_KEYS.ALLOWLIST && rawValue) {
      try {
        const parsed = JSON.parse(rawValue) as string[]
        if (Array.isArray(parsed)) {
          clientValue = parsed.join(", ")
          displayValue = clientValue
        }
      } catch {
        // raw value is already comma-separated or plain string
        clientValue = rawValue
        displayValue = rawValue
      }
    }

    entries.push({
      key: def.key,
      label: def.label,
      section: def.section,
      masked: def.masked,
      placeholder: def.placeholder,
      disabled: def.disabled,
      phase: def.phase,
      type: def.type,
      value: clientValue,
      displayValue,
      source,
    })
  }

  return entries
}

export default async function SettingsPage() {
  await requireAuth()
  const settings = await loadSettings()

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white tracking-tight">Settings</h1>
        <p className="text-sm text-text-muted mt-1.5">
          Configure integrations and access control. Secrets are stored AES-256-GCM encrypted and never returned in plaintext.
        </p>
      </div>
      <SettingsForm initialSettings={settings} />
    </div>
  )
}
