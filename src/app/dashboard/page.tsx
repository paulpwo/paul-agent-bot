import { db } from "@/lib/db/client"
import { requireAuth } from "@/lib/auth/session"
import Link from "next/link"

interface StatCardProps {
  label: string
  value: string | number
  valueClass?: string
  sub?: string
}

function StatCard({ label, value, valueClass, sub }: StatCardProps) {
  return (
    <div className="glass-card rounded-xl p-5 flex flex-col gap-1.5 transition-all duration-200">
      <p className="text-[11px] text-text-muted font-medium uppercase tracking-widest">{label}</p>
      <p className={`text-[28px] font-semibold leading-none tabular-nums ${valueClass ?? "text-text-primary"}`}>{value}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </div>
  )
}

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

export default async function DashboardPage() {
  await requireAuth()

  const [
    totalTasks,
    runningTasks,
    completedTasks,
    failedTasks,
    totalRepos,
    enabledRepos,
    recentTasks,
  ] = await Promise.all([
    db.task.count(),
    db.task.count({ where: { status: "RUNNING" } }),
    db.task.count({ where: { status: "COMPLETED" } }),
    db.task.count({ where: { status: "FAILED" } }),
    db.repo.count(),
    db.repo.count({ where: { enabled: true } }),
    db.task.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ])

  const successRate =
    completedTasks + failedTasks > 0
      ? Math.round((completedTasks / (completedTasks + failedTasks)) * 100)
      : null

  return (
    <div className="p-6">
      {/* Heading */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Overview</h1>
        <p className="text-sm text-text-muted mt-1.5">Platform activity at a glance</p>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-10">
        <StatCard label="Total Tasks" value={totalTasks} />
        <StatCard
          label="Running Now"
          value={runningTasks}
          valueClass={runningTasks > 0 ? "text-blue-400" : undefined}
        />
        <StatCard
          label="Completed"
          value={completedTasks}
          valueClass={completedTasks > 0 ? "text-green-400" : undefined}
        />
        <StatCard
          label="Failed"
          value={failedTasks}
          valueClass={failedTasks > 0 ? "text-red-400" : undefined}
        />
        <StatCard
          label="Active Repos"
          value={`${enabledRepos} / ${totalRepos}`}
          sub={totalRepos === 0 ? "No repos synced" : undefined}
        />
        <StatCard
          label="Success Rate"
          value={successRate !== null ? `${successRate}%` : "—"}
          valueClass={
            successRate !== null
              ? successRate >= 80
                ? "text-green-400"
                : successRate >= 50
                  ? "text-yellow-400"
                  : "text-red-400"
              : undefined
          }
          sub={successRate !== null ? `${completedTasks} of ${completedTasks + failedTasks} tasks` : "No data yet"}
        />
      </div>

      {/* Recent tasks */}
      <div className="mb-8">
        <h2 className="text-[11px] font-semibold text-text-muted mb-3 uppercase tracking-widest">
          Recent Tasks
        </h2>

        {recentTasks.length === 0 ? (
          <div className="animated-border rounded-xl">
            <div className="glass-card-solid rounded-[10px] p-10 text-center">
              <p className="text-sm font-medium text-text-secondary">No tasks yet</p>
              <p className="text-xs text-text-muted mt-1.5 max-w-xs mx-auto">
                Mention @paulbot in a GitHub issue, or send a message in Telegram to queue your first task.
              </p>
            </div>
          </div>
        ) : (
          <div className="animated-border rounded-xl">
          <div className="glass-card-solid rounded-[10px] overflow-hidden">
            {recentTasks.map((task, idx) => (
              <div
                key={task.id}
                className={`flex items-center gap-3 px-4 py-3 ${
                  idx < recentTasks.length - 1 ? "border-b border-border-default" : ""
                }`}
              >
                <span
                  className={`text-xs px-2 py-0.5 rounded font-mono shrink-0 ${STATUS_COLORS[task.status] ?? "text-text-secondary bg-surface-overlay"}`}
                >
                  {task.status}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded shrink-0 ${CHANNEL_BADGE[task.channel] ?? "bg-surface-overlay text-text-secondary"}`}
                >
                  {task.channel}
                </span>
                <p className="text-sm text-text-primary truncate flex-1 min-w-0">{task.prompt}</p>
                <p className="text-xs text-text-muted shrink-0 hidden sm:block">
                  {task.repo}#{task.threadId}
                </p>
                <Link
                  href={`/dashboard/tasks/${task.id}`}
                  className="text-xs text-text-muted hover:text-blue-400 transition-colors shrink-0"
                >
                  View →
                </Link>
              </div>
            ))}
          </div>
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="flex gap-2">
        <Link
          href="/dashboard/tasks"
          className="text-xs text-text-secondary hover:text-text-primary bg-surface-raised hover:bg-surface-overlay border border-border-default px-3 py-2 rounded-lg transition-colors"
        >
          All tasks →
        </Link>
        <Link
          href="/dashboard/repos"
          className="text-xs text-text-secondary hover:text-text-primary bg-surface-raised hover:bg-surface-overlay border border-border-default px-3 py-2 rounded-lg transition-colors"
        >
          Manage repos →
        </Link>
        <Link
          href="/dashboard/chat"
          className="text-xs text-text-secondary hover:text-text-primary bg-surface-raised hover:bg-surface-overlay border border-border-default px-3 py-2 rounded-lg transition-colors"
        >
          New chat →
        </Link>
      </div>
    </div>
  )
}
