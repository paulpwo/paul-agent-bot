import { Octokit } from "@octokit/rest"
import { redisSub, redis } from "@/lib/redis/client"
import { STREAM_CHANNEL, setApprovalResult } from "@/lib/redis/pubsub"
import type { StreamEvent } from "@/lib/redis/pubsub"

function createOctokit(installationToken: string): Octokit {
  return new Octokit({ auth: installationToken })
}

// Post initial acknowledgement comment
export async function postAckComment(opts: {
  token: string
  owner: string
  repo: string
  issueNumber: number
}): Promise<number> {
  const octokit = createOctokit(opts.token)
  const { data } = await octokit.issues.createComment({
    owner: opts.owner,
    repo: opts.repo,
    issue_number: opts.issueNumber,
    body: "🤖 Taking the task...",
  })
  return data.id
}

// Edit an existing comment (for streaming progress updates — batched every 5s)
export async function editComment(opts: {
  token: string
  owner: string
  repo: string
  commentId: number
  body: string
}): Promise<void> {
  const octokit = createOctokit(opts.token)
  await octokit.issues.updateComment({
    owner: opts.owner,
    repo: opts.repo,
    comment_id: opts.commentId,
    body: opts.body,
  })
}

// Create a PR after task completion
export async function createPR(opts: {
  token: string
  owner: string
  repo: string
  branch: string
  title: string
  body: string
  baseBranch?: string
}): Promise<string> {
  const octokit = createOctokit(opts.token)
  const { data } = await octokit.pulls.create({
    owner: opts.owner,
    repo: opts.repo,
    head: opts.branch,
    base: opts.baseBranch ?? "main",
    title: opts.title,
    body: opts.body,
  })
  return data.html_url
}

// Subscribe to task stream and batch-update GitHub comment every 5 seconds
export async function streamToGitHub(opts: {
  taskId: string
  token: string
  owner: string
  repo: string
  commentId: number
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const channel = STREAM_CHANNEL(opts.taskId)
    let buffer = "🤖 Working...\n\n"
    let updateTimer: ReturnType<typeof setInterval> | null = null
    let finalResult = ""

    const flush = async () => {
      try {
        await editComment({
          token: opts.token,
          owner: opts.owner,
          repo: opts.repo,
          commentId: opts.commentId,
          body: buffer,
        })
      } catch (err) {
        console.error("[github-adapter] Failed to edit comment:", err)
      }
    }

    // Batch flush every 5 seconds
    updateTimer = setInterval(flush, 5000)

    const handler = async (ch: string, message: string) => {
      if (ch !== channel) return
      try {
        const event: StreamEvent = JSON.parse(message)

        if (event.type === "token") {
          buffer += event.text
        } else if (event.type === "tool_use") {
          buffer += `\n\n_Using tool: \`${event.tool}\`_`
        } else if (event.type === "approval_needed") {
          // GitHub is non-interactive — auto-deny
          await setApprovalResult(redis, event.approvalId, false)
          buffer += `\n\n⚠️ Permission request auto-denied (non-interactive channel)`
        } else if (event.type === "done") {
          finalResult = event.result
          buffer = `✅ Done\n\n${event.result}`
          clearInterval(updateTimer!)
          await flush()
          await redisSub.unsubscribe(channel)
          redisSub.removeListener("message", handler)
          resolve(finalResult)
        } else if (event.type === "error") {
          buffer = `❌ Error: ${event.message}`
          clearInterval(updateTimer!)
          await flush()
          await redisSub.unsubscribe(channel)
          redisSub.removeListener("message", handler)
          reject(new Error(event.message))
        }
      } catch (err) {
        console.error("[github-adapter] Stream parse error:", err)
      }
    }

    redisSub.on("message", handler)
    redisSub.subscribe(channel).catch(reject)
  })
}
