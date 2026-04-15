import { db } from "@/lib/db/client"
import { requireAuth } from "@/lib/auth/session"
import { redirect } from "next/navigation"
import { ReposList } from "@/components/repos/ReposList"
import { SyncButton } from "@/components/repos/SyncButton"

async function syncRepos() {
  "use server"

  await requireAuth()

  const appId = process.env.GITHUB_APP_ID
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY

  if (!appId || !rawKey) {
    console.error("[sync-repos] Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY")
    redirect("/dashboard/repos?error=missing-env")
  }

  // Handle escaped newlines (env var stored as single line)
  const privateKey = rawKey.replace(/\\n/g, "\n")

  try {
    const { Octokit } = await import("@octokit/rest")
    const { createAppAuth } = await import("@octokit/auth-app")
    const { getWorkspacePath } = await import("@/lib/agent/workspace")
    const { repoToQueueName } = await import("@/lib/queue/producer")

    const appOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId, privateKey },
    })

    const auth = createAppAuth({ appId, privateKey })
    const { data: installations } = await appOctokit.apps.listInstallations()
    console.log(`[sync-repos] Found ${installations.length} installation(s)`)

    for (const installation of installations) {
      const installAuth = await auth({ type: "installation", installationId: installation.id })
      const installOctokit = new Octokit({ auth: installAuth.token })
      const { data: reposData } = await installOctokit.apps.listReposAccessibleToInstallation({ per_page: 100 })
      console.log(`[sync-repos] Installation ${installation.id}: ${reposData.repositories.length} repo(s)`)

      for (const repo of reposData.repositories) {
        const workspacePath = getWorkspacePath(repo.full_name)
        await db.repo.upsert({
          where: { owner_name: { owner: repo.owner.login, name: repo.name } },
          create: {
            owner: repo.owner.login,
            name: repo.name,
            fullName: repo.full_name,
            enabled: false,
            workspacePath,
            queueName: repoToQueueName(repo.full_name),
            githubInstallId: installation.id,
          },
          update: {
            fullName: repo.full_name,
            workspacePath,
            githubInstallId: installation.id,
          },
        })
      }
    }
  } catch (err) {
    console.error("[sync-repos] Error:", err)
    redirect("/dashboard/repos?error=sync-failed")
  }

  redirect("/dashboard/repos?synced=1")
}

export default async function ReposPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; synced?: string }>
}) {
  await requireAuth()
  const { error, synced } = await searchParams
  const repos = await db.repo.findMany({ orderBy: [{ owner: "asc" }, { name: "asc" }] })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-white tracking-tight">Repos</h1>
        <form action={syncRepos}>
          <SyncButton />
        </form>
      </div>

      {synced && (
        <p className="text-xs text-green-400 mb-4">Sync complete — {repos.length} repo(s) loaded.</p>
      )}
      {error === "missing-env" && (
        <p className="text-xs text-red-400 mb-4">Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY in environment.</p>
      )}
      {error === "sync-failed" && (
        <p className="text-xs text-red-400 mb-4">Sync failed — check the terminal for details.</p>
      )}

      {repos.length === 0 ? (
        <div className="bg-surface-raised border border-border-default rounded-xl p-10 flex flex-col items-center text-center">
          <p className="text-sm font-medium text-text-secondary">No repos synced yet</p>
          <p className="text-xs text-text-muted mt-2 max-w-sm">
            Click <span className="text-text-primary">&ldquo;Sync from GitHub&rdquo;</span> above after
            configuring your GitHub App in Settings to import your repositories.
          </p>
        </div>
      ) : (
        <ReposList repos={repos} />
      )}
    </div>
  )
}
