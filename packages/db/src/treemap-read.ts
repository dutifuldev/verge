import path from "node:path";

import type { Kysely } from "kysely";

import type { CommitTreemap, RunTreemap, TreemapNode } from "@verge/contracts";

import {
  coalesceDurationMs,
  summarizeStatuses,
  type ProcessRunRow,
  type VergeDatabase,
} from "./shared.js";
import { listProcessRuns } from "./process-run-reads.js";
import { selectRunRows } from "./run-read-shared.js";

type TreemapProcessSource = {
  id: string;
  label: string;
  status: string;
  filePath: string | null;
  processKey: string;
  durationMs: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  reused: boolean;
  attemptCount: number | null;
  sourceRunId: string | null;
  sourceStepRunId: string | null;
  sourceProcessRunId: string | null;
};

const readDurationMs = (process: {
  durationMs: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}): number => {
  const storedDurationMs = coalesceDurationMs(
    process.durationMs,
    process.startedAt,
    process.finishedAt,
  );
  if (storedDurationMs !== null) {
    return storedDurationMs;
  }

  if (process.startedAt) {
    return Math.max(0, Date.now() - process.startedAt.getTime());
  }

  return 0;
};

const normalizeTreemapStatus = (status: string): TreemapNode["status"] =>
  status === "claimed" ? "running" : (status as TreemapNode["status"]);

const sumValueMs = (children: TreemapNode[]): number =>
  children.reduce((total, child) => total + child.valueMs, 0);

const sortNodesByValue = (nodes: TreemapNode[]): TreemapNode[] =>
  [...nodes].sort(
    (left, right) => right.valueMs - left.valueMs || left.label.localeCompare(right.label),
  );

const buildProcessTreemapNodes = (processes: TreemapProcessSource[]): TreemapNode[] =>
  processes.map((process) => ({
    id: process.id,
    kind: "process",
    label: process.label,
    valueMs: readDurationMs(process),
    wallDurationMs: coalesceDurationMs(process.durationMs, process.startedAt, process.finishedAt),
    status: normalizeTreemapStatus(process.status),
    filePath: process.filePath,
    stepKey: null,
    processKey: process.processKey,
    sourceRunId: process.sourceRunId,
    sourceStepRunId: process.sourceStepRunId,
    sourceProcessRunId: process.sourceProcessRunId,
    reused: process.reused,
    attemptCount: process.attemptCount,
  }));

const shouldGroupProcessesByFile = (processes: TreemapProcessSource[]): boolean => {
  const filePaths = processes
    .map((process) => process.filePath)
    .filter((filePath): filePath is string => typeof filePath === "string" && filePath.length > 0);

  if (filePaths.length < 2) {
    return false;
  }

  return new Set(filePaths).size < filePaths.length;
};

const buildStepTreemapChildren = (input: {
  scopeId: string;
  stepKey: string;
  processes: TreemapProcessSource[];
  fileNodeSourceRunId?: string | null;
  fileNodeSourceStepRunId?: string | null;
}): TreemapNode[] => {
  if (!shouldGroupProcessesByFile(input.processes)) {
    return sortNodesByValue(buildProcessTreemapNodes(input.processes));
  }

  const processesByFile = new Map<string, TreemapProcessSource[]>();
  const filelessProcesses: TreemapProcessSource[] = [];

  for (const process of input.processes) {
    if (!process.filePath) {
      filelessProcesses.push(process);
      continue;
    }

    const existing = processesByFile.get(process.filePath) ?? [];
    existing.push(process);
    processesByFile.set(process.filePath, existing);
  }

  const fileNodes = [...processesByFile.entries()].map(([filePath, fileProcesses]) => {
    const children = sortNodesByValue(buildProcessTreemapNodes(fileProcesses));
    return {
      id: `file:${input.scopeId}:${filePath}`,
      kind: "file" as const,
      label: path.basename(filePath),
      valueMs: sumValueMs(children),
      wallDurationMs: null,
      status: normalizeTreemapStatus(
        summarizeStatuses(fileProcesses.map((process) => process.status)),
      ),
      filePath,
      stepKey: input.stepKey,
      processKey: null,
      sourceRunId: input.fileNodeSourceRunId ?? children[0]?.sourceRunId ?? null,
      sourceStepRunId: input.fileNodeSourceStepRunId ?? children[0]?.sourceStepRunId ?? null,
      sourceProcessRunId: null,
      reused: fileProcesses.every((process) => process.reused),
      attemptCount: null,
      children,
    };
  });

  return sortNodesByValue([...fileNodes, ...buildProcessTreemapNodes(filelessProcesses)]);
};

