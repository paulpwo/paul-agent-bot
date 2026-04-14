"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

interface Props {
  taskId: string
  initialStatus: string
}

export default function TaskStream({ taskId, initialStatus }: Props) {
  const router = useRouter()
  const [lines, setLines] = useState<string[]>([])
  const [status, setStatus] = useState(initialStatus)
  const [cancelling, setCancelling] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const isTerminal = status === "COMPLETED" || status === "FAILED" || status === "CANCELLED"

  useEffect(() => {
    if (isTerminal) return

    const es = new EventSource(`/api/tasks/${taskId}/stream`)

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as { type: string; text?: string; message?: string }
        if (event.type === "token" && event.text) {
          setLines((prev) => [...prev, event.text!])
        } else if (event.type === "done") {
          setStatus("COMPLETED")
          es.close()
        } else if (event.type === "error") {
          setStatus("FAILED")
          setLines((prev) => [...prev, `\nError: ${event.message ?? "unknown"}`])
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
      {/* Output box */}
      <div className="rounded-lg bg-surface-raised border border-border-default p-4 font-mono text-sm text-text-primary min-h-48 max-h-[60vh] overflow-auto whitespace-pre-wrap">
        {lines.length === 0 && !isTerminal && (
          <span className="text-text-muted animate-pulse">Waiting for output...</span>
        )}
        {lines.join("")}
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
