import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
  redisSub: Redis | undefined;
};

function createClient() {
  const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  client.on("error", (err) => {
    console.error("[redis] Connection error:", err.message);
  });

  return client;
}

// Command client (regular operations)
export const redis = globalForRedis.redis ?? createClient();

// Subscriber client (cannot share connection with command client)
export const redisSub = globalForRedis.redisSub ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
  globalForRedis.redisSub = redisSub;
}
