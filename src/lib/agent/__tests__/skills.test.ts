import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"

// Set env vars before module is imported so the module-level constants capture them
beforeAll(() => {
  process.env.HOME = "/testhome"
  process.env.SKILLS_DIR = "/test/skills"
})

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}))

// Import after mocks are registered — dynamic so env vars are set first
// We use a module-level import but the vi.mock hoisting ensures fs is mocked before skills.ts runs.
// However, the module-level constants (GLOBAL_SKILLS_DIR, CLAUDE_HOME) are captured at import time.
// We therefore import inside tests that need them via resetModules, or import once at top.
// Strategy: import once at top with env pre-set (beforeAll runs before describe but after vi.mock hoisting).
// Actually, vi.mock is hoisted to top of file — beforeAll does NOT run before the first import.
// So we use dynamic imports inside each test after vi.resetModules().

import * as fs from "fs"

describe("loadSkills", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("returns empty string when no directories exist", async () => {
    vi.resetModules()
    process.env.HOME = "/testhome"
    process.env.SKILLS_DIR = "/test/skills"

    vi.mocked(fs.existsSync).mockReturnValue(false)

    const { loadSkills } = await import("@/lib/agent/skills")
    const result = loadSkills("/workspace")
    expect(result).toBe("")
  })

  it("includes content from both .md files in SKILLS_DIR", async () => {
    vi.resetModules()
    process.env.HOME = "/testhome"
    process.env.SKILLS_DIR = "/test/skills"

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === "/test/skills"
    })
    vi.mocked(fs.readdirSync).mockImplementation((p) => {
      if (p === "/test/skills") return ["alpha.md", "beta.md"] as unknown as ReturnType<typeof fs.readdirSync>
      return [] as unknown as ReturnType<typeof fs.readdirSync>
    })
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p).endsWith("alpha.md")) return "Alpha content"
      if (String(p).endsWith("beta.md")) return "Beta content"
      return ""
    })

    const { loadSkills } = await import("@/lib/agent/skills")
    const result = loadSkills("/workspace")
    expect(result).toContain("Alpha content")
    expect(result).toContain("Beta content")
  })

  it("includes CLAUDE.md content when it exists in workspace", async () => {
    vi.resetModules()
    process.env.HOME = "/testhome"
    process.env.SKILLS_DIR = "/test/skills"

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p) === "/workspace/CLAUDE.md"
    })
    vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>)
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p) === "/workspace/CLAUDE.md") return "Workspace CLAUDE content"
      return ""
    })

    const { loadSkills } = await import("@/lib/agent/skills")
    const result = loadSkills("/workspace")
    expect(result).toContain("Workspace CLAUDE content")
  })

  it("skips non-.md files in skills directories", async () => {
    vi.resetModules()
    process.env.HOME = "/testhome"
    process.env.SKILLS_DIR = "/test/skills"

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === "/test/skills"
    })
    vi.mocked(fs.readdirSync).mockImplementation((p) => {
      if (p === "/test/skills") return ["skill.md", "notes.txt", "config.yaml", "readme.md"] as unknown as ReturnType<typeof fs.readdirSync>
      return [] as unknown as ReturnType<typeof fs.readdirSync>
    })
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const name = String(p)
      if (name.endsWith("skill.md")) return "MD content"
      if (name.endsWith("notes.txt")) return "Text content"
      if (name.endsWith("config.yaml")) return "YAML content"
      if (name.endsWith("readme.md")) return "Readme content"
      return ""
    })

    const { loadSkills } = await import("@/lib/agent/skills")
    const result = loadSkills("/workspace")
    expect(result).toContain("MD content")
    expect(result).toContain("Readme content")
    expect(result).not.toContain("Text content")
    expect(result).not.toContain("YAML content")
  })

  it("does not crash when workspace CLAUDE.md is missing, still returns global skills", async () => {
    vi.resetModules()
    process.env.HOME = "/testhome"
    process.env.SKILLS_DIR = "/test/skills"

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === "/test/skills"
    })
    vi.mocked(fs.readdirSync).mockImplementation((p) => {
      if (p === "/test/skills") return ["tool.md"] as unknown as ReturnType<typeof fs.readdirSync>
      return [] as unknown as ReturnType<typeof fs.readdirSync>
    })
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p).endsWith("tool.md")) return "Global tool skill"
      return ""
    })

    const { loadSkills } = await import("@/lib/agent/skills")
    expect(() => loadSkills("/workspace")).not.toThrow()
    const result = loadSkills("/workspace")
    expect(result).toContain("Global tool skill")
  })

  it("joins multiple sections with \\n\\n---\\n\\n separator", async () => {
    vi.resetModules()
    process.env.HOME = "/testhome"
    process.env.SKILLS_DIR = "/test/skills"

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p)
      return s === "/test/skills" || s === "/workspace/CLAUDE.md"
    })
    vi.mocked(fs.readdirSync).mockImplementation((p) => {
      if (p === "/test/skills") return ["one.md", "two.md"] as unknown as ReturnType<typeof fs.readdirSync>
      return [] as unknown as ReturnType<typeof fs.readdirSync>
    })
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const s = String(p)
      if (s.endsWith("one.md")) return "Section One"
      if (s.endsWith("two.md")) return "Section Two"
      if (s === "/workspace/CLAUDE.md") return "Section Three"
      return ""
    })

    const { loadSkills } = await import("@/lib/agent/skills")
    const result = loadSkills("/workspace")
    expect(result).toBe("Section One\n\n---\n\nSection Two\n\n---\n\nSection Three")
  })

  it("skips a file that throws on readFileSync without crashing", async () => {
    vi.resetModules()
    process.env.HOME = "/testhome"
    process.env.SKILLS_DIR = "/test/skills"

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === "/test/skills"
    })
    vi.mocked(fs.readdirSync).mockImplementation((p) => {
      if (p === "/test/skills") return ["good.md", "bad.md"] as unknown as ReturnType<typeof fs.readdirSync>
      return [] as unknown as ReturnType<typeof fs.readdirSync>
    })
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p).endsWith("bad.md")) throw new Error("Permission denied")
      if (String(p).endsWith("good.md")) return "Good content"
      return ""
    })

    const { loadSkills } = await import("@/lib/agent/skills")
    expect(() => loadSkills("/workspace")).not.toThrow()
    const result = loadSkills("/workspace")
    expect(result).toContain("Good content")
    expect(result).not.toContain("Permission denied")
  })
})
