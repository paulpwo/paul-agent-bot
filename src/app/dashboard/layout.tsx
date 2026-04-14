import { requireAuth } from "@/lib/auth/session"
import { Sidebar } from "@/components/dashboard/Sidebar"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAuth()

  return (
    <div className="h-screen bg-surface-base text-text-primary flex overflow-hidden">
      <Sidebar />
      {/* Main content */}
      <main className="flex-1 overflow-auto min-h-0 pt-12 lg:pt-0">{children}</main>
    </div>
  )
}
