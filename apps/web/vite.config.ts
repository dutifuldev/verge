import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const parseAllowedHosts = (...values: Array<string | undefined>): string[] => {
  const hosts = new Set(["localhost", "127.0.0.1", "::1"]);

  for (const value of values) {
    if (!value) {
      continue;
    }

    for (const candidate of value.split(",")) {
      const trimmed = candidate.trim();
      if (!trimmed) {
        continue;
      }

      try {
        hosts.add(new URL(trimmed).hostname);
        continue;
      } catch {}

      const host = trimmed.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!host) {
        continue;
      }

      if (host.startsWith("[")) {
        const bracketIndex = host.indexOf("]");
        hosts.add(bracketIndex === -1 ? host : host.slice(1, bracketIndex));
        continue;
      }

      const [hostname] = host.split(":");
      if (hostname) {
        hosts.add(hostname);
      }
    }
  }

  return [...hosts];
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@verge/contracts": path.resolve(rootDir, "../../packages/contracts/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    allowedHosts: parseAllowedHosts(
      process.env.VITE_ALLOWED_HOSTS,
      process.env.VERGE_ALLOWED_ORIGINS,
    ),
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
        rewrite: (pathValue) => pathValue.replace(/^\/api/, ""),
      },
    },
  },
});
