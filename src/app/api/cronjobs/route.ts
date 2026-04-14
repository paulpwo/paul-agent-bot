import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { db } from "@/lib/db/client"
import { scheduleCronJob, computeNextRun } from "@/lib/scheduler"
import { validate as validateCron } from "node-cron"
import { z } from "zod"

const CreateSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(["telegram", "github", "slack"]),
  channelId: z.string().min(1),
  threadId: z.string().min(1),
  repo: z.string().min(1),
  prompt: z.string().min(1),
  schedule: z.string().min(1),
  naturalText: z.string().min(1),
})

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const jobs = await db.cronJob.findMany({ orderBy: { createdAt: "desc" } })
  return NextResponse.json(jobs)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data

  if (!validateCron(data.schedule)) {
    return NextResponse.json({ error: "Invalid cron expression" }, { status: 400 })
  }

  const nextRun = computeNextRun(data.schedule)

  const job = await db.cronJob.create({
    data: {
      name: data.name,
      channel: data.channel,
      channelId: data.channelId,
      threadId: data.threadId,
      repo: data.repo,
      prompt: data.prompt,
      schedule: data.schedule,
      naturalText: data.naturalText,
      enabled: true,
      nextRun,
    },
  })

  // Register in live scheduler
  scheduleCronJob(job)

  return NextResponse.json(job, { status: 201 })
}
