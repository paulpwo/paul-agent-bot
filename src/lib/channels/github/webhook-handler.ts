import { db } from "@/lib/db/client"
import { dispatchNotification } from "@/lib/notifications/dispatch"
import { enqueueTask } from "@/lib/queue/producer"
import { redis } from "@/lib/redis/client"
import { getSetting, SETTINGS_KEYS } from "@/lib/settings"
import { createLogger } from "@/lib/logger"

const logger = createLogger("github")

const BOT_USERNAME = process.env.GITHUB_APP_BOT_USERNAME ?? "paulclaudebot[bot]"
// Derive mention from bot username: "paulclaudebot[bot]" → "@paulclaudebot"
const BOT_MENTION = "@" + BOT_USERNAME.replace("[bot]", "")

const DEFAULT_RATE_COMMENTS_PER_MINUTE = 5
const DEFAULT_RATE_TASKS_PER_DAY = 100

// Returns true if the request is allowed, false if rate-limited
async function checkRateLimits(repo: string, threadId: string): Promise<boolean> {
  const [perMinuteSetting, perDaySetting] = await Promise.all([
    getSetting(SETTINGS_KEYS.GITHUB_RATE_COMMENTS_PER_MINUTE).catch(() => null),
    getSetting(SETTINGS_KEYS.GITHUB_RATE_TASKS_PER_DAY).catch(() => null),
  ])

  const maxPerMinute = perMinuteSetting ? parseInt(perMinuteSetting, 10) : DEFAULT_RATE_COMMENTS_PER_MINUTE
  const maxPerDay = perDaySetting ? parseInt(perDaySetting, 10) : DEFAULT_RATE_TASKS_PER_DAY

  const minuteKey = `github:rl:thread:${repo}:${threadId}`
  const dayKey = `github:rl:daily:${new Date().toISOString().slice(0, 10)}`

  const [minuteCount, dayCount] = await Promise.all([
    redis.incr(minuteKey),
    redis.incr(dayKey),
  ])

  // Set TTLs on first increment
  if (minuteCount === 1) await redis.expire(minuteKey, 60)
  if (dayCount === 1) await redis.expire(dayKey, 86400)

  if (minuteCount > maxPerMinute) {
    logger.warn(`Rate limit hit: ${repo}#${threadId} — ${minuteCount} comments in last 60s (max ${maxPerMinute})`)
    return false
  }
  if (dayCount > maxPerDay) {
    logger.warn(`Daily rate limit hit: ${dayCount} tasks today (max ${maxPerDay})`)
    return false
  }

  return true
}

function extractMention(text: string): string | null {
  const idx = text.indexOf(BOT_MENTION)
  if (idx === -1) return null
  return text.slice(idx + BOT_MENTION.length).trim()
}

// TASK-24: parse webhook event, detect trigger, loop guard, enqueue
export async function handleWebhookEvent(event: string, payload: Record<string, unknown>): Promise<void> {
  // Loop guard: ignore events triggered by the bot itself
  const sender = (payload.sender as { login?: string })?.login
  if (sender === BOT_USERNAME || sender?.endsWith("[bot]")) return

  if (event === "issue_comment" && payload.action === "created") {
    await handleIssueComment(payload)
  } else if (event === "issues" && payload.action === "labeled") {
    await handleIssueLabeled(payload)
  } else if (event === "pull_request_review_comment" && payload.action === "created") {
    await handlePRReviewComment(payload)
  }

  if (event === "pull_request") {
    if (payload.action === "opened") void handlePROpened(payload)
    if (payload.action === "closed") void handlePRMerged(payload)  // checks merged internally
  }
  if (event === "issues" && payload.action === "opened") {
    void handleIssueOpened(payload)
  }
}

async function handleIssueComment(payload: Record<string, unknown>): Promise<void> {
  const comment = payload.comment as { body?: string; id?: number; html_url?: string }
  const issue = payload.issue as { number?: number; title?: string }
  const repo = payload.repository as { full_name?: string }
  const senderLogin = (payload.sender as { login?: string })?.login ?? "unknown"

  if (!comment?.body || !issue?.number || !repo?.full_name) return

  const instruction = extractMention(comment.body)
  if (!instruction) return

  void dispatchNotification({
    type: "mention",
    repo: repo.full_name,
    threadId: String(issue.number),
    title: issue.title ?? "",
    url: comment.html_url ?? "",
    actor: senderLogin,
    body: instruction.slice(0, 200),
  })

  await createTask({
    repo: repo.full_name,
    threadId: String(issue.number),
    prompt: instruction,
    context: `Issue #${issue.number}: ${issue.title ?? ""}`,
  })
}

async function handleIssueLabeled(payload: Record<string, unknown>): Promise<void> {
  const label = (payload.label as { name?: string })?.name
  if (label !== "bot:task" && label !== "bot:review") return

  const issue = payload.issue as { number?: number; title?: string; body?: string }
  const repo = payload.repository as { full_name?: string }
  if (!issue?.number || !repo?.full_name) return

  const isReview = label === "bot:review"
  const prompt = isReview
    ? `Review the code in this PR and provide detailed feedback.`
    : `${issue.title ?? ""}\n\n${issue.body ?? ""}`.trim()

  await createTask({ repo: repo.full_name, threadId: String(issue.number), prompt })
}

