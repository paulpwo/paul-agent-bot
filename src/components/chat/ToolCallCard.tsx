"use client"

import { useState } from "react"
import type { StreamEvent } from "@/lib/redis/pubsub"

type ToolCallEvent = Extract<StreamEvent, { type: "tool_use" }>

interface ToolCallCardProps {
  toolCall: ToolCallEvent
  isLast?: boolean
  messageStatus?: string
}

// ── helpers ──────────────────────────────────────────────────────────────────

function trunc(s: string, max = 150): string {
  return s.length > max ? s.slice(0, max) + "…" : s
}

function basename(path: string): string {
  return path.split("/").pop() ?? path
}

/** Status dot: pulsing blue while streaming last tool, green check when done */
function StatusDot({ isLast, messageStatus }: { isLast?: boolean; messageStatus?: string }) {
  if (isLast && messageStatus === "streaming") {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0"
        title="Running…"
      />
    )
  }
  return (
    <span className="inline-block text-green-400 text-[10px] shrink-0 leading-none" title="Done">
      ✓
    </span>
  )
}

// ── per-tool renderers ────────────────────────────────────────────────────────

interface EditInput {
  file_path?: string
  old_string?: string
  new_string?: string
}

function EditCard({ input, expanded }: { input: EditInput; expanded: boolean }) {
  const path = input.file_path ?? ""
  const oldStr = trunc(input.old_string ?? "", 150)
  const newStr = trunc(input.new_string ?? "", 150)

  return (
    <>
      <span className="text-text-primary font-mono truncate flex-1 min-w-0">{path}</span>
      {expanded && (
        <div className="px-3 pb-3 pt-2 border-t border-border-subtle/50 space-y-1 font-mono text-[11px] leading-relaxed">
          {oldStr && (
            <div className="rounded bg-red-950/40 border border-red-800/30 px-2 py-1.5">
              <span className="text-red-400 select-none">- </span>
              <span className="text-red-300 whitespace-pre-wrap break-all">{oldStr}</span>
            </div>
          )}
          {newStr && (
            <div className="rounded bg-green-950/40 border border-green-800/30 px-2 py-1.5">
              <span className="text-green-400 select-none">+ </span>
              <span className="text-green-300 whitespace-pre-wrap break-all">{newStr}</span>
            </div>
          )}
        </div>
      )}
    </>
  )
}

interface WriteInput {
  file_path?: string
  content?: string
}

function WriteCard({ input, expanded }: { input: WriteInput; expanded: boolean }) {
  const path = input.file_path ?? ""
  const lines = (input.content ?? "").split("\n").slice(0, 3)
  const hasMore = (input.content ?? "").split("\n").length > 3

  return (
    <>
      <span className="text-text-primary font-mono truncate flex-1 min-w-0">{path}</span>
      {expanded && (
        <div className="px-3 pb-3 pt-2 border-t border-border-subtle/50 font-mono text-[11px] leading-relaxed">
          <div className="rounded bg-surface-overlay/60 border border-border-subtle/40 px-2 py-1.5 text-text-primary whitespace-pre-wrap break-all">
            {lines.join("\n")}
            {hasMore && <span className="text-text-muted">{"\n…"}</span>}
          </div>
        </div>
      )}
    </>
  )
}

interface BashInput {
  command?: string
  restart?: boolean
}

function BashCard({ input, expanded }: { input: BashInput; expanded: boolean }) {
  const cmd = input.restart ? "(restart sandbox)" : (input.command ?? "")
  const preview = trunc(cmd, 80)

  return (
    <>
      <span className="text-text-secondary font-mono truncate flex-1 min-w-0 text-[11px]">
        $ {preview}
      </span>
      {expanded && cmd !== preview && (
        <div className="px-3 pb-3 pt-2 border-t border-border-subtle/50 font-mono text-[11px]">
          <div className="rounded bg-surface-overlay/60 border border-border-subtle/40 px-2 py-1.5 text-text-primary whitespace-pre-wrap break-all">
            $ {cmd}
          </div>
        </div>
      )}
    </>
  )
}

interface ReadInput {
  file_path?: string
}

function ReadCard({ input }: { input: ReadInput }) {
  return (
    <span className="text-text-secondary font-mono truncate flex-1 min-w-0">{input.file_path ?? ""}</span>
  )
}

interface SearchInput {
  query?: string
}

function SearchCard({ input }: { input: SearchInput }) {
  return (
    <span className="text-text-secondary italic truncate flex-1 min-w-0">
      &ldquo;{trunc(input.query ?? "", 80)}&rdquo;
    </span>
  )
}

