import { requireAuth } from "@/lib/auth/session"
import { db } from "@/lib/db/client"
import { getServerSession } from "next-auth"
import { ChatPage } from "@/components/chat/ChatPage"

export default async function ChatRoute() {
  await requireAuth()

  const authSession = await getServerSession()
  const userId = (authSession?.user as { id?: string } | undefined)?.id
  const channelId = userId ?? "web"

  const [recentSessions, repos] = await Promise.all([
    db.session.findMany({
      where: { channel: "dashboard", channelId },
      orderBy: { updatedAt: "desc" },
      take: 10,
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

  return (
    <ChatPage
      recentSessions={recentSessions}
      repos={repos}
    />
  )
}
