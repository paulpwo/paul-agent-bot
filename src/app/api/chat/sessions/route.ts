import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { db } from "@/lib/db/client"

// GET /api/chat/sessions — list recent chat sessions for this user
export async function GET(_req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = (session.user as { id?: string }).id
  const channelId = userId ?? "web"

  const sessions = await db.session.findMany({
    where: { channel: "dashboard", channelId },
    orderBy: { updatedAt: "desc" },
    take: 10,
    include: {
      tasks: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  })

  return NextResponse.json(sessions)
}

// POST /api/chat/sessions — create a new session
export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = (session.user as { id?: string }).id
  const channelId = userId ?? "web"
  const body = (await req.json()) as { repo: string }
  const { repo } = body

  if (!repo) {
    return NextResponse.json({ error: "repo required" }, { status: 400 })
  }

  const threadId = Math.random().toString(36).slice(2, 10)
  const chatSession = await db.session.create({
    data: {
      channel: "dashboard",
      channelId,
      threadId,
      repo,
      userId: userId ?? null,
    },
  })

  return NextResponse.json({ sessionId: chatSession.id })
}
