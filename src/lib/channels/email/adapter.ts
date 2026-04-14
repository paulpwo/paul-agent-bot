import sgMail from "@sendgrid/mail"
import { redisSub } from "@/lib/redis/client"
import { STREAM_CHANNEL } from "@/lib/redis/pubsub"
import type { StreamEvent } from "@/lib/redis/pubsub"
import { getSetting, SETTINGS_KEYS } from "@/lib/settings"

async function initSgMail(): Promise<void> {
  const apiKey =
    (await getSetting(SETTINGS_KEYS.SENDGRID_API_KEY)) ??
    process.env.SENDGRID_API_KEY
  if (!apiKey) throw new Error("SendGrid API key not configured")
  sgMail.setApiKey(apiKey)
}

async function getFromAddress(): Promise<string> {
  return (
    (await getSetting(SETTINGS_KEYS.EMAIL_FROM_ADDRESS)) ??
    process.env.EMAIL_FROM_ADDRESS ??
    "paulbot@mg.example.com"
  )
}

export interface SendEmailOpts {
  to: string
  subject: string
  text: string
  inReplyTo?: string
  references?: string
}

export async function sendEmail(opts: SendEmailOpts): Promise<void> {
  await initSgMail()
  const from = await getFromAddress()

  const msg: Parameters<typeof sgMail.send>[0] = {
    to: opts.to,
    from,
    subject: opts.subject,
    text: opts.text,
  }

  if (opts.inReplyTo || opts.references) {
    // SendGrid supports custom headers for threading
    msg.headers = {}
    if (opts.inReplyTo) {
      msg.headers["In-Reply-To"] = opts.inReplyTo
    }
    if (opts.references) {
      msg.headers["References"] = opts.references
    }
  }

  await sgMail.send(msg)
}

// Subscribe to task stream, collect all tokens, send single reply email when done
export async function streamToEmail(
  taskId: string,
  to: string,
  subject: string,
  inReplyTo: string,
): Promise<void> {
  const channel = STREAM_CHANNEL(taskId)

  return new Promise((resolve, reject) => {
    let buffer = ""

    const handler = async (ch: string, message: string) => {
      if (ch !== channel) return
      try {
        const event: StreamEvent = JSON.parse(message)

        switch (event.type) {
          case "token":
            buffer += event.text
            break

          case "tool_use":
            // No intermediate updates for email — just accumulate silently
            break

          case "approval_needed":
            // Email is non-interactive — auto-deny (consistent with GitHub adapter)
            // We don't import redis here to avoid duplicate client; handler resolves later
            break

          case "done":
            cleanup()
            try {
              await sendEmail({
                to,
                subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
                text: event.result || buffer,
                inReplyTo,
                references: inReplyTo,
              })
            } catch (err) {
              console.error("[email-adapter] Failed to send result email:", err)
            }
            resolve()
            break

          case "error":
            cleanup()
            try {
              await sendEmail({
                to,
                subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
                text: `Error processing your request:\n\n${event.message}`,
                inReplyTo,
                references: inReplyTo,
              })
            } catch (sendErr) {
              console.error("[email-adapter] Failed to send error email:", sendErr)
            }
            reject(new Error(event.message))
            break
        }
      } catch (err) {
        console.error("[email-adapter] Stream parse error:", err)
      }
    }

    const cleanup = () => {
      redisSub.removeListener("message", handler)
      redisSub.unsubscribe(channel).catch(() => {})
    }

    redisSub.on("message", handler)
    redisSub.subscribe(channel).catch(reject)
  })
}
