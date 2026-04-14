import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    // Migrations use this URL. For production PostgreSQL, set DATABASE_URL accordingly.
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});
