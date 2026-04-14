import path from "node:path";

import type { Kysely } from "kysely";

import type { RunTreemap, TreemapNode } from "@verge/contracts";

import {
  coalesceDurationMs,
  summarizeStatuses,
  type ProcessRunRow,
  type VergeDatabase,
} from "./shared.js";
import { listProcessRuns } from "./process-run-reads.js";
import { selectRunRows } from "./run-read-shared.js";

const readProcessDurationMs = (process: {
  duration_ms: number | null;
  started_at: Date | null;
  finished_at: Date | null;
}): number => {
  const liveDurationMs = coalesceDurationMs(
    process.duration_ms,
    process.started_at,
    process.finished_at,
  );
  if (liveDurationMs !== null) {
    return liveDurationMs;
  }

  if (process.started_at) {
    return Math.max(0, Date.now() - process.started_at.getTime());
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

const buildProcessTreemapNodes = (processes: ProcessRunRow[]): TreemapNode[] =>
  processes.map((process) => ({
    id: process.id,
    kind: "process",
    label: process.display_name,
    valueMs: readProcessDurationMs(process),
    wallDurationMs: coalesceDurationMs(
      process.duration_ms,
      process.started_at,
      process.finished_at,
    ),
    status: normalizeTreemapStatus(process.status),
    filePath: process.file_path,
    stepKey: null,
    processKey: process.process_key,
    reused: process.status === "reused",
    attemptCount: process.attempt_count,
  }));

const shouldGroupProcessesByFile = (processes: ProcessRunRow[]): boolean => {
  const filePaths = processes
    .map((process) => process.file_path)
    .filter((filePath): filePath is string => typeof filePath === "string" && filePath.length > 0);

  if (filePaths.length < 2) {
    return false;
  }

  return new Set(filePaths).size < filePaths.length;
};

const buildStepTreemapChildren = (stepRunId: string, processes: ProcessRunRow[]): TreemapNode[] => {
  if (!shouldGroupProcessesByFile(processes)) {
    return sortNodesByValue(buildProcessTreemapNodes(processes));
  }

  const processesByFile = new Map<string, ProcessRunRow[]>();
  const filelessProcesses: ProcessRunRow[] = [];

  for (const process of processes) {
    if (!process.file_path) {
      filelessProcesses.push(process);
      continue;
    }

    const existing = processesByFile.get(process.file_path) ?? [];
    existing.push(process);
    processesByFile.set(process.file_path, existing);
  }

  const fileNodes = [...processesByFile.entries()].map(([filePath, fileProcesses]) => {
    const children = sortNodesByValue(buildProcessTreemapNodes(fileProcesses));
    return {
      id: `file:${stepRunId}:${filePath}`,
      kind: "file" as const,
      label: path.basename(filePath),
      valueMs: sumValueMs(children),
      wallDurationMs: null,
      status: normalizeTreemapStatus(
        summarizeStatuses(fileProcesses.map((process) => process.status)),
      ),
      filePath,
      stepKey: null,
      processKey: null,
      reused: fileProcesses.every((process) => process.status === "reused"),
      attemptCount: null,
      children,
    };
  });

  return sortNodesByValue([...fileNodes, ...buildProcessTreemapNodes(filelessProcesses)]);
};

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
      const processes = await listProcessRuns(db, stepRow.id);
      const children = buildStepTreemapChildren(stepRow.id, processes);

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
      reused: run.status === "reused",
      attemptCount: null,
      children: sortedChildren,
    },
  };
};
