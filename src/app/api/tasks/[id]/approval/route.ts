import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { setApprovalResult } from "@/lib/redis/pubsub"
import { redis } from "@/lib/redis/client"

interface Params {
  params: Promise<{ id: string }>
}

// PATCH /api/tasks/[id]/approval — approve or deny a HITL request
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  await params // taskId available if needed
  const body = (await req.json()) as { approvalId: string; approved: boolean }
  const { approvalId, approved } = body

  if (!approvalId || typeof approved !== "boolean") {
    return NextResponse.json({ error: "approvalId and approved required" }, { status: 400 })
  }

  await setApprovalResult(redis, approvalId, approved)

  return NextResponse.json({ ok: true })
}
