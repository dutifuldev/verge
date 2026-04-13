import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyRawBody from "fastify-raw-body";
import {
  appendRunEventInputSchema,
  createManualRunInputSchema,
  githubWebhookPullRequestPayloadSchema,
  githubWebhookPushPayloadSchema,
  recordArtifactInputSchema,
  recordCheckpointInputSchema,
  recordObservationInputSchema,
  runListQuerySchema,
  workerClaimRequestSchema,
  workerHeartbeatInputSchema,
} from "@verge/contracts";
import { computeStepConfigFingerprint, loadVergeConfig, planStepRuns } from "@verge/core";
import {
  claimNextProcessRun,
  cloneCompletedProcessesFromCheckpoint,
  cloneStepRunForReuse,
  createEventIngestion,
  createProcessRuns,
  createRun,
  createStepRun,
  findLatestCheckpoint,
  findReusableStepRun,
  getCommitDetail,
  getRepositoryBySlug,
  getRepositoryHealth,
  getRunDetail,
  getPullRequestDetail,
  getStepRunDetail,
  getStepSpecsForRepository,
  heartbeatProcessRun,
  listRepositoryRuns,
  listStepSpecSummaries,
  migrateDatabase,
  processRunBelongsToStepRun,
  processRunLeaseIsActive,
  recordArtifact,
  recordCheckpoint,
  recordObservation,
  recordRunEvent,
  refreshRunStatus,
  refreshStepRunStatus,
  syncRepositoryConfiguration,
  type DatabaseConnection,
  type DatabaseExecutor,
} from "@verge/db";

