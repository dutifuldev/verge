import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@verge/contracts": path.resolve(rootDir, "packages/contracts/src/index.ts"),
      "@verge/core": path.resolve(rootDir, "packages/core/src/index.ts"),
      "@verge/db": path.resolve(rootDir, "packages/db/src/index.ts"),
    },
  },
  test: {
    passWithNoTests: false,
    projects: [
      {
        test: {
          name: "api",
          include: ["apps/api/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "worker",
          include: ["apps/worker/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "web",
          include: ["apps/web/src/**/*.test.ts?(x)"],
          environment: "jsdom",
        },
      },
      {
        test: {
          name: "packages",
          include: ["packages/*/src/**/*.test.ts"],
        },
      },
    ],
  },
});
