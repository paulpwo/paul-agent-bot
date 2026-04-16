import { describe, it, expect, beforeEach, afterEach } from "vitest"

const VALID_KEY = "a".repeat(64) // 32 bytes as hex

describe("crypto — encrypt / decrypt", () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = VALID_KEY
  })

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ENCRYPTION_KEY
    } else {
      process.env.ENCRYPTION_KEY = originalKey
    }
  })

  it("roundtrip: encrypt then decrypt returns original plaintext", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto")
    const plaintext = "hello, world"
    expect(decrypt(encrypt(plaintext))).toBe(plaintext)
  })

  it("same plaintext encrypted twice gives different ciphertext (random IV)", async () => {
    const { encrypt } = await import("@/lib/crypto")
    const plaintext = "same input"
    const first = encrypt(plaintext)
    const second = encrypt(plaintext)
    expect(first).not.toBe(second)
  })

  it("tampering the ciphertext causes decrypt to throw", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto")
    const encoded = encrypt("sensitive data")
    const buf = Buffer.from(encoded, "base64")
    // Flip the last byte of the buffer
    buf[buf.length - 1] ^= 0xff
    const tampered = buf.toString("base64")
    expect(() => decrypt(tampered)).toThrow()
  })

  it("encrypt throws when ENCRYPTION_KEY env var is missing", async () => {
    delete process.env.ENCRYPTION_KEY
    const { encrypt } = await import("@/lib/crypto")
    expect(() => encrypt("data")).toThrow("ENCRYPTION_KEY env var is not set")
  })

  it("encrypt throws when key has wrong length", async () => {
    // 62-char hex string → 31 bytes (not 32)
    process.env.ENCRYPTION_KEY = "a".repeat(62)
    const { encrypt } = await import("@/lib/crypto")
    expect(() => encrypt("data")).toThrow("ENCRYPTION_KEY must be 32 bytes")
  })

  it("roundtrip works for empty string plaintext", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto")
    expect(decrypt(encrypt(""))).toBe("")
  })

  it("roundtrip works for multi-line and unicode plaintext", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto")
    const multiline = "line one\nline two\nline three"
    const unicode = "こんにちは 🌍 héllo"
    expect(decrypt(encrypt(multiline))).toBe(multiline)
    expect(decrypt(encrypt(unicode))).toBe(unicode)
  })
})
