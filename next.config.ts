import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Ignore directories that change at runtime (agent sessions, cloned repos, logs)
  // so the dev file watcher doesn't hot-reload when claude writes to them.
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/.agent-home/**",
        "**/workspaces/**",
        "**/logs/**",
        "**/node_modules/**",
      ],
    }
    return config
  },
};

export default nextConfig;
