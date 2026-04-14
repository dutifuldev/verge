import { sql, type Kysely } from "kysely";

import type {
  CommitListItem,
  CommitListQuery,
  CommitDetail,
  PaginatedCommitList,
  PaginatedRunList,
  PullRequestDetail,
  RepositoryHealth,
  RunDetail,
  RunListQuery,
  StepRunDetail,
  RunTrigger,
} from "@verge/contracts";
import { determineFreshnessBucket } from "@verge/core";

import {
  coalesceDurationMs,
  iso,
  parseJson,
  summarizeStatuses,
  type VergeDatabase,
} from "./shared.js";
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

const fallbackCommitTitle = (commitTitle: string | null, commitSha: string): string =>
  commitTitle && commitTitle.trim().length > 0 ? commitTitle : `Commit ${commitSha.slice(0, 7)}`;

export const listRepositoryCommits = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
  query: CommitListQuery,
): Promise<PaginatedCommitList> => {
  const page = Math.max(1, query.page);
  const pageSize = Math.max(1, Math.min(100, query.pageSize));
  const offset = (page - 1) * pageSize;

  const repository = await db
    .selectFrom("repositories")
    .select(["id", "slug"])
    .where("slug", "=", repositorySlug)
    .executeTakeFirstOrThrow();

  const runRows = await selectRunRows(db, repositorySlug)
    .orderBy("runs.created_at", "desc")
    .execute();
  const orderedCommits: string[] = [];
  const latestRunByCommit = new Map<string, (typeof runRows)[number]>();
  const attemptCountByCommit = new Map<string, number>();

  for (const run of runRows) {
    if (!latestRunByCommit.has(run.commitSha)) {
      orderedCommits.push(run.commitSha);
      latestRunByCommit.set(run.commitSha, run);
    }

    attemptCountByCommit.set(run.commitSha, (attemptCountByCommit.get(run.commitSha) ?? 0) + 1);
  }

  const total = orderedCommits.length;
  const pageCommitShas = orderedCommits.slice(offset, offset + pageSize);

  if (pageCommitShas.length === 0) {
    return {
      page,
      pageSize,
      total,
      items: [],
    };
  }

  const projectionRows = await db
    .selectFrom("commit_process_state")
    .select(["commit_sha as commitSha", "status"])
    .where("repository_id", "=", repository.id)
    .where("commit_sha", "in", pageCommitShas)
    .execute();

  const expectedCountRows = await db
    .selectFrom("process_runs")
    .innerJoin("step_runs", "step_runs.id", "process_runs.step_run_id")
    .innerJoin("runs", "runs.id", "step_runs.run_id")
    .select([
      "runs.commit_sha as commitSha",
      sql<number>`count(distinct step_runs.step_key || ':' || process_runs.process_key)`.as(
        "expectedProcessCount",
      ),
    ])
    .where("runs.repository_id", "=", repository.id)
    .where("runs.commit_sha", "in", pageCommitShas)
    .groupBy("runs.commit_sha")
    .execute();

  const statusesByCommit = new Map<string, string[]>();
  const selectedCountByCommit = new Map<string, number>();
  const healthyCountByCommit = new Map<string, number>();

  for (const row of projectionRows) {
    const statuses = statusesByCommit.get(row.commitSha) ?? [];
    statuses.push(row.status);
    statusesByCommit.set(row.commitSha, statuses);
    selectedCountByCommit.set(row.commitSha, (selectedCountByCommit.get(row.commitSha) ?? 0) + 1);
    if (["passed", "reused", "skipped"].includes(row.status)) {
      healthyCountByCommit.set(row.commitSha, (healthyCountByCommit.get(row.commitSha) ?? 0) + 1);
    }
  }

  const expectedCountByCommit = new Map(
    expectedCountRows.map((row) => [row.commitSha, Number(row.expectedProcessCount)]),
  );

  const items: CommitListItem[] = [];

  for (const commitSha of pageCommitShas) {
    const latestRun = latestRunByCommit.get(commitSha);
    if (!latestRun) {
      continue;
    }

    const statuses = statusesByCommit.get(commitSha) ?? [];
    const coveredProcessCount = selectedCountByCommit.get(commitSha) ?? 0;
    const expectedProcessCount = expectedCountByCommit.get(commitSha) ?? 0;
    const healthyProcessCount = healthyCountByCommit.get(commitSha) ?? 0;

    items.push({
      repositorySlug,
      commitSha,
      commitTitle: fallbackCommitTitle(latestRun.commitTitle, commitSha),
      status: (statuses.length > 0
        ? summarizeStatuses(statuses)
        : latestRun.status) as CommitListItem["status"],
      coveragePercent:
        expectedProcessCount === 0
          ? 0
          : Math.round((coveredProcessCount / expectedProcessCount) * 100),
      coveredProcessCount,
      expectedProcessCount,
      healthyProcessCount,
      attemptCount: attemptCountByCommit.get(commitSha) ?? 0,
      latestCreatedAt: latestRun.createdAt.toISOString(),
    });
  }

  return {
    page,
    pageSize,
    total,
    items,
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
): Promise<CommitDetail | null> => {
  const repository = await db
    .selectFrom("repositories")
    .select(["id", "slug"])
    .where("slug", "=", repositorySlug)
    .executeTakeFirst();

  if (!repository) {
    return null;
  }

  const runRows = await selectRunRows(db, repositorySlug)
    .where("runs.commit_sha", "=", commitSha)
    .orderBy("runs.created_at", "desc")
    .execute();

  if (runRows.length === 0) {
    return null;
  }

  const runs = await Promise.all(runRows.map((row) => toRunSummary(db, row)));
  const commitProcessRows = await db
    .selectFrom("commit_process_state")
    .select([
      "step_key as stepKey",
      "step_display_name as stepDisplayName",
      "step_kind as stepKind",
      "process_key as processKey",
      "process_display_name as processDisplayName",
      "process_kind as processKind",
      "file_path as filePath",
      "selected_run_id as sourceRunId",
      "selected_step_run_id as sourceStepRunId",
      "selected_process_run_id as sourceProcessRunId",
      "status",
      "duration_ms as durationMs",
      "reused",
      "attempt_count as attemptCount",
      "updated_at as updatedAt",
    ])
    .where("repository_id", "=", repository.id)
    .where("commit_sha", "=", commitSha)
    .orderBy("step_key", "asc")
    .orderBy("process_key", "asc")
    .execute();

  const processRunsForCommit = await db
    .selectFrom("process_runs")
    .innerJoin("step_runs", "step_runs.id", "process_runs.step_run_id")
    .innerJoin("runs", "runs.id", "step_runs.run_id")
    .select([
      "process_runs.duration_ms as durationMs",
      "process_runs.started_at as startedAt",
      "process_runs.finished_at as finishedAt",
    ])
    .where("runs.repository_id", "=", repository.id)
    .where("runs.commit_sha", "=", commitSha)
    .execute();

  const processes = commitProcessRows.map((row) => ({
    stepKey: row.stepKey,
    stepDisplayName: row.stepDisplayName,
    stepKind: row.stepKind,
    sourceRunId: row.sourceRunId,
    sourceStepRunId: row.sourceStepRunId,
    sourceProcessRunId: row.sourceProcessRunId,
    processKey: row.processKey,
    processDisplayName: row.processDisplayName,
    processKind: row.processKind,
    filePath: row.filePath,
    status: row.status as CommitDetail["processes"][number]["status"],
    durationMs: row.durationMs,
    reused: row.reused,
    attemptCount: row.attemptCount,
    updatedAt: row.updatedAt.toISOString(),
  }));

  const stepMap = new Map<
    string,
    {
      stepKey: string;
      stepDisplayName: string;
      stepKind: string;
      sourceRunId: string | null;
      sourceStepRunId: string | null;
      durationMs: number;
      processCount: number;
      statuses: string[];
      updatedAt: number;
    }
  >();

  for (const process of processes) {
    const existing = stepMap.get(process.stepKey);
    if (!existing) {
      stepMap.set(process.stepKey, {
        stepKey: process.stepKey,
        stepDisplayName: process.stepDisplayName,
        stepKind: process.stepKind,
        sourceRunId: process.sourceRunId,
        sourceStepRunId: process.sourceStepRunId,
        durationMs: process.durationMs ?? 0,
        processCount: 1,
        statuses: [process.status],
        updatedAt: Date.parse(process.updatedAt),
      });
      continue;
    }

    existing.durationMs += process.durationMs ?? 0;
    existing.processCount += 1;
    existing.statuses.push(process.status);
    const processUpdatedAt = Date.parse(process.updatedAt);
    if (processUpdatedAt >= existing.updatedAt) {
      existing.updatedAt = processUpdatedAt;
      existing.sourceRunId = process.sourceRunId;
      existing.sourceStepRunId = process.sourceStepRunId;
    }
  }

  const steps = [...stepMap.values()]
    .map((step) => ({
      stepKey: step.stepKey,
      stepDisplayName: step.stepDisplayName,
      stepKind: step.stepKind,
      status: summarizeStatuses(step.statuses) as CommitDetail["steps"][number]["status"],
      processCount: step.processCount,
      durationMs: step.durationMs,
      sourceRunId: step.sourceRunId,
      sourceStepRunId: step.sourceStepRunId,
    }))
    .sort((left, right) => left.stepKey.localeCompare(right.stepKey));

  return {
    repositorySlug: repository.slug,
    commitSha,
    commitTitle: fallbackCommitTitle(runs[0]?.commitTitle ?? null, commitSha),
    status: (processes.length > 0
      ? summarizeStatuses(processes.map((process) => process.status))
      : summarizeStatuses(runs.map((run) => run.status))) as CommitDetail["status"],
    steps,
    processes,
    runs,
    executionCost: {
      runCount: runs.length,
      processRunCount: processRunsForCommit.length,
      totalExecutionDurationMs: processRunsForCommit.reduce(
        (total, processRun) =>
          total +
          (coalesceDurationMs(processRun.durationMs, processRun.startedAt, processRun.finishedAt) ??
            0),
        0,
      ),
      selectedProcessDurationMs: processes.reduce(
        (total, process) => total + (process.durationMs ?? 0),
        0,
      ),
    },
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
