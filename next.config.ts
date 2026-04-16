import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next.js 16+ enables Turbopack by default. Declare an empty turbopack config to
  // indicate we're aware of the conflict — our webpack config is dev-only (watchOptions).
  turbopack: {},
  // Ignore directories that change at runtime (agent sessions, cloned repos, logs)
  // so the dev file watcher doesn't hot-reload when claude writes to them.
  // Use regex instead of globs — micromatch (used by webpack) doesn't reliably match
  // dotfiles/dotdirs with ** patterns when they appear at the project root.
  webpack: (config) => {
    const agentHome = path.resolve(__dirname, ".agent-home")
    const workspaces = path.resolve(__dirname, "workspaces")
    const logs      = path.resolve(__dirname, "logs")

    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        new RegExp(agentHome.replace(/[/\\]/g, "[/\\\\]")),
        new RegExp(workspaces.replace(/[/\\]/g, "[/\\\\]")),
        new RegExp(logs.replace(/[/\\]/g, "[/\\\\]")),
        /node_modules/,
      ],
    }
    return config
  },
};

export default nextConfig;
