"use client"

import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import { useState } from "react"
import Link from "next/link"
import type { ReactNode } from "react"
import { ThemeToggle } from "./ThemeToggle"

// ── Icons (inline SVG, Lucide-style 15×15) ────────────────────────────────────

function IconOverview() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function IconChat() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function IconTasks() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  )
}

function IconRepos() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

function IconSkills() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  )
}

function IconCronjobs() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function IconMenu() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

function IconX() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// ── Nav items ─────────────────────────────────────────────────────────────────

interface NavItem {
  href: string
  label: string
  icon: ReactNode
  exact: boolean
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: <IconOverview />, exact: true },
  { href: "/dashboard/chat", label: "Chat", icon: <IconChat />, exact: false },
  { href: "/dashboard/tasks", label: "Tasks", icon: <IconTasks />, exact: false },
  { href: "/dashboard/repos", label: "Repos", icon: <IconRepos />, exact: false },
  { href: "/dashboard/skills", label: "Skills", icon: <IconSkills />, exact: false },
  { href: "/dashboard/cronjobs", label: "Cronjobs", icon: <IconCronjobs />, exact: false },
  { href: "/dashboard/settings", label: "Settings", icon: <IconSettings />, exact: false },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function getInitials(name: string | null | undefined): string {
  if (!name) return "?"
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href
    return pathname === item.href || pathname.startsWith(item.href + "/")
  }

  function close() {
    setOpen(false)
  }

  return (
    <>
      {/* ── Mobile top bar ──────────────────────────────────────── */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 h-12 glass-overlay flex items-center gap-3 px-4 border-b border-border-default/60">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="text-text-muted hover:text-text-primary transition-colors p-1 -ml-1 rounded-lg hover:bg-surface-raised"
        >
          <IconMenu />
        </button>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-indigo-600 text-white text-[10px] font-bold select-none tracking-tight shrink-0">
            PB
          </span>
          <span className="text-sm font-semibold text-text-primary tracking-tight">PaulAgentBot</span>
        </div>
      </header>

      {/* ── Backdrop ────────────────────────────────────────────── */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar drawer ──────────────────────────────────────── */}
      <aside
        className={`
          fixed lg:relative inset-y-0 left-0 z-50
          w-56 glass-sidebar flex flex-col py-5 px-3 shrink-0
          transition-transform duration-200 ease-in-out
          ${open ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0
        `}
      >
        {/* Logo — desktop */}
        <div className="px-2 mb-6 flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-600 text-white text-[11px] font-bold select-none shrink-0 tracking-tight">
            PB
          </span>
          <span className="text-sm font-semibold text-text-primary tracking-tight">PaulAgentBot</span>
          {/* Close button — mobile only */}
          <button
            onClick={close}
            aria-label="Close navigation"
            className="lg:hidden ml-auto text-text-muted hover:text-text-primary transition-colors p-1 rounded-lg hover:bg-surface-raised"
          >
            <IconX />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5 flex-1">
          {navItems.map((item) => {
            const active = isActive(item)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={`relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 overflow-hidden ${
                  active
                    ? "bg-surface-overlay/60 text-text-primary font-medium glow-active"
                    : "text-text-muted hover:text-text-primary hover:bg-surface-raised"
                }`}
              >
                {active && (
                  <span className="absolute left-0 inset-y-0 w-[3px] bg-indigo-500" aria-hidden="true" />
                )}
                <span className={`shrink-0 transition-colors ${active ? "text-indigo-400" : ""}`}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* User section */}
        <div className="pt-3 border-t border-border-default/60 mt-3">
          {session?.user && (
            <div className="flex items-center gap-2.5 px-3 py-2 mb-0.5">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600/25 border border-indigo-500/30 text-[10px] font-semibold text-indigo-300 shrink-0 select-none">
                {getInitials(session.user.name)}
              </span>
              <span className="text-xs text-text-secondary truncate leading-tight flex-1">
                {session.user.name ?? session.user.email ?? "User"}
              </span>
              <ThemeToggle />
            </div>
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-red-400 hover:bg-surface-raised transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}
