"use client"

import { useState } from "react"

interface Repo {
  id: string
  owner: string
  name: string
  workspacePath: string
  defaultBranch: string
  protectedBranches: string
  enabled: boolean
}

interface RepoCardProps {
  repo: Repo
  onDelete: (id: string) => void
}

export function RepoCard({ repo, onDelete }: RepoCardProps) {
  const [enabled, setEnabled] = useState(repo.enabled)
  const [protectedBranches, setProtectedBranches] = useState(repo.protectedBranches)
  const [editingBranches, setEditingBranches] = useState(false)
  const [branchInput, setBranchInput] = useState(repo.protectedBranches)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function patch(data: Partial<{ enabled: boolean; protectedBranches: string }>) {
    const res = await fetch(`/api/repos/${repo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? "Request failed")
    }
  }

  async function handleToggle() {
    const next = !enabled
    setEnabled(next)          // optimistic
    setError(null)
    try {
      await patch({ enabled: next })
    } catch (err) {
      setEnabled(!next)       // revert
      setError(err instanceof Error ? err.message : "Failed to update")
    }
  }

  async function handleSaveBranches() {
    setSaving(true)
    setError(null)
    try {
      await patch({ protectedBranches: branchInput })
      setProtectedBranches(branchInput)
      setEditingBranches(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update")
    } finally {
      setSaving(false)
    }
  }

  function handleCancelEdit() {
    setBranchInput(protectedBranches)
    setEditingBranches(false)
  }

  async function handleDelete() {
    if (!window.confirm(`Remove ${repo.owner}/${repo.name}? This cannot be undone.`)) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/repos/${repo.id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? "Delete failed")
      }
      onDelete(repo.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete")
      setDeleting(false)
    }
  }

  const branchPills = protectedBranches
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean)

  return (
    <div className="rounded-lg glass-card p-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white font-medium">
            {repo.owner}/{repo.name}
          </p>
          <p className="text-xs text-text-muted mt-0.5 truncate">{repo.workspacePath}</p>
        </div>

        {/* Actions: toggle + delete */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={enabled ? "Disable repo" : "Enable repo"}
            onClick={handleToggle}
            className={[
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400",
              enabled ? "bg-green-600" : "bg-border-subtle",
            ].join(" ")}
          >
            <span
              className={[
                "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                enabled ? "translate-x-[18px]" : "translate-x-[3px]",
              ].join(" ")}
            />
          </button>

          {/* Delete */}
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            aria-label="Delete repo"
            className="text-text-muted hover:text-red-400 transition-colors disabled:opacity-40"
          >
            {deleting ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-xs text-text-muted">
          branch: <span className="text-text-primary">{repo.defaultBranch}</span>
        </span>

        {/* Protected branches */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-text-muted">protected:</span>
          {editingBranches ? (
            <>
              <input
                value={branchInput}
                onChange={(e) => setBranchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveBranches()
                  if (e.key === "Escape") handleCancelEdit()
                }}
                placeholder="main,master"
                className="text-xs bg-surface-overlay border border-border-subtle rounded px-2 py-0.5 text-text-primary placeholder-text-muted focus:outline-none focus:border-border-default w-40"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSaveBranches}
                disabled={saving}
                className="text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="text-xs text-text-muted hover:text-text-primary"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {branchPills.length > 0 ? (
                branchPills.map((b) => (
                  <span
                    key={b}
                    className="text-xs bg-surface-overlay text-text-primary px-1.5 py-0.5 rounded"
                  >
                    {b}
                  </span>
                ))
              ) : (
                <span className="text-xs text-text-muted">none</span>
              )}
              <button
                type="button"
                onClick={() => {
                  setBranchInput(protectedBranches)
                  setEditingBranches(true)
                }}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors"
                aria-label="Edit protected branches"
              >
                Edit
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <p className="mt-2 text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}
