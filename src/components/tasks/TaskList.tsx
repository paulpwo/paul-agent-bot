"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import NewTaskForm from "./NewTaskForm"

interface Task {
  id: string
  status: string
  prompt: string
  channel: string
  repo: string
  threadId: string
  createdAt: string
}

interface Repo {
  fullName: string
}

interface Props {
  initialTasks: Task[]
  repos: Repo[]
}

const STATUS_COLORS: Record<string, string> = {
  QUEUED:    "bg-zinc-400 text-white dark:bg-zinc-600 dark:text-zinc-100",
  RUNNING:   "bg-blue-500 text-white dark:bg-blue-600 dark:text-white",
  COMPLETED: "bg-emerald-500 text-white dark:bg-emerald-700 dark:text-emerald-100",
  FAILED:    "bg-red-500 text-white dark:bg-red-700 dark:text-red-100",
  CANCELLED: "bg-zinc-300 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-400",
}

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"])

export default function TaskList({ initialTasks, repos }: Props) {
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [showForm, setShowForm] = useState(false)
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60_000)
    if (mins < 1) return "just now"
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  function setLoading(id: string, on: boolean) {
    setLoadingIds((prev) => {
      const next = new Set(prev)
      on ? next.add(id) : next.delete(id)
      return next
    })
  }

  async function handleCancel(e: React.MouseEvent, taskId: string) {
    e.stopPropagation()
    if (!window.confirm("¿Cancelar esta tarea?")) return
    setLoading(taskId, true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/cancel`, { method: "POST" })
      if (res.ok) {
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: "CANCELLED" } : t))
        )
      }
    } catch { /* ignore */ } finally {
      setLoading(taskId, false)
    }
  }

  async function handleDelete(e: React.MouseEvent, taskId: string) {
    e.stopPropagation()
    if (!window.confirm("¿Eliminar esta tarea?")) return
    setLoading(taskId, true)
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" })
      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
      }
    } catch { /* ignore */ } finally {
      setLoading(taskId, false)
    }
  }

  const hasRunning = tasks.some((t) => t.status === "RUNNING")

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/tasks")
        if (!res.ok) return
        const data = await res.json() as Task[]
        setTasks(data)
      } catch { /* ignore */ }
    }

    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Tasks</h1>
          {hasRunning && (
            <span className="flex items-center gap-1.5 text-xs text-blue-700 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-700 dark:bg-blue-400 animate-pulse" />
              Live
            </span>
          )}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
        >
          {showForm ? "Close" : "New Task"}
        </button>
      </div>

      {/* Inline new task form */}
      {showForm && (
        <NewTaskForm repos={repos} onCancel={() => setShowForm(false)} />
      )}

      {/* Task list */}
      {tasks.length === 0 ? (
        <div className="glass-card rounded-xl p-10 flex flex-col items-center text-center mt-4">
          <p className="text-sm font-medium text-text-secondary">No tasks yet</p>
          <p className="text-xs text-text-muted mt-2 max-w-sm">
            Click <span className="text-text-primary">New Task</span>, mention{" "}
            <span className="text-text-primary font-mono">@paulagentbot</span> in a GitHub issue, or send a
            message in Telegram to queue your first task.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 mt-4">
          {tasks.map((task) => {
            const isLoading = loadingIds.has(task.id)
            const isTerminal = TERMINAL_STATUSES.has(task.status)
            return (
              <div
                key={task.id}
                className="flex items-start gap-3 px-4 py-3.5 rounded-lg glass-card text-left w-full transition-all duration-200 group cursor-pointer"
                onClick={() => router.push(`/dashboard/tasks/${task.id}`)}
              >
                <span
                  className={`text-[11px] px-1.5 py-0.5 rounded font-mono shrink-0 mt-0.5 tabular-nums ${STATUS_COLORS[task.status] ?? "text-text-secondary"}`}
                >
                  {task.status}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate leading-snug">{task.prompt}</p>
                  <p className="text-xs text-text-muted mt-1 flex items-center gap-1.5">
                    <span className="font-mono">{task.channel}</span>
                    <span className="text-text-muted">·</span>
                    <span className="font-mono truncate">{task.repo}#{task.threadId}</span>
                    <span className="text-text-muted">·</span>
                    <span>{relativeTime(task.createdAt)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 mt-0.5" onClick={(e) => e.stopPropagation()}>
                  {task.status === "RUNNING" ? (
                    <span className="flex items-center gap-1.5 text-xs text-blue-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      Live
                    </span>
                  ) : task.status === "QUEUED" ? (
                    /* Cancel — hidden until hover */
                    <button
                      onClick={(e) => handleCancel(e, task.id)}
                      disabled={isLoading}
                      title="Cancelar tarea"
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-text-muted hover:text-amber-400 disabled:opacity-30 px-2 py-1 rounded-md hover:bg-amber-400/10 border border-transparent hover:border-amber-400/20"
                    >
                      {isLoading ? (
                        <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
                          </svg>
                          <span>Cancelar</span>
                        </>
                      )}
                    </button>
                  ) : isTerminal ? (
                    /* Delete — hidden until hover */
                    <button
                      onClick={(e) => handleDelete(e, task.id)}
                      disabled={isLoading}
                      title="Eliminar tarea"
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-text-muted hover:text-red-400 disabled:opacity-30 px-2 py-1 rounded-md hover:bg-red-400/10 border border-transparent hover:border-red-400/20"
                    >
                      {isLoading ? (
                        <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 4 13 4" /><path d="M5 4V3h6v1" /><path d="M4 4l1 9h6l1-9" />
                          </svg>
                          <span>Eliminar</span>
                        </>
                      )}
                    </button>
                  ) : null}
                  {/* Arrow — visible when not hovering, hidden on hover for actionable tasks */}
                  {task.status !== "RUNNING" && (
                    <span className={`text-xs text-text-muted transition-opacity ${(task.status === "QUEUED" || isTerminal) ? "group-hover:opacity-0" : "group-hover:text-text-secondary"}`}>
                      →
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
