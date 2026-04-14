import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/session"
import { getWorkspacePath } from "@/lib/agent/workspace"
import { execFile } from "child_process"
import { promisify } from "util"
import { existsSync } from "fs"

const exec = promisify(execFile)

export async function GET(req: NextRequest) {
  await requireAuth()
  const repo = req.nextUrl.searchParams.get("repo")
  if (!repo) return NextResponse.json({ error: "Missing repo" }, { status: 400 })

  const workspacePath = getWorkspacePath(repo)
  if (!existsSync(workspacePath)) {
    return NextResponse.json({ branches: [], current: null })
  }

  try {
    const [branchOut, currentOut] = await Promise.all([
      exec("git", ["branch", "-a", "--format=%(refname:short)"], { cwd: workspacePath }),
      exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: workspacePath }),
    ])

    const branches = branchOut.stdout
      .split("\n")
      .map((b) => b.trim().replace(/^origin\//, ""))
      .filter((b) => b && b !== "HEAD")
      .filter((v, i, a) => a.indexOf(v) === i) // dedupe
      .sort()

    const current = currentOut.stdout.trim()
    return NextResponse.json({ branches, current })
  } catch {
    return NextResponse.json({ branches: [], current: null })
  }
}
