import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";
import { sql } from "kysely";

import type {
  AppendRunEventInput,
  RecordArtifactInput,
  RecordCheckpointInput,
  RecordObservationInput,
} from "@verge/contracts";

import { json, syncRepoAreaState, type VergeDatabase } from "./shared.js";
import { refreshStepRunStatus } from "./worker-execution-writes.js";

export const recordRunEvent = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
  input: AppendRunEventInput,
): Promise<void> => {
  await db
    .insertInto("run_events")
    .values({
      id: randomUUID(),
      step_run_id: stepRunId,
      process_run_id: input.processRunId ?? null,
      kind: input.kind,
      message: input.message,
      payload: json(input.payload ?? {}),
    })
    .execute();

  if (!input.processRunId) {
    return;
  }

  if (input.kind === "started") {
    await db
      .updateTable("process_runs")
      .set({
        status: "running",
        started_at: new Date(),
        attempt_count: sql`attempt_count + 1`,
        duration_ms: null,
      })
      .where("id", "=", input.processRunId)
      .execute();

    await db
      .updateTable("step_runs")
      .set({
        status: "running",
        started_at: sql`coalesce(started_at, now())`,
      })
      .where("id", "=", stepRunId)
      .execute();

    const row = await db
      .selectFrom("step_runs")
      .select("run_id")
      .where("id", "=", stepRunId)
      .executeTakeFirst();

    if (row) {
      await db
        .updateTable("runs")
        .set({
          status: "running",
          started_at: sql`coalesce(started_at, now())`,
        })
        .where("id", "=", row.run_id)
        .execute();
    }
  }

  if (input.kind === "passed" || input.kind === "failed" || input.kind === "interrupted") {
    const finishedAt = new Date();
    await db
      .updateTable("process_runs")
      .set({
        status: input.kind === "passed" ? "passed" : input.kind,
        finished_at: finishedAt,
        duration_ms: sql`greatest(
          0,
          extract(epoch from ${finishedAt} - coalesce(started_at, ${finishedAt})) * 1000
        )::integer`,
      })
      .where("id", "=", input.processRunId)
      .execute();

    await refreshStepRunStatus(db, stepRunId);
  }
};

export const recordObservation = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
  input: RecordObservationInput,
): Promise<void> => {
  const stepRun = await db
    .selectFrom("step_runs")
    .select(["run_id"])
    .where("id", "=", stepRunId)
    .executeTakeFirstOrThrow();

  await db
    .insertInto("observations")
    .values({
      id: randomUUID(),
      step_run_id: stepRunId,
      process_run_id: input.processRunId ?? null,
      process_id: null,
      process_key: input.processKey ?? null,
      area_key: input.areaKey ?? null,
      status: input.status,
      summary: json(input.summary),
      execution_scope: json(input.executionScope),
    })
    .execute();

  if (input.areaKey) {
    await syncRepoAreaState(db, stepRun.run_id, {
      areaKey: input.areaKey,
      status: input.status,
    });
  }
};

export const recordArtifact = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
  input: RecordArtifactInput,
): Promise<void> => {
  await db
    .insertInto("artifacts")
    .values({
      id: randomUUID(),
      step_run_id: stepRunId,
      process_run_id: input.processRunId ?? null,
      artifact_key: input.artifactKey,
      storage_path: input.storagePath,
      media_type: input.mediaType,
      metadata: json(input.metadata),
    })
    .execute();
};

export const recordCheckpoint = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
  input: {
    stepSpecId?: string | null;
    stepKey: string;
    fingerprint: string;
    checkpoint: RecordCheckpointInput;
  },
): Promise<void> => {
  await db
    .insertInto("checkpoints")
    .values({
      id: randomUUID(),
      step_run_id: stepRunId,
      step_spec_id: input.stepSpecId ?? null,
      step_key: input.stepKey,
      fingerprint: input.fingerprint,
      completed_process_keys: json(input.checkpoint.completedProcessKeys),
      pending_process_keys: json(input.checkpoint.pendingProcessKeys),
      storage_path: input.checkpoint.storagePath ?? null,
      resumable_until: new Date(input.checkpoint.resumableUntil),
    })
    .execute();
};

export const resetDatabase = async (db: Kysely<VergeDatabase>): Promise<void> => {
  for (const table of [
    "checkpoints",
    "artifacts",
    "observations",
    "run_events",
    "process_runs",
    "step_runs",
    "runs",
    "event_ingestions",
    "processes",
    "step_specs",
    "repo_area_state",
    "repo_areas",
    "repositories",
  ]) {
    await sql.raw(`truncate table ${table} cascade`).execute(db);
  }
};
