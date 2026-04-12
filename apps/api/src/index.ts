import { createDatabaseConnection } from "@verge/db";

import { bootstrapApiApp } from "./app.js";

const main = async (): Promise<void> => {
  const connection = createDatabaseConnection();
  const app = await bootstrapApiApp(connection);
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "127.0.0.1";

  await app.listen({ port, host });
  app.log.info(`Verge API listening on http://${host}:${port}`);
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
