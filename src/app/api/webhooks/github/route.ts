import { NextRequest, NextResponse } from "next/server"
import { createHmac, timingSafeEqual } from "crypto"
import { checkAndSetDelivery } from "@/lib/redis/pubsub"
import { redis } from "@/lib/redis/client"
import { handleWebhookEvent } from "@/lib/channels/github/webhook-handler"
import { createLogger } from "@/lib/logger"

const logger = createLogger("github-webhook")

// Verify HMAC-SHA256 signature from GitHub
async function verifySignature(req: NextRequest, rawBody: Buffer): Promise<boolean> {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET
  if (!secret) return false

  const sig = req.headers.get("x-hub-signature-256")
  if (!sig) return false

  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex")
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  // Read raw body BEFORE parsing JSON (required for HMAC)
  const rawBody = Buffer.from(await req.arrayBuffer())

  // Verify HMAC
  const valid = await verifySignature(req, rawBody)
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  // Delivery dedup — reject replays
  const deliveryId = req.headers.get("x-github-delivery")
  if (deliveryId) {
    const alreadySeen = await checkAndSetDelivery(redis, deliveryId)
    if (alreadySeen) {
      return NextResponse.json({ ok: true, skipped: "duplicate" })
    }
  }

  const event = req.headers.get("x-github-event") ?? "unknown"
  const payload = JSON.parse(rawBody.toString("utf8"))

  // Handle asynchronously — respond immediately (< 3s GitHub timeout)
  handleWebhookEvent(event, payload).catch(err =>
    logger.error("Handler error:", err)
  )

  return NextResponse.json({ ok: true })
}
