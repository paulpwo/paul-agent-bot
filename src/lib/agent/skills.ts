import { readFileSync, readdirSync, existsSync } from "fs"
import path from "path"

const GLOBAL_SKILLS_DIR = process.env.SKILLS_DIR ?? "/data/skills"
const CLAUDE_HOME = process.env.HOME ? path.join(process.env.HOME, ".claude", "skills") : null

// Load all skills for a given repo workspace path
export function loadSkills(workspacePath: string): string {
  const sections: string[] = []

  // 1. Global skills (~/.claude/skills/ or /data/skills/)
  const globalDirs = [CLAUDE_HOME, GLOBAL_SKILLS_DIR].filter(Boolean) as string[]
  for (const dir of globalDirs) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter(f => f.endsWith(".md")).sort()
    for (const file of files) {
      try {
        const content = readFileSync(path.join(dir, file), "utf8").trim()
        if (content) sections.push(content)
      } catch { /* skip unreadable */ }
    }
  }

  // 2. Repo CLAUDE.md
  const claudeMd = path.join(workspacePath, "CLAUDE.md")
  if (existsSync(claudeMd)) {
    const content = readFileSync(claudeMd, "utf8").trim()
    if (content) sections.push(content)
  }

  // 3. Repo .claude/skills/
  const repoSkillsDir = path.join(workspacePath, ".claude", "skills")
  if (existsSync(repoSkillsDir)) {
    const files = readdirSync(repoSkillsDir).filter(f => f.endsWith(".md")).sort()
    for (const file of files) {
      try {
        const content = readFileSync(path.join(repoSkillsDir, file), "utf8").trim()
        if (content) sections.push(content)
      } catch { /* skip unreadable */ }
    }
  }

  return sections.join("\n\n---\n\n")
}
