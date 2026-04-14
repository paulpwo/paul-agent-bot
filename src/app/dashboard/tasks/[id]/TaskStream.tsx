"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

interface StreamLine {
  type: "text" | "tool" | "error"
  content: string
}

interface Props {
  taskId: string
  initialStatus: string
}

export default function TaskStream({ taskId, initialStatus }: Props) {
  const router = useRouter()
  const [lines, setLines] = useState<StreamLine[]>([])
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [status, setStatus] = useState(initialStatus)
  const [cancelling, setCancelling] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const isTerminal = status === "COMPLETED" || status === "FAILED" || status === "CANCELLED"

  useEffect(() => {
    if (isTerminal) return

    const es = new EventSource(`/api/tasks/${taskId}/stream`)

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as {
          type: string
          text?: string
          tool?: string
          input?: unknown
          message?: string
        }

        if (event.type === "token" && event.text) {
          setActiveTool(null)
          setLines((prev) => {
            // Append text to the last text line if possible, otherwise add new
            const last = prev[prev.length - 1]
            if (last?.type === "text") {
              return [...prev.slice(0, -1), { type: "text", content: last.content + event.text! }]
            }
            return [...prev, { type: "text", content: event.text! }]
          })
        } else if (event.type === "tool_use" && event.tool) {
          setActiveTool(event.tool)
          setLines((prev) => [...prev, { type: "tool", content: event.tool! }])
        } else if (event.type === "done") {
          setActiveTool(null)
          setStatus("COMPLETED")
          es.close()
        } else if (event.type === "error") {
          setActiveTool(null)
          setStatus("FAILED")
          setLines((prev) => [...prev, { type: "error", content: event.message ?? "Unknown error" }])
          es.close()
        }
      } catch { /* ignore */ }
    }

    return () => es.close()
  }, [taskId, isTerminal])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [lines])

  async function handleCancel() {
    setCancelling(true)
    try {
      await fetch(`/api/tasks/${taskId}/cancel`, { method: "POST" })
      setStatus("CANCELLED")
    } catch { /* ignore */ }
    setCancelling(false)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Active tool indicator */}
      {activeTool && (
        <div className="flex items-center gap-2 text-xs text-amber-400">
          <span className="animate-pulse">●</span>
          <span className="font-mono">{activeTool}</span>
        </div>
      )}

      {/* Output box */}
      <div className="rounded-lg bg-surface-raised border border-border-default p-4 font-mono text-sm min-h-48 max-h-[70vh] overflow-auto">
        {lines.length === 0 && !isTerminal && (
          <span className="text-text-muted animate-pulse">Waiting for output...</span>
        )}
        {lines.map((line, i) => {
          if (line.type === "tool") {
            return (
              <div key={i} className="text-xs text-amber-500/70 py-0.5">
                🔧 {line.content}
              </div>
            )
          }
          if (line.type === "error") {
            return (
              <div key={i} className="text-red-400 whitespace-pre-wrap mt-1">
                {line.content}
              </div>
            )
          }
          return (
            <span key={i} className="text-text-primary whitespace-pre-wrap">
              {line.content}
            </span>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-3">
        {isTerminal && (
          <button
            onClick={() => router.refresh()}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            View result →
          </button>
        )}
        {status === "RUNNING" && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
          >
            {cancelling ? "Cancelling..." : "Cancel task"}
          </button>
        )}
      </div>
    </div>
  )
}
