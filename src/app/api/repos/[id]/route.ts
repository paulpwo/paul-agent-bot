import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/session"
import { db } from "@/lib/db/client"

interface Params {
  params: Promise<{ id: string }>
}

export async function PATCH(req: NextRequest, { params }: Params) {
  await requireAuth()
  const { id } = await params

  const body = await req.json() as {
    enabled?: boolean
    protectedBranches?: string
    defaultBranch?: string
  }

  const repo = await db.repo.findUnique({ where: { id } })
  if (!repo) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updated = await db.repo.update({
    where: { id },
    data: {
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(body.protectedBranches !== undefined && { protectedBranches: body.protectedBranches }),
      ...(body.defaultBranch !== undefined && { defaultBranch: body.defaultBranch }),
    },
  })

  return NextResponse.json({ ok: true, repo: updated })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  await requireAuth()
  const { id } = await params

  const repo = await db.repo.findUnique({ where: { id } })
  if (!repo) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Close the BullMQ worker for this repo if it's running
  try {
    const { getActiveWorkers } = await import("@/lib/queue/registry")
    const workers = getActiveWorkers()
    const worker = workers.find((w) => w.name === repo.queueName)
    if (worker) await worker.close()
  } catch {
    // Worker registry may not be initialised in this process — safe to ignore
  }

  await db.repo.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
