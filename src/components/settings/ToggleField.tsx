"use client"

import { useState } from "react"
import type { SettingEntry } from "@/components/settings/SettingsForm"

interface ToggleFieldProps {
  entry: SettingEntry
  dependsOnKey?: string
  allSettings: SettingEntry[]
  onSaved: (key: string, displayValue: string) => void
}

export function ToggleField({ entry, dependsOnKey, allSettings, onSaved }: ToggleFieldProps) {
  const [saving, setSaving] = useState(false)
  const isOn = entry.value === "true" || entry.displayValue === "true"

  const dependencyMet = !dependsOnKey || allSettings.some(
    (s) => s.key === dependsOnKey && (s.value !== null || s.displayValue !== null)
  )

  async function toggle() {
    if (!dependencyMet || saving) return
    setSaving(true)
    try {
      const newValue = isOn ? "false" : "true"
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: entry.key, value: newValue }),
      })
      if (res.ok) {
        const data = await res.json()
        onSaved(entry.key, data.displayValue ?? newValue)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <span className="text-sm font-medium text-primary">{entry.label}</span>
        {!dependencyMet && dependsOnKey && (
          <p className="text-xs text-muted mt-0.5">
            Configure the required token first to enable this
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        onClick={toggle}
        disabled={!dependencyMet || saving}
        className={[
          "relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors duration-200",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600",
          isOn ? "bg-indigo-600" : "bg-surface-overlay border border-subtle",
          (!dependencyMet || saving) ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        <span
          className={[
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
            "absolute top-1",
            isOn ? "translate-x-5" : "translate-x-1",
          ].join(" ")}
        />
      </button>
    </div>
  )
}
