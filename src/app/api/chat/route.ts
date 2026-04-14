import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { db } from "@/lib/db/client"
import { enqueueTask } from "@/lib/queue/producer"

function genThreadId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// POST /api/chat — send a message, creates or continues a session
export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = (session.user as { id?: string }).id
  const body = (await req.json()) as { sessionId?: string; repo: string; prompt: string }
  const { sessionId, repo, prompt } = body

  if (!repo || !prompt) {
    return NextResponse.json({ error: "repo and prompt are required" }, { status: 400 })
  }

  const channel = "dashboard"
  const channelId = userId ?? "web"

  let chatSession: { id: string; threadId: string }

  if (sessionId) {
    // Resume existing session
    const existing = await db.session.findUnique({ where: { id: sessionId } })
    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }
    // Update repo if changed
    if (existing.repo !== repo) {
      await db.session.update({ where: { id: sessionId }, data: { repo } })
    }
    chatSession = existing
  } else {
    // Create new session with a unique threadId
    const threadId = genThreadId()
    chatSession = await db.session.create({
      data: { channel, channelId, threadId, repo, userId: userId ?? null },
    })
  }

  // Create Task
  const task = await db.task.create({
    data: {
      sessionId: chatSession.id,
      channel,
      channelId,
      threadId: chatSession.threadId,
      repo,
      prompt,
      userId: userId ?? null,
    },
  })

  // Enqueue
  await enqueueTask({
    taskId: task.id,
    repo,
    channel,
    channelId,
    threadId: chatSession.threadId,
    prompt,
  })

  return NextResponse.json({ taskId: task.id, sessionId: chatSession.id })
}

// GET /api/chat?sessionId=xxx — load history for a session
export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get("sessionId")

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 })
  }

  const tasks = await db.task.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    take: 20,
  })

  return NextResponse.json(tasks)
}
