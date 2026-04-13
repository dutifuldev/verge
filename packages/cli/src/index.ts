import { spawn } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const usage = `Usage:
  verge api [--config <path>]
  verge worker
  verge sync [--config <path>]
  verge discover vitest --step <step-key> [--config <path>]
`;

type RuntimePackageKey = "api" | "contracts" | "core" | "db" | "worker";

type RuntimePackage = {
  key: RuntimePackageKey;
  packageName: string;
  directory: string;
  distEntry: string;
};

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

const runtimePackages: Record<RuntimePackageKey, RuntimePackage> = {
  contracts: {
    key: "contracts",
    packageName: "@verge/contracts",
    directory: path.join(workspaceRoot, "packages/contracts"),
    distEntry: path.join(workspaceRoot, "packages/contracts/dist/index.js"),
  },
  core: {
    key: "core",
    packageName: "@verge/core",
    directory: path.join(workspaceRoot, "packages/core"),
    distEntry: path.join(workspaceRoot, "packages/core/dist/index.js"),
  },
  db: {
    key: "db",
    packageName: "@verge/db",
    directory: path.join(workspaceRoot, "packages/db"),
    distEntry: path.join(workspaceRoot, "packages/db/dist/index.js"),
  },
  api: {
    key: "api",
    packageName: "@verge/api",
    directory: path.join(workspaceRoot, "apps/api"),
    distEntry: path.join(workspaceRoot, "apps/api/dist/index.js"),
  },
  worker: {
    key: "worker",
    packageName: "@verge/worker",
    directory: path.join(workspaceRoot, "apps/worker"),
    distEntry: path.join(workspaceRoot, "apps/worker/dist/index.js"),
  },
};

const getFlagValue = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const requireFlagValue = (args: string[], flag: string): string => {
  const value = getFlagValue(args, flag);
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
};

const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const collectTrackedInputPaths = async (directory: string): Promise<string[]> => {
  const sourceDirectory = path.join(directory, "src");
  const tracked = [path.join(directory, "package.json"), path.join(directory, "tsconfig.json")];

  if (!(await fileExists(sourceDirectory))) {
    return tracked;
  }

  const queue = [sourceDirectory];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      tracked.push(entryPath);
    }
  }

  return tracked;
};

const getLatestInputMtimeMs = async (directory: string): Promise<number> => {
  const inputPaths = await collectTrackedInputPaths(directory);
  const mtimes = await Promise.all(
    inputPaths.map(async (inputPath) => {
      try {
        return (await stat(inputPath)).mtimeMs;
      } catch {
        return 0;
      }
    }),
  );

  return mtimes.reduce((latest, current) => Math.max(latest, current), 0);
};

const packageBuildIsCurrent = async (runtimePackage: RuntimePackage): Promise<boolean> => {
  if (!(await fileExists(runtimePackage.distEntry))) {
    return false;
  }

  const distMtimeMs = (await stat(runtimePackage.distEntry)).mtimeMs;
  return distMtimeMs >= (await getLatestInputMtimeMs(runtimePackage.directory));
};

const buildRuntimePackages = async (packageKeys: RuntimePackageKey[]): Promise<void> => {
  const uniquePackages = [...new Set(packageKeys)].map((packageKey) => runtimePackages[packageKey]);
  const stalePackages = [];

  for (const runtimePackage of uniquePackages) {
    if (!(await packageBuildIsCurrent(runtimePackage))) {
      stalePackages.push(runtimePackage);
    }
  }

  if (stalePackages.length === 0) {
    return;
  }

  const command = [
    "pnpm",
    "-r",
    "--workspace-concurrency=1",
    ...stalePackages.flatMap((runtimePackage) => ["--filter", runtimePackage.packageName]),
    "build",
  ];

  await new Promise<void>((resolve, reject) => {
    const [binary, ...args] = command;
    if (!binary) {
      reject(new Error("Missing build command"));
      return;
    }

    const child = spawn(binary, args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if ((code ?? 1) !== 0) {
        reject(new Error(`Failed to build Verge runtime packages (exit code ${code ?? 1})`));
        return;
      }
      resolve();
    });
  });
};

const loadApiModule = async () => {
  await buildRuntimePackages(["contracts", "core", "db", "api"]);
  return import("@verge/api");
};

const loadWorkerModule = async () => {
  await buildRuntimePackages(["contracts", "core", "worker"]);
  return import("@verge/worker");
};

const loadCoreModule = async () => {
  await buildRuntimePackages(["contracts", "core"]);
  return import("@verge/core");
};

const loadDbModule = async () => {
  await buildRuntimePackages(["contracts", "core", "db"]);
  return import("@verge/db");
};

const runApiCommand = async (args: string[]): Promise<void> => {
  const { bootstrapApiApp } = await loadApiModule();
  const { createDatabaseConnection } = await loadDbModule();
  const connection = createDatabaseConnection();
  const configPath = getFlagValue(args, "--config");
  const app = await bootstrapApiApp(
    connection,
    configPath
      ? {
          configPath: requireFlagValue(args, "--config"),
        }
      : undefined,
  );
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "127.0.0.1";

  await app.listen({ port, host });
  app.log.info(`Verge API listening on http://${host}:${port}`);
};

const runSyncCommand = async (args: string[]): Promise<void> => {
  const { loadVergeConfig, resolveVergeConfigPath } = await loadCoreModule();
  const {
    createDatabaseConnection,
    destroyDatabaseConnection,
    migrateDatabase,
    syncRepositoryConfiguration,
  } = await loadDbModule();
  const connection = createDatabaseConnection();
  const configPath = getFlagValue(args, "--config");

  try {
    const options = configPath ? { configPath } : undefined;
    const resolvedConfigPath = await resolveVergeConfigPath(options);
    const config = await loadVergeConfig(options);
    await migrateDatabase(connection.db);
    await syncRepositoryConfiguration(connection.db, config.repository, config.steps);
    process.stdout.write(`Synced ${config.repository.slug} from ${resolvedConfigPath}\n`);
  } finally {
    await destroyDatabaseConnection(connection);
  }
};

const runVitestDiscoveryCommand = async (args: string[]): Promise<void> => {
  const { discoverVitestProcesses, loadVergeConfig } = await loadCoreModule();
  const stepKey = requireFlagValue(args, "--step");
  const configPath = getFlagValue(args, "--config");
  const config = await loadVergeConfig(
    configPath
      ? {
          configPath: requireFlagValue(args, "--config"),
        }
      : undefined,
  );
  const step = config.steps.find((candidate) => candidate.key === stepKey);

  if (!step) {
    throw new Error(`Unknown step ${stepKey}`);
  }

  const processes = await discoverVitestProcesses({
    repository: config.repository,
    step,
  });
  process.stdout.write(`${JSON.stringify(processes, null, 2)}\n`);
};

const main = async (): Promise<void> => {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "api":
      await runApiCommand(args);
      return;
    case "worker":
      await (await loadWorkerModule()).runWorker();
      return;
    case "sync":
      await runSyncCommand(args);
      return;
    case "discover": {
      const [subcommand, ...rest] = args;
      if (subcommand === "vitest") {
        await runVitestDiscoveryCommand(rest);
        return;
      }
      break;
    }
    default:
      break;
  }

  process.stderr.write(`${usage}\n`);
  process.exitCode = 1;
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