const listCommitProjectionRows = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
  commitSha: string,
) =>
  db
    .selectFrom("commit_process_state")
    .innerJoin("repositories", "repositories.id", "commit_process_state.repository_id")
    .select([
      "commit_process_state.step_key as stepKey",
      "commit_process_state.step_display_name as stepDisplayName",
      "commit_process_state.step_kind as stepKind",
      "commit_process_state.process_key as processKey",
      "commit_process_state.process_display_name as processDisplayName",
      "commit_process_state.process_kind as processKind",
      "commit_process_state.file_path as filePath",
      "commit_process_state.selected_run_id as sourceRunId",
      "commit_process_state.selected_step_run_id as sourceStepRunId",
      "commit_process_state.selected_process_run_id as sourceProcessRunId",
      "commit_process_state.status as status",
      "commit_process_state.duration_ms as durationMs",
      "commit_process_state.reused as reused",
      "commit_process_state.attempt_count as attemptCount",
      "commit_process_state.updated_at as updatedAt",
    ])
    .where("repositories.slug", "=", repositorySlug)
    .where("commit_process_state.commit_sha", "=", commitSha)
    .orderBy("commit_process_state.step_key", "asc")
    .orderBy("commit_process_state.process_key", "asc")
    .execute();

const listRunRowsForCommit = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
  commitSha: string,
) =>
  selectRunRows(db, repositorySlug)
    .where("runs.commit_sha", "=", commitSha)
    .orderBy("runs.created_at", "desc")
    .execute();

export const getRunTreemap = async (
  db: Kysely<VergeDatabase>,
  runId: string,
): Promise<RunTreemap | null> => {
  const run = await selectRunRows(db).where("runs.id", "=", runId).executeTakeFirst();
  if (!run) {
    return null;
  }

  const stepRows = await db
    .selectFrom("step_runs")
    .selectAll()
    .where("run_id", "=", runId)
    .orderBy("created_at", "asc")
    .execute();

  const stepChildren = await Promise.all(
    stepRows.map(async (stepRow): Promise<TreemapNode> => {
      const processRows = await listProcessRuns(db, stepRow.id);
      const processes: TreemapProcessSource[] = processRows.map((process: ProcessRunRow) => ({
        id: process.id,
        label: process.display_name,
        status: process.status,
        filePath: process.file_path,
        processKey: process.process_key,
        durationMs: process.duration_ms,
        startedAt: process.started_at,
        finishedAt: process.finished_at,
        reused: process.status === "reused",
        attemptCount: process.attempt_count,
        sourceRunId: run.id,
        sourceStepRunId: stepRow.id,
        sourceProcessRunId: process.id,
      }));
      const children = buildStepTreemapChildren({
        scopeId: stepRow.id,
        stepKey: stepRow.step_key,
        processes,
        fileNodeSourceRunId: run.id,
        fileNodeSourceStepRunId: stepRow.id,
      });

      return {
        id: stepRow.id,
        kind: "step",
        label: stepRow.display_name,
        valueMs: sumValueMs(children),
        wallDurationMs: coalesceDurationMs(
          stepRow.duration_ms,
          stepRow.started_at,
          stepRow.finished_at,
        ),
        status: normalizeTreemapStatus(stepRow.status),
        filePath: null,
        stepKey: stepRow.step_key,
        processKey: null,
        sourceRunId: run.id,
        sourceStepRunId: stepRow.id,
        sourceProcessRunId: null,
        reused: stepRow.status === "reused",
        attemptCount: null,
        children,
      };
    }),
  );

  const sortedChildren = sortNodesByValue(stepChildren);
  return {
    runId: run.id,
    repositorySlug: run.repositorySlug,
    tree: {
      id: run.id,
      kind: "run",
      label: run.commitSha.slice(0, 7),
      valueMs: sumValueMs(sortedChildren),
      wallDurationMs: coalesceDurationMs(run.durationMs, run.startedAt, run.finishedAt),
      status: normalizeTreemapStatus(run.status),
      filePath: null,
      stepKey: null,
      processKey: null,
      sourceRunId: run.id,
      sourceStepRunId: null,
      sourceProcessRunId: null,
      reused: run.status === "reused",
      attemptCount: null,
      children: sortedChildren,
    },
  };
};

