import { NextRequest, NextResponse } from "next/server"
import { createHmac, timingSafeEqual } from "crypto"
import { WebClient } from "@slack/web-api"
import { getSetting, SETTINGS_KEYS } from "@/lib/settings"
import { handleSlackApproval } from "@/lib/channels/slack/adapter"

// Verify Slack request signature (same as main webhook)
async function verifySlackSignature(req: NextRequest, rawBody: Buffer): Promise<boolean> {
  const signingSecret =
    (await getSetting(SETTINGS_KEYS.SLACK_SIGNING_SECRET)) ??
    process.env.SLACK_SIGNING_SECRET

  if (!signingSecret) return false

  const timestamp = req.headers.get("x-slack-request-timestamp")
  const signature = req.headers.get("x-slack-signature")
  if (!timestamp || !signature) return false

  // Reject stale requests (> 5 min old)
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - parseInt(timestamp, 10)) > 300) return false

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

// Slack sends interactions as application/x-www-form-urlencoded with a `payload` field
interface BlockAction {
  type: "block_actions"
  actions: Array<{
    action_id: string
    value: string
  }>
  response_url: string
}

export async function POST(req: NextRequest) {
  const rawBody = Buffer.from(await req.arrayBuffer())

  const valid = await verifySlackSignature(req, rawBody)
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  // Parse URL-encoded body and extract JSON payload
  const params = new URLSearchParams(rawBody.toString("utf8"))
  const payloadStr = params.get("payload")
  if (!payloadStr) {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 })
  }

  let payload: BlockAction
  try {
    payload = JSON.parse(payloadStr) as BlockAction
  } catch {
    return NextResponse.json({ error: "Invalid payload JSON" }, { status: 400 })
  }

  if (payload.type !== "block_actions") {
    // Unsupported interaction type — acknowledge gracefully
    return NextResponse.json({ ok: true })
  }

  const botToken =
    (await getSetting(SETTINGS_KEYS.SLACK_BOT_TOKEN)) ?? process.env.SLACK_BOT_TOKEN

  if (!botToken) {
    console.error("[slack-interactions] No bot token configured")
    return NextResponse.json({ ok: true })
  }

  const client = new WebClient(botToken)

  // Handle each action (typically just one per click)
  for (const action of payload.actions) {
    const { action_id } = action

    if (action_id.startsWith("approve:")) {
      const approvalId = action_id.slice("approve:".length)
      handleSlackApproval(client, approvalId, true, payload.response_url).catch((err) =>
        console.error("[slack-interactions] handleSlackApproval error:", err)
      )
    } else if (action_id.startsWith("deny:")) {
      const approvalId = action_id.slice("deny:".length)
      handleSlackApproval(client, approvalId, false, payload.response_url).catch((err) =>
        console.error("[slack-interactions] handleSlackApproval error:", err)
      )
    }
  }

  // Respond immediately with empty 200 (Slack requires < 3s)
  return new NextResponse(null, { status: 200 })
}
