import { describe, it, expect, vi, beforeAll, afterEach } from "vitest"

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

afterEach(() => {
  vi.useRealTimers()
})

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

describe("read-only tool path checks", () => {
  it("denies Read tool on ~/.ssh path", async () => {
    const { checkPathPermission } = await import("@/lib/agent/permissions")
    const result = checkPathPermission("Read", { path: `${process.env.HOME}/.ssh/id_rsa` })
    expect(result).toBe("deny")
  })

  it("allows Read tool on safe workspace path", async () => {
    const { checkPathPermission } = await import("@/lib/agent/permissions")
    const result = checkPathPermission("Read", { path: "/data/workspaces/owner/repo/README.md" })
    expect(result).not.toBe("deny")
  })

  it("denies Grep tool on /etc/shadow", async () => {
    const { checkPathPermission } = await import("@/lib/agent/permissions")
    const result = checkPathPermission("Grep", { path: "/etc/shadow" })
    expect(result).toBe("deny")
  })

  it("denies Glob tool on ~/.aws path", async () => {
    const { checkPathPermission } = await import("@/lib/agent/permissions")
    const result = checkPathPermission("Glob", { path: `${process.env.HOME}/.aws/credentials` })
    expect(result).toBe("deny")
  })

  it("denies LS tool on ~/.claude path", async () => {
    const { checkPathPermission } = await import("@/lib/agent/permissions")
    const result = checkPathPermission("LS", { path: `${process.env.HOME}/.claude` })
    expect(result).toBe("deny")
  })

  it("allows Grep tool on a non-sensitive absolute path", async () => {
    const { checkPathPermission } = await import("@/lib/agent/permissions")
    const result = checkPathPermission("Grep", { path: "/usr/local/lib/node_modules/some-pkg/index.js" })
    expect(result).toBeNull()
  })
})

describe("requestHITLApproval", () => {
  it("returns allow when pollApproval returns approved", async () => {
    vi.useFakeTimers()

    const { publishStream, pollApproval } = await import("@/lib/redis/pubsub")
    vi.mocked(publishStream).mockResolvedValue(undefined)
    vi.mocked(pollApproval).mockResolvedValue("approved")

    const { requestHITLApproval } = await import("@/lib/agent/permissions")

    const resultPromise = requestHITLApproval({
      taskId: "task-1",
      tool: "Edit",
      input: { path: "/data/workspaces/owner/repo/file.ts" },
      channel: "telegram",
    })

    // Advance past the 500ms poll interval so the while loop's setTimeout fires
    await vi.advanceTimersByTimeAsync(500)

    const result = await resultPromise
    expect(result).toBe("allow")
    expect(publishStream).toHaveBeenCalled()
    expect(pollApproval).toHaveBeenCalled()
  })

  it("returns deny when pollApproval returns denied", async () => {
    vi.useFakeTimers()

    const { publishStream, pollApproval } = await import("@/lib/redis/pubsub")
    vi.mocked(publishStream).mockResolvedValue(undefined)
    vi.mocked(pollApproval).mockResolvedValue("denied")

    const { requestHITLApproval } = await import("@/lib/agent/permissions")

    const resultPromise = requestHITLApproval({
      taskId: "task-2",
      tool: "Write",
      input: {},
      channel: "telegram",
    })

    await vi.advanceTimersByTimeAsync(500)

    const result = await resultPromise
    expect(result).toBe("deny")
  })

  it("returns deny on timeout when pollApproval never resolves definitively", async () => {
    vi.useFakeTimers()

    const { publishStream, pollApproval } = await import("@/lib/redis/pubsub")
    vi.mocked(publishStream).mockResolvedValue(undefined)
    // Return null indefinitely — simulate no user response
    vi.mocked(pollApproval).mockResolvedValue(null)

    const { requestHITLApproval } = await import("@/lib/agent/permissions")

    const resultPromise = requestHITLApproval({
      taskId: "task-3",
      tool: "Bash",
      input: { command: "rm -rf /" },
      channel: "telegram",
    })

    // Advance past the full 5-minute timeout
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 500)

    const result = await resultPromise
    expect(result).toBe("deny")
  })
})
