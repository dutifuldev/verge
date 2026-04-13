import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createVitestStep, loadVergeConfig, resolveVergeConfigPath } from "./config.js";

describe("verge config", () => {
  it("resolves the repo config from the workspace root", async () => {
    const configPath = await resolveVergeConfigPath({ startDir: process.cwd() });

    expect(configPath.endsWith("verge.config.ts")).toBe(true);
  });

  it("loads the repo config and normalizes paths", async () => {
    const config = await loadVergeConfig({ startDir: process.cwd() });
    const testStep = config.steps.find((step) => step.key === "test");

    expect(config.repository.slug).toBe("verge");
    expect(config.repository.rootPath).toBe(process.cwd());
    expect(testStep?.materialization.kind).toBe("discoveredProcesses");
    expect(testStep?.cwd).toBe(process.cwd());
    expect(testStep?.materialization).toMatchObject({
      kind: "discoveredProcesses",
      discoveryCommand: [
        "pnpm",
        "exec",
        "verge",
        "discover",
        "vitest",
        "--step",
        "test",
        "--config",
        "verge.config.ts",
      ],
    });
  });

  it("normalizes discovered-process commands for an explicit config path", async () => {
    const repositoryRoot = process.cwd();
    const tempDirectory = await mkdtemp(path.join(repositoryRoot, ".verge-config-"));
    const configPath = path.join(tempDirectory, "custom.verge.config.ts");

    try {
      await writeFile(
        configPath,
        `import baseConfig from "../verge.config.ts";

export default {
  ...baseConfig,
  steps: baseConfig.steps.map((step) =>
    step.key === "test"
      ? {
          ...step,
          key: "alt-test",
          materialization: {
            ...step.materialization,
            discoveryCommand: ["pnpm", "exec", "verge", "discover", "vitest", "--step", "alt-test"],
          },
        }
      : step,
  ),
};
`,
      );

      const config = await loadVergeConfig({ configPath });
      const testStep = config.steps.find((step) => step.key === "alt-test");

      expect(testStep?.materialization).toMatchObject({
        kind: "discoveredProcesses",
        discoveryCommand: [
          "pnpm",
          "exec",
          "verge",
          "discover",
          "vitest",
          "--step",
          "alt-test",
          "--config",
          path.relative(repositoryRoot, configPath),
        ],
      });
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("builds vitest steps with CLI-backed discovery", () => {
    const step = createVitestStep({
      key: "test",
      displayName: "Tests",
      description: "Runs tests.",
      observedAreaKeys: ["packages"],
    });

    expect(step.baseCommand).toEqual(["pnpm", "exec", "vitest", "run"]);
    expect(step.materialization).toMatchObject({
      kind: "discoveredProcesses",
      discoveryCommand: ["pnpm", "exec", "verge", "discover", "vitest", "--step", "test"],
    });
  });
});
