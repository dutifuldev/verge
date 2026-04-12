import { createDatabaseConnection, destroyDatabaseConnection, migrateDatabase } from "./index.js";

const main = async (): Promise<void> => {
  const connection = createDatabaseConnection();
  try {
    await migrateDatabase(connection.db);
    console.log("Database migrations applied.");
  } finally {
    await destroyDatabaseConnection(connection);
  }
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
