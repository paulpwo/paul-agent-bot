import { describe, it, expect, vi, beforeAll } from "vitest"

// Set WORKSPACE_BASE before importing
beforeAll(() => {
  process.env.WORKSPACE_BASE = "/data/workspaces"
})

vi.mock("@/lib/redis/client", () => ({
  redis: { get: vi.fn(), set: vi.fn(), publish: vi.fn() },
}))
vi.mock("@/lib/redis/pubsub", () => ({
  publishStream: vi.fn(),
  pollApproval: vi.fn(),
  APPROVAL_KEY: (id: string) => `approval:${id}`,
}))

describe("path isolation guard", () => {
  it("allows paths inside WORKSPACE_BASE", async () => {
    const { checkPathPermission } = await import("@/lib/agent/permissions")
    const result = checkPathPermission("write", { path: "/data/workspaces/paulpwo/portfolio/README.md" })
    expect(result).not.toBe("deny")
  })

  it("denies paths outside WORKSPACE_BASE", async () => {
    const { checkPathPermission } = await import("@/lib/agent/permissions")
    const result = checkPathPermission("write", { path: "/etc/passwd" })
    expect(result).toBe("deny")
  })

  it("denies home directory traversal", async () => {
    const { checkPathPermission } = await import("@/lib/agent/permissions")
    const result = checkPathPermission("read", { file: "/root/.ssh/id_rsa" })
    expect(result).toBe("deny")
  })

  it("allows non-path tool inputs", async () => {
    const { checkPathPermission } = await import("@/lib/agent/permissions")
    const result = checkPathPermission("bash", { command: "git status" })
    expect(result).toBeNull()
  })
})
