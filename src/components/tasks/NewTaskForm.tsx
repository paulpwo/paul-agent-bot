"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

interface Repo {
  fullName: string
}

interface Props {
  repos: Repo[]
  onCancel: () => void
}

export default function NewTaskForm({ repos, onCancel }: Props) {
  const router = useRouter()
  const [repo, setRepo] = useState(repos[0]?.fullName ?? "")
  const [prompt, setPrompt] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!repo || !prompt.trim()) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, prompt }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? "Failed to create task")
      }

      const data = await res.json() as { taskId: string }
      router.push(`/dashboard/tasks/${data.taskId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 p-4 rounded-lg glass-card flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs text-text-secondary font-medium">Repository</label>
        {repos.length === 0 ? (
          <p className="text-xs text-text-muted">No repos configured. Add one in Repos settings.</p>
        ) : (
          <select
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            className="bg-surface-overlay border border-border-subtle text-text-primary text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {repos.map((r) => (
              <option key={r.fullName} value={r.fullName}>
                {r.fullName}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-text-secondary font-medium">Prompt</label>
        <textarea
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what you want the agent to do..."
          className="bg-surface-overlay border border-border-subtle text-text-primary text-sm rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-text-muted"
        />
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={loading || repos.length === 0 || !prompt.trim()}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Running..." : "Run"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium rounded-md text-text-secondary hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
