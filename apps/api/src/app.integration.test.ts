import { createHmac } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabaseConnection, listProcessRuns, resetDatabase } from "@verge/db";

import { bootstrapApiApp } from "./app.js";

const runIntegration = process.env.VERGE_RUN_DB_INTEGRATION === "1";

describe.runIf(runIntegration)("api integration", () => {
  const connection = createDatabaseConnection(
    process.env.VERGE_INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  );

  let app: Awaited<ReturnType<typeof bootstrapApiApp>>;

  beforeAll(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "integration-secret";
  });

  beforeEach(async () => {
    await app?.close();
    await resetDatabase(connection.db).catch(() => undefined);
    app = await bootstrapApiApp(connection);
  });

  afterAll(async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    await app?.close();
  });

  it("creates a manual run and exposes health", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs/manual",
      payload: {
        repositorySlug: "verge",
        commitSha: "integration-sha",
        changedFiles: ["apps/api/src/app.ts"],
      },
    });

    expect(createResponse.statusCode).toBe(200);
    const createPayload = createResponse.json() as {
      runId: string;
      stepRunIds: string[];
    };
    expect(createPayload.stepRunIds.length).toBeGreaterThan(0);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/runs/${createPayload.runId}`,
    });
    expect(detailResponse.statusCode).toBe(200);

    const claimResponse = await app.inject({
      method: "POST",
      url: "/workers/claim",
      payload: {
        workerId: "integration-worker",
      },
    });
    expect(claimResponse.statusCode).toBe(200);
    expect(claimResponse.json()).toHaveProperty("assignment");

    const healthResponse = await app.inject({
      method: "GET",
      url: "/repositories/verge/health",
    });
    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.json()).toHaveProperty("areaStates");

    const runsResponse = await app.inject({
      method: "GET",
      url: "/repositories/verge/runs?page=1&pageSize=5",
    });
    expect(runsResponse.statusCode).toBe(200);
    expect(runsResponse.json()).toMatchObject({
      page: 1,
      pageSize: 5,
    });
  }, 30_000);

  it("returns 404 for missing runs and steps after a reset", async () => {
    const runResponse = await app.inject({
      method: "GET",
      url: "/runs/00000000-0000-0000-0000-000000000001",
    });
    expect(runResponse.statusCode).toBe(404);
    expect(runResponse.json()).toMatchObject({ message: "Run not found" });

    const stepResponse = await app.inject({
      method: "GET",
      url: "/runs/00000000-0000-0000-0000-000000000001/steps/00000000-0000-0000-0000-000000000002",
    });
    expect(stepResponse.statusCode).toBe(404);
    expect(stepResponse.json()).toMatchObject({ message: "Step not found" });
  }, 30_000);

  it("ingests GitHub webhooks idempotently and exposes pull request detail", async () => {
    const pullRequestPayload = {
      action: "opened",
      number: 14,
      repository: {
        full_name: "bob/verge",
      },
      pull_request: {
        number: 14,
        head: {
          sha: "pr-sha",
          ref: "feature/verge",
        },
        base: {
          ref: "main",
        },
        changed_files: 3,
      },
    };
    const payloadBody = JSON.stringify(pullRequestPayload);
    const signature = createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET ?? "")
      .update(payloadBody)
      .digest("hex");

    const firstResponse = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-pr-14",
        "x-github-event": "pull_request",
        "x-hub-signature-256": `sha256=${signature}`,
      },
      payload: payloadBody,
    });

    expect(firstResponse.statusCode).toBe(202);

    const duplicateResponse = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-pr-14",
        "x-github-event": "pull_request",
        "x-hub-signature-256": `sha256=${signature}`,
      },
      payload: payloadBody,
    });

    expect(duplicateResponse.statusCode).toBe(202);
    expect(duplicateResponse.json()).toMatchObject({ duplicate: true });

    const detailResponse = await app.inject({
      method: "GET",
      url: "/repositories/verge/pull-requests/14",
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      repositorySlug: "verge",
      pullRequestNumber: 14,
    });
  }, 30_000);

  it("resumes from a checkpoint without leaving the source step claimable", async () => {
    const seedCreateResponse = await app.inject({
      method: "POST",
      url: "/runs/manual",
      payload: {
        repositorySlug: "verge",
        commitSha: "checkpoint-seed-sha",
        requestedStepKeys: ["test"],
        disableReuse: true,
      },
    });

    expect(seedCreateResponse.statusCode).toBe(200);
    const seedCreatePayload = seedCreateResponse.json() as {
      runId: string;
      stepRunIds: string[];
    };
    const seedStepRunId = seedCreatePayload.stepRunIds[0];
    if (!seedStepRunId) {
      throw new Error("Seed step run was not created");
    }

    const claimResponse = await app.inject({
      method: "POST",
      url: "/workers/claim",
      payload: {
        workerId: "checkpoint-seed-worker",
      },
    });
    expect(claimResponse.statusCode).toBe(200);
    const seedAssignment = claimResponse.json() as {
      assignment: {
        stepRunId: string;
        processRunId: string;
        processKey: string;
        areaKeys: string[];
      } | null;
    };
    expect(seedAssignment.assignment?.stepRunId).toBe(seedStepRunId);

    await app.inject({
      method: "POST",
      url: `/workers/steps/${seedStepRunId}/events`,
      payload: {
        workerId: "checkpoint-seed-worker",
        processRunId: seedAssignment.assignment?.processRunId,
        kind: "started",
        message: "Started checkpoint seed process",
      },
    });

    await app.inject({
      method: "POST",
      url: `/workers/steps/${seedStepRunId}/observations`,
      payload: {
        workerId: "checkpoint-seed-worker",
        processRunId: seedAssignment.assignment?.processRunId,
        processKey: seedAssignment.assignment?.processKey,
        areaKey: seedAssignment.assignment?.areaKeys[0] ?? null,
        status: "passed",
        summary: {
          processKey: seedAssignment.assignment?.processKey,
          exitCode: 0,
        },
        executionScope: {
          workerId: "checkpoint-seed-worker",
        },
      },
    });

    await app.inject({
      method: "POST",
      url: `/workers/steps/${seedStepRunId}/checkpoints`,
      payload: {
        workerId: "checkpoint-seed-worker",
        processRunId: seedAssignment.assignment?.processRunId,
        completedProcessKeys: [seedAssignment.assignment?.processKey],
        pendingProcessKeys: [],
        storagePath: "checkpoint.json",
        resumableUntil: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    await app.inject({
      method: "POST",
      url: `/workers/steps/${seedStepRunId}/events`,
      payload: {
        workerId: "checkpoint-seed-worker",
        processRunId: seedAssignment.assignment?.processRunId,
        kind: "passed",
        message: "Completed checkpoint seed process",
      },
    });

    const resumeCreateResponse = await app.inject({
      method: "POST",
      url: "/runs/manual",
      payload: {
        repositorySlug: "verge",
        commitSha: "checkpoint-seed-sha",
        requestedStepKeys: ["test"],
        resumeFromCheckpoint: true,
      },
    });

    expect(resumeCreateResponse.statusCode).toBe(200);
    const resumeCreatePayload = resumeCreateResponse.json() as {
      runId: string;
      stepRunIds: string[];
    };
    const resumedStepRunId = resumeCreatePayload.stepRunIds[0];
    if (!resumedStepRunId) {
      throw new Error("Resumed step run was not created");
    }

    const sourceProcesses = await listProcessRuns(connection.db, seedStepRunId);
    expect(
      sourceProcesses.some((process) => ["queued", "claimed", "running"].includes(process.status)),
    ).toBe(false);

    const resumedClaimResponse = await app.inject({
      method: "POST",
      url: "/workers/claim",
      payload: {
        workerId: "checkpoint-resume-worker",
      },
    });
    expect(resumedClaimResponse.statusCode).toBe(200);
    const resumedAssignment = resumedClaimResponse.json() as {
      assignment: {
        stepRunId: string;
        processKey: string;
      } | null;
    };

    expect(resumedAssignment.assignment?.stepRunId).toBe(resumedStepRunId);
    expect(resumedAssignment.assignment?.processKey).not.toBe(
      seedAssignment.assignment?.processKey,
    );
  }, 30_000);
});
