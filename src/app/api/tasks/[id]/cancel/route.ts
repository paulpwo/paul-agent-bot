import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/session"
import { db } from "@/lib/db/client"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAuth()
  const { id } = await params

  const task = await db.task.findUnique({ where: { id } })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (task.status !== "RUNNING" && task.status !== "QUEUED") {
    return NextResponse.json({ error: "Task is not active" }, { status: 400 })
  }

  // Signal abort via a Redis key that the worker polls every 2s
  // The worker's AbortController is in-process (workers/task-worker.ts activeAbortControllers)
  // For cross-process cancellation, publish a cancel signal via Redis
  const { redis } = await import("@/lib/redis/client")
  await redis.set(`cancel:${id}`, "1", "EX", 60)

  await db.task.update({
    where: { id },
    data: { status: "CANCELLED" },
  })

  return NextResponse.json({ ok: true })
}
