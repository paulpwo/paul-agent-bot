import { requireAuth } from "@/lib/auth/session"
import { db } from "@/lib/db/client"
import { getServerSession } from "next-auth"
import { notFound } from "next/navigation"
import { ChatPage } from "@/components/chat/ChatPage"
import type { Message } from "@/components/chat/MessageBubble"
import type { Task } from "@prisma/client"

interface PageProps {
  params: Promise<{ sessionId: string }>
}

function taskToMessages(task: Task): Message[] {
  const user: Message = {
    id: `${task.id}-user`,
    role: "user",
    content: task.prompt,
    status: "done",
    toolCalls: [],
  }
  const agent: Message = {
    id: task.id,
    role: "agent",
    content: task.result ?? task.errorMessage ?? "",
    status:
      task.status === "COMPLETED"
        ? "done"
        : task.status === "FAILED"
          ? "error"
          : task.status === "CANCELLED"
            ? "cancelled"
            : "streaming", // RUNNING or QUEUED → reconnect stream on mount
    toolCalls: [],
  }
  return [user, agent]
}

export default async function ChatSessionRoute({ params }: PageProps) {
  await requireAuth()

  const authSession = await getServerSession()
  const userId = (authSession?.user as { id?: string } | undefined)?.id
  const channelId = userId ?? "web"

  const { sessionId } = await params

  const [chatSession, allSessions, repos] = await Promise.all([
    // Load by ID only — allow any channel (github, telegram, dashboard, etc.)
    db.session.findUnique({
      where: { id: sessionId },
      include: {
        tasks: { orderBy: { createdAt: "asc" }, take: 20 },
      },
    }),
    db.session.findMany({
      where: { channel: "dashboard", channelId },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        tasks: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    db.repo.findMany({
      where: { enabled: true },
      orderBy: { fullName: "asc" },
      select: { fullName: true },
    }),
  ])

  if (!chatSession) {
    notFound()
  }

  const { tasks, ...sessionData } = chatSession
  const initialMessages = tasks.flatMap(taskToMessages)

  return (
    <ChatPage
      initialSession={sessionData}
      initialMessages={initialMessages}
      recentSessions={allSessions}
      repos={repos}
    />
  )
}
