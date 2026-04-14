import NextAuth from "next-auth"
import { getProviders } from "@/lib/auth/providers"
import { db } from "@/lib/db/client"
import { getSetting, SETTINGS_KEYS } from "@/lib/settings"

async function getAllowlist(): Promise<string[]> {
  const raw = await getSetting(SETTINGS_KEYS.ALLOWLIST).catch(() => null)
  if (!raw) {
    // Fallback: env var or empty (no one can log in without allowlist)
    return process.env.BOOTSTRAP_ADMIN ? [process.env.BOOTSTRAP_ADMIN] : []
  }
  return JSON.parse(raw) as string[]
}

const handler = async (req: Request, context: { params: Promise<Record<string, string | string[]>> }) => {
  const providers = await getProviders()

  const authHandler = NextAuth({
    providers,
    callbacks: {
      async signIn({ user, account, profile }) {
        // For GitHub OAuth, check allowlist
        if (account?.provider === "github") {
          const login = (profile as { login?: string })?.login
          if (!login) return false
          const allowlist = await getAllowlist()
          if (!allowlist.includes(login)) return false
          // Upsert user in DB
          await db.user.upsert({
            where: { githubLogin: login },
            create: { githubLogin: login, role: "user" },
            update: {},
          })
        }
        return true
      },
      async session({ session, token }) {
        if (token.sub) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(session.user as any).id = token.sub
        }
        return session
      },
    },
    pages: {
      signIn: "/login",
      error: "/login",
    },
  })

  return authHandler(req, context)
}

export { handler as GET, handler as POST }
