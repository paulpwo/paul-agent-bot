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

export default function TaskList({ initialTasks, repos }: Props) {
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [showForm, setShowForm] = useState(false)

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60_000)
    if (mins < 1) return "just now"
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
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
            <span className="text-text-primary font-mono">@paulbot</span> in a GitHub issue, or send a
            message in Telegram to queue your first task.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 mt-4">
          {tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => router.push(`/dashboard/tasks/${task.id}`)}
              className="flex items-start gap-3 px-4 py-3.5 rounded-lg glass-card text-left w-full transition-all duration-200 group"
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
              {task.status === "RUNNING" ? (
                <span className="flex items-center gap-1 text-xs text-blue-700 dark:text-blue-400 shrink-0 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-700 dark:bg-blue-400 animate-pulse" />
                  Live
                </span>
              ) : (
                <span className="text-xs text-text-muted group-hover:text-text-secondary shrink-0 mt-0.5 transition-colors">→</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
