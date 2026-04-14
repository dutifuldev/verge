import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";

import { listProcessRuns } from "./process-run-reads.js";
import { createProcessRuns } from "./run-creation.js";
import { parseJson, syncRepoAreaState, type VergeDatabase } from "./shared.js";

export const cloneStepRunForReuse = async (
  db: Kysely<VergeDatabase>,
  input: {
    sourceStepRunId: string;
    newStepRunId: string;
  },
): Promise<void> => {
  const sourceProcesses = await listProcessRuns(db, input.sourceStepRunId);
  if (sourceProcesses.length > 0) {
    await createProcessRuns(db, {
      stepRunId: input.newStepRunId,
      processes: sourceProcesses.map((process) => ({
        processId: process.process_id,
        processKey: process.process_key,
        displayName: process.display_name,
        kind: process.kind,
        filePath: process.file_path,
        metadata: parseJson<Record<string, unknown>>(process.metadata),
        selectionPayload: parseJson(process.selection_payload),
        status: "reused",
        attemptCount: process.attempt_count,
        durationMs: process.duration_ms,
      })),
    });
  }

  const sourceObservations = await db
    .selectFrom("observations")
    .selectAll()
    .where("step_run_id", "=", input.sourceStepRunId)
    .execute();

  if (sourceObservations.length === 0) {
    return;
  }

  const runId = await db
    .selectFrom("step_runs")
    .select("run_id")
    .where("id", "=", input.newStepRunId)
    .executeTakeFirstOrThrow();

  const observedAt = new Date();
  await db
    .insertInto("observations")
    .values(
      sourceObservations.map((observation) => ({
        id: randomUUID(),
        step_run_id: input.newStepRunId,
        process_run_id: null,
        process_id: observation.process_id,
        process_key: observation.process_key,
        area_key: observation.area_key,
        status: observation.status,
        summary: observation.summary,
        execution_scope: observation.execution_scope,
        observed_at: observedAt,
      })),
    )
    .execute();

  for (const observation of sourceObservations) {
    if (observation.area_key) {
      await syncRepoAreaState(db, runId.run_id, {
        areaKey: observation.area_key,
        status: observation.status,
        observedAt,
      });
    }
  }
};

export const cloneCompletedProcessesFromCheckpoint = async (
  db: Kysely<VergeDatabase>,
  input: {
    sourceStepRunId: string;
    newStepRunId: string;
    completedProcessKeys: string[];
  },
): Promise<void> => {
  if (input.completedProcessKeys.length === 0) {
    return;
  }

  const sourceProcesses = await db
    .selectFrom("process_runs")
    .selectAll()
    .where("step_run_id", "=", input.sourceStepRunId)
    .where("process_key", "in", input.completedProcessKeys)
    .execute();

  await createProcessRuns(db, {
    stepRunId: input.newStepRunId,
    processes: sourceProcesses.map((process) => ({
      processId: process.process_id,
      processKey: process.process_key,
      displayName: process.display_name,
      kind: process.kind,
      filePath: process.file_path,
      metadata: parseJson<Record<string, unknown>>(process.metadata),
      selectionPayload: parseJson(process.selection_payload),
      status: "reused",
      attemptCount: process.attempt_count,
      durationMs: process.duration_ms,
    })),
  });

  const sourceObservations = await db
    .selectFrom("observations")
    .selectAll()
    .where("step_run_id", "=", input.sourceStepRunId)
    .where("process_key", "in", input.completedProcessKeys)
    .execute();

  if (sourceObservations.length === 0) {
    return;
  }

  const runId = await db
    .selectFrom("step_runs")
    .select("run_id")
    .where("id", "=", input.newStepRunId)
    .executeTakeFirstOrThrow();

  const observedAt = new Date();
  await db
    .insertInto("observations")
    .values(
      sourceObservations.map((observation) => ({
        id: randomUUID(),
        step_run_id: input.newStepRunId,
        process_run_id: null,
        process_id: observation.process_id,
        process_key: observation.process_key,
        area_key: observation.area_key,
        status: observation.status,
        summary: observation.summary,
        execution_scope: observation.execution_scope,
        observed_at: observedAt,
      })),
    )
    .execute();

  for (const observation of sourceObservations) {
    if (observation.area_key) {
      await syncRepoAreaState(db, runId.run_id, {
        areaKey: observation.area_key,
        status: observation.status,
        observedAt,
      });
    }
  }
};
