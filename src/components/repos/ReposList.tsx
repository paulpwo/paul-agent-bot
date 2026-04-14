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

  function handleDelete(id: string) {
    setRepos((prev) => prev.filter((r) => r.id !== id))
  }

  if (repos.length === 0) {
    return (
      <p className="text-text-muted text-sm">
        No repos. Click &quot;Sync from GitHub&quot; to import your repos.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {repos.map((repo) => (
        <RepoCard key={repo.id} repo={repo} onDelete={handleDelete} />
      ))}
    </div>
  )
}
