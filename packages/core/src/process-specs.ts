import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

import type { ProcessDefinition, ProcessSpec, RepositoryDefinition } from "@verge/contracts";

export type MaterializedProcess = {
  key: string;
  label: string;
  areaKeys: string[];
  filePath?: string;
  type: string;
  command: string[];
};

export const getSelfHostedRepositoryDefinition = (rootPath: string): RepositoryDefinition => ({
  slug: "verge",
  displayName: "Verge",
  rootPath,
  defaultBranch: "main",
  areas: [
    { key: "api", displayName: "API", pathPrefixes: ["apps/api/"] },
    { key: "web", displayName: "Web", pathPrefixes: ["apps/web/"] },
    { key: "worker", displayName: "Worker", pathPrefixes: ["apps/worker/"] },
    {
      key: "packages",
      displayName: "Packages",
      pathPrefixes: ["packages/"],
    },
    { key: "docs", displayName: "Docs", pathPrefixes: ["docs/"] },
    {
      key: "infra",
      displayName: "Infra",
      pathPrefixes: ["infra/", "scripts/"],
    },
  ],
});

const named = (
  key: string,
  label: string,
  areaKeys: string[],
  extraArgs: string[] = [],
  filePath?: string,
): ProcessDefinition => ({
  key,
  label,
  areaKeys,
  extraArgs,
  ...(filePath ? { filePath } : {}),
  type: "named",
});

export const getSelfHostedProcessSpecs = (rootPath: string): ProcessSpec[] => [
  {
    key: "format-check",
    displayName: "Format Check",
    description: "Verifies repository formatting.",
    kind: "format",
    baseCommand: ["pnpm", "format:check"],
    cwd: rootPath,
    observedAreaKeys: ["api", "web", "worker", "packages", "docs", "infra"],
    materialization: {
      kind: "singleProcess",
      process: named("format-check", "Format Check", [
        "api",
        "web",
        "worker",
        "packages",
        "docs",
        "infra",
      ]),
    },
    reuseEnabled: true,
    checkpointEnabled: false,
    alwaysRun: true,
  },
  {
    key: "lint",
    displayName: "Lint",
    description: "Runs oxlint across the workspace.",
    kind: "lint",
    baseCommand: ["pnpm", "lint"],
    cwd: rootPath,
    observedAreaKeys: ["api", "web", "worker", "packages", "infra"],
    materialization: {
      kind: "singleProcess",
      process: named("lint", "Workspace Lint", ["api", "web", "worker", "packages", "infra"]),
    },
    reuseEnabled: true,
    checkpointEnabled: false,
    alwaysRun: true,
  },
  {
    key: "typecheck",
    displayName: "Typecheck",
    description: "Runs TypeScript validation across the workspace.",
    kind: "typecheck",
    baseCommand: ["pnpm", "typecheck"],
    cwd: rootPath,
    observedAreaKeys: ["api", "web", "worker", "packages"],
    materialization: {
      kind: "singleProcess",
      process: named("typecheck", "Workspace Typecheck", ["api", "web", "worker", "packages"]),
    },
    reuseEnabled: true,
    checkpointEnabled: false,
    alwaysRun: true,
  },
  {
    key: "test",
    displayName: "Tests",
    description: "Runs individual Vitest tests for the Verge workspace.",
    kind: "test",
    baseCommand: ["pnpm", "exec", "vitest", "run"],
    cwd: rootPath,
    observedAreaKeys: ["api", "web", "worker", "packages"],
    materialization: {
      kind: "discoveredProcesses",
      discoveryCommand: ["pnpm", "exec", "tsx", "scripts/discover-vitest-processes.ts"],
    },
    reuseEnabled: true,
    checkpointEnabled: true,
    alwaysRun: true,
  },
  {
    key: "build",
    displayName: "Build",
    description: "Builds all Verge packages and apps.",
    kind: "build",
    baseCommand: ["pnpm", "build"],
    cwd: rootPath,
    observedAreaKeys: ["api", "web", "worker", "packages"],
    materialization: {
      kind: "singleProcess",
      process: named("build", "Workspace Build", ["api", "web", "worker", "packages"]),
    },
    reuseEnabled: true,
    checkpointEnabled: false,
    alwaysRun: true,
  },
  {
    key: "docs-validate",
    displayName: "Docs Validate",
    description: "Validates docs frontmatter and links.",
    kind: "docs",
    baseCommand: ["pnpm", "docs:validate"],
    cwd: rootPath,
    observedAreaKeys: ["docs"],
    materialization: {
      kind: "singleProcess",
      process: named("docs-validate", "Docs Validation", ["docs"]),
    },
    reuseEnabled: true,
    checkpointEnabled: false,
    alwaysRun: true,
  },
];