async function handlePRReviewComment(payload: Record<string, unknown>): Promise<void> {
  const comment = payload.comment as { body?: string; html_url?: string }
  const pr = payload.pull_request as { number?: number; title?: string }
  const repo = payload.repository as { full_name?: string }
  const senderLogin = (payload.sender as { login?: string })?.login ?? "unknown"

  if (!comment?.body || !pr?.number || !repo?.full_name) return

  const instruction = extractMention(comment.body)
  if (!instruction) return

  void dispatchNotification({
    type: "mention",
    repo: repo.full_name,
    threadId: String(pr.number),
    title: pr.title ?? "",
    url: comment.html_url ?? "",
    actor: senderLogin,
    body: instruction.slice(0, 200),
  })

  await createTask({
    repo: repo.full_name,
    threadId: String(pr.number),
    prompt: instruction,
  })
}

async function handlePROpened(payload: Record<string, unknown>): Promise<void> {
  const pr = payload.pull_request as Record<string, unknown>
  const repo = payload.repository as Record<string, unknown>
  const actor = (payload.sender as Record<string, unknown>)?.login ?? "unknown"
  const repoFullName = (repo?.full_name as string) ?? ""
  const [owner, name] = repoFullName.split("/")
  const repoRecord = await db.repo.findFirst({ where: { owner, name, enabled: true } })
  if (!repoRecord) return
  void dispatchNotification({
    type: "pr_opened",
    repo: repoFullName,
    threadId: String(pr?.number ?? ""),
    title: (pr?.title as string) ?? "",
    url: (pr?.html_url as string) ?? "",
    actor: String(actor),
  })
}

async function handlePRMerged(payload: Record<string, unknown>): Promise<void> {
  const pr = payload.pull_request as Record<string, unknown>
  if (pr?.merged !== true) return
  const repo = payload.repository as Record<string, unknown>
  const actor = (payload.sender as Record<string, unknown>)?.login ?? "unknown"
  const repoFullName = (repo?.full_name as string) ?? ""
  const [owner, name] = repoFullName.split("/")
  const repoRecord = await db.repo.findFirst({ where: { owner, name, enabled: true } })
  if (!repoRecord) return
  void dispatchNotification({
    type: "pr_merged",
    repo: repoFullName,
    threadId: String(pr?.number ?? ""),
    title: (pr?.title as string) ?? "",
    url: (pr?.html_url as string) ?? "",
    actor: String(actor),
  })
}

async function handleIssueOpened(payload: Record<string, unknown>): Promise<void> {
  const issue = payload.issue as Record<string, unknown>
  const repo = payload.repository as Record<string, unknown>
  const actor = (payload.sender as Record<string, unknown>)?.login ?? "unknown"
  const repoFullName = (repo?.full_name as string) ?? ""
  const [owner, name] = repoFullName.split("/")
  const repoRecord = await db.repo.findFirst({ where: { owner, name, enabled: true } })
  if (!repoRecord) return
  void dispatchNotification({
    type: "issue_opened",
    repo: repoFullName,
    threadId: String(issue?.number ?? ""),
    title: (issue?.title as string) ?? "",
    url: (issue?.html_url as string) ?? "",
    actor: String(actor),
  })
}

// TASK-25 + TASK-26: session lookup/create + task creation + enqueue
async function createTask(opts: {
  repo: string
  threadId: string
  prompt: string
  context?: string
}): Promise<void> {
  const [owner, name] = opts.repo.split("/")

  const repoRecord = await db.repo.findFirst({
    where: {
      owner,
      name,
      enabled: true,
    },
  })

  if (!repoRecord) {
    logger.warn(`Repo ${opts.repo} not enabled — ignoring`)
    return
  }

  const allowed = await checkRateLimits(opts.repo, opts.threadId)
  if (!allowed) {
    logger.warn(`Task blocked by rate limit for ${opts.repo}#${opts.threadId}`)
    return
  }

  // Session scoping: (channel, channelId, threadId, repo)
  const session = await db.session.upsert({
    where: {
      channel_channelId_threadId_repo: {
        channel: "github",
        channelId: opts.repo,
        threadId: opts.threadId,
        repo: opts.repo,
      },
    },
    create: {
      channel: "github",
      channelId: opts.repo,
      threadId: opts.threadId,
      repo: opts.repo,
    },
    update: {},
  })

  const fullPrompt = opts.context
    ? `Context: ${opts.context}\n\n${opts.prompt}`
    : opts.prompt

  // Create Task record (sessionId is required by schema)
  const task = await db.task.create({
    data: {
      sessionId: session.id,
      channel: "github",
      channelId: opts.repo,
      threadId: opts.threadId,
      repo: opts.repo,
      prompt: fullPrompt,
      status: "QUEUED",
    },
  })

  // Enqueue to BullMQ (after DB record exists)
  const jobId = await enqueueTask({
    taskId: task.id,
    channel: "github",
    channelId: opts.repo,
    threadId: opts.threadId,
    repo: opts.repo,
    prompt: fullPrompt,
  })

  // Update task with BullMQ job ID
  await db.task.update({
    where: { id: task.id },
    data: { bullJobId: jobId },
  })

  logger.info(`Task ${task.id} queued for ${opts.repo}#${opts.threadId}`)
}
