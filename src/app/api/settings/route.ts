import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/session"
import { getSetting, setSetting, SETTINGS_KEYS } from "@/lib/settings"

// Keys that are sensitive and should be masked in responses
const SENSITIVE_KEYS = new Set<string>([
  SETTINGS_KEYS.SLACK_BOT_TOKEN,
])

/**
 * Mask a secret value: show first 4 + last 4 chars with ••• in between.
 * If value is <= 10 chars, return just ••••
 */
export function maskValue(value: string): string {
  if (value.length <= 10) return "••••"
  return `${value.slice(0, 4)}•••••••••••••••${value.slice(-4)}`
}

/**
 * All known settings keys with metadata for the UI.
 * GitHub App, GitHub OAuth, and Telegram keys are intentionally excluded —
 * they are configured via environment variables only, not the Settings DB.
 */
const ALL_SETTINGS_META: Array<{
  key: string
  label: string
  section: string
  masked: boolean
  placeholder?: string
  disabled?: boolean
  phase?: string
  type?: "toggle" | "multiselect"
}> = [
  // Section 1 — Slack (Phase 4)
  {
    key: SETTINGS_KEYS.SLACK_BOT_TOKEN,
    label: "Bot Token",
    section: "slack",
    masked: true,
    placeholder: "xoxb-...",
    disabled: true,
    phase: "Phase 4",
  },
  // Section 2 — Auth Allowlist
  {
    key: SETTINGS_KEYS.ALLOWLIST,
    label: "Allowed GitHub Logins",
    section: "auth",
    masked: false,
    placeholder: "alice, bob, charlie",
  },
  // Section 3 — GitHub Rate Limits
  {
    key: SETTINGS_KEYS.GITHUB_RATE_COMMENTS_PER_MINUTE,
    label: "Max comments per thread per minute",
    section: "github-rate-limits",
    masked: false,
    placeholder: "5",
  },
  {
    key: SETTINGS_KEYS.GITHUB_RATE_TASKS_PER_DAY,
    label: "Max GitHub tasks per day (global)",
    section: "github-rate-limits",
    masked: false,
    placeholder: "100",
  },
  // Section 4 — Notifications (Telegram is handled natively by the grammy bot)
  {
    key: SETTINGS_KEYS.NOTIF_SLACK_ENABLED,
    label: "Slack notifications",
    section: "notifications",
    masked: false,
    type: "toggle" as const,
  },
  {
    key: SETTINGS_KEYS.NOTIF_SLACK_CHANNEL_ID,
    label: "Slack Channel ID",
    section: "notifications",
    masked: false,
    placeholder: "C0123456789",
  },
  {
    key: SETTINGS_KEYS.NOTIF_EVENTS,
    label: "Notify on events",
    section: "notifications",
    masked: false,
    type: "multiselect" as const,
  },
]

type SettingEntry = {
  key: string
  label: string
  section: string
  masked: boolean
  placeholder?: string
  disabled?: boolean
  phase?: string
  type?: "toggle" | "multiselect"
  value: string | null
  displayValue: string | null
  source: "db" | "env" | null
}

async function buildSettingsPayload(): Promise<SettingEntry[]> {
  const result: SettingEntry[] = []

  for (const meta of ALL_SETTINGS_META) {
    // All remaining settings live only in the DB (no env fallbacks needed here)
    let dbValue: string | null = null
    try {
      dbValue = await getSetting(meta.key)
    } catch {
      // If encryption key not set, skip DB
    }

    const rawValue = dbValue
    const source: "db" | "env" | null = dbValue ? "db" : null
    const displayValue = rawValue
      ? meta.masked
        ? maskValue(rawValue)
        : rawValue
      : null

    result.push({
      key: meta.key,
      label: meta.label,
      section: meta.section,
      masked: meta.masked,
      placeholder: meta.placeholder,
      disabled: meta.disabled,
      phase: meta.phase,
      type: meta.type,
      value: meta.masked ? null : rawValue, // never return sensitive plaintext
      displayValue,
      source,
    })
  }

  return result
}

// GET /api/settings — return all settings (masked where needed)
export async function GET() {
  await requireAuth()
  const settings = await buildSettingsPayload()
  return NextResponse.json({ settings })
}

// POST /api/settings — save a single setting { key, value }
export async function POST(req: NextRequest) {
  await requireAuth()

  const body = await req.json().catch(() => null)
  if (!body || typeof body.key !== "string" || typeof body.value !== "string") {
    return NextResponse.json({ error: "Invalid body: expected { key, value }" }, { status: 400 })
  }

  const { key, value } = body as { key: string; value: string }

  // Validate key is a known key
  const meta = ALL_SETTINGS_META.find((m) => m.key === key)
  if (!meta) {
    return NextResponse.json({ error: `Unknown setting key: ${key}` }, { status: 400 })
  }

  if (meta.disabled) {
    return NextResponse.json({ error: "This setting is not yet available" }, { status: 403 })
  }

  // Special handling for allowlist: accept comma-separated and convert to JSON array
  let storeValue = value
  if (key === SETTINGS_KEYS.ALLOWLIST) {
    const logins = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    storeValue = JSON.stringify(logins)
  }

  await setSetting(key, storeValue)

  // Return masked display value
  const displayValue = SENSITIVE_KEYS.has(key) ? maskValue(storeValue) : storeValue
  return NextResponse.json({ ok: true, key, displayValue })
}
