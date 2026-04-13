import type { FastifyInstance } from "fastify";

import {
  githubWebhookPullRequestPayloadSchema,
  githubWebhookPushPayloadSchema,
} from "@verge/contracts";
import {
  createEventIngestion,
  getRepositoryBySlug,
  getRepositoryDefinitionBySlug,
} from "@verge/db";

import type { ApiContext } from "../context.js";
import { createPlannedRun } from "../planning.js";
import { collectChangedFilesFromPushPayload, validateGitHubSignature } from "../utils.js";

export const registerWebhookRoutes = (app: FastifyInstance, context: ApiContext): void => {
  const deriveRepositorySlug = (fullName: string): string => {
    const segments = fullName.split("/");
    return segments[segments.length - 1] ?? fullName;
  };

  app.post("/webhooks/github", { config: { rawBody: true } }, async (request, reply) => {
    const deliveryId = String(request.headers["x-github-delivery"] ?? "");
    const eventName = String(request.headers["x-github-event"] ?? "");
    const signatureHeader = request.headers["x-hub-signature-256"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const rawBody =
      "rawBody" in request && typeof request.rawBody === "string" ? request.rawBody : undefined;

    if (!deliveryId || !eventName) {
      return reply.code(400).send({ message: "Missing GitHub delivery metadata" });
    }

    if (
      !process.env.GITHUB_WEBHOOK_SECRET &&
      process.env.VERGE_ALLOW_UNVERIFIED_GITHUB_WEBHOOKS !== "1"
    ) {
      return reply.code(503).send({ message: "GitHub webhook secret is not configured" });
    }

    if (!validateGitHubSignature(process.env.GITHUB_WEBHOOK_SECRET, rawBody, signature)) {
      return reply.code(401).send({ message: "Invalid webhook signature" });
    }

    if (eventName === "push") {
      const payload = githubWebhookPushPayloadSchema.parse(request.body);
      const repositorySlug = deriveRepositorySlug(payload.repository.full_name);
      const repository = await getRepositoryBySlug(context.connection.db, repositorySlug);
      const repositoryDefinition = await getRepositoryDefinitionBySlug(
        context.connection.db,
        repositorySlug,
      );

      if (!repository || !repositoryDefinition) {
        return reply.code(404).send({ message: "Repository not found" });
      }

      const result = await context.connection.db.transaction().execute(async (trx) => {
        const { eventIngestion, inserted } = await createEventIngestion(trx, {
          repositoryId: repository.id,
          source: "github",
          deliveryId,
          eventName,
          payload: request.body,
        });

        if (!inserted) {
          return { duplicate: true } as const;
        }

        await createPlannedRun(trx, repository, repositoryDefinition, {
          trigger: "push",
          commitSha: payload.after,
          branch: payload.ref.replace("refs/heads/", ""),
          changedFiles: collectChangedFilesFromPushPayload(payload),
          eventIngestionId: eventIngestion.id,
        });
        return { duplicate: false, trigger: "push" } as const;
      });

      if (result.duplicate) {
        return reply.code(202).send({ ok: true, duplicate: true });
      }

      return reply.code(202).send({ ok: true, ...result });
    }

    if (eventName === "pull_request") {
      const payload = githubWebhookPullRequestPayloadSchema.parse(request.body);
      const repositorySlug = deriveRepositorySlug(payload.repository.full_name);
      const repository = await getRepositoryBySlug(context.connection.db, repositorySlug);
      const repositoryDefinition = await getRepositoryDefinitionBySlug(
        context.connection.db,
        repositorySlug,
      );

      if (!repository || !repositoryDefinition) {
        return reply.code(404).send({ message: "Repository not found" });
      }

      const result = await context.connection.db.transaction().execute(async (trx) => {
        const { eventIngestion, inserted } = await createEventIngestion(trx, {
          repositoryId: repository.id,
          source: "github",
          deliveryId,
          eventName,
          payload: request.body,
        });

        if (!inserted) {
          return { duplicate: true } as const;
        }

        if (!["opened", "reopened", "synchronize"].includes(payload.action)) {
          return {
            duplicate: false,
            ignored: true,
            action: payload.action,
          } as const;
        }

        await createPlannedRun(trx, repository, repositoryDefinition, {
          trigger: "pull_request",
          commitSha: payload.pull_request.head.sha,
          branch: payload.pull_request.head.ref,
          changedFiles: [],
          pullRequestNumber: payload.number,
          eventIngestionId: eventIngestion.id,
        });
        return { duplicate: false, trigger: "pull_request" } as const;
      });

      if (result.duplicate) {
        return reply.code(202).send({ ok: true, duplicate: true });
      }

      return reply.code(202).send({ ok: true, ...result });
    }

    return reply.code(202).send({ ok: true, ignored: true, eventName });
  });
};
