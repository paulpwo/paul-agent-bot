import { db } from "@/lib/db/client"
import { requireAuth } from "@/lib/auth/session"
import { CronjobList } from "@/components/cronjobs/CronjobList"

export default async function CronjobsPage() {
  await requireAuth()

  const [jobs, repos] = await Promise.all([
    db.cronJob.findMany({ orderBy: { createdAt: "desc" } }),
    db.repo.findMany({ where: { enabled: true }, orderBy: { fullName: "asc" } }),
  ])

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-white tracking-tight mb-8">Cron Jobs</h1>
      <CronjobList initialJobs={jobs} repos={repos.map((r) => r.fullName)} />
    </div>
  )
}
