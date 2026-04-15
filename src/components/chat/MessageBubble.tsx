"use client"

import { Highlight, themes } from "prism-react-renderer"
import type { StreamEvent } from "@/lib/redis/pubsub"
import { ToolCallCard, extractChangedFiles } from "./ToolCallCard"

type ToolCallEvent = Extract<StreamEvent, { type: "tool_use" }>
type ApprovalEvent = Extract<StreamEvent, { type: "approval_needed" }>

export interface Message {
  id: string
  role: "user" | "agent"
  content: string
  status: "pending" | "streaming" | "done" | "error" | "cancelled"
  toolCalls: ToolCallEvent[]
  approvalRequest?: ApprovalEvent
}

interface MessageBubbleProps {
  message: Message
  onApprove?: (taskId: string, approvalId: string, approved: boolean) => void
}

// ── Lightweight markdown renderer (no deps) ──────────────────────────────────

/** Parses inline tokens: **bold**, *italic*, `code` */
function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const regex = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let idx = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`${keyPrefix}-t${idx++}`}>{text.slice(lastIndex, match.index)}</span>)
    }
    const token = match[0]
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <strong key={`${keyPrefix}-b${idx++}`} className="font-semibold text-text-primary">
          {token.slice(2, -2)}
        </strong>
      )
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code key={`${keyPrefix}-c${idx++}`} className="font-mono text-[12px] bg-surface-overlay text-amber-300 px-1 py-0.5 rounded mx-0.5">
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(
        <em key={`${keyPrefix}-i${idx++}`} className="italic text-text-primary">
          {token.slice(1, -1)}
        </em>
      )
    } else {
      parts.push(<span key={`${keyPrefix}-x${idx++}`}>{token}</span>)
    }
    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`${keyPrefix}-end`}>{text.slice(lastIndex)}</span>)
  }

  return parts.length > 0 ? parts : [<span key={`${keyPrefix}-raw`}>{text}</span>]
}

/** Map language aliases and unsupported langs to Prism equivalents */
function normalizeLang(lang: string): string {
  const map: Record<string, string> = {
    // Aliases
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    sh: "bash", shell: "bash", zsh: "bash",
    py: "python", rb: "ruby", rs: "rust",
    yml: "yaml", md: "markdown",
    // No-Prism langs → closest equivalent
    astro: "markup",   // astro = HTML superset
    vue: "markup",
    svelte: "markup",
    prisma: "typescript",
    graphql: "graphql",
  }
  return map[lang.toLowerCase()] ?? (lang.toLowerCase() || "markup")
}

/** Parses block-level markdown: headings, lists, code blocks, hr, paragraphs */
function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n")
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const key = `md-${i}`

    // Fenced code block
    if (line.startsWith("```")) {
      const rawLang = line.slice(3).trim()
      const lang = normalizeLang(rawLang)
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i])
        i++
      }
      const code = codeLines.join("\n")
      elements.push(
        <div key={key} className="my-2.5 rounded-lg overflow-hidden border border-border-subtle/40">
          {rawLang && (
            <div className="px-3 py-1 bg-surface-overlay/70 border-b border-border-subtle/40 text-[10px] font-mono text-text-muted uppercase tracking-wider">
              {rawLang}
            </div>
          )}
          <Highlight theme={themes.vsDark} code={code} language={lang}>
            {({ style, tokens, getLineProps, getTokenProps }) => (
              <pre
                className="px-4 py-3 overflow-x-auto text-[12px] font-mono leading-relaxed whitespace-pre"
                style={{ ...style, backgroundColor: "transparent", margin: 0 }}
              >
                {tokens.map((line, lineIdx) => (
                  <div key={lineIdx} {...getLineProps({ line })}>
                    {line.map((token, tokenIdx) => (
                      <span key={tokenIdx} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        </div>
      )
      i++ // skip closing ```
      continue
    }

    // Headings
    if (line.startsWith("### ")) {
      elements.push(
        <p key={key} className="text-sm font-semibold text-text-primary mt-3 mb-0.5">
          {parseInline(line.slice(4), key)}
        </p>
      )
      i++
      continue
    }
    if (line.startsWith("## ")) {
      elements.push(
        <p key={key} className="text-sm font-bold text-text-primary mt-4 mb-1 tracking-tight">
          {parseInline(line.slice(3), key)}
        </p>
      )
      i++
      continue
    }
    if (line.startsWith("# ")) {
      elements.push(
        <p key={key} className="text-base font-bold text-text-primary mt-4 mb-1 tracking-tight">
          {parseInline(line.slice(2), key)}
        </p>
      )
      i++
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      elements.push(<hr key={key} className="border-border-subtle/50 my-3" />)
      i++
      continue
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""))
        i++
      }
      elements.push(
        <ul key={key} className="my-1 space-y-0.5">
          {items.map((item, j) => (
            <li key={j} className="flex items-start gap-2 text-sm text-text-primary">
              <span className="text-text-muted mt-[5px] shrink-0 text-[9px]">▸</span>
              <span className="leading-relaxed">{parseInline(item, `${key}-li${j}`)}</span>
            </li>
          ))}
        </ul>
      )
      continue
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""))
        i++
      }
      elements.push(
        <ol key={key} className="my-1 space-y-0.5">
          {items.map((item, j) => (
            <li key={j} className="flex items-start gap-2 text-sm text-text-primary">
              <span className="text-text-muted shrink-0 tabular-nums text-[11px] min-w-[1.5em] mt-0.5 text-right">
                {j + 1}.
              </span>
              <span className="leading-relaxed">{parseInline(item, `${key}-ol${j}`)}</span>
            </li>
          ))}
        </ol>
      )
      continue
    }

    // Empty line
    if (line.trim() === "") {
      elements.push(<div key={key} className="h-2" />)
      i++
      continue
    }

    // Default: paragraph line
    elements.push(
      <p key={key} className="text-sm text-text-primary leading-relaxed">
        {parseInline(line, key)}
      </p>
    )
    i++
  }

  return <div className="space-y-0.5">{elements}</div>
}

