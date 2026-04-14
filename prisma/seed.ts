import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const bootstrapAdmin = process.env.BOOTSTRAP_ADMIN
  if (!bootstrapAdmin) {
    console.log("No BOOTSTRAP_ADMIN set — skipping seed")
    return
  }

  await prisma.user.upsert({
    where: { githubLogin: bootstrapAdmin },
    create: { githubLogin: bootstrapAdmin, role: "admin" },
    update: { role: "admin" },
  })

  console.log(`Seeded admin user: ${bootstrapAdmin}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
