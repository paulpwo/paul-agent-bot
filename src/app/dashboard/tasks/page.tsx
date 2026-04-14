import { db } from "@/lib/db/client"
import { requireAuth } from "@/lib/auth/session"
import TaskList from "@/components/tasks/TaskList"

export default async function TasksPage() {
  await requireAuth()

  const [tasks, repos] = await Promise.all([
    db.task.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    db.repo.findMany({ where: { enabled: true }, select: { fullName: true } }),
  ])

  // Serialize dates for client component
  const serializedTasks = tasks.map((t) => ({
    id: t.id,
    status: t.status as string,
    prompt: t.prompt,
    channel: t.channel,
    repo: t.repo,
    threadId: t.threadId,
    createdAt: t.createdAt.toISOString(),
  }))

  return <TaskList initialTasks={serializedTasks} repos={repos} />
}
