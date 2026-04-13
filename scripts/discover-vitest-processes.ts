import { spawn } from "node:child_process";
import path from "node:path";

import { getSelfHostedRepositoryDefinition } from "../packages/core/src/process-specs.js";

type VitestListedTest = {
  name: string;
  file: string;
  projectName?: string;
};

type DiscoveredProcess = {
  key: string;
  label: string;
  type: string;
  areaKeys: string[];
  filePath?: string;
  extraArgs: string[];
};

const workspaceRoot = process.cwd();

const runCommand = async (command: string[]): Promise<string> => {
  const [binary, ...args] = command;
  if (!binary) {
    throw new Error("Discovery command is empty");
  }

  return new Promise<string>((resolve, reject) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const child = spawn(binary, args, {
      cwd: workspaceRoot,
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

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeVitestFullName = (value: string): string => value.replaceAll(" > ", " ");

const deriveAreaKeys = (filePath: string): string[] => {
  const repository = getSelfHostedRepositoryDefinition(workspaceRoot);
  return repository.areas
    .filter((area) => area.pathPrefixes.some((prefix) => filePath.startsWith(prefix)))
    .map((area) => area.key);
};

const main = async (): Promise<void> => {
  const listedTests = JSON.parse(
    await runCommand(["pnpm", "exec", "vitest", "list", "--json", "--includeTaskLocation"]),
  ) as VitestListedTest[];

  const processes: DiscoveredProcess[] = listedTests.map((test) => {
    const relativeFilePath = path.relative(workspaceRoot, test.file);
    const runtimeFullName = normalizeVitestFullName(test.name);

    return {
      key: `${test.projectName ?? "default"}::${relativeFilePath}::${test.name}`,
      label: test.name,
      type: "test",
      areaKeys: deriveAreaKeys(relativeFilePath),
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

  process.stdout.write(`${JSON.stringify(processes, null, 2)}\n`);
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
