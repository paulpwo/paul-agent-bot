"use client"

import { useState, useRef } from "react"
import { ToggleField } from "./ToggleField"
import { EventMultiSelectField } from "./EventMultiSelectField"

// Types matching the API response shape
export type SettingEntry = {
  key: string
  label: string
  section: string
  masked: boolean
  placeholder?: string
  disabled?: boolean
  phase?: string
  type?: "toggle" | "multiselect"
  value: string | null
  displayValue: string | null
  source: "db" | "env" | null
}

type Toast = {
  key: string
  type: "success" | "error"
  message: string
}

type SectionConfig = {
  id: string
  title: string
  description: string
  disabled?: boolean
  phase?: string
  installUrl?: string
}

const SECTIONS: SectionConfig[] = [
  {
    id: "github-app",
    title: "GitHub App",
    description: "Core GitHub App credentials. Read from environment by default; override in DB to use different values.",
    installUrl: "https://github.com/settings/installations",
  },
  {
    id: "github-oauth",
    title: "GitHub OAuth",
    description: "OAuth app used by NextAuth for dashboard login.",
  },
  {
    id: "telegram",
    title: "Telegram",
    description: "Telegram bot configuration for the Telegram channel.",
  },
  {
    id: "slack",
    title: "Slack",
    description: "Slack app configuration.",
    disabled: true,
    phase: "Phase 4",
  },
  {
    id: "auth",
    title: "Auth Allowlist",
    description: "Comma-separated list of GitHub usernames permitted to log in to the dashboard.",
  },
  {
    id: "github-rate-limits",
    title: "GitHub Rate Limits",
    description: "Protect against spam and abuse from GitHub webhook triggers. Leave blank to use defaults.",
  },
  {
    id: "notifications",
    title: "Notifications",
    description: "Get notified in Telegram or Slack when GitHub events occur on tracked repos.",
  },
]

type FieldState = {
  editValue: string
  saving: boolean
  dirty: boolean
}

function SourceBadge({ source }: { source: "db" | "env" | null }) {
  if (!source) return null
  return (
    <span
      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
        source === "db"
          ? "bg-emerald-900/50 text-emerald-400 border border-emerald-800"
          : "bg-surface-overlay text-text-muted border border-border-subtle"
      }`}
    >
      {source === "db" ? "DB" : "ENV"}
    </span>
  )
}

function SettingField({
  entry,
  onSaved,
}: {
  entry: SettingEntry
  onSaved: (key: string, displayValue: string) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [state, setState] = useState<FieldState>({
    editValue: entry.value ?? "",
    saving: false,
    dirty: false,
  })
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)

  const isDisabled = entry.disabled === true

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }

  async function handleSave() {
    if (!state.dirty || isDisabled) return
    setState((s) => ({ ...s, saving: true }))
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: entry.key, value: state.editValue }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast("error", data.error ?? "Save failed")
      } else {
        setState((s) => ({ ...s, dirty: false }))
        onSaved(entry.key, data.displayValue ?? state.editValue)
        showToast("success", "Saved")
      }
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Network error")
    } finally {
      setState((s) => ({ ...s, saving: false }))
    }
  }

  const placeholder = isDisabled
    ? "Not available yet"
    : entry.displayValue
      ? entry.masked
        ? entry.displayValue
        : undefined
      : entry.placeholder

  const displayCurrentValue = entry.displayValue
    ? entry.masked
      ? entry.displayValue
      : undefined
    : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-text-primary">{entry.label}</label>
        <SourceBadge source={entry.source} />
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          {/* Show masked/display value as placeholder when field is untouched */}
          {displayCurrentValue && !state.dirty && (
            <span className="absolute inset-y-0 left-3 flex items-center text-sm text-text-muted pointer-events-none font-mono">
              {displayCurrentValue}
            </span>
          )}
          <input
            ref={inputRef}
            type={entry.masked ? "password" : "text"}
            disabled={isDisabled}
            className={`w-full rounded-lg border px-3 py-2 text-sm font-mono transition-colors outline-none
              ${isDisabled
                ? "bg-surface-base/50 border-border-default text-text-muted cursor-not-allowed"
                : "bg-surface-overlay border-border-subtle text-white placeholder-text-muted focus:border-border-default focus:ring-1 focus:ring-border-default"
              }
              ${displayCurrentValue && !state.dirty ? "text-transparent" : ""}
            `}
            placeholder={placeholder ?? entry.placeholder}
            value={state.editValue}
            autoComplete={entry.masked ? "new-password" : undefined}
            onChange={(e) => {
              setState({ editValue: e.target.value, saving: false, dirty: true })
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave()
            }}
          />
        </div>

        <button
          type="button"
          disabled={isDisabled || !state.dirty || state.saving}
          onClick={handleSave}
          className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors shrink-0
            ${isDisabled || !state.dirty
              ? "bg-surface-overlay text-text-muted cursor-not-allowed"
              : state.saving
                ? "bg-surface-raised text-text-secondary cursor-wait"
                : "bg-white text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200"
            }`}
        >
          {state.saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Inline toast */}
      {toast && (
        <p
          className={`text-xs ${toast.type === "success" ? "text-emerald-400" : "text-red-400"}`}
        >
          {toast.type === "success" ? "✓" : "✕"} {toast.message}
        </p>
      )}
    </div>
  )
}

