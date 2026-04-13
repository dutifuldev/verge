import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseConnection, resetDatabase } from "@verge/db";

import { bootstrapApiApp } from "./app.js";

const runIntegration = process.env.VERGE_RUN_DB_INTEGRATION === "1";

describe.runIf(runIntegration)("api integration", () => {
  const connection = createDatabaseConnection(
    process.env.VERGE_INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  );

  let app: Awaited<ReturnType<typeof bootstrapApiApp>>;

  beforeAll(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "integration-secret";
    await resetDatabase(connection.db).catch(() => undefined);
    app = await bootstrapApiApp(connection);
  });

  afterAll(async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    await app.close();
  });

  it("creates a manual run request and exposes health", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/run-requests/manual",
      payload: {
        repositorySlug: "verge",
        commitSha: "integration-sha",
        changedFiles: ["apps/api/src/app.ts"],
      },
    });

    expect(createResponse.statusCode).toBe(200);
    const createPayload = createResponse.json() as {
      runRequestId: string;
      runIds: string[];
    };
    expect(createPayload.runIds.length).toBeGreaterThan(0);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/run-requests/${createPayload.runRequestId}`,
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
  });

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
  });
});
