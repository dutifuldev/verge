import process from "node:process";

import { bootstrapApiApp } from "@verge/api";
import { discoverVitestProcesses, loadVergeConfig, resolveVergeConfigPath } from "@verge/core";
import {
  createDatabaseConnection,
  destroyDatabaseConnection,
  migrateDatabase,
  syncRepositoryConfiguration,
} from "@verge/db";
import { runWorker } from "@verge/worker";

const usage = `Usage:
  verge api [--config <path>]
  verge worker
  verge sync [--config <path>]
  verge discover vitest --step <step-key> [--config <path>]
`;

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

const runApiCommand = async (args: string[]): Promise<void> => {
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
      await runWorker();
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