function getDependsOnKey(key: string): string | undefined {
  if (key === "notifications.telegramEnabled") return "telegram.botToken"
  if (key === "notifications.slackEnabled") return "slack.botToken"
  return undefined
}

function SectionCard({
  section,
  entries,
  allSettings,
  onSaved,
}: {
  section: SectionConfig
  entries: SettingEntry[]
  allSettings: SettingEntry[]
  onSaved: (key: string, displayValue: string) => void
}) {
  const isDisabled = section.disabled === true

  return (
    <div
      className={`rounded-xl glass-card p-6 relative overflow-hidden
        ${isDisabled ? "opacity-60" : ""}`}
    >
      {/* Phase badge overlay */}
      {isDisabled && section.phase && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="bg-surface-raised/80 backdrop-blur-sm rounded-full px-4 py-2 border border-border-subtle">
            <span className="text-sm font-semibold text-text-secondary">Available in {section.phase}</span>
          </div>
        </div>
      )}

      <div className={isDisabled ? "opacity-30" : undefined}>
        <div className="mb-5">
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-base font-semibold text-white">{section.title}</h2>
            {isDisabled && section.phase && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-overlay text-text-muted border border-border-subtle uppercase tracking-wide">
                {section.phase}
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted">{section.description}</p>
          {section.installUrl && (
            <a
              href={section.installUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Manage app installations →
            </a>
          )}
        </div>

        <div className="flex flex-col gap-5">
          {entries.map((entry) => {
            if (entry.type === "toggle") {
              return (
                <ToggleField
                  key={entry.key}
                  entry={entry}
                  allSettings={allSettings}
                  dependsOnKey={getDependsOnKey(entry.key)}
                  onSaved={onSaved}
                />
              )
            }
            if (entry.type === "multiselect") {
              return (
                <EventMultiSelectField
                  key={entry.key}
                  entry={entry}
                  onSaved={onSaved}
                />
              )
            }
            return <SettingField key={entry.key} entry={entry} onSaved={onSaved} />
          })}
          {entries.length === 0 && (
            <p className="text-sm text-text-muted italic">No settings in this section.</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SettingsForm({ initialSettings }: { initialSettings: SettingEntry[] }) {
  const [settings, setSettings] = useState<SettingEntry[]>(initialSettings)

  function handleSaved(key: string, displayValue: string) {
    setSettings((prev) =>
      prev.map((s) =>
        s.key === key
          ? { ...s, displayValue, source: "db" as const }
          : s
      )
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {SECTIONS.map((section) => {
        const entries = settings.filter((s) => s.section === section.id)
        return (
          <SectionCard
            key={section.id}
            section={section}
            entries={entries}
            allSettings={settings}
            onSaved={handleSaved}
          />
        )
      })}
    </div>
  )
}
