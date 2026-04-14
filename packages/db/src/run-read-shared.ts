import type { Kysely } from "kysely";

import type { RunListItem, RunTrigger, StepRunSummary } from "@verge/contracts";

import { coalesceDurationMs, iso, parseJson, type VergeDatabase } from "./shared.js";
import { listProcessRuns } from "./process-run-reads.js";

export const selectStepRunRows = (db: Kysely<VergeDatabase>, repositorySlug?: string) => {
  let query = db
    .selectFrom("step_runs")
    .innerJoin("runs", "runs.id", "step_runs.run_id")
    .innerJoin("repositories", "repositories.id", "runs.repository_id")
    .select([
      "step_runs.id as stepRunId",
      "step_runs.run_id as runId",
      "step_runs.step_key as stepKey",
      "step_runs.display_name as stepDisplayName",
      "step_runs.kind as stepKind",
      "step_runs.status as stepStatus",
      "step_runs.plan_reason as planReason",
      "step_runs.reused_from_step_run_id as reusedFromStepRunId",
      "step_runs.checkpoint_source_step_run_id as checkpointSourceStepRunId",
      "step_runs.created_at as stepCreatedAt",
      "step_runs.started_at as stepStartedAt",
      "step_runs.finished_at as stepFinishedAt",
      "step_runs.duration_ms as stepDurationMs",
      "repositories.slug as repositorySlug",
      "runs.trigger as trigger",
      "runs.commit_sha as commitSha",
      "runs.commit_title as commitTitle",
      "runs.branch as branch",
      "runs.pull_request_number as pullRequestNumber",
      "runs.changed_files as changedFiles",
    ]);

  if (repositorySlug) {
    query = query.where("repositories.slug", "=", repositorySlug);
  }

  return query;
};

export const selectRunRows = (db: Kysely<VergeDatabase>, repositorySlug?: string) => {
  let query = db
    .selectFrom("runs")
    .innerJoin("repositories", "repositories.id", "runs.repository_id")
    .select([
      "runs.id as id",
      "repositories.slug as repositorySlug",
      "runs.trigger as trigger",
      "runs.commit_sha as commitSha",
      "runs.commit_title as commitTitle",
      "runs.branch as branch",
      "runs.pull_request_number as pullRequestNumber",
      "runs.changed_files as changedFiles",
      "runs.status as status",
      "runs.created_at as createdAt",
      "runs.started_at as startedAt",
      "runs.finished_at as finishedAt",
      "runs.duration_ms as durationMs",
    ]);

  if (repositorySlug) {
    query = query.where("repositories.slug", "=", repositorySlug);
  }

  return query;
};

export type StepRunSelectionRow = Awaited<
  ReturnType<ReturnType<typeof selectStepRunRows>["executeTakeFirst"]>
>;

export type RunSelectionRow = Awaited<
  ReturnType<ReturnType<typeof selectRunRows>["executeTakeFirst"]>
>;

export const toStepRunSummary = async (
  db: Kysely<VergeDatabase>,
  row: StepRunSelectionRow,
): Promise<StepRunSummary> => {
  if (!row) {
    throw new Error("Missing step run row");
  }

  const processRuns = await listProcessRuns(db, row.stepRunId);

  return {
    id: row.stepRunId,
    runId: row.runId,
    stepKey: row.stepKey,
    stepDisplayName: row.stepDisplayName,
    stepKind: row.stepKind,
    status: row.stepStatus as StepRunSummary["status"],
    planReason: row.planReason,
    reusedFromStepRunId: row.reusedFromStepRunId,
    checkpointSourceStepRunId: row.checkpointSourceStepRunId,
    createdAt: row.stepCreatedAt.toISOString(),
    startedAt: iso(row.stepStartedAt),
    finishedAt: iso(row.stepFinishedAt),
    durationMs: coalesceDurationMs(row.stepDurationMs, row.stepStartedAt, row.stepFinishedAt),
    processCount: processRuns.length,
  };
};

export const toRunSummary = async (
  db: Kysely<VergeDatabase>,
  row: RunSelectionRow,
): Promise<RunListItem> => {
  if (!row) {
    throw new Error("Missing run row");
  }

  const stepRows = await selectStepRunRows(db)
    .where("step_runs.run_id", "=", row.id)
    .orderBy("step_runs.created_at", "asc")
    .execute();
  const steps = await Promise.all(stepRows.map((stepRow) => toStepRunSummary(db, stepRow)));

  return {
    id: row.id,
    repositorySlug: row.repositorySlug,
    trigger: row.trigger as RunTrigger,
    commitSha: row.commitSha,
    commitTitle: row.commitTitle,
    branch: row.branch,
    pullRequestNumber: row.pullRequestNumber,
    changedFiles: parseJson<string[]>(row.changedFiles),
    status: row.status as RunListItem["status"],
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    durationMs: coalesceDurationMs(row.durationMs, row.startedAt, row.finishedAt),
    steps,
  };
};
