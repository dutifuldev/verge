import { type Kysely } from "kysely";

import type {
  CommitDetail,
  PaginatedRunList,
  PullRequestDetail,
  RepositoryHealth,
  RunDetail,
  RunListItem,
  RunListQuery,
  RunTrigger,
  StepRunDetail,
  StepRunSummary,
} from "@verge/contracts";
import { determineFreshnessBucket } from "@verge/core";

import {
  iso,
  parseJson,
  type CheckpointRow,
  type ProcessRunRow,
  type VergeDatabase,
} from "./shared.js";

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

const selectStepRunRows = (db: Kysely<VergeDatabase>, repositorySlug?: string) => {
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
      "repositories.slug as repositorySlug",
      "runs.trigger as trigger",
      "runs.commit_sha as commitSha",
      "runs.branch as branch",
      "runs.pull_request_number as pullRequestNumber",
      "runs.changed_files as changedFiles",
    ]);

  if (repositorySlug) {
    query = query.where("repositories.slug", "=", repositorySlug);
  }

  return query;
};

const selectRunRows = (db: Kysely<VergeDatabase>, repositorySlug?: string) => {
  let query = db
    .selectFrom("runs")
    .innerJoin("repositories", "repositories.id", "runs.repository_id")
    .select([
      "runs.id as id",
      "repositories.slug as repositorySlug",
      "runs.trigger as trigger",
      "runs.commit_sha as commitSha",
      "runs.branch as branch",
      "runs.pull_request_number as pullRequestNumber",
      "runs.changed_files as changedFiles",
      "runs.status as status",
      "runs.created_at as createdAt",
      "runs.started_at as startedAt",
      "runs.finished_at as finishedAt",
    ]);

  if (repositorySlug) {
    query = query.where("repositories.slug", "=", repositorySlug);
  }

  return query;
};

const toStepRunSummary = async (
  db: Kysely<VergeDatabase>,
  row: Awaited<ReturnType<ReturnType<typeof selectStepRunRows>["executeTakeFirst"]>>,
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
    processCount: processRuns.length,
  };
};

export const getStepRunDetail = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
): Promise<StepRunDetail | null> => {
  const row = await selectStepRunRows(db).where("step_runs.id", "=", stepRunId).executeTakeFirst();
  if (!row) {
    return null;
  }

  const summary = await toStepRunSummary(db, row);
  const processRuns = await listProcessRuns(db, stepRunId);
  const observations = await db
    .selectFrom("observations")
    .selectAll()
    .where("step_run_id", "=", stepRunId)
    .orderBy("observed_at", "asc")
    .execute();
  const events = await db
    .selectFrom("run_events")
    .selectAll()
    .where("step_run_id", "=", stepRunId)
    .orderBy("created_at", "asc")
    .execute();
  const artifacts = await db
    .selectFrom("artifacts")
    .selectAll()
    .where("step_run_id", "=", stepRunId)
    .orderBy("created_at", "asc")
    .execute();
  const checkpoints = await db
    .selectFrom("checkpoints")
    .selectAll()
    .where("step_run_id", "=", stepRunId)
    .orderBy("created_at", "asc")
    .execute();

  return {
    ...summary,
    processes: processRuns.map((process) => ({
      id: process.id,
      processKey: process.process_key,
      processDisplayName: process.display_name,
      processKind: process.kind,
      filePath: process.file_path,
      status: process.status as StepRunDetail["processes"][number]["status"],
      attemptCount: process.attempt_count,
      startedAt: iso(process.started_at),
      finishedAt: iso(process.finished_at),
    })),
    observations: observations.map((observation) => ({
      id: observation.id,
      stepRunId: observation.step_run_id,
      processRunId: observation.process_run_id,
      processKey: observation.process_key,
      areaKey: observation.area_key,
      status: observation.status as StepRunDetail["observations"][number]["status"],
      summary: parseJson<Record<string, unknown>>(observation.summary),
      executionScope: parseJson<Record<string, unknown>>(observation.execution_scope),
      observedAt: observation.observed_at.toISOString(),
    })),
    events: events.map((event) => ({
      id: event.id,
      stepRunId: event.step_run_id,
      processRunId: event.process_run_id,
      kind: event.kind,
      message: event.message,
      payload: parseJson<Record<string, unknown>>(event.payload),
      createdAt: event.created_at.toISOString(),
    })),
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      stepRunId: artifact.step_run_id,
      processRunId: artifact.process_run_id,
      artifactKey: artifact.artifact_key,
      storagePath: artifact.storage_path,
      mediaType: artifact.media_type,
      metadata: parseJson<Record<string, unknown>>(artifact.metadata),
      createdAt: artifact.created_at.toISOString(),
    })),
    checkpoints: checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      stepRunId: checkpoint.step_run_id,
      completedProcessKeys: parseJson<string[]>(checkpoint.completed_process_keys),
      pendingProcessKeys: parseJson<string[]>(checkpoint.pending_process_keys),
      storagePath: checkpoint.storage_path,
      createdAt: checkpoint.created_at.toISOString(),
      resumableUntil: checkpoint.resumable_until.toISOString(),
    })),
  };
};

