import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { LoginForm } from "@/components/auth/LoginForm"

export default async function LoginPage() {
  const session = await getServerSession()
  if (session) redirect("/dashboard")

  const isBootstrap = !!process.env.BOOTSTRAP_ADMIN

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12 bg-transparent">
      <div className="w-full max-w-5xl flex items-center gap-20">

        {/* ── Left: Branding panel ────────────────────────────── */}
        <div className="flex-1 hidden lg:flex flex-col gap-10">

          {/* Badge */}
          <div className="inline-flex w-fit items-center gap-2 px-3 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs font-medium tracking-widest uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
            AI Cloud Coding Agent
          </div>

          {/* Headline */}
          <div className="flex flex-col gap-5">
            <h1 className="text-[3.25rem] font-bold leading-[1.15] tracking-tight">
              <span className="text-white">Your agent</span>
              <br />
              <span className="bg-gradient-to-r from-indigo-300 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                ships code
              </span>
              <br />
              <span className="text-white">while you sleep.</span>
            </h1>
            <p className="text-text-secondary text-base leading-relaxed max-w-[360px]">
              A multi-channel AI agent that handles GitHub issues, pull requests, and Telegram messages — autonomously, end to end.
            </p>
          </div>

          {/* Features */}
          <div className="flex flex-col gap-3.5">
            {[
              "Responds to @mentions and GitHub issues",
              "Writes, reviews, and merges pull requests",
              "Sends real-time updates via Telegram",
              "Runs scheduled tasks with full cron support",
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-3 text-text-muted text-sm">
                <span className="w-4 h-4 rounded-full border border-indigo-500/40 bg-indigo-500/10 flex items-center justify-center shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                </span>
                {feature}
              </div>
            ))}
          </div>

          {/* Divider with glow */}
          <div className="flex items-center gap-3 pt-2">
            <div className="h-px flex-1 bg-gradient-to-r from-indigo-500/40 to-transparent" />
          </div>
        </div>

        {/* ── Right: Login card ───────────────────────────────── */}
        <div className="w-full lg:w-auto lg:shrink-0">
          <LoginForm isBootstrap={isBootstrap} />
        </div>

      </div>
    </main>
  )
}
