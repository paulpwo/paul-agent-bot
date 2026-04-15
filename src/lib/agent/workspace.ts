import { execFile } from "child_process"
import { promisify } from "util"
import { existsSync } from "fs"
import path from "path"
import { db } from "@/lib/db/client"

const exec = promisify(execFile)

const WORKSPACE_BASE = process.env.WORKSPACE_BASE ?? "/data/workspaces"

export function getWorkspacePath(repo: string): string {
  // repo = "owner/name" → WORKSPACE_BASE/owner/name
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

  if (!existsSync(workspacePath)) {
    await exec("git", ["clone", opts.cloneUrl, workspacePath])
  } else {
    // Always return to the default branch before pulling.
    // If a previous task left the workspace on a feature branch with no upstream,
    // `git pull --ff-only` would fail with "no tracking information".
    const defaultBranch = opts.defaultBranch ?? "main"
    await exec("git", ["checkout", defaultBranch], { cwd: workspacePath })
    // Refresh remote URL with a fresh token — GitHub App tokens expire after 1 hour,
    // and the URL embedded in .git/config from the initial clone may be stale.
    await exec("git", ["remote", "set-url", "origin", opts.cloneUrl], { cwd: workspacePath })
    await exec("git", ["pull", "--ff-only"], { cwd: workspacePath })
  }

  // Update workspace path in DB
  await db.repo.updateMany({
    where: { owner: opts.repo.split("/")[0], name: opts.repo.split("/")[1] },
    data: { workspacePath },
  })

  return workspacePath
}

// Create a branch for a task (with collision handling)
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
