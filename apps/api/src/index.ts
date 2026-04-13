import { pathToFileURL } from "node:url";

import { createDatabaseConnection } from "@verge/db";

import { bootstrapApiApp } from "./app.js";

export const startApiServer = async (): Promise<void> => {
  const connection = createDatabaseConnection();
  const app = await bootstrapApiApp(connection);
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "127.0.0.1";

  await app.listen({ port, host });
  app.log.info(`Verge API listening on http://${host}:${port}`);
};

export { bootstrapApiApp } from "./app.js";

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void startApiServer().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
