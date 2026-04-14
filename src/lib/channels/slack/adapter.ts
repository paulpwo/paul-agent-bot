import { WebClient } from "@slack/web-api"
import { redisSub, redis } from "@/lib/redis/client"
import { STREAM_CHANNEL, setApprovalResult } from "@/lib/redis/pubsub"
import type { StreamEvent } from "@/lib/redis/pubsub"

// Slack has a lower effective rate limit than Telegram — throttle to every 2s
const EDIT_INTERVAL_MS = 2000

const ACK_KEY = (taskId: string) => `slack:ack:${taskId}`

interface AckRecord {
  channel: string
  ts: string
}

async function getAckRecord(taskId: string): Promise<AckRecord | null> {
  const raw = await redis.get(ACK_KEY(taskId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as AckRecord
  } catch {
    return null
  }
}

// Subscribe to Redis pub/sub stream and update Slack message every 2s
export async function streamToSlack(client: WebClient, taskId: string): Promise<void> {
  const channel = STREAM_CHANNEL(taskId)

  return new Promise((resolve, reject) => {
    let buffer = "⚡ Working...\n\n"
    let lastSent = buffer
    let editTimer: ReturnType<typeof setInterval> | null = null
    let ackRecord: AckRecord | null = null

    // Load ack record asynchronously (it was stored by webhook-handler)
    getAckRecord(taskId).then((rec) => {
      ackRecord = rec
    })

    const flushEdit = async () => {
      if (buffer === lastSent) return
      if (!ackRecord) {
        // Re-try loading ack record
        ackRecord = await getAckRecord(taskId)
        if (!ackRecord) return
      }

      try {
        await client.chat.update({
          channel: ackRecord.channel,
          ts: ackRecord.ts,
          text: buffer,
        })
        lastSent = buffer
      } catch (err) {
        // Ignore "message_not_found" or "cant_update_message" (e.g. too old)
        const slackErr = err as { data?: { error?: string } }
        const code = slackErr?.data?.error
        if (code !== "message_not_found" && code !== "cant_update_message") {
          console.error("[slack-adapter] chat.update failed:", err)
        }
      }
    }

    editTimer = setInterval(flushEdit, EDIT_INTERVAL_MS)

    const handler = async (ch: string, message: string) => {
      if (ch !== channel) return
      try {
        const event: StreamEvent = JSON.parse(message)

        switch (event.type) {
          case "token":
            buffer += event.text
            break

          case "tool_use":
            buffer += `\n\n_Using tool: \`${event.tool}\`_`
            break

          case "approval_needed":
            await handleApprovalRequest(client, event, ackRecord)
            break

          case "done":
            buffer = `Done\n\n${event.result.slice(0, 3800)}`
            clearInterval(editTimer!)
            await flushEdit()
            cleanup()
            resolve()
            break

          case "error":
            buffer = `Error\n\n${event.message}`
            clearInterval(editTimer!)
            await flushEdit()
            cleanup()
            reject(new Error(event.message))
            break
        }
      } catch (err) {
        console.error("[slack-adapter] Stream parse error:", err)
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

// Post Block Kit message with Approve/Deny buttons for HITL
async function handleApprovalRequest(
  client: WebClient,
  event: Extract<StreamEvent, { type: "approval_needed" }>,
  ackRecord: AckRecord | null
): Promise<void> {
  if (!ackRecord) {
    console.error("[slack-adapter] Cannot post approval buttons — no ack record")
    return
  }

  await client.chat.postMessage({
    channel: ackRecord.channel,
    thread_ts: ackRecord.ts,
    text: `Permission request: tool \`${event.tool}\` wants to run. Approve?`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Permission Request*\n\nTool: \`${event.tool}\`\n\nApprove this action?`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Approve", emoji: true },
            style: "primary",
            action_id: `approve:${event.approvalId}`,
            value: event.approvalId,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Deny", emoji: true },
            style: "danger",
            action_id: `deny:${event.approvalId}`,
            value: event.approvalId,
          },
        ],
      },
    ],
  })
}

// Called from the interactions route when a user clicks Approve or Deny
export async function handleSlackApproval(
  client: WebClient,
  approvalId: string,
  approved: boolean,
  responseUrl: string
): Promise<void> {
  // Persist result to Redis so the worker can unblock
  await setApprovalResult(redis, approvalId, approved)

  // Update the original button message via response_url (ephemeral safe)
  const resultText = approved
    ? "Approved. Proceeding with the action."
    : "Denied. Action was cancelled."

  // Use fetch to POST to response_url (Slack's standard interaction response)
  try {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        replace_original: true,
        text: resultText,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: approved
                ? `*Approved* — proceeding with the action.`
                : `*Denied* — action was cancelled.`,
            },
          },
        ],
      }),
    })
  } catch (err) {
    console.error("[slack-adapter] Failed to update approval message via response_url:", err)
    // Fallback: use the web client if we have channel context available
    void client // client is kept in signature for future use / fallback scenarios
  }
}
