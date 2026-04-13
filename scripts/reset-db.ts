import {
  createDatabaseConnection,
  destroyDatabaseConnection,
  resetDatabase,
} from "../packages/db/src/index.js";

const main = async (): Promise<void> => {
  const connection = createDatabaseConnection(process.env.DATABASE_URL);
  await resetDatabase(connection.db);
  await destroyDatabaseConnection(connection);
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
