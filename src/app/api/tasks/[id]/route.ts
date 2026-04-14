import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/session"
import { db } from "@/lib/db/client"

const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "CANCELLED"] as const

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAuth()
  const { id } = await params

  const task = await db.task.findUnique({ where: { id } })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (!TERMINAL_STATUSES.includes(task.status as typeof TERMINAL_STATUSES[number])) {
    return NextResponse.json({ error: "Cannot delete active task" }, { status: 409 })
  }

  // Attempt to remove from BullMQ if the job still exists there
  if (task.bullJobId) {
    try {
      const { getQueue } = await import("@/lib/queue/producer")
      const queue = getQueue(task.repo)
      const job = await queue.getJob(task.bullJobId)
      if (job) await job.remove()
    } catch {
      // Job may already be gone — ignore silently
    }
  }

  await db.task.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
