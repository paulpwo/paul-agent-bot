"use client"

import { signIn } from "next-auth/react"
import { useState } from "react"

export function LoginForm({ isBootstrap }: { isBootstrap: boolean }) {
  const [login, setLogin] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleBootstrap(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")
    const result = await signIn("bootstrap", {
      login: login.trim(),
      callbackUrl: "/dashboard",
      redirect: false,
    })
    if (result?.error) {
      setError("Invalid username. Only the bootstrap admin can sign in.")
      setLoading(false)
    } else if (result?.url) {
      window.location.href = result.url
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="flex items-center gap-2.5 mb-8 justify-center">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600 text-white text-sm font-bold select-none tracking-tight">
          PB
        </span>
        <span className="text-base font-semibold text-text-primary tracking-tight">PaulAgentBot</span>
      </div>

    <div className="animated-border">
    <div className="p-8 rounded-[10px] relative z-10" style={{ background: 'var(--surface-raised)', backdropFilter: 'blur(20px) saturate(1.4)', WebkitBackdropFilter: 'blur(20px) saturate(1.4)' }}>
      <h1 className="text-lg font-semibold text-white mb-1.5 tracking-tight">Sign in</h1>
      <p className="text-text-muted text-sm mb-7">Access your agent dashboard</p>

      {/* GitHub OAuth button */}
      <button
        onClick={() => signIn("github", { callbackUrl: "/dashboard" })}
        className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg bg-white text-zinc-900 font-medium text-sm hover:bg-zinc-100 transition-colors"
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
        </svg>
        Continue with GitHub
      </button>

      {/* Bootstrap form — only shown in bootstrap mode */}
      {isBootstrap && (
        <form onSubmit={handleBootstrap} className="mt-4">
          <p className="text-xs text-text-muted mb-3">
            Bootstrap mode — enter your GitHub username
          </p>
          <input
            name="login"
            type="text"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="github-username"
            className="w-full px-3 py-2 rounded-lg bg-surface-overlay border border-border-subtle text-white text-sm placeholder-text-muted mb-3 focus:outline-none focus:border-border-default"
            required
            disabled={loading}
          />
          {error && (
            <p className="text-xs text-red-400 mb-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 rounded-lg bg-surface-overlay text-white text-sm font-medium hover:bg-surface-raised transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Signing in…" : "Bootstrap login"}
          </button>
        </form>
      )}
    </div>
    </div>
    </div>
  )
}
