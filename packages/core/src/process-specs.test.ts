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
  const rootPath = "/tmp/verge";
  const repository = getSelfHostedRepositoryDefinition(rootPath);
  const processSpecs = getSelfHostedProcessSpecs(rootPath);

  it("materializes named test processes", () => {
    const testSpec = processSpecs.find((processSpec) => processSpec.key === "test");
    expect(testSpec).toBeDefined();

    const processes = materializeProcesses(testSpec!);
    expect(processes.map((process) => process.key)).toEqual(["api", "web", "worker", "packages"]);
  });

  it("derives area keys from changed files", () => {
    expect(
      deriveAreaKeysFromChangedFiles(repository, [
        "apps/api/src/index.ts",
        "docs/2026-04-12-verge-basic-objects.md",
      ]),
    ).toEqual(["api", "docs"]);
  });

  it("plans all baseline specs for a manual request", () => {
    const plans = planProcessSpecRuns({
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

  it("produces a stable execution fingerprint", () => {
    const firstProcessSpec = processSpecs[0];
    expect(firstProcessSpec).toBeDefined();

    const fingerprint = computeExecutionFingerprint(repository.slug, "abc123", firstProcessSpec!);

    expect(fingerprint).toHaveLength(64);
    expect(fingerprint).toBe(
      computeExecutionFingerprint(repository.slug, "abc123", firstProcessSpec!),
    );
  });
});
