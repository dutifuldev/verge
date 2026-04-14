import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";

import type { RunTrigger, StepSpec } from "@verge/contracts";

import {
  json,
  type EventIngestionRow,
  type RunRow,
  type StepRunRow,
  type VergeDatabase,
} from "./shared.js";

export const createEventIngestion = async (
  db: Kysely<VergeDatabase>,
  input: {
    repositoryId: string;
    source: string;
    deliveryId: string;
    eventName: string;
    payload: unknown;
  },
): Promise<{
  eventIngestion: EventIngestionRow;
  inserted: boolean;
}> => {
  const inserted = await db
    .insertInto("event_ingestions")
    .values({
      id: randomUUID(),
      repository_id: input.repositoryId,
      source: input.source,
      delivery_id: input.deliveryId,
      event_name: input.eventName,
      payload: json(input.payload),
    })
    .onConflict((oc) => oc.columns(["repository_id", "source", "delivery_id"]).doNothing())
    .returningAll()
    .executeTakeFirst();

  if (inserted) {
    return {
      eventIngestion: inserted,
      inserted: true,
    };
  }

  const existing = await db
    .selectFrom("event_ingestions")
    .selectAll()
    .where("repository_id", "=", input.repositoryId)
    .where("source", "=", input.source)
    .where("delivery_id", "=", input.deliveryId)
    .executeTakeFirstOrThrow();

  return {
    eventIngestion: existing,
    inserted: false,
  };
};

export const createRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    repositoryId: string;
    trigger: RunTrigger;
    commitSha: string;
    changedFiles: string[];
    branch?: string;
    pullRequestNumber?: number;
    eventIngestionId?: string;
    status?: string;
  },
): Promise<RunRow> =>
  db
    .insertInto("runs")
    .values({
      id: randomUUID(),
      repository_id: input.repositoryId,
      event_ingestion_id: input.eventIngestionId ?? null,
      trigger: input.trigger,
      commit_sha: input.commitSha,
      branch: input.branch ?? null,
      pull_request_number: input.pullRequestNumber ?? null,
      changed_files: json(input.changedFiles),
      status: input.status ?? "queued",
      started_at: null,
      finished_at: null,
      duration_ms: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

export const createStepRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    runId: string;
    stepSpecId?: string | null;
    stepSpec: StepSpec;
    configFingerprint: string;
    fingerprint: string;
    status: string;
    planReason: string;
    reusedFromStepRunId?: string | null;
    checkpointSourceStepRunId?: string | null;
  },
): Promise<StepRunRow> => {
  const now = new Date();
  return db
    .insertInto("step_runs")
    .values({
      id: randomUUID(),
      run_id: input.runId,
      step_spec_id: input.stepSpecId ?? null,
      step_key: input.stepSpec.key,
      display_name: input.stepSpec.displayName,
      kind: input.stepSpec.kind,
      base_command: json(input.stepSpec.baseCommand),
      cwd: input.stepSpec.cwd,
      observed_area_keys: json(input.stepSpec.observedAreaKeys),
      materialization: json(input.stepSpec.materialization),
      checkpoint_enabled: input.stepSpec.checkpointEnabled,
      config_fingerprint: input.configFingerprint,
      fingerprint: input.fingerprint,
      status: input.status,
      plan_reason: input.planReason,
      reused_from_step_run_id: input.reusedFromStepRunId ?? null,
      checkpoint_source_step_run_id: input.checkpointSourceStepRunId ?? null,
      started_at: input.status === "running" ? now : null,
      finished_at:
        input.status === "passed" || input.status === "failed" || input.status === "reused"
          ? now
          : null,
      duration_ms: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
};

export const createProcessRuns = async (
  db: Kysely<VergeDatabase>,
  input: {
    stepRunId: string;
    processes: Array<{
      processId?: string | null;
      processKey: string;
      displayName: string;
      kind: string;
      filePath?: string | null;
      metadata?: Record<string, unknown>;
      selectionPayload: unknown;
      status?: string;
      attemptCount?: number;
      durationMs?: number | null;
    }>;
  },
) => {
  if (input.processes.length === 0) {
    return [];
  }

  return db
    .insertInto("process_runs")
    .values(
      input.processes.map((processRun) => ({
        id: randomUUID(),
        step_run_id: input.stepRunId,
        process_id: processRun.processId ?? null,
        process_key: processRun.processKey,
        display_name: processRun.displayName,
        kind: processRun.kind,
        file_path: processRun.filePath ?? null,
        metadata: json(processRun.metadata ?? {}),
        selection_payload: json(processRun.selectionPayload),
        status: processRun.status ?? "queued",
        attempt_count: processRun.attemptCount ?? 0,
        duration_ms: processRun.durationMs ?? null,
        created_at: new Date(),
      })),
    )
    .returningAll()
    .execute();
};
