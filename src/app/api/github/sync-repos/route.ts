import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/session"
import { db } from "@/lib/db/client"
import { Octokit } from "@octokit/rest"
import { createAppAuth } from "@octokit/auth-app"
import { getWorkspacePath } from "@/lib/agent/workspace"
import { repoToQueueName } from "@/lib/queue/producer"

export async function POST() {
  await requireAuth()

  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n")
  if (!appId || !privateKey) {
    return NextResponse.json({ error: "GitHub App not configured" }, { status: 400 })
  }

  const auth = createAppAuth({ appId, privateKey })
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey },
  })

  // List all installations
  const { data: installations } = await appOctokit.apps.listInstallations()

  for (const installation of installations) {
    const installAuth = await auth({
      type: "installation",
      installationId: installation.id,
    })

    const installOctokit = new Octokit({ auth: installAuth.token })

    const { data: reposData } = await installOctokit.apps.listReposAccessibleToInstallation({ per_page: 100 })

    for (const repo of reposData.repositories) {
      const workspacePath = getWorkspacePath(repo.full_name)
      await db.repo.upsert({
        where: { owner_name: { owner: repo.owner.login, name: repo.name } },
        create: {
          owner: repo.owner.login,
          name: repo.name,
          fullName: repo.full_name,
          enabled: false, // requires explicit enable
          workspacePath,
          queueName: repoToQueueName(repo.full_name),
          githubInstallId: installation.id,
          defaultBranch: repo.default_branch ?? "main",
        },
        update: {
          fullName: repo.full_name,
          workspacePath,
          githubInstallId: installation.id,
          defaultBranch: repo.default_branch ?? "main",
        },
      })
    }
  }

  const count = await db.repo.count()
  return NextResponse.json({ ok: true, reposSynced: count })
}
