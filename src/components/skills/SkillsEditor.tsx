"use client"

import { useState, useTransition, useCallback } from "react"

export interface SkillFile {
  name: string
  path: string
  size: number
  preview: string
}

export interface Repo {
  id: string
  owner: string
  name: string
  fullName: string
}

interface SkillsEditorProps {
  repos: Repo[]
  initialSkills: SkillFile[]
  initialEnabledPaths: string[]
  initialRepo: string | null
}

export function SkillsEditor({
  repos,
  initialSkills,
  initialEnabledPaths,
  initialRepo,
}: SkillsEditorProps) {
  const [selectedRepo, setSelectedRepo] = useState<string>(initialRepo ?? "")
  const [skills, setSkills] = useState<SkillFile[]>(initialSkills)
  const [enabledPaths, setEnabledPaths] = useState<Set<string>>(
    new Set(initialEnabledPaths)
  )
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const [expandedContent, setExpandedContent] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Load skills when repo changes
  const handleRepoChange = useCallback(async (repoFullName: string) => {
    setSelectedRepo(repoFullName)
    setExpandedPath(null)
    setExpandedContent(null)
    setError(null)

    try {
      const qs = repoFullName ? `?repo=${encodeURIComponent(repoFullName)}` : ""
      const res = await fetch(`/api/skills${qs}`)
      if (!res.ok) throw new Error("Failed to load skills")
      const data = (await res.json()) as {
        skills: SkillFile[]
        enabledPaths: string[]
      }
      setSkills(data.skills)
      setEnabledPaths(new Set(data.enabledPaths))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load skills")
    }
  }, [])

  // Toggle a skill on/off for the selected repo
  const handleToggle = useCallback(
    (skillPath: string, currentlyEnabled: boolean) => {
      if (!selectedRepo) {
        setError("Select a repo first to enable/disable skills")
        return
      }

      startTransition(async () => {
        setError(null)
        try {
          const res = await fetch("/api/skills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              repoFullName: selectedRepo,
              skillPath,
              enabled: !currentlyEnabled,
            }),
          })
          if (!res.ok) {
            const d = (await res.json()) as { error?: string }
            throw new Error(d.error ?? "Failed to toggle skill")
          }
          const data = (await res.json()) as { enabledPaths: string[] }
          setEnabledPaths(new Set(data.enabledPaths))
        } catch (e) {
          setError(e instanceof Error ? e.message : "Toggle failed")
        }
      })
    },
    [selectedRepo]
  )

  // View skill content inline
  const handleView = useCallback(async (skill: SkillFile) => {
    if (expandedPath === skill.path) {
      setExpandedPath(null)
      setExpandedContent(null)
      return
    }

    setExpandedPath(skill.path)
    setExpandedContent(null)
    setLoadingContent(true)
    setError(null)

    try {
      // Encode the absolute path as URL segments (strip leading slash then split)
      const segments = skill.path.replace(/^\//, "").split("/")
      const res = await fetch(`/api/skills/${segments.map(encodeURIComponent).join("/")}`)
      if (!res.ok) throw new Error("Failed to load skill content")
      const data = (await res.json()) as { content: string }
      setExpandedContent(data.content)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load content")
      setExpandedPath(null)
    } finally {
      setLoadingContent(false)
    }
  }, [expandedPath])

  // Derive display label for a skill
  function skillLabel(skill: SkillFile): string {
    // e.g. "frontend-design/SKILL" → "frontend-design"
    // or "_shared/engram-convention" → "_shared/engram-convention"
    const parts = skill.name.split("/")
    if (parts.length >= 2 && parts[parts.length - 1].toUpperCase() === "SKILL") {
      return parts.slice(0, -1).join("/")
    }
    return skill.name
  }

  // Derive the location label
  const claudeSkillsBase = typeof window === "undefined"
    ? ""
    : "" // resolved server-side; we display the path prefix from the path itself

  function locationLabel(skillPath: string): string {
    // Detect if it's a ~/.claude/skills path or workspace path
    if (skillPath.includes("/.claude/skills/")) {
      return "~/.claude/skills"
    }
    return "workspace"
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white tracking-tight">Skills</h1>
        <p className="text-sm text-text-muted mt-1.5">
          Manage which skill files are injected into the agent system prompt per repo.
        </p>
      </div>

      {/* Repo selector */}
      <div className="mb-6">
        <label className="block text-xs font-medium text-text-secondary mb-1.5">
          Select repo
        </label>
        <select
          value={selectedRepo}
          onChange={(e) => handleRepoChange(e.target.value)}
          className="w-full max-w-xs bg-surface-raised border border-border-subtle text-text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-border-default"
        >
          <option value="">— no repo selected —</option>
          {repos.map((repo) => (
            <option key={repo.id} value={repo.fullName}>
              {repo.fullName}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="text-xs text-red-400 mb-4 bg-red-950/30 border border-red-800 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Skills list */}
      <div>
        <h2 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-3">
          Available Skills
          <span className="ml-2 text-text-muted normal-case">
            ({skills.length})
          </span>
        </h2>

        {skills.length === 0 ? (
          <div className="bg-surface-raised border border-border-default rounded-xl p-8 text-center">
            <p className="text-sm font-medium text-text-secondary">No skills found</p>
            <p className="text-xs text-text-muted mt-1.5">
              Add <code className="text-text-secondary font-mono">.md</code> files to <code className="text-text-secondary font-mono">~/.claude/skills/</code> to get started.
            </p>
          </div>
        ) : (
          <div className="border border-border-default rounded-xl overflow-hidden divide-y divide-border-default">
            {skills.map((skill) => {
              const isEnabled = enabledPaths.has(skill.path)
              const isExpanded = expandedPath === skill.path
              const label = skillLabel(skill)
              const location = locationLabel(skill.path)

              return (
                <div key={skill.path} className="bg-surface-raised">
                  {/* Skill row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Checkbox */}
                    <button
                      onClick={() => handleToggle(skill.path, isEnabled)}
                      disabled={isPending || !selectedRepo}
                      title={selectedRepo ? undefined : "Select a repo first"}
                      className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        isEnabled
                          ? "bg-zinc-100 border-zinc-100 text-zinc-950"
                          : "bg-surface-overlay border-border-subtle hover:border-border-default"
                      } ${!selectedRepo ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                      aria-label={isEnabled ? "Disable skill" : "Enable skill"}
                    >
                      {isEnabled && (
                        <svg
                          className="w-3 h-3"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2 6l3 3 5-5" />
                        </svg>
                      )}
                    </button>

                    {/* Name + location + preview */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary">
                          {label}
                        </span>
                        <span className="text-xs text-text-muted font-mono">
                          {location}
                        </span>
                        {isEnabled && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-overlay text-text-secondary border border-border-subtle">
                            enabled
                          </span>
                        )}
                      </div>
                      {skill.preview && (
                        <p className="text-xs text-text-muted mt-0.5 truncate">
                          {skill.preview}
                        </p>
                      )}
                    </div>

                    {/* View button */}
                    <button
                      onClick={() => handleView(skill)}
                      className="text-xs px-2.5 py-1 rounded-md bg-surface-overlay text-text-secondary hover:text-text-primary hover:bg-surface-overlay/80 transition-colors shrink-0"
                    >
                      {isExpanded ? "Close" : "View"}
                    </button>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="border-t border-border-default bg-surface-base px-4 py-3">
                      {loadingContent ? (
                        <p className="text-xs text-text-muted animate-pulse">
                          Loading...
                        </p>
                      ) : expandedContent !== null ? (
                        <pre className="text-xs text-text-primary whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                          {expandedContent}
                        </pre>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
