import type { Provider } from "next-auth/providers/index"
import CredentialsProvider from "next-auth/providers/credentials"
import GitHubProvider from "next-auth/providers/github"
import { db } from "@/lib/db/client"
import { getSetting, SETTINGS_KEYS } from "@/lib/settings"

// Bootstrap provider — active only when BOOTSTRAP_ADMIN is set AND DB has no GitHub OAuth credentials
async function isBootstrapMode(): Promise<boolean> {
  if (!process.env.BOOTSTRAP_ADMIN) return false
  const clientId = await getSetting(SETTINGS_KEYS.GITHUB_OAUTH_CLIENT_ID).catch(() => null)
  return !clientId
}

export async function getProviders(): Promise<Provider[]> {
  const providers: Provider[] = []

  // GitHub OAuth provider — DB takes priority, env vars as fallback
  const clientId =
    (await getSetting(SETTINGS_KEYS.GITHUB_OAUTH_CLIENT_ID).catch(() => null)) ??
    process.env.GITHUB_OAUTH_CLIENT_ID ?? null
  const clientSecret =
    (await getSetting(SETTINGS_KEYS.GITHUB_OAUTH_CLIENT_SECRET).catch(() => null)) ??
    process.env.GITHUB_OAUTH_CLIENT_SECRET ?? null

  if (clientId && clientSecret) {
    providers.push(
      GitHubProvider({
        clientId,
        clientSecret,
      })
    )
  }

  // Bootstrap credentials provider (first-time setup)
  if (await isBootstrapMode()) {
    providers.push(
      CredentialsProvider({
        id: "bootstrap",
        name: "Bootstrap",
        credentials: {
          login: { label: "GitHub Login", type: "text" },
        },
        async authorize(credentials) {
          const login = credentials?.login?.trim()
          const bootstrapAdmin = process.env.BOOTSTRAP_ADMIN
          if (!login || login !== bootstrapAdmin) return null
          // Upsert the bootstrap admin user
          const user = await db.user.upsert({
            where: { githubLogin: login },
            create: { githubLogin: login, role: "admin" },
            update: { role: "admin" },
          })
          return { id: user.id, name: login, email: `${login}@github` }
        },
      })
    )
  }

  return providers
}
