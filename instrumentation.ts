export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Only start workers in the web process if not running as dedicated worker
    if (process.env.WORKER_ONLY !== "true") {
      const { startWorkers } = await import("./src/workers/index");
      await startWorkers();
    }
  }
}
