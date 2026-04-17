import { db } from "@/lib/db/client"
import { ensureWorkspace, checkoutOrCreateBranch, getWorkspacePath } from "@/lib/agent/workspace"
import { loadSkills } from "@/lib/agent/skills"
import { runAgent } from "@/lib/agent/runner"
import { getAuthenticatedCloneUrl, getInstallationToken } from "@/lib/agent/token-refresh"
import type { TaskJobData } from "@/lib/queue/producer"
import { execFile } from "child_process"
import { promisify } from "util"
import { createLogger } from "@/lib/logger"

const logger = createLogger("task-worker")

const exec = promisify(execFile)

// Map of taskId → AbortController (for cancellation via TASK-31)
export const activeAbortControllers = new Map<string, AbortController>()

export async function processTask(data: TaskJobData): Promise<void> {
  const { taskId, repo, prompt, channel, channelId, threadId, voiceReply } = data
  const [owner, name] = repo.split("/")

  const promptSnippet = prompt.slice(0, 120).replace(/\n/g, " ")
  logger.info(`Task START  ${taskId} | ${repo} | ${channel}:${channelId} | "${promptSnippet}"`)

  // Mark task as RUNNING
  await db.task.update({
    where: { id: taskId },
    data: { status: "RUNNING" },
  })

  const TASK_TIMEOUT_MS = 15 * 60 * 1000  // 15 minutes

  const startTime = Date.now()
  const abortController = new AbortController()
  activeAbortControllers.set(taskId, abortController)

  // Auto-cancel after timeout
  const timeoutHandle = setTimeout(() => {
    abortController.abort(new Error(`Task exceeded ${TASK_TIMEOUT_MS / 60_000} minute timeout`))
  }, TASK_TIMEOUT_MS)

  // Poll for external cancellation signal (from cancel API endpoint)
  const cancelPoller = setInterval(async () => {
    const { redis } = await import("@/lib/redis/client")
    const cancelled = await redis.get(`cancel:${taskId}`)
    if (cancelled) {
      abortController.abort()
      clearInterval(cancelPoller)
    }
  }, 2000)

  let resolvedDefaultBranch = "main"

  try {
    // Get repo record for GitHub installation ID
    const repoRecord = await db.repo.findFirst({ where: { owner, name } })
    if (!repoRecord) throw new Error(`Repo ${repo} not found in DB`)

    const installationId = repoRecord.githubInstallId
    if (!installationId) throw new Error(`Repo ${repo} has no githubInstallId`)

    // Get installation token and build authenticated clone URL
    const cloneUrl = await getAuthenticatedCloneUrl(repo, installationId)

    // Ensure workspace (clone or pull)
    resolvedDefaultBranch = repoRecord.defaultBranch ?? "main"
    const workspacePath = await ensureWorkspace({ repo, cloneUrl, defaultBranch: resolvedDefaultBranch })
    logger.info(`Workspace ready: ${workspacePath}`)

    // Load session to get currentBranch (branch agent was on at end of previous task)
    const sessionRecord = await db.session.findFirst({
      where: { channel, channelId, threadId, repo },
      select: { currentBranch: true },
    })

    // Resume from last known branch, or create the session branch if starting fresh
    const targetBranch = sessionRecord?.currentBranch ?? `paulagentbot/${threadId}`
    const branchName = await checkoutOrCreateBranch(workspacePath, targetBranch)
    logger.info(`Branch: ${branchName}`)

    // Load skills (global + repo CLAUDE.md + .claude/skills/)
    let systemPrompt = loadSkills(workspacePath)

    // Always inject repo context — agent must know which codebase it's in
    systemPrompt += `\n\n---\n\n## Repository Context

You are working on the repository \`${repo}\` (owner: ${owner}, name: ${name}).
Workspace path: \`${workspacePath}\`

When the user refers to "this project", "this repo", "este proyecto", "este repo", or asks for a summary/overview without further context — they mean THIS repository. Explore the workspace to answer accurately. Do NOT answer about Telegram, bots, or anything outside the codebase unless explicitly asked.`

    // Channel-specific additions
    const extraEnv: Record<string, string> = {}

    // Inject GH_TOKEN for all channels so `gh` CLI works in any context
    {
      const ghToken = await getInstallationToken(installationId)
      extraEnv.GH_TOKEN = ghToken
    }

    if (channel === "github") {
      // Inject GitHub response instructions
      systemPrompt += `\n\n---\n\n## GitHub Response Instructions

You are responding to a GitHub issue or PR comment in the repo \`${repo}\`.
Thread ID (issue/PR number): ${threadId}

After completing your analysis or code changes, **always** post a response back to the thread:
\`\`\`
gh issue comment ${threadId} --repo ${repo} --body "YOUR_RESPONSE_HERE"
\`\`\`
- For PRs this is the same command (GitHub treats PR comments as issue comments).
- Be technical, concise, and helpful. Reference specific files, line numbers, or diffs when relevant.
- If you made code changes, summarize what you changed and why.
- If you have a question or need clarification, ask it in the comment.
- Do NOT post "lol" or short/unhelpful responses.
- If the comment is ironic, sarcastic, rude, offensive, or insulting — do NOTHING. Do not post any comment, do not run any command, do not acknowledge it in any way. Simply stop.`
    }

    if (channel === "telegram" && voiceReply) {
      // Store flag so stream-listener knows to convert result to voice
      const { redis } = await import("@/lib/redis/client")
      await redis.set(`tg:voice:${taskId}`, "1", "EX", 3600)

      // Tell agent to end with a spoken summary for TTS conversion.
      // CRITICAL: explicitly override any global CLAUDE.md voice instructions that
      // might instruct the agent to use bash scripts (send-voice-telegram.sh, etc.).
      // The bot infrastructure handles TTS and delivery — the agent must NOT use bash.
      systemPrompt += `\n\n---\n\n## Voice Response Required

The user wants your response delivered as a voice note.
CRITICAL RULES:
- Do NOT use bash, shell scripts, curl, or any command to send audio/voice.
- Do NOT use send-voice-telegram.sh, text-to-voice.sh, or any similar scripts.
- Do NOT call any Telegram API directly for this voice response.
The bot infrastructure handles TTS conversion and audio delivery automatically.

Your only job: at the very end of your response, add exactly this line:
VOICE_SUMMARY: [1-3 sentences, conversational tone, no markdown, no code snippets, no bullet points — as if speaking aloud]`
    }

    if (channel === "telegram" && process.env.TELEGRAM_BOT_TOKEN && channelId) {
      // Inject Telegram notify instructions — agent uses bash curl ONLY when explicitly asked
      systemPrompt += `\n\n---\n\n## Telegram Notify Instructions

Your Telegram chat ID for this session is: \`${channelId}\`

You may send a Telegram message ONLY when the user explicitly asks to be notified
(e.g. "ping me when done", "notify me when you finish", "avisame cuando termines").

\`\`\`bash
curl -s "https://api.telegram.org/bot\${TELEGRAM_BOT_TOKEN}/sendMessage" \\
  -d "chat_id=${channelId}&text=YOUR_MESSAGE&parse_mode=Markdown"
\`\`\`

NEVER send unsolicited Telegram messages. Do NOT send a message just because a task completed.
Keep messages concise. Use Markdown for formatting if helpful.`
    }

    // Fetch task's session to get agentSessionId (--resume), currentBranch, userId
    const taskRecord = await db.task.findUnique({
      where: { id: taskId },
      select: { sessionId: true, userId: true, session: { select: { agentSessionId: true, currentBranch: true } } },
    })

    // For chat channel: inject Telegram notify instructions if the user has a linked Telegram session
    if (channel === "chat" && process.env.TELEGRAM_BOT_TOKEN && taskRecord?.userId) {
      const telegramSession = await db.session.findFirst({
        where: { channel: "telegram", userId: taskRecord.userId },
        select: { channelId: true },
        orderBy: { updatedAt: "desc" },
      })
      if (telegramSession?.channelId) {
        systemPrompt += `\n\n---\n\n## Telegram Notify Instructions

Your Telegram chat ID for this user is: \`${telegramSession.channelId}\`

You can send a Telegram message to the user at any time using bash:
\`\`\`bash
curl -s "https://api.telegram.org/bot\${TELEGRAM_BOT_TOKEN}/sendMessage" \\
  -d "chat_id=${telegramSession.channelId}&text=YOUR_MESSAGE&parse_mode=Markdown"
\`\`\`

Use this when the user explicitly asks you to send something to Telegram.
Keep messages concise. Use Markdown for formatting if helpful.`
      }
    }

    // Voice tasks always start fresh — no --resume — to prevent prior session context
    // (voice script instructions, tool attempts) from leaking into the new task.
    const resumeSessionId = voiceReply ? undefined : (taskRecord?.session?.agentSessionId ?? undefined)
    logger.info(`Running agent${resumeSessionId ? ` --resume ${resumeSessionId.slice(0, 8)}...` : " (fresh)"}${voiceReply ? " [voice]" : ""}`)
    let result = await runAgent({
      taskId,
      prompt,
      workspacePath,
      systemPrompt,
      channel,
      agentSessionId: resumeSessionId,
      abortSignal: abortController.signal,
      extraEnv,
      // Suppress stream error only when using --resume (stale session failures are retried silently)
      suppressStreamError: !!resumeSessionId,
    })

    // If --resume failed because the session no longer exists (container restart wipes /tmp),
    // clear the stale agentSessionId and retry as a fresh session.
    if (
      !result.success &&
      result.error?.includes("No conversation found with session ID") &&
      taskRecord?.sessionId
    ) {
      logger.warn(`Stale agentSessionId — clearing and retrying as fresh session`)
      await db.session.update({
        where: { id: taskRecord.sessionId },
        data: { agentSessionId: null },
      })
      result = await runAgent({
        taskId,
        prompt,
        workspacePath,
        systemPrompt,
        channel,
        agentSessionId: undefined,
        abortSignal: abortController.signal,
        extraEnv,
      })
    }

    if (!result.success) throw new Error(result.error ?? "Agent failed")

    // Persist the claude session ID for future --resume.
    // Voice tasks are NOT resumed — they inject one-shot system prompt instructions that
    // would leak into subsequent tasks via session history (causing Claude to attempt
    // voice scripts on unrelated messages).
    if (result.sessionId && taskRecord?.sessionId && !voiceReply) {
      await db.session.update({
        where: { id: taskRecord.sessionId },
        data: { agentSessionId: result.sessionId },
      })
    } else if (voiceReply && taskRecord?.sessionId) {
      // Clear any existing session so the next task starts fresh
      await db.session.update({
        where: { id: taskRecord.sessionId },
        data: { agentSessionId: null },
      })
    }

    // Detect which branch the agent ended up on and persist it in the session.
    // This lets the next message resume from whatever branch the agent created/switched to.
    try {
      const { stdout: headBranch } = await exec("git", ["branch", "--show-current"], { cwd: workspacePath })
      const actualBranch = headBranch.trim()
      if (actualBranch && taskRecord?.sessionId) {
        await db.session.update({
          where: { id: taskRecord.sessionId },
          data: { currentBranch: actualBranch },
        })
        if (actualBranch !== branchName) {
          logger.info(`Branch updated: ${branchName} → ${actualBranch}`)
        }
      }
    } catch {
      // Non-fatal — worst case next task recreates the session branch
    }

    // Push branch to remote (best-effort — don't fail the task if push fails)
    try {
      const token = await getInstallationToken(installationId)
      await exec("git", [
        "push",
        `https://x-access-token:${token}@github.com/${repo}.git`,
        `HEAD:${branchName}`,
      ], { cwd: workspacePath })
      logger.info(`Pushed ${branchName}`)
    } catch (pushErr) {
      logger.warn(`Push failed for ${repo} — task still marked COMPLETED:`, pushErr)
    }

    const durationMs = Date.now() - startTime

    logger.info(`Task DONE   ${taskId} | ${(durationMs / 1000).toFixed(1)}s | ${result.output.length} chars output`)

    await db.task.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        result: result.output.slice(0, 10000), // cap result size
        durationMs,
        completedAt: new Date(),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const cancelled = abortController.signal.aborted
    const durationMs = Date.now() - startTime

    if (cancelled) {
      logger.warn(`Task CANCEL ${taskId} | ${(durationMs / 1000).toFixed(1)}s`)
    } else {
      logger.error(`Task FAIL   ${taskId} | ${(durationMs / 1000).toFixed(1)}s | ${message}`)
    }

    await db.task.update({
      where: { id: taskId },
      data: {
        status: cancelled ? "CANCELLED" : "FAILED",
        errorMessage: message,
        durationMs,
        completedAt: new Date(),
      },
    })
  } finally {
    clearTimeout(timeoutHandle)
    clearInterval(cancelPoller)
    activeAbortControllers.delete(taskId)
    // Switch workspace back to default branch for next task
    try {
      const workspacePath = getWorkspacePath(repo)
      await exec("git", ["checkout", resolvedDefaultBranch], { cwd: workspacePath })
    } catch { /* non-fatal */ }
  }
}
