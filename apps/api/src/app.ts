import { createHmac, timingSafeEqual } from "node:crypto";

import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyRawBody from "fastify-raw-body";

import {
  appendRunEventInputSchema,
  createManualRunRequestInputSchema,
  githubWebhookPullRequestPayloadSchema,
  githubWebhookPushPayloadSchema,
  recordArtifactInputSchema,
  recordCheckpointInputSchema,
  recordObservationInputSchema,
  workerClaimRequestSchema,
  workerHeartbeatInputSchema,
} from "@verge/contracts";
import {
  getSelfHostedProcessSpecs,
  getSelfHostedRepositoryDefinition,
  planProcessSpecRuns,
  resolveWorkspaceRoot,
} from "@verge/core";
import {
  claimNextRunProcess,
  cloneCompletedProcessesFromCheckpoint,
  cloneRunForReuse,
  createEventIngestion,
  createRun,
  createRunProcesses,
  createRunRequest,
  deleteEventIngestion,
  getCommitDetail,
  getProcessSpecsForRepository,
  getPullRequestDetail,
  getRepositoryBySlug,
  getRepositoryHealth,
  getRunDetail,
  getRunRequestDetail,
  heartbeatRunProcess,
  listProcessSpecSummaries,
  listRunProcesses,
  migrateDatabase,
  recordArtifact,
  recordCheckpoint,
  recordObservation,
  recordRunEvent,
  refreshRunStatus,
  runProcessBelongsToRun,
  runProcessLeaseIsActive,
  syncRepositoryConfiguration,
  type DatabaseConnection,
  findReusableRun,
  findLatestCheckpoint,
} from "@verge/db";

type ApiContext = {
  connection: DatabaseConnection;
  repositorySlug: string;
};

const collectChangedFilesFromPushPayload = (
  payload: ReturnType<typeof githubWebhookPushPayloadSchema.parse>,
): string[] => {
  const changedFiles = new Set<string>();

  for (const commit of payload.commits) {
    for (const filePath of [...commit.added, ...commit.modified, ...commit.removed]) {
      changedFiles.add(filePath);
    }
  }

  return [...changedFiles];
};

const validateGitHubSignature = (
  secret: string | undefined,
  rawBody: string | undefined,
  signatureHeader: string | undefined,
): boolean => {
  if (!secret) {
    return process.env.VERGE_ALLOW_UNVERIFIED_GITHUB_WEBHOOKS === "1";
  }

  if (!rawBody || !signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
};

const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    return JSON.parse(value) as string[];
  }

  return [];
};

