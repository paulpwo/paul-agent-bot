import { execFile } from "child_process"
import { promisify } from "util"
import { existsSync } from "fs"
import path from "path"
import { db } from "@/lib/db/client"

const execRaw = promisify(execFile)

// Git env: disable interactive terminal credential prompts.
// credential.helper is disabled via -c flag (more reliable than env vars —
// GIT_CONFIG_COUNT requires git ≥ 2.32 and env vars don't override osxkeychain GUI).
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" }

// Prepend -c credential.helper= to every git invocation so macOS Keychain is
// never invoked. The clone URL already contains the token — nothing to store.
function exec(cmd: string, args: string[], opts?: { cwd?: string }): ReturnType<typeof execRaw> {
  const finalArgs = cmd === "git" ? ["-c", "credential.helper=", ...args] : args
  return execRaw(cmd, finalArgs, { ...opts, env: GIT_ENV })
}

const WORKSPACE_BASE = process.env.WORKSPACE_BASE ?? "/data/workspaces"

const REPO_FORMAT = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/

export function getWorkspacePath(repo: string): string {
  if (!REPO_FORMAT.test(repo)) throw new Error(`Invalid repo format: ${repo}`)
  return path.join(WORKSPACE_BASE, repo)
}

export function isPathSafe(filePath: string): boolean {
  // Resolve symlinks conceptually: ensure path is inside WORKSPACE_BASE
  const resolved = path.resolve(filePath)
  const base = path.resolve(WORKSPACE_BASE)
  return resolved.startsWith(base + path.sep) || resolved === base
}

interface CloneOrPullOptions {
  repo: string           // "owner/name"
  cloneUrl: string       // authenticated HTTPS URL
  defaultBranch?: string
}

// Clone repo if not exists, pull if exists
export async function ensureWorkspace(opts: CloneOrPullOptions): Promise<string> {
  const workspacePath = getWorkspacePath(opts.repo)

  // Validate clone URL is HTTPS to a known GitHub host — never SSH, file://, or attacker URLs
  const parsedUrl = new URL(opts.cloneUrl)
  if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname.endsWith("github.com")) {
    throw new Error(`Untrusted clone URL: ${parsedUrl.origin}`)
  }

  if (!existsSync(workspacePath)) {
    await exec("git", ["clone", opts.cloneUrl, workspacePath])
    // Disable credential storage in the repo's local git config so any subsequent
    // git command run from this workspace (including agent Bash tool calls) never
    // triggers the macOS Keychain GUI. The clone URL contains the token already.
    await exec("git", ["config", "credential.helper", ""], { cwd: workspacePath })
  } else {
    // Always return to the default branch before pulling.
    // If a previous task left the workspace on a feature branch with no upstream,
    // `git pull --ff-only` would fail with "no tracking information".
    // Refresh remote URL first — GitHub App tokens expire after 1 hour.
    await exec("git", ["remote", "set-url", "origin", opts.cloneUrl], { cwd: workspacePath })
    // Ensure credential.helper is disabled (idempotent — also covers repos cloned before this fix).
    await exec("git", ["config", "credential.helper", ""], { cwd: workspacePath })
    // Fetch so remote HEAD is up to date before we try to resolve it.
    await exec("git", ["fetch", "origin"], { cwd: workspacePath })

    // Always resolve the real default branch from remote — DB value may be stale/wrong.
    let defaultBranch = opts.defaultBranch ?? "main"
    try {
      const { stdout } = await exec(
        "git", ["ls-remote", "--symref", "origin", "HEAD"],
        { cwd: workspacePath }
      )
      const match = stdout.toString().match(/^ref: refs\/heads\/(\S+)\s+HEAD/m)
      if (match?.[1]) {
        defaultBranch = match[1]
        // Sync DB if it was stale
        if (defaultBranch !== opts.defaultBranch) {
          const [owner, name] = opts.repo.split("/")
          await db.repo.updateMany({ where: { owner, name }, data: { defaultBranch } })
        }
      }
    } catch {
      // ls-remote failed — keep DB value or "main" as fallback
    }

    try {
      await exec("git", ["checkout", defaultBranch], { cwd: workspacePath })
    } catch {
      // Branch doesn't exist locally — create tracking branch from remote.
      await exec("git", ["checkout", "-b", defaultBranch, `origin/${defaultBranch}`], { cwd: workspacePath })
    }

    await exec("git", ["pull", "--ff-only"], { cwd: workspacePath })
  }

  // Update workspace path in DB
  await db.repo.updateMany({
    where: { owner: opts.repo.split("/")[0], name: opts.repo.split("/")[1] },
    data: { workspacePath },
  })

  return workspacePath
}

// Checkout existing branch or create it. Used for session branches so every
// message in the same session reuses the same branch instead of creating -2, -3, etc.
export async function checkoutOrCreateBranch(workspacePath: string, branchName: string): Promise<string> {
  try {
    // Branch already exists locally — just switch to it
    await exec("git", ["checkout", branchName], { cwd: workspacePath })
  } catch {
    // Branch doesn't exist — create it from current HEAD
    await exec("git", ["checkout", "-b", branchName], { cwd: workspacePath })
  }
  return branchName
}

// Create a branch for a task (with collision handling) — kept for callers that need unique names
export async function createTaskBranch(workspacePath: string, baseName: string): Promise<string> {
  let branchName = baseName
  let suffix = 1

  while (true) {
    try {
      await exec("git", ["checkout", "-b", branchName], { cwd: workspacePath })
      return branchName
    } catch {
      suffix++
      branchName = `${baseName}-${suffix}`
      if (suffix > 99) throw new Error(`Could not create branch after 99 attempts: ${baseName}`)
    }
  }
}

// Switch back to default branch
export async function checkoutDefault(workspacePath: string, defaultBranch = "main"): Promise<void> {
  await exec("git", ["checkout", defaultBranch], { cwd: workspacePath })
}
