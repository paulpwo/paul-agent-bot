import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/session"
import { db } from "@/lib/db/client"
import { enqueueTask } from "@/lib/queue/producer"

export async function GET(_req: NextRequest) {
  await requireAuth()

  const tasks = await db.task.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  return NextResponse.json(tasks)
}

export async function POST(req: NextRequest) {
  await requireAuth()

  const body = await req.json() as { repo?: string; prompt?: string }
  const { repo, prompt } = body

  if (!repo || !prompt) {
    return NextResponse.json({ error: "repo and prompt are required" }, { status: 400 })
  }

  const channel = "dashboard"
  const channelId = "web"
  const threadId = "0"

  // Upsert Session
  const session = await db.session.upsert({
    where: { channel_channelId_threadId_repo: { channel, channelId, threadId, repo } },
    create: { channel, channelId, threadId, repo },
    update: {},
  })

  // Create Task
  const task = await db.task.create({
    data: {
      sessionId: session.id,
      channel,
      channelId,
      threadId,
      repo,
      prompt,
    },
  })

  // Enqueue
  await enqueueTask({ taskId: task.id, repo, channel, channelId, threadId, prompt })

  return NextResponse.json({ taskId: task.id })
}
