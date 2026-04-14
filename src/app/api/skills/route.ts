import { NextRequest, NextResponse } from "next/server"
import { readdirSync, statSync, readFileSync, existsSync } from "fs"
import path from "path"
import { requireAuth } from "@/lib/auth/session"
import { getSettingJson, setSettingJson } from "@/lib/settings"
import { db } from "@/lib/db/client"

const CLAUDE_SKILLS_DIR = process.env.HOME
  ? path.join(process.env.HOME, ".claude", "skills")
  : null

const WORKSPACE_BASE = process.env.WORKSPACE_BASE ?? "/data/workspaces"

export interface SkillFile {
  name: string
  path: string
  size: number
  preview: string
}

/**
 * Recursively find all *.md files under a directory.
 */
function findMdFiles(dir: string, base: string): SkillFile[] {
  const results: SkillFile[] = []
  if (!existsSync(dir)) return results

  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findMdFiles(full, base))
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      try {
        const stat = statSync(full)
        const content = readFileSync(full, "utf8")
        const preview = content.slice(0, 200).replace(/\s+/g, " ").trim()
        // name = relative path from base, e.g. "_shared/engram-convention" or "frontend-design/SKILL"
        const rel = path.relative(base, full)
        const name = rel.replace(/\.md$/, "")
        results.push({ name, path: full, size: stat.size, preview })
      } catch {
        // skip unreadable
      }
    }
  }
  return results
}

// GET /api/skills — list all available skills
export async function GET(req: NextRequest) {
  await requireAuth()

  const { searchParams } = new URL(req.url)
  const repoFullName = searchParams.get("repo")

  const skills: SkillFile[] = []

  // 1. Global skills from ~/.claude/skills/
  if (CLAUDE_SKILLS_DIR) {
    const globalSkills = findMdFiles(CLAUDE_SKILLS_DIR, CLAUDE_SKILLS_DIR)
    skills.push(...globalSkills)
  }

  // 2. Repo-specific skills from WORKSPACE_BASE/{owner}/{name}/.claude/skills/
  if (repoFullName) {
    const workspacePath = path.join(WORKSPACE_BASE, repoFullName)
    const repoSkillsDir = path.join(workspacePath, ".claude", "skills")
    if (existsSync(repoSkillsDir)) {
      const repoSkills = findMdFiles(repoSkillsDir, repoSkillsDir)
      skills.push(...repoSkills)
    }
  }

  // 3. Load enabled skills for this repo (if provided)
  let enabledPaths: string[] = []
  if (repoFullName) {
    try {
      enabledPaths = (await getSettingJson<string[]>(`skills:${repoFullName}`)) ?? []
    } catch {
      // settings not available
    }
  }

  return NextResponse.json({ skills, enabledPaths })
}

// POST /api/skills — toggle a skill for a repo
// Body: { repoFullName: string, skillPath: string, enabled: boolean }
export async function POST(req: NextRequest) {
  await requireAuth()

  const body = await req.json().catch(() => null)
  if (
    !body ||
    typeof body.repoFullName !== "string" ||
    typeof body.skillPath !== "string" ||
    typeof body.enabled !== "boolean"
  ) {
    return NextResponse.json(
      { error: "Invalid body: expected { repoFullName, skillPath, enabled }" },
      { status: 400 }
    )
  }

  const { repoFullName, skillPath, enabled } = body as {
    repoFullName: string
    skillPath: string
    enabled: boolean
  }

  // Validate skillPath is within allowed directories
  const resolved = path.resolve(skillPath)
  const isInClaude = CLAUDE_SKILLS_DIR
    ? resolved.startsWith(path.resolve(CLAUDE_SKILLS_DIR) + path.sep)
    : false
  const workspacePath = path.join(WORKSPACE_BASE, repoFullName)
  const repoSkillsDir = path.join(workspacePath, ".claude", "skills")
  const isInRepo = resolved.startsWith(path.resolve(repoSkillsDir) + path.sep)

  if (!isInClaude && !isInRepo) {
    return NextResponse.json({ error: "Path traversal detected" }, { status: 400 })
  }

  // Verify repo exists
  const [owner, name] = repoFullName.split("/")
  if (!owner || !name) {
    return NextResponse.json({ error: "Invalid repoFullName" }, { status: 400 })
  }
  const repo = await db.repo.findFirst({ where: { owner, name } })
  if (!repo) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 })
  }

  const key = `skills:${repoFullName}`
  let current: string[] = []
  try {
    current = (await getSettingJson<string[]>(key)) ?? []
  } catch {
    // ok
  }

  if (enabled) {
    if (!current.includes(skillPath)) {
      current = [...current, skillPath]
    }
  } else {
    current = current.filter((p) => p !== skillPath)
  }

  await setSettingJson(key, current)

  return NextResponse.json({ ok: true, enabledPaths: current })
}
