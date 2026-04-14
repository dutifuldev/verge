import type { Kysely } from "kysely";

import type {
  CommitDetail,
  PaginatedRunList,
  PullRequestDetail,
  RepositoryHealth,
  RunDetail,
  RunListQuery,
  StepRunDetail,
  RunTrigger,
} from "@verge/contracts";
import { determineFreshnessBucket } from "@verge/core";

import { coalesceDurationMs, iso, parseJson, type VergeDatabase } from "./shared.js";
import { listProcessRuns } from "./process-run-reads.js";
import {
  selectRunRows,
  selectStepRunRows,
  toRunSummary,
  toStepRunSummary,
} from "./run-read-shared.js";

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
      durationMs: coalesceDurationMs(process.duration_ms, process.started_at, process.finished_at),
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

  const summary = await toRunSummary(db, run);
  return {
    ...summary,
    trigger: summary.trigger as RunTrigger,
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
  const summaries = await Promise.all(rows.map((row) => toRunSummary(db, row)));

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
