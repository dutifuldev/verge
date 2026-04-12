import { access } from "node:fs/promises";
import path from "node:path";

export const resolveWorkspaceRoot = async (startDir = process.cwd()): Promise<string> => {
  let current = path.resolve(startDir);

  while (true) {
    const candidate = path.join(current, "pnpm-workspace.yaml");
    try {
      await access(candidate);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error("Unable to locate workspace root");
      }
      current = parent;
    }
  }
};
