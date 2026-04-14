import { NextRequest, NextResponse } from "next/server"
import { createHmac, timingSafeEqual } from "crypto"
import { getSetting, SETTINGS_KEYS } from "@/lib/settings"
import { handleSlackEvent } from "@/lib/channels/slack/webhook-handler"

// Slack URL verification challenge type
interface SlackChallenge {
  type: "url_verification"
  challenge: string
  token: string
}

interface SlackEventCallback {
  type: "event_callback"
  team_id: string
  event: SlackEvent
  event_id: string
  event_time: number
}

export interface SlackEvent {
  type: string
  user?: string
  bot_id?: string
  subtype?: string
  text?: string
  channel?: string
  channel_type?: string
  ts?: string
  thread_ts?: string
}

type SlackPayload = SlackChallenge | SlackEventCallback | { type: string }

// Verify Slack request signature
async function verifySlackSignature(req: NextRequest, rawBody: Buffer): Promise<boolean> {
  const signingSecret =
    (await getSetting(SETTINGS_KEYS.SLACK_SIGNING_SECRET)) ??
    process.env.SLACK_SIGNING_SECRET

  if (!signingSecret) {
    console.error("[slack-webhook] No signing secret configured")
    return false
  }

  const timestamp = req.headers.get("x-slack-request-timestamp")
  const signature = req.headers.get("x-slack-signature")

  if (!timestamp || !signature) return false

  // Reject requests older than 5 minutes (replay attack guard)
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - parseInt(timestamp, 10)) > 300) {
    console.warn("[slack-webhook] Request timestamp too old — possible replay")
    return false
  }

  const sigBasestring = `v0:${timestamp}:${rawBody.toString("utf8")}`
  const hmac = createHmac("sha256", signingSecret)
  hmac.update(sigBasestring)
  const expected = `v0=${hmac.digest("hex")}`

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  // Read raw body BEFORE parsing (required for HMAC verification)
  const rawBody = Buffer.from(await req.arrayBuffer())

  // Verify Slack signature
  const valid = await verifySlackSignature(req, rawBody)
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  let payload: SlackPayload
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as SlackPayload
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Handle Slack URL verification challenge (one-time setup)
  if (payload.type === "url_verification") {
    const challenge = (payload as SlackChallenge).challenge
    return NextResponse.json({ challenge })
  }

  // Handle event callbacks
  if (payload.type === "event_callback") {
    const eventPayload = payload as SlackEventCallback
    const { event, team_id } = eventPayload

    // Loop guard: skip messages from bots
    if (event.bot_id || event.subtype === "bot_message") {
      return NextResponse.json({ ok: true })
    }

    // Only handle app_mention and direct messages / channel messages
    if (event.type !== "app_mention" && event.type !== "message") {
      return NextResponse.json({ ok: true })
    }

    // Fire-and-forget — respond 200 immediately (Slack requires < 3s response)
    handleSlackEvent(event, team_id).catch((err) =>
      console.error("[slack-webhook] Handler error:", err)
    )
  }

  return NextResponse.json({ ok: true })
}
