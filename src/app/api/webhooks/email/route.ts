import { NextRequest, NextResponse } from "next/server"
import busboy from "busboy"
import { Readable } from "stream"
import { handleInboundEmail, type ParsedEmail } from "@/lib/channels/email/webhook-handler"
import { createLogger } from "@/lib/logger"

const logger = createLogger("email-webhook")

// Extract Message-ID and In-Reply-To from raw headers string
function extractHeader(headers: string, name: string): string | undefined {
  const regex = new RegExp(`^${name}:\\s*(.+)$`, "im")
  const match = headers.match(regex)
  return match?.[1]?.trim()
}

// Normalise a Message-ID / In-Reply-To value (strip angle brackets if present)
function normalizeMessageId(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  return raw.replace(/^<|>$/g, "").trim()
}

// Parse SendGrid Inbound Parse multipart/form-data using busboy
async function parseSendGridMultipart(req: NextRequest): Promise<ParsedEmail | null> {
  const contentType = req.headers.get("content-type") ?? ""

  const fields: Record<string, string> = {}

  await new Promise<void>((resolve, reject) => {
    const bb = busboy({ headers: { "content-type": contentType } })

    bb.on("field", (name, value) => {
      fields[name] = value
    })

    // We only care about fields, not file attachments — skip files
    bb.on("file", (_name, stream) => {
      stream.resume()
    })

    bb.on("finish", resolve)
    bb.on("error", reject)

    // Convert the ReadableStream (Web API) to a Node.js Readable for busboy
    req
      .arrayBuffer()
      .then(buffer => {
        const readable = Readable.from(Buffer.from(buffer))
        readable.pipe(bb)
      })
      .catch(reject)
  })

  const from: string = fields["from"] ?? ""
  const subject: string = fields["subject"] ?? "(no subject)"
  const text: string = fields["text"] ?? ""
  const rawHeaders: string = fields["headers"] ?? ""

  if (!from) return null

  // Prefer explicit header fields; fall back to parsing the raw `headers` field
  const rawMessageId =
    fields["message-id"] ??
    extractHeader(rawHeaders, "Message-ID")
  const rawInReplyTo =
    fields["in-reply-to"] ??
    extractHeader(rawHeaders, "In-Reply-To")

  const messageId = normalizeMessageId(rawMessageId) ?? `email-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const inReplyTo = normalizeMessageId(rawInReplyTo)

  return { from, subject, text, messageId, inReplyTo }
}

export async function POST(req: NextRequest) {
  // Self-reply guard — skip emails from our own address to avoid loops
  const selfAddress = process.env.EMAIL_FROM_ADDRESS
  let parsedEmail: ParsedEmail | null

  try {
    parsedEmail = await parseSendGridMultipart(req)
  } catch (err) {
    logger.error("Multipart parse error:", err)
    return NextResponse.json({ error: "Parse error" }, { status: 400 })
  }

  if (!parsedEmail) {
    return NextResponse.json({ error: "Missing from field" }, { status: 400 })
  }

  // Loop guard: ignore replies from our own sender address
  if (selfAddress && parsedEmail.from.toLowerCase().includes(selfAddress.toLowerCase())) {
    logger.info("Skipping self-reply from:", parsedEmail.from)
    return NextResponse.json({ ok: true, skipped: "self-reply" })
  }

  // Fire-and-forget — return 200 immediately (SendGrid expects quick response)
  handleInboundEmail(parsedEmail).catch(err =>
    logger.error("Handler error:", err),
  )

  return NextResponse.json({ ok: true })
}
