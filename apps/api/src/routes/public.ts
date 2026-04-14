import type { FastifyInstance } from "fastify";

import {
  commitListQuerySchema,
  createManualRunInputSchema,
  runListQuerySchema,
} from "@verge/contracts";
import {
  getCommitDetail,
  getCommitTreemap,
  getRepositoryDefinitionBySlug,
  getPullRequestDetail,
  getRepositoryBySlug,
  getRepositoryHealth,
  getRunDetail,
  getRunTreemap,
  getStepRunDetail,
  listRepositoryCommits,
  listRepositories,
  listRepositoryRuns,
  listStepSpecSummaries,
} from "@verge/db";

import type { ApiContext } from "../context.js";
import { createPlannedRun } from "../planning.js";
import { resolveCommitMetadataMap } from "../utils.js";

export const registerPublicRoutes = (app: FastifyInstance, context: ApiContext): void => {
  app.get("/healthz", async () => ({ ok: true }));

  app.get("/repositories", async () => listRepositories(context.connection.db));

  app.get("/repositories/:repo/step-specs", async (request) =>
    listStepSpecSummaries(context.connection.db, (request.params as { repo: string }).repo),
  );

  app.post("/runs/manual", async (request, reply) => {
    const input = createManualRunInputSchema.parse(request.body);
    const repository = await getRepositoryBySlug(context.connection.db, input.repositorySlug);
    const repositoryDefinition = await getRepositoryDefinitionBySlug(
      context.connection.db,
      input.repositorySlug,
    );

    if (!repository || !repositoryDefinition) {
      return reply.code(404).send({ message: "Repository not found" });
    }

    return createPlannedRun(context.connection.db, repository, repositoryDefinition, {
      trigger: "manual",
      commitSha: input.commitSha,
      ...(input.changedFiles ? { changedFiles: input.changedFiles } : {}),
      ...(input.requestedStepKeys ? { requestedStepKeys: input.requestedStepKeys } : {}),
      ...(input.resumeFromCheckpoint ? { resumeFromCheckpoint: input.resumeFromCheckpoint } : {}),
      ...(input.disableReuse ? { disableReuse: input.disableReuse } : {}),
      ...(input.branch ? { branch: input.branch } : {}),
    });
  });

  app.get("/runs/:id", async (request, reply) => {
    const detail = await getRunDetail(context.connection.db, (request.params as { id: string }).id);
    if (!detail) {
      return reply.code(404).send({ message: "Run not found" });
    }
    return detail;
  });

  app.get("/runs/:id/treemap", async (request, reply) => {
    const treemap = await getRunTreemap(
      context.connection.db,
      (request.params as { id: string }).id,
    );
    if (!treemap) {
      return reply.code(404).send({ message: "Run not found" });
    }
    return treemap;
  });

  app.get("/runs/:runId/steps/:stepId", async (request, reply) => {
    const { runId, stepId } = request.params as { runId: string; stepId: string };
    const detail = await getStepRunDetail(context.connection.db, stepId);
    if (!detail) {
      return reply.code(404).send({ message: "Step not found" });
    }
    if (detail.runId !== runId) {
      return reply.code(404).send({ message: "Step not found for run" });
    }
    return detail;
  });

  app.get("/repositories/:repo/health", async (request) =>
    getRepositoryHealth(context.connection.db, (request.params as { repo: string }).repo),
  );

  app.get("/repositories/:repo/areas", async (request) => {
    const health = await getRepositoryHealth(
      context.connection.db,
      (request.params as { repo: string }).repo,
    );
    return health.areaStates;
  });

  app.get("/repositories/:repo/runs", async (request) =>
    listRepositoryRuns(
      context.connection.db,
      (request.params as { repo: string }).repo,
      runListQuerySchema.parse(request.query),
    ),
  );

  app.get("/repositories/:repo/commits", async (request, reply) => {
    const repo = (request.params as { repo: string }).repo;
    const repository = await getRepositoryBySlug(context.connection.db, repo);
    if (!repository) {
      return reply.code(404).send({ message: "Repository not found" });
    }

    const commitsPage = await listRepositoryCommits(
      context.connection.db,
      repo,
      commitListQuerySchema.parse(request.query),
    );
    const metadataByCommit = await resolveCommitMetadataMap(
      repository.root_path,
      commitsPage.items.map((item) => ({
        commitSha: item.commitSha,
        fallbackTitle: item.commitTitle,
      })),
    );

    return {
      ...commitsPage,
      items: commitsPage.items.map((item) => {
        const metadata = metadataByCommit.get(item.commitSha);
        return {
          ...item,
          commitTitle: metadata?.commitTitle ?? item.commitTitle,
          commitAuthorName: metadata?.commitAuthorName ?? null,
          committedAt: metadata?.committedAt ?? null,
        };
      }),
    };
  });

  app.get("/repositories/:repo/commits/:sha", async (request, reply) => {
    const { repo, sha } = request.params as { repo: string; sha: string };
    const repository = await getRepositoryBySlug(context.connection.db, repo);
    if (!repository) {
      return reply.code(404).send({ message: "Repository not found" });
    }
    const detail = await getCommitDetail(context.connection.db, repo, sha);
    if (!detail) {
      return reply.code(404).send({ message: "Commit not found" });
    }
    const metadataByCommit = await resolveCommitMetadataMap(repository.root_path, [
      {
        commitSha: detail.commitSha,
        fallbackTitle: detail.commitTitle,
      },
    ]);
    const metadata = metadataByCommit.get(detail.commitSha);
    return {
      ...detail,
      commitTitle: metadata?.commitTitle ?? detail.commitTitle,
      commitAuthorName: metadata?.commitAuthorName ?? null,
      committedAt: metadata?.committedAt ?? null,
    };
  });

  app.get("/repositories/:repo/commits/:sha/treemap", async (request, reply) => {
    const { repo, sha } = request.params as { repo: string; sha: string };
    const treemap = await getCommitTreemap(context.connection.db, repo, sha);
    if (!treemap) {
      return reply.code(404).send({ message: "Commit not found" });
    }
    return treemap;
  });

  app.get("/repositories/:repo/pull-requests/:number", async (request) => {
    const { repo, number } = request.params as { repo: string; number: string };
    return getPullRequestDetail(context.connection.db, repo, Number(number));
  });
};
