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
      discoveryCommand: ["pnpm", "exec", "verge", "discover", "vitest", "--step", "test"],
    });
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
