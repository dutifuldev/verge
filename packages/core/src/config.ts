import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  ProcessDefinition,
  ProcessSpec,
  RepositoryDefinition,
  VergeConfig,
} from "@verge/contracts";
import { vergeConfigSchema } from "@verge/contracts";
import { tsImport } from "tsx/esm/api";

import {
  getSelfHostedProcessSpecs,
  getSelfHostedRepositoryDefinition,
  type MaterializedProcess,
} from "./process-specs.js";
import { resolveWorkspaceRoot } from "./filesystem.js";

type LoadVergeConfigInput = {
  startDir?: string;
  configPath?: string;
};

const configFileNames = [
  "verge.config.ts",
  "verge.config.mts",
  "verge.config.js",
  "verge.config.mjs",
];

export const defineVergeConfig = (config: VergeConfig): VergeConfig =>
  vergeConfigSchema.parse(config);

export const createVitestStep = (input: {
  key: string;
  displayName: string;
  description: string;
  cwd?: string;
  observedAreaKeys: string[];
  reuseEnabled?: boolean;
  checkpointEnabled?: boolean;
  alwaysRun?: boolean;
  baseCommand?: string[];
}): ProcessSpec => ({
  key: input.key,
  displayName: input.displayName,
  description: input.description,
  kind: "test",
  baseCommand: input.baseCommand ?? ["pnpm", "exec", "vitest", "run"],
  cwd: input.cwd ?? ".",
  observedAreaKeys: input.observedAreaKeys,
  materialization: {
    kind: "discoveredProcesses",
    discoveryCommand: ["pnpm", "exec", "verge", "discover", "vitest", "--step", input.key],
  },
  reuseEnabled: input.reuseEnabled ?? true,
  checkpointEnabled: input.checkpointEnabled ?? true,
  alwaysRun: input.alwaysRun ?? true,
});

export const createSelfHostedVergeConfig = (rootPath: string): VergeConfig =>
  defineVergeConfig({
    repository: getSelfHostedRepositoryDefinition(rootPath),
    steps: getSelfHostedProcessSpecs(rootPath),
  });

export const resolveVergeConfigPath = async ({
  startDir = process.cwd(),
  configPath,
}: LoadVergeConfigInput = {}): Promise<string> => {
  if (configPath) {
    return path.resolve(startDir, configPath);
  }

  const current = await resolveWorkspaceRoot(startDir);

  for (const fileName of configFileNames) {
    const candidate = path.join(current, fileName);
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(`Unable to locate a Verge config file from ${startDir}`);
};

export const loadVergeConfig = async (input: LoadVergeConfigInput = {}): Promise<VergeConfig> => {
  const configPath = await resolveVergeConfigPath(input);
  const configDirectory = path.dirname(configPath);
  const imported = await tsImport(pathToFileURL(configPath).href, import.meta.url);
  const candidate = imported.default ?? imported.vergeConfig ?? imported.config;
  const parsed = vergeConfigSchema.parse(candidate);
  const repositoryRoot = path.resolve(configDirectory, parsed.repository.rootPath);

  return {
    repository: {
      ...parsed.repository,
      rootPath: repositoryRoot,
    },
    steps: parsed.steps.map((step) => ({
      ...step,
      cwd: path.resolve(repositoryRoot, step.cwd),
    })),
  };
};

export const deriveAreaKeysForPath = (
  repository: RepositoryDefinition,
  filePath: string,
): string[] =>
  repository.areas
    .filter((area) => area.pathPrefixes.some((prefix) => filePath.startsWith(prefix)))
    .map((area) => area.key);

const spawnCommand = async (command: string[], cwd: string): Promise<string> => {
  const { spawn } = await import("node:child_process");
  const [binary, ...args] = command;
  if (!binary) {
    throw new Error("Discovery command is empty");
  }

  return new Promise<string>((resolve, reject) => {
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
        reject(new Error(stderr.join("").trim() || `Command failed with code ${code ?? 1}`));
        return;
      }

      resolve(stdout.join(""));
    });
  });
};

type VitestListedTest = {
  name: string;
  file: string;
  projectName?: string;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeVitestFullName = (value: string): string => value.replaceAll(" > ", " ");

export const discoverVitestProcesses = async (input: {
  repository: RepositoryDefinition;
  step: ProcessSpec;
}): Promise<ProcessDefinition[]> => {
  const listCommand = [...input.step.baseCommand];
  const runIndex = listCommand.lastIndexOf("run");

  if (runIndex >= 0) {
    listCommand.splice(runIndex, 1, "list", "--json", "--includeTaskLocation");
  } else {
    listCommand.push("list", "--json", "--includeTaskLocation");
  }

  const listedTests = JSON.parse(
    await spawnCommand(listCommand, input.step.cwd),
  ) as VitestListedTest[];

  return listedTests.map((test) => {
    const relativeFilePath = path.relative(input.repository.rootPath, test.file);
    const runtimeFullName = normalizeVitestFullName(test.name);

    return {
      key: `${test.projectName ?? "default"}::${relativeFilePath}::${test.name}`,
      label: test.name,
      type: "test",
      areaKeys: deriveAreaKeysForPath(input.repository, relativeFilePath),
      filePath: relativeFilePath,
      extraArgs: [
        relativeFilePath,
        "--project",
        test.projectName ?? "default",
        "--testNamePattern",
        `^${escapeRegex(runtimeFullName)}$`,
      ],
    };
  });
};

export const materializedToDefinitions = (processes: MaterializedProcess[]): ProcessDefinition[] =>
  processes.map((process) => ({
    key: process.key,
    label: process.label,
    areaKeys: process.areaKeys,
    extraArgs: [],
    ...(process.filePath ? { filePath: process.filePath } : {}),
    type: process.type,
  }));
