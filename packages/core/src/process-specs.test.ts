import { describe, expect, it } from "vitest";

import { planProcessSpecRuns } from "./planning.js";
import {
  computeExecutionFingerprint,
  deriveAreaKeysFromChangedFiles,
  getSelfHostedProcessSpecs,
  getSelfHostedRepositoryDefinition,
  materializeProcesses,
} from "./process-specs.js";

describe("process specs", () => {
  const rootPath = process.cwd();
  const repository = getSelfHostedRepositoryDefinition(rootPath);
  const processSpecs = getSelfHostedProcessSpecs(rootPath);

  it("materializes individual test processes", async () => {
    const testSpec = processSpecs.find((processSpec) => processSpec.key === "test");
    expect(testSpec).toBeDefined();

    const processes = await materializeProcesses(testSpec!);
    expect(processes.length).toBeGreaterThan(0);
    expect(processes.every((process) => process.type === "test")).toBe(true);
    expect(
      processes.some(
        (process) => process.label === "statusTone > maps successful states to the good tone",
      ),
    ).toBe(true);
    expect(processes.some((process) => process.filePath === "apps/web/src/App.test.tsx")).toBe(
      true,
    );
  });

  it("derives area keys from changed files", () => {
    expect(
      deriveAreaKeysFromChangedFiles(repository, [
        "apps/api/src/index.ts",
        "docs/2026-04-12-verge-basic-objects.md",
      ]),
    ).toEqual(["api", "docs"]);
  });

  it("plans all baseline specs for a manual request", async () => {
    const plans = await planProcessSpecRuns({
      repositorySlug: repository.slug,
      processSpecs,
      changedFiles: ["apps/api/src/index.ts"],
      repository: {
        slug: repository.slug,
        areas: repository.areas.map((area) => ({
          key: area.key,
          pathPrefixes: area.pathPrefixes,
        })),
      },
      commitSha: "abc123",
    });

    expect(plans.map((plan) => plan.processSpec.key)).toEqual([
      "format-check",
      "lint",
      "typecheck",
      "test",
      "build",
      "docs-validate",
    ]);
  });

  it("produces a stable execution fingerprint for discovered processes", async () => {
    const testSpec = processSpecs.find((processSpec) => processSpec.key === "test");
    expect(testSpec).toBeDefined();

    const firstMaterialization = await materializeProcesses(testSpec!);
    const secondMaterialization = await materializeProcesses(testSpec!);
    const fingerprint = computeExecutionFingerprint(
      repository.slug,
      "abc123",
      testSpec!,
      firstMaterialization,
    );

    expect(fingerprint).toHaveLength(64);
    expect(fingerprint).toBe(
      computeExecutionFingerprint(repository.slug, "abc123", testSpec!, secondMaterialization),
    );
  });
});
