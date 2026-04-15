"use client"

import { useState } from "react"
import { RepoCard } from "./RepoCard"

interface Repo {
  id: string
  owner: string
  name: string
  workspacePath: string
  defaultBranch: string
  protectedBranches: string
  enabled: boolean
}

interface ReposListProps {
  repos: Repo[]
}

export function ReposList({ repos: initial }: ReposListProps) {
  const [repos, setRepos] = useState(initial)
  const [query, setQuery] = useState("")

  function handleDelete(id: string) {
    setRepos((prev) => prev.filter((r) => r.id !== id))
  }

  const filtered = query.trim()
    ? repos.filter((r) =>
        `${r.owner}/${r.name}`.toLowerCase().includes(query.toLowerCase())
      )
    : repos

  if (repos.length === 0) {
    return (
      <p className="text-text-muted text-sm">
        No repos. Click &quot;Sync from GitHub&quot; to import your repos.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter repos..."
        className="w-full max-w-sm px-3 py-1.5 rounded-lg bg-surface-overlay border border-border-subtle text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-border-default"
      />
      {filtered.length === 0 ? (
        <p className="text-text-muted text-sm">No repos match &quot;{query}&quot;</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((repo) => (
            <RepoCard key={repo.id} repo={repo} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
