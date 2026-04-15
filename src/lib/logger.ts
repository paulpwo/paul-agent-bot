/**
 * Lightweight structured logger.
 *
 * Behaviour:
 *  - Always writes to stdout/stderr.
 *  - When LOG_FILE=1|true, ALSO appends to logs/worker-YYYY-MM-DD.log.
 *  - On init, prunes log files older than LOG_MAX_DAYS days (default 7).
 *  - Filters by LOG_LEVEL (debug|info|warn|error, default: info).
 *
 * Usage:
 *   import { createLogger } from "@/lib/logger"
 *   const logger = createLogger("my-module")
 *   logger.info("hello", { extra: "data" })
 */

import fs from "fs"
import path from "path"

// ── Config ──────────────────────────────────────────────────────────────────

const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 } as const
type Level = keyof typeof LEVEL_ORDER

function resolveLevel(): Level {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase()
  if (raw in LEVEL_ORDER) return raw as Level
  return "info"
}

function isFileLoggingEnabled(): boolean {
  const val = (process.env.LOG_FILE ?? "").toLowerCase()
  return val === "1" || val === "true"
}

function maxDays(): number {
  const v = parseInt(process.env.LOG_MAX_DAYS ?? "7", 10)
  return Number.isFinite(v) && v > 0 ? v : 7
}

// ── Log directory & pruning ──────────────────────────────────────────────────

// Resolve relative to cwd so it lands next to package.json regardless of
// where the file lives inside src/.
const LOGS_DIR = path.resolve(process.cwd(), "logs")

let pruned = false

function ensureLogDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true })
  }
}

function pruneOldLogs(): void {
  if (pruned) return
  pruned = true
  try {
    ensureLogDir()
    const cutoff = Date.now() - maxDays() * 24 * 60 * 60 * 1000
    for (const file of fs.readdirSync(LOGS_DIR)) {
      if (!file.endsWith(".log")) continue
      const full = path.join(LOGS_DIR, file)
      try {
        const stat = fs.statSync(full)
        if (stat.mtimeMs < cutoff) fs.unlinkSync(full)
      } catch {
        // best-effort
      }
    }
  } catch {
    // non-fatal — don't crash the process if logs/ is unwritable
  }
}

function todayLogPath(): string {
  const d = new Date()
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return path.join(LOGS_DIR, `worker-${date}.log`)
}

function writeToFile(line: string): void {
  try {
    ensureLogDir()
    fs.appendFileSync(todayLogPath(), line + "\n", "utf8")
  } catch {
    // best-effort — never let file I/O crash the worker
  }
}

// ── Core emit ────────────────────────────────────────────────────────────────

const activeLevel = resolveLevel()
const fileLogging = isFileLoggingEnabled()

if (fileLogging) {
  pruneOldLogs()
}

function emit(level: Level, context: string, msg: string, args: unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[activeLevel]) return

  const ts = new Date().toISOString()
  const levelStr = level.toUpperCase().padEnd(5)

  // Build the extra-args suffix (skip if empty)
  let suffix = ""
  if (args.length > 0) {
    try {
      suffix =
        " " +
        args
          .map((a) =>
            a instanceof Error
              ? a.stack ?? a.message
              : typeof a === "object"
              ? JSON.stringify(a)
              : String(a)
          )
          .join(" ")
    } catch {
      suffix = " [unserializable args]"
    }
  }

  const line = `[${ts}] [${levelStr}] [${context}] ${msg}${suffix}`

  // Console output (always)
  if (level === "error") {
    console.error(line)
  } else if (level === "warn") {
    console.warn(line)
  } else {
    console.log(line)
  }

  // File output (when enabled)
  if (fileLogging) {
    writeToFile(line)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface Logger {
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}

export function createLogger(context: string): Logger {
  return {
    debug: (msg, ...args) => emit("debug", context, msg, args),
    info:  (msg, ...args) => emit("info",  context, msg, args),
    warn:  (msg, ...args) => emit("warn",  context, msg, args),
    error: (msg, ...args) => emit("error", context, msg, args),
  }
}

// Default logger for one-off use
export const logger = createLogger("app")