export const getCommitTreemap = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
  commitSha: string,
): Promise<CommitTreemap | null> => {
  const runRows = await listRunRowsForCommit(db, repositorySlug, commitSha);
  if (runRows.length === 0) {
    return null;
  }

  const projectionRows = await listCommitProjectionRows(db, repositorySlug, commitSha);
  const projectionByStep = new Map<string, typeof projectionRows>();
  for (const row of projectionRows) {
    const existing = projectionByStep.get(row.stepKey) ?? [];
    existing.push(row);
    projectionByStep.set(row.stepKey, existing);
  }

  const stepChildren = [...projectionByStep.entries()].map(([stepKey, rows]) => {
    const processes: TreemapProcessSource[] = rows.map((row) => ({
      id: row.sourceProcessRunId,
      label: row.processDisplayName,
      status: row.status,
      filePath: row.filePath,
      processKey: row.processKey,
      durationMs: row.durationMs,
      startedAt: null,
      finishedAt: null,
      reused: row.reused,
      attemptCount: row.attemptCount,
      sourceRunId: row.sourceRunId,
      sourceStepRunId: row.sourceStepRunId,
      sourceProcessRunId: row.sourceProcessRunId,
    }));
    const children = buildStepTreemapChildren({
      scopeId: `commit:${commitSha}:${stepKey}`,
      stepKey,
      processes,
    });
    const latestRow = [...rows].sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    )[0];

    return {
      id: `commit-step:${commitSha}:${stepKey}`,
      kind: "step" as const,
      label: latestRow?.stepDisplayName ?? stepKey,
      valueMs: sumValueMs(children),
      wallDurationMs: null,
      status: normalizeTreemapStatus(summarizeStatuses(rows.map((row) => row.status))),
      filePath: null,
      stepKey,
      processKey: null,
      sourceRunId: latestRow?.sourceRunId ?? null,
      sourceStepRunId: latestRow?.sourceStepRunId ?? null,
      sourceProcessRunId: null,
      reused: rows.every((row) => row.reused),
      attemptCount: null,
      children,
    };
  });

  const sortedChildren = sortNodesByValue(stepChildren);
  const rootStatus =
    projectionRows.length > 0
      ? normalizeTreemapStatus(summarizeStatuses(projectionRows.map((row) => row.status)))
      : normalizeTreemapStatus(summarizeStatuses(runRows.map((run) => run.status)));

  return {
    repositorySlug,
    commitSha,
    tree: {
      id: `commit:${commitSha}`,
      kind: "commit",
      label: commitSha.slice(0, 7),
      valueMs: sumValueMs(sortedChildren),
      wallDurationMs: null,
      status: rootStatus,
      filePath: null,
      stepKey: null,
      processKey: null,
      sourceRunId: null,
      sourceStepRunId: null,
      sourceProcessRunId: null,
      reused: projectionRows.length > 0 && projectionRows.every((row) => row.reused),
      attemptCount: null,
      children: sortedChildren,
    },
  };
};
