import { createAppAuth } from "@octokit/auth-app"

interface TokenCache {
  token: string
  expiresAt: number
}

const tokenCache = new Map<number, TokenCache>()

// Get a valid installation token, refreshing if within 5 minutes of expiry
export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId)
  const now = Date.now()

  // Refresh if missing or expiring in < 5 minutes
  if (!cached || cached.expiresAt - now < 5 * 60 * 1000) {
    const auth = createAppAuth({
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    })

    const result = await auth({
      type: "installation",
      installationId,
    })

    // GitHub installation tokens expire in 1 hour; we refresh at 55 min
    const expiresAt = now + 55 * 60 * 1000
    tokenCache.set(installationId, { token: result.token, expiresAt })
    return result.token
  }

  return cached.token
}

// Build an authenticated clone URL for a GitHub repo
export async function getAuthenticatedCloneUrl(repo: string, installationId: number): Promise<string> {
  const token = await getInstallationToken(installationId)
  return `https://x-access-token:${token}@github.com/${repo}.git`
}

// Proactively refresh token at 55-min mark during a long task
export async function startTokenRefreshCycle(
  installationId: number,
  onRefresh: (token: string) => void,
): Promise<() => void> {
  const interval = setInterval(async () => {
    try {
      const cached = tokenCache.get(installationId)
      if (cached && cached.expiresAt - Date.now() < 5 * 60 * 1000) {
        tokenCache.delete(installationId)
        const token = await getInstallationToken(installationId)
        onRefresh(token)
      }
    } catch (err) {
      console.error("[token-refresh] Failed to refresh:", err)
    }
  }, 60_000) // check every minute

  return () => clearInterval(interval)
}