type ApiContext = {
  connection: DatabaseConnection;
  repositorySlug: string;
  repositoryDefinition: {
    slug: string;
    areas: Array<{
      key: string;
      pathPrefixes: string[];
    }>;
  };
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

const interruptPendingProcessesForStepRun = async (
  db: DatabaseExecutor,
  stepRunId: string,
): Promise<void> => {
  const interruptedAt = new Date();
  const updated = await db
    .updateTable("process_runs")
    .set({
      status: "interrupted",
      finished_at: interruptedAt,
      claimed_by: null,
      lease_expires_at: null,
      last_heartbeat_at: null,
    })
    .where("step_run_id", "=", stepRunId)
    .where("status", "in", ["queued", "claimed", "running"])
    .executeTakeFirst();

  if (Number(updated.numUpdatedRows) > 0) {
    await db
      .insertInto("run_events")
      .values({
        id: randomUUID(),
        step_run_id: stepRunId,
        process_run_id: null,
        kind: "interrupted",
        message: "Pending processes were transferred to a resumed step",
        payload: JSON.stringify({ reason: "checkpoint-resume-transfer" }),
      })
      .execute();
    await refreshStepRunStatus(db, stepRunId);
  }
};

const createPlannedRun = async (
  db: DatabaseExecutor,
  repository: {
    id: string;
    slug: string;
    root_path: string;
  },
  repositoryDefinition: ApiContext["repositoryDefinition"],
  input: {
    trigger: "manual" | "push" | "pull_request";
    commitSha: string;
    branch?: string;
    changedFiles?: string[];
    requestedStepKeys?: string[];
    resumeFromCheckpoint?: boolean;
    disableReuse?: boolean;
    pullRequestNumber?: number;
    eventIngestionId?: string;
  },
): Promise<{
  runId: string;
  stepRunIds: string[];
}> => {
  const stepSpecs = await getStepSpecsForRepository(db, repository.id);

  const run = await createRun(db, {
    repositoryId: repository.id,
    trigger: input.trigger,
    commitSha: input.commitSha,
    changedFiles: input.changedFiles ?? [],
    ...(input.eventIngestionId ? { eventIngestionId: input.eventIngestionId } : {}),
    ...(input.branch ? { branch: input.branch } : {}),
    ...(input.pullRequestNumber ? { pullRequestNumber: input.pullRequestNumber } : {}),
  });

  const plans = await planStepRuns({
    repositorySlug: repository.slug,
    stepSpecs: stepSpecs.map((spec) => spec.parsed_step_spec),
    changedFiles: input.changedFiles ?? [],
    repository: repositoryDefinition,
    commitSha: input.commitSha,
    ...(input.requestedStepKeys ? { requestedStepKeys: input.requestedStepKeys } : {}),
  });

  const createdStepRunIds: string[] = [];

  for (const plan of plans) {
    const stepSpecRow = stepSpecs.find((spec) => spec.key === plan.stepSpec.key);
    if (!stepSpecRow) {
      continue;
    }

    const processCatalog = await db
      .selectFrom("processes")
      .select(["id", "key"])
      .where("step_spec_id", "=", stepSpecRow.id)
      .execute();
    const processIds = new Map(processCatalog.map((process) => [process.key, process.id]));
    const configFingerprint = computeStepConfigFingerprint(plan.stepSpec);

    if (input.resumeFromCheckpoint && plan.stepSpec.checkpointEnabled) {
      const checkpoint = await findLatestCheckpoint(db, {
        repositoryId: repository.id,
        stepKey: plan.stepSpec.key,
        stepSpecId: stepSpecRow.id,
        fingerprint: plan.fingerprint,
      });

      if (checkpoint) {
        const completedProcessKeys = new Set(parseStringArray(checkpoint.completed_process_keys));
        const pendingProcesses = plan.processes.filter(
          (process) => !completedProcessKeys.has(process.key),
        );

        const resumedStepRun = await createStepRun(db, {
          runId: run.id,
          stepSpecId: stepSpecRow.id,
          stepSpec: plan.stepSpec,
          configFingerprint,
          fingerprint: plan.fingerprint,
          status: pendingProcesses.length === 0 ? "reused" : "queued",
          planReason: `resumed from checkpoint ${checkpoint.id}`,
          checkpointSourceStepRunId: checkpoint.step_run_id,
        });

        await cloneCompletedProcessesFromCheckpoint(db, {
          sourceStepRunId: checkpoint.step_run_id,
          newStepRunId: resumedStepRun.id,
          completedProcessKeys: [...completedProcessKeys],
        });
        await interruptPendingProcessesForStepRun(db, checkpoint.step_run_id);

        await createProcessRuns(db, {
          stepRunId: resumedStepRun.id,
          processes: pendingProcesses.map((process) => ({
            processId: processIds.get(process.key) ?? null,
            processKey: process.key,
            displayName: process.displayName,
            kind: process.kind,
            filePath: process.filePath ?? null,
            metadata: {
              areaKeys: process.areaKeys,
            },
            selectionPayload: {
              areaKeys: process.areaKeys,
              command: process.command.slice(plan.stepSpec.baseCommand.length),
            },
          })),
        });

        await refreshStepRunStatus(db, resumedStepRun.id);
        createdStepRunIds.push(resumedStepRun.id);
        continue;
      }
    }

    if (!input.disableReuse && plan.stepSpec.reuseEnabled) {
      const reusableStepRun = await findReusableStepRun(db, {
        repositoryId: repository.id,
        stepKey: plan.stepSpec.key,
        stepSpecId: stepSpecRow.id,
        fingerprint: plan.fingerprint,
      });

      if (reusableStepRun) {
        const reusedStepRun = await createStepRun(db, {
          runId: run.id,
          stepSpecId: stepSpecRow.id,
          stepSpec: plan.stepSpec,
          configFingerprint,
          fingerprint: plan.fingerprint,
          status: "reused",
          planReason: `reused prior successful step run ${reusableStepRun.id}`,
          reusedFromStepRunId: reusableStepRun.id,
        });
        await cloneStepRunForReuse(db, {
          sourceStepRunId: reusableStepRun.id,
          newStepRunId: reusedStepRun.id,
        });
        await refreshStepRunStatus(db, reusedStepRun.id);
        createdStepRunIds.push(reusedStepRun.id);
        continue;
      }
    }

    const stepRun = await createStepRun(db, {
      runId: run.id,
      stepSpecId: stepSpecRow.id,
      stepSpec: plan.stepSpec,
      configFingerprint,
      fingerprint: plan.fingerprint,
      status: "queued",
      planReason: plan.planReason,
    });

    await createProcessRuns(db, {
      stepRunId: stepRun.id,
      processes: plan.processes.map((process) => ({
        processId: processIds.get(process.key) ?? null,
        processKey: process.key,
        displayName: process.displayName,
        kind: process.kind,
        filePath: process.filePath ?? null,
        metadata: {
          areaKeys: process.areaKeys,
        },
        selectionPayload: {
          areaKeys: process.areaKeys,
          command: process.command.slice(plan.stepSpec.baseCommand.length),
        },
      })),
    });

    await refreshStepRunStatus(db, stepRun.id);
    createdStepRunIds.push(stepRun.id);
  }

  await refreshRunStatus(db, run.id);

  return {
    runId: run.id,
    stepRunIds: createdStepRunIds,
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

  const ensureProcessRunMutationAccess = async (
    stepRunId: string,
    processRunId: string | undefined,
    workerId: string | undefined,
  ): Promise<boolean> => {
    if (!processRunId) {
      return true;
    }

    if (
      !(await processRunBelongsToStepRun(context.connection.db, {
        stepRunId,
        processRunId,
      }))
    ) {
      return false;
    }

    if (!workerId) {
      return false;
    }

    return processRunLeaseIsActive(context.connection.db, {
      stepRunId,
      processRunId,
      workerId,
    });
  };

  app.get("/step-specs", async () =>
    listStepSpecSummaries(context.connection.db, context.repositorySlug),
  );

  app.post("/runs/manual", async (request, reply) => {
    const input = createManualRunInputSchema.parse(request.body);
    const repository = await getRepositoryBySlug(context.connection.db, input.repositorySlug);

    if (!repository) {
      return reply.code(404).send({ message: "Repository not found" });
    }

    return createPlannedRun(context.connection.db, repository, context.repositoryDefinition, {
      trigger: "manual",
      commitSha: input.commitSha,
      ...(input.changedFiles ? { changedFiles: input.changedFiles } : {}),
      ...(input.requestedStepKeys ? { requestedStepKeys: input.requestedStepKeys } : {}),
      ...(input.resumeFromCheckpoint ? { resumeFromCheckpoint: input.resumeFromCheckpoint } : {}),
      ...(input.disableReuse ? { disableReuse: input.disableReuse } : {}),
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

      if (eventName === "push") {
        const payload = githubWebhookPushPayloadSchema.parse(request.body);
        await createPlannedRun(trx, repository, context.repositoryDefinition, {
          trigger: "push",
          commitSha: payload.after,
          branch: payload.ref.replace("refs/heads/", ""),
          changedFiles: collectChangedFilesFromPushPayload(payload),
          eventIngestionId: eventIngestion.id,
        });
        return { duplicate: false, trigger: "push" } as const;
      }

      if (eventName === "pull_request") {
        const payload = githubWebhookPullRequestPayloadSchema.parse(request.body);
        if (!["opened", "reopened", "synchronize"].includes(payload.action)) {
          return {
            duplicate: false,
            ignored: true,
            action: payload.action,
          } as const;
        }

        await createPlannedRun(trx, repository, context.repositoryDefinition, {
          trigger: "pull_request",
          commitSha: payload.pull_request.head.sha,
          branch: payload.pull_request.head.ref,
          changedFiles: [],
          pullRequestNumber: payload.number,
          eventIngestionId: eventIngestion.id,
        });
        return { duplicate: false, trigger: "pull_request" } as const;
      }

      return { duplicate: false, ignored: true, eventName } as const;
    });

    if (result.duplicate) {
      return reply.code(202).send({ ok: true, duplicate: true });
    }

    return reply.code(202).send({ ok: true, ...result });
  });

  app.get("/runs/:id", async (request, reply) => {
    const detail = await getRunDetail(context.connection.db, (request.params as { id: string }).id);
    if (!detail) {
      return reply.code(404).send({ message: "Run not found" });
    }
    return detail;
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

  app.post("/workers/claim", async (request) => {
    const input = workerClaimRequestSchema.parse(request.body);
    return {
      assignment: await claimNextProcessRun(context.connection.db, {
        workerId: input.workerId,
      }),
    };
  });

  app.post("/workers/steps/:stepRunId/heartbeat", async (request, reply) => {
    const params = request.params as { stepRunId: string };
    const input = workerHeartbeatInputSchema.parse(request.body);
    if (
      !(await ensureProcessRunMutationAccess(params.stepRunId, input.processRunId, input.workerId))
    ) {
      return reply
        .code(409)
        .send({ ok: false, message: "Process run does not belong to the step run" });
    }

    await heartbeatProcessRun(context.connection.db, {
      processRunId: input.processRunId,
      workerId: input.workerId,
    });

    return { stepRunId: params.stepRunId, ok: true };
  });

  app.post("/workers/steps/:stepRunId/events", async (request, reply) => {
    const params = request.params as { stepRunId: string };
    const input = appendRunEventInputSchema.parse(request.body);
    if (
      !(await ensureProcessRunMutationAccess(params.stepRunId, input.processRunId, input.workerId))
    ) {
      return reply
        .code(409)
        .send({ ok: false, message: "Process run does not belong to the step run" });
    }
    await recordRunEvent(context.connection.db, params.stepRunId, input);
    return { ok: true };
  });

  app.post("/workers/steps/:stepRunId/observations", async (request, reply) => {
    const params = request.params as { stepRunId: string };
    const input = recordObservationInputSchema.parse(request.body);
    if (
      !(await ensureProcessRunMutationAccess(params.stepRunId, input.processRunId, input.workerId))
    ) {
      return reply
        .code(409)
        .send({ ok: false, message: "Process run does not belong to the step run" });
    }
    await recordObservation(context.connection.db, params.stepRunId, input);
    await refreshStepRunStatus(context.connection.db, params.stepRunId);
    return { ok: true };
  });

  app.post("/workers/steps/:stepRunId/artifacts", async (request, reply) => {
    const params = request.params as { stepRunId: string };
    const input = recordArtifactInputSchema.parse(request.body);
    if (
      !(await ensureProcessRunMutationAccess(params.stepRunId, input.processRunId, input.workerId))
    ) {
      return reply
        .code(409)
        .send({ ok: false, message: "Process run does not belong to the step run" });
    }
    await recordArtifact(context.connection.db, params.stepRunId, input);
    return { ok: true };
  });

  app.post("/workers/steps/:stepRunId/checkpoints", async (request, reply) => {
    const params = request.params as { stepRunId: string };
    const input = recordCheckpointInputSchema.parse(request.body);
    if (
      !(await ensureProcessRunMutationAccess(params.stepRunId, input.processRunId, input.workerId))
    ) {
      return reply
        .code(409)
        .send({ ok: false, message: "Process run does not belong to the step run" });
    }

    const stepRun = await context.connection.db
      .selectFrom("step_runs")
      .select(["step_spec_id", "step_key", "fingerprint"])
      .where("id", "=", params.stepRunId)
      .executeTakeFirstOrThrow();

    await recordCheckpoint(context.connection.db, params.stepRunId, {
      stepSpecId: stepRun.step_spec_id,
      stepKey: stepRun.step_key,
      fingerprint: stepRun.fingerprint,
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

  app.get("/repositories/:repo/runs", async (request) =>
    listRepositoryRuns(
      context.connection.db,
      (request.params as { repo: string }).repo,
      runListQuerySchema.parse(request.query),
    ),
  );

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
