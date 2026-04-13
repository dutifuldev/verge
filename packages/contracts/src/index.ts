import { z } from "zod";

export const runStatusSchema = z.enum([
  "planned",
  "queued",
  "running",
  "passed",
  "failed",
  "reused",
  "interrupted",
]);

export const stepRunStatusSchema = runStatusSchema;

export const processRunStatusSchema = z.enum([
  "queued",
  "claimed",
  "running",
  "passed",
  "failed",
  "interrupted",
  "reused",
  "skipped",
]);

export const observationStatusSchema = z.enum(["passed", "failed", "unknown", "reused"]);

export const freshnessBucketSchema = z.enum(["fresh", "stale", "unknown"]);

export const runTriggerSchema = z.enum(["manual", "push", "pull_request"]);

export const processMaterializationKindSchema = z.enum([
  "singleProcess",
  "namedProcesses",
  "discoveredProcesses",
  "fixedShards",
]);

export const processDefinitionSchema = z.object({
  key: z.string().min(1),
  displayName: z.string().min(1),
  areaKeys: z.array(z.string()).default([]),
  extraArgs: z.array(z.string()).default([]),
  filePath: z.string().optional(),
  kind: z.string().default("named"),
});

export const processMaterializationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("singleProcess"),
    process: processDefinitionSchema,
  }),
  z.object({
    kind: z.literal("namedProcesses"),
    processes: z.array(processDefinitionSchema).min(1),
  }),
  z.object({
    kind: z.literal("discoveredProcesses"),
    discoveryCommand: z.array(z.string()).min(1),
  }),
  z.object({
    kind: z.literal("fixedShards"),
    count: z.number().int().positive(),
    displayNamePrefix: z.string().min(1),
    areaKeys: z.array(z.string()).default([]),
    extraArgsTemplate: z.array(z.string()).default([]),
  }),
]);

export const stepSpecSchema = z.object({
  key: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  kind: z.string().min(1),
  baseCommand: z.array(z.string()).min(1),
  cwd: z.string().default("."),
  observedAreaKeys: z.array(z.string()).default([]),
  materialization: processMaterializationSchema,
  reuseEnabled: z.boolean().default(false),
  checkpointEnabled: z.boolean().default(false),
  alwaysRun: z.boolean().default(false),
});

export const repositoryDefinitionSchema = z.object({
  slug: z.string().min(1),
  displayName: z.string().min(1),
  rootPath: z.string().min(1),
  defaultBranch: z.string().min(1),
  areas: z.array(
    z.object({
      key: z.string().min(1),
      displayName: z.string().min(1),
      pathPrefixes: z.array(z.string()).default([]),
    }),
  ),
});

export const repositorySummarySchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  defaultBranch: z.string(),
});

export const vergeConfigSchema = z.object({
  repository: repositoryDefinitionSchema,
  steps: z.array(stepSpecSchema).min(1),
});

export const createManualRunInputSchema = z.object({
  repositorySlug: z.string().default("verge"),
  commitSha: z.string().min(1),
  branch: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
  requestedStepKeys: z.array(z.string()).optional(),
  resumeFromCheckpoint: z.boolean().default(false),
  disableReuse: z.boolean().default(false),
});

export const createRunInputSchema = z.object({
  repositorySlug: z.string().default("verge"),
  trigger: runTriggerSchema,
  commitSha: z.string().min(1),
  branch: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
  requestedStepKeys: z.array(z.string()).optional(),
  resumeFromCheckpoint: z.boolean().default(false),
  disableReuse: z.boolean().default(false),
  pullRequestNumber: z.number().int().positive().optional(),
  eventIngestionId: z.string().uuid().optional(),
});

export const createManualRunResponseSchema = z.object({
  runId: z.string().uuid(),
  stepRunIds: z.array(z.string().uuid()),
});

export const workerClaimRequestSchema = z.object({
  workerId: z.string().min(1),
});

export const claimedProcessRunSchema = z.object({
  runId: z.string().uuid(),
  stepRunId: z.string().uuid(),
  processRunId: z.string().uuid(),
  repositorySlug: z.string(),
  repositoryRootPath: z.string(),
  stepKey: z.string(),
  stepDisplayName: z.string(),
  stepKind: z.string(),
  processKey: z.string(),
  processDisplayName: z.string(),
  processKind: z.string(),
  areaKeys: z.array(z.string()),
  command: z.array(z.string()),
  checkpointEnabled: z.boolean(),
});

export const workerClaimResponseSchema = z.object({
  assignment: claimedProcessRunSchema.nullable(),
});

export const workerHeartbeatInputSchema = z.object({
  workerId: z.string().min(1),
  processRunId: z.string().uuid(),
});

