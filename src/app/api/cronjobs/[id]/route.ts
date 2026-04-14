import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { db } from "@/lib/db/client"
import { reloadCronJob, unscheduleCronJob, computeNextRun } from "@/lib/scheduler"
import { validate as validateCron } from "node-cron"
import { z } from "zod"

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  schedule: z.string().optional(),
  prompt: z.string().optional(),
  naturalText: z.string().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data

  if (data.schedule !== undefined && !validateCron(data.schedule)) {
    return NextResponse.json({ error: "Invalid cron expression" }, { status: 400 })
  }

  const updateData: Record<string, unknown> = {}
  if (data.enabled !== undefined) updateData.enabled = data.enabled
  if (data.schedule !== undefined) {
    updateData.schedule = data.schedule
    updateData.nextRun = computeNextRun(data.schedule)
  }
  if (data.prompt !== undefined) updateData.prompt = data.prompt
  if (data.naturalText !== undefined) updateData.naturalText = data.naturalText

  const job = await db.cronJob.update({
    where: { id },
    data: updateData,
  })

  // Reload in scheduler (handles enable/disable/reschedule)
  await reloadCronJob(id)

  return NextResponse.json(job)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  unscheduleCronJob(id)
  await db.cronJob.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