const createPlannedRuns = async (
  connection: DatabaseConnection,
  repository: {
    id: string;
    slug: string;
    root_path: string;
  },
  input: {
    trigger: "manual" | "push" | "pull_request";
    commitSha: string;
    branch?: string;
    changedFiles?: string[];
    requestedProcessSpecKeys?: string[];
    resumeFromCheckpoint?: boolean;
    pullRequestNumber?: number;
    eventIngestionId?: string;
  },
): Promise<{
  runRequestId: string;
  runIds: string[];
}> => {
  const processSpecs = await getProcessSpecsForRepository(connection.db, repository.id);
  const repositoryDefinition = getSelfHostedRepositoryDefinition(repository.root_path);

  const runRequest = await createRunRequest(connection.db, {
    repositoryId: repository.id,
    trigger: input.trigger,
    commitSha: input.commitSha,
    changedFiles: input.changedFiles ?? [],
    ...(input.eventIngestionId ? { eventIngestionId: input.eventIngestionId } : {}),
    ...(input.branch ? { branch: input.branch } : {}),
    ...(input.pullRequestNumber ? { pullRequestNumber: input.pullRequestNumber } : {}),
  });

  const plans = planProcessSpecRuns({
    repositorySlug: repository.slug,
    processSpecs: processSpecs.map((spec) => spec.parsed_process_spec),
    changedFiles: input.changedFiles ?? [],
    repository: {
      slug: repository.slug,
      areas: repositoryDefinition.areas.map((area) => ({
        key: area.key,
        pathPrefixes: area.pathPrefixes,
      })),
    },
    commitSha: input.commitSha,
    ...(input.requestedProcessSpecKeys
      ? { requestedProcessSpecKeys: input.requestedProcessSpecKeys }
      : {}),
  });

  const createdRunIds: string[] = [];

  for (const plan of plans) {
    const specRow = processSpecs.find((spec) => spec.key === plan.processSpec.key);
    if (!specRow) {
      continue;
    }

    if (plan.processSpec.reuseEnabled) {
      const reusableRun = await findReusableRun(connection.db, {
        processSpecId: specRow.id,
        fingerprint: plan.fingerprint,
      });

      if (reusableRun) {
        const reusedRun = await createRun(connection.db, {
          runRequestId: runRequest.id,
          processSpecId: specRow.id,
          fingerprint: plan.fingerprint,
          status: "reused",
          planReason: `reused prior successful run ${reusableRun.id}`,
          reusedFromRunId: reusableRun.id,
        });
        await cloneRunForReuse(connection.db, {
          sourceRunId: reusableRun.id,
          newRunId: reusedRun.id,
        });
        await refreshRunStatus(connection.db, reusedRun.id);
        createdRunIds.push(reusedRun.id);
        continue;
      }
    }

    if (input.resumeFromCheckpoint && plan.processSpec.checkpointEnabled) {
      const checkpoint = await findLatestCheckpoint(connection.db, {
        processSpecId: specRow.id,
        fingerprint: plan.fingerprint,
      });

      if (checkpoint) {
        const completedProcessKeys = new Set(parseStringArray(checkpoint.completed_process_keys));
        const pending = plan.processes.filter((process) => !completedProcessKeys.has(process.key));

        const resumedRun = await createRun(connection.db, {
          runRequestId: runRequest.id,
          processSpecId: specRow.id,
          fingerprint: plan.fingerprint,
          status: pending.length === 0 ? "reused" : "queued",
          planReason: `resumed from checkpoint ${checkpoint.id}`,
          checkpointSourceRunId: checkpoint.run_id,
        });

        await cloneCompletedProcessesFromCheckpoint(connection.db, {
          sourceRunId: checkpoint.run_id,
          newRunId: resumedRun.id,
          completedProcessKeys: [...completedProcessKeys],
        });

        await createRunProcesses(connection.db, {
          runId: resumedRun.id,
          processes: pending.map((process) => ({
            processKey: process.key,
            processLabel: process.label,
            processType: process.type,
            selectionPayload: {
              areaKeys: process.areaKeys,
              command: process.command.slice(plan.processSpec.baseCommand.length),
            },
          })),
        });

        await refreshRunStatus(connection.db, resumedRun.id);
        createdRunIds.push(resumedRun.id);
        continue;
      }
    }

    const run = await createRun(connection.db, {
      runRequestId: runRequest.id,
      processSpecId: specRow.id,
      fingerprint: plan.fingerprint,
      status: "queued",
      planReason: plan.planReason,
    });
    await createRunProcesses(connection.db, {
      runId: run.id,
      processes: plan.processes.map((process) => ({
        processKey: process.key,
        processLabel: process.label,
        processType: process.type,
        selectionPayload: {
          areaKeys: process.areaKeys,
          command: process.command.slice(plan.processSpec.baseCommand.length),
        },
      })),
    });
    await refreshRunStatus(connection.db, run.id);
    createdRunIds.push(run.id);
  }

  return {
    runRequestId: runRequest.id,
    runIds: createdRunIds,
  };
};

