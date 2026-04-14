import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/session"
import { getSetting, setSetting, SETTINGS_KEYS } from "@/lib/settings"
import { maskValue } from "@/app/api/settings/route"

const SENSITIVE_KEYS = new Set<string>([
  SETTINGS_KEYS.GITHUB_APP_WEBHOOK_SECRET,
  SETTINGS_KEYS.GITHUB_OAUTH_CLIENT_SECRET,
  SETTINGS_KEYS.TELEGRAM_BOT_TOKEN,
  SETTINGS_KEYS.SLACK_BOT_TOKEN,
])

const DISABLED_KEYS = new Set<string>([SETTINGS_KEYS.SLACK_BOT_TOKEN])

// GET /api/settings/[key] — return a single setting (masked if sensitive)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  await requireAuth()
  const { key } = await params

  let rawValue: string | null = null
  try {
    rawValue = await getSetting(key)
  } catch {
    // encryption key not set
  }

  if (!rawValue) {
    return NextResponse.json({ key, value: null, displayValue: null, source: null })
  }

  const isSensitive = SENSITIVE_KEYS.has(key)
  return NextResponse.json({
    key,
    value: isSensitive ? null : rawValue,
    displayValue: isSensitive ? maskValue(rawValue) : rawValue,
    source: "db",
  })
}

// PATCH /api/settings/[key] — update a single setting
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  await requireAuth()
  const { key } = await params

  if (DISABLED_KEYS.has(key)) {
    return NextResponse.json({ error: "This setting is not yet available" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body.value !== "string") {
    return NextResponse.json({ error: "Invalid body: expected { value }" }, { status: 400 })
  }

  let storeValue = body.value as string

  // Special handling for allowlist: comma-separated → JSON array
  if (key === SETTINGS_KEYS.ALLOWLIST) {
    const logins = storeValue
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    storeValue = JSON.stringify(logins)
  }

  await setSetting(key, storeValue)

  const displayValue = SENSITIVE_KEYS.has(key) ? maskValue(storeValue) : storeValue
  return NextResponse.json({ ok: true, key, displayValue })
}
