import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import { requireAuth } from "@/lib/auth/session"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAuth()
  const { id } = await params

  const session = await db.session.findUnique({ where: { id } })
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Delete tasks first (FK constraint), then session
  await db.task.deleteMany({ where: { sessionId: id } })
  await db.session.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
