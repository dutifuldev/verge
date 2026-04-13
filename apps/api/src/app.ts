import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyRawBody from "fastify-raw-body";
import { loadVergeConfig } from "@verge/core";
import { migrateDatabase, syncRepositoryConfiguration, type DatabaseConnection } from "@verge/db";

import type { ApiContext } from "./context.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerStreamRoutes } from "./routes/streams.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerWorkerRoutes } from "./routes/workers.js";

const registerCors = async (app: FastifyInstance): Promise<void> => {
  const allowedOrigins = (
    process.env.VERGE_ALLOWED_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed"), false);
    },
  });
};

const registerRawBody = async (app: FastifyInstance): Promise<void> => {
  await app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    routes: ["/webhooks/github"],
    runFirst: true,
  });
};

export const createApiApp = async (context: ApiContext): Promise<FastifyInstance> => {
  const app = Fastify({ logger: true });

  await registerCors(app);
  await registerRawBody(app);

  registerPublicRoutes(app, context);
  registerWebhookRoutes(app, context);
  registerWorkerRoutes(app, context);
  registerStreamRoutes(app, context);

  return app;
};

export const bootstrapApiApp = async (
  connection: DatabaseConnection,
  input?: {
    configPath?: string;
  },
): Promise<FastifyInstance> => {
  const config = await loadVergeConfig(input);

  await migrateDatabase(connection.db);
  await syncRepositoryConfiguration(connection.db, config.repository, config.steps);

  return createApiApp({
    connection,
    repositorySlug: config.repository.slug,
    repositoryDefinition: {
      slug: config.repository.slug,
      areas: config.repository.areas.map((area) => ({
        key: area.key,
        pathPrefixes: area.pathPrefixes,
      })),
    },
  });
};
