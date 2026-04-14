import { db } from "@/lib/db/client"
import { enqueueTask } from "@/lib/queue/producer"
import { streamToEmail } from "./adapter"

export interface ParsedEmail {
  from: string
  subject: string
  text: string
  messageId: string
  inReplyTo?: string
  repo?: string // parsed from subject if present
}

// Parse repo from subject: "[@paulagentbot owner/name] my question here"
// Returns { repo, cleanSubject } — cleanSubject has the tag stripped
function parseSubject(subject: string): { repo: string | null; cleanSubject: string } {
  const match = subject.match(/^\[@paulagentbot\s+([\w.-]+\/[\w.-]+)\]\s*(.*)$/i)
  if (match) {
    return { repo: match[1], cleanSubject: match[2].trim() || subject }
  }
  return { repo: null, cleanSubject: subject }
}

export async function handleInboundEmail(parsed: ParsedEmail): Promise<void> {
  const { from, subject, text, messageId, inReplyTo } = parsed

  // Determine repo — prefer explicit subject tag, then existing session (via inReplyTo)
  const { repo: subjectRepo, cleanSubject } = parseSubject(subject)
  let repo = subjectRepo ?? parsed.repo ?? null

  // If this is a reply (inReplyTo set), look up the parent session to inherit repo
  if (!repo && inReplyTo) {
    const parentSession = await db.session.findFirst({
      where: { channel: "email", threadId: inReplyTo },
      orderBy: { createdAt: "desc" },
    })
    if (parentSession?.repo) {
      repo = parentSession.repo
    }
  }

  if (!repo) {
    console.warn(`[email] No repo found for email from ${from} subject "${subject}" — ignoring`)
    return
  }

  const [owner, name] = repo.split("/")
  const repoRecord = await db.repo.findFirst({
    where: { owner, name, enabled: true },
  })

  if (!repoRecord) {
    console.warn(`[email] Repo ${repo} not enabled — ignoring`)
    return
  }

  // Upsert session: channelId = sender email, threadId = this message's ID
  const session = await db.session.upsert({
    where: {
      channel_channelId_threadId_repo: {
        channel: "email",
        channelId: from,
        threadId: messageId,
        repo,
      },
    },
    create: {
      channel: "email",
      channelId: from,
      threadId: messageId,
      repo,
    },
    update: {},
  })

  const prompt = text.trim()
  const replySubject = cleanSubject

  // Create Task record
  const task = await db.task.create({
    data: {
      sessionId: session.id,
      channel: "email",
      channelId: from,
      threadId: messageId,
      repo,
      prompt,
      status: "QUEUED",
    },
  })

  // Enqueue to BullMQ
  const jobId = await enqueueTask({
    taskId: task.id,
    channel: "email",
    channelId: from,
    threadId: messageId,
    repo,
    prompt,
  })

  // Update task with BullMQ job ID
  await db.task.update({
    where: { id: task.id },
    data: { bullJobId: jobId },
  })

  console.log(`[email] Task ${task.id} queued for ${repo} from ${from}`)

  // Fire-and-forget: subscribe and send reply when done
  streamToEmail(task.id, from, replySubject, messageId).catch(err =>
    console.error("[email] streamToEmail error:", err),
  )
}
