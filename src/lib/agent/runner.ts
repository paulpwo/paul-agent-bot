import { spawn } from "child_process"
import { createInterface } from "readline"
import { publishStream } from "@/lib/redis/pubsub"
import { redis } from "@/lib/redis/client"
import { checkPathPermission } from "./permissions"

export interface RunAgentOptions {
  taskId: string
  prompt: string
  workspacePath: string
  systemPrompt: string   // pre-loaded skills content
  channel: string        // for HITL routing
  model?: string
  agentSessionId?: string
  abortSignal?: AbortSignal
  extraEnv?: Record<string, string>
}

export interface RunAgentResult {
  success: boolean
  output: string
  error?: string
  sessionId?: string
}

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  return new Promise((resolve) => {
    const args: string[] = [
      "--print",
      "--verbose",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",  // we handle permissions ourselves via the stream
    ]

    if (opts.systemPrompt) {
      args.push("--system-prompt", opts.systemPrompt)
    }

    if (opts.model) {
      args.push("--model", opts.model)
    }

    if (opts.agentSessionId) {
      args.push("--resume", opts.agentSessionId)
    }

    args.push(opts.prompt)

    // Drop from root to uid 1001 (nextjs) so claude --dangerously-skip-permissions works.
    // HOME → /tmp so claude can write its working files (settings, session state).
    // Auth is via CLAUDE_CODE_OAUTH_TOKEN env var — no .claude directory needed.
    const isRoot = process.getuid?.() === 0
    const child = spawn("claude", args, {
      cwd: opts.workspacePath,
      stdio: ["ignore", "pipe", "pipe"],  // stdin → /dev/null, capture stdout/stderr
      env: { ...process.env, HOME: "/tmp", ...(opts.extraEnv ?? {}) },
      ...(isRoot ? { uid: 1001, gid: 1001 } : {}),
    })

    // Handle abort
    opts.abortSignal?.addEventListener("abort", () => {
      child.kill("SIGTERM")
    })

    const rl = createInterface({ input: child.stdout })
    const outputLines: string[] = []
    let capturedSessionId: string | undefined

    rl.on("line", async (line) => {
      if (!line.trim()) return
      try {
        const event = JSON.parse(line) as Record<string, unknown>

        if (event.type === "result" && typeof event.session_id === "string") {
          capturedSessionId = event.session_id
        }

        if (event.type === "assistant") {
          const message = event.message as Record<string, unknown> | undefined
          const content = message?.content
          if (!Array.isArray(content)) return

          for (const block of content as Record<string, unknown>[]) {
            if (block.type === "text" && typeof block.text === "string") {
              outputLines.push(block.text)
              await publishStream(redis, opts.taskId, {
                type: "token",
                taskId: opts.taskId,
                text: block.text,
              })
            }

            if (block.type === "tool_use") {
              // Check path safety before publishing tool use
              const pathDecision = checkPathPermission(
                typeof block.name === "string" ? block.name : "",
                block.input,
              )
              if (pathDecision === "deny") {
                // Kill the process — workspace violation
                child.kill("SIGTERM")
                return
              }

              await publishStream(redis, opts.taskId, {
                type: "tool_use",
                taskId: opts.taskId,
                tool: typeof block.name === "string" ? block.name : String(block.name),
                input: block.input,
              })
            }
          }
        }

        // result event — handled by process close
      } catch {
        // Non-JSON line (e.g. debug output) — ignore
      }
    })

    let stderrOutput = ""
    child.stderr.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString()
    })

    child.on("close", async (code) => {
      const output = outputLines.join("")
      if (code === 0) {
        await publishStream(redis, opts.taskId, {
          type: "done",
          taskId: opts.taskId,
          result: output,
        })
        resolve({ success: true, output, sessionId: capturedSessionId })
      } else {
        const errMsg = stderrOutput || `Process exited with code ${code}`
        await publishStream(redis, opts.taskId, {
          type: "error",
          taskId: opts.taskId,
          message: errMsg,
        })
        resolve({ success: false, output, error: errMsg })
      }
    })

    child.on("error", async (err) => {
      await publishStream(redis, opts.taskId, {
        type: "error",
        taskId: opts.taskId,
        message: err.message,
      })
      resolve({ success: false, output: "", error: err.message })
    })
  })
}
