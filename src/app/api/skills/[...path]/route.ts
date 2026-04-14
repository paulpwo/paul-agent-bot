import { NextRequest, NextResponse } from "next/server"
import { readFileSync, writeFileSync, existsSync } from "fs"
import path from "path"
import { requireAuth } from "@/lib/auth/session"

const CLAUDE_SKILLS_DIR = process.env.HOME
  ? path.join(process.env.HOME, ".claude", "skills")
  : null

const WORKSPACE_BASE = process.env.WORKSPACE_BASE ?? "/data/workspaces"

/**
 * Validate that a resolved path stays within allowed directories.
 */
function isPathAllowed(filePath: string): boolean {
  const resolved = path.resolve(filePath)

  if (CLAUDE_SKILLS_DIR) {
    const base = path.resolve(CLAUDE_SKILLS_DIR)
    if (resolved.startsWith(base + path.sep) || resolved === base) return true
  }

  const workspaceBase = path.resolve(WORKSPACE_BASE)
  if (resolved.startsWith(workspaceBase + path.sep)) return true

  return false
}

type RouteContext = { params: Promise<{ path: string[] }> }

// GET /api/skills/[...path] — read full file content
export async function GET(req: NextRequest, context: RouteContext) {
  await requireAuth()

  const { path: segments } = await context.params
  const filePath = "/" + segments.join("/")

  if (!isPathAllowed(filePath)) {
    return NextResponse.json({ error: "Path traversal detected" }, { status: 400 })
  }

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 })
  }

  try {
    const content = readFileSync(filePath, "utf8")
    return NextResponse.json({ content, path: filePath })
  } catch {
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 })
  }
}

// PATCH /api/skills/[...path] — update skill file content
export async function PATCH(req: NextRequest, context: RouteContext) {
  await requireAuth()

  const { path: segments } = await context.params
  const filePath = "/" + segments.join("/")

  if (!isPathAllowed(filePath)) {
    return NextResponse.json({ error: "Path traversal detected" }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body.content !== "string") {
    return NextResponse.json(
      { error: "Invalid body: expected { content: string }" },
      { status: 400 }
    )
  }

  try {
    writeFileSync(filePath, body.content, "utf8")
    return NextResponse.json({ ok: true, path: filePath })
  } catch {
    return NextResponse.json({ error: "Failed to write file" }, { status: 500 })
  }
}
