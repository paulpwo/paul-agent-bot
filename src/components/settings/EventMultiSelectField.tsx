"use client"

import { useState } from "react"
import type { SettingEntry } from "@/components/settings/SettingsForm"

const EVENT_OPTIONS = [
  { value: "mention",      label: "Mentions",     description: "When someone @mentions the bot" },
  { value: "issue_opened", label: "Issue opened",  description: "When a new issue is created" },
  { value: "pr_opened",    label: "PR opened",     description: "When a new pull request is opened" },
  { value: "pr_merged",    label: "PR merged",     description: "When a pull request is merged" },
]

const ALL_VALUES = EVENT_OPTIONS.map((o) => o.value)

interface EventMultiSelectFieldProps {
  entry: SettingEntry
  onSaved: (key: string, displayValue: string) => void
}

export function EventMultiSelectField({ entry, onSaved }: EventMultiSelectFieldProps) {
  const parseValue = (v: string | null): string[] => {
    if (!v) return ALL_VALUES
    try { return JSON.parse(v) } catch { return ALL_VALUES }
  }

  const [selected, setSelected] = useState<string[]>(() => parseValue(entry.value))
  const [saving, setSaving] = useState(false)

  async function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value]
    setSelected(next)
    setSaving(true)
    try {
      const serialized = JSON.stringify(next)
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: entry.key, value: serialized }),
      })
      if (res.ok) {
        const data = await res.json()
        onSaved(entry.key, data.displayValue ?? serialized)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2 py-2">
      <span className="text-sm font-medium text-primary">{entry.label}</span>
      <div className="space-y-2 mt-2">
        {EVENT_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(opt.value)}
              onChange={() => toggle(opt.value)}
              disabled={saving}
              className="mt-0.5 h-4 w-4 rounded accent-indigo-600 cursor-pointer"
            />
            <div>
              <span className="text-sm text-secondary">{opt.label}</span>
              <p className="text-xs text-muted">{opt.description}</p>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}
