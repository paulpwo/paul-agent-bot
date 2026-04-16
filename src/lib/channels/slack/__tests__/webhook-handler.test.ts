import { describe, it, expect, vi } from "vitest"

// Mock all side-effectful dependencies before importing the module under test
vi.mock("@slack/web-api", () => ({ WebClient: vi.fn() }))
vi.mock("@/lib/db/client", () => ({ db: {} }))
vi.mock("@/lib/redis/client", () => ({ redis: {} }))
vi.mock("@/lib/queue/producer", () => ({ enqueueTask: vi.fn() }))
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(), SETTINGS_KEYS: {} }))
vi.mock("@/app/api/webhooks/slack/route", () => ({}))

import { extractCommand } from "@/lib/channels/slack/webhook-handler"

describe("extractCommand", () => {
  it("parses /paulagentbot repo owner/name", () => {
    expect(extractCommand("/paulagentbot repo owner/name")).toEqual({
      command: "repo",
      arg: "owner/name",
    })
  })

  it("parses /paulagentbot status (no arg)", () => {
    expect(extractCommand("/paulagentbot status")).toEqual({
      command: "status",
      arg: undefined,
    })
  })

  it("parses /paulagentbot new (no arg)", () => {
    expect(extractCommand("/paulagentbot new")).toEqual({
      command: "new",
      arg: undefined,
    })
  })

  it("parses bare 'repo owner/name' without slash prefix", () => {
    expect(extractCommand("repo owner/name")).toEqual({
      command: "repo",
      arg: "owner/name",
    })
  })

  it("parses bot mention '<@U123ABC> repo owner/name'", () => {
    expect(extractCommand("<@U123ABC> repo owner/name")).toEqual({
      command: "repo",
      arg: "owner/name",
    })
  })

  it("parses unrecognized free text 'hello world' as command+arg", () => {
    // The regex matches any leading \w+ as command and the rest as arg
    expect(extractCommand("hello world")).toEqual({
      command: "hello",
      arg: "world",
    })
  })

  it("returns null for empty string", () => {
    expect(extractCommand("")).toBeNull()
  })

  it("returns null for just a bot mention with nothing else", () => {
    expect(extractCommand("<@U123ABC>")).toBeNull()
  })

  it("returns null for /paulagentbot with no command", () => {
    expect(extractCommand("/paulagentbot")).toBeNull()
  })
})
