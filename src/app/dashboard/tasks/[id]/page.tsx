import { db } from "@/lib/db/client"
import { requireAuth } from "@/lib/auth/session"
import { notFound } from "next/navigation"
import Link from "next/link"
import TaskStream from "./TaskStream"
import DeleteTaskButton from "./DeleteTaskButton"

const STATUS_COLORS: Record<string, string> = {
  QUEUED:    "bg-zinc-400 text-white dark:bg-zinc-600 dark:text-zinc-100",
  RUNNING:   "bg-blue-500 text-white dark:bg-blue-600 dark:text-white",
  COMPLETED: "bg-emerald-500 text-white dark:bg-emerald-700 dark:text-emerald-100",
  FAILED:    "bg-red-500 text-white dark:bg-red-700 dark:text-red-100",
  CANCELLED: "bg-zinc-300 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-400",
}

const CHANNEL_BADGE: Record<string, string> = {
  telegram:  "bg-violet-500 text-white dark:bg-violet-700 dark:text-violet-100",
  github:    "bg-zinc-500 text-white dark:bg-zinc-600 dark:text-zinc-100",
  slack:     "bg-amber-500 text-white dark:bg-amber-700 dark:text-amber-100",
  email:     "bg-cyan-500 text-white dark:bg-cyan-700 dark:text-cyan-100",
  dashboard: "bg-indigo-500 text-white dark:bg-indigo-700 dark:text-indigo-100",
}

function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return `${mins}m ${secs}s`
}

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth()
  const { id } = await params

  const task = await db.task.findUnique({
    where: { id },
    include: { session: { select: { id: true } } },
  })
  if (!task) notFound()

  const isTerminal = task.status === "COMPLETED" || task.status === "FAILED" || task.status === "CANCELLED"
  const channelBadge = CHANNEL_BADGE[task.channel] ?? "bg-surface-overlay text-text-secondary"
  const statusBadge = STATUS_COLORS[task.status] ?? "text-text-secondary bg-surface-overlay"
  const duration = formatDuration(task.durationMs)

  return (
    <div className="p-6 max-w-4xl">
      {/* Back link */}
      <Link
        href="/dashboard/tasks"
        className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors mb-5"
      >
        ← All tasks
      </Link>

      {/* Header */}
      <div className="mb-6">
        {/* Breadcrumb */}
        <p className="text-xs text-text-muted mb-1">
          Tasks /
          <span className="text-text-secondary ml-1">
            #{task.threadId} — {task.repo}
          </span>
        </p>

        {/* Title + status */}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">
            {task.repo}#{task.threadId}
          </h1>
          <span className={`text-xs px-2 py-0.5 rounded font-mono ${statusBadge}`}>
            {task.status}
          </span>
        </div>

        {/* Prompt */}
        <p className="text-sm text-text-secondary mt-2 leading-relaxed">{task.prompt}</p>

        {/* Metadata row */}
        <div className="flex items-center gap-3 flex-wrap mt-3">
          <span className={`text-xs px-2 py-0.5 rounded ${channelBadge}`}>
            {task.channel}
          </span>

          <span className="text-xs text-text-muted">
            Created {new Date(task.createdAt).toLocaleString()}
          </span>

          {duration && (
            <span className="text-xs text-text-muted">Duration: {duration}</span>
          )}

          {task.modelUsed && (
            <span className="text-xs px-2 py-0.5 rounded bg-surface-overlay text-text-secondary font-mono">
              {task.modelUsed}
            </span>
          )}

          {task.errorMessage && task.status === "FAILED" && (
            <span className="text-xs text-red-400 truncate max-w-xs">{task.errorMessage}</span>
          )}
        </div>
      </div>

      {/* Delete action (terminal tasks only) */}
      {isTerminal && (
        <div className="mb-4">
          <DeleteTaskButton taskId={task.id} />
        </div>
      )}

      {/* Continue in Chat */}
      {task.session && (
        <div className="mb-4">
          <Link
            href={`/dashboard/chat/${task.session.id}`}
            className="inline-flex items-center gap-2 text-xs bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 dark:bg-indigo-600/20 dark:hover:bg-indigo-600/30 dark:border-indigo-500/30 dark:text-indigo-400 dark:hover:text-indigo-300 px-3 py-2 rounded-lg transition-colors"
          >
            <span>💬</span>
            Continue in Chat →
          </Link>
        </div>
      )}

      {/* Content */}
      {isTerminal ? (
        <div className="rounded-lg bg-surface-raised border border-border-default p-4 font-mono text-sm text-text-primary min-h-48 max-h-[60vh] overflow-auto whitespace-pre-wrap">
          {task.status === "COMPLETED" && task.result ? (
            task.result
          ) : task.status === "FAILED" && task.errorMessage ? (
            <span className="text-red-400">{task.errorMessage}</span>
          ) : task.status === "CANCELLED" ? (
            <span className="text-text-muted">Task was cancelled.</span>
          ) : (
            <span className="text-text-muted">No output recorded.</span>
          )}
        </div>
      ) : (
        <TaskStream taskId={id} initialStatus={task.status} />
      )}
    </div>
  )
}
