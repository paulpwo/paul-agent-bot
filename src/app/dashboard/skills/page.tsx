import { requireAuth } from "@/lib/auth/session"
import { db } from "@/lib/db/client"
import { getSettingJson } from "@/lib/settings"
import { readdirSync, statSync, readFileSync, existsSync } from "fs"
import path from "path"
import { SkillsEditor, type SkillFile, type Repo } from "@/components/skills/SkillsEditor"

const CLAUDE_SKILLS_DIR = process.env.HOME
  ? path.join(process.env.HOME, ".claude", "skills")
  : null

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
        const rel = path.relative(base, full)
        const name = rel.replace(/\.md$/, "")
        results.push({ name, path: full, size: stat.size, preview })
      } catch {
        // skip
      }
    }
  }
  return results
}

export default async function SkillsPage() {
  await requireAuth()

  const dbRepos = await db.repo.findMany({
    orderBy: [{ owner: "asc" }, { name: "asc" }],
    select: { id: true, owner: true, name: true, fullName: true },
  })

  const repos: Repo[] = dbRepos

  // Load global skills
  const skills: SkillFile[] = CLAUDE_SKILLS_DIR
    ? findMdFiles(CLAUDE_SKILLS_DIR, CLAUDE_SKILLS_DIR)
    : []

  // If there's only one repo, pre-select it and load its skills
  let preEnabledPaths: string[] = []
  let preSelectedRepo: string | null = null
  if (repos.length === 1) {
    preSelectedRepo = repos[0].fullName
    try {
      preEnabledPaths =
        (await getSettingJson<string[]>(`skills:${preSelectedRepo}`)) ?? []
    } catch {
      // ok
    }
  }

  return (
    <SkillsEditor
      repos={repos}
      initialSkills={skills}
      initialEnabledPaths={preEnabledPaths}
      initialRepo={preSelectedRepo}
    />
  )
}