export const getRunDetail = async (
  db: Kysely<VergeDatabase>,
  runId: string,
): Promise<RunDetail | null> => {
  const run = await selectRunRows(db).where("runs.id", "=", runId).executeTakeFirst();
  if (!run) {
    return null;
  }

  const stepRows = await selectStepRunRows(db)
    .where("step_runs.run_id", "=", runId)
    .orderBy("step_runs.created_at", "asc")
    .execute();
  const steps = await Promise.all(stepRows.map((row) => toStepRunSummary(db, row)));

  return {
    id: run.id,
    repositorySlug: run.repositorySlug,
    trigger: run.trigger as RunTrigger,
    commitSha: run.commitSha,
    branch: run.branch,
    pullRequestNumber: run.pullRequestNumber,
    changedFiles: parseJson<string[]>(run.changedFiles),
    status: run.status as RunDetail["status"],
    createdAt: run.createdAt.toISOString(),
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
    steps,
  };
};

export const listRepositoryRuns = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
  query: RunListQuery,
): Promise<PaginatedRunList> => {
  const page = Math.max(1, query.page);
  const pageSize = Math.max(1, Math.min(100, query.pageSize));
  const offset = (page - 1) * pageSize;

  const rows = await selectRunRows(db, repositorySlug).orderBy("runs.created_at", "desc").execute();

  const summaries = await Promise.all(
    rows.map(async (row): Promise<RunListItem> => {
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
        branch: row.branch,
        pullRequestNumber: row.pullRequestNumber,
        changedFiles: parseJson<string[]>(row.changedFiles),
        status: row.status as RunListItem["status"],
        createdAt: row.createdAt.toISOString(),
        startedAt: iso(row.startedAt),
        finishedAt: iso(row.finishedAt),
        steps,
      };
    }),
  );

  const filtered = summaries.filter((summary) => {
    if (query.status && summary.status !== query.status) {
      return false;
    }

    if (query.trigger && summary.trigger !== query.trigger) {
      return false;
    }

    if (query.stepKey && !summary.steps.some((step) => step.stepKey === query.stepKey)) {
      return false;
    }

    return true;
  });

  return {
    page,
    pageSize,
    total: filtered.length,
    items: filtered.slice(offset, offset + pageSize),
  };
};

export const getRepositoryHealth = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
): Promise<RepositoryHealth> => {
  const repository = await db
    .selectFrom("repositories")
    .selectAll()
    .where("slug", "=", repositorySlug)
    .executeTakeFirstOrThrow();
  const runs = await listRepositoryRuns(db, repositorySlug, {
    page: 1,
    pageSize: 12,
  });
  const areaStates = await db
    .selectFrom("repo_area_state")
    .innerJoin("repo_areas", "repo_areas.id", "repo_area_state.repo_area_id")
    .select([
      "repo_areas.key as key",
      "repo_areas.display_name as displayName",
      "repo_area_state.latest_status as latestStatus",
      "repo_area_state.freshness_bucket as freshnessBucket",
      "repo_area_state.last_observed_at as lastObservedAt",
      "repo_area_state.last_successful_observed_at as lastSuccessfulObservedAt",
    ])
    .where("repo_areas.repository_id", "=", repository.id)
    .orderBy("repo_areas.key", "asc")
    .execute();

  return {
    repositorySlug,
    repositoryDisplayName: repository.display_name,
    activeRuns: runs.items.filter((run) => run.status === "queued" || run.status === "running"),
    recentRuns: runs.items,
    areaStates: areaStates.map((areaState) => ({
      key: areaState.key,
      displayName: areaState.displayName,
      latestStatus:
        areaState.latestStatus as RepositoryHealth["areaStates"][number]["latestStatus"],
      freshnessBucket: determineFreshnessBucket(
        areaState.lastSuccessfulObservedAt ?? areaState.lastObservedAt,
        new Date(),
      ) as RepositoryHealth["areaStates"][number]["freshnessBucket"],
      lastObservedAt: iso(areaState.lastObservedAt),
      lastSuccessfulObservedAt: iso(areaState.lastSuccessfulObservedAt),
    })),
  };
};

export const getCommitDetail = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
  commitSha: string,
): Promise<CommitDetail> => {
  const runIds = await db
    .selectFrom("runs")
    .innerJoin("repositories", "repositories.id", "runs.repository_id")
    .select(["runs.id"])
    .where("repositories.slug", "=", repositorySlug)
    .where("runs.commit_sha", "=", commitSha)
    .orderBy("runs.created_at", "desc")
    .execute();

  return {
    repositorySlug,
    commitSha,
    runs: (await Promise.all(runIds.map((run) => getRunDetail(db, run.id)))).filter(
      (run): run is RunDetail => run !== null,
    ),
  };
};

export const getPullRequestDetail = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
  pullRequestNumber: number,
): Promise<PullRequestDetail> => {
  const runIds = await db
    .selectFrom("runs")
    .innerJoin("repositories", "repositories.id", "runs.repository_id")
    .select(["runs.id"])
    .where("repositories.slug", "=", repositorySlug)
    .where("runs.pull_request_number", "=", pullRequestNumber)
    .orderBy("runs.created_at", "desc")
    .execute();

  return {
    repositorySlug,
    pullRequestNumber,
    runs: (await Promise.all(runIds.map((run) => getRunDetail(db, run.id)))).filter(
      (run): run is RunDetail => run !== null,
    ),
  };
};
