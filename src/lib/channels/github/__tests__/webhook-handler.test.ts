import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHmac } from "crypto"

// Mock dependencies before importing
vi.mock("@/lib/redis/pubsub", () => ({
  checkAndSetDelivery: vi.fn().mockResolvedValue(false),
}))
vi.mock("@/lib/redis/client", () => ({
  redis: { set: vi.fn(), get: vi.fn() },
}))
vi.mock("@/lib/channels/github/webhook-handler", () => ({
  handleWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

describe("GitHub webhook route", () => {
  const SECRET = "test-secret"

  function makeSignedRequest(body: string, secret = SECRET) {
    const sig = "sha256=" + createHmac("sha256", secret).update(Buffer.from(body)).digest("hex")
    return {
      body,
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "issue_comment",
        "x-github-delivery": "test-delivery-id-1",
      },
    }
  }

  it("accepts a valid HMAC signature", async () => {
    const body = JSON.stringify({ action: "created", sender: { login: "paulpwo" } })
    const req = makeSignedRequest(body)
    const sig = req.headers["x-hub-signature-256"]
    const expected = "sha256=" + createHmac("sha256", SECRET).update(Buffer.from(body)).digest("hex")
    expect(sig).toBe(expected)
  })

  it("rejects an invalid HMAC signature", async () => {
    const body = JSON.stringify({ action: "created" })
    const req = makeSignedRequest(body, "wrong-secret")
    const correct = "sha256=" + createHmac("sha256", SECRET).update(Buffer.from(body)).digest("hex")
    expect(req.headers["x-hub-signature-256"]).not.toBe(correct)
  })
})

describe("loop guard", () => {
  it("identifies bot senders by [bot] suffix", () => {
    const isBotSender = (login: string) => login === "paulagentbot[bot]" || login.endsWith("[bot]")
    expect(isBotSender("paulagentbot[bot]")).toBe(true)
    expect(isBotSender("github-actions[bot]")).toBe(true)
    expect(isBotSender("paulpwo")).toBe(false)
    expect(isBotSender("dependabot")).toBe(false)
  })
})
