"use client"

import { useState, useTransition } from "react"
import type { CronJob } from "@prisma/client"

interface Props {
  initialJobs: CronJob[]
  repos: string[]
}

const CHANNEL_OPTIONS = ["telegram", "github", "slack"] as const
type Channel = (typeof CHANNEL_OPTIONS)[number]

function formatDate(d: Date | string | null): string {
  if (!d) return "—"
  return new Date(d).toLocaleString()
}

const emptyForm = {
  name: "",
  naturalText: "",
  channel: "telegram" as Channel,
  channelId: "",
  threadId: "0",
  repo: "",
  prompt: "",
  schedule: "",
}

export function CronjobList({ initialJobs, repos }: Props) {
  const [jobs, setJobs] = useState<CronJob[]>(initialJobs)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    startTransition(async () => {
      try {
        const res = await fetch("/api/cronjobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        })
        if (!res.ok) {
          const err = await res.json()
          setFormError(
            typeof err.error === "string" ? err.error : JSON.stringify(err.error),
          )
          return
        }
        const newJob: CronJob = await res.json()
        setJobs((prev) => [newJob, ...prev])
        setForm(emptyForm)
        setShowForm(false)
      } catch {
        setFormError("Network error — please try again")
      }
    })
  }

  // -----------------------------------------------------------------------
  // Toggle enabled
  // -----------------------------------------------------------------------
  async function handleToggle(job: CronJob) {
    // Optimistic update
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, enabled: !j.enabled } : j)),
    )
    try {
      const res = await fetch(`/api/cronjobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !job.enabled }),
      })
      if (!res.ok) {
        // Revert
        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, enabled: job.enabled } : j)),
        )
      } else {
        const updated: CronJob = await res.json()
        setJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)))
      }
    } catch {
      // Revert
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, enabled: job.enabled } : j)),
      )
    }
  }

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------
  async function handleDelete(jobId: string) {
    if (!confirm("Delete this cron job?")) return
    setJobs((prev) => prev.filter((j) => j.id !== jobId))
    try {
      await fetch(`/api/cronjobs/${jobId}`, { method: "DELETE" })
    } catch {
      // Best-effort — page refresh will show real state
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4">
      {/* New Cron Job button */}
      <div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-xs px-3 py-1.5 rounded-lg bg-surface-overlay text-text-primary hover:bg-surface-overlay/80 transition-colors"
        >
          {showForm ? "Cancel" : "+ New Cron Job"}
        </button>
      </div>

      {/* Inline form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="glass-card rounded-lg p-5 flex flex-col gap-4"
        >
          <p className="text-sm font-medium text-white">New Cron Job</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Name */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="bg-surface-overlay border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder-text-muted focus:outline-none focus:border-border-default"
                placeholder="Daily standup"
              />
            </div>

            {/* Natural text */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Schedule description</label>
              <input
                required
                value={form.naturalText}
                onChange={(e) => setForm((f) => ({ ...f, naturalText: e.target.value }))}
                className="bg-surface-overlay border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder-text-muted focus:outline-none focus:border-border-default"
                placeholder="every weekday at 9am"
              />
            </div>

            {/* Cron expression */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Cron expression</label>
              <input
                required
                value={form.schedule}
                onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
                className="bg-surface-overlay border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder-text-muted focus:outline-none focus:border-border-default font-mono"
                placeholder="0 9 * * 1-5"
              />
            </div>

            {/* Channel */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Channel</label>
              <select
                value={form.channel}
                onChange={(e) =>
                  setForm((f) => ({ ...f, channel: e.target.value as Channel }))
                }
                className="bg-surface-overlay border border-border-subtle rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-border-default"
              >
                {CHANNEL_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Channel ID */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Channel ID</label>
              <input
                required
                value={form.channelId}
                onChange={(e) => setForm((f) => ({ ...f, channelId: e.target.value }))}
                className="bg-surface-overlay border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder-text-muted focus:outline-none focus:border-border-default"
                placeholder="chat_id or repo"
              />
            </div>

            {/* Thread ID */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Thread ID</label>
              <input
                required
                value={form.threadId}
                onChange={(e) => setForm((f) => ({ ...f, threadId: e.target.value }))}
                className="bg-surface-overlay border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder-text-muted focus:outline-none focus:border-border-default"
                placeholder='0 (use "0" for no thread)'
              />
            </div>

            {/* Repo */}
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs text-text-secondary">Repo</label>
              {repos.length > 0 ? (
                <select
                  required
                  value={form.repo}
                  onChange={(e) => setForm((f) => ({ ...f, repo: e.target.value }))}
                  className="bg-surface-overlay border border-border-subtle rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-border-default"
                >
                  <option value="" disabled>
                    Select a repo…
                  </option>
                  {repos.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  required
                  value={form.repo}
                  onChange={(e) => setForm((f) => ({ ...f, repo: e.target.value }))}
                  className="bg-surface-overlay border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder-text-muted focus:outline-none focus:border-border-default"
                  placeholder="owner/repo"
                />
              )}
            </div>
          </div>

          {/* Prompt */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-secondary">Prompt</label>
            <textarea
              required
              rows={3}
              value={form.prompt}
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              className="bg-surface-overlay border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder-text-muted focus:outline-none focus:border-border-default resize-none"
              placeholder="What should the agent do?"
            />
          </div>

          {formError && (
            <p className="text-xs text-red-400">{formError}</p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="text-xs px-4 py-1.5 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      {jobs.length === 0 ? (
        <div className="glass-card rounded-xl p-10 flex flex-col items-center text-center">
          <p className="text-sm font-medium text-text-secondary">No scheduled jobs</p>
          <p className="text-xs text-text-muted mt-2 max-w-sm">
            Create your first cron job to automate recurring tasks — daily summaries, code checks,
            or any recurring agent prompt.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs text-text-muted border-b border-border-default">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Schedule</th>
                <th className="pb-2 pr-4 font-medium">Repo</th>
                <th className="pb-2 pr-4 font-medium">Channel</th>
                <th className="pb-2 pr-4 font-medium">Last Run</th>
                <th className="pb-2 pr-4 font-medium">Next Run</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className="border-b border-border-default/50 hover:bg-surface-raised/50 transition-colors"
                >
                  <td className="py-3 pr-4 text-white font-medium">{job.name}</td>
                  <td className="py-3 pr-4">
                    <span className="text-text-primary">{job.naturalText}</span>
                    <span className="block text-xs text-text-muted font-mono mt-0.5">
                      {job.schedule}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-text-secondary font-mono text-xs">{job.repo}</td>
                  <td className="py-3 pr-4 text-text-secondary capitalize">{job.channel}</td>
                  <td className="py-3 pr-4 text-text-muted text-xs whitespace-nowrap">
                    {formatDate(job.lastRun)}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary text-xs whitespace-nowrap">
                    {formatDate(job.nextRun)}
                  </td>
                  <td className="py-3 pr-4">
                    <button
                      onClick={() => handleToggle(job)}
                      className={`relative inline-flex items-center w-10 h-5 rounded-full transition-colors ${
                        job.enabled ? "bg-green-600" : "bg-border-subtle"
                      }`}
                      title={job.enabled ? "Disable" : "Enable"}
                    >
                      <span
                        className={`inline-block w-3.5 h-3.5 bg-white rounded-full shadow transform transition-transform ${
                          job.enabled ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="py-3">
                    <button
                      onClick={() => handleDelete(job.id)}
                      className="text-xs text-text-muted hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