const runJsonCommand = async <T>(command: string[], cwd: string): Promise<T> => {
  const [binary, ...args] = command;
  if (!binary) {
    throw new Error("Discovery command is empty");
  }

  const output = await new Promise<string>((resolve, reject) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const child = spawn(binary, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer | string) => stdout.push(String(chunk)));
    child.stderr?.on("data", (chunk: Buffer | string) => stderr.push(String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if ((code ?? 1) !== 0) {
        reject(
          new Error(`Discovery command failed with code ${code ?? 1}: ${stderr.join("").trim()}`),
        );
        return;
      }

      resolve(stdout.join(""));
    });
  });

  return JSON.parse(output) as T;
};

export const materializeProcesses = async (
  processSpec: ProcessSpec,
): Promise<MaterializedProcess[]> => {
  const materialization = processSpec.materialization;

  switch (materialization.kind) {
    case "singleProcess":
      return [materializeNamed(processSpec, materialization.process)];
    case "namedProcesses":
      return materialization.processes.map((processDefinition) =>
        materializeNamed(processSpec, processDefinition),
      );
    case "discoveredProcesses": {
      const discovered = await runJsonCommand<ProcessDefinition[]>(
        materialization.discoveryCommand,
        processSpec.cwd,
      );
      return discovered.map((processDefinition) =>
        materializeNamed(processSpec, processDefinition),
      );
    }
    case "fixedShards":
      return Array.from({ length: materialization.count }, (_, index) => {
        const shard = index + 1;
        return {
          key: `shard-${shard}`,
          label: `${materialization.labelPrefix} ${shard}/${materialization.count}`,
          areaKeys: materialization.areaKeys,
          type: "shard",
          command: [
            ...processSpec.baseCommand,
            ...materialization.extraArgsTemplate.map((segment: string) =>
              segment
                .replaceAll("{index}", String(shard))
                .replaceAll("{count}", String(materialization.count)),
            ),
          ],
        };
      });
  }
};

const materializeNamed = (
  processSpec: ProcessSpec,
  definition: ProcessDefinition,
): MaterializedProcess => ({
  key: definition.key,
  label: definition.label,
  areaKeys: definition.areaKeys,
  ...(definition.filePath ? { filePath: definition.filePath } : {}),
  type: definition.type,
  command: [...processSpec.baseCommand, ...definition.extraArgs],
});

export const deriveAreaKeysFromChangedFiles = (
  repository: RepositoryDefinition,
  changedFiles: string[],
): string[] => {
  if (changedFiles.length === 0) {
    return repository.areas.map((area) => area.key);
  }

  const areaKeys = new Set<string>();

  for (const filePath of changedFiles) {
    for (const area of repository.areas) {
      if (area.pathPrefixes.some((prefix) => filePath.startsWith(prefix))) {
        areaKeys.add(area.key);
      }
    }
  }

  return areaKeys.size > 0 ? [...areaKeys] : repository.areas.map((area) => area.key);
};

export const isProcessSpecRelevant = (
  processSpec: ProcessSpec,
  changedAreaKeys: string[],
): boolean => {
  if (processSpec.alwaysRun) {
    return true;
  }

  return processSpec.observedAreaKeys.some((areaKey) => changedAreaKeys.includes(areaKey));
};

export const computeExecutionFingerprint = (
  repositorySlug: string,
  commitSha: string,
  processSpec: ProcessSpec,
  materializedProcesses?: MaterializedProcess[],
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        repositorySlug,
        commitSha,
        processSpec,
        materializedProcesses: materializedProcesses?.map((process) => ({
          key: process.key,
          label: process.label,
          areaKeys: process.areaKeys,
          filePath: process.filePath ?? null,
          type: process.type,
          command: process.command,
        })),
      }),
    )
    .digest("hex");

export const determineFreshnessBucket = (
  lastObservedAt: Date | null,
  now: Date,
): "fresh" | "stale" | "unknown" => {
  if (!lastObservedAt) {
    return "unknown";
  }

  const elapsedMs = now.getTime() - lastObservedAt.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  return elapsedMs <= dayMs ? "fresh" : "stale";
};

export const normalizeRepoPath = (rootPath: string, targetPath: string): string =>
  path.relative(rootPath, targetPath).split(path.sep).join("/");
