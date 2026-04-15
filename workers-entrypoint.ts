// Local dev entrypoint for the BullMQ worker process.
// In production the Docker build compiles src/workers/index.ts → workers-entrypoint.js via esbuild.
// Locally, tsx runs this file which simply re-exports the same module.
import "./src/workers/index"
