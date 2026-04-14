import type { Kysely } from "kysely";

import { coalesceDurationMs, type VergeDatabase } from "./shared.js";

type CommitProjectionContext = {
  repositoryId: string;
  commitSha: string;
};

type CommitProjectionCandidate = {
  repositoryId: string;
  commitSha: string;
  runId: string;
  runCreatedAt: Date;
  stepRunId: string;
  stepKey: string;
  stepDisplayName: string;
  stepKind: string;
  processRunId: string;
  processKey: string;
  processDisplayName: string;
  processKind: string;
  filePath: string | null;
  status: string;
  durationMs: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  attemptCount: number;
  createdAt: Date;
};

const activeStatuses = new Set(["queued", "claimed", "running"]);
const preferredTerminalStatuses = new Set(["passed", "reused", "failed"]);

const compareCandidateRecency = (
  left: CommitProjectionCandidate,
  right: CommitProjectionCandidate,
): number =>
  right.runCreatedAt.getTime() - left.runCreatedAt.getTime() ||
  right.createdAt.getTime() - left.createdAt.getTime();

const chooseProjectionCandidate = (
  candidates: CommitProjectionCandidate[],
): CommitProjectionCandidate => {
  const ordered = [...candidates].sort(compareCandidateRecency);
  const fallback = ordered[0];
  if (!fallback) {
    throw new Error("Expected at least one commit projection candidate");
  }

  for (const candidate of ordered) {
    if (activeStatuses.has(candidate.status)) {
      return candidate;
    }

    if (preferredTerminalStatuses.has(candidate.status)) {
      return candidate;
    }
  }

  return fallback;
};

const computeSelectedDurationMs = (candidate: CommitProjectionCandidate): number | null => {
  const durationMs = coalesceDurationMs(
    candidate.durationMs,
    candidate.startedAt,
    candidate.finishedAt,
  );
  if (durationMs !== null) {
    return durationMs;
  }

  if (candidate.startedAt) {
    return Math.max(0, Date.now() - candidate.startedAt.getTime());
  }

  return null;
};

const listProjectionCandidates = async (
  db: Kysely<VergeDatabase>,
  input: CommitProjectionContext,
): Promise<CommitProjectionCandidate[]> =>
  db
    .selectFrom("process_runs")
    .innerJoin("step_runs", "step_runs.id", "process_runs.step_run_id")
    .innerJoin("runs", "runs.id", "step_runs.run_id")
    .select([
      "runs.repository_id as repositoryId",
      "runs.commit_sha as commitSha",
      "runs.id as runId",
      "runs.created_at as runCreatedAt",
      "step_runs.id as stepRunId",
      "step_runs.step_key as stepKey",
      "step_runs.display_name as stepDisplayName",
      "step_runs.kind as stepKind",
      "process_runs.id as processRunId",
      "process_runs.process_key as processKey",
      "process_runs.display_name as processDisplayName",
      "process_runs.kind as processKind",
      "process_runs.file_path as filePath",
      "process_runs.status as status",
      "process_runs.duration_ms as durationMs",
      "process_runs.started_at as startedAt",
      "process_runs.finished_at as finishedAt",
      "process_runs.attempt_count as attemptCount",
      "process_runs.created_at as createdAt",
    ])
    .where("runs.repository_id", "=", input.repositoryId)
    .where("runs.commit_sha", "=", input.commitSha)
    .orderBy("runs.created_at", "desc")
    .orderBy("process_runs.created_at", "desc")
    .execute();

const getCommitProjectionContextByRunId = async (
  db: Kysely<VergeDatabase>,
  runId: string,
): Promise<CommitProjectionContext | null> => {
  const row = await db
    .selectFrom("runs")
    .select(["repository_id as repositoryId", "commit_sha as commitSha"])
    .where("id", "=", runId)
    .executeTakeFirst();

  return row ?? null;
};

const getCommitProjectionContextByStepRunId = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
): Promise<CommitProjectionContext | null> => {
  const row = await db
    .selectFrom("step_runs")
    .innerJoin("runs", "runs.id", "step_runs.run_id")
    .select(["runs.repository_id as repositoryId", "runs.commit_sha as commitSha"])
    .where("step_runs.id", "=", stepRunId)
    .executeTakeFirst();

  return row ?? null;
};

const syncCommitProjection = async (
  db: Kysely<VergeDatabase>,
  context: CommitProjectionContext,
): Promise<void> => {
  const candidates = await listProjectionCandidates(db, context);
  const chosen = new Map<string, CommitProjectionCandidate>();

  for (const candidate of candidates) {
    const identity = `${candidate.stepKey}\u0000${candidate.processKey}`;
    const existing = chosen.get(identity);
    if (!existing) {
      chosen.set(identity, candidate);
      continue;
    }

    chosen.set(identity, chooseProjectionCandidate([existing, candidate]));
  }

  await db
    .deleteFrom("commit_process_state")
    .where("repository_id", "=", context.repositoryId)
    .where("commit_sha", "=", context.commitSha)
    .execute();

  if (chosen.size === 0) {
    return;
  }

  const updatedAt = new Date();
  await db
    .insertInto("commit_process_state")
    .values(
      [...chosen.values()].map((candidate) => ({
        repository_id: candidate.repositoryId,
        commit_sha: candidate.commitSha,
        step_key: candidate.stepKey,
        step_display_name: candidate.stepDisplayName,
        step_kind: candidate.stepKind,
        process_key: candidate.processKey,
        process_display_name: candidate.processDisplayName,
        process_kind: candidate.processKind,
        file_path: candidate.filePath,
        selected_run_id: candidate.runId,
        selected_step_run_id: candidate.stepRunId,
        selected_process_run_id: candidate.processRunId,
        status: candidate.status,
        duration_ms: computeSelectedDurationMs(candidate),
        reused: candidate.status === "reused",
        attempt_count: candidate.attemptCount,
        updated_at: updatedAt,
      })),
    )
    .execute();
};

export const syncCommitProcessStateForRun = async (
  db: Kysely<VergeDatabase>,
  runId: string,
): Promise<void> => {
  const context = await getCommitProjectionContextByRunId(db, runId);
  if (!context) {
    return;
  }

  await syncCommitProjection(db, context);
};

export const syncCommitProcessStateForStepRun = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
): Promise<void> => {
  const context = await getCommitProjectionContextByStepRunId(db, stepRunId);
  if (!context) {
    return;
  }

  await syncCommitProjection(db, context);
};
