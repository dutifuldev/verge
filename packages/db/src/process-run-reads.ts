import type { Kysely } from "kysely";

import type { CheckpointRow, ProcessRunRow, VergeDatabase } from "./shared.js";

export const listProcessRuns = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
): Promise<ProcessRunRow[]> =>
  db
    .selectFrom("process_runs")
    .selectAll()
    .where("step_run_id", "=", stepRunId)
    .orderBy("created_at", "asc")
    .execute();

export const processRunBelongsToStepRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    stepRunId: string;
    processRunId: string;
  },
): Promise<boolean> => {
  const row = await db
    .selectFrom("process_runs")
    .select("id")
    .where("id", "=", input.processRunId)
    .where("step_run_id", "=", input.stepRunId)
    .executeTakeFirst();

  return Boolean(row);
};

export const processRunLeaseIsActive = async (
  db: Kysely<VergeDatabase>,
  input: {
    stepRunId: string;
    processRunId: string;
    workerId: string;
    now?: Date;
  },
): Promise<boolean> => {
  const row = await db
    .selectFrom("process_runs")
    .select("id")
    .where("id", "=", input.processRunId)
    .where("step_run_id", "=", input.stepRunId)
    .where("claimed_by", "=", input.workerId)
    .where("lease_expires_at", ">", input.now ?? new Date())
    .where("status", "in", ["claimed", "running"])
    .executeTakeFirst();

  return Boolean(row);
};

export const findReusableStepRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    repositoryId: string;
    stepKey: string;
    fingerprint: string;
    stepSpecId?: string | null;
  },
) => {
  let query = db
    .selectFrom("step_runs")
    .innerJoin("runs", "runs.id", "step_runs.run_id")
    .selectAll("step_runs")
    .where("runs.repository_id", "=", input.repositoryId)
    .where("step_runs.step_key", "=", input.stepKey)
    .where("step_runs.fingerprint", "=", input.fingerprint)
    .where((eb) => eb("step_runs.status", "=", "passed").or("step_runs.status", "=", "reused"))
    .orderBy("step_runs.created_at", "desc");

  if (input.stepSpecId) {
    query = query.where("step_runs.step_spec_id", "=", input.stepSpecId);
  }

  return query.executeTakeFirst();
};

export const findLatestCheckpoint = async (
  db: Kysely<VergeDatabase>,
  input: {
    repositoryId: string;
    stepKey: string;
    fingerprint: string;
    stepSpecId?: string | null;
    now?: Date;
  },
): Promise<CheckpointRow | undefined> => {
  let query = db
    .selectFrom("checkpoints")
    .innerJoin("step_runs", "step_runs.id", "checkpoints.step_run_id")
    .innerJoin("runs", "runs.id", "step_runs.run_id")
    .selectAll("checkpoints")
    .where("runs.repository_id", "=", input.repositoryId)
    .where("checkpoints.step_key", "=", input.stepKey)
    .where("checkpoints.fingerprint", "=", input.fingerprint)
    .where("checkpoints.resumable_until", ">", input.now ?? new Date())
    .orderBy("checkpoints.created_at", "desc");

  if (input.stepSpecId) {
    query = query.where("checkpoints.step_spec_id", "=", input.stepSpecId);
  }

  return query.executeTakeFirst();
};
