import type { StepRunSummary } from "@verge/contracts";

export const formatDateTime = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "Pending";

export const formatRelativeTime = (value: string): string => {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (Math.abs(diffMinutes) < 1) {
    return "just now";
  }

  if (Math.abs(diffMinutes) < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
};

export const formatDurationMs = (durationMs: number | null): string => {
  if (durationMs === null) {
    return "Pending";
  }

  const diffSeconds = Math.max(0, Math.round(durationMs / 1000));

  if (diffSeconds < 60) {
    return `${diffSeconds}s`;
  }

  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
};

export const formatDuration = (
  startedAt: string | null,
  finishedAt: string | null,
  durationMs?: number | null,
): string => {
  if (durationMs !== undefined) {
    return formatDurationMs(durationMs);
  }

  if (!startedAt) {
    return "Pending";
  }

  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  return formatDurationMs(Math.max(0, end - start));
};

const normalizeLabel = (value: string): string => value.trim().toLowerCase();

export const shouldShowSecondaryKey = (displayName: string, key: string): boolean =>
  normalizeLabel(displayName) !== normalizeLabel(key);

export const shortSha = (value: string): string => value.slice(0, 7);

export const classifyStepExecutionMode = (
  run: Pick<StepRunSummary, "reusedFromStepRunId" | "checkpointSourceStepRunId" | "status">,
): string => {
  if (run.reusedFromStepRunId) {
    return "reused";
  }

  if (run.checkpointSourceStepRunId) {
    return "resumed";
  }

  if (run.status === "reused") {
    return "reused";
  }

  return "fresh";
};

export const summarizeRunSteps = (steps: Array<Pick<StepRunSummary, "stepDisplayName">>): string =>
  steps.map((step) => step.stepDisplayName).join(", ");

export const summarizeRunExecutionMode = (
  steps: Array<
    Pick<StepRunSummary, "reusedFromStepRunId" | "checkpointSourceStepRunId" | "status">
  >,
): string => {
  if (steps.length === 0) {
    return "pending";
  }

  if (steps.every((step) => step.reusedFromStepRunId || step.status === "reused")) {
    return "reused";
  }

  if (steps.some((step) => step.checkpointSourceStepRunId)) {
    return "resumed";
  }

  return "fresh";
};

export const statusTone = (status: string): string => {
  switch (status) {
    case "passed":
    case "reused":
    case "fresh":
      return "good";
    case "failed":
    case "interrupted":
    case "stale":
      return "bad";
    case "running":
    case "queued":
      return "active";
    default:
      return "muted";
  }
};
