import path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  const dbProvider = process.env.DB_PROVIDER ?? "sqlite";

  const log: ("query" | "error" | "warn")[] =
    process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"];

  if (dbProvider === "sqlite") {
    // SQLite adapter for local development (Prisma 7 requires adapter pattern)
    // Normalize URL: strip "file:" prefix, then resolve to absolute path
    const rawPath = dbUrl.startsWith("file:") ? dbUrl.slice(5) : dbUrl;
    const filePath = path.resolve(rawPath);
    const adapter = new PrismaBetterSqlite3({ url: filePath });
    return new PrismaClient({ adapter, log });
  }

  // PostgreSQL adapter for production
  const adapter = new PrismaPg({ connectionString: dbUrl });
  return new PrismaClient({ adapter, log });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
