import { randomUUID } from "node:crypto";

import { sql, type Kysely } from "kysely";

import type {
  AppendRunEventInput,
  ClaimedProcessRun,
  RecordArtifactInput,
  RecordCheckpointInput,
  RecordObservationInput,
  RunTrigger,
  StepSpec,
} from "@verge/contracts";

import { listProcessRuns } from "./run-reads.js";
import {
  json,
  parseJson,
  summarizeStatuses,
  syncRepoAreaState,
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
        created_at: new Date(),
      })),
    )
    .returningAll()
    .execute();
};

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

export const interruptPendingProcessesForStepRun = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
): Promise<void> => {
  const updated = await db
    .updateTable("process_runs")
    .set({
      status: "interrupted",
      finished_at: new Date(),
      claimed_by: null,
      lease_expires_at: null,
      last_heartbeat_at: null,
    })
    .where("step_run_id", "=", stepRunId)
    .where("status", "in", ["queued", "claimed", "running"])
    .returning("id")
    .execute();

  if (updated.length > 0) {
    await refreshStepRunStatus(db, stepRunId);
  }
};

const expireLeases = async (db: Kysely<VergeDatabase>, now = new Date()): Promise<void> => {
  await db
    .updateTable("process_runs")
    .set({
      status: "queued",
      claimed_by: null,
      lease_expires_at: null,
    })
    .where("status", "in", ["claimed", "running"])
    .where("lease_expires_at", "<", now)
    .execute();
};

export const claimNextProcessRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    workerId: string;
    leaseSeconds?: number;
  },
): Promise<ClaimedProcessRun | null> =>
  db.transaction().execute(async (trx) => {
    await expireLeases(trx);

    const candidate = await trx
      .selectFrom("process_runs")
      .innerJoin("step_runs", "step_runs.id", "process_runs.step_run_id")
      .innerJoin("runs", "runs.id", "step_runs.run_id")
      .innerJoin("repositories", "repositories.id", "runs.repository_id")
      .select([
        "process_runs.id as processRunId",
        "process_runs.step_run_id as stepRunId",
        "process_runs.process_key as processKey",
        "process_runs.display_name as processDisplayName",
        "process_runs.kind as processKind",
        "process_runs.metadata as processMetadata",
        "process_runs.selection_payload as selectionPayload",
        "runs.id as runId",
        "repositories.slug as repositorySlug",
        "repositories.root_path as repositoryRootPath",
        "step_runs.step_key as stepKey",
        "step_runs.display_name as stepDisplayName",
        "step_runs.kind as stepKind",
        "step_runs.checkpoint_enabled as checkpointEnabled",
        "step_runs.base_command as baseCommand",
      ])
      .where("process_runs.status", "=", "queued")
      .orderBy("process_runs.created_at", "asc")
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();

    if (!candidate) {
      return null;
    }

    const leaseExpiresAt = new Date(Date.now() + (input.leaseSeconds ?? 30) * 1000);
    const claimed = await trx
      .updateTable("process_runs")
      .set({
        status: "claimed",
        claimed_by: input.workerId,
        lease_expires_at: leaseExpiresAt,
        last_heartbeat_at: new Date(),
      })
      .where("id", "=", candidate.processRunId)
      .where("status", "=", "queued")
      .returning("id")
      .executeTakeFirst();

    if (!claimed) {
      return null;
    }

    return {
      runId: candidate.runId,
      stepRunId: candidate.stepRunId,
      processRunId: candidate.processRunId,
      repositorySlug: candidate.repositorySlug,
      repositoryRootPath: candidate.repositoryRootPath,
      stepKey: candidate.stepKey,
      stepDisplayName: candidate.stepDisplayName,
      stepKind: candidate.stepKind,
      processKey: candidate.processKey,
      processDisplayName: candidate.processDisplayName,
      processKind: candidate.processKind,
      areaKeys:
        parseJson<{ areaKeys?: string[] }>(candidate.processMetadata).areaKeys?.filter(
          (value): value is string => typeof value === "string",
        ) ?? [],
      command: [
        ...parseJson<string[]>(candidate.baseCommand),
        ...(parseJson<{ command?: string[] }>(candidate.selectionPayload).command ?? []),
      ],
      checkpointEnabled: candidate.checkpointEnabled,
    };
  });

export const heartbeatProcessRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    processRunId: string;
    workerId: string;
    leaseSeconds?: number;
  },
): Promise<void> => {
  await db
    .updateTable("process_runs")
    .set({
      last_heartbeat_at: new Date(),
      claimed_by: input.workerId,
      lease_expires_at: new Date(Date.now() + (input.leaseSeconds ?? 30) * 1000),
    })
    .where("id", "=", input.processRunId)
    .execute();
};

export const refreshRunStatus = async (db: Kysely<VergeDatabase>, runId: string) => {
  const stepRows = await db
    .selectFrom("step_runs")
    .select(["status", "started_at", "finished_at"])
    .where("run_id", "=", runId)
    .execute();

  if (stepRows.length === 0) {
    return db.selectFrom("runs").selectAll().where("id", "=", runId).executeTakeFirst();
  }

  const status = summarizeStatuses(stepRows.map((row) => row.status));
  const startedCandidates = stepRows
    .map((row) => row.started_at)
    .filter((value): value is Date => Boolean(value))
    .map((value) => value.getTime());
  const finishedCandidates = stepRows
    .map((row) => row.finished_at)
    .filter((value): value is Date => Boolean(value))
    .map((value) => value.getTime());

  return db
    .updateTable("runs")
    .set({
      status,
      started_at: startedCandidates.length ? new Date(Math.min(...startedCandidates)) : null,
      finished_at:
        finishedCandidates.length === stepRows.length && finishedCandidates.length > 0
          ? new Date(Math.max(...finishedCandidates))
          : null,
    })
    .where("id", "=", runId)
    .returningAll()
    .executeTakeFirst();
};

export const refreshStepRunStatus = async (db: Kysely<VergeDatabase>, stepRunId: string) => {
  const processRows = await listProcessRuns(db, stepRunId);
  if (processRows.length === 0) {
    return db.selectFrom("step_runs").selectAll().where("id", "=", stepRunId).executeTakeFirst();
  }

  const status = summarizeStatuses(processRows.map((process) => process.status));
  const startedCandidates = processRows
    .map((process) => process.started_at)
    .filter((value): value is Date => Boolean(value))
    .map((value) => value.getTime());
  const finishedCandidates = processRows
    .map((process) => process.finished_at)
    .filter((value): value is Date => Boolean(value))
    .map((value) => value.getTime());

  const updated = await db
    .updateTable("step_runs")
    .set({
      status,
      started_at: startedCandidates.length ? new Date(Math.min(...startedCandidates)) : null,
      finished_at:
        finishedCandidates.length === processRows.length && finishedCandidates.length > 0
          ? new Date(Math.max(...finishedCandidates))
          : null,
    })
    .where("id", "=", stepRunId)
    .returningAll()
    .executeTakeFirst();

  if (updated) {
    await refreshRunStatus(db, updated.run_id);
  }

  return updated;
};

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
    await db
      .updateTable("process_runs")
      .set({
        status: input.kind === "passed" ? "passed" : input.kind,
        finished_at: new Date(),
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
