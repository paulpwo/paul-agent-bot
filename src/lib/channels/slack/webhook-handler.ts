import { WebClient } from "@slack/web-api"
import { db } from "@/lib/db/client"
import { redis } from "@/lib/redis/client"
import { enqueueTask } from "@/lib/queue/producer"
import { getSetting, SETTINGS_KEYS } from "@/lib/settings"
import type { SlackEvent } from "@/app/api/webhooks/slack/route"

const ACK_KEY = (taskId: string) => `slack:ack:${taskId}`

// Parse `/paulagentbot repo owner/name` and similar commands from message text
export function extractCommand(text: string): { command: string; arg?: string } | null {
  // Strip bot mention (e.g. <@U123ABC>)
  const clean = text.replace(/<@[A-Z0-9]+>/g, "").trim()
  const match = clean.match(/^\/paulagentbot\s+(\w+)(?:\s+(.+))?$|^(\w+)(?:\s+(.+))?$/)
  if (!match) return null
  const command = (match[1] ?? match[3] ?? "").toLowerCase()
  const arg = match[2] ?? match[4]
  return command ? { command, arg } : null
}

export async function handleSlackEvent(event: SlackEvent, teamId: string): Promise<void> {
  const botToken =
    (await getSetting(SETTINGS_KEYS.SLACK_BOT_TOKEN)) ?? process.env.SLACK_BOT_TOKEN

  if (!botToken) {
    console.error("[slack-handler] No bot token configured")
    return
  }

  const client = new WebClient(botToken)

  const channelId = event.channel ?? ""
  const threadId = event.thread_ts ?? event.ts ?? ""
  const text = event.text ?? ""

  if (!channelId || !threadId) {
    console.warn("[slack-handler] Missing channel or ts — ignoring event")
    return
  }

  // Check for slash-style commands embedded in mentions
  const parsed = extractCommand(text)
  if (parsed) {
    await handleCommand(client, parsed, channelId, threadId, event.ts ?? "")
    return
  }

  // Upsert session for this channel/thread
  const existingSession = await db.session.findFirst({
    where: { channel: "slack", channelId },
  })

  const repo = existingSession?.repo ?? ""

  const session = await db.session.upsert({
    where: {
      channel_channelId_threadId_repo: {
        channel: "slack",
        channelId,
        threadId,
        repo,
      },
    },
    create: {
      channel: "slack",
      channelId,
      threadId,
      repo,
    },
    update: {},
  })

  // If no repo set and this is not a thread reply → ask user to configure
  if (!session.repo && !event.thread_ts) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: event.ts,
      text: "Please set a repository first. Use `/paulagentbot repo owner/name` or mention me with `repo owner/name`.",
    })
    return
  }

  // Create Task record
  const task = await db.task.create({
    data: {
      sessionId: session.id,
      channel: "slack",
      channelId,
      threadId,
      repo: session.repo,
      prompt: text.replace(/<@[A-Z0-9]+>/g, "").trim(),
      status: "QUEUED",
    },
  })

  // Post ephemeral ack message and store its ts in Redis
  const ackResponse = await client.chat.postMessage({
    channel: channelId,
    thread_ts: event.thread_ts ?? event.ts,
    text: "⚡ Working on it...",
  })

  if (ackResponse.ok && ackResponse.ts) {
    await redis.set(
      ACK_KEY(task.id),
      JSON.stringify({ channel: channelId, ts: ackResponse.ts }),
      "EX",
      3600
    )
  }

  // Enqueue BullMQ job
  const jobId = await enqueueTask({
    taskId: task.id,
    channel: "slack",
    channelId,
    threadId,
    repo: session.repo,
    prompt: text.replace(/<@[A-Z0-9]+>/g, "").trim(),
  })

  await db.task.update({
    where: { id: task.id },
    data: { bullJobId: jobId },
  })

  console.log(`[slack] Task ${task.id} queued for channel ${channelId}`)

  // Stream results back to Slack (non-blocking)
  const { streamToSlack } = await import("./adapter")
  streamToSlack(client, task.id).catch((err) =>
    console.error("[slack-handler] streamToSlack error:", err)
  )
}

async function handleCommand(
  client: WebClient,
  parsed: { command: string; arg?: string },
  channelId: string,
  threadId: string,
  ts: string
): Promise<void> {
  switch (parsed.command) {
    case "repo": {
      if (!parsed.arg || !parsed.arg.includes("/")) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: ts,
          text: "Usage: `repo owner/name` — e.g. `repo acme/my-app`",
        })
        return
      }

      const repo = parsed.arg.trim()

      // Update or create session with new repo
      await db.session.upsert({
        where: {
          channel_channelId_threadId_repo: {
            channel: "slack",
            channelId,
            threadId,
            repo: "",
          },
        },
        create: {
          channel: "slack",
          channelId,
          threadId,
          repo,
        },
        update: { repo },
      })

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: ts,
        text: `Repository set to \`${repo}\`. You can now ask me to work on it!`,
      })
      break
    }

    case "status": {
      const tasks = await db.task.findMany({
        where: { channel: "slack", channelId },
        orderBy: { createdAt: "desc" },
        take: 5,
      })

      if (tasks.length === 0) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: ts,
          text: "No recent tasks found for this channel.",
        })
        return
      }

      const lines = tasks.map(
        (t) => `• \`${t.id.slice(0, 8)}\` — ${t.status} — ${t.prompt.slice(0, 60)}`
      )
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: ts,
        text: `Recent tasks:\n${lines.join("\n")}`,
      })
      break
    }

    case "new": {
      // Reset thread context by clearing session repo
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: ts,
        text: "Starting a new session. Use `repo owner/name` to set a repository.",
      })
      break
    }

    case "stop": {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: ts,
        text: "Stop is not yet implemented. Tasks already running will complete.",
      })
      break
    }

    default:
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: ts,
        text: `Unknown command: \`${parsed.command}\`. Available: \`repo\`, \`status\`, \`new\`, \`stop\``,
      })
  }
}
