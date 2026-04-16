import { describe, it, expect } from "vitest"
import { classifyTask, resolveModel } from "@/lib/agent/model-router"

describe("classifyTask", () => {
  it("classifies 'refactor this function' as complex", () => {
    expect(classifyTask("refactor this function")).toBe("complex")
  })

  it("classifies 'explain how auth works' as complex", () => {
    expect(classifyTask("explain how auth works")).toBe("complex")
  })

  it("classifies 'review the PR' as complex", () => {
    expect(classifyTask("review the PR")).toBe("complex")
  })

  it("classifies 'what is the status' as simple", () => {
    expect(classifyTask("what is the status")).toBe("simple")
  })

  it("classifies 'list all repos' as simple", () => {
    expect(classifyTask("list all repos")).toBe("simple")
  })

  it("classifies 'show me open tasks' as simple", () => {
    expect(classifyTask("show me open tasks")).toBe("simple")
  })

  it("classifies 'add a login button' as coding (default)", () => {
    expect(classifyTask("add a login button")).toBe("coding")
  })

  it("classifies 'fix the bug in auth' as coding (default)", () => {
    expect(classifyTask("fix the bug in auth")).toBe("coding")
  })

  it("is case insensitive — 'REFACTOR' → complex", () => {
    expect(classifyTask("REFACTOR")).toBe("complex")
  })
})

describe("resolveModel", () => {
  it("returns sonnet (coding default) when no hint is provided", () => {
    expect(resolveModel()).toBe("claude-sonnet-4-6")
  })

  it("returns opus for 'complex'", () => {
    expect(resolveModel("complex")).toBe("claude-opus-4-6")
  })

  it("returns sonnet for 'coding'", () => {
    expect(resolveModel("coding")).toBe("claude-sonnet-4-6")
  })

  it("returns haiku for 'simple'", () => {
    expect(resolveModel("simple")).toBe("claude-haiku-4-5-20251001")
  })
})
