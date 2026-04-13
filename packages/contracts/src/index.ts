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

export const runProcessStatusSchema = z.enum([
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
  "fixedShards",
]);

export const namedProcessDefinitionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  areaKeys: z.array(z.string()).default([]),
  extraArgs: z.array(z.string()).default([]),
  type: z.string().default("named"),
});

export const processMaterializationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("singleProcess"),
    process: namedProcessDefinitionSchema,
  }),
  z.object({
    kind: z.literal("namedProcesses"),
    processes: z.array(namedProcessDefinitionSchema).min(1),
  }),
  z.object({
    kind: z.literal("fixedShards"),
    count: z.number().int().positive(),
    labelPrefix: z.string().min(1),
    areaKeys: z.array(z.string()).default([]),
    extraArgsTemplate: z.array(z.string()).default([]),
  }),
]);

export const processSpecSchema = z.object({
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

export const createManualRunRequestInputSchema = z.object({
  repositorySlug: z.string().default("verge"),
  commitSha: z.string().min(1),
  branch: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
  requestedProcessSpecKeys: z.array(z.string()).optional(),
  resumeFromCheckpoint: z.boolean().default(false),
  disableReuse: z.boolean().default(false),
});

export const createRunRequestInputSchema = z.object({
  repositorySlug: z.string().default("verge"),
  trigger: runTriggerSchema,
  commitSha: z.string().min(1),
  branch: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
  requestedProcessSpecKeys: z.array(z.string()).optional(),
  resumeFromCheckpoint: z.boolean().default(false),
  disableReuse: z.boolean().default(false),
  pullRequestNumber: z.number().int().positive().optional(),
  eventIngestionId: z.string().uuid().optional(),
});

export const createManualRunRequestResponseSchema = z.object({
  runRequestId: z.string().uuid(),
  runIds: z.array(z.string().uuid()),
});

export const workerClaimRequestSchema = z.object({
  workerId: z.string().min(1),
});

export const claimedRunProcessSchema = z.object({
  runId: z.string().uuid(),
  runProcessId: z.string().uuid(),
  runRequestId: z.string().uuid(),
  repositorySlug: z.string(),
  repositoryRootPath: z.string(),
  processSpecKey: z.string(),
  processSpecDisplayName: z.string(),
  processSpecKind: z.string(),
  processKey: z.string(),
  processLabel: z.string(),
  areaKeys: z.array(z.string()),
  command: z.array(z.string()),
  checkpointEnabled: z.boolean(),
});

export const workerClaimResponseSchema = z.object({
  assignment: claimedRunProcessSchema.nullable(),
});

export const workerHeartbeatInputSchema = z.object({
  workerId: z.string().min(1),
  runProcessId: z.string().uuid(),
});

export const appendRunEventInputSchema = z.object({
  workerId: z.string().optional(),
  runProcessId: z.string().uuid().optional(),
  kind: z.enum(["claimed", "started", "passed", "failed", "interrupted", "info"]),
  message: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const recordObservationInputSchema = z.object({
  workerId: z.string().min(1).optional(),
  runProcessId: z.string().uuid().optional(),
  processKey: z.string().optional(),
  areaKey: z.string().optional(),
  status: observationStatusSchema,
  summary: z.record(z.string(), z.unknown()).default({}),
  executionScope: z.record(z.string(), z.unknown()).default({}),
});

export const recordArtifactInputSchema = z.object({
  workerId: z.string().min(1).optional(),
  runProcessId: z.string().uuid().optional(),
  artifactKey: z.string().min(1),
  storagePath: z.string().min(1),
  mediaType: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const recordCheckpointInputSchema = z.object({
  workerId: z.string().min(1).optional(),
  runProcessId: z.string().uuid(),
  completedProcessKeys: z.array(z.string()).default([]),
  pendingProcessKeys: z.array(z.string()).default([]),
  storagePath: z.string().optional(),
  resumableUntil: z.string().datetime(),
});

export const processSpecSummarySchema = processSpecSchema.extend({
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

export const runProcessSummarySchema = z.object({
  id: z.string().uuid(),
  processKey: z.string(),
  processLabel: z.string(),
  processType: z.string(),
  status: runProcessStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});

export const stepRunSummarySchema = z.object({
  id: z.string().uuid(),
  runRequestId: z.string().uuid(),
  processSpecKey: z.string(),
  processSpecDisplayName: z.string(),
  status: runStatusSchema,
  planReason: z.string(),
  reusedFromRunId: z.string().uuid().nullable(),
  checkpointSourceRunId: z.string().uuid().nullable(),
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
  runId: z.string().uuid(),
  runProcessId: z.string().uuid().nullable(),
  processKey: z.string().nullable(),
  areaKey: z.string().nullable(),
  status: observationStatusSchema,
  summary: z.record(z.string(), z.unknown()),
  executionScope: z.record(z.string(), z.unknown()),
  observedAt: z.string().datetime(),
});

export const runEventSummarySchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  runProcessId: z.string().uuid().nullable(),
  kind: z.string(),
  message: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const artifactSummarySchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  runProcessId: z.string().uuid().nullable(),
  artifactKey: z.string(),
  storagePath: z.string(),
  mediaType: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const checkpointSummarySchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  completedProcessKeys: z.array(z.string()),
  pendingProcessKeys: z.array(z.string()),
  storagePath: z.string().nullable(),
  createdAt: z.string().datetime(),
  resumableUntil: z.string().datetime(),
});

export const stepRunDetailSchema = stepRunSummarySchema.extend({
  processes: z.array(runProcessSummarySchema),
  observations: z.array(observationSummarySchema),
  events: z.array(runEventSummarySchema),
  artifacts: z.array(artifactSummarySchema),
  checkpoints: z.array(checkpointSummarySchema),
});

export const runDetailSchema = runSummarySchema.extend({
  steps: z.array(stepRunSummarySchema),
});

export const runRequestDetailSchema = runDetailSchema;

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
  runRequests: z.array(runRequestDetailSchema),
});

export const pullRequestDetailSchema = z.object({
  repositorySlug: z.string(),
  pullRequestNumber: z.number().int().positive(),
  runRequests: z.array(runRequestDetailSchema),
});

export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunProcessStatus = z.infer<typeof runProcessStatusSchema>;
export type ObservationStatus = z.infer<typeof observationStatusSchema>;
export type FreshnessBucket = z.infer<typeof freshnessBucketSchema>;
export type RunTrigger = z.infer<typeof runTriggerSchema>;
export type ProcessSpec = z.infer<typeof processSpecSchema>;
export type RepositoryDefinition = z.infer<typeof repositoryDefinitionSchema>;
export type NamedProcessDefinition = z.infer<typeof namedProcessDefinitionSchema>;
export type CreateManualRunRequestInput = z.infer<typeof createManualRunRequestInputSchema>;
export type CreateRunRequestInput = z.infer<typeof createRunRequestInputSchema>;
export type WorkerClaimRequest = z.infer<typeof workerClaimRequestSchema>;
export type ClaimedRunProcess = z.infer<typeof claimedRunProcessSchema>;
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
export type RunRequestDetail = z.infer<typeof runRequestDetailSchema>;
export type ProcessSpecSummary = z.infer<typeof processSpecSummarySchema>;
export type RepositoryHealth = z.infer<typeof repositoryHealthSchema>;
export type CommitDetail = z.infer<typeof commitDetailSchema>;
export type PullRequestDetail = z.infer<typeof pullRequestDetailSchema>;