const sendSse = (reply: {
  raw: NodeJS.WritableStream & {
    writeHead?: (statusCode: number, headers: Record<string, string>) => void;
  };
}): void => {
  reply.raw.writeHead?.(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
};

export const createApiApp = async (context: ApiContext): Promise<FastifyInstance> => {
  const app = Fastify({ logger: true });
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
  await app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    routes: ["/webhooks/github"],
    runFirst: true,
  });

  app.get("/healthz", async () => ({ ok: true }));

  const ensureRunProcessMutationAccess = async (
    runId: string,
    runProcessId: string | undefined,
    workerId: string | undefined,
  ): Promise<boolean> => {
    if (!runProcessId) {
      return true;
    }

    if (
      !(await runProcessBelongsToRun(context.connection.db, {
        runId,
        runProcessId,
      }))
    ) {
      return false;
    }

    if (!workerId) {
      return false;
    }

    return runProcessLeaseIsActive(context.connection.db, {
      runId,
      runProcessId,
      workerId,
    });
  };

  app.get("/process-specs", async () =>
    listProcessSpecSummaries(context.connection.db, context.repositorySlug),
  );

  app.post("/run-requests/manual", async (request, reply) => {
    const input = createManualRunRequestInputSchema.parse(request.body);
    const repository = await getRepositoryBySlug(context.connection.db, input.repositorySlug);

    if (!repository) {
      return reply.code(404).send({ message: "Repository not found" });
    }

    return createPlannedRuns(context.connection, repository, {
      trigger: "manual",
      commitSha: input.commitSha,
      ...(input.changedFiles ? { changedFiles: input.changedFiles } : {}),
      ...(input.requestedProcessSpecKeys
        ? { requestedProcessSpecKeys: input.requestedProcessSpecKeys }
        : {}),
      ...(input.resumeFromCheckpoint ? { resumeFromCheckpoint: input.resumeFromCheckpoint } : {}),
      ...(input.branch ? { branch: input.branch } : {}),
    });
  });

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

    const repository = await getRepositoryBySlug(context.connection.db, context.repositorySlug);
    if (!repository) {
      return reply.code(404).send({ message: "Repository not found" });
    }

    const { eventIngestion, inserted } = await createEventIngestion(context.connection.db, {
      repositoryId: repository.id,
      source: "github",
      deliveryId,
      eventName,
      payload: request.body,
    });

    if (!inserted) {
      return reply.code(202).send({ ok: true, duplicate: true });
    }

    try {
      if (eventName === "push") {
        const payload = githubWebhookPushPayloadSchema.parse(request.body);
        await createPlannedRuns(context.connection, repository, {
          trigger: "push",
          commitSha: payload.after,
          branch: payload.ref.replace("refs/heads/", ""),
          changedFiles: collectChangedFilesFromPushPayload(payload),
          eventIngestionId: eventIngestion.id,
        });
        return reply.code(202).send({ ok: true, trigger: "push" });
      }

      if (eventName === "pull_request") {
        const payload = githubWebhookPullRequestPayloadSchema.parse(request.body);
        if (!["opened", "reopened", "synchronize"].includes(payload.action)) {
          return reply.code(202).send({ ok: true, ignored: true, action: payload.action });
        }

        await createPlannedRuns(context.connection, repository, {
          trigger: "pull_request",
          commitSha: payload.pull_request.head.sha,
          branch: payload.pull_request.head.ref,
          changedFiles: [],
          pullRequestNumber: payload.number,
          eventIngestionId: eventIngestion.id,
        });
        return reply.code(202).send({ ok: true, trigger: "pull_request" });
      }

      return reply.code(202).send({ ok: true, ignored: true, eventName });
    } catch (error) {
      await deleteEventIngestion(context.connection.db, eventIngestion.id);
      throw error;
    }
  });

  app.get("/run-requests/:id", async (request) =>
    getRunRequestDetail(context.connection.db, (request.params as { id: string }).id),
  );

  app.get("/runs/:id", async (request) =>
    getRunDetail(context.connection.db, (request.params as { id: string }).id),
  );

  app.get("/runs/:id/processes", async (request) =>
    listRunProcesses(context.connection.db, (request.params as { id: string }).id),
  );

  app.get("/runs/:id/events", async (request) => {
    const detail = await getRunDetail(context.connection.db, (request.params as { id: string }).id);
    return detail.events;
  });

  app.post("/workers/claim", async (request) => {
    const input = workerClaimRequestSchema.parse(request.body);
    return {
      assignment: await claimNextRunProcess(context.connection.db, {
        workerId: input.workerId,
      }),
    };
  });

  app.post("/workers/:runId/heartbeat", async (request, reply) => {
    const params = request.params as { runId: string };
    const input = workerHeartbeatInputSchema.parse(request.body);
    if (!(await ensureRunProcessMutationAccess(params.runId, input.runProcessId, input.workerId))) {
      return reply.code(409).send({ ok: false, message: "Run process does not belong to run" });
    }
    await heartbeatRunProcess(context.connection.db, {
      runProcessId: input.runProcessId,
      workerId: input.workerId,
    });
    return { runId: params.runId, ok: true };
  });

  app.post("/workers/:runId/events", async (request, reply) => {
    const params = request.params as { runId: string };
    const input = appendRunEventInputSchema.parse(request.body);
    if (!(await ensureRunProcessMutationAccess(params.runId, input.runProcessId, input.workerId))) {
      return reply.code(409).send({ ok: false, message: "Run process does not belong to run" });
    }
    await recordRunEvent(context.connection.db, params.runId, input);
    return { ok: true };
  });

  app.post("/workers/:runId/observations", async (request, reply) => {
    const params = request.params as { runId: string };
    const input = recordObservationInputSchema.parse(request.body);
    if (!(await ensureRunProcessMutationAccess(params.runId, input.runProcessId, input.workerId))) {
      return reply.code(409).send({ ok: false, message: "Run process does not belong to run" });
    }
    await recordObservation(context.connection.db, params.runId, input);
    await refreshRunStatus(context.connection.db, params.runId);
    return { ok: true };
  });

  app.post("/workers/:runId/artifacts", async (request, reply) => {
    const params = request.params as { runId: string };
    const input = recordArtifactInputSchema.parse(request.body);
    if (!(await ensureRunProcessMutationAccess(params.runId, input.runProcessId, input.workerId))) {
      return reply.code(409).send({ ok: false, message: "Run process does not belong to run" });
    }
    await recordArtifact(context.connection.db, params.runId, input);
    return { ok: true };
  });

  app.post("/workers/:runId/checkpoints", async (request) => {
    const params = request.params as { runId: string };
    const input = recordCheckpointInputSchema.parse(request.body);
    const run = await context.connection.db
      .selectFrom("runs")
      .select(["process_spec_id", "fingerprint"])
      .where("id", "=", params.runId)
      .executeTakeFirstOrThrow();

    await recordCheckpoint(context.connection.db, params.runId, {
      processSpecId: run.process_spec_id,
      fingerprint: run.fingerprint,
      checkpoint: input,
    });
    return { ok: true };
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

  app.get("/repositories/:repo/commits/:sha", async (request) =>
    getCommitDetail(
      context.connection.db,
      (request.params as { repo: string; sha: string }).repo,
      (request.params as { repo: string; sha: string }).sha,
    ),
  );

  app.get("/repositories/:repo/pull-requests/:number", async (request) => {
    const { repo, number } = request.params as { repo: string; number: string };
    return getPullRequestDetail(context.connection.db, repo, Number(number));
  });

  app.get("/streams/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    sendSse(reply);
    const interval = setInterval(async () => {
      const detail = await getRunDetail(context.connection.db, id);
      reply.raw.write(`data: ${JSON.stringify(detail)}\n\n`);
    }, 2000);

    request.raw.on("close", () => clearInterval(interval));
    return reply;
  });

  app.get("/streams/repositories/:repo/health", async (request, reply) => {
    const { repo } = request.params as { repo: string };
    sendSse(reply);
    const interval = setInterval(async () => {
      const detail = await getRepositoryHealth(context.connection.db, repo);
      reply.raw.write(`data: ${JSON.stringify(detail)}\n\n`);
    }, 2000);

    request.raw.on("close", () => clearInterval(interval));
    return reply;
  });

  return app;
};

export const bootstrapApiApp = async (connection: DatabaseConnection): Promise<FastifyInstance> => {
  const workspaceRoot = await resolveWorkspaceRoot();
  const repositoryDefinition = getSelfHostedRepositoryDefinition(workspaceRoot);
  const processSpecs = getSelfHostedProcessSpecs(workspaceRoot);

  await migrateDatabase(connection.db);
  await syncRepositoryConfiguration(connection.db, repositoryDefinition, processSpecs);

  return createApiApp({
    connection,
    repositorySlug: repositoryDefinition.slug,
  });
};