export const appendRunEventInputSchema = z.object({
  workerId: z.string().optional(),
  processRunId: z.string().uuid().optional(),
  kind: z.enum(["claimed", "started", "passed", "failed", "interrupted", "info"]),
  message: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const recordObservationInputSchema = z.object({
  workerId: z.string().min(1).optional(),
  processRunId: z.string().uuid().optional(),
  processKey: z.string().optional(),
  areaKey: z.string().nullable().optional(),
  status: observationStatusSchema,
  summary: z.record(z.string(), z.unknown()).default({}),
  executionScope: z.record(z.string(), z.unknown()).default({}),
});

export const recordArtifactInputSchema = z.object({
  workerId: z.string().min(1).optional(),
  processRunId: z.string().uuid().optional(),
  artifactKey: z.string().min(1),
  storagePath: z.string().min(1),
  mediaType: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const recordCheckpointInputSchema = z.object({
  workerId: z.string().min(1).optional(),
  processRunId: z.string().uuid(),
  completedProcessKeys: z.array(z.string()).default([]),
  pendingProcessKeys: z.array(z.string()).default([]),
  storagePath: z.string().optional(),
  resumableUntil: z.string().datetime(),
});

export const stepSpecSummarySchema = stepSpecSchema.extend({
  id: z.string().uuid(),
  repositorySlug: z.string(),
});

export const githubWebhookPushPayloadSchema = z.object({
  ref: z.string().min(1),
  after: z.string().min(1),
  repository: z.object({
    full_name: z.string().min(1),
  }),
  commits: z
    .array(
      z.object({
        added: z.array(z.string()).default([]),
        modified: z.array(z.string()).default([]),
        removed: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

export const githubWebhookPullRequestPayloadSchema = z.object({
  action: z.string().min(1),
  number: z.number().int().positive(),
  repository: z.object({
    full_name: z.string().min(1),
  }),
  pull_request: z.object({
    number: z.number().int().positive(),
    head: z.object({
      sha: z.string().min(1),
      ref: z.string().min(1),
    }),
    base: z.object({
      ref: z.string().min(1),
    }),
    changed_files: z.number().int().nonnegative().optional(),
  }),
});

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
  processCount: z.number().int().nonnegative(),
});

export const runListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: runStatusSchema.optional(),
  trigger: runTriggerSchema.optional(),
  stepKey: z.string().min(1).optional(),
});

export const runSummarySchema = z.object({
  id: z.string().uuid(),
  repositorySlug: z.string(),
  trigger: runTriggerSchema,
  commitSha: z.string(),
  branch: z.string().nullable(),
  pullRequestNumber: z.number().int().positive().nullable(),
  changedFiles: z.array(z.string()),
  status: runStatusSchema,
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  steps: z.array(stepRunSummarySchema),
});

export const runListItemSchema = runSummarySchema;

export const paginatedRunListSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  items: z.array(runListItemSchema),
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
  runs: z.array(runDetailSchema),
});

export const pullRequestDetailSchema = z.object({
  repositorySlug: z.string(),
  pullRequestNumber: z.number().int().positive(),
  runs: z.array(runDetailSchema),
});

export type RunStatus = z.infer<typeof runStatusSchema>;
export type StepRunStatus = z.infer<typeof stepRunStatusSchema>;
export type ProcessRunStatus = z.infer<typeof processRunStatusSchema>;
export type ObservationStatus = z.infer<typeof observationStatusSchema>;
export type FreshnessBucket = z.infer<typeof freshnessBucketSchema>;
export type RunTrigger = z.infer<typeof runTriggerSchema>;
export type StepSpec = z.infer<typeof stepSpecSchema>;
export type RepositoryDefinition = z.infer<typeof repositoryDefinitionSchema>;
export type RepositorySummary = z.infer<typeof repositorySummarySchema>;
export type VergeConfig = z.infer<typeof vergeConfigSchema>;
export type ProcessDefinition = z.infer<typeof processDefinitionSchema>;
export type CreateManualRunInput = z.infer<typeof createManualRunInputSchema>;
export type CreateRunInput = z.infer<typeof createRunInputSchema>;
export type WorkerClaimRequest = z.infer<typeof workerClaimRequestSchema>;
export type ClaimedProcessRun = z.infer<typeof claimedProcessRunSchema>;
export type AppendRunEventInput = z.infer<typeof appendRunEventInputSchema>;
export type RecordObservationInput = z.infer<typeof recordObservationInputSchema>;
export type RecordArtifactInput = z.infer<typeof recordArtifactInputSchema>;
export type RecordCheckpointInput = z.infer<typeof recordCheckpointInputSchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type StepRunSummary = z.infer<typeof stepRunSummarySchema>;
export type RunListQuery = z.infer<typeof runListQuerySchema>;
export type RunListItem = z.infer<typeof runListItemSchema>;
export type PaginatedRunList = z.infer<typeof paginatedRunListSchema>;
export type RunDetail = z.infer<typeof runDetailSchema>;
export type StepRunDetail = z.infer<typeof stepRunDetailSchema>;
export type StepSpecSummary = z.infer<typeof stepSpecSummarySchema>;
export type RepositoryHealth = z.infer<typeof repositoryHealthSchema>;
export type CommitDetail = z.infer<typeof commitDetailSchema>;
export type PullRequestDetail = z.infer<typeof pullRequestDetailSchema>;