// ── Streaming cursor ──────────────────────────────────────────────────────────

function StreamingCursor() {
  return (
    <span className="inline-block w-[6px] h-4 bg-text-secondary ml-0.5 animate-pulse align-middle rounded-sm" />
  )
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

export function MessageBubble({ message, onApprove }: MessageBubbleProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[75%]">
          <div className="bg-indigo-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </div>
          <p className="text-xs text-text-muted text-right mt-1 pr-1">You</p>
        </div>
      </div>
    )
  }

  // Agent bubble
  const isStreaming = message.status === "streaming"
  const isEmpty = !message.content && message.toolCalls.length === 0 && !message.approvalRequest
  const changedFiles = message.status === "done" ? extractChangedFiles(message.toolCalls) : []

  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[85%] min-w-0">
        <p className="text-xs text-text-muted mb-1.5 ml-1">PaulAgentBot</p>
        <div className="bg-surface-raised border border-border-default rounded-2xl rounded-tl-sm px-4 py-3">
          {/* Tool calls */}
          {message.toolCalls.length > 0 && (
            <div className="mb-3 space-y-1">
              {message.toolCalls.map((tc, i) => (
                <ToolCallCard
                  key={i}
                  toolCall={tc}
                  isLast={i === message.toolCalls.length - 1}
                  messageStatus={message.status}
                />
              ))}
            </div>
          )}

          {/* Content — rendered markdown */}
          {message.content ? (
            <div className={message.status === "error" ? "text-red-400" : undefined}>
              <MarkdownContent content={message.content} />
              {isStreaming && <StreamingCursor />}
            </div>
          ) : isEmpty && isStreaming ? (
            <span className="text-text-muted italic text-xs">
              Thinking… <StreamingCursor />
            </span>
          ) : (
            isStreaming && <StreamingCursor />
          )}

          {/* Error */}
          {message.status === "error" && !message.content && (
            <span className="text-red-400 italic text-xs block mt-1">
              Something went wrong. Please try again.
            </span>
          )}

          {/* File change summary */}
          {changedFiles.length > 0 && (
            <p className="mt-3 text-[11px] text-text-muted border-t border-border-default pt-2.5 font-mono">
              {changedFiles.length} {changedFiles.length === 1 ? "file" : "files"} changed:{" "}
              {changedFiles.join(", ")}
            </p>
          )}

          {/* HITL approval */}
          {message.approvalRequest && (
            <div className="mt-3 border border-amber-700/50 bg-amber-900/20 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-400 mb-1">Permission Request</p>
              <p className="text-xs text-text-primary mb-1">
                The agent wants to run:{" "}
                <code className="font-mono text-amber-300 bg-surface-raised px-1 py-0.5 rounded">
                  {message.approvalRequest.tool}
                </code>
              </p>
              {message.approvalRequest.input != null && (
                <pre className="text-xs font-mono text-text-secondary bg-surface-raised rounded p-2 mb-2 overflow-x-auto max-h-24 whitespace-pre-wrap break-all">
                  {JSON.stringify(message.approvalRequest.input as Record<string, unknown>, null, 2).slice(0, 300)}
                </pre>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() =>
                    onApprove?.(
                      message.approvalRequest!.taskId,
                      message.approvalRequest!.approvalId,
                      true
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white text-xs font-medium transition-colors"
                >
                  ✓ Approve
                </button>
                <button
                  onClick={() =>
                    onApprove?.(
                      message.approvalRequest!.taskId,
                      message.approvalRequest!.approvalId,
                      false
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-800 hover:bg-red-700 text-white text-xs font-medium transition-colors"
                >
                  ✗ Deny
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Status indicator */}
        {message.status === "done" && message.content && (
          <p className="text-[10px] text-text-muted ml-1 mt-1 flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Done
          </p>
        )}
      </div>
    </div>
  )
}
