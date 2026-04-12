import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@verge/contracts": path.resolve(rootDir, "../../packages/contracts/src/index.ts"),
    },
  },
  server: {
    port: 4173,
  },
});
