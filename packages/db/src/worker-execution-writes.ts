import type { Kysely } from "kysely";

import type { ClaimedProcessRun } from "@verge/contracts";

import { listProcessRuns } from "./process-run-reads.js";
import { durationMsBetween, parseJson, summarizeStatuses, type VergeDatabase } from "./shared.js";

export const refreshRunStatus = async (db: Kysely<VergeDatabase>, runId: string) => {
  const stepRows = await db
    .selectFrom("step_runs")
    .select(["status", "started_at", "finished_at"])
    .select("duration_ms")
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
  const hasIncompleteRows = stepRows.some((row) =>
    ["queued", "claimed", "running"].includes(row.status),
  );
  const runFinishedAt =
    !hasIncompleteRows && finishedCandidates.length > 0
      ? new Date(Math.max(...finishedCandidates))
      : null;
  const runStartedAt = startedCandidates.length ? new Date(Math.min(...startedCandidates)) : null;

  return db
    .updateTable("runs")
    .set({
      status,
      started_at: runStartedAt,
      finished_at: runFinishedAt,
      duration_ms: durationMsBetween(runStartedAt, runFinishedAt),
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
  const hasIncompleteRows = processRows.some((process) =>
    ["queued", "claimed", "running"].includes(process.status),
  );
  const stepFinishedAt =
    !hasIncompleteRows && finishedCandidates.length > 0
      ? new Date(Math.max(...finishedCandidates))
      : null;
  const stepStartedAt = startedCandidates.length ? new Date(Math.min(...startedCandidates)) : null;

  const updated = await db
    .updateTable("step_runs")
    .set({
      status,
      started_at: stepStartedAt,
      finished_at: stepFinishedAt,
      duration_ms: durationMsBetween(stepStartedAt, stepFinishedAt),
    })
    .where("id", "=", stepRunId)
    .returningAll()
    .executeTakeFirst();

  if (updated) {
    await refreshRunStatus(db, updated.run_id);
  }

  return updated;
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
