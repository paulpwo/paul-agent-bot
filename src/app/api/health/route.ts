import { NextResponse } from "next/server";

export async function GET() {
  const checks: Record<string, "ok" | "error"> = {};

  // DB check
  try {
    const { db } = await import("@/lib/db/client");
    await db.$queryRaw`SELECT 1`;
    checks.db = "ok";
  } catch {
    checks.db = "error";
  }

  // Redis check
  try {
    const { redis } = await import("@/lib/redis/client");
    await redis.ping();
    checks.redis = "ok";
  } catch {
    checks.redis = "error";
  }

  const healthy = Object.values(checks).every((v) => v === "ok");

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks,
      ts: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}
