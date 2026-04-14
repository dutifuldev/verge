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
    app = await bootstrapApiApp(connection, {
      configPaths: ["verge.config.ts", "test/fixtures/verge-testbed.config.ts"],
    });
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

    const commitsResponse = await app.inject({
      method: "GET",
      url: "/repositories/verge/commits?page=1&pageSize=5",
    });
    expect(commitsResponse.statusCode).toBe(200);
    expect(commitsResponse.json()).toMatchObject({
      page: 1,
      pageSize: 5,
      items: [
        expect.objectContaining({
          commitSha: "integration-sha",
          attemptCount: 1,
          coveragePercent: expect.any(Number),
        }),
      ],
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

    const treemapResponse = await app.inject({
      method: "GET",
      url: "/runs/00000000-0000-0000-0000-000000000001/treemap",
    });
    expect(treemapResponse.statusCode).toBe(404);
    expect(treemapResponse.json()).toMatchObject({ message: "Run not found" });

    const commitResponse = await app.inject({
      method: "GET",
      url: "/repositories/verge/commits/missing-commit",
    });
    expect(commitResponse.statusCode).toBe(404);
    expect(commitResponse.json()).toMatchObject({ message: "Commit not found" });

    const commitTreemapResponse = await app.inject({
      method: "GET",
      url: "/repositories/verge/commits/missing-commit/treemap",
    });
    expect(commitTreemapResponse.statusCode).toBe(404);
    expect(commitTreemapResponse.json()).toMatchObject({ message: "Commit not found" });
  }, 30_000);

  it("returns a run treemap with step, file, and process nodes", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs/manual",
      payload: {
        repositorySlug: "verge",
        commitSha: "treemap-sha",
        requestedStepKeys: ["test"],
        disableReuse: true,
      },
    });

    expect(createResponse.statusCode).toBe(200);
    const createPayload = createResponse.json() as {
      runId: string;
      stepRunIds: string[];
    };

    const initialTreemapResponse = await app.inject({
      method: "GET",
      url: `/runs/${createPayload.runId}/treemap`,
    });
    expect(initialTreemapResponse.statusCode).toBe(200);
    const initialTreemap = initialTreemapResponse.json() as {
      runId: string;
      tree: {
        kind: string;
        children?: Array<{
          kind: string;
          stepKey?: string | null;
          children?: Array<{ kind: string; children?: Array<{ kind: string }> }>;
        }>;
      };
    };

    expect(initialTreemap.runId).toBe(createPayload.runId);
    expect(initialTreemap.tree.kind).toBe("run");
    const testStepNode = initialTreemap.tree.children?.find((node) => node.stepKey === "test");
    expect(testStepNode?.kind).toBe("step");
    expect(testStepNode?.children?.some((child) => child.kind === "file")).toBe(true);
    expect(
      testStepNode?.children?.some(
        (child) =>
          child.kind === "file" &&
          child.children?.some((grandchild) => grandchild.kind === "process"),
      ),
    ).toBe(true);

    const claimResponse = await app.inject({
      method: "POST",
      url: "/workers/claim",
      payload: {
        workerId: "treemap-worker",
      },
    });
    expect(claimResponse.statusCode).toBe(200);
    const assignment = claimResponse.json() as {
      assignment: {
        stepRunId: string;
        processRunId: string;
        processKey: string;
      } | null;
    };
    expect(assignment.assignment?.stepRunId).toBe(createPayload.stepRunIds[0]);

    await app.inject({
      method: "POST",
      url: `/workers/steps/${assignment.assignment?.stepRunId}/events`,
      payload: {
        workerId: "treemap-worker",
        processRunId: assignment.assignment?.processRunId,
        kind: "started",
        message: "Started treemap process",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 15));

    await app.inject({
      method: "POST",
      url: `/workers/steps/${assignment.assignment?.stepRunId}/events`,
      payload: {
        workerId: "treemap-worker",
        processRunId: assignment.assignment?.processRunId,
        kind: "passed",
        message: "Completed treemap process",
      },
    });

    const finalTreemapResponse = await app.inject({
      method: "GET",
      url: `/runs/${createPayload.runId}/treemap`,
    });
    expect(finalTreemapResponse.statusCode).toBe(200);
    const finalTreemap = finalTreemapResponse.json() as {
      tree: {
        children?: Array<{
          children?: Array<{ children?: Array<{ processKey?: string | null; valueMs?: number }> }>;
        }>;
      };
    };

    const processNode = finalTreemap.tree.children
      ?.flatMap((child) => child.children ?? [])
      .flatMap((child) => child.children ?? [])
      .find((node) => node.processKey === assignment.assignment?.processKey);

    expect(processNode?.valueMs).toBeGreaterThan(0);
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

  it("returns converged commit detail and treemap across resumed attempts", async () => {
    const commitSha = "commit-health-sha";
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs/manual",
      payload: {
        repositorySlug: "verge-testbed",
        commitSha,
        requestedStepKeys: ["test-resume"],
        disableReuse: true,
      },
    });

    expect(createResponse.statusCode).toBe(200);
    const createPayload = createResponse.json() as {
      runId: string;
      stepRunIds: string[];
    };
    const firstStepRunId = createPayload.stepRunIds[0];
    if (!firstStepRunId) {
      throw new Error("First step run was not created");
    }

    const firstStepDetailResponse = await app.inject({
      method: "GET",
      url: `/runs/${createPayload.runId}/steps/${firstStepRunId}`,
    });
    expect(firstStepDetailResponse.statusCode).toBe(200);
    const firstStepDetail = firstStepDetailResponse.json() as {
      processes: Array<{ processKey: string }>;
    };
    const expectedProcessCount = firstStepDetail.processes.length;
    if (expectedProcessCount === 0) {
      throw new Error("Expected the resume step to materialize at least one process");
    }

    const completedProcessKeys: string[] = [];
    let failedAssignment: {
      processRunId: string;
      processKey: string;
    } | null = null;

    while (true) {
      const claimResponse = await app.inject({
        method: "POST",
        url: "/workers/claim",
        payload: {
          workerId: "commit-projection-worker",
        },
      });
      expect(claimResponse.statusCode).toBe(200);
      const claimPayload = claimResponse.json() as {
        assignment: {
          stepRunId: string;
          processRunId: string;
          processKey: string;
          processDisplayName: string;
        } | null;
      };

      if (!claimPayload.assignment) {
        break;
      }

      expect(claimPayload.assignment.stepRunId).toBe(firstStepRunId);

      await app.inject({
        method: "POST",
        url: `/workers/steps/${firstStepRunId}/events`,
        payload: {
          workerId: "commit-projection-worker",
          processRunId: claimPayload.assignment.processRunId,
          kind: "started",
          message: "Started commit projection process",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 15));

      if (completedProcessKeys.length === expectedProcessCount - 1) {
        failedAssignment = {
          processRunId: claimPayload.assignment.processRunId,
          processKey: claimPayload.assignment.processKey,
        };

        const checkpointResponse = await app.inject({
          method: "POST",
          url: `/workers/steps/${firstStepRunId}/checkpoints`,
          payload: {
            workerId: "commit-projection-worker",
            processRunId: claimPayload.assignment.processRunId,
            completedProcessKeys,
            pendingProcessKeys: [claimPayload.assignment.processKey],
            storagePath: "commit-projection-checkpoint.json",
            resumableUntil: new Date(Date.now() + 60_000).toISOString(),
          },
        });
        expect(checkpointResponse.statusCode).toBe(200);

        const failedResponse = await app.inject({
          method: "POST",
          url: `/workers/steps/${firstStepRunId}/events`,
          payload: {
            workerId: "commit-projection-worker",
            processRunId: claimPayload.assignment.processRunId,
            kind: "failed",
            message: "Failed commit projection process",
          },
        });
        expect(failedResponse.statusCode).toBe(200);
        continue;
      }

      const passedResponse = await app.inject({
        method: "POST",
        url: `/workers/steps/${firstStepRunId}/events`,
        payload: {
          workerId: "commit-projection-worker",
          processRunId: claimPayload.assignment.processRunId,
          kind: "passed",
          message: "Completed commit projection process",
        },
      });
      expect(passedResponse.statusCode).toBe(200);
      completedProcessKeys.push(claimPayload.assignment.processKey);
    }

    expect(failedAssignment).not.toBeNull();
    expect(completedProcessKeys.length).toBeGreaterThan(0);

    const firstCommitResponse = await app.inject({
      method: "GET",
      url: `/repositories/verge-testbed/commits/${commitSha}`,
    });
    expect(firstCommitResponse.statusCode).toBe(200);
    const firstCommit = firstCommitResponse.json() as {
      status: string;
      steps: Array<{ stepKey: string; status: string; processCount: number }>;
      processes: Array<{ processKey: string; status: string; sourceRunId: string }>;
      executionCost: { runCount: number };
    };
    expect(firstCommit.status).toBe("failed");
    expect(firstCommit.executionCost.runCount).toBe(1);
    expect(firstCommit.steps).toContainEqual(
      expect.objectContaining({
        stepKey: "test-resume",
        status: "failed",
      }),
    );
    expect(firstCommit.processes).toContainEqual(
      expect.objectContaining({
        processKey: failedAssignment?.processKey,
        status: "failed",
        sourceRunId: createPayload.runId,
      }),
    );

    const resumeCreateResponse = await app.inject({
      method: "POST",
      url: "/runs/manual",
      payload: {
        repositorySlug: "verge-testbed",
        commitSha,
        requestedStepKeys: ["test-resume"],
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

    const resumedStepResponse = await app.inject({
      method: "GET",
      url: `/runs/${resumeCreatePayload.runId}/steps/${resumedStepRunId}`,
    });
    expect(resumedStepResponse.statusCode).toBe(200);
    const resumedStep = resumedStepResponse.json() as {
      processes: Array<{ processKey: string; status: string }>;
    };
    expect(resumedStep.processes.filter((process) => process.status === "reused")).toHaveLength(
      completedProcessKeys.length,
    );
    expect(
      resumedStep.processes.find((process) => process.processKey === failedAssignment?.processKey)
        ?.status,
    ).toBe("queued");

    const resumedClaimResponse = await app.inject({
      method: "POST",
      url: "/workers/claim",
      payload: {
        workerId: "commit-projection-resume-worker",
      },
    });
    expect(resumedClaimResponse.statusCode).toBe(200);
    const resumedAssignment = resumedClaimResponse.json() as {
      assignment: {
        stepRunId: string;
        processRunId: string;
        processKey: string;
      } | null;
    };
    expect(resumedAssignment.assignment?.stepRunId).toBe(resumedStepRunId);
    expect(resumedAssignment.assignment?.processKey).toBe(failedAssignment?.processKey);

    await app.inject({
      method: "POST",
      url: `/workers/steps/${resumedStepRunId}/events`,
      payload: {
        workerId: "commit-projection-resume-worker",
        processRunId: resumedAssignment.assignment?.processRunId,
        kind: "started",
        message: "Started resumed process",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 15));

    await app.inject({
      method: "POST",
      url: `/workers/steps/${resumedStepRunId}/events`,
      payload: {
        workerId: "commit-projection-resume-worker",
        processRunId: resumedAssignment.assignment?.processRunId,
        kind: "passed",
        message: "Completed resumed process",
      },
    });

    const secondClaimResponse = await app.inject({
      method: "POST",
      url: "/workers/claim",
      payload: {
        workerId: "commit-projection-resume-worker",
      },
    });
    expect(secondClaimResponse.statusCode).toBe(200);
    expect(secondClaimResponse.json()).toMatchObject({ assignment: null });

    const convergedCommitResponse = await app.inject({
      method: "GET",
      url: `/repositories/verge-testbed/commits/${commitSha}`,
    });
    expect(convergedCommitResponse.statusCode).toBe(200);
    const convergedCommit = convergedCommitResponse.json() as {
      status: string;
      steps: Array<{ stepKey: string; status: string }>;
      processes: Array<{ processKey: string; status: string; sourceRunId: string }>;
      executionCost: { runCount: number; processRunCount: number };
      runs: Array<{ id: string }>;
    };
    expect(convergedCommit.status).toBe("passed");
    expect(convergedCommit.executionCost.runCount).toBe(2);
    expect(convergedCommit.executionCost.processRunCount).toBeGreaterThan(
      convergedCommit.processes.length,
    );
    expect(convergedCommit.steps).toContainEqual(
      expect.objectContaining({
        stepKey: "test-resume",
        status: "passed",
      }),
    );
    expect(convergedCommit.processes).toContainEqual(
      expect.objectContaining({
        processKey: failedAssignment?.processKey,
        status: "passed",
        sourceRunId: resumeCreatePayload.runId,
      }),
    );
    expect(convergedCommit.runs.map((run) => run.id)).toEqual([
      resumeCreatePayload.runId,
      createPayload.runId,
    ]);

    const convergedTreemapResponse = await app.inject({
      method: "GET",
      url: `/repositories/verge-testbed/commits/${commitSha}/treemap`,
    });
    expect(convergedTreemapResponse.statusCode).toBe(200);
    const convergedTreemap = convergedTreemapResponse.json() as {
      tree: {
        kind: string;
        status: string;
        children?: Array<{
          kind: string;
          stepKey?: string | null;
          children?: Array<{
            kind: string;
            processKey?: string | null;
            sourceRunId?: string | null;
            children?: Array<{ processKey?: string | null; sourceRunId?: string | null }>;
          }>;
        }>;
      };
    };

    expect(convergedTreemap.tree.kind).toBe("commit");
    expect(convergedTreemap.tree.status).toBe("passed");
    const stepNode = convergedTreemap.tree.children?.find((node) => node.stepKey === "test-resume");
    expect(stepNode?.kind).toBe("step");
    const processNodes = stepNode?.children?.flatMap((child) => child.children ?? [child]) ?? [];
    expect(processNodes).toContainEqual(
      expect.objectContaining({
        processKey: failedAssignment?.processKey,
        sourceRunId: resumeCreatePayload.runId,
      }),
    );
  }, 30_000);
});
