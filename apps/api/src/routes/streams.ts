import type { FastifyInstance } from "fastify";

import { getRepositoryHealth, getRunDetail } from "@verge/db";

import type { ApiContext } from "../context.js";
import { sendSse } from "../utils.js";

export const registerStreamRoutes = (app: FastifyInstance, context: ApiContext): void => {
  app.get("/streams/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    sendSse(reply);
    const interval = setInterval(() => {
      void (async () => {
        try {
          const detail = await getRunDetail(context.connection.db, id);
          if (!detail) {
            reply.raw.write(
              `event: error\ndata: ${JSON.stringify({ message: "Run not found", statusCode: 404 })}\n\n`,
            );
            clearInterval(interval);
            reply.raw.end();
            return;
          }
          reply.raw.write(`data: ${JSON.stringify(detail)}\n\n`);
        } catch (error) {
          clearInterval(interval);
          app.log.error(error, `Run stream failed for ${id}`);
          reply.raw.end();
        }
      })();
    }, 2000);

    request.raw.on("close", () => clearInterval(interval));
    return reply;
  });

  app.get("/streams/repositories/:repo/health", async (request, reply) => {
    const { repo } = request.params as { repo: string };
    sendSse(reply);
    const interval = setInterval(() => {
      void (async () => {
        try {
          const detail = await getRepositoryHealth(context.connection.db, repo);
          reply.raw.write(`data: ${JSON.stringify(detail)}\n\n`);
        } catch (error) {
          clearInterval(interval);
          app.log.error(error, `Repository health stream failed for ${repo}`);
          reply.raw.end();
        }
      })();
    }, 2000);

    request.raw.on("close", () => clearInterval(interval));
    return reply;
  });
};
