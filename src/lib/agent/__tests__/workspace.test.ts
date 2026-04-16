import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock execFile to simulate branch collision
const execMock = vi.fn()
vi.mock("child_process", () => ({ execFile: execMock }))
vi.mock("util", () => ({ promisify: (fn: unknown) => fn }))
vi.mock("@/lib/db/client", () => ({ db: { repo: { updateMany: vi.fn() } } }))
vi.mock("fs", () => ({ existsSync: vi.fn() }))

beforeEach(() => {
  execMock.mockReset()
})

describe("branch collision handling", () => {
  it("appends -2 suffix on first collision", async () => {
    // First call (paulagentbot/42) fails, second (paulagentbot/42-2) succeeds
    execMock
      .mockRejectedValueOnce(new Error("branch already exists"))
      .mockResolvedValueOnce(undefined)

    const { createTaskBranch } = await import("@/lib/agent/workspace")
    const branch = await createTaskBranch("/workspace", "paulagentbot/42")
    expect(branch).toBe("paulagentbot/42-2")
  })

  it("appends -3 suffix on second collision", async () => {
    execMock
      .mockRejectedValueOnce(new Error("exists"))
      .mockRejectedValueOnce(new Error("exists"))
      .mockResolvedValueOnce(undefined)

    // Re-import to reset module state
    vi.resetModules()
    const { createTaskBranch } = await import("@/lib/agent/workspace")
    const branch = await createTaskBranch("/workspace", "paulagentbot/42")
    expect(branch).toBe("paulagentbot/42-3")
  })
})

describe("getWorkspacePath", () => {
  it("throws on invalid repo format (no slash)", async () => {
    vi.resetModules()
    const { getWorkspacePath } = await import("@/lib/agent/workspace")
    expect(() => getWorkspacePath("invalid")).toThrow("Invalid repo format")
  })

  it("returns correct path for valid repo", async () => {
    vi.resetModules()
    const { getWorkspacePath } = await import("@/lib/agent/workspace")
    const p = getWorkspacePath("owner/repo")
    expect(p).toContain("owner/repo")
  })
})

describe("ensureWorkspace", () => {
  it("clones repo when workspace does not exist", async () => {
    const { existsSync } = await import("fs")
    vi.mocked(existsSync).mockReturnValue(false)
    execMock.mockResolvedValue({ stdout: "", stderr: "" })

    vi.resetModules()
    const { ensureWorkspace } = await import("@/lib/agent/workspace")
    const result = await ensureWorkspace({
      repo: "owner/repo",
      cloneUrl: "https://x-access-token:token@github.com/owner/repo.git",
    })
    expect(result).toContain("owner/repo")
    // git clone should have been called
    expect(execMock).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["clone"]),
      expect.any(Object)
    )
  })

  it("throws on non-https clone URL", async () => {
    const { existsSync } = await import("fs")
    vi.mocked(existsSync).mockReturnValue(false)
    vi.resetModules()
    const { ensureWorkspace } = await import("@/lib/agent/workspace")
    await expect(
      ensureWorkspace({ repo: "owner/repo", cloneUrl: "ssh://git@github.com/owner/repo.git" })
    ).rejects.toThrow("Untrusted clone URL")
  })

  it("pulls when workspace already exists", async () => {
    const { existsSync } = await import("fs")
    vi.mocked(existsSync).mockReturnValue(true)
    execMock.mockResolvedValue({ stdout: "origin/main\n", stderr: "" })

    vi.resetModules()
    const { ensureWorkspace } = await import("@/lib/agent/workspace")
    await ensureWorkspace({
      repo: "owner/repo",
      cloneUrl: "https://x-access-token:token@github.com/owner/repo.git",
      defaultBranch: "main",
    })
    expect(execMock).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["pull"]),
      expect.any(Object)
    )
  })
})

describe("checkoutDefault", () => {
  it("runs git checkout with given branch", async () => {
    execMock.mockResolvedValue({ stdout: "", stderr: "" })
    vi.resetModules()
    const { checkoutDefault } = await import("@/lib/agent/workspace")
    await checkoutDefault("/workspace/owner/repo", "main")
    expect(execMock).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["checkout", "main"]),
      expect.any(Object)
    )
  })
})