// ── meta per tool ─────────────────────────────────────────────────────────────

interface ToolMeta {
  icon: string
  label: string
  expandable: boolean
}

function getToolMeta(tool: string): ToolMeta {
  const t = tool.toLowerCase()
  if (t === "edit" || t === "str_replace_editor") return { icon: "✏️", label: "Edit", expandable: true }
  if (t === "write" || t === "create_file") return { icon: "📝", label: "Write", expandable: true }
  if (t === "bash" || t === "computer" || t === "execute_command") return { icon: "⚡", label: "Bash", expandable: true }
  if (t === "read" || t === "read_file" || t === "view") return { icon: "📖", label: "Read", expandable: false }
  if (t === "websearch" || t === "web_search" || t === "search") return { icon: "🔍", label: "Search", expandable: false }
  if (t === "glob" || t === "find_files") return { icon: "🗂️", label: "Glob", expandable: false }
  if (t === "grep") return { icon: "🔎", label: "Grep", expandable: false }
  return { icon: "🔧", label: tool, expandable: true }
}

// ── main component ────────────────────────────────────────────────────────────

export function ToolCallCard({ toolCall, isLast, messageStatus }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const meta = getToolMeta(toolCall.tool)
  const inp = (toolCall.input ?? {}) as Record<string, unknown>

  const tool = toolCall.tool.toLowerCase()
  const isEdit = tool === "edit" || tool === "str_replace_editor"
  const isWrite = tool === "write" || tool === "create_file"
  const isBash = tool === "bash" || tool === "computer" || tool === "execute_command"
  const isRead = tool === "read" || tool === "read_file" || tool === "view"
  const isSearch = tool === "websearch" || tool === "web_search" || tool === "search"

  // For non-expandable tools, clicking does nothing
  const handleClick = () => {
    if (meta.expandable) setExpanded((e) => !e)
  }

  return (
    <div className="my-1 rounded-lg glass-card text-xs overflow-hidden">
      {/* Header row */}
      <button
        onClick={handleClick}
        disabled={!meta.expandable}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
          meta.expandable ? "hover:bg-surface-overlay/25 cursor-pointer" : "cursor-default"
        }`}
      >
        {/* Status dot */}
        <StatusDot isLast={isLast} messageStatus={messageStatus} />

        {/* Icon + label */}
        <span className="text-[11px]">{meta.icon}</span>
        <span className="text-text-muted font-medium shrink-0">{meta.label}</span>

        {/* Tool-specific inline content */}
        {isEdit && (
          <EditCard
            input={inp as EditInput}
            expanded={false /* handled below */}
          />
        )}
        {isWrite && <WriteCard input={inp as WriteInput} expanded={false} />}
        {isBash && <BashCard input={inp as BashInput} expanded={false} />}
        {isRead && <ReadCard input={inp as ReadInput} />}
        {isSearch && <SearchCard input={inp as SearchInput} />}
        {!isEdit && !isWrite && !isBash && !isRead && !isSearch && (
          <span className="text-text-muted truncate flex-1 min-w-0">
            {Object.values(inp)[0]?.toString().slice(0, 60) ?? ""}
          </span>
        )}

        {/* Expand chevron */}
        {meta.expandable && (
          <span className="text-text-muted ml-auto shrink-0 text-[10px]">
            {expanded ? "▴" : "▾"}
          </span>
        )}
      </button>

      {/* Expanded body — rendered outside the button */}
      {expanded && (
        <>
          {isEdit && <EditCard input={inp as EditInput} expanded={true} />}
          {isWrite && <WriteCard input={inp as WriteInput} expanded={true} />}
          {isBash && <BashCard input={inp as BashInput} expanded={true} />}
          {!isEdit && !isWrite && !isBash && (
            <div className="px-3 pb-3 pt-1 border-t border-border-subtle/50 font-mono text-text-secondary">
              <pre className="whitespace-pre-wrap break-all">
                {JSON.stringify(toolCall.input, null, 2).slice(0, 600)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── file change summary helpers (exported for MessageBubble) ──────────────────

export function extractChangedFiles(toolCalls: ToolCallEvent[]): string[] {
  const files: string[] = []
  for (const tc of toolCalls) {
    const t = tc.tool.toLowerCase()
    if (t === "edit" || t === "str_replace_editor" || t === "write" || t === "create_file") {
      const inp = (tc.input ?? {}) as Record<string, unknown>
      const fp = inp["file_path"]
      if (typeof fp === "string" && fp) {
        const name = basename(fp)
        if (!files.includes(name)) files.push(name)
      }
    }
  }
  return files
}
