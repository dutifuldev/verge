import { z } from "zod";

import {
  freshnessBucketSchema,
  observationStatusSchema,
  processRunStatusSchema,
  runStatusSchema,
  runTriggerSchema,
  stepRunStatusSchema,
} from "./status.js";

export const processRunSummarySchema = z.object({
  id: z.string().uuid(),
  processKey: z.string(),
  processDisplayName: z.string(),
  processKind: z.string(),
  filePath: z.string().nullable(),
  status: processRunStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});

export const stepRunSummarySchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  stepKey: z.string(),
  stepDisplayName: z.string(),
  stepKind: z.string(),
  status: stepRunStatusSchema,
  planReason: z.string(),
  reusedFromStepRunId: z.string().uuid().nullable(),
  checkpointSourceStepRunId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  processCount: z.number().int().nonnegative(),
});

export const runListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: runStatusSchema.optional(),
  trigger: runTriggerSchema.optional(),
  stepKey: z.string().min(1).optional(),
});

export const commitListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const runSummarySchema = z.object({
  id: z.string().uuid(),
  repositorySlug: z.string(),
  trigger: runTriggerSchema,
  commitSha: z.string(),
  commitTitle: z.string().nullable(),
  branch: z.string().nullable(),
  pullRequestNumber: z.number().int().positive().nullable(),
  changedFiles: z.array(z.string()),
  status: runStatusSchema,
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  steps: z.array(stepRunSummarySchema),
});

export const runListItemSchema = runSummarySchema;

export const paginatedRunListSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  items: z.array(runListItemSchema),
});

export const commitListItemSchema = z.object({
  repositorySlug: z.string(),
  commitSha: z.string(),
  commitTitle: z.string().nullable(),
  status: runStatusSchema,
  coveragePercent: z.number().int().min(0).max(100),
  coveredProcessCount: z.number().int().nonnegative(),
  expectedProcessCount: z.number().int().nonnegative(),
  healthyProcessCount: z.number().int().nonnegative(),
  attemptCount: z.number().int().nonnegative(),
  latestCreatedAt: z.string().datetime(),
});

export const paginatedCommitListSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  items: z.array(commitListItemSchema),
});

export const observationSummarySchema = z.object({
  id: z.string().uuid(),
  stepRunId: z.string().uuid(),
  processRunId: z.string().uuid().nullable(),
  processKey: z.string().nullable(),
  areaKey: z.string().nullable(),
  status: observationStatusSchema,
  summary: z.record(z.string(), z.unknown()),
  executionScope: z.record(z.string(), z.unknown()),
  observedAt: z.string().datetime(),
});

export const runEventSummarySchema = z.object({
  id: z.string().uuid(),
  stepRunId: z.string().uuid(),
  processRunId: z.string().uuid().nullable(),
  kind: z.string(),
  message: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const artifactSummarySchema = z.object({
  id: z.string().uuid(),
  stepRunId: z.string().uuid(),
  processRunId: z.string().uuid().nullable(),
  artifactKey: z.string(),
  storagePath: z.string(),
  mediaType: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const checkpointSummarySchema = z.object({
  id: z.string().uuid(),
  stepRunId: z.string().uuid(),
  completedProcessKeys: z.array(z.string()),
  pendingProcessKeys: z.array(z.string()),
  storagePath: z.string().nullable(),
  createdAt: z.string().datetime(),
  resumableUntil: z.string().datetime(),
});

export const stepRunDetailSchema = stepRunSummarySchema.extend({
  processes: z.array(processRunSummarySchema),
  observations: z.array(observationSummarySchema),
  events: z.array(runEventSummarySchema),
  artifacts: z.array(artifactSummarySchema),
  checkpoints: z.array(checkpointSummarySchema),
});

export const runDetailSchema = runSummarySchema.extend({
  steps: z.array(stepRunSummarySchema),
});

export const commitProcessSummarySchema = z.object({
  stepKey: z.string(),
  stepDisplayName: z.string(),
  stepKind: z.string(),
  sourceRunId: z.string().uuid(),
  sourceStepRunId: z.string().uuid(),
  sourceProcessRunId: z.string().uuid(),
  processKey: z.string(),
  processDisplayName: z.string(),
  processKind: z.string(),
  filePath: z.string().nullable(),
  status: processRunStatusSchema,
  durationMs: z.number().int().nonnegative().nullable(),
  reused: z.boolean(),
  attemptCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

export const commitStepSummarySchema = z.object({
  stepKey: z.string(),
  stepDisplayName: z.string(),
  stepKind: z.string(),
  status: stepRunStatusSchema,
  processCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  sourceRunId: z.string().uuid().nullable(),
  sourceStepRunId: z.string().uuid().nullable(),
});

export const commitExecutionCostSchema = z.object({
  runCount: z.number().int().nonnegative(),
  processRunCount: z.number().int().nonnegative(),
  totalExecutionDurationMs: z.number().int().nonnegative(),
  selectedProcessDurationMs: z.number().int().nonnegative(),
});

export const repoAreaStateSchema = z.object({
  key: z.string(),
  displayName: z.string(),
  latestStatus: observationStatusSchema.or(z.literal("unknown")),
  freshnessBucket: freshnessBucketSchema,
  lastObservedAt: z.string().datetime().nullable(),
  lastSuccessfulObservedAt: z.string().datetime().nullable(),
});

export const repositoryHealthSchema = z.object({
  repositorySlug: z.string(),
  repositoryDisplayName: z.string(),
  activeRuns: z.array(runSummarySchema),
  recentRuns: z.array(runSummarySchema),
  areaStates: z.array(repoAreaStateSchema),
});

export const commitDetailSchema = z.object({
  repositorySlug: z.string(),
  commitSha: z.string(),
  commitTitle: z.string().nullable(),
  status: runStatusSchema,
  steps: z.array(commitStepSummarySchema),
  processes: z.array(commitProcessSummarySchema),
  runs: z.array(runSummarySchema),
  executionCost: commitExecutionCostSchema,
});

export const pullRequestDetailSchema = z.object({
  repositorySlug: z.string(),
  pullRequestNumber: z.number().int().positive(),
  runs: z.array(runDetailSchema),
});

export type RunSummary = z.infer<typeof runSummarySchema>;
export type StepRunSummary = z.infer<typeof stepRunSummarySchema>;
export type RunListQuery = z.infer<typeof runListQuerySchema>;
export type CommitListQuery = z.infer<typeof commitListQuerySchema>;
export type RunListItem = z.infer<typeof runListItemSchema>;
export type PaginatedRunList = z.infer<typeof paginatedRunListSchema>;
export type CommitListItem = z.infer<typeof commitListItemSchema>;
export type PaginatedCommitList = z.infer<typeof paginatedCommitListSchema>;
export type RunDetail = z.infer<typeof runDetailSchema>;
export type StepRunDetail = z.infer<typeof stepRunDetailSchema>;
export type RepositoryHealth = z.infer<typeof repositoryHealthSchema>;
export type CommitProcessSummary = z.infer<typeof commitProcessSummarySchema>;
export type CommitStepSummary = z.infer<typeof commitStepSummarySchema>;
export type CommitExecutionCost = z.infer<typeof commitExecutionCostSchema>;
export type CommitDetail = z.infer<typeof commitDetailSchema>;
export type PullRequestDetail = z.infer<typeof pullRequestDetailSchema>;
