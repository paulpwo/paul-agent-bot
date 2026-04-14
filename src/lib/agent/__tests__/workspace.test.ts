import { describe, it, expect, vi } from "vitest"

// Mock execFile to simulate branch collision
const execMock = vi.fn()
vi.mock("child_process", () => ({ execFile: execMock }))
vi.mock("util", () => ({ promisify: (fn: unknown) => fn }))
vi.mock("@/lib/db/client", () => ({ db: { repo: { updateMany: vi.fn() } } }))

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
